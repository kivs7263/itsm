"""알림 로그 라우터.

prefix : /{tenant_slug}/notifications
tags   : ["notifications"]
인증   : get_current_user
격리   : 모든 쿼리 tenant_id == current_user.tenant_id

엔드포인트:
  GET  /{tenant_slug}/notifications                — 알림 로그 목록 (page, page_size, channel 필터)
  GET  /{tenant_slug}/notifications/channel-status — 설정된 채널 목록 반환 (admin/team_lead)
  GET  /{tenant_slug}/notifications/config         — 채널 설정 조회 (admin)
  PUT  /{tenant_slug}/notifications/config         — 채널 설정 저장/업데이트 (admin)

inbox_router (prefix: /notifications — ITSM 자체 인박스 proxy):
  GET   /notifications              — notification-service 통합 인박스 목록
  GET   /notifications/unread-count — 미읽음 수
  PATCH /notifications/{id}/read    — 단건 읽음 처리
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime
from typing import Annotated, Any, Optional

import httpx
from fastapi import APIRouter, Depends, Query, status
from pydantic import BaseModel
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.dependencies import get_current_user, require_roles
from app.models import User, UserRole
from app.models.notification_log import NotificationLog, NotifChannel
from app.models.tenant_notification_config import TenantNotificationConfig

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/{tenant_slug}/notifications",
    tags=["notifications"],
)

# ─── ITSM 통합 인박스 proxy 라우터 (/api/notifications) ────────────────────
inbox_router = APIRouter(
    prefix="/notifications",
    tags=["notifications-inbox-proxy"],
)

_INBOX_TIMEOUT = 5.0  # notification-service 호출 timeout (초)


async def _notif_base_url() -> str | None:
    """notification-service 기본 URL. 미설정 시 None."""
    url = settings.NOTIFICATION_SERVICE_URL
    return url.rstrip("/") if url else None


async def _notif_secret() -> str | None:
    """notification-service 내부 시크릿. 미설정 시 None."""
    return settings.NOTIFICATION_SERVICE_INTERNAL_SECRET


async def _resolve_kc_ids(current_user: User, db: AsyncSession) -> tuple[str | None, str | None]:
    """현재 유저의 (kc_user_id, sso_org_id) 반환. 없으면 (None, None)."""
    try:
        from sqlalchemy import select as _select
        from app.models.tenant import Tenant as _Tenant

        kc_user_id = current_user.kc_user_id
        if not kc_user_id:
            return None, None

        tenant = await db.get(_Tenant, current_user.tenant_id)
        if not tenant or not tenant.sso_org_id:
            return None, None

        return str(kc_user_id), str(tenant.sso_org_id)
    except Exception as exc:
        logger.warning("kc_user_id/sso_org_id 조회 실패 (무시): %s", exc)
        return None, None


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


class NotificationConfigOut(BaseModel):
    slack_webhook_url: str | None
    teams_webhook_url: str | None
    kakao_api_key: str | None
    kakao_sender_key: str | None
    sms_api_key: str | None
    sms_api_secret: str | None
    sms_from_number: str | None
    # SMTP (고객 외부 알림) — 비밀번호는 설정 여부만 반환 (보안)
    smtp_host: str | None = None
    smtp_port: int | None = None
    smtp_user: str | None = None
    smtp_password_configured: bool = False
    smtp_use_tls: bool = True
    smtp_from_email: str | None = None
    smtp_from_name: str | None = None
    kakao_template_ticket_created: str | None = None
    kakao_template_escalated: str | None = None
    kakao_template_resolved: str | None = None

    model_config = {"from_attributes": False}


class NotificationConfigUpdate(BaseModel):
    slack_webhook_url: str | None = None
    teams_webhook_url: str | None = None
    kakao_api_key: str | None = None
    kakao_sender_key: str | None = None
    sms_api_key: str | None = None
    sms_api_secret: str | None = None
    sms_from_number: str | None = None
    smtp_host: str | None = None
    smtp_port: int | None = None
    smtp_user: str | None = None
    smtp_password: str | None = None   # 평문 수신 → 서비스 레이어에서 암호화
    smtp_use_tls: bool | None = None
    smtp_from_email: str | None = None
    smtp_from_name: str | None = None
    kakao_template_ticket_created: str | None = None
    kakao_template_escalated: str | None = None
    kakao_template_resolved: str | None = None


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
    db: AsyncSession = Depends(get_db),
) -> ChannelStatusOut:
    """각 알림 채널의 활성화 여부 반환. DB 설정 우선, 없으면 env var fallback."""
    cfg = await db.scalar(
        select(TenantNotificationConfig).where(
            TenantNotificationConfig.tenant_id == current_user.tenant_id
        )
    )

    if cfg:
        return ChannelStatusOut(
            kakao={"configured": bool(cfg.kakao_api_key and cfg.kakao_sender_key)},
            sms={"configured": bool(cfg.sms_api_key and cfg.sms_api_secret and cfg.sms_from_number)},
            slack={"configured": bool(cfg.slack_webhook_url)},
            teams={"configured": bool(cfg.teams_webhook_url)},
        )

    # DB 설정 없으면 env var fallback
    return ChannelStatusOut(
        kakao={"configured": bool(settings.KAKAO_API_KEY and settings.KAKAO_SENDER_KEY)},
        sms={"configured": bool(settings.SMS_API_KEY and settings.SMS_API_SECRET and settings.SMS_FROM_NUMBER)},
        slack={"configured": bool(settings.SLACK_WEBHOOK_URL)},
        teams={"configured": bool(settings.TEAMS_WEBHOOK_URL)},
    )


# ------------------------------------------------------------------
# GET /config — 채널 설정 조회 (admin)
# ------------------------------------------------------------------


@router.get(
    "/config",
    response_model=NotificationConfigOut,
    summary="채널 설정 조회 (admin)",
)
async def get_notification_config(
    tenant_slug: str,
    current_user: Annotated[User, Depends(require_roles(UserRole.admin))] = None,
    db: AsyncSession = Depends(get_db),
) -> NotificationConfigOut:
    """테넌트 알림 채널 설정 조회. 미설정 시 빈 값 반환."""
    cfg = await db.scalar(
        select(TenantNotificationConfig).where(
            TenantNotificationConfig.tenant_id == current_user.tenant_id
        )
    )
    if cfg is None:
        return NotificationConfigOut(
            slack_webhook_url=None, teams_webhook_url=None,
            kakao_api_key=None, kakao_sender_key=None,
            sms_api_key=None, sms_api_secret=None, sms_from_number=None,
        )
    return NotificationConfigOut(
        slack_webhook_url=cfg.slack_webhook_url,
        teams_webhook_url=cfg.teams_webhook_url,
        kakao_api_key=cfg.kakao_api_key,
        kakao_sender_key=cfg.kakao_sender_key,
        sms_api_key=cfg.sms_api_key,
        sms_api_secret=cfg.sms_api_secret,
        sms_from_number=cfg.sms_from_number,
        smtp_host=cfg.smtp_host,
        smtp_port=cfg.smtp_port,
        smtp_user=cfg.smtp_user,
        smtp_password_configured=bool(cfg.smtp_password_enc),
        smtp_use_tls=cfg.smtp_use_tls if cfg.smtp_use_tls is not None else True,
        smtp_from_email=cfg.smtp_from_email,
        smtp_from_name=cfg.smtp_from_name,
        kakao_template_ticket_created=cfg.kakao_template_ticket_created,
        kakao_template_escalated=cfg.kakao_template_escalated,
        kakao_template_resolved=cfg.kakao_template_resolved,
    )


# ------------------------------------------------------------------
# PUT /config — 채널 설정 저장/업데이트 (admin) — SELECT FOR UPDATE upsert
# ------------------------------------------------------------------


@router.put(
    "/config",
    response_model=NotificationConfigOut,
    summary="채널 설정 저장/업데이트 (admin)",
)
async def upsert_notification_config(
    tenant_slug: str,
    data: NotificationConfigUpdate,
    current_user: Annotated[User, Depends(require_roles(UserRole.admin))] = None,
    db: AsyncSession = Depends(get_db),
) -> NotificationConfigOut:
    """채널 설정 upsert (SELECT FOR UPDATE → 있으면 UPDATE, 없으면 INSERT).

    smtp_password 평문 수신 → AES-256-GCM 암호화 후 smtp_password_enc 저장.
    """
    import uuid as _uuid
    from app.services.crypto import encrypt_value

    cfg = await db.scalar(
        select(TenantNotificationConfig)
        .where(TenantNotificationConfig.tenant_id == current_user.tenant_id)
        .with_for_update()
    )

    # smtp_password는 별도 처리 (암호화), 나머지 필드만 직접 매핑
    raw_password = data.smtp_password
    fields = data.model_dump(exclude_unset=False, exclude={"smtp_password"})

    if cfg is not None:
        for field, value in fields.items():
            if value is not None or field not in {
                "smtp_host", "smtp_user", "smtp_from_email", "smtp_from_name",
            }:
                setattr(cfg, field, value)
        if raw_password is not None:
            cfg.smtp_password_enc = encrypt_value(raw_password)
    else:
        cfg = TenantNotificationConfig(
            id=_uuid.uuid4(),
            tenant_id=current_user.tenant_id,
            **{k: v for k, v in fields.items() if v is not None},
        )
        if raw_password:
            cfg.smtp_password_enc = encrypt_value(raw_password)
        db.add(cfg)

    await db.commit()
    await db.refresh(cfg)
    return NotificationConfigOut(
        slack_webhook_url=cfg.slack_webhook_url,
        teams_webhook_url=cfg.teams_webhook_url,
        kakao_api_key=cfg.kakao_api_key,
        kakao_sender_key=cfg.kakao_sender_key,
        sms_api_key=cfg.sms_api_key,
        sms_api_secret=cfg.sms_api_secret,
        sms_from_number=cfg.sms_from_number,
        smtp_host=cfg.smtp_host,
        smtp_port=cfg.smtp_port,
        smtp_user=cfg.smtp_user,
        smtp_password_configured=bool(cfg.smtp_password_enc),
        smtp_use_tls=cfg.smtp_use_tls if cfg.smtp_use_tls is not None else True,
        smtp_from_email=cfg.smtp_from_email,
        smtp_from_name=cfg.smtp_from_name,
        kakao_template_ticket_created=cfg.kakao_template_ticket_created,
        kakao_template_escalated=cfg.kakao_template_escalated,
        kakao_template_resolved=cfg.kakao_template_resolved,
    )


# ─── 통합 인박스 proxy 엔드포인트 (/api/notifications) ─────────────────────
# ITSM 프론트가 KC JWT 없이 ITSM 쿠키 JWT로 통합 알림을 읽기 위한 proxy.
# notification-service 내부 엔드포인트(X-Internal-Secret)를 호출한다.
# 미설정/kc_user_id 없음/네트워크 오류 → 빈 응답(500 금지).


@inbox_router.get(
    "/unread-count",
    summary="통합 인박스 미읽음 수 (notification-service proxy)",
)
async def inbox_unread_count(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """현재 ITSM 유저의 kc_user_id로 notification-service 내부 API를 proxy 호출한다.

    graceful fallback: URL/시크릿 미설정 또는 kc_user_id 없으면 {"count": 0}.
    httpx 타임아웃 5초, 실패 시 {"count": 0} + logger.warning.
    """
    base_url = await _notif_base_url()
    secret = await _notif_secret()
    if not base_url or not secret:
        return {"count": 0}

    kc_user_id, sso_org_id = await _resolve_kc_ids(current_user, db)
    if not kc_user_id:
        return {"count": 0}

    try:
        params: dict[str, Any] = {"user_id": kc_user_id}
        if sso_org_id:
            params["tenant_id"] = sso_org_id

        async with httpx.AsyncClient(timeout=_INBOX_TIMEOUT) as client:
            resp = await client.get(
                f"{base_url}/internal/notifications/unread-count",
                params=params,
                headers={"X-Internal-Secret": secret},
            )
        if resp.status_code == 200:
            return resp.json()
        logger.warning(
            "notification-service unread-count 호출 실패: status=%s body=%s",
            resp.status_code,
            resp.text[:200],
        )
    except Exception as exc:
        logger.warning("notification-service unread-count 예외 (무시): %s", exc)

    return {"count": 0}


@inbox_router.get(
    "",
    summary="통합 인박스 목록 (notification-service proxy)",
)
async def inbox_list(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    unread_only: bool = Query(False),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[Any]:
    """현재 ITSM 유저의 kc_user_id로 notification-service 내부 API를 proxy 호출한다.

    graceful fallback: URL/시크릿 미설정 또는 kc_user_id 없으면 [].
    httpx 타임아웃 5초, 실패 시 [] + logger.warning.
    """
    base_url = await _notif_base_url()
    secret = await _notif_secret()
    if not base_url or not secret:
        return []

    kc_user_id, sso_org_id = await _resolve_kc_ids(current_user, db)
    if not kc_user_id:
        return []

    try:
        params: dict[str, Any] = {
            "user_id": kc_user_id,
            "limit": limit,
            "offset": offset,
            "unread_only": str(unread_only).lower(),
        }
        if sso_org_id:
            params["tenant_id"] = sso_org_id

        async with httpx.AsyncClient(timeout=_INBOX_TIMEOUT) as client:
            resp = await client.get(
                f"{base_url}/internal/notifications",
                params=params,
                headers={"X-Internal-Secret": secret},
            )
        if resp.status_code == 200:
            return resp.json()
        logger.warning(
            "notification-service list 호출 실패: status=%s body=%s",
            resp.status_code,
            resp.text[:200],
        )
    except Exception as exc:
        logger.warning("notification-service list 예외 (무시): %s", exc)

    return []


@inbox_router.patch(
    "/{notification_id}/read",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="통합 인박스 단건 읽음 처리 (notification-service proxy)",
)
async def inbox_mark_read(
    notification_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """현재 ITSM 유저의 kc_user_id로 notification-service 내부 PATCH를 proxy 호출한다.

    graceful fallback: URL/시크릿 미설정 또는 kc_user_id 없으면 204 반환(no-op).
    httpx 타임아웃 5초, 실패 시 204 + logger.warning (500 금지).
    """
    base_url = await _notif_base_url()
    secret = await _notif_secret()
    if not base_url or not secret:
        return

    kc_user_id, sso_org_id = await _resolve_kc_ids(current_user, db)
    if not kc_user_id:
        return

    try:
        async with httpx.AsyncClient(timeout=_INBOX_TIMEOUT) as client:
            resp = await client.patch(
                f"{base_url}/internal/notifications/{notification_id}/read",
                params={"user_id": kc_user_id},
                headers={"X-Internal-Secret": secret},
            )
        if resp.status_code not in (204, 200, 404):
            logger.warning(
                "notification-service mark-read 호출 실패: status=%s body=%s",
                resp.status_code,
                resp.text[:200],
            )
    except Exception as exc:
        logger.warning("notification-service mark-read 예외 (무시): %s", exc)
