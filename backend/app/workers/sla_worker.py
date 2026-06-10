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

logger = logging.getLogger(__name__)

_LOCK_KEY = "itsm:sla_worker:lock"
_LOCK_TTL = 90  # seconds — 1주기 60s + 여유
_running = True


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
                        t.id              AS ticket_id,
                        t.tenant_id,
                        t.created_at,
                        t.status,
                        sp.response_minutes,
                        sp.resolution_minutes
                    FROM tickets t
                    JOIN contracts c ON c.id = t.contract_id
                    JOIN sla_policies sp
                        ON sp.tenant_id = t.tenant_id
                        AND sp.grade = c.sla_grade::sla_grade_enum
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

                response_deadline = created_at + timedelta(minutes=row.response_minutes)

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

                # breached: response_deadline 경과
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
                        logger.info("SLA breached: ticket=%s", ticket_id)

            await session.commit()

    finally:
        await redis.delete(_LOCK_KEY)


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
