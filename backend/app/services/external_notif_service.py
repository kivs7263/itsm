"""고객 외부 알림 서비스 (ESC-3).

- 큐잉: queue_notification() — external_notification_logs에 pending row 생성
- 발송: process_pending() — SLA worker 루프에서 주기 호출, Redis 락으로 중복 실행 방지
- 재시도: 지수 백오프 (1차 2분 / 2차 10분 / 3차 30분), 3회 초과 시 failed 확정
- 채널: email 구현 (MVP). kakao/sms는 컬럼·스키마만 선반영, 발송 시 즉시 failed 기록.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import AsyncSessionLocal
from app.models import Customer, CustomerContact, Ticket
from app.models.external_notification_log import (
    ExternalNotificationLog,
    ExtNotifChannel,
    ExtNotifStatus,
)
from app.models.tenant_notification_config import TenantNotificationConfig
from app.services.channels.email_channel import send_email
from app.services.crypto import decrypt_value
from app.services.email_templates import render_email

logger = logging.getLogger(__name__)

_PROCESS_LOCK_KEY = "itsm:ext_notif:lock"
_PROCESS_LOCK_TTL = 60
_BATCH_LIMIT = 20
_MAX_RETRIES = 3
_BACKOFF_MINUTES = [2, 10, 30]
_IDEMPOTENCY_WINDOW_MINUTES = 5


# ---------------------------------------------------------------------------
# 수신자 해석
# ---------------------------------------------------------------------------


async def resolve_customer_email(db: AsyncSession, ticket: Ticket) -> tuple[str | None, str]:
    """티켓의 고객 이메일 + 표시 이름. (primary contact 우선, 없으면 customer.email)."""
    if not ticket.customer_id:
        return None, "고객"

    contact = (
        await db.execute(
            select(CustomerContact)
            .where(
                CustomerContact.customer_id == ticket.customer_id,
                CustomerContact.is_primary.is_(True),
                CustomerContact.email.is_not(None),
            )
            .limit(1)
        )
    ).scalar_one_or_none()
    if contact and contact.email:
        return contact.email, contact.name

    customer = await db.get(Customer, ticket.customer_id)
    if customer and customer.email:
        return customer.email, customer.name

    return None, "고객"


# ---------------------------------------------------------------------------
# 큐잉
# ---------------------------------------------------------------------------


async def queue_notification(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    ticket_id: uuid.UUID | None,
    escalation_id: uuid.UUID | None,
    channel: str,
    event_type: str,
    recipient: str,
    payload: dict,
) -> ExternalNotificationLog:
    """알림 큐 등록. 동일 (ticket_id, event_type, channel) 최근 N분 내 기록 있으면 재사용(중복 방지)."""
    if ticket_id:
        window_start = datetime.now(timezone.utc) - timedelta(minutes=_IDEMPOTENCY_WINDOW_MINUTES)
        existing = (
            await db.execute(
                select(ExternalNotificationLog).where(
                    ExternalNotificationLog.tenant_id == tenant_id,
                    ExternalNotificationLog.ticket_id == ticket_id,
                    ExternalNotificationLog.event_type == event_type,
                    ExternalNotificationLog.channel == channel,
                    ExternalNotificationLog.created_at >= window_start,
                )
                .limit(1)
            )
        ).scalar_one_or_none()
        if existing:
            return existing

    log = ExternalNotificationLog(
        id=uuid.uuid4(),
        tenant_id=tenant_id,
        ticket_id=ticket_id,
        escalation_id=escalation_id,
        channel=channel,
        event_type=event_type,
        recipient=recipient,
        status=ExtNotifStatus.pending.value,
        payload=payload,
    )
    db.add(log)
    await db.flush()
    return log


# ---------------------------------------------------------------------------
# SMTP 설정 조회
# ---------------------------------------------------------------------------


async def _get_smtp_config(db: AsyncSession, tenant_id: uuid.UUID) -> dict | None:
    cfg = (
        await db.execute(
            select(TenantNotificationConfig).where(
                TenantNotificationConfig.tenant_id == tenant_id
            )
        )
    ).scalar_one_or_none()
    if not cfg or not cfg.smtp_host or not cfg.smtp_from_email:
        return None

    password = decrypt_value(cfg.smtp_password_enc) if cfg.smtp_password_enc else None
    return {
        "smtp_host": cfg.smtp_host,
        "smtp_port": cfg.smtp_port or 587,
        "smtp_user": cfg.smtp_user,
        "smtp_password": password,
        "smtp_use_tls": cfg.smtp_use_tls,
        "from_email": cfg.smtp_from_email,
        "from_name": cfg.smtp_from_name,
    }


# ---------------------------------------------------------------------------
# 발송 처리
# ---------------------------------------------------------------------------


async def _dispatch_one(db: AsyncSession, log: ExternalNotificationLog) -> None:
    if log.channel != ExtNotifChannel.email.value:
        # kakao/sms — MVP 미구현 (ESC-B1/B2 예정)
        log.status = ExtNotifStatus.failed.value
        log.error_msg = f"채널 미구현: {log.channel}"
        return

    smtp_cfg = await _get_smtp_config(db, log.tenant_id)
    if not smtp_cfg:
        log.status = ExtNotifStatus.failed.value
        log.error_msg = "SMTP 미설정"
        return

    try:
        subject, html_body = render_email(log.event_type, log.payload or {})
    except ValueError as exc:
        log.status = ExtNotifStatus.failed.value
        log.error_msg = str(exc)
        return

    ok, err = await send_email(
        smtp_host=smtp_cfg["smtp_host"],
        smtp_port=smtp_cfg["smtp_port"],
        smtp_user=smtp_cfg["smtp_user"],
        smtp_password=smtp_cfg["smtp_password"],
        smtp_use_tls=smtp_cfg["smtp_use_tls"],
        from_email=smtp_cfg["from_email"],
        from_name=smtp_cfg["from_name"],
        to=log.recipient,
        subject=subject,
        html_body=html_body,
    )

    if ok:
        log.status = ExtNotifStatus.sent.value
        log.sent_at = datetime.now(timezone.utc)
        log.error_msg = None
        log.next_retry_at = None
    else:
        log.retry_count = (log.retry_count or 0) + 1
        log.error_msg = err
        if log.retry_count > _MAX_RETRIES:
            log.status = ExtNotifStatus.failed.value
            log.next_retry_at = None
        else:
            log.status = ExtNotifStatus.retrying.value
            backoff = _BACKOFF_MINUTES[min(log.retry_count - 1, len(_BACKOFF_MINUTES) - 1)]
            log.next_retry_at = datetime.now(timezone.utc) + timedelta(minutes=backoff)


async def process_pending(redis) -> int:
    """대기 중인 알림을 일괄 발송. SLA worker 루프에서 60초마다 호출.

    반환: 처리한 건수.
    """
    acquired = await redis.set(_PROCESS_LOCK_KEY, "1", nx=True, ex=_PROCESS_LOCK_TTL)
    if not acquired:
        return 0

    processed = 0
    try:
        now = datetime.now(timezone.utc)
        async with AsyncSessionLocal() as db:
            rows = (
                await db.execute(
                    select(ExternalNotificationLog)
                    .where(
                        ExternalNotificationLog.status.in_(
                            [ExtNotifStatus.pending.value, ExtNotifStatus.retrying.value]
                        ),
                    )
                    .where(
                        (ExternalNotificationLog.next_retry_at.is_(None))
                        | (ExternalNotificationLog.next_retry_at <= now)
                    )
                    .order_by(ExternalNotificationLog.created_at)
                    .limit(_BATCH_LIMIT)
                    .with_for_update(skip_locked=True)
                )
            ).scalars().all()

            for log in rows:
                try:
                    await _dispatch_one(db, log)
                    processed += 1
                except Exception:
                    logger.exception("외부 알림 발송 오류: log_id=%s", log.id)
                    log.retry_count = (log.retry_count or 0) + 1
                    log.status = (
                        ExtNotifStatus.failed.value
                        if log.retry_count > _MAX_RETRIES
                        else ExtNotifStatus.retrying.value
                    )

            await db.commit()
    finally:
        await redis.delete(_PROCESS_LOCK_KEY)

    return processed
