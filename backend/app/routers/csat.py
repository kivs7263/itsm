"""CSAT (고객 만족도) 라우터.

두 개의 라우터:
- router_portal : /portal/{tenant_slug}/survey/{token}  — 인증 없음, survey_token으로 접근 제어
- router        : /{tenant_slug}/csat/...               — 내부 인증 필요

포털 엔드포인트:
  GET  /portal/{tenant_slug}/survey/{token}  — 설문 조회
  POST /portal/{tenant_slug}/survey/{token}  — 설문 제출

내부 엔드포인트:
  GET  /{tenant_slug}/csat/results                       — 설문 목록
  GET  /{tenant_slug}/csat/summary                       — 집계 통계
  POST /{tenant_slug}/tickets/{ticket_id}/csat           — 수동 CSAT 요청 (admin/team_lead)
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user, require_roles
from app.models.csat_survey import CSATSurvey, CSATStatus
from app.models.ticket import Ticket
from app.models.user import User, UserRole
from app.services import csat_service

logger = logging.getLogger(__name__)

# ------------------------------------------------------------------
# 포털 라우터 (인증 없음)
# ------------------------------------------------------------------

router_portal = APIRouter(prefix="/portal", tags=["csat-portal"])

# ------------------------------------------------------------------
# 내부 라우터 (인증 필요)
# ------------------------------------------------------------------

router = APIRouter(prefix="/{tenant_slug}/csat", tags=["csat"])


# ------------------------------------------------------------------
# 스키마
# ------------------------------------------------------------------


class SurveyPortalOut(BaseModel):
    id: uuid.UUID
    ticket_id: uuid.UUID
    ticket_title: str | None
    score: int | None
    comment: str | None
    status: str
    is_submitted: bool
    expires_at: datetime

    model_config = {"from_attributes": True}


class SurveySubmit(BaseModel):
    score: int = Field(..., ge=1, le=5)
    comment: str | None = None


class SurveyResultItem(BaseModel):
    id: uuid.UUID
    ticket_id: uuid.UUID
    ticket_title: str | None
    customer_name: str | None
    score: int | None
    comment: str | None
    status: str
    sent_at: datetime
    submitted_at: datetime | None

    model_config = {"from_attributes": True}


# ------------------------------------------------------------------
# 포털 — 설문 조회
# ------------------------------------------------------------------


@router_portal.get(
    "/{tenant_slug}/survey/{token}",
    summary="CSAT 설문 조회 (포털, 인증 없음)",
)
async def portal_get_survey(
    tenant_slug: str,
    token: str,
    db: AsyncSession = Depends(get_db),
) -> dict:
    survey = await db.scalar(
        select(CSATSurvey).where(CSATSurvey.survey_token == token)
    )
    if survey is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="설문을 찾을 수 없습니다.",
        )

    now = datetime.now(timezone.utc)

    # 만료 확인
    status_val = survey.status if isinstance(survey.status, str) else survey.status.value
    expires_at = survey.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)

    if status_val == CSATStatus.expired.value or expires_at < now:
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="설문이 만료되었습니다.",
        )

    is_submitted = status_val == CSATStatus.submitted.value

    # ticket_title 조회
    ticket = await db.scalar(
        select(Ticket).where(Ticket.id == survey.ticket_id)
    )
    ticket_title = ticket.title if ticket else None

    return {
        "id": survey.id,
        "ticket_id": survey.ticket_id,
        "ticket_title": ticket_title,
        "score": survey.score,
        "comment": survey.comment,
        "status": status_val,
        "is_submitted": is_submitted,
        "expires_at": survey.expires_at,
    }


# ------------------------------------------------------------------
# 포털 — 설문 제출
# ------------------------------------------------------------------


@router_portal.post(
    "/{tenant_slug}/survey/{token}",
    summary="CSAT 설문 제출 (포털, 인증 없음)",
)
async def portal_submit_survey(
    tenant_slug: str,
    token: str,
    data: SurveySubmit,
    db: AsyncSession = Depends(get_db),
) -> dict:
    survey = await db.scalar(
        select(CSATSurvey).where(CSATSurvey.survey_token == token)
    )
    if survey is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="설문을 찾을 수 없습니다.",
        )

    now = datetime.now(timezone.utc)

    # 만료 확인
    status_val = survey.status if isinstance(survey.status, str) else survey.status.value
    expires_at = survey.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)

    if status_val == CSATStatus.expired.value or expires_at < now:
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="설문이 만료되었습니다.",
        )

    if status_val != CSATStatus.pending.value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="이미 제출되었거나 만료된 설문입니다.",
        )

    survey.score = data.score
    survey.comment = data.comment
    survey.status = CSATStatus.submitted.value
    survey.submitted_at = now

    await db.commit()
    return {"message": "설문이 제출되었습니다. 감사합니다."}


# ------------------------------------------------------------------
# 내부 — 설문 목록
# ------------------------------------------------------------------


@router.get(
    "/results",
    summary="CSAT 설문 목록 (내부, 인증 필요)",
)
async def list_csat_results(
    tenant_slug: str,
    survey_status: CSATStatus | None = Query(None, alias="status"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> dict:
    conditions = [CSATSurvey.tenant_id == current_user.tenant_id]
    if survey_status is not None:
        conditions.append(CSATSurvey.status == survey_status.value)

    where_clause = and_(*conditions)

    from sqlalchemy import func
    total = await db.scalar(
        select(func.count()).select_from(CSATSurvey).where(where_clause)
    )
    rows = (
        await db.execute(
            select(CSATSurvey)
            .where(where_clause)
            .order_by(CSATSurvey.sent_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    ).scalars().all()

    # ticket_title, customer_name 조회
    ticket_ids = [r.ticket_id for r in rows]
    customer_ids = [r.customer_id for r in rows if r.customer_id]

    tickets_map: dict[uuid.UUID, str] = {}
    customers_map: dict[uuid.UUID, str] = {}

    if ticket_ids:
        from app.models.ticket import Ticket
        ticket_rows = (
            await db.execute(
                select(Ticket.id, Ticket.title).where(Ticket.id.in_(ticket_ids))
            )
        ).all()
        tickets_map = {r.id: r.title for r in ticket_rows}

    if customer_ids:
        from app.models.customer import Customer
        customer_rows = (
            await db.execute(
                select(Customer.id, Customer.name).where(Customer.id.in_(customer_ids))
            )
        ).all()
        customers_map = {r.id: r.name for r in customer_rows}

    items = []
    for s in rows:
        status_str = s.status if isinstance(s.status, str) else s.status.value
        items.append({
            "id": s.id,
            "ticket_id": s.ticket_id,
            "ticket_title": tickets_map.get(s.ticket_id),
            "customer_name": customers_map.get(s.customer_id) if s.customer_id else None,
            "score": s.score,
            "comment": s.comment,
            "status": status_str,
            "sent_at": s.sent_at,
            "submitted_at": s.submitted_at,
        })

    return {"items": items, "total": total}


# ------------------------------------------------------------------
# 내부 — 집계 통계
# ------------------------------------------------------------------


@router.get(
    "/summary",
    summary="CSAT 집계 통계 (내부, 인증 필요)",
)
async def get_csat_summary(
    tenant_slug: str,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> dict:
    return await csat_service.get_summary(db, current_user.tenant_id)


# ------------------------------------------------------------------
# 내부 — 수동 CSAT 요청 (admin/team_lead)
# ------------------------------------------------------------------

# 고정 경로(/results, /summary)를 파라미터 경로 앞에 두기 위해
# 별도 라우터로 수동 CSAT 엔드포인트 정의.
# prefix가 /{tenant_slug}/csat 이므로 tickets/{ticket_id}/csat 경로는
# 티켓 라우터 prefix 아래가 아닌 별도 prefix로 분리.
_router_tickets_csat = APIRouter(
    prefix="/{tenant_slug}/tickets",
    tags=["csat"],
)


@_router_tickets_csat.post(
    "/{ticket_id}/csat",
    status_code=status.HTTP_201_CREATED,
    summary="수동 CSAT 요청 (admin/team_lead)",
)
async def request_csat_manual(
    tenant_slug: str,
    ticket_id: uuid.UUID,
    current_user: Annotated[
        User, Depends(require_roles(UserRole.admin, UserRole.team_lead))
    ] = None,
    db: AsyncSession = Depends(get_db),
) -> dict:
    # 티켓 존재 + 테넌트 격리 확인
    ticket = await db.scalar(
        select(Ticket).where(
            and_(
                Ticket.id == ticket_id,
                Ticket.tenant_id == current_user.tenant_id,
            )
        )
    )
    if ticket is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="티켓을 찾을 수 없습니다.",
        )

    survey = await csat_service.maybe_create_survey(db, ticket)
    if survey is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="customer_id 없음 또는 이미 설문이 존재합니다.",
        )

    await db.commit()
    return {
        "survey_id": survey.id,
        "survey_token": survey.survey_token,
        "expires_at": survey.expires_at,
    }


# router에 _router_tickets_csat 통합 (main.py에서 router만 등록하면 됨)
# main.py에서는 router_portal 과 _router_tickets_csat 를 별도 등록해야 함.
# 외부에서 import할 수 있도록 노출.
router_tickets_csat = _router_tickets_csat
