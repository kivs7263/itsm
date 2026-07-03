"""서비스 카탈로그 approval_policy 다단/조건부 결재선 해석기 (RA-C5).

approval_policy JSONB 스키마:

v1 (하위호환 — 기존):
    {"required": true}

v2 (다단/조건부):
    {
        "required": true,
        "steps": [
            {
                "order":      1,
                "approvers":  ["user@example.com"],
                "line_type":  "approver",           # approver|agreement|reference, 기본 "approver"
                "condition":  {                      # 없으면 항상 포함
                    "field":  "amount",              # form_data 키
                    "op":     ">=",                  # >= | > | <= | < | == | !=
                    "value":  1000000                # 비교 대상값 (숫자 또는 문자열)
                }
            },
            {
                "order":      2,
                "approvers":  ["cfo@example.com"],
                "line_type":  "approver",
                "condition":  {"field": "amount", "op": ">=", "value": 5000000}
            }
        ]
    }

반환값: GW submit_approval_draft의 approver_steps 파라미터 형식
    [{"email": str, "order": int, "line_type": str}, ...]

하위호환:
    - "steps" 키 없음 → 빈 리스트 반환 (기존 required:bool 그대로 동작)
    - 조건 평가 실패 (형 변환 오류 등) → 해당 step 건너뜀 + 경고 로그
    - approvers 빈 리스트인 step → 건너뜀

설계 원칙:
    - 모든 오류는 graceful (예외 발생 금지 — 결재선 없이 draft로 fallback)
    - order 재번호 매김은 GW 쪽에서 처리 (중복 order 보정)
    - approvers 배열 멤버가 여러 명이면 순서 보존해 각각 별도 라인으로 펼침
      (동일 order → GW에서 중복 보정해 순차 삽입)
"""
from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)

_SUPPORTED_OPS = frozenset({">=", ">", "<=", "<", "==", "!="})


def _evaluate_condition(condition: dict, form_data: dict) -> bool:
    """단일 조건 딕트를 form_data에 대해 평가한다.

    Args:
        condition: {"field": str, "op": str, "value": Any}
        form_data: 사용자 제출 폼 데이터

    Returns:
        True → 조건 충족 (step 포함), False → 미충족 (step 제외).
        평가 불가(필드 없음·타입 오류 등) → False + 경고 로그.
    """
    if not isinstance(condition, dict):
        return False

    field = condition.get("field")
    op = condition.get("op")
    threshold = condition.get("value")

    if not field or op not in _SUPPORTED_OPS:
        logger.warning(
            "catalog_approval: 잘못된 조건 정의 (field=%s op=%s) — step 제외", field, op
        )
        return False

    actual = form_data.get(field)
    if actual is None:
        # 필드 없음: 조건 미충족으로 처리
        return False

    try:
        # 숫자 비교 시도
        actual_n = float(actual)
        threshold_n = float(threshold)  # type: ignore[arg-type]
        if op == ">=":
            return actual_n >= threshold_n
        if op == ">":
            return actual_n > threshold_n
        if op == "<=":
            return actual_n <= threshold_n
        if op == "<":
            return actual_n < threshold_n
        if op == "==":
            return actual_n == threshold_n
        if op == "!=":
            return actual_n != threshold_n
    except (TypeError, ValueError):
        pass

    # 문자열 비교 (== / != 만 의미 있음)
    try:
        actual_s = str(actual)
        threshold_s = str(threshold)
        if op == "==":
            return actual_s == threshold_s
        if op == "!=":
            return actual_s != threshold_s
    except Exception:
        pass

    logger.warning(
        "catalog_approval: 조건 평가 실패 (field=%s op=%s actual=%r threshold=%r) — step 제외",
        field, op, actual, threshold,
    )
    return False


def resolve_approval_steps(
    policy: dict[str, Any],
    form_data: dict[str, Any],
) -> list[dict[str, Any]]:
    """approval_policy와 form_data를 받아 GW approver_steps 목록을 반환한다.

    Args:
        policy:    ServiceOffering.approval_policy (JSONB dict)
        form_data: ServiceOfferingSubmission.form_data 또는 요청 body.form_data

    Returns:
        GW submit_approval_draft 전달용 approver_steps 리스트.
        v1(required:bool만 있거나 steps 없음) → 빈 리스트.
        v2 steps → 조건 평가 후 충족 step의 approvers를 순서대로 펼쳐 반환.
    """
    if not isinstance(policy, dict):
        return []

    steps = policy.get("steps")
    if not steps or not isinstance(steps, list):
        # v1 하위호환: steps 키 없음 → 결재선 없는 draft
        return []

    if not isinstance(form_data, dict):
        form_data = {}

    result: list[dict[str, Any]] = []

    for step in steps:
        if not isinstance(step, dict):
            continue

        order = step.get("order", 1)
        try:
            order = int(order)
        except (TypeError, ValueError):
            order = 1

        approvers: list[str] = step.get("approvers") or []
        if not approvers:
            continue

        line_type: str = step.get("line_type", "approver")
        if line_type not in ("approver", "agreement", "reference"):
            line_type = "approver"

        condition = step.get("condition")
        if condition is not None:
            # 조건 있으면 평가 — False면 이 step 전체 제외
            if not _evaluate_condition(condition, form_data):
                logger.debug(
                    "catalog_approval: step order=%d 조건 미충족 — 제외 (condition=%r form_field=%r)",
                    order, condition, form_data.get(condition.get("field", "")),
                )
                continue

        # 조건 없거나 충족: approvers 각 항목을 별도 라인으로 펼침
        # 동일 order 중복은 GW 측 보정으로 처리
        for approver_email in approvers:
            if not isinstance(approver_email, str) or not approver_email.strip():
                continue
            result.append({
                "email": approver_email.strip(),
                "order": order,
                "line_type": line_type,
            })

    return result
