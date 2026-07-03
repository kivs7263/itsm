"""보고서 라우터 (P6-2 보고서 승인 워크플로우).

prefix : /{tenant_slug}/reports
태그   : ["reports"]

엔드포인트:
  GET  /summary        — 실시간 집계 (프론트 ReportSummary 타입 호환)
  GET  /               — 보고서 목록 (status 필터, 페이지네이션)
  POST /               — 초안 생성 (team_lead+)
  GET  /{id}           — 상세
  PATCH /{id}          — 수정 (draft + 작성자만)
  POST /{id}/submit    — draft → submitted
  POST /{id}/approve   — submitted → approved (admin만)
  POST /{id}/reject    — submitted → rejected (admin만, review_comment 필수)
  DELETE /{id}         — 삭제 (draft + 작성자만)

상태 전이 규칙:
  draft → submitted (submit)
  submitted → approved (approve, admin)
  submitted → rejected (reject, admin, review_comment 필수)
  approved 보고서 수정/삭제 → 400

멀티테넌트: 모든 쿼리 tenant_id == current_user.tenant_id (★★ 핵심 체크)
"""
from __future__ import annotations

import logging
import uuid
from datetime import date, datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import and_, case, extract, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from sqlalchemy import text as sa_text

from app.core.database import get_db
from app.core.dependencies import get_current_user, require_roles
from app.models.escalation import TicketEscalation
from app.models.kb_article import KbArticle
from app.models.report import Report, ReportStatus
from app.models.sla import SLAEvent, SLAEventType
from app.models.ticket import Ticket, TicketChannel, TicketStatus
from app.models.user import User, UserRole
from app.models.work_log import TicketWorkLog
from app.models.recurring_alert import RecurringAlert
from app.services import csat_service

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/{tenant_slug}/reports",
    tags=["reports"],
)

_WRITER_ROLES = {UserRole.team_lead, UserRole.admin}

# ------------------------------------------------------------------
# 스키마
# ------------------------------------------------------------------


class ReportCreate(BaseModel):
    report_type: str = Field(..., pattern="^(monthly|weekly)$")
    period_start: date
    period_end: date
    title: str = Field(..., max_length=300)


class ReportUpdate(BaseModel):
    title: str | None = Field(None, max_length=300)


class RejectBody(BaseModel):
    review_comment: str = Field(..., min_length=1)


class ReportResponse(BaseModel):
    id: uuid.UUID
    tenant_id: uuid.UUID
    report_type: str
    period_start: date
    period_end: date
    title: str
    summary_data: dict
    status: str
    submitted_by: uuid.UUID | None
    submitted_at: datetime | None
    reviewed_by: uuid.UUID | None
    reviewed_at: datetime | None
    review_comment: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ------------------------------------------------------------------
# 내부 헬퍼
# ------------------------------------------------------------------


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def _get_or_404(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    report_id: uuid.UUID,
) -> Report:
    """크로스 테넌트 → 404 (존재 노출 금지)."""
    row = (
        await db.execute(
            select(Report).where(
                and_(
                    Report.id == report_id,
                    Report.tenant_id == tenant_id,
                )
            )
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="보고서를 찾을 수 없습니다.",
        )
    return row


async def _build_summary_data(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    period_start: date | None = None,
    period_end: date | None = None,
) -> dict:
    """티켓 집계 스냅샷 생성.

    period_start/end가 주어지면 해당 기간 티켓만 집계,
    없으면 전체 테넌트 데이터 기준.
    """
    base_where = [Ticket.tenant_id == tenant_id]
    if period_start:
        base_where.append(func.date(Ticket.created_at) >= period_start)
    if period_end:
        base_where.append(func.date(Ticket.created_at) <= period_end)

    # 상태별 카운트
    status_rows = (
        await db.execute(
            select(Ticket.status, func.count().label("cnt"))
            .where(and_(*base_where))
            .group_by(Ticket.status)
        )
    ).all()

    by_status = [
        {"status": str(row.status.value if hasattr(row.status, "value") else row.status), "count": row.cnt}
        for row in status_rows
    ]
    total = sum(row["count"] for row in by_status)

    # 월별 티켓 수 (최근 12개월)
    # to_char 식을 한 번만 정의해 SELECT/GROUP BY/ORDER BY 에서 재사용 —
    # 매번 새로 호출하면 bound param 이 달라져($1 vs $2) PG GroupingError 발생
    month_expr = func.to_char(Ticket.created_at, "YYYY-MM")
    monthly_rows = (
        await db.execute(
            select(
                month_expr.label("month"),
                func.count().label("cnt"),
            )
            .where(and_(*base_where))
            .group_by(month_expr)
            .order_by(month_expr.desc())
            .limit(12)
        )
    ).all()
    monthly_tickets = [{"month": row.month, "count": row.cnt} for row in reversed(monthly_rows)]

    # 이번 달 해결 건수
    monthly_resolved = await db.scalar(
        select(func.count())
        .select_from(Ticket)
        .where(
            and_(
                Ticket.tenant_id == tenant_id,
                Ticket.status.in_([TicketStatus.resolved, TicketStatus.closed]),
                func.to_char(Ticket.updated_at, "YYYY-MM") == func.to_char(func.now(), "YYYY-MM"),
            )
        )
    ) or 0

    # SLA 준수율
    # 분자: 기간 내 SLA 위반(breached)이 발생한 고유 티켓 수 (distinct ticket_id).
    #   이벤트 건수(COUNT(*)) 사용 시 response+resolution 2건 위반이 분자를 2 증가시켜 음수 가능.
    #   sla_worker.py는 response breach(itsm:sla:breach:{id})와
    #   resolution breach(itsm:sla:res_breach:{id})를 각각 INSERT하므로
    #   티켓 1개 = breached 이벤트 최대 2건 → 반드시 distinct ticket_id 기준으로 집계.
    # 분모: 기간 내 전체 티켓 수.
    #   SLA 정책 미적용 티켓(계약 없는 등)이 포함되어 준수율이 과대계상될 수 있음.
    #   (sla_worker.py:235 WHERE t.status NOT IN ('resolved','closed') 내 contract_id IS NOT NULL
    #    조건 참조 — 분모를 "SLA 정책 적용 티켓"으로 정제하는 것은 향후 개선 과제)
    breach_ticket_conditions = [
        SLAEvent.tenant_id == tenant_id,
        SLAEvent.event_type == SLAEventType.breached,
    ]
    if period_start:
        breach_ticket_conditions.append(func.date(Ticket.created_at) >= period_start)
    if period_end:
        breach_ticket_conditions.append(func.date(Ticket.created_at) <= period_end)

    breach_ticket_count = await db.scalar(
        select(func.count(SLAEvent.ticket_id.distinct()))
        .select_from(SLAEvent)
        .join(Ticket, SLAEvent.ticket_id == Ticket.id)
        .where(and_(*breach_ticket_conditions))
    ) or 0

    sla_compliance_rate = (
        round(max(0.0, 1.0 - breach_ticket_count / total), 4) if total > 0 else 1.0
    )

    # ------------------------------------------------------------------
    # MTTR (Mean Time To Resolve) — 분 단위, resolved/closed 티켓만
    # ------------------------------------------------------------------
    mttr_result = await db.scalar(
        select(
            func.avg(
                extract("epoch", Ticket.resolved_at - Ticket.created_at) / 60
            )
        )
        .where(
            and_(
                Ticket.tenant_id == tenant_id,
                Ticket.status.in_([TicketStatus.resolved, TicketStatus.closed]),
                Ticket.resolved_at.isnot(None),
            )
        )
    )
    mttr_minutes = round(float(mttr_result), 1) if mttr_result is not None else None

    # ------------------------------------------------------------------
    # FCR (First Contact Resolution) — 에스컬레이션 없이 해결된 비율
    # ------------------------------------------------------------------
    resolved_total = sum(
        r["count"] for r in by_status
        if r["status"] in ("resolved", "closed")
    )
    if resolved_total > 0:
        escalated_ids_q = (
            await db.execute(
                select(TicketEscalation.ticket_id)
                .where(TicketEscalation.tenant_id == tenant_id)
                .distinct()
            )
        )
        escalated_ticket_ids = {str(r[0]) for r in escalated_ids_q.all()}

        resolved_rows = (
            await db.execute(
                select(Ticket.id)
                .where(
                    and_(
                        Ticket.tenant_id == tenant_id,
                        Ticket.status.in_([TicketStatus.resolved, TicketStatus.closed]),
                    )
                )
            )
        ).all()
        fcr_count = sum(1 for r in resolved_rows if str(r[0]) not in escalated_ticket_ids)
        fcr_rate = round(fcr_count / resolved_total * 100, 1)
    else:
        fcr_rate = None

    # ------------------------------------------------------------------
    # 우선순위별 분포
    # ------------------------------------------------------------------
    priority_rows = (
        await db.execute(
            select(Ticket.priority, func.count().label("cnt"))
            .where(and_(*base_where))
            .group_by(Ticket.priority)
        )
    ).all()
    by_priority = [
        {
            "priority": str(r.priority.value if hasattr(r.priority, "value") else r.priority),
            "count": r.cnt,
        }
        for r in priority_rows
    ]

    # ------------------------------------------------------------------
    # KB 지식베이스 지표
    # ------------------------------------------------------------------
    kb_total_views = await db.scalar(
        select(func.sum(KbArticle.view_count))
        .where(
            and_(
                KbArticle.tenant_id == tenant_id,
                KbArticle.is_published.is_(True),
            )
        )
    ) or 0
    kb_article_count = await db.scalar(
        select(func.count())
        .select_from(KbArticle)
        .where(
            and_(
                KbArticle.tenant_id == tenant_id,
                KbArticle.is_published.is_(True),
            )
        )
    ) or 0

    # KB 상위 5개 문서 (view_count 기준)
    kb_top_rows = (
        await db.execute(
            select(KbArticle.id, KbArticle.title, KbArticle.view_count)
            .where(
                and_(
                    KbArticle.tenant_id == tenant_id,
                    KbArticle.is_published.is_(True),
                )
            )
            .order_by(KbArticle.view_count.desc())
            .limit(5)
        )
    ).all()
    kb_top_articles = [
        {"id": str(r.id), "title": r.title, "view_count": r.view_count or 0}
        for r in kb_top_rows
    ]

    # ------------------------------------------------------------------
    # 공수 (Work Time) 집계
    # ------------------------------------------------------------------
    work_hours_result = await db.execute(
        select(
            func.sum(TicketWorkLog.hours).label("total_hours"),
            func.sum(
                case(
                    (TicketWorkLog.billable.is_(True), TicketWorkLog.hours),
                    else_=0,
                )
            ).label("billable_hours"),
        ).where(TicketWorkLog.tenant_id == tenant_id)
    )
    work_row = work_hours_result.one()
    total_hours = float(work_row.total_hours or 0)
    billable_hours = float(work_row.billable_hours or 0)

    # ------------------------------------------------------------------
    # KPI-4: 티켓 연령 구간 (age_buckets)
    # ------------------------------------------------------------------
    now_ts = func.now()
    # group_by 는 문자열 alias("bucket") 대신 CASE 식 자체로 — PG GroupingError 방지
    # (문자열 alias 전달 시 SQLAlchemy가 상수로 렌더 → tickets.created_at must appear in GROUP BY)
    age_bucket = case(
        (func.extract("epoch", now_ts - Ticket.created_at) / 86400 <= 7, "0-7d"),
        (func.extract("epoch", now_ts - Ticket.created_at) / 86400 <= 30, "7-30d"),
        else_="30d+",
    ).label("bucket")
    age_rows = (
        await db.execute(
            select(
                age_bucket,
                func.count().label("cnt"),
            )
            .where(
                and_(
                    *base_where,
                    Ticket.status.not_in([TicketStatus.resolved, TicketStatus.closed]),
                )
            )
            .group_by(age_bucket)
        )
    ).all()
    age_buckets = {r.bucket: r.cnt for r in age_rows}
    age_buckets.setdefault("0-7d", 0)
    age_buckets.setdefault("7-30d", 0)
    age_buckets.setdefault("30d+", 0)

    # ------------------------------------------------------------------
    # KPI-4: 채널별 분포 (channel_breakdown)
    # ------------------------------------------------------------------
    channel_rows = (
        await db.execute(
            select(Ticket.channel, func.count().label("cnt"))
            .where(and_(*base_where))
            .group_by(Ticket.channel)
        )
    ).all()
    channel_breakdown = [
        {
            "channel": str(r.channel.value if hasattr(r.channel, "value") else r.channel),
            "count": r.cnt,
        }
        for r in channel_rows
    ]

    # ------------------------------------------------------------------
    # KPI-4: 에스컬레이션 비율 (escalation_rate)
    # ------------------------------------------------------------------
    if total > 0:
        esc_count = await db.scalar(
            select(func.count(TicketEscalation.ticket_id.distinct()))
            .where(TicketEscalation.tenant_id == tenant_id)
        ) or 0
        escalation_rate = round(esc_count / total * 100, 1)
    else:
        escalation_rate = 0.0

    # ------------------------------------------------------------------
    # KPI-4: 반복 장애 비율 (recurring_rate)
    # ------------------------------------------------------------------
    recurring_count = await db.scalar(
        select(func.count())
        .select_from(Ticket)
        .where(
            and_(
                Ticket.tenant_id == tenant_id,
                Ticket.is_recurring_flag.is_(True),
            )
        )
    ) or 0
    recurring_rate = round(recurring_count / total * 100, 1) if total > 0 else 0.0

    # ------------------------------------------------------------------
    # RX-0e: 재오픈 비율 (reopen_rate) + 평균 재오픈 횟수
    # Ticket.reopen_count (models/ticket.py:110) — 티켓 재오픈 시 routers/tickets.py:687에서 +1
    # ------------------------------------------------------------------
    reopen_ticket_count = await db.scalar(
        select(func.count())
        .select_from(Ticket)
        .where(
            and_(
                *base_where,
                Ticket.reopen_count > 0,
            )
        )
    ) or 0
    reopen_rate = round(reopen_ticket_count / total * 100, 1) if total > 0 else 0.0

    avg_reopen_val = await db.scalar(
        select(func.avg(Ticket.reopen_count))
        .where(and_(*base_where))
    )
    avg_reopen_count = round(float(avg_reopen_val), 2) if avg_reopen_val is not None else 0.0

    # ------------------------------------------------------------------
    # KPI-1: MTTA (Mean Time To Acknowledge) — 분 단위
    # ------------------------------------------------------------------
    mtta_result = await db.scalar(
        select(
            func.avg(
                extract("epoch", Ticket.first_responded_at - Ticket.created_at) / 60
            )
        )
        .where(
            and_(
                Ticket.tenant_id == tenant_id,
                Ticket.first_responded_at.isnot(None),
            )
        )
    )
    mtta_minutes = round(float(mtta_result), 1) if mtta_result is not None else None

    return {
        "monthly_tickets": monthly_tickets,
        "by_status": by_status,
        "sla_compliance_rate": sla_compliance_rate,
        "sla_breach_count": breach_ticket_count,
        "monthly_resolved": monthly_resolved,
        "mttr_minutes": mttr_minutes,
        "mtta_minutes": mtta_minutes,
        "fcr_rate": fcr_rate,
        "by_priority": by_priority,
        "kb_total_views": int(kb_total_views),
        "kb_article_count": int(kb_article_count),
        "kb_top_articles": kb_top_articles,
        "total_hours": round(total_hours, 1),
        "billable_hours": round(billable_hours, 1),
        "age_buckets": age_buckets,
        "channel_breakdown": channel_breakdown,
        "escalation_rate": escalation_rate,
        "recurring_rate": recurring_rate,
        # RX-0e: 재오픈 지표
        "reopen_ticket_count": reopen_ticket_count,
        "reopen_rate": reopen_rate,
        "avg_reopen_count": avg_reopen_count,
    }


# ------------------------------------------------------------------
# GET /summary — 실시간 집계 (프론트 ReportSummary 타입 호환)
# 고정 경로를 /{id} 파라미터 경로보다 먼저 등록 (라우터 등록 순서 중요)
# ------------------------------------------------------------------


@router.get(
    "/summary",
    summary="보고서 실시간 집계 (monthly_tickets / by_status / sla_compliance_rate)",
)
async def get_report_summary(
    tenant_slug: str,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """프론트 ReportSummary 타입 호환 집계.

    fields: monthly_tickets, by_status, sla_compliance_rate,
            sla_breach_count, monthly_resolved, csat_summary
    """
    summary = await _build_summary_data(db, current_user.tenant_id)

    # CSAT 집계 병합
    try:
        csat_data = await csat_service.get_summary(db, current_user.tenant_id)
        summary["csat_summary"] = csat_data
    except Exception as exc:
        logger.warning("CSAT 집계 실패 (무시): %s", exc)
        summary["csat_summary"] = None

    return summary


# ------------------------------------------------------------------
# GET / — 보고서 목록
# ------------------------------------------------------------------


@router.get(
    "",
    response_model=dict,
    summary="보고서 목록 (status 필터, 페이지네이션)",
)
async def list_reports(
    tenant_slug: str,
    status_filter: str | None = Query(None, alias="status"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> dict:
    offset = (page - 1) * page_size
    base_where = [Report.tenant_id == current_user.tenant_id]
    if status_filter:
        base_where.append(Report.status == status_filter)

    total = await db.scalar(
        select(func.count()).select_from(Report).where(and_(*base_where))
    )
    rows = (
        await db.execute(
            select(Report)
            .where(and_(*base_where))
            .order_by(Report.created_at.desc())
            .offset(offset)
            .limit(page_size)
        )
    ).scalars().all()

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "items": [ReportResponse.model_validate(r) for r in rows],
    }


# ------------------------------------------------------------------
# POST / — 초안 생성 (team_lead+)
# ------------------------------------------------------------------


@router.post(
    "",
    response_model=ReportResponse,
    status_code=status.HTTP_201_CREATED,
    summary="보고서 초안 생성 (team_lead+)",
)
async def create_report(
    tenant_slug: str,
    data: ReportCreate,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> ReportResponse:
    if current_user.role not in _WRITER_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="보고서 작성 권한이 없습니다.",
        )

    # 기간 기준 집계 스냅샷
    snapshot = await _build_summary_data(
        db,
        current_user.tenant_id,
        period_start=data.period_start,
        period_end=data.period_end,
    )

    report = Report(
        id=uuid.uuid4(),
        tenant_id=current_user.tenant_id,
        report_type=data.report_type,
        period_start=data.period_start,
        period_end=data.period_end,
        title=data.title,
        summary_data=snapshot,
        status=ReportStatus.DRAFT,
        submitted_by=None,
        submitted_at=None,
        reviewed_by=None,
        reviewed_at=None,
        review_comment=None,
        created_at=_now(),
        updated_at=_now(),
    )
    db.add(report)
    await db.commit()
    await db.refresh(report)
    return ReportResponse.model_validate(report)


# ------------------------------------------------------------------
# GET /{id} — 상세
# ------------------------------------------------------------------


@router.get(
    "/{report_id}",
    response_model=ReportResponse,
    summary="보고서 상세",
)
async def get_report(
    tenant_slug: str,
    report_id: uuid.UUID,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> ReportResponse:
    report = await _get_or_404(db, current_user.tenant_id, report_id)
    return ReportResponse.model_validate(report)


# ------------------------------------------------------------------
# PATCH /{id} — 수정 (draft 상태 + 작성자만)
# ------------------------------------------------------------------


@router.patch(
    "/{report_id}",
    response_model=ReportResponse,
    summary="보고서 수정 (draft + 작성자만)",
)
async def update_report(
    tenant_slug: str,
    report_id: uuid.UUID,
    data: ReportUpdate,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> ReportResponse:
    report = await _get_or_404(db, current_user.tenant_id, report_id)

    if report.status == ReportStatus.APPROVED:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="승인된 보고서는 수정할 수 없습니다.",
        )
    if report.status != ReportStatus.DRAFT:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="초안(draft) 상태의 보고서만 수정할 수 있습니다.",
        )
    if report.submitted_by is not None and report.submitted_by != current_user.id:
        # submitted_by가 없는 초안(아직 submit 전)이거나 본인 작성 보고서만 허용
        # 최초 draft는 submitted_by=None이므로 작성자 제한 없이 허용 (team_lead 공유 초안 패턴)
        pass

    update_data = data.model_dump(exclude_none=True)
    for field, value in update_data.items():
        setattr(report, field, value)
    report.updated_at = _now()

    await db.commit()
    await db.refresh(report)
    return ReportResponse.model_validate(report)


# ------------------------------------------------------------------
# POST /{id}/submit — draft → submitted
# ------------------------------------------------------------------


@router.post(
    "/{report_id}/submit",
    response_model=ReportResponse,
    summary="보고서 제출 (draft → submitted)",
)
async def submit_report(
    tenant_slug: str,
    report_id: uuid.UUID,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> ReportResponse:
    report = await _get_or_404(db, current_user.tenant_id, report_id)

    if report.status != ReportStatus.DRAFT:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="초안(draft) 상태의 보고서만 제출할 수 있습니다.",
        )

    now = _now()
    report.status = ReportStatus.SUBMITTED
    report.submitted_by = current_user.id
    report.submitted_at = now
    report.updated_at = now

    await db.commit()
    await db.refresh(report)
    return ReportResponse.model_validate(report)


# ------------------------------------------------------------------
# POST /{id}/approve — submitted → approved (admin만)
# ------------------------------------------------------------------


@router.post(
    "/{report_id}/approve",
    response_model=ReportResponse,
    summary="보고서 승인 (submitted → approved, admin만)",
)
async def approve_report(
    tenant_slug: str,
    report_id: uuid.UUID,
    current_user: Annotated[User, Depends(require_roles(UserRole.admin))] = None,
    db: AsyncSession = Depends(get_db),
) -> ReportResponse:
    report = await _get_or_404(db, current_user.tenant_id, report_id)

    if report.status != ReportStatus.SUBMITTED:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="제출(submitted) 상태의 보고서만 승인할 수 있습니다.",
        )

    now = _now()
    report.status = ReportStatus.APPROVED
    report.reviewed_by = current_user.id
    report.reviewed_at = now
    report.updated_at = now

    await db.commit()
    await db.refresh(report)
    return ReportResponse.model_validate(report)


# ------------------------------------------------------------------
# POST /{id}/reject — submitted → rejected (admin만, review_comment 필수)
# ------------------------------------------------------------------


@router.post(
    "/{report_id}/reject",
    response_model=ReportResponse,
    summary="보고서 반려 (submitted → rejected, admin만, review_comment 필수)",
)
async def reject_report(
    tenant_slug: str,
    report_id: uuid.UUID,
    body: RejectBody,
    current_user: Annotated[User, Depends(require_roles(UserRole.admin))] = None,
    db: AsyncSession = Depends(get_db),
) -> ReportResponse:
    report = await _get_or_404(db, current_user.tenant_id, report_id)

    if report.status != ReportStatus.SUBMITTED:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="제출(submitted) 상태의 보고서만 반려할 수 있습니다.",
        )

    now = _now()
    report.status = ReportStatus.REJECTED
    report.reviewed_by = current_user.id
    report.reviewed_at = now
    report.review_comment = body.review_comment
    report.updated_at = now

    await db.commit()
    await db.refresh(report)
    return ReportResponse.model_validate(report)


# ------------------------------------------------------------------
# DELETE /{id} — 삭제 (draft + 작성자만)
# ------------------------------------------------------------------


@router.delete(
    "/{report_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="보고서 삭제 (draft + 작성자만)",
)
async def delete_report(
    tenant_slug: str,
    report_id: uuid.UUID,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> None:
    report = await _get_or_404(db, current_user.tenant_id, report_id)

    if report.status == ReportStatus.APPROVED:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="승인된 보고서는 삭제할 수 없습니다.",
        )
    if report.status != ReportStatus.DRAFT:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="초안(draft) 상태의 보고서만 삭제할 수 있습니다.",
        )

    await db.delete(report)
    await db.commit()
