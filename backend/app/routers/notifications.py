"""알림 로그 라우터.

prefix : /{tenant_slug}/notifications
tags   : ["notifications"]
인증   : get_current_user
격리   : 모든 쿼리 tenant_id == current_user.tenant_id

엔드포인트:
  GET  /{tenant_slug}/notifications                — 알림 로그 목록 (page, page_size, channel 필터)
  GET  /{tenant_slug}/notifications/channel-status — 설정된 채널 목록 반환 (admin/team_lead)
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from pydantic import BaseModel
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.dependencies import get_current_user, require_roles
from app.models import User, UserRole
from app.models.notification_log import NotificationLog, NotifChannel

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/{tenant_slug}/notifications",
    tags=["notifications"],
)


# ------------------------------------------------------------------
# 스키마
# ------------------------------------------------------------------


class NotificationLogOut(BaseModel):
    id: uuid.UUID
    channel: str
    event_type: str
    recipient: str
    status: str
    message_summary: str | None
    error_msg: str | None
    ticket_id: uuid.UUID | None
    created_at: datetime

    model_config = {"from_attributes": True}


class ChannelStatusOut(BaseModel):
    kakao: dict
    sms: dict
    slack: dict
    teams: dict


# ------------------------------------------------------------------
# GET / — 알림 로그 목록
# ------------------------------------------------------------------


@router.get(
    "",
    response_model=dict,
    summary="알림 로그 목록",
)
async def list_notification_logs(
    tenant_slug: str,
    channel: NotifChannel | None = Query(None, description="채널 필터 (kakao/sms/slack/teams)"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """최근 알림 로그 조회 (tenant 격리, created_at DESC)."""
    conditions = [NotificationLog.tenant_id == current_user.tenant_id]

    if channel is not None:
        conditions.append(NotificationLog.channel == channel.value)

    where_clause = and_(*conditions)

    total = await db.scalar(
        select(func.count()).select_from(NotificationLog).where(where_clause)
    )
    rows = (
        await db.execute(
            select(NotificationLog)
            .where(where_clause)
            .order_by(NotificationLog.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    ).scalars().all()

    return {
        "items": [NotificationLogOut.model_validate(r) for r in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


# ------------------------------------------------------------------
# GET /channel-status — 채널 설정 상태 (admin/team_lead)
# ------------------------------------------------------------------


@router.get(
    "/channel-status",
    response_model=ChannelStatusOut,
    summary="채널 설정 상태 조회 (admin/team_lead)",
)
async def get_channel_status(
    tenant_slug: str,
    current_user: Annotated[
        User, Depends(require_roles(UserRole.admin, UserRole.team_lead))
    ] = None,
) -> ChannelStatusOut:
    """각 알림 채널의 활성화 여부 반환."""
    return ChannelStatusOut(
        kakao={"configured": bool(settings.KAKAO_API_KEY and settings.KAKAO_SENDER_KEY)},
        sms={"configured": bool(settings.SMS_API_KEY and settings.SMS_API_SECRET and settings.SMS_FROM_NUMBER)},
        slack={"configured": bool(settings.SLACK_WEBHOOK_URL)},
        teams={"configured": bool(settings.TEAMS_WEBHOOK_URL)},
    )
