"""WF-1 GW 결재 상태 폴링 워커 — ADR-048.

주기: 120초마다 gw_approval_status='pending' & gw_approval_doc_id IS NOT NULL 티켓을
      일괄 조회 → GW external API 폴링 → approved면 자동 클로즈.

설계 원칙:
- 외부 HTTP(GW 폴링)는 이 워커 안에서만 실행 — 요청 경로(get_ticket) 0 HTTP.
- HTTP 호출은 DB 트랜잭션 밖: 조회(SELECT) → commit 없이 세션 닫기 → HTTP → 독립 세션 UPDATE commit.
- 상태가드: closed/resolved 티켓은 전이 금지 (이중 클로즈·로그 오염 방지).
- from_value: 워커 전이 시점의 실제 ticket.status 값 사용 (고정문자열 "pending" 아님).
- Redis 분산 락: itsm:wf1_worker:lock TTL=110s (120s 주기 내 유일 실행).
- GW에 단건 조회 엔드포인트(/external/{doc_id}) 없음 확인 → 전체목록+필터 현행 유지.
- graceful: GW/KC 미설정(None 반환) 또는 개별 티켓 오류 → logger.warning + 다음 항목 계속.
- 휴면 환경(env 미설정) 유지 — GW_BACKEND_URL/KC_TOKEN_URL 미설정 시 get_approval_status=None → skip.
"""
from __future__ import annotations

import asyncio
import logging

from sqlalchemy import text

from app.core.database import AsyncSessionLocal
from app.core.redis import get_redis
from app.services import gw_approval_service, activity_service

logger = logging.getLogger(__name__)

_LOCK_KEY = "itsm:wf1_worker:lock"
_LOCK_TTL = 110   # seconds — 120s 주기 내 유일 실행 보장
_INTERVAL = 120   # seconds


async def _poll_once() -> None:
    """단일 WF-1 폴링 주기."""
    redis = get_redis()
    acquired = await redis.set(_LOCK_KEY, "1", nx=True, ex=_LOCK_TTL)
    if not acquired:
        logger.debug("WF-1 worker lock held by another instance, skipping")
        return

    try:
        # 1. pending 티켓 목록 조회 — 읽기 전용 세션, commit 없음
        async with AsyncSessionLocal() as session:
            rows = await session.execute(
                text("""
                    SELECT id, tenant_id, status, gw_approval_doc_id
                    FROM tickets
                    WHERE gw_approval_status = 'pending'
                      AND gw_approval_doc_id IS NOT NULL
                    ORDER BY created_at
                """)
            )
            pending = rows.fetchall()

        if not pending:
            logger.debug("WF-1 worker: pending 티켓 없음, 건너뜀")
            return

        logger.info("WF-1 worker: pending 티켓 %d건 폴링 시작", len(pending))

        for row in pending:
            ticket_id = row.id
            gw_doc_id: str = row.gw_approval_doc_id
            # 전이 직전 실제 status (from_value 오염 방지 — 권고 4)
            prev_status: str = str(row.status.value) if hasattr(row.status, "value") else str(row.status)

            try:
                # 2. GW 폴링 — DB 트랜잭션 완전히 밖
                gw_status = await gw_approval_service.get_approval_status(
                    requester_email="",   # external 조회는 user_email 파라미터로 전체 목록 조회 후 doc_id 필터
                    gw_doc_id=gw_doc_id,
                )

                if gw_status is None:
                    # 미설정(휴면) 또는 GW 응답 없음 — 조용히 skip
                    logger.debug("WF-1 worker: GW 응답 없음 ticket=%s doc_id=%s", ticket_id, gw_doc_id)
                    continue

                if gw_status == "pending":
                    # 변화 없음
                    continue

                # 3. 상태 변화 있음 → 독립 세션으로 UPDATE
                async with AsyncSessionLocal() as upd_session:
                    # 상태가드: closed/resolved 이미 종료된 티켓은 재전이 금지 (차단 2)
                    current_row = await upd_session.execute(
                        text("""
                            SELECT status, gw_approval_status
                            FROM tickets
                            WHERE id = :tid
                        """),
                        {"tid": str(ticket_id)},
                    )
                    current = current_row.one_or_none()
                    if current is None:
                        logger.warning("WF-1 worker: 티켓 없음 ticket=%s", ticket_id)
                        continue

                    current_status = str(current.status)
                    if current_status in ("closed", "resolved"):
                        logger.info(
                            "WF-1 worker: 상태가드 — 이미 종료된 티켓 재전이 금지 ticket=%s status=%s",
                            ticket_id, current_status,
                        )
                        # gw_approval_status만 갱신해서 다음 주기 재폴링 방지
                        await upd_session.execute(
                            text("""
                                UPDATE tickets
                                SET gw_approval_status = :gw_status
                                WHERE id = :tid
                            """),
                            {"gw_status": gw_status, "tid": str(ticket_id)},
                        )
                        await upd_session.commit()
                        continue

                    # 4. 실제 전이 처리
                    if gw_status == "approved":
                        await upd_session.execute(
                            text("""
                                UPDATE tickets
                                SET gw_approval_status = :gw_status,
                                    status = 'closed',
                                    closed_at = COALESCE(closed_at, NOW())
                                WHERE id = :tid
                                  AND status NOT IN ('closed', 'resolved')
                            """),
                            {"gw_status": gw_status, "tid": str(ticket_id)},
                        )
                        # activity 기록: from_value = 워커 조회 시점 실제 status (권고 4)
                        await activity_service.record(
                            upd_session,
                            tenant_id=row.tenant_id,
                            ticket_id=ticket_id,
                            actor_id=None,          # 시스템 액터
                            event_type="status_changed",
                            from_value=prev_status,  # 실제 직전 status 값
                            to_value="closed",
                            meta={"reason": "wf1_gw_approved", "gw_doc_id": gw_doc_id},
                        )
                        logger.info(
                            "WF-1 worker: GW 승인 → 티켓 자동 클로즈 ticket=%s doc_id=%s",
                            ticket_id, gw_doc_id,
                        )
                    else:
                        # rejected / cancelled 등 기타 상태
                        await upd_session.execute(
                            text("""
                                UPDATE tickets
                                SET gw_approval_status = :gw_status
                                WHERE id = :tid
                            """),
                            {"gw_status": gw_status, "tid": str(ticket_id)},
                        )
                        logger.info(
                            "WF-1 worker: GW 상태 갱신 ticket=%s doc_id=%s gw_status=%s",
                            ticket_id, gw_doc_id, gw_status,
                        )

                    await upd_session.commit()

            except Exception as exc:
                logger.warning(
                    "WF-1 worker: 개별 티켓 처리 오류 (graceful skip) ticket=%s: %s",
                    ticket_id, exc,
                )

    except Exception:
        logger.exception("WF-1 worker: 주기 처리 중 예외")
    finally:
        await redis.delete(_LOCK_KEY)


async def run_wf1_approval_worker() -> None:
    """lifespan에서 asyncio.create_task로 기동하는 루프."""
    logger.info("WF-1 approval worker starting — interval=%ds", _INTERVAL)
    while True:
        try:
            await _poll_once()
        except Exception:
            logger.exception("WF-1 approval worker unexpected error")
        await asyncio.sleep(_INTERVAL)
