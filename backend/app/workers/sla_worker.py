"""SLA Worker — Redis 분산 lock 기반 SLA breach 감지 및 이벤트 기록.

주기: 60초마다 활성 티켓의 SLA 마감 시간을 검사.
- response_deadline 30분 전: breach_warning 이벤트 발행
- response_deadline 경과: breached 이벤트 발행 (중복 방지: Redis SET NX)
"""
from __future__ import annotations

import asyncio
import logging
import signal
import sys
from datetime import datetime, timedelta, timezone

from sqlalchemy import text

from app.core.config import settings
from app.core.database import AsyncSessionLocal, engine
from app.core.redis import get_redis
from app.services import external_notif_service

logger = logging.getLogger(__name__)

_LOCK_KEY = "itsm:sla_worker:lock"
_LOCK_TTL = 90  # seconds — 1주기 60s + 여유
_running = True


async def _enqueue_sla_notification(session, tenant_id, ticket_id, event_type: str) -> None:
    """티켓 고객에게 SLA 진행 상황 외부 알림 큐 등록."""
    try:
        from sqlalchemy import select as sa_select
        from app.models import Ticket
        from app.services.external_notif_service import queue_notification, resolve_customer_email

        ticket = await session.get(Ticket, ticket_id)
        if not ticket or not ticket.customer_id:
            return

        email, name = await resolve_customer_email(session, ticket)
        if not email:
            return

        await queue_notification(
            session,
            tenant_id=tenant_id,
            ticket_id=ticket_id,
            escalation_id=None,
            channel="email",
            event_type=event_type,
            recipient=email,
            payload={
                "ticket_title": ticket.title,
                "ticket_number": ticket.ticket_number or str(ticket_id)[:8],
                "customer_name": name,
            },
        )
    except Exception:
        logger.warning("SLA 외부 알림 큐 등록 실패 (무시)", exc_info=True)


def _handle_signal(sig: int, _frame) -> None:
    global _running
    logger.info("SLA worker shutting down (signal %s)", sig)
    _running = False


async def _check_sla_once(_engine, redis) -> None:
    """단일 SLA 점검 주기."""
    now = datetime.now(timezone.utc)

    acquired = await redis.set(_LOCK_KEY, "1", nx=True, ex=_LOCK_TTL)
    if not acquired:
        logger.debug("SLA lock held by another worker, skipping")
        return

    try:
        async with AsyncSessionLocal() as session:
            # 활성 티켓 + 계약의 SLA 정책 조인
            rows = await session.execute(
                text("""
                    SELECT
                        t.id                     AS ticket_id,
                        t.tenant_id,
                        t.created_at,
                        t.status,
                        t.sla_response_deadline,
                        t.sla_resolution_deadline,
                        sp.response_minutes,
                        sp.resolution_minutes
                    FROM tickets t
                    JOIN contracts c ON c.id = t.contract_id
                    JOIN sla_policies sp
                        ON sp.tenant_id = t.tenant_id
                        AND sp.grade = c.sla_grade
                    WHERE t.status NOT IN ('resolved', 'closed')
                      AND t.contract_id IS NOT NULL
                """)
            )
            tickets = rows.fetchall()

        async with AsyncSessionLocal() as session:
            for row in tickets:
                ticket_id = row.ticket_id
                created_at = row.created_at
                if created_at.tzinfo is None:
                    created_at = created_at.replace(tzinfo=timezone.utc)

                # DB에 저장된 deadline 우선 사용, 없으면 policy 분으로 계산
                if row.sla_response_deadline:
                    response_deadline = row.sla_response_deadline
                    if response_deadline.tzinfo is None:
                        response_deadline = response_deadline.replace(tzinfo=timezone.utc)
                else:
                    response_deadline = created_at + timedelta(minutes=row.response_minutes)

                if row.sla_resolution_deadline:
                    resolution_deadline = row.sla_resolution_deadline
                    if resolution_deadline.tzinfo is None:
                        resolution_deadline = resolution_deadline.replace(tzinfo=timezone.utc)
                else:
                    resolution_deadline = created_at + timedelta(minutes=row.resolution_minutes)

                # breach_warning: response_deadline 30분 이내 + 아직 경과 안 됨
                if 0 < (response_deadline - now).total_seconds() <= 1800:
                    warn_key = f"itsm:sla:warn:{ticket_id}"
                    if await redis.set(warn_key, "1", nx=True, ex=3600):
                        await session.execute(
                            text("""
                                INSERT INTO sla_events (id, tenant_id, ticket_id, event_type, fired_at)
                                VALUES (gen_random_uuid(), :tid, :tickid, 'breach_warning', now())
                            """),
                            {"tid": str(row.tenant_id), "tickid": str(ticket_id)},
                        )
                        logger.info("SLA breach_warning: ticket=%s", ticket_id)
                        await _enqueue_sla_notification(
                            session, row.tenant_id, ticket_id, "sla_warning"
                        )

                # response breached
                elif now >= response_deadline:
                    breach_key = f"itsm:sla:breach:{ticket_id}"
                    if await redis.set(breach_key, "1", nx=True, ex=86400):
                        await session.execute(
                            text("""
                                INSERT INTO sla_events (id, tenant_id, ticket_id, event_type, fired_at)
                                VALUES (gen_random_uuid(), :tid, :tickid, 'breached', now())
                            """),
                            {"tid": str(row.tenant_id), "tickid": str(ticket_id)},
                        )
                        logger.info("SLA response breached: ticket=%s", ticket_id)
                        await _enqueue_sla_notification(
                            session, row.tenant_id, ticket_id, "sla_warning"
                        )

                # resolution breached (별도 키로 중복 방지)
                if now >= resolution_deadline:
                    res_breach_key = f"itsm:sla:res_breach:{ticket_id}"
                    if await redis.set(res_breach_key, "1", nx=True, ex=86400):
                        await session.execute(
                            text("""
                                INSERT INTO sla_events (id, tenant_id, ticket_id, event_type, fired_at)
                                VALUES (gen_random_uuid(), :tid, :tickid, 'breached', now())
                            """),
                            {"tid": str(row.tenant_id), "tickid": str(ticket_id)},
                        )
                        logger.info("SLA resolution breached: ticket=%s", ticket_id)
                        await _enqueue_sla_notification(
                            session, row.tenant_id, ticket_id, "sla_warning"
                        )

            await session.commit()

    finally:
        await redis.delete(_LOCK_KEY)

    # 외부 알림 대기 큐 처리 (ESC-3c)
    try:
        sent = await external_notif_service.process_pending(redis)
        if sent:
            logger.info("외부 알림 발송: %d건", sent)
    except Exception:
        logger.exception("외부 알림 처리 오류")


async def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    signal.signal(signal.SIGTERM, _handle_signal)
    signal.signal(signal.SIGINT, _handle_signal)

    logger.info("SLA worker starting — interval=60s")

    redis = get_redis()

    try:
        while _running:
            try:
                await _check_sla_once(engine, redis)
            except Exception:
                logger.exception("SLA check error")
            await asyncio.sleep(60)
    finally:
        await engine.dispose()
        await redis.aclose()
        logger.info("SLA worker stopped")


if __name__ == "__main__":
    asyncio.run(main())
