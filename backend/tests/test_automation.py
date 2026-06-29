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
        """Phase 1a·1b 전체 액션 등록 확인."""
        registered = get_registered_actions()
        # Phase 1a 내부 액션
        assert "notify_inbox" in registered
        assert "change_ticket_status" in registered
        assert "assign_ticket" in registered
        # Phase 1b cross-product 액션
        assert "create_gw_approval_draft" in registered
        assert "create_itsm_ticket" in registered

    @pytest.mark.asyncio
    async def test_unregistered_action_raises(self):
        """미등록 action_type → ActionError."""
        from app.automation.actions import execute_action

        mock_db = MagicMock()
        with pytest.raises(ActionError, match="등록되지 않은"):
            # send_webhook은 Phase 3 예정 — 아직 미등록
            await execute_action("send_webhook", {}, {}, mock_db)

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


# ---------------------------------------------------------------------------
# 7. Phase 1b — create_gw_approval_draft 액션 테스트
# ---------------------------------------------------------------------------


class TestCreateGwApprovalDraft:
    """create_gw_approval_draft 액션: graceful 실패 격리 + 성공 경로."""

    @pytest.mark.asyncio
    async def test_gw_returns_none_is_graceful_error(self):
        """submit_approval_draft() None 반환 → error status, 예외 미전파."""
        from app.automation.actions import execute_action

        mock_db = MagicMock()

        with patch(
            "app.services.gw_approval_service.submit_approval_draft",
            new_callable=AsyncMock,
            return_value=None,
        ):
            result = await execute_action(
                "create_gw_approval_draft",
                {
                    "requester_email": "engineer@example.com",
                    "title": "SLA 초과 승인 요청",
                    "content_text": "SLA가 초과됐습니다. 에스컬레이션 결재 요청.",
                },
                {"ticket_id": str(uuid.uuid4()), "tenant_id": str(uuid.uuid4())},
                mock_db,
            )

        # None 반환 → error (graceful — 예외 아님)
        assert result["status"] == "error"
        assert "graceful" in result.get("error", "")

    @pytest.mark.asyncio
    async def test_gw_exception_is_graceful_error(self):
        """submit_approval_draft() 예외 발생 → error status, 예외 미전파."""
        from app.automation.actions import execute_action

        mock_db = MagicMock()

        with patch(
            "app.services.gw_approval_service.submit_approval_draft",
            new_callable=AsyncMock,
            side_effect=Exception("GW 연결 타임아웃"),
        ):
            result = await execute_action(
                "create_gw_approval_draft",
                {
                    "requester_email": "engineer@example.com",
                    "title": "테스트 결재",
                    "content_text": "내용",
                },
                {"ticket_id": str(uuid.uuid4()), "tenant_id": str(uuid.uuid4())},
                mock_db,
            )

        # 예외도 graceful error — ActionError로 re-raise 금지
        assert result["status"] == "error"
        assert "GW 연결 타임아웃" in result.get("error", "")

    @pytest.mark.asyncio
    async def test_gw_success_returns_ok_with_draft_id(self):
        """submit_approval_draft() 성공 → ok status + draft_id."""
        from app.automation.actions import execute_action

        mock_db = MagicMock()
        draft_id = str(uuid.uuid4())

        with patch(
            "app.services.gw_approval_service.submit_approval_draft",
            new_callable=AsyncMock,
            return_value={"id": draft_id, "status": "pending", "title": "테스트"},
        ):
            result = await execute_action(
                "create_gw_approval_draft",
                {
                    "requester_email": "manager@example.com",
                    "title": "SLA 에스컬레이션 결재",
                    "content_text": "티켓 #123 SLA 초과",
                },
                {"ticket_id": str(uuid.uuid4()), "tenant_id": str(uuid.uuid4())},
                mock_db,
            )

        assert result["status"] == "ok"
        assert result["draft_id"] == draft_id
        assert result["draft_status"] == "pending"

    @pytest.mark.asyncio
    async def test_invalid_params_returns_error(self):
        """필수 파라미터 누락 → error status, 예외 미전파."""
        from app.automation.actions import execute_action

        mock_db = MagicMock()

        # requester_email 없음
        result = await execute_action(
            "create_gw_approval_draft",
            {"title": "제목만 있음"},  # requester_email, content_text 누락
            {"tenant_id": str(uuid.uuid4())},
            mock_db,
        )
        assert result["status"] == "error"
        assert "파라미터 검증 실패" in result.get("error", "")


# ---------------------------------------------------------------------------
# 8. Phase 1b — create_itsm_ticket 액션 테스트
# ---------------------------------------------------------------------------


class TestCreateItsmTicket:
    """create_itsm_ticket 액션: graceful 실패 격리 + depth 전파 + 루프 차단."""

    @pytest.mark.asyncio
    async def test_missing_tenant_id_is_skipped(self):
        """payload에 tenant_id 없음 → skipped (error 아님)."""
        from app.automation.actions import execute_action

        mock_db = MagicMock()

        result = await execute_action(
            "create_itsm_ticket",
            {"title": "후속 티켓"},
            {},  # tenant_id 없음
            mock_db,
        )
        assert result["status"] == "skipped"

    @pytest.mark.asyncio
    async def test_invalid_priority_returns_error(self):
        """허용되지 않는 priority → error status, 예외 미전파."""
        from app.automation.actions import execute_action

        mock_db = MagicMock()

        result = await execute_action(
            "create_itsm_ticket",
            {"title": "티켓", "priority": "ultra_critical"},  # 미허용값
            {"tenant_id": str(uuid.uuid4())},
            mock_db,
        )
        assert result["status"] == "error"
        assert "파라미터 검증 실패" in result.get("error", "")

    @pytest.mark.asyncio
    async def test_db_failure_is_graceful_error(self):
        """DB 생성 실패(AsyncSessionLocal 예외) → error status, 예외 미전파."""
        from app.automation.actions import execute_action

        mock_db = MagicMock()

        # commit이 예외를 던지는 mock 세션
        mock_session = AsyncMock()
        mock_session.add = MagicMock()
        mock_session.commit = AsyncMock(side_effect=Exception("DB 연결 오류"))

        # ticket number 생성용 execute mock
        exec_result = MagicMock()
        exec_result.scalar = MagicMock(return_value=0)
        mock_session.execute = AsyncMock(return_value=exec_result)

        mock_cm = MagicMock()
        mock_cm.__aenter__ = AsyncMock(return_value=mock_session)
        mock_cm.__aexit__ = AsyncMock(return_value=False)

        with patch("app.core.database.AsyncSessionLocal", return_value=mock_cm), \
             patch("app.models.ticket.Ticket", return_value=MagicMock()), \
             patch("app.models.ticket.TicketPriority", side_effect=lambda x: x), \
             patch("app.models.ticket.TicketStatus"), \
             patch("app.models.ticket.TicketChannel"):

            result = await execute_action(
                "create_itsm_ticket",
                {"title": "후속 티켓"},
                {"tenant_id": str(uuid.uuid4())},
                mock_db,
            )

        # graceful — ActionError로 re-raise 금지
        assert result["status"] == "error"
        assert "DB 연결 오류" in result.get("error", "")

    @pytest.mark.asyncio
    async def test_depth_propagated_to_dispatch(self):
        """create_itsm_ticket이 dispatch에 depth+1을 전달함 (무한루프 방지 핵심).

        depth=1로 액션 실행 → engine.dispatch가 depth=2로 호출돼야 한다.
        """
        from app.automation.actions import _handle_create_itsm_ticket

        mock_db = MagicMock()
        tenant_id = str(uuid.uuid4())
        captured_depths: list[int] = []

        async def fake_dispatch(event: str, payload: dict, db: Any, depth: int = 0) -> None:
            captured_depths.append(depth)

        mock_session = AsyncMock()
        mock_session.commit = AsyncMock()
        mock_session.add = MagicMock()
        exec_result = MagicMock()
        exec_result.scalar = MagicMock(return_value=3)  # max_seq=3
        mock_session.execute = AsyncMock(return_value=exec_result)

        mock_cm = MagicMock()
        mock_cm.__aenter__ = AsyncMock(return_value=mock_session)
        mock_cm.__aexit__ = AsyncMock(return_value=False)

        with patch(
            "app.automation.actions._gen_ticket_number_for_action",
            new_callable=AsyncMock,
            return_value="TKT-20260630-0004",
        ), \
        patch("app.automation.engine.dispatch", side_effect=fake_dispatch), \
        patch("app.core.database.AsyncSessionLocal", return_value=mock_cm), \
        patch("app.models.ticket.Ticket", return_value=MagicMock()), \
        patch("app.models.ticket.TicketPriority", side_effect=lambda x: x), \
        patch("app.models.ticket.TicketStatus", MagicMock(open=MagicMock())), \
        patch("app.models.ticket.TicketChannel", MagicMock(internal=MagicMock())):

            result = await _handle_create_itsm_ticket(
                {"title": "depth 전파 테스트"},
                {"tenant_id": tenant_id},
                mock_db,
                depth=1,  # 현재 실행 depth=1 → dispatch는 depth=2
            )

        assert len(captured_depths) == 1, "dispatch가 1회 호출돼야 함"
        assert captured_depths[0] == 2, (
            f"depth 2 예상 (1+1), 실제: {captured_depths[0]}"
        )

    @pytest.mark.asyncio
    async def test_infinite_loop_blocked_at_max_depth(self):
        """create_itsm_ticket이 depth=MAX_DEPTH-1로 실행 → dispatch를 MAX_DEPTH로 호출.

        engine.dispatch는 depth >= MAX_DEPTH 시 status=skipped 처리
        (test_depth_max_skipped 에서 독립 검증됨).
        이 테스트는 두 계층의 결합(create_itsm_ticket → dispatch)을 검증한다.
        """
        from app.automation.actions import _handle_create_itsm_ticket
        from app.automation.engine import MAX_DEPTH

        mock_db = MagicMock()
        tenant_id = str(uuid.uuid4())
        captured_depths: list[int] = []

        async def fake_dispatch(event: str, payload: dict, db: Any, depth: int = 0) -> None:
            captured_depths.append(depth)

        mock_session = AsyncMock()
        mock_session.commit = AsyncMock()
        mock_session.add = MagicMock()

        mock_cm = MagicMock()
        mock_cm.__aenter__ = AsyncMock(return_value=mock_session)
        mock_cm.__aexit__ = AsyncMock(return_value=False)

        with patch(
            "app.automation.actions._gen_ticket_number_for_action",
            new_callable=AsyncMock,
            return_value="TKT-20260630-0001",
        ), \
        patch("app.automation.engine.dispatch", side_effect=fake_dispatch), \
        patch("app.core.database.AsyncSessionLocal", return_value=mock_cm), \
        patch("app.models.ticket.Ticket", return_value=MagicMock()), \
        patch("app.models.ticket.TicketPriority", side_effect=lambda x: x), \
        patch("app.models.ticket.TicketStatus", MagicMock(open=MagicMock())), \
        patch("app.models.ticket.TicketChannel", MagicMock(internal=MagicMock())):

            await _handle_create_itsm_ticket(
                {"title": "루프 차단 테스트"},
                {"tenant_id": tenant_id},
                mock_db,
                depth=MAX_DEPTH - 1,  # 마지막 허용 깊이
            )

        # dispatch가 MAX_DEPTH(=3)로 호출됨
        # → engine 내 depth >= MAX_DEPTH 가드가 skipped 처리 (루프 차단)
        assert len(captured_depths) == 1
        assert captured_depths[0] == MAX_DEPTH, (
            f"dispatch는 MAX_DEPTH({MAX_DEPTH})로 호출돼야 함, 실제: {captured_depths[0]}"
        )
