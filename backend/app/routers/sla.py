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

import logging
import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import and_, case, cast, func, select
from sqlalchemy import Float
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user, require_roles
from app.models import (
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

    # compliance_rate: resolved tickets / total tickets * 100
    total_tickets: int = await db.scalar(
        select(func.count()).select_from(Ticket).where(Ticket.tenant_id == tid)
    ) or 0
    resolved_tickets: int = await db.scalar(
        select(func.count())
        .select_from(Ticket)
        .where(
            and_(
                Ticket.tenant_id == tid,
                Ticket.status.in_([TicketStatus.resolved, TicketStatus.closed]),
            )
        )
    ) or 0
    compliance_rate = round(resolved_tickets / total_tickets * 100, 2) if total_tickets > 0 else 0.0

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
