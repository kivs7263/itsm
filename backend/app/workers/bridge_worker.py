"""ITSM → SA KPI 브릿지 워커.

주기: BRIDGE_INTERVAL_MINUTES (기본 60분)
Redis lock: itsm:bridge_worker:lock TTL=3600s

동작:
1. contracts WHERE linked_business_id IS NOT NULL 조회 → (tenant_id, business_id) 목록
2. 각 쌍에 대해 compute_kpi → push_to_sa
3. 개별 실패 시 로그 + 다음 항목 계속 진행
"""
from __future__ import annotations

import asyncio
import logging
import signal

from sqlalchemy import text

from app.core.config import settings
from app.core.database import AsyncSessionLocal, engine
from app.core.redis import get_redis
from app.services.bridge_service import compute_kpi, push_to_sa

logger = logging.getLogger(__name__)

_LOCK_KEY = "itsm:bridge_worker:lock"
_LOCK_TTL = 1800  # seconds — 30분 stale 임계값(BIZCARD-A BA-7)
_DIRTY_KEY_PREFIX = "itsm:kpi:dirty:"  # {business_id} → "1" (TTL 300s)
_running = True


def _handle_signal(sig: int, _frame) -> None:
    global _running
    logger.info("Bridge worker shutting down (signal %s)", sig)
    _running = False


async def _flush_dirty(redis) -> None:
    """dirty SET이 있는 business_id를 즉시 push (정기 주기 전 선처리)."""
    dirty_keys = await redis.keys(f"{_DIRTY_KEY_PREFIX}*")
    if not dirty_keys:
        return

    logger.info("bridge_worker: dirty SET %d건 선처리", len(dirty_keys))

    async with AsyncSessionLocal() as session:
        for key in dirty_keys:
            business_id = key.decode().removeprefix(_DIRTY_KEY_PREFIX)
            row = await session.execute(
                text("""
                    SELECT DISTINCT tenant_id::text AS tenant_id
                    FROM contracts
                    WHERE linked_business_id = :bid::uuid
                    LIMIT 1
                """),
                {"bid": business_id},
            )
            result = row.one_or_none()
            if result is None:
                await redis.delete(key)
                continue

            try:
                kpi = await compute_kpi(result.tenant_id, business_id)
                if kpi:
                    await push_to_sa(business_id, kpi)
                    await redis.delete(key)
                    logger.info("dirty push 완료: business_id=%s", business_id)
            except Exception:
                logger.exception("dirty push 실패: business_id=%s", business_id)


async def _run_bridge_once(redis) -> None:
    """단일 브릿지 주기: 모든 (tenant_id, linked_business_id) 쌍에 KPI push."""
    # dirty-flag 선처리 (인프라 변경 없이 평균 stale 60분 → 5분 단축)
    await _flush_dirty(redis)

    acquired = await redis.set(_LOCK_KEY, "1", nx=True, ex=_LOCK_TTL)
    if not acquired:
        logger.debug("bridge_worker lock held by another instance, skipping")
        return

    try:
        # 1. linked_business_id 가 설정된 계약 목록 조회 (tenant_id + business_id 고유 쌍)
        async with AsyncSessionLocal() as session:
            rows = await session.execute(
                text("""
                    SELECT DISTINCT
                        tenant_id::text   AS tenant_id,
                        linked_business_id::text AS business_id
                    FROM contracts
                    WHERE linked_business_id IS NOT NULL
                """)
            )
            pairs = rows.fetchall()

        if not pairs:
            logger.info("bridge_worker: linked_business_id 계약 없음, 건너뜀")
            return

        logger.info("bridge_worker: %d 쌍 처리 시작", len(pairs))
        ok_count = 0
        fail_count = 0

        for row in pairs:
            tenant_id: str = row.tenant_id
            business_id: str = row.business_id

            try:
                kpi = await compute_kpi(tenant_id, business_id)
                if kpi is None:
                    logger.warning(
                        "bridge_worker: KPI 집계 실패 tenant_id=%s business_id=%s",
                        tenant_id, business_id,
                    )
                    fail_count += 1
                    continue

                success = await push_to_sa(business_id, kpi)
                if success:
                    ok_count += 1
                else:
                    fail_count += 1

            except Exception:
                logger.exception(
                    "bridge_worker: 처리 중 예외 tenant_id=%s business_id=%s",
                    tenant_id, business_id,
                )
                fail_count += 1
                # 개별 실패 — 다음 항목 계속 진행

        logger.info(
            "bridge_worker 주기 완료: ok=%d fail=%d total=%d",
            ok_count, fail_count, len(pairs),
        )

    finally:
        await redis.delete(_LOCK_KEY)


async def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    signal.signal(signal.SIGTERM, _handle_signal)
    signal.signal(signal.SIGINT, _handle_signal)

    interval_seconds = settings.BRIDGE_INTERVAL_MINUTES * 60
    logger.info(
        "Bridge worker starting — interval=%dm SA_BACKEND_URL=%s",
        settings.BRIDGE_INTERVAL_MINUTES,
        settings.SA_BACKEND_URL or "(미설정)",
    )

    redis = get_redis()

    try:
        while _running:
            try:
                await _run_bridge_once(redis)
            except Exception:
                logger.exception("bridge_worker 주기 오류")
            await asyncio.sleep(interval_seconds)
    finally:
        await engine.dispose()
        await redis.aclose()
        logger.info("Bridge worker stopped")


if __name__ == "__main__":
    asyncio.run(main())
