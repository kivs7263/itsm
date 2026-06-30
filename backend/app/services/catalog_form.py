"""서비스 카탈로그 폼 데이터 검증 헬퍼 (CA-P1-5).

form_schema 구조:
  {
    "version": 1,
    "fields": [
      {
        "id":       "field_id",
        "label":    "필드명",
        "type":     "string"|"textarea"|"number"|"select"|"multiselect"|"date"|"boolean",
        "required": false,
        "options":  [...],                       # select / multiselect 전용
        "validate": {"pattern": "<regex>"}       # string / textarea 전용, optional
      }, ...
    ]
  }

지원 타입 7종:
  string / textarea / number / select / multiselect / date / boolean

반환:
  (True,  [])                                     — 검증 통과
  (False, [{"field": id, "message": "..."}])     — 검증 실패 목록

화이트리스트 외 키는 무시(경고 없이 허용). strict 거부가 필요하면
_reject_extra 플래그를 True로 전환.
"""
from __future__ import annotations

import re
from typing import Any

_ALLOWED_TYPES = frozenset({
    "string", "textarea", "number", "select", "multiselect", "date", "boolean",
})

_reject_extra: bool = False  # True로 바꾸면 정의 외 키 거부


def validate_form_data(
    form_schema: dict[str, Any],
    form_data: dict[str, Any],
) -> tuple[bool, list[dict[str, str]]]:
    """form_schema 정의에 따라 form_data를 검증한다.

    Args:
        form_schema: ServiceOffering.form_schema (JSONB dict)
        form_data: 사용자 제출 데이터 (dict)

    Returns:
        (ok, errors)
          ok=True  → errors 빈 리스트
          ok=False → errors에 {"field": id, "message": "..."} 항목 포함
    """
    errors: list[dict[str, str]] = []

    if not isinstance(form_schema, dict):
        errors.append({"field": "_schema", "message": "form_schema가 유효하지 않습니다."})
        return False, errors

    if not isinstance(form_data, dict):
        errors.append({"field": "_form_data", "message": "form_data는 객체여야 합니다."})
        return False, errors

    fields: list[dict] = form_schema.get("fields", [])
    defined_ids: set[str] = set()

    for field in fields:
        fid: str = field.get("id", "")
        if not fid:
            continue  # id 없는 필드 정의는 건너뜀

        defined_ids.add(fid)
        label: str = field.get("label", fid)
        ftype: str = field.get("type", "string")
        required: bool = bool(field.get("required", False))
        options: list | None = field.get("options")
        validate_rules: dict = field.get("validate") or {}

        value = form_data.get(fid)

        # ── required 검사 ────────────────────────────────────────────
        empty = (value is None) or (value == "") or (value == [])
        if required and empty:
            errors.append({"field": fid, "message": f"'{label}' 필드는 필수입니다."})
            continue  # 값이 없으므로 타입 검사 불필요

        # 값이 없고 required 아니면 이후 검사 건너뜀
        if value is None:
            continue

        # ── 타입별 검사 ──────────────────────────────────────────────
        if ftype in ("string", "textarea"):
            if not isinstance(value, str):
                errors.append({
                    "field": fid,
                    "message": f"'{label}' 필드는 문자열이어야 합니다.",
                })
                continue
            # validate.pattern
            pattern: str | None = validate_rules.get("pattern")
            if pattern:
                try:
                    if not re.fullmatch(pattern, value):
                        errors.append({
                            "field": fid,
                            "message": f"'{label}' 필드의 형식이 올바르지 않습니다.",
                        })
                except re.error:
                    pass  # 잘못된 정규식은 무시 (서버 오류 방지)

        elif ftype == "number":
            # bool은 Python에서 int 서브클래스이므로 명시 제외
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                errors.append({
                    "field": fid,
                    "message": f"'{label}' 필드는 숫자여야 합니다.",
                })

        elif ftype == "select":
            if not isinstance(value, str):
                errors.append({
                    "field": fid,
                    "message": f"'{label}' 필드는 문자열이어야 합니다.",
                })
                continue
            # options 는 [{"value":..,"label":..}] dict 리스트 — value 집합으로 비교
            allowed = {o["value"] if isinstance(o, dict) else o for o in (options or [])}
            if options is not None and value not in allowed:
                errors.append({
                    "field": fid,
                    "message": f"'{label}' 필드의 값이 허용된 옵션에 포함되지 않습니다.",
                })

        elif ftype == "multiselect":
            if not isinstance(value, list):
                errors.append({
                    "field": fid,
                    "message": f"'{label}' 필드는 배열이어야 합니다.",
                })
                continue
            if options is not None:
                allowed = {o["value"] if isinstance(o, dict) else o for o in (options or [])}
                invalid = [str(v) for v in value if v not in allowed]
                if invalid:
                    errors.append({
                        "field": fid,
                        "message": (
                            f"'{label}' 필드에 허용되지 않은 값이 포함되어 있습니다: "
                            f"{', '.join(invalid)}"
                        ),
                    })

        elif ftype == "date":
            if not isinstance(value, str):
                errors.append({
                    "field": fid,
                    "message": f"'{label}' 필드는 ISO 날짜 문자열이어야 합니다.",
                })
                continue
            if not re.match(r"^\d{4}-\d{2}-\d{2}", value):
                errors.append({
                    "field": fid,
                    "message": f"'{label}' 필드는 YYYY-MM-DD 형식이어야 합니다.",
                })

        elif ftype == "boolean":
            if not isinstance(value, bool):
                errors.append({
                    "field": fid,
                    "message": f"'{label}' 필드는 true/false여야 합니다.",
                })

        # 알 수 없는 타입(≥ _ALLOWED_TYPES 외) → 무시

    # ── 화이트리스트 외 키 처리 ──────────────────────────────────────
    if _reject_extra:
        for key in set(form_data.keys()) - defined_ids:
            errors.append({"field": key, "message": "정의되지 않은 필드입니다."})

    return len(errors) == 0, errors
