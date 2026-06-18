"""ticket_activities 기록 헬퍼.

모든 호출부에서 await activity_service.record(...) 한 줄로 이벤트를 남긴다.
DB commit은 호출부에서 이미 수행하므로 여기서는 add()만 한다.
"""
from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ticket_activity import TicketActivity


async def record(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    ticket_id: uuid.UUID,
    actor_id: uuid.UUID | None,
    event_type: str,
    from_value: str | None = None,
    to_value: str | None = None,
    meta: dict[str, Any] | None = None,
) -> None:
    activity = TicketActivity(
        tenant_id=tenant_id,
        ticket_id=ticket_id,
        actor_id=actor_id,
        event_type=event_type,
        from_value=from_value,
        to_value=to_value,
        meta=meta,
    )
    db.add(activity)
