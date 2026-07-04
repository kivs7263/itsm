"""CSAT 설문 서비스.

- maybe_create_survey: 티켓 resolve/closed 시 자동 호출.
  customer_id 없으면 skip. 이미 survey 있으면 skip.
  survey_token = secrets.token_urlsafe(32) (44자 base64)
  expires_at = sent_at + 7 days
- get_summary: 테넌트별 집계 통계 반환
"""
from __future__ import annotations

import logging
import secrets
import uuid
from datetime import datetime, timezone, timedelta

from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.csat_survey import CSATSurvey, CSATStatus
from app.models.ticket import Ticket

logger = logging.getLogger(__name__)


async def maybe_create_survey(
    db: AsyncSession,
    ticket: Ticket,
) -> CSATSurvey | None:
    """티켓 resolve/closed 시 CSAT 설문 자동 생성.

    - customer_id 없으면 None 반환 (skip)
    - 이미 survey 있으면 None 반환 (skip)
    - commit은 호출자가 처리 (flush만 수행)
    """
    if ticket.customer_id is None:
        return None

    # 이미 설문 존재 여부 확인
    existing = await db.scalar(
        select(CSATSurvey).where(CSATSurvey.ticket_id == ticket.id)
    )
    if existing is not None:
        return None

    now = datetime.now(timezone.utc)
    survey_token = secrets.token_urlsafe(32)
    survey = CSATSurvey(
        id=uuid.uuid4(),
        tenant_id=ticket.tenant_id,
        ticket_id=ticket.id,
        customer_id=ticket.customer_id,
        survey_token=survey_token,
        status=CSATStatus.pending,
        sent_at=now,
        expires_at=now + timedelta(days=7),
        created_at=now,
    )
    db.add(survey)
    await db.flush()

    # 고객 이메일로 CSAT 링크 발송 (graceful — 이메일 미설정 시 skip)
    try:
        from app.services.external_notif_service import queue_notification, resolve_customer_email
        from app.core.config import settings

        email, name = await resolve_customer_email(db, ticket)
        if email:
            portal_base = getattr(settings, "PORTAL_BASE_URL", "").rstrip("/")
            survey_url = f"{portal_base}/survey/{survey_token}" if portal_base else ""
            if survey_url:
                await queue_notification(
                    db,
                    tenant_id=ticket.tenant_id,
                    ticket_id=ticket.id,
                    escalation_id=None,
                    channel="email",
                    event_type="csat_survey",
                    recipient=email,
                    payload={
                        "ticket_title": ticket.title,
                        "ticket_number": ticket.ticket_number or str(ticket.id)[:8],
                        "customer_name": name or "고객",
                        "survey_url": survey_url,
                    },
                )
    except Exception:
        logger.warning("CSAT 이메일 큐 등록 실패 (무시)", exc_info=True)

    return survey


async def get_summary(
    db: AsyncSession,
    tenant_id: uuid.UUID,
) -> dict:
    """테넌트별 CSAT 집계 통계 반환.

    반환 필드:
    - total: 전체 설문 수
    - submitted: 제출 완료 수
    - pending: 대기 중 수
    - expired: 만료 수
    - avg_score: 제출 기준 평균 점수 (nullable)
    - score_distribution: {1:N, 2:N, 3:N, 4:N, 5:N}
    - response_rate: submitted / total (0 나누기 방지)
    """
    where_tenant = CSATSurvey.tenant_id == tenant_id

    # 상태별 카운트 집계
    status_rows = (
        await db.execute(
            select(CSATSurvey.status, func.count().label("cnt"))
            .where(where_tenant)
            .group_by(CSATSurvey.status)
        )
    ).all()

    counts: dict[str, int] = {}
    for row in status_rows:
        status_val = row.status if isinstance(row.status, str) else row.status.value
        counts[status_val] = row.cnt

    total = sum(counts.values())
    submitted = counts.get(CSATStatus.submitted.value, 0)
    pending = counts.get(CSATStatus.pending.value, 0)
    expired = counts.get(CSATStatus.expired.value, 0)

    # 평균 점수 (submitted 기준)
    avg_score_val = await db.scalar(
        select(func.avg(CSATSurvey.score)).where(
            and_(
                where_tenant,
                CSATSurvey.status == CSATStatus.submitted,
                CSATSurvey.score.isnot(None),
            )
        )
    )
    avg_score = float(round(avg_score_val, 2)) if avg_score_val is not None else None

    # 점수 분포 (1~5)
    score_rows = (
        await db.execute(
            select(CSATSurvey.score, func.count().label("cnt"))
            .where(
                and_(
                    where_tenant,
                    CSATSurvey.status == CSATStatus.submitted,
                    CSATSurvey.score.isnot(None),
                )
            )
            .group_by(CSATSurvey.score)
        )
    ).all()

    score_distribution = {1: 0, 2: 0, 3: 0, 4: 0, 5: 0}
    for row in score_rows:
        if row.score in score_distribution:
            score_distribution[row.score] = row.cnt

    # 응답률
    response_rate = round(submitted / total, 4) if total > 0 else 0.0

    # 월별 CSAT 추이 (최근 6개월)
    # NOTE: to_char 식을 단일 객체로 재사용 — SELECT/GROUP BY/ORDER BY가
    # 동일 바인드 파라미터를 참조해야 Postgres GROUP BY 검증을 통과한다.
    # (각 위치에 리터럴을 따로 쓰면 익명 파라미터가 달라져 GroupingError 발생)
    month_expr = func.to_char(CSATSurvey.sent_at, "YYYY-MM")
    trend_rows = (
        await db.execute(
            select(
                month_expr.label("month"),
                func.avg(CSATSurvey.score).label("avg_score"),
                func.count().label("cnt"),
            )
            .where(
                and_(
                    where_tenant,
                    CSATSurvey.status == CSATStatus.submitted,
                    CSATSurvey.score.isnot(None),
                )
            )
            .group_by(month_expr)
            .order_by(month_expr.desc())
            .limit(6)
        )
    ).all()
    monthly_trend = [
        {
            "month": r.month,
            "avg_score": round(float(r.avg_score), 2),
            "count": r.cnt,
        }
        for r in reversed(trend_rows)
    ]

    return {
        "total": total,
        "submitted": submitted,
        "pending": pending,
        "expired": expired,
        "avg_score": avg_score,
        "score_distribution": score_distribution,
        "response_rate": response_rate,
        "monthly_trend": monthly_trend,
    }
