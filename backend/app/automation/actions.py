"""자동화 액션 레지스트리 — Phase 1a 내부 액션 3개 + Phase 1b cross-product 액션 2개.

등록 액션:
- notify_inbox: notification-service 통합 인박스 발행
- change_ticket_status: 티켓 상태 변경 (TicketStatus 허용값만)
- assign_ticket: 티켓 담당자 배정
- create_gw_approval_draft: GW 결재 draft 자동 기안 (WF-4 일반화, Phase 1b)
- create_itsm_ticket: ITSM 후속 티켓 자동 생성 (WF-2 일반화, Phase 1b)

등록되지 않은 action_type은 실행 거부 (ActionError).
각 액션은 Pydantic 파라미터 검증 후 실행.
액션 부분실패 격리 — 한 액션 실패가 다른 액션/룰 실행을 막지 않음.
cross-product 액션은 graceful: 외부 서비스 실패가 룰 실행/티켓 작업을 막지 않음.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel, Field, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)


class ActionError(Exception):
    """액션 실행 실패."""


# ---------------------------------------------------------------------------
# 파라미터 스키마
# ---------------------------------------------------------------------------

_VALID_STATUSES = {"open", "in_progress", "pending", "resolved", "closed"}
_VALID_PRIORITIES = {"low", "medium", "high", "critical"}


class NotifyInboxParams(BaseModel):
    """notify_inbox 파라미터."""
    title: str
    body: str
    # 지정하지 않으면 티켓 담당자에게 발송
    user_id: str | None = None
    # 인박스 이벤트 네임스페이스 (기본값 제공)
    event_namespace: str = "itsm.automation.notify"


class ChangeTicketStatusParams(BaseModel):
    """change_ticket_status 파라미터."""
    status: str

    @field_validator("status")
    @classmethod
    def validate_status(cls, v: str) -> str:
        if v not in _VALID_STATUSES:
            raise ValueError(f"유효하지 않은 상태값: {v!r}. 허용: {_VALID_STATUSES}")
        return v


class AssignTicketParams(BaseModel):
    """assign_ticket 파라미터."""
    # 사용자 UUID 문자열 또는 payload 참조 키 ("{{assignee_id}}" 같은 템플릿은 Phase 2)
    user_id: str

    @field_validator("user_id")
    @classmethod
    def validate_uuid(cls, v: str) -> str:
        try:
            uuid.UUID(v)
        except ValueError as exc:
            raise ValueError(f"user_id는 유효한 UUID여야 합니다: {v!r}") from exc
        return v


# ---------------------------------------------------------------------------
# Phase 1b — cross-product 액션 파라미터 스키마
# ---------------------------------------------------------------------------


class CreateGwApprovalDraftParams(BaseModel):
    """create_gw_approval_draft 파라미터.

    WF-4 일반화: 룰이 GW 결재 draft를 자동 기안한다.
    gw_approval_service.submit_approval_draft()를 재사용하므로 KC 토큰·CSRF
    설정은 기존 WF-4와 동일 경로.
    """
    requester_email: str = Field(..., description="GW 기안자 이메일 (테넌트 소속 계정)")
    title: str = Field(..., max_length=500, description="결재 제목")
    content_text: str = Field(..., description="결재 내용 본문")


class CreateItsmTicketParams(BaseModel):
    """create_itsm_ticket 파라미터.

    WF-2 일반화: 룰이 ITSM 후속 티켓을 자동 생성한다.
    ⚠️ 무한루프 주의: ticket.created 트리거를 재발화하므로 depth+1로 dispatch
    하여 depth >= MAX_DEPTH(3)에서 엔진 차단.
    """
    title: str = Field(..., max_length=500, description="티켓 제목")
    description: str | None = Field(None, description="티켓 설명")
    priority: str = Field("medium", description="우선순위 (low/medium/high/critical)")
    request_type: str | None = Field(None, description="유형 (incident/service_request 등)")
    source: str = Field("automation", description="출처 — 자동화 생성 표시용")

    @field_validator("priority")
    @classmethod
    def validate_priority(cls, v: str) -> str:
        if v not in _VALID_PRIORITIES:
            raise ValueError(f"priority는 {_VALID_PRIORITIES} 중 하나여야 합니다")
        return v


# ---------------------------------------------------------------------------
# 내부 액션 핸들러
# ---------------------------------------------------------------------------


async def _handle_notify_inbox(
    params_raw: dict[str, Any],
    payload: dict[str, Any],
    db: AsyncSession,
    depth: int = 0,  # Phase 1b: depth 전파 시그니처 통일 (이 액션은 사용 안 함)
) -> dict[str, Any]:
    """notification-service 통합 인박스 발행."""
    params = NotifyInboxParams.model_validate(params_raw)
    ticket_id = payload.get("ticket_id")
    if not ticket_id:
        return {"status": "skipped", "reason": "payload에 ticket_id 없음"}

    try:
        from app.models.ticket import Ticket
        from app.services.notification_service import _push_inbox_for_assignee

        ticket = await db.get(Ticket, uuid.UUID(str(ticket_id)))
        if not ticket:
            return {"status": "skipped", "reason": f"ticket {ticket_id} 미발견"}

        await _push_inbox_for_assignee(
            db,
            ticket,
            event_namespace=params.event_namespace,
            title=params.title,
            body=params.body,
            idempotency_suffix=f"automation:{ticket_id}",
        )
        return {"status": "ok"}
    except Exception as exc:
        logger.warning("notify_inbox 실패 (무시): %s", exc)
        return {"status": "error", "error": str(exc)}


async def _handle_change_ticket_status(
    params_raw: dict[str, Any],
    payload: dict[str, Any],
    db: AsyncSession,
    depth: int = 0,  # Phase 1b: depth 전파 시그니처 통일 (이 액션은 사용 안 함)
) -> dict[str, Any]:
    """티켓 상태 직접 변경."""
    params = ChangeTicketStatusParams.model_validate(params_raw)
    ticket_id = payload.get("ticket_id")
    if not ticket_id:
        return {"status": "skipped", "reason": "payload에 ticket_id 없음"}

    try:
        from app.models.ticket import Ticket, TicketStatus

        ticket = await db.get(Ticket, uuid.UUID(str(ticket_id)))
        if not ticket:
            return {"status": "skipped", "reason": f"ticket {ticket_id} 미발견"}

        prev_status = str(ticket.status.value if hasattr(ticket.status, "value") else ticket.status)
        new_status = params.status

        if prev_status == new_status:
            return {"status": "skipped", "reason": f"이미 {new_status} 상태"}

        ticket.status = TicketStatus(new_status)
        # updated_at은 onupdate로 자동 갱신
        await db.flush()
        logger.info("automation change_ticket_status: ticket=%s %s→%s", ticket_id, prev_status, new_status)
        return {"status": "ok", "prev": prev_status, "new": new_status}
    except Exception as exc:
        logger.warning("change_ticket_status 실패: %s", exc)
        raise ActionError(str(exc)) from exc


async def _handle_assign_ticket(
    params_raw: dict[str, Any],
    payload: dict[str, Any],
    db: AsyncSession,
    depth: int = 0,  # Phase 1b: depth 전파 시그니처 통일 (이 액션은 사용 안 함)
) -> dict[str, Any]:
    """티켓 담당자 배정."""
    params = AssignTicketParams.model_validate(params_raw)
    ticket_id = payload.get("ticket_id")
    if not ticket_id:
        return {"status": "skipped", "reason": "payload에 ticket_id 없음"}

    try:
        from sqlalchemy import select
        from app.models.ticket import Ticket
        from app.models.user import User

        ticket = await db.get(Ticket, uuid.UUID(str(ticket_id)))
        if not ticket:
            return {"status": "skipped", "reason": f"ticket {ticket_id} 미발견"}

        user_id = uuid.UUID(params.user_id)
        # 테넌트 소속 사용자인지 검증
        user = await db.scalar(
            select(User).where(User.id == user_id, User.tenant_id == ticket.tenant_id, User.is_active.is_(True))
        )
        if not user:
            return {"status": "error", "error": f"user {params.user_id} 미발견 또는 다른 테넌트"}

        prev_assigned = str(ticket.assigned_to) if ticket.assigned_to else None
        ticket.assigned_to = user_id
        await db.flush()
        logger.info("automation assign_ticket: ticket=%s → user=%s", ticket_id, params.user_id)
        return {"status": "ok", "prev_assigned": prev_assigned, "new_assigned": params.user_id}
    except ActionError:
        raise
    except Exception as exc:
        logger.warning("assign_ticket 실패: %s", exc)
        raise ActionError(str(exc)) from exc


# ---------------------------------------------------------------------------
# Phase 1b — cross-product 액션 헬퍼
# ---------------------------------------------------------------------------


async def _gen_ticket_number_for_action(db: AsyncSession, tenant_id: uuid.UUID) -> str:
    """TKT-YYYYMMDD-NNNN 형식 티켓 번호 자동 생성.

    routers/tickets.py _generate_ticket_number와 동일 로직 —
    순환 임포트(router→action→router) 회피를 위한 로컬 사본.
    pg_advisory_xact_lock으로 (tenant, date) 단위 직렬화 — 동시 생성 중복 방지.
    """
    from sqlalchemy import text

    today = datetime.now(timezone.utc).strftime("%Y%m%d")
    prefix = f"TKT-{today}-"
    lock_key = abs(hash(f"{tenant_id}:{today}")) % (2 ** 31)
    await db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": lock_key})

    result = await db.execute(
        text("""
            SELECT COALESCE(
                MAX(CAST(SUBSTRING(ticket_number FROM :prefix_len + 1) AS INTEGER)),
                0
            )
            FROM tickets
            WHERE tenant_id = :tid
              AND ticket_number LIKE :prefix
        """),
        {"prefix_len": len(prefix), "prefix": f"{prefix}%", "tid": str(tenant_id)},
    )
    max_seq = result.scalar() or 0
    return f"{prefix}{max_seq + 1:04d}"


# ---------------------------------------------------------------------------
# Phase 1b — cross-product 액션 핸들러
# ---------------------------------------------------------------------------


async def _handle_create_gw_approval_draft(
    params_raw: dict[str, Any],
    payload: dict[str, Any],
    db: AsyncSession,
    depth: int = 0,
) -> dict[str, Any]:
    """GW 결재 draft 자동 기안 (WF-4 일반화).

    gw_approval_service.submit_approval_draft()가 이미 graceful(None 반환, 예외 없음)
    이므로 동일 패턴을 그대로 재사용. 주 트랜잭션 외부 HTTP — 실패 시 다른 액션
    /룰 실행을 막지 않음.

    멱등성: 엔진 idempotency_key(trigger_event:entity_id:rule_id 해시)가 동일
    entity+rule 중복 실행을 차단. GW 측 draft 중복은 GW의 책임.

    Args:
        depth: 미사용. cross-product 핸들러 시그니처 통일용.
    """
    try:
        params = CreateGwApprovalDraftParams.model_validate(params_raw)
    except Exception as exc:
        return {"status": "error", "error": f"파라미터 검증 실패: {exc}"}

    try:
        from app.services.gw_approval_service import submit_approval_draft

        result = await submit_approval_draft(
            requester_email=params.requester_email,
            title=params.title,
            content_text=params.content_text,
        )

        if result is None:
            # GW 미설정 또는 HTTP 실패 — graceful
            logger.warning(
                "create_gw_approval_draft: GW 기안 실패 또는 미설정 "
                "(requester=%s, graceful)",
                params.requester_email,
            )
            return {
                "status": "error",
                "error": "GW 연결 실패 또는 미설정 — 결재 draft 미생성 (graceful)",
            }

        draft_id = str(result.get("id", ""))
        logger.info(
            "create_gw_approval_draft: GW 결재 기안 성공 draft_id=%s", draft_id
        )
        return {
            "status": "ok",
            "draft_id": draft_id,
            "draft_status": result.get("status", ""),
        }

    except Exception as exc:
        logger.warning("create_gw_approval_draft 예외 (graceful): %s", exc)
        return {"status": "error", "error": str(exc)}


async def _handle_create_itsm_ticket(
    params_raw: dict[str, Any],
    payload: dict[str, Any],
    db: AsyncSession,
    depth: int = 0,
) -> dict[str, Any]:
    """ITSM 후속 티켓 자동 생성 (WF-2 일반화).

    별도 DB 세션(AsyncSessionLocal)으로 티켓 생성 → 주 세션 오염 없음.
    ticket.created 재발화 시 depth+1 전달 → MAX_DEPTH(3) 도달 시 엔진이 차단.

    무한루프 방지 흐름:
      depth=0 → create_itsm_ticket → dispatch("ticket.created", depth=1)
      depth=1 → create_itsm_ticket → dispatch("ticket.created", depth=2)
      depth=2 → create_itsm_ticket → dispatch("ticket.created", depth=3)
      depth=3 >= MAX_DEPTH → 엔진 차단 (status=skipped, max_depth_exceeded)

    멱등성: 엔진 idempotency_key가 동일 rule+entity 재실행 차단.
    advisory lock: 같은 (tenant, date)에 동시 생성 시 pg_advisory_xact_lock
    직렬화 — commit 후 lock 해제로 중첩 create_itsm_ticket도 잠금 가능.
    """
    try:
        params = CreateItsmTicketParams.model_validate(params_raw)
    except Exception as exc:
        return {"status": "error", "error": f"파라미터 검증 실패: {exc}"}

    tenant_id_raw = payload.get("tenant_id")
    if not tenant_id_raw:
        return {"status": "skipped", "reason": "payload에 tenant_id 없음"}
    try:
        tenant_id = uuid.UUID(str(tenant_id_raw))
    except (ValueError, AttributeError) as exc:
        return {"status": "error", "error": f"tenant_id 파싱 실패: {exc}"}

    new_ticket_id = uuid.uuid4()
    ticket_number: str | None = None

    try:
        from app.core.database import AsyncSessionLocal
        from app.models.ticket import Ticket, TicketChannel, TicketPriority, TicketStatus
        from app.automation.engine import dispatch as engine_dispatch

        async with AsyncSessionLocal() as new_session:
            # 1. 티켓 생성 — advisory lock 획득 후 commit으로 lock 해제
            ticket_number = await _gen_ticket_number_for_action(new_session, tenant_id)
            ticket = Ticket(
                id=new_ticket_id,
                tenant_id=tenant_id,
                title=params.title,
                description=params.description,
                priority=TicketPriority(params.priority),
                status=TicketStatus.open,
                channel=TicketChannel.internal,
                source=params.source,
                request_type=params.request_type,
                ticket_number=ticket_number,
            )
            new_session.add(ticket)
            await new_session.commit()
            # advisory lock 해제됨 — 중첩 create_itsm_ticket도 동일 날짜 lock 획득 가능

            # 2. ticket.created 트리거 발화 (depth+1 — 무한루프 방지 핵심)
            created_payload: dict[str, Any] = {
                "ticket_id": str(new_ticket_id),
                "tenant_id": str(tenant_id),
                "request_type": params.request_type or "",
                "priority": params.priority,
                "_rule_action": True,  # ADR-050 § 2.5 액션 소스 마커
            }
            try:
                await engine_dispatch(
                    "ticket.created",
                    created_payload,
                    new_session,
                    depth=depth + 1,
                )
                await new_session.commit()
            except Exception as exc_dispatch:
                logger.warning(
                    "create_itsm_ticket dispatch commit 실패 (무시): %s", exc_dispatch
                )

        logger.info(
            "automation create_itsm_ticket 완료: ticket_id=%s number=%s "
            "depth=%d→dispatch_depth=%d",
            new_ticket_id,
            ticket_number,
            depth,
            depth + 1,
        )
        return {
            "status": "ok",
            "ticket_id": str(new_ticket_id),
            "ticket_number": ticket_number,
        }

    except Exception as exc:
        logger.warning("create_itsm_ticket 실패 (graceful): %s", exc)
        return {"status": "error", "error": str(exc)}


# ---------------------------------------------------------------------------
# 레지스트리
# ---------------------------------------------------------------------------

_REGISTRY: dict[str, Any] = {
    # Phase 1a — 내부 동기 액션
    "notify_inbox": _handle_notify_inbox,
    "change_ticket_status": _handle_change_ticket_status,
    "assign_ticket": _handle_assign_ticket,
    # Phase 1b — cross-product 비동기 액션 (graceful, fire-and-forget)
    "create_gw_approval_draft": _handle_create_gw_approval_draft,
    "create_itsm_ticket": _handle_create_itsm_ticket,
}


def get_registered_actions() -> list[str]:
    return list(_REGISTRY.keys())


async def execute_action(
    action_type: str,
    params: dict[str, Any],
    payload: dict[str, Any],
    db: AsyncSession,
    depth: int = 0,
) -> dict[str, Any]:
    """액션 실행.

    Args:
        action_type: 등록된 액션 식별자
        params: 액션 파라미터 딕셔너리
        payload: 트리거 페이로드 (tenant_id 등 컨텍스트)
        db: 현재 세션 (cross-product 액션은 내부에서 별도 세션 사용)
        depth: 현재 실행 깊이 — cross-product 액션이 dispatch 재호출 시 depth+1
               전달하여 무한루프를 차단한다 (MAX_DEPTH=3).

    Returns:
        {"status": "ok"|"skipped"|"error", ...}

    Raises:
        ActionError: 등록되지 않은 action_type
    """
    handler = _REGISTRY.get(action_type)
    if handler is None:
        raise ActionError(
            f"등록되지 않은 action_type: {action_type!r}. 허용: {get_registered_actions()}"
        )

    return await handler(params, payload, db, depth)
