"""SLA 정책 / 이벤트 / 대시보드 라우터.

prefix : /{tenant_slug}/sla
인증   : get_current_user
격리   : 모든 쿼리 tenant_id == current_user.tenant_id

엔드포인트:
  GET  /{tenant_slug}/sla/policies          — SLA 정책 목록
  POST /{tenant_slug}/sla/policies          — 정책 생성/UPSERT (admin)
  PUT  /{tenant_slug}/sla/policies/{id}     — 정책 수정 (admin)
  GET  /{tenant_slug}/sla/events            — SLA 이벤트 목록
  GET  /{tenant_slug}/sla/dashboard         — SLA 대시보드
"""
from __future__ import annotations

import io
import logging
import re
import uuid
from datetime import datetime, timezone, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from fpdf import FPDF
from pydantic import BaseModel, Field
from sqlalchemy import and_, case, cast, func, select
from sqlalchemy import Float
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user, require_roles
from app.models import (
    SLABusinessCalendar,
    SLAEvent,
    SLAEventType,
    SLAGrade,
    SLAPolicy,
    Ticket,
    TicketStatus,
    User,
    UserRole,
)

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/{tenant_slug}/sla",
    tags=["sla"],
)


# ------------------------------------------------------------------
# 스키마
# ------------------------------------------------------------------


class SLAPolicyCreate(BaseModel):
    grade: SLAGrade
    response_minutes: int = Field(..., ge=1)
    resolution_minutes: int = Field(..., ge=1)


class SLAPolicyUpdate(BaseModel):
    response_minutes: int | None = Field(None, ge=1)
    resolution_minutes: int | None = Field(None, ge=1)


class SLAPolicyOut(BaseModel):
    id: uuid.UUID
    tenant_id: uuid.UUID
    grade: str
    response_minutes: int
    resolution_minutes: int
    created_at: datetime

    model_config = {"from_attributes": True}


class SLAEventOut(BaseModel):
    id: uuid.UUID
    tenant_id: uuid.UUID
    ticket_id: uuid.UUID
    event_type: str
    fired_at: datetime

    model_config = {"from_attributes": True}


# ------------------------------------------------------------------
# 헬퍼
# ------------------------------------------------------------------


async def _get_policy_or_404(
    db: AsyncSession, tenant_id: uuid.UUID, policy_id: uuid.UUID
) -> SLAPolicy:
    row = await db.scalar(
        select(SLAPolicy).where(
            and_(SLAPolicy.id == policy_id, SLAPolicy.tenant_id == tenant_id)
        )
    )
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="SLA 정책을 찾을 수 없습니다.")
    return row


# ------------------------------------------------------------------
# 정책 목록
# ------------------------------------------------------------------


@router.get(
    "/policies",
    response_model=list[SLAPolicyOut],
    summary="SLA 정책 목록",
)
async def list_policies(
    tenant_slug: str,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> list[SLAPolicyOut]:
    rows = (
        await db.execute(
            select(SLAPolicy)
            .where(SLAPolicy.tenant_id == current_user.tenant_id)
            .order_by(SLAPolicy.grade)
        )
    ).scalars().all()
    return [SLAPolicyOut.model_validate(r) for r in rows]


# ------------------------------------------------------------------
# 정책 생성 (UPSERT: 같은 grade면 update)
# ------------------------------------------------------------------


@router.post(
    "/policies",
    response_model=SLAPolicyOut,
    status_code=status.HTTP_200_OK,
    summary="SLA 정책 생성/UPSERT (admin)",
)
async def create_or_update_policy(
    tenant_slug: str,
    data: SLAPolicyCreate,
    current_user: Annotated[User, Depends(require_roles(UserRole.admin))] = None,
    db: AsyncSession = Depends(get_db),
) -> SLAPolicyOut:
    # UPSERT: 이미 존재하는 grade면 update
    existing = await db.scalar(
        select(SLAPolicy).where(
            and_(
                SLAPolicy.tenant_id == current_user.tenant_id,
                SLAPolicy.grade == data.grade,
            )
        )
    )
    if existing:
        existing.response_minutes = data.response_minutes
        existing.resolution_minutes = data.resolution_minutes
        await db.commit()
        await db.refresh(existing)
        return SLAPolicyOut.model_validate(existing)

    policy = SLAPolicy(
        id=uuid.uuid4(),
        tenant_id=current_user.tenant_id,
        grade=data.grade,
        response_minutes=data.response_minutes,
        resolution_minutes=data.resolution_minutes,
    )
    db.add(policy)
    await db.commit()
    await db.refresh(policy)
    return SLAPolicyOut.model_validate(policy)


# ------------------------------------------------------------------
# 정책 수정
# ------------------------------------------------------------------


@router.put(
    "/policies/{policy_id}",
    response_model=SLAPolicyOut,
    summary="SLA 정책 수정 (admin)",
)
async def update_policy(
    tenant_slug: str,
    policy_id: uuid.UUID,
    data: SLAPolicyUpdate,
    current_user: Annotated[User, Depends(require_roles(UserRole.admin))] = None,
    db: AsyncSession = Depends(get_db),
) -> SLAPolicyOut:
    policy = await _get_policy_or_404(db, current_user.tenant_id, policy_id)

    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(policy, field, value)

    await db.commit()
    await db.refresh(policy)
    return SLAPolicyOut.model_validate(policy)


# ------------------------------------------------------------------
# 이벤트 목록
# ------------------------------------------------------------------


@router.get(
    "/events",
    response_model=dict,
    summary="SLA 이벤트 목록",
)
async def list_events(
    tenant_slug: str,
    ticket_id: uuid.UUID | None = Query(None),
    event_type: SLAEventType | None = Query(None),
    since: datetime | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> dict:
    conditions = [SLAEvent.tenant_id == current_user.tenant_id]

    if ticket_id:
        conditions.append(SLAEvent.ticket_id == ticket_id)
    if event_type:
        conditions.append(SLAEvent.event_type == event_type)
    if since:
        conditions.append(SLAEvent.fired_at >= since)

    where_clause = and_(*conditions)
    total = await db.scalar(
        select(func.count()).select_from(SLAEvent).where(where_clause)
    )
    rows = (
        await db.execute(
            select(SLAEvent)
            .where(where_clause)
            .order_by(SLAEvent.fired_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    ).scalars().all()

    return {
        "items": [SLAEventOut.model_validate(r) for r in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


# ------------------------------------------------------------------
# 대시보드
# ------------------------------------------------------------------


@router.get(
    "/dashboard",
    summary="SLA 대시보드",
)
async def sla_dashboard(
    tenant_slug: str,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> dict:
    tid = current_user.tenant_id

    # 활성 티켓 수 (resolved/closed 제외)
    _active_statuses = [TicketStatus.open, TicketStatus.in_progress, TicketStatus.pending]
    total_active: int = await db.scalar(
        select(func.count())
        .select_from(Ticket)
        .where(
            and_(
                Ticket.tenant_id == tid,
                Ticket.status.in_(_active_statuses),
            )
        )
    ) or 0

    # breached_tickets: SLAEvent.event_type == "breached" AND ticket.status not in (resolved, closed)
    breached_subq = (
        select(SLAEvent.ticket_id)
        .join(Ticket, SLAEvent.ticket_id == Ticket.id)
        .where(
            and_(
                SLAEvent.tenant_id == tid,
                SLAEvent.event_type == SLAEventType.breached,
                Ticket.status.notin_([TicketStatus.resolved, TicketStatus.closed]),
            )
        )
        .distinct()
        .scalar_subquery()
    )
    breached_count: int = await db.scalar(
        select(func.count()).select_from(breached_subq.alias())
    ) or 0

    # warning_tickets: SLAEvent.event_type == "breach_warning" AND ticket active
    warning_subq = (
        select(SLAEvent.ticket_id)
        .join(Ticket, SLAEvent.ticket_id == Ticket.id)
        .where(
            and_(
                SLAEvent.tenant_id == tid,
                SLAEvent.event_type == SLAEventType.breach_warning,
                Ticket.status.in_(_active_statuses),
            )
        )
        .distinct()
        .scalar_subquery()
    )
    warning_count: int = await db.scalar(
        select(func.count()).select_from(warning_subq.alias())
    ) or 0

    # compliance_rate — distinct breach 티켓 기준: 1 - (SLA 위반 고유 티켓 수 / 전체 티켓 수)
    # 이벤트 건수(COUNT(*)) 사용 시 response+resolution 2건 위반이 분자를 2 증가시켜 음수 가능.
    # (sla_worker.py: response breach·resolution breach 각각 별도 INSERT → 티켓 1개 = 최대 2이벤트)
    # 분모: 전체 티켓 수. SLA 미적용 티켓 포함 시 준수율 과대계상 가능.
    # (sla_worker.py:235 contract_id IS NOT NULL 참조 — 분모 정제는 향후 개선 과제)
    total_tickets: int = await db.scalar(
        select(func.count()).select_from(Ticket).where(Ticket.tenant_id == tid)
    ) or 0
    sla_breach_ticket_count: int = await db.scalar(
        select(func.count(SLAEvent.ticket_id.distinct()))
        .select_from(SLAEvent)
        .where(
            and_(
                SLAEvent.tenant_id == tid,
                SLAEvent.event_type == SLAEventType.breached,
            )
        )
    ) or 0
    compliance_rate = (
        round(max(0.0, 1.0 - sla_breach_ticket_count / total_tickets) * 100, 2)
        if total_tickets > 0 else 100.0
    )

    # 평균 해결 시간 (분)
    avg_minutes_row = await db.scalar(
        select(
            func.avg(
                func.extract(
                    "epoch",
                    Ticket.resolved_at - Ticket.created_at,
                ) / 60
            )
        )
        .where(
            and_(
                Ticket.tenant_id == tid,
                Ticket.resolved_at.isnot(None),
            )
        )
    )
    avg_resolution_minutes = round(float(avg_minutes_row), 1) if avg_minutes_row else 0.0

    # 정책 목록
    policies = (
        await db.execute(
            select(SLAPolicy)
            .where(SLAPolicy.tenant_id == tid)
            .order_by(SLAPolicy.grade)
        )
    ).scalars().all()

    return {
        "total_active_tickets": total_active,
        "breached_tickets": breached_count,
        "warning_tickets": warning_count,
        "compliance_rate": compliance_rate,
        "avg_resolution_minutes": avg_resolution_minutes,
        "policy_by_grade": [
            {
                "grade": p.grade if isinstance(p.grade, str) else p.grade.value,
                "response_minutes": p.response_minutes,
                "resolution_minutes": p.resolution_minutes,
            }
            for p in policies
        ],
    }


# ------------------------------------------------------------------
# SLA 리포트 PDF 다운로드
# ------------------------------------------------------------------


@router.get(
    "/report/pdf",
    summary="SLA 리포트 PDF 다운로드",
)
async def download_sla_report_pdf(
    tenant_slug: str,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> StreamingResponse:
    tid = current_user.tenant_id

    # --- KPI 집계 (sla_dashboard 동일 로직) ---
    _active_statuses = [TicketStatus.open, TicketStatus.in_progress, TicketStatus.pending]

    total_active: int = await db.scalar(
        select(func.count())
        .select_from(Ticket)
        .where(
            and_(
                Ticket.tenant_id == tid,
                Ticket.status.in_(_active_statuses),
            )
        )
    ) or 0

    breached_subq = (
        select(SLAEvent.ticket_id)
        .join(Ticket, SLAEvent.ticket_id == Ticket.id)
        .where(
            and_(
                SLAEvent.tenant_id == tid,
                SLAEvent.event_type == SLAEventType.breached,
                Ticket.status.notin_([TicketStatus.resolved, TicketStatus.closed]),
            )
        )
        .distinct()
        .scalar_subquery()
    )
    breached_count: int = await db.scalar(
        select(func.count()).select_from(breached_subq.alias())
    ) or 0

    warning_subq = (
        select(SLAEvent.ticket_id)
        .join(Ticket, SLAEvent.ticket_id == Ticket.id)
        .where(
            and_(
                SLAEvent.tenant_id == tid,
                SLAEvent.event_type == SLAEventType.breach_warning,
                Ticket.status.in_(_active_statuses),
            )
        )
        .distinct()
        .scalar_subquery()
    )
    warning_count: int = await db.scalar(
        select(func.count()).select_from(warning_subq.alias())
    ) or 0

    total_tickets: int = await db.scalar(
        select(func.count()).select_from(Ticket).where(Ticket.tenant_id == tid)
    ) or 0
    # distinct breach 티켓 기준 준수율 — sla_dashboard와 동일 공식 (음수 방지 포함)
    pdf_sla_breach_ticket_count: int = await db.scalar(
        select(func.count(SLAEvent.ticket_id.distinct()))
        .select_from(SLAEvent)
        .where(
            and_(
                SLAEvent.tenant_id == tid,
                SLAEvent.event_type == SLAEventType.breached,
            )
        )
    ) or 0
    compliance_rate = (
        round(max(0.0, 1.0 - pdf_sla_breach_ticket_count / total_tickets) * 100, 2)
        if total_tickets > 0 else 100.0
    )

    avg_minutes_row = await db.scalar(
        select(
            func.avg(
                func.extract(
                    "epoch",
                    Ticket.resolved_at - Ticket.created_at,
                ) / 60
            )
        )
        .where(
            and_(
                Ticket.tenant_id == tid,
                Ticket.resolved_at.isnot(None),
            )
        )
    )
    avg_resolution_minutes = round(float(avg_minutes_row), 1) if avg_minutes_row else 0.0

    # --- 정책 조회 (최대 20개) ---
    policies = (
        await db.execute(
            select(SLAPolicy)
            .where(SLAPolicy.tenant_id == tid)
            .order_by(SLAPolicy.grade)
            .limit(20)
        )
    ).scalars().all()

    # --- 최근 30일 이벤트 (최대 50개) ---
    since_30d = datetime.now(timezone.utc) - timedelta(days=30)
    events = (
        await db.execute(
            select(SLAEvent)
            .where(
                and_(
                    SLAEvent.tenant_id == tid,
                    SLAEvent.fired_at >= since_30d,
                )
            )
            .order_by(SLAEvent.fired_at.desc())
            .limit(50)
        )
    ).scalars().all()

    # --- PDF 생성 ---
    # fpdf2 표준 패턴: footer 오버라이드는 서브클래스로, add_page 전에 인스턴스화
    class _SLAReportPDF(FPDF):
        def footer(self) -> None:
            self.set_y(-15)
            self.set_font("Helvetica", size=8)
            self.cell(0, 10, f"Page {self.page_no()}/{{nb}}", align="C")

    pdf = _SLAReportPDF()
    pdf.alias_nb_pages()  # {nb} 치환 등록 — add_page 전 호출
    pdf.set_auto_page_break(auto=True, margin=20)
    pdf.add_page()

    row_h = 8

    # 헤더
    pdf.set_font("Helvetica", style="B", size=20)
    pdf.cell(0, 12, "SLA Report", new_x="LMARGIN", new_y="NEXT", align="C")

    generated_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    pdf.set_font("Helvetica", size=10)
    pdf.cell(
        0,
        8,
        f"Generated: {generated_date}  |  Tenant: {tenant_slug}",
        new_x="LMARGIN",
        new_y="NEXT",
        align="C",
    )
    pdf.ln(2)
    pdf.set_draw_color(180, 180, 180)
    pdf.line(pdf.l_margin, pdf.get_y(), pdf.w - pdf.r_margin, pdf.get_y())
    pdf.ln(6)

    # KPI 요약 섹션
    pdf.set_font("Helvetica", style="B", size=14)
    pdf.cell(0, 10, "Summary", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(2)

    kpi_rows = [
        ("Active Tickets", str(total_active)),
        ("Breached", str(breached_count)),
        ("Warning", str(warning_count)),
        ("Compliance Rate", f"{compliance_rate}%"),
        ("Avg Resolution (min)", str(avg_resolution_minutes)),
    ]
    label_w = 80
    value_w = 60

    pdf.set_font("Helvetica", style="B", size=10)
    pdf.set_fill_color(230, 230, 230)
    pdf.cell(label_w, row_h, "Metric", border=1, fill=True)
    pdf.cell(value_w, row_h, "Value", border=1, fill=True, new_x="LMARGIN", new_y="NEXT")

    pdf.set_font("Helvetica", size=10)
    for label, value in kpi_rows:
        pdf.cell(label_w, row_h, label, border=1)
        pdf.cell(value_w, row_h, value, border=1, new_x="LMARGIN", new_y="NEXT")
    pdf.ln(8)

    # 정책 섹션
    pdf.set_font("Helvetica", style="B", size=14)
    pdf.cell(0, 10, "SLA Policies", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(2)

    col_w = [40, 50, 55, 45]
    pol_headers = ["Grade", "Response (min)", "Resolution (min)", "Business Hours"]

    pdf.set_font("Helvetica", style="B", size=10)
    pdf.set_fill_color(230, 230, 230)
    for i, h in enumerate(pol_headers):
        pdf.cell(col_w[i], row_h, h, border=1, fill=True)
    pdf.ln()

    pdf.set_font("Helvetica", size=10)
    if policies:
        for p in policies:
            grade_val = p.grade if isinstance(p.grade, str) else p.grade.value
            bh = str(getattr(p, "business_hours", "-"))
            pdf.cell(col_w[0], row_h, grade_val, border=1)
            pdf.cell(col_w[1], row_h, str(p.response_minutes), border=1)
            pdf.cell(col_w[2], row_h, str(p.resolution_minutes), border=1)
            pdf.cell(col_w[3], row_h, bh, border=1)
            pdf.ln()
    else:
        pdf.cell(sum(col_w), row_h, "No policies defined.", border=1, new_x="LMARGIN", new_y="NEXT")
    pdf.ln(8)

    # 이벤트 섹션
    pdf.set_font("Helvetica", style="B", size=14)
    pdf.cell(0, 10, "Recent Events (last 30 days)", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(2)

    ev_col_w = [50, 60, 80]
    ev_headers = ["Event Type", "Ticket ID", "Fired At"]

    pdf.set_font("Helvetica", style="B", size=10)
    pdf.set_fill_color(230, 230, 230)
    for i, h in enumerate(ev_headers):
        pdf.cell(ev_col_w[i], row_h, h, border=1, fill=True)
    pdf.ln()

    pdf.set_font("Helvetica", size=10)
    if events:
        for ev in events:
            ev_type = ev.event_type if isinstance(ev.event_type, str) else ev.event_type.value
            ticket_short = str(ev.ticket_id)[:8]
            fired_str = ev.fired_at.strftime("%Y-%m-%d %H:%M") if ev.fired_at else "-"
            pdf.cell(ev_col_w[0], row_h, ev_type, border=1)
            pdf.cell(ev_col_w[1], row_h, ticket_short, border=1)
            pdf.cell(ev_col_w[2], row_h, fired_str, border=1)
            pdf.ln()
    else:
        pdf.cell(sum(ev_col_w), row_h, "No events in the last 30 days.", border=1, new_x="LMARGIN", new_y="NEXT")

    pdf_bytes = bytes(pdf.output())
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": "attachment; filename=sla-report.pdf"},
    )


# ------------------------------------------------------------------
# 업무시간 캘린더 스키마
# ------------------------------------------------------------------

_HM_RE = re.compile(r"^\d{2}:\d{2}$")
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_VALID_DAYS = {"mon", "tue", "wed", "thu", "fri", "sat", "sun"}


def _validate_business_hours(bh: Any) -> str | None:
    """business_hours_json 유효성 검사. 오류 메시지 반환 (정상이면 None)."""
    if not isinstance(bh, dict):
        return "business_hours_json은 dict여야 합니다."
    for key, intervals in bh.items():
        if key not in _VALID_DAYS:
            return f"유효하지 않은 요일 키: '{key}'. 허용값: {sorted(_VALID_DAYS)}"
        if not isinstance(intervals, list):
            return f"'{key}'의 값은 리스트여야 합니다."
        for idx, iv in enumerate(intervals):
            if not isinstance(iv, list) or len(iv) != 2:
                return f"'{key}'[{idx}]: 구간은 [시작HH:MM, 종료HH:MM] 형식이어야 합니다."
            s, e = iv[0], iv[1]
            if not isinstance(s, str) or not isinstance(e, str):
                return f"'{key}'[{idx}]: 구간 값은 문자열이어야 합니다."
            if not _HM_RE.match(s) or not _HM_RE.match(e):
                return f"'{key}'[{idx}]: HH:MM 형식이 아닙니다 ('{s}', '{e}')."
            sh, sm = int(s[:2]), int(s[3:])
            eh, em = int(e[:2]), int(e[3:])
            if sh * 60 + sm >= eh * 60 + em:
                return f"'{key}'[{idx}]: 시작({s})이 종료({e}) 이상입니다."
    return None


def _validate_holidays(holidays: Any) -> str | None:
    """holidays_json 유효성 검사. 오류 메시지 반환 (정상이면 None)."""
    if not isinstance(holidays, list):
        return "holidays_json은 리스트여야 합니다."
    for idx, h in enumerate(holidays):
        if not isinstance(h, str) or not _DATE_RE.match(h):
            return f"holidays[{idx}]: YYYY-MM-DD 형식이 아닙니다 ('{h}')."
    return None


class BusinessCalendarIn(BaseModel):
    business_hours_json: dict = Field(
        ...,
        description=(
            '요일별 영업 구간. 예: {"mon":[["09:00","18:00"]],"sat":[],"sun":[]}'
        ),
    )
    timezone: str = Field(default="Asia/Seoul", description="IANA 타임존 이름")
    holidays_json: list[str] = Field(
        default_factory=list,
        description="공휴일 목록 [YYYY-MM-DD, ...] — 해당일 종일 휴무",
    )


class BusinessCalendarOut(BaseModel):
    id: uuid.UUID
    tenant_id: uuid.UUID
    business_hours_json: dict
    timezone: str
    holidays_json: list[str]
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ------------------------------------------------------------------
# GET /{tenant_slug}/sla/business-calendar
# ------------------------------------------------------------------


@router.get(
    "/business-calendar",
    response_model=BusinessCalendarOut | None,
    summary="업무시간 캘린더 조회",
)
async def get_business_calendar(
    tenant_slug: str,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> BusinessCalendarOut | None:
    """현재 테넌트의 업무시간 캘린더를 반환합니다.
    캘린더 미설정 시 null을 반환합니다 (벽시계 모드 = 기본값).
    """
    row = await db.scalar(
        select(SLABusinessCalendar).where(
            SLABusinessCalendar.tenant_id == current_user.tenant_id
        )
    )
    if row is None:
        return None
    return BusinessCalendarOut.model_validate(row)


# ------------------------------------------------------------------
# PUT /{tenant_slug}/sla/business-calendar
# ------------------------------------------------------------------


@router.put(
    "/business-calendar",
    response_model=BusinessCalendarOut,
    status_code=status.HTTP_200_OK,
    summary="업무시간 캘린더 저장/갱신 (admin)",
)
async def upsert_business_calendar(
    tenant_slug: str,
    data: BusinessCalendarIn,
    current_user: Annotated[User, Depends(require_roles(UserRole.admin))] = None,
    db: AsyncSession = Depends(get_db),
) -> BusinessCalendarOut:
    """테넌트 업무시간 캘린더를 저장합니다 (테넌트당 1행 UPSERT).

    business_hours_json 형식:
        {"mon":[["09:00","18:00"]], ..., "sat":[], "sun":[]}
        복수 구간 가능: [["09:00","12:00"],["13:00","18:00"]]

    설정 후 신규 티켓부터 업무시간 기반 SLA deadline이 적용됩니다.
    캘린더 삭제(벽시계 복귀)는 별도 DELETE 엔드포인트로 제공 예정.
    """
    # ── 입력 검증 ──────────────────────────────────────────────────
    bh_err = _validate_business_hours(data.business_hours_json)
    if bh_err:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"business_hours_json 오류: {bh_err}",
        )

    hol_err = _validate_holidays(data.holidays_json)
    if hol_err:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"holidays_json 오류: {hol_err}",
        )

    # timezone 유효성: ZoneInfo 시도
    try:
        from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
        ZoneInfo(data.timezone)
    except (KeyError, ZoneInfoNotFoundError, Exception):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"timezone 오류: '{data.timezone}'은 유효한 IANA 타임존이 아닙니다.",
        )

    # ── UPSERT ─────────────────────────────────────────────────────
    existing = await db.scalar(
        select(SLABusinessCalendar).where(
            SLABusinessCalendar.tenant_id == current_user.tenant_id
        )
    )

    if existing:
        existing.business_hours_json = data.business_hours_json
        existing.timezone = data.timezone
        existing.holidays_json = data.holidays_json
        await db.commit()
        await db.refresh(existing)
        return BusinessCalendarOut.model_validate(existing)

    cal = SLABusinessCalendar(
        id=uuid.uuid4(),
        tenant_id=current_user.tenant_id,
        business_hours_json=data.business_hours_json,
        timezone=data.timezone,
        holidays_json=data.holidays_json,
    )
    db.add(cal)
    await db.commit()
    await db.refresh(cal)
    return BusinessCalendarOut.model_validate(cal)
