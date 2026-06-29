"""JSONLogic 조건 평가기 — 화이트리스트 자체구현.

json-logic-python 패키지 미사용: 컨테이너에 미설치. 화이트리스트 연산자만 재귀 평가.

허용 연산자: ==, !=, <, <=, >, >=, and, or, !, in, var
금지: if, merge, cat, substr, log, map, filter, reduce (코드 실행/순회 가능 연산자)

최대 중첩 깊이: MAX_EVAL_DEPTH = 10
최대 조건 항목 수: MAX_CONDITIONS = 10
"""
from __future__ import annotations

from typing import Any

MAX_EVAL_DEPTH = 10
MAX_CONDITIONS = 10

ALLOWED_OPERATORS = frozenset(
    {"==", "!=", "<", "<=", ">", ">=", "and", "or", "!", "in", "var", "missing"}
)


class EvaluationError(Exception):
    """허용되지 않는 연산자 또는 구조 오류."""


def _get_var(data: dict[str, Any], path: str, default: Any = None) -> Any:
    """점(.) 구분 경로로 중첩 딕셔너리에서 값 추출."""
    parts = path.split(".")
    cur: Any = data
    for part in parts:
        if isinstance(cur, dict):
            cur = cur.get(part, default)
        else:
            return default
    return cur


def _evaluate(logic: Any, data: dict[str, Any], depth: int = 0) -> Any:
    """JSONLogic 표현식 재귀 평가.

    Raises:
        EvaluationError: 허용되지 않는 연산자 또는 깊이 초과
    """
    if depth > MAX_EVAL_DEPTH:
        raise EvaluationError("조건 중첩 깊이가 최대값을 초과했습니다.")

    # 원시값 (bool, int, float, str, None)
    if not isinstance(logic, dict):
        return logic

    if len(logic) != 1:
        raise EvaluationError(f"JSONLogic 객체는 정확히 1개의 연산자 키를 가져야 합니다: {list(logic.keys())}")

    operator, args = next(iter(logic.items()))

    if operator not in ALLOWED_OPERATORS:
        raise EvaluationError(f"허용되지 않는 JSONLogic 연산자: '{operator}'")

    # var: 데이터에서 값 참조
    if operator == "var":
        if isinstance(args, str):
            return _get_var(data, args)
        if isinstance(args, list) and len(args) >= 1:
            default = args[1] if len(args) >= 2 else None
            return _get_var(data, str(args[0]), default)
        return None

    # missing: 누락 키 목록
    if operator == "missing":
        if isinstance(args, str):
            args = [args]
        return [k for k in args if _get_var(data, str(k)) is None]

    # 논리 연산자
    if operator == "!":
        val = args if not isinstance(args, list) else (args[0] if args else None)
        return not _evaluate(val, data, depth + 1)

    if operator == "and":
        if not isinstance(args, list):
            return bool(_evaluate(args, data, depth + 1))
        result: Any = True
        for item in args:
            result = _evaluate(item, data, depth + 1)
            if not result:
                return result
        return result

    if operator == "or":
        if not isinstance(args, list):
            return _evaluate(args, data, depth + 1)
        for item in args:
            result = _evaluate(item, data, depth + 1)
            if result:
                return result
        return False

    # 비교 / in 연산자 (인수 2개)
    if not isinstance(args, list) or len(args) != 2:
        raise EvaluationError(f"연산자 '{operator}'는 정확히 2개의 인수가 필요합니다.")

    left = _evaluate(args[0], data, depth + 1)
    right = _evaluate(args[1], data, depth + 1)

    try:
        if operator == "==":
            return left == right
        if operator == "!=":
            return left != right
        if operator == "<":
            return left < right  # type: ignore[operator]
        if operator == "<=":
            return left <= right  # type: ignore[operator]
        if operator == ">":
            return left > right  # type: ignore[operator]
        if operator == ">=":
            return left >= right  # type: ignore[operator]
        if operator == "in":
            return left in right  # type: ignore[operator]
    except TypeError as exc:
        raise EvaluationError(f"비교 타입 오류 ({operator}): {exc}") from exc

    raise EvaluationError(f"처리되지 않은 연산자: '{operator}'")


def evaluate_conditions(conditions: list[Any], payload: dict[str, Any]) -> bool:
    """conditions 배열 전체 평가 (묵시적 AND).

    Args:
        conditions: JSONLogic 표현식 배열. 빈 배열 = True(무조건 실행).
        payload: 트리거 페이로드 딕셔너리.

    Returns:
        모든 조건이 True이면 True.

    Raises:
        EvaluationError: 허용되지 않는 연산자 / 구조 오류 / 깊이 초과
    """
    if not conditions:
        return True

    if len(conditions) > MAX_CONDITIONS:
        raise EvaluationError(f"조건 항목 수가 최대값({MAX_CONDITIONS})을 초과했습니다.")

    for condition in conditions:
        result = _evaluate(condition, payload, depth=0)
        if not result:
            return False
    return True


def validate_conditions(conditions: list[Any]) -> None:
    """조건 배열 구조 검증 (실제 데이터 없이 연산자 화이트리스트만).

    빈 payload로 평가 시 var가 None을 반환해 비교 실패할 수 있으므로
    여기서는 연산자 추출/검증만 수행한다.

    Raises:
        EvaluationError: 허용되지 않는 연산자 포함
    """
    if len(conditions) > MAX_CONDITIONS:
        raise EvaluationError(f"조건 항목 수 초과: {len(conditions)} > {MAX_CONDITIONS}")

    def _collect_ops(node: Any, depth: int = 0) -> None:
        if depth > MAX_EVAL_DEPTH:
            raise EvaluationError("조건 중첩 깊이 초과")
        if not isinstance(node, dict):
            return
        if len(node) != 1:
            raise EvaluationError(f"JSONLogic 객체 키 수 오류: {list(node.keys())}")
        op, args = next(iter(node.items()))
        if op not in ALLOWED_OPERATORS:
            raise EvaluationError(f"허용되지 않는 연산자: '{op}'")
        if isinstance(args, list):
            for item in args:
                _collect_ops(item, depth + 1)
        elif isinstance(args, dict):
            _collect_ops(args, depth + 1)

    for cond in conditions:
        _collect_ops(cond)
