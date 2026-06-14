"""반복 장애 감지 워커 — Redis 분산 lock 기반.

주기: 10분(600초)마다 지난 30일 incident 티켓을 집계해서
(tenant_id, customer_id, symptom_category_id) 조합이 3건 이상이면
RecurringAlert를 생성하고 해당 티켓에 is_recurring_flag=True를 표시한다.

중복 방지: 동일 그룹에 is_acknowledged=False인 RecurringAlert가 이미 있으면 skip.
"""
from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy import and_, select, text, update

from app.core.database import AsyncSessionLocal
from app.core.redis import get_redis
from app.models.recurring_alert import RecurringAlert

logger = logging.getLogger(__name__)

_LOCK_KEY = "itsm:recurring_worker:lock"
_LOCK_TTL = 540  # 9분 — 10분 주기 내 유일 실행 보장
_INTERVAL = 600  # 10분


async def _detect_once() -> None:
    """단일 반복 장애 감지 주기."""
    redis = get_redis()
    acquired = await redis.set(_LOCK_KEY, "1", nx=True, ex=_LOCK_TTL)
    if not acquired:
        logger.debug("Recurring worker lock held by another instance, skipping")
        return

    try:
        # 감지 쿼리 — 별도 세션으로 읽기
        async with AsyncSessionLocal() as session:
            rows = await session.execute(
                text("""
                    SELECT
                        tenant_id,
                        customer_id,
                        symptom_category_id,
                        COUNT(*) AS cnt,
                        ARRAY_AGG(id) AS ids
                    FROM tickets
                    WHERE request_type = 'incident'
                      AND created_at >= NOW() - INTERVAL '30 days'
                      AND symptom_category_id IS NOT NULL
                      AND customer_id IS NOT NULL
                    GROUP BY tenant_id, customer_id, symptom_category_id
                    HAVING COUNT(*) >= 3
                """)
            )
            groups = rows.fetchall()

        if not groups:
            logger.debug("Recurring worker: no recurring groups found")
            return

        # 그룹별 처리 — 쓰기 세션 (건당 commit)
        async with AsyncSessionLocal() as session:
            for row in groups:
                tenant_id = row.tenant_id
                customer_id = row.customer_id
                symptom_category_id = row.symptom_category_id
                cnt = row.cnt
                ticket_ids: list[uuid.UUID] = row.ids

                # 동일 그룹 미인지 RecurringAlert 존재 여부 확인
                existing = await session.scalar(
                    select(RecurringAlert).where(
                        and_(
                            RecurringAlert.tenant_id == tenant_id,
                            RecurringAlert.customer_id == customer_id,
                            RecurringAlert.symptom_category_id == symptom_category_id,
                            RecurringAlert.is_acknowledged.is_(False),
                        )
                    )
                )
                if existing is not None:
                    logger.debug(
                        "Recurring alert already exists for tenant=%s customer=%s symptom=%s, skipping",
                        tenant_id,
                        customer_id,
                        symptom_category_id,
                    )
                    continue

                # RecurringAlert 신규 생성
                alert = RecurringAlert(
                    tenant_id=tenant_id,
                    customer_id=customer_id,
                    symptom_category_id=symptom_category_id,
                    trigger_ticket_ids=ticket_ids,
                    occurrence_count=cnt,
                    detected_at=datetime.now(timezone.utc),
                    is_acknowledged=False,
                )
                session.add(alert)

                # 해당 티켓들 is_recurring_flag=True 표시
                await session.execute(
                    text("""
                        UPDATE tickets
                        SET is_recurring_flag = TRUE,
                            recurring_detected_at = NOW()
                        WHERE id = ANY(:ids)
                    """),
                    {"ids": ticket_ids},
                )
                logger.info(
                    "Recurring alert created: tenant=%s customer=%s symptom=%s count=%d",
                    tenant_id,
                    customer_id,
                    symptom_category_id,
                    cnt,
                )

            await session.commit()

    except Exception:
        logger.exception("Recurring worker error during detection")
    finally:
        await redis.delete(_LOCK_KEY)


async def run_recurring_worker() -> None:
    """lifespan에서 asyncio.create_task로 기동하는 루프."""
    logger.info("Recurring worker starting — interval=%ds", _INTERVAL)
    while True:
        try:
            await _detect_once()
        except Exception:
            logger.exception("Recurring worker unexpected error")
        await asyncio.sleep(_INTERVAL)
