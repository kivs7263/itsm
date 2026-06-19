"""
멀티채널 알림 디스패처 (P3-5).

채널 순서: Kakao → SMS → Slack → Teams (활성화된 채널 모두 발송 시도).
모든 채널 graceful skip — 실패해도 로그만 기록하고 정상 응답.
NotificationLog DB 기록 (별도 try/except — 로그 실패가 주 흐름 방해 금지).

SLACK_WEBHOOK_URL / TEAMS_WEBHOOK_URL 미설정 시 해당 채널 no-op.
KAKAO_API_KEY / SMS_API_KEY 미설정 시 해당 채널 no-op.

P1-4-B: notification-service 통합 인박스 fan-in.
NOTIFICATION_SERVICE_URL / NOTIFICATION_SERVICE_INTERNAL_SECRET 미설정 시 완전 no-op.
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

_INBOX_TIMEOUT = 5.0  # notification-service POST timeout (초)

_HTTPX_TIMEOUT = 10.0


# ---------------------------------------------------------------------------
# 내부 헬퍼 — notification-service 통합 인박스 fan-in (P1-4-B)
# ---------------------------------------------------------------------------


async def _push_to_inbox(
    *,
    kc_user_id: str,
    sso_org_id: str,
    event_namespace: str,
    title: str,
    body: str,
    action_url: str,
    idempotency_key: str,
) -> None:
    """notification-service POST /internal/events (fire-and-forget).

    NOTIFICATION_SERVICE_URL 또는 NOTIFICATION_SERVICE_INTERNAL_SECRET 미설정 시 즉시 return (no-op).
    실패해도 logger.warning 후 삼킴 — 절대 티켓 메인 플로우 차단 금지.
    """
    if not settings.NOTIFICATION_SERVICE_URL or not settings.NOTIFICATION_SERVICE_INTERNAL_SECRET:
        return
    try:
        url = settings.NOTIFICATION_SERVICE_URL.rstrip("/") + "/internal/events"
        payload = {
            "idempotency_key": idempotency_key,
            "source_service": "itsm",
            "event_namespace": event_namespace,
            "tenant_id": sso_org_id,
            "user_id": kc_user_id,
            "title": title,
            "body": body,
            "action_url": action_url,
        }
        async with httpx.AsyncClient(timeout=_INBOX_TIMEOUT) as client:
            resp = await client.post(
                url,
                json=payload,
                headers={"X-Internal-Secret": settings.NOTIFICATION_SERVICE_INTERNAL_SECRET},
            )
        if resp.status_code not in (200, 202):
            logger.warning(
                "notification-service fan-in 실패: status=%s body=%s",
                resp.status_code,
                resp.text[:200],
            )
    except Exception as exc:
        logger.warning("notification-service fan-in 예외 (무시): %s", exc)


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
    # P1-4-B: 통합 인박스 fan-in — 담당자에게 발행
    await _push_inbox_for_assignee(
        db=db,
        ticket=ticket,
        event_namespace="itsm.ticket.assigned",
        title=f"새 티켓이 배정되었습니다: {ticket.title[:60]}",
        body=f"티켓 #{ticket.ticket_number or str(ticket.id)[:8]}이 배정되었습니다.",
        idempotency_suffix="created",
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
    # P1-4-B: 통합 인박스 fan-in — 담당자에게 발행
    try:
        from app.models import Ticket as _Ticket
        ticket = await db.get(_Ticket, ticket_id)
        if ticket:
            await _push_inbox_for_assignee(
                db=db,
                ticket=ticket,
                event_namespace="itsm.ticket.sla_warning",
                title=f"SLA 경고: 티켓 #{getattr(ticket, 'ticket_number', None) or str(ticket_id)[:8]}",
                body="SLA 응답 기한 30분 이내입니다.",
                idempotency_suffix="sla_warning",
            )
    except Exception as exc:
        logger.warning("SLA warning inbox 발행 실패 (무시): %s", exc)


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
    # P1-4-B: 통합 인박스 fan-in — 담당자에게 발행 (별도 DB 세션)
    await _push_inbox_status_changed_by_ticket_id(
        ticket_id=ticket_id,
        title=title,
        old_status=old_status,
        new_status=new_status,
    )


async def notify_sla_breach(
    ticket_id: str,
    title: str,
    tenant_slug: str,
) -> None:
    """SLA breach 시 웹훅 알림 (DB 로그 없는 경량 버전)."""
    text = f"[{tenant_slug}] SLA 초과: 티켓 #{ticket_id} — {title} (응답시간 초과)"
    await _send_webhook_all(text)
    # P1-4-B: 통합 인박스 fan-in — 담당자에게 발행 (별도 DB 세션)
    await _push_inbox_sla_breach_by_ticket_id(ticket_id=ticket_id, title=title)


async def _send_webhook_all(text: str) -> None:
    """Slack + Teams 웹훅 모두 발송 (설정된 채널만)."""
    if settings.SLACK_WEBHOOK_URL:
        await _send_webhook(settings.SLACK_WEBHOOK_URL, text)
    if settings.TEAMS_WEBHOOK_URL:
        await _send_webhook(settings.TEAMS_WEBHOOK_URL, text)


# ---------------------------------------------------------------------------
# P1-4-B 내부 헬퍼 — kc_user_id / sso_org_id 조회 + inbox 발행
# ---------------------------------------------------------------------------


async def _resolve_assignee_inbox_ids(
    db: AsyncSession,
    ticket,
) -> tuple[str | None, str | None]:
    """ticket.assigned_to → (kc_user_id, sso_org_id) 조회.

    어느 하나라도 없으면 (None, None) 반환 → 호출자가 스킵.
    """
    if not ticket.assigned_to:
        return None, None
    try:
        from sqlalchemy import select as _select
        from app.models.user import User as _User
        from app.models.tenant import Tenant as _Tenant

        user = await db.get(_User, ticket.assigned_to)
        if not user or not user.kc_user_id:
            return None, None

        tenant = await db.get(_Tenant, ticket.tenant_id)
        if not tenant or not tenant.sso_org_id:
            return None, None

        return str(user.kc_user_id), str(tenant.sso_org_id)
    except Exception as exc:
        logger.warning("assignee inbox ID 조회 실패 (무시): %s", exc)
        return None, None


async def _push_inbox_for_assignee(
    db: AsyncSession,
    ticket,
    *,
    event_namespace: str,
    title: str,
    body: str,
    idempotency_suffix: str,
) -> None:
    """담당자에게 통합 인박스 발행. kc_user_id/sso_org_id 없으면 스킵."""
    kc_user_id, sso_org_id = await _resolve_assignee_inbox_ids(db, ticket)
    if not kc_user_id or not sso_org_id:
        return
    ticket_number = getattr(ticket, "ticket_number", None) or str(ticket.id)[:8]
    await _push_to_inbox(
        kc_user_id=kc_user_id,
        sso_org_id=sso_org_id,
        event_namespace=event_namespace,
        title=title,
        body=body,
        action_url=f"/tickets/{ticket.id}",
        idempotency_key=f"itsm:{idempotency_suffix}:{ticket.id}:{kc_user_id}",
    )


async def _push_inbox_status_changed_by_ticket_id(
    *,
    ticket_id: str,
    title: str,
    old_status: str,
    new_status: str,
) -> None:
    """상태 변경 fan-in — DB 세션 없는 경량 경로용. 별도 AsyncSessionLocal 오픈."""
    try:
        import uuid as _uuid
        from app.core.database import AsyncSessionLocal
        from app.models import Ticket as _Ticket

        async with AsyncSessionLocal() as db:
            ticket = await db.get(_Ticket, _uuid.UUID(ticket_id))
            if not ticket:
                return
            kc_user_id, sso_org_id = await _resolve_assignee_inbox_ids(db, ticket)
            if not kc_user_id or not sso_org_id:
                return
            await _push_to_inbox(
                kc_user_id=kc_user_id,
                sso_org_id=sso_org_id,
                event_namespace="itsm.ticket.status_changed",
                title=f"티켓 상태 변경: {title[:60]}",
                body=f"상태가 {old_status} → {new_status}(으)로 변경되었습니다.",
                action_url=f"/tickets/{ticket_id}",
                idempotency_key=f"itsm:status_changed:{ticket_id}:{new_status}:{kc_user_id}",
            )
    except Exception as exc:
        logger.warning("상태 변경 inbox 발행 실패 (무시): %s", exc)


async def _push_inbox_sla_breach_by_ticket_id(
    *,
    ticket_id: str,
    title: str,
) -> None:
    """SLA breach fan-in — DB 세션 없는 경량 경로용. 별도 AsyncSessionLocal 오픈."""
    try:
        import uuid as _uuid
        from app.core.database import AsyncSessionLocal
        from app.models import Ticket as _Ticket

        async with AsyncSessionLocal() as db:
            ticket = await db.get(_Ticket, _uuid.UUID(ticket_id))
            if not ticket:
                return
            kc_user_id, sso_org_id = await _resolve_assignee_inbox_ids(db, ticket)
            if not kc_user_id or not sso_org_id:
                return
            await _push_to_inbox(
                kc_user_id=kc_user_id,
                sso_org_id=sso_org_id,
                event_namespace="itsm.ticket.sla_breach",
                title=f"SLA 초과 경고: {title[:60]}",
                body="티켓의 SLA 응답 시간이 초과되었습니다.",
                action_url=f"/tickets/{ticket_id}",
                idempotency_key=f"itsm:sla_breach:{ticket_id}:{kc_user_id}",
            )
    except Exception as exc:
        logger.warning("SLA breach inbox 발행 실패 (무시): %s", exc)


async def push_inbox_sla_with_db(
    db: AsyncSession,
    *,
    ticket,
    event_namespace: str,
    title: str,
    body: str,
    idempotency_suffix: str,
) -> None:
    """SLA worker에서 DB 세션이 있을 때 직접 호출하는 발행 헬퍼.

    _push_inbox_for_assignee 와 동일하지만 외부 호출용으로 export.
    """
    await _push_inbox_for_assignee(
        db=db,
        ticket=ticket,
        event_namespace=event_namespace,
        title=title,
        body=body,
        idempotency_suffix=idempotency_suffix,
    )
