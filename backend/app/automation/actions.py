"""자동화 액션 레지스트리 — Phase 1a 내부 액션 3개.

등록 액션:
- notify_inbox: notification-service 통합 인박스 발행
- change_ticket_status: 티켓 상태 변경 (TicketStatus 허용값만)
- assign_ticket: 티켓 담당자 배정

등록되지 않은 action_type은 실행 거부 (ActionError).
각 액션은 Pydantic 파라미터 검증 후 실행.
액션 부분실패 격리 — 한 액션 실패가 다른 액션/룰 실행을 막지 않음.
"""
from __future__ import annotations

import logging
import uuid
from typing import Any

from pydantic import BaseModel, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)


class ActionError(Exception):
    """액션 실행 실패."""


# ---------------------------------------------------------------------------
# 파라미터 스키마
# ---------------------------------------------------------------------------

_VALID_STATUSES = {"open", "in_progress", "pending", "resolved", "closed"}


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
# 내부 액션 핸들러
# ---------------------------------------------------------------------------


async def _handle_notify_inbox(
    params_raw: dict[str, Any],
    payload: dict[str, Any],
    db: AsyncSession,
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
# 레지스트리
# ---------------------------------------------------------------------------

_REGISTRY: dict[str, Any] = {
    "notify_inbox": _handle_notify_inbox,
    "change_ticket_status": _handle_change_ticket_status,
    "assign_ticket": _handle_assign_ticket,
}


def get_registered_actions() -> list[str]:
    return list(_REGISTRY.keys())


async def execute_action(
    action_type: str,
    params: dict[str, Any],
    payload: dict[str, Any],
    db: AsyncSession,
) -> dict[str, Any]:
    """액션 실행.

    Returns:
        {"status": "ok"|"skipped"|"error", ...}

    Raises:
        ActionError: 등록되지 않은 action_type
    """
    handler = _REGISTRY.get(action_type)
    if handler is None:
        raise ActionError(f"등록되지 않은 action_type: {action_type!r}. 허용: {get_registered_actions()}")

    return await handler(params, payload, db)
