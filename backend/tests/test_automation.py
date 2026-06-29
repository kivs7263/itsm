"""자동화 룰 엔진 단위 테스트 (Phase 1a).

테스트 항목:
1. 무한루프: depth >= MAX_DEPTH → skipped
2. 멱등성: 동일 idempotency_key → 중복 실행 안 됨
3. 조건 평가: 매칭/미매칭 구분
4. JSONLogic 화이트리스트: 허용/거부 연산자
5. 액션 등록/미등록 구분
"""
from __future__ import annotations

import uuid
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch, call
import pytest

from app.automation.evaluator import (
    EvaluationError,
    evaluate_conditions,
    validate_conditions,
)
from app.automation.actions import ActionError, get_registered_actions


# ---------------------------------------------------------------------------
# 1. 평가기 화이트리스트 테스트
# ---------------------------------------------------------------------------


class TestEvaluatorWhitelist:
    """JSONLogic 연산자 화이트리스트."""

    def test_allowed_eq(self):
        assert evaluate_conditions([{"==": [{"var": "status"}, "resolved"]}], {"status": "resolved"}) is True

    def test_allowed_ne(self):
        assert evaluate_conditions([{"!=": [{"var": "status"}, "open"]}], {"status": "resolved"}) is True

    def test_allowed_lt(self):
        assert evaluate_conditions([{"<": [{"var": "count"}, 10]}], {"count": 5}) is True

    def test_allowed_lte(self):
        assert evaluate_conditions([{"<=": [{"var": "count"}, 5]}], {"count": 5}) is True

    def test_allowed_gt(self):
        assert evaluate_conditions([{">": [{"var": "count"}, 3]}], {"count": 5}) is True

    def test_allowed_gte(self):
        assert evaluate_conditions([{">=": [{"var": "count"}, 5]}], {"count": 5}) is True

    def test_allowed_in(self):
        assert evaluate_conditions(
            [{"in": [{"var": "priority"}, ["high", "critical"]]}],
            {"priority": "high"},
        ) is True

    def test_allowed_and(self):
        cond = [{"and": [{"==": [{"var": "a"}, 1]}, {"==": [{"var": "b"}, 2]}]}]
        assert evaluate_conditions(cond, {"a": 1, "b": 2}) is True

    def test_allowed_or(self):
        cond = [{"or": [{"==": [{"var": "a"}, 1]}, {"==": [{"var": "b"}, 99]}]}]
        assert evaluate_conditions(cond, {"a": 1, "b": 2}) is True

    def test_allowed_not(self):
        cond = [{"!": {"==": [{"var": "status"}, "open"]}}]
        assert evaluate_conditions(cond, {"status": "resolved"}) is True

    def test_forbidden_if(self):
        with pytest.raises(EvaluationError, match="허용되지 않는"):
            evaluate_conditions([{"if": [True, "a", "b"]}], {})

    def test_forbidden_map(self):
        with pytest.raises(EvaluationError, match="허용되지 않는"):
            evaluate_conditions([{"map": [{"var": "items"}, {"*": [{"var": ""}, 2]}]}], {})

    def test_forbidden_cat(self):
        with pytest.raises(EvaluationError, match="허용되지 않는"):
            evaluate_conditions([{"cat": ["a", "b"]}], {})

    def test_forbidden_reduce(self):
        with pytest.raises(EvaluationError, match="허용되지 않는"):
            evaluate_conditions([{"reduce": [[], {"+":[{"var":"accumulator"},{"var":"current"}]}, 0]}], {})

    def test_empty_conditions_always_true(self):
        assert evaluate_conditions([], {"status": "resolved"}) is True

    def test_no_match(self):
        assert evaluate_conditions([{"==": [{"var": "status"}, "open"]}], {"status": "resolved"}) is False

    def test_max_conditions_exceeded(self):
        """조건 항목 10개 초과 → 오류."""
        conditions = [{"==": [{"var": "a"}, 1]}] * 11
        with pytest.raises(EvaluationError, match="최대값"):
            evaluate_conditions(conditions, {"a": 1})

    def test_var_nested_path(self):
        cond = [{"==": [{"var": "ticket.status"}, "resolved"]}]
        assert evaluate_conditions(cond, {"ticket": {"status": "resolved"}}) is True

    def test_var_missing_key_returns_none(self):
        cond = [{"==": [{"var": "missing_key"}, None]}]
        assert evaluate_conditions(cond, {}) is True


# ---------------------------------------------------------------------------
# 2. validate_conditions
# ---------------------------------------------------------------------------


class TestValidateConditions:
    def test_valid_conditions_pass(self):
        validate_conditions([{"==": [{"var": "status"}, "open"]}])  # no exception

    def test_forbidden_operator_raises(self):
        with pytest.raises(EvaluationError):
            validate_conditions([{"log": "debug message"}])

    def test_nested_forbidden_raises(self):
        with pytest.raises(EvaluationError):
            validate_conditions([{"and": [{"map": [[1, 2], {"var": ""}]}]}])


# ---------------------------------------------------------------------------
# 3. 액션 레지스트리
# ---------------------------------------------------------------------------


class TestActionRegistry:
    def test_registered_actions_list(self):
        registered = get_registered_actions()
        assert "notify_inbox" in registered
        assert "change_ticket_status" in registered
        assert "assign_ticket" in registered

    @pytest.mark.asyncio
    async def test_unregistered_action_raises(self):
        from app.automation.actions import execute_action

        mock_db = MagicMock()
        with pytest.raises(ActionError, match="등록되지 않은"):
            await execute_action("create_gw_approval_draft", {}, {}, mock_db)

    @pytest.mark.asyncio
    async def test_change_ticket_status_invalid_value(self):
        """유효하지 않은 상태값 → Pydantic ValidationError → ActionError."""
        from app.automation.actions import execute_action

        mock_db = MagicMock()
        # Pydantic 검증이 ValueError를 raise → execute_action이 그대로 전파
        with pytest.raises(Exception):
            await execute_action(
                "change_ticket_status",
                {"status": "invalid_status_xyz"},
                {"ticket_id": str(uuid.uuid4())},
                mock_db,
            )

    @pytest.mark.asyncio
    async def test_assign_ticket_invalid_uuid(self):
        from app.automation.actions import execute_action

        mock_db = MagicMock()
        with pytest.raises(Exception):
            await execute_action(
                "assign_ticket",
                {"user_id": "not-a-uuid"},
                {"ticket_id": str(uuid.uuid4())},
                mock_db,
            )


# ---------------------------------------------------------------------------
# 4. 엔진 — 무한루프 depth 차단
# ---------------------------------------------------------------------------


class TestEngineDepthGuard:
    @pytest.mark.asyncio
    async def test_depth_max_skipped(self):
        """depth >= MAX_DEPTH(3) → status=skipped, error=max_depth_exceeded."""
        from app.automation.engine import dispatch, MAX_DEPTH
        from app.automation.models import AutomationRule

        # 룰 1개 반환하는 mock
        rule = MagicMock(spec=AutomationRule)
        rule.id = uuid.uuid4()
        rule.tenant_id = uuid.uuid4()
        rule.priority = 0
        rule.run_limit_per_hour = None
        rule.conditions = []
        rule.actions = []

        mock_db = AsyncMock()
        mock_scalars = MagicMock()
        mock_scalars.all.return_value = [rule]
        mock_execute_result = MagicMock()
        mock_execute_result.scalars.return_value = mock_scalars
        mock_db.execute.return_value = mock_execute_result

        with patch("app.automation.engine._record_run", new_callable=AsyncMock) as mock_record:
            mock_record.return_value = MagicMock()
            await dispatch(
                "ticket.status_changed",
                {"ticket_id": str(uuid.uuid4()), "tenant_id": str(rule.tenant_id)},
                mock_db,
                depth=MAX_DEPTH,  # depth=3 → 차단
            )

        # _record_run 호출됐고 status=skipped, error=max_depth_exceeded
        mock_record.assert_called_once()
        _, kwargs = mock_record.call_args
        assert kwargs["status"] == "skipped"
        assert kwargs["error"] == "max_depth_exceeded"


# ---------------------------------------------------------------------------
# 5. 엔진 — 멱등성 중복 실행 차단
# ---------------------------------------------------------------------------


class TestEngineIdempotency:
    def test_idempotency_key_deterministic(self):
        """동일 입력 → 동일 키."""
        from app.automation.engine import _make_idempotency_key

        k1 = _make_idempotency_key("ticket.status_changed", "ticket-123", "rule-abc")
        k2 = _make_idempotency_key("ticket.status_changed", "ticket-123", "rule-abc")
        assert k1 == k2

    def test_idempotency_key_different_rule(self):
        """다른 rule_id → 다른 키."""
        from app.automation.engine import _make_idempotency_key

        k1 = _make_idempotency_key("ticket.status_changed", "ticket-123", "rule-abc")
        k2 = _make_idempotency_key("ticket.status_changed", "ticket-123", "rule-xyz")
        assert k1 != k2

    @pytest.mark.asyncio
    async def test_record_run_integrity_error_returns_none(self):
        """IntegrityError(중복 멱등키) → savepoint 격리 후 None 반환.

        begin_nested() 컨텍스트 내 flush()가 IntegrityError를 발생시키면
        savepoint가 롤백되고 None 반환 (외부 트랜잭션 손상 없음).
        """
        from app.automation.engine import _record_run
        from app.automation.models import AutomationRule
        from sqlalchemy.exc import IntegrityError
        from contextlib import asynccontextmanager

        rule = MagicMock(spec=AutomationRule)
        rule.id = uuid.uuid4()
        rule.tenant_id = uuid.uuid4()

        mock_db = AsyncMock()
        mock_db.add = MagicMock()
        # flush raises IntegrityError (중복 멱등키)
        mock_db.flush = AsyncMock(side_effect=IntegrityError("dup", {}, Exception()))

        # begin_nested()는 async context manager를 반환
        # context manager는 예외를 억제하지 않음 (savepoint rollback 후 전파)
        @asynccontextmanager
        async def _mock_nested():
            yield MagicMock()  # savepoint 객체

        mock_db.begin_nested = MagicMock(return_value=_mock_nested())

        result = await _record_run(
            mock_db,
            rule=rule,
            trigger_event="ticket.status_changed",
            trigger_payload={},
            matched=True,
            depth=0,
            idempotency_key="some-key",
            actions_result=None,
            status="done",
            error=None,
        )
        assert result is None
        # begin_nested()는 호출됨 (savepoint 생성)
        mock_db.begin_nested.assert_called_once()
        # rollback()은 직접 호출되지 않음 (savepoint __aexit__이 처리)
        mock_db.rollback.assert_not_called()


# ---------------------------------------------------------------------------
# 6. 엔진 — 조건 미매칭 시 액션 미실행
# ---------------------------------------------------------------------------


class TestEngineConditionNoMatch:
    @pytest.mark.asyncio
    async def test_condition_not_matched_no_action(self):
        """조건 미매칭 → actions_result=None, status=skipped, matched=False."""
        from app.automation.engine import dispatch
        from app.automation.models import AutomationRule

        rule = MagicMock(spec=AutomationRule)
        rule.id = uuid.uuid4()
        rule.tenant_id = uuid.uuid4()
        rule.priority = 0
        rule.run_limit_per_hour = None
        # status가 "open"이어야 하는데 payload는 "resolved"
        rule.conditions = [{"==": [{"var": "new_status"}, "open"]}]
        rule.actions = [{"type": "notify_inbox", "params": {"title": "테스트", "body": "테스트 바디"}}]

        mock_db = AsyncMock()
        mock_scalars = MagicMock()
        mock_scalars.all.return_value = [rule]
        mock_execute_result = MagicMock()
        mock_execute_result.scalars.return_value = mock_scalars
        mock_db.execute.return_value = mock_execute_result

        with patch("app.automation.engine.execute_action", new_callable=AsyncMock) as mock_exec:
            with patch("app.automation.engine._record_run", new_callable=AsyncMock) as mock_record:
                mock_record.return_value = MagicMock()
                await dispatch(
                    "ticket.status_changed",
                    {
                        "ticket_id": str(uuid.uuid4()),
                        "new_status": "resolved",
                        "tenant_id": str(rule.tenant_id),
                    },
                    mock_db,
                    depth=0,
                )

        # 액션 실행 안 됨
        mock_exec.assert_not_called()
        # _record_run은 호출됨 (matched=False)
        mock_record.assert_called_once()
        _, kwargs = mock_record.call_args
        assert kwargs["matched"] is False
        assert kwargs["status"] == "skipped"
