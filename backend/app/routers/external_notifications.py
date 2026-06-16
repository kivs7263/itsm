"""외부 알림 발송 이력 라우터 (고객 발송 기록 — ESC-3e).

prefix : /{tenant_slug}/notifications/external
tags   : ["external-notifications"]
인증   : get_current_user
격리   : tenant_id == current_user.tenant_id

엔드포인트:
  GET  /{tenant_slug}/notifications/external          — 이력 목록 (페이지네이션, 필터)
  GET  /{tenant_slug}/notifications/external/{log_id} — 단건 조회
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models import User
from app.models.external_notification_log import ExternalNotificationLog

router = APIRouter(
    prefix="/{tenant_slug}/notifications/external",
    tags=["external-notifications"],
)


class ExtNotifLogOut(BaseModel):
    id: uuid.UUID
    ticket_id: uuid.UUID | None
    escalation_id: uuid.UUID | None
    channel: str
    event_type: str
    recipient: str
    status: str
    error_msg: str | None
    retry_count: int
    next_retry_at: datetime | None
    sent_at: datetime | None
    created_at: datetime

    model_config = {"from_attributes": True}


@router.get("", response_model=dict, summary="고객 외부 알림 발송 이력")
async def list_external_notifications(
    tenant_slug: str,
    ticket_id: uuid.UUID | None = Query(None),
    channel: str | None = Query(None),
    status: str | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> dict:
    conditions = [ExternalNotificationLog.tenant_id == current_user.tenant_id]
    if ticket_id:
        conditions.append(ExternalNotificationLog.ticket_id == ticket_id)
    if channel:
        conditions.append(ExternalNotificationLog.channel == channel)
    if status:
        conditions.append(ExternalNotificationLog.status == status)

    where_clause = and_(*conditions)
    total = await db.scalar(
        select(func.count()).select_from(ExternalNotificationLog).where(where_clause)
    )
    rows = (
        await db.execute(
            select(ExternalNotificationLog)
            .where(where_clause)
            .order_by(ExternalNotificationLog.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    ).scalars().all()

    return {
        "items": [ExtNotifLogOut.model_validate(r) for r in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.get("/{log_id}", response_model=ExtNotifLogOut, summary="외부 알림 단건 조회")
async def get_external_notification(
    tenant_slug: str,
    log_id: uuid.UUID,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> ExtNotifLogOut:
    from fastapi import HTTPException
    log = await db.get(ExternalNotificationLog, log_id)
    if not log or log.tenant_id != current_user.tenant_id:
        raise HTTPException(status_code=404, detail="알림 기록을 찾을 수 없습니다.")
    return ExtNotifLogOut.model_validate(log)
