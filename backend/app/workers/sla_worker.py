"""SLA Worker — Redis 분산 lock 기반 SLA breach 감지 및 이벤트 기록.

주기: 60초마다 활성 티켓의 SLA 마감 시간을 검사.
- response_deadline 30분 전: breach_warning 이벤트 발행
- response_deadline 경과: breached 이벤트 발행 (중복 방지: Redis SET NX)
"""
from __future__ import annotations

import asyncio
import logging
import signal
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
    """티켓 고객에게 SLA 진행 상황 외부 알림 큐 등록 + 담당자 통합 인박스 fan-in (P1-4-B)."""
    try:
        from sqlalchemy import select as sa_select
        from app.models import Ticket
        from app.services.external_notif_service import queue_notification, resolve_customer_email

        ticket = await session.get(Ticket, ticket_id)
        if not ticket:
            return

        # 고객 외부 알림 (기존 로직)
        if ticket.customer_id:
            email, name = await resolve_customer_email(session, ticket)
            if email:
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

        # P1-4-B: 담당자 통합 인박스 fan-in
        try:
            from app.services.notification_service import push_inbox_sla_with_db
            is_warning = event_type == "sla_warning"
            await push_inbox_sla_with_db(
                session,
                ticket=ticket,
                event_namespace="itsm.ticket.sla_warning" if is_warning else "itsm.ticket.sla_breach",
                title=(
                    f"SLA 경고: 티켓 #{ticket.ticket_number or str(ticket_id)[:8]}"
                    if is_warning
                    else f"SLA 초과: 티켓 #{ticket.ticket_number or str(ticket_id)[:8]}"
                ),
                body=(
                    "SLA 응답 기한 30분 이내입니다." if is_warning
                    else "티켓의 SLA 응답 시간이 초과되었습니다."
                ),
                idempotency_suffix=f"{event_type}:{ticket_id}",
            )
        except Exception as exc:
            logger.warning("SLA 인박스 fan-in 실패 (무시): %s", exc)

    except Exception:
        logger.warning("SLA 외부 알림 큐 등록 실패 (무시)", exc_info=True)


async def _collect_escalation_candidates(
    session, ticket_id, response_deadline, now: datetime
) -> dict | None:
    """WF-4: breach_warning 대상 티켓에서 GW 호출에 필요한 정보만 수집.

    메인 트랜잭션(SLA 이벤트 INSERT) 중에 호출되며, DB 조회만 수행한다.
    실제 GW HTTP 호출·UPDATE·commit은 메인 commit 이후에 수행한다.

    Returns:
        {ticket_id, requester_email, title, content_text} dict.
        skip 조건 해당 시 None.
    """
    from app.models.ticket import Ticket
    from app.models.user import User

    ticket = await session.get(Ticket, ticket_id)
    if not ticket:
        return None

    # 멱등성: 이미 결재가 생성된 경우 skip (ADR-048 §315)
    if ticket.sla_escalation_approval_id is not None:
        logger.debug(
            "WF-4 skip: escalation approval already exists ticket=%s doc_id=%s",
            ticket_id,
            ticket.sla_escalation_approval_id,
        )
        return None

    # 기안자 이메일: 담당자 우선, 없으면 skip
    requester_email: str | None = None
    if ticket.assigned_to:
        user = await session.get(User, ticket.assigned_to)
        if user:
            requester_email = user.email

    if not requester_email:
        logger.debug("WF-4 skip: no assignee email ticket=%s", ticket_id)
        return None

    remaining_minutes = int((response_deadline - now).total_seconds() / 60)
    ticket_number = ticket.ticket_number or str(ticket_id)[:8]

    return {
        "ticket_id": ticket_id,
        "requester_email": requester_email,
        "title": f"[SLA 에스컬레이션] 티켓 #{ticket_number} — {remaining_minutes}분 남음",
        "content_text": (
            ticket.description
            or f"티켓 #{ticket_number} SLA 응답 기한 {remaining_minutes}분 이내 — 에스컬레이션 결재 필요"
        ),
    }


async def _run_escalation_after_commit(candidates: list[dict]) -> None:
    """WF-4: 메인 트랜잭션 commit 완료 이후 GW 호출 + 독립 세션으로 컬럼 UPDATE.

    설계 원칙 (차단-1/2/3 교정):
    - GW HTTP(최대 20s)는 SLA 이벤트 commit이 끝난 뒤 실행 → idle_in_transaction 오염 없음.
    - GW 성공 시에만 UPDATE → 컬럼 NULL로 재시도 될 일 없음 (역방향 불일치 차단).
    - 각 티켓마다 독립 AsyncSessionLocal() + commit → 한 티켓 실패가 다른 티켓에 미전파.
    - GW/KC 실패·예외·휴면(None) 시 logger.warning만. SLA 흐름은 이미 commit됨.

    테넌트 격리:
    - GW create_external_draft는 requester_email → User.tenant_id 역추론으로 테넌트를 결정한다.
      (approvals.py:3121~3130 확인 완료: user.email WHERE is_active=True → user.tenant_id로 Form 조회)
      따라서 payload에 tenant_id를 별도 전달하지 않아도 GW 내부에서 격리됨.
      이메일이 GW에 없거나 비활성이면 422 → graceful skip — 교차테넌트 결재 생성 불가.
    """
    if not candidates:
        return

    from app.services.gw_approval_service import submit_approval_draft

    for candidate in candidates:
        ticket_id = candidate["ticket_id"]
        try:
            result = await submit_approval_draft(
                requester_email=candidate["requester_email"],
                title=candidate["title"],
                content_text=candidate["content_text"],
            )

            if result and result.get("id"):
                doc_id = str(result["id"])
                # 독립 짧은 세션 — SLA 메인 트랜잭션과 완전히 분리
                async with AsyncSessionLocal() as upd_session:
                    await upd_session.execute(
                        text(
                            "UPDATE tickets SET sla_escalation_approval_id = :doc_id "
                            "WHERE id = :ticket_id "
                            "  AND sla_escalation_approval_id IS NULL"  # 2차 멱등성 방어
                        ),
                        {"doc_id": doc_id, "ticket_id": str(ticket_id)},
                    )
                    await upd_session.commit()
                logger.info(
                    "WF-4: escalation approval created ticket=%s doc_id=%s",
                    ticket_id,
                    doc_id,
                )
            else:
                logger.warning(
                    "WF-4: GW 결재 생성 실패 (graceful skip) ticket=%s", ticket_id
                )

        except Exception as exc:
            logger.warning(
                "WF-4: escalation approval 생성 오류 (graceful skip) ticket=%s: %s",
                ticket_id,
                exc,
            )


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

    # WF-4 에스컬레이션 후처리 대상 수집 리스트.
    # 메인 세션 commit 이후에 GW HTTP 호출을 수행한다 (차단-1/2/3 교정).
    escalation_candidates: list[dict] = []

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
                        # WF-4 (ADR-048): GW 에스컬레이션 후처리 대상 수집.
                        # 실제 GW HTTP 호출은 아래 메인 commit 완료 이후에 수행한다.
                        # 여기서는 필요 데이터(email·title·content)만 DB에서 읽어 수집.
                        candidate = await _collect_escalation_candidates(
                            session, ticket_id, response_deadline, now
                        )
                        if candidate:
                            escalation_candidates.append(candidate)

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

            # 메인 commit: SLA 이벤트 INSERT·알림 큐 모두 확정.
            # 이 시점 이후에는 GW HTTP가 실패해도 SLA 흐름에 영향 없음.
            await session.commit()

    finally:
        await redis.delete(_LOCK_KEY)

    # WF-4: GW HTTP 호출 + 독립 세션 UPDATE — 메인 트랜잭션 완전히 종료된 뒤 실행.
    # graceful: 여기서 예외 발생해도 SLA 이벤트는 이미 commit됨.
    await _run_escalation_after_commit(escalation_candidates)

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
