"""
멀티채널 알림 디스패처 (P3-5).

채널 순서: Kakao → SMS → Slack → Teams (활성화된 채널 모두 발송 시도).
모든 채널 graceful skip — 실패해도 로그만 기록하고 정상 응답.
NotificationLog DB 기록 (별도 try/except — 로그 실패가 주 흐름 방해 금지).

SLACK_WEBHOOK_URL / TEAMS_WEBHOOK_URL 미설정 시 해당 채널 no-op.
KAKAO_API_KEY / SMS_API_KEY 미설정 시 해당 채널 no-op.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.notification_log import NotificationLog, NotifChannel, NotifStatus
from app.services.channels.kakao_channel import send_alimtalk
from app.services.channels.sms_channel import send_sms

logger = logging.getLogger(__name__)

_HTTPX_TIMEOUT = 10.0


# ---------------------------------------------------------------------------
# 내부 헬퍼 — DB 로그 기록
# ---------------------------------------------------------------------------


async def _record_log(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    channel: NotifChannel,
    event_type: str,
    recipient: str,
    status: NotifStatus,
    message_summary: str,
    error_msg: str | None = None,
    ticket_id: uuid.UUID | None = None,
) -> None:
    """NotificationLog 생성 + db.add(). flush 없음 — 호출자가 commit."""
    try:
        log = NotificationLog(
            id=uuid.uuid4(),
            tenant_id=tenant_id,
            channel=channel.value,
            event_type=event_type,
            recipient=recipient,
            status=status.value,
            message_summary=message_summary,
            error_msg=error_msg,
            ticket_id=ticket_id,
            created_at=datetime.now(timezone.utc),
        )
        db.add(log)
    except Exception as exc:
        logger.warning("알림 로그 기록 실패 (무시): %s", exc)


# ---------------------------------------------------------------------------
# 메인 디스패처
# ---------------------------------------------------------------------------


async def dispatch(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    event_type: str,
    recipient_phone: str | None,
    ticket_id: uuid.UUID | None,
    message_text: str,
    kakao_template_code: str = "",
    kakao_vars: dict | None = None,
) -> None:
    """모든 활성 채널로 알림 발송. 실패해도 예외 미전파."""
    if not recipient_phone:
        # 전화번호 없으면 카카오/SMS skip, 웹훅은 recipient 대신 'webhook' 으로 기록
        pass

    try:
        # --- Kakao 알림톡 ---
        if settings.KAKAO_API_KEY and settings.KAKAO_SENDER_KEY and recipient_phone:
            ok = await send_alimtalk(
                to=recipient_phone,
                template_code=kakao_template_code,
                variables=kakao_vars or {},
            )
            await _record_log(
                db=db,
                tenant_id=tenant_id,
                channel=NotifChannel.kakao,
                event_type=event_type,
                recipient=recipient_phone,
                status=NotifStatus.sent if ok else NotifStatus.failed,
                message_summary=message_text[:500],
                ticket_id=ticket_id,
            )

        # --- SMS ---
        if settings.SMS_API_KEY and settings.SMS_API_SECRET and recipient_phone:
            ok = await send_sms(to=recipient_phone, text=message_text)
            await _record_log(
                db=db,
                tenant_id=tenant_id,
                channel=NotifChannel.sms,
                event_type=event_type,
                recipient=recipient_phone,
                status=NotifStatus.sent if ok else NotifStatus.failed,
                message_summary=message_text[:500],
                ticket_id=ticket_id,
            )

        # --- Slack ---
        if settings.SLACK_WEBHOOK_URL:
            slack_ok = await _send_webhook(settings.SLACK_WEBHOOK_URL, message_text)
            await _record_log(
                db=db,
                tenant_id=tenant_id,
                channel=NotifChannel.slack,
                event_type=event_type,
                recipient="webhook",
                status=NotifStatus.sent if slack_ok else NotifStatus.failed,
                message_summary=message_text[:500],
                ticket_id=ticket_id,
            )

        # --- Teams ---
        if settings.TEAMS_WEBHOOK_URL:
            teams_ok = await _send_webhook(settings.TEAMS_WEBHOOK_URL, message_text)
            await _record_log(
                db=db,
                tenant_id=tenant_id,
                channel=NotifChannel.teams,
                event_type=event_type,
                recipient="webhook",
                status=NotifStatus.sent if teams_ok else NotifStatus.failed,
                message_summary=message_text[:500],
                ticket_id=ticket_id,
            )

    except Exception as exc:
        logger.warning("dispatch 예외 (무시): %s", exc)


async def _send_webhook(url: str, text: str) -> bool:
    """Slack / Teams 웹훅 POST. 성공 True / 실패 False."""
    try:
        async with httpx.AsyncClient(timeout=_HTTPX_TIMEOUT) as client:
            resp = await client.post(url, json={"text": text})
        if resp.status_code in (200, 202):
            return True
        logger.warning("웹훅 알림 실패: url=%s status=%s body=%s", url[:60], resp.status_code, resp.text[:200])
        return False
    except Exception as exc:
        logger.warning("웹훅 알림 예외: url=%s exc=%s", url[:60], exc)
        return False


# ---------------------------------------------------------------------------
# 이벤트별 공개 API
# ---------------------------------------------------------------------------


async def notify_ticket_created(
    db: AsyncSession,
    ticket,
    assigned_user_phone: str | None,
) -> None:
    """티켓 생성 시 담당자 알림."""
    await dispatch(
        db=db,
        tenant_id=ticket.tenant_id,
        event_type="ticket_created",
        recipient_phone=assigned_user_phone,
        ticket_id=ticket.id,
        message_text=f"[ITSM] New ticket: {ticket.title[:50]}",
        kakao_template_code="ITSM_TICKET_CREATED",
    )


async def notify_ticket_resolved(
    db: AsyncSession,
    ticket,
    customer_phone: str | None,
) -> None:
    """티켓 해결 시 고객 알림."""
    await dispatch(
        db=db,
        tenant_id=ticket.tenant_id,
        event_type="ticket_resolved",
        recipient_phone=customer_phone,
        ticket_id=ticket.id,
        message_text=f"[ITSM] Ticket resolved: {ticket.title[:50]}",
        kakao_template_code="ITSM_TICKET_RESOLVED",
    )


async def notify_sla_breach_warning(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    ticket_id: uuid.UUID,
    admin_phone: str | None,
) -> None:
    """SLA 위반 경고 알림."""
    await dispatch(
        db=db,
        tenant_id=tenant_id,
        event_type="sla_breach_warning",
        recipient_phone=admin_phone,
        ticket_id=ticket_id,
        message_text=f"[ITSM] SLA breach warning: ticket {str(ticket_id)[:8]}",
        kakao_template_code="ITSM_SLA_WARNING",
    )


# ---------------------------------------------------------------------------
# 하위 호환 — 기존 Slack/Teams 전용 함수 (tickets.py 기존 호출 대응)
# ---------------------------------------------------------------------------


async def notify_status_changed(
    ticket_id: str,
    title: str,
    old_status: str,
    new_status: str,
    tenant_slug: str,
) -> None:
    """티켓 상태 변경 시 웹훅 알림 (DB 로그 없는 경량 버전)."""
    text = f"[{tenant_slug}] 티켓 #{ticket_id} 상태 변경: {old_status} → {new_status} — {title}"
    await _send_webhook_all(text)


async def notify_sla_breach(
    ticket_id: str,
    title: str,
    tenant_slug: str,
) -> None:
    """SLA breach 시 웹훅 알림 (DB 로그 없는 경량 버전)."""
    text = f"[{tenant_slug}] SLA 초과: 티켓 #{ticket_id} — {title} (응답시간 초과)"
    await _send_webhook_all(text)


async def _send_webhook_all(text: str) -> None:
    """Slack + Teams 웹훅 모두 발송 (설정된 채널만)."""
    if settings.SLACK_WEBHOOK_URL:
        await _send_webhook(settings.SLACK_WEBHOOK_URL, text)
    if settings.TEAMS_WEBHOOK_URL:
        await _send_webhook(settings.TEAMS_WEBHOOK_URL, text)
