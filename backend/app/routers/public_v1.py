"""공개 REST API v1 — API 키 인증 기반 티켓 CRUD.

prefix : /v1
인증   : Authorization: Bearer itsm_xxx (API 키, JWT 아님)
격리   : 테넌트는 API 키 소유자의 tenant_id 기준 (URL slug 없음)

엔드포인트:
  GET    /v1/tickets          — 목록 (status·priority·page·limit 필터)
  POST   /v1/tickets          — 생성
  GET    /v1/tickets/{id}     — 상세
  PATCH  /v1/tickets/{id}     — 수정 (status·priority·assigned_to)
  GET    /v1/usage            — API 사용량 + 플랜 한도 조회
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_api_key_user
from app.models import Ticket, TicketPriority, TicketStatus, TicketChannel, User

router = APIRouter(prefix="/v1", tags=["public-api-v1"])

# ──────────────────────────────────────────────────────────────────────────────
# 스키마
# ──────────────────────────────────────────────────────────────────────────────

class V1TicketCreate(BaseModel):
    title: str = Field(..., max_length=500)
    description: str | None = None
    priority: TicketPriority = TicketPriority.medium
    channel: TicketChannel = TicketChannel.internal
    customer_id: uuid.UUID | None = None
    contract_id: uuid.UUID | None = None
    assigned_to: uuid.UUID | None = None
    source: str | None = None
    request_type: str | None = None


class V1TicketUpdate(BaseModel):
    status: TicketStatus | None = None
    priority: TicketPriority | None = None
    assigned_to: uuid.UUID | None = None
    title: str | None = Field(None, max_length=500)
    description: str | None = None


class V1TicketOut(BaseModel):
    id: uuid.UUID
    ticket_number: str | None
    title: str
    description: str | None
    status: str
    priority: str
    channel: str
    customer_id: uuid.UUID | None
    contract_id: uuid.UUID | None
    assigned_to: uuid.UUID | None
    source: str | None
    request_type: str | None
    created_at: datetime
    updated_at: datetime
    resolved_at: datetime | None
    closed_at: datetime | None

    model_config = {"from_attributes": True}


class V1ListResponse(BaseModel):
    items: list[V1TicketOut]
    total: int
    page: int
    limit: int


# ──────────────────────────────────────────────────────────────────────────────
# 목록 조회
# ──────────────────────────────────────────────────────────────────────────────

@router.get("/tickets", response_model=V1ListResponse)
async def list_tickets_v1(
    current_user: Annotated[User, Depends(get_api_key_user)],
    db: AsyncSession = Depends(get_db),
    status_filter: str | None = Query(None, alias="status"),
    priority: str | None = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
) -> V1ListResponse:
    from sqlalchemy import func, and_

    conditions = [Ticket.tenant_id == current_user.tenant_id]
    if status_filter:
        try:
            conditions.append(Ticket.status == TicketStatus(status_filter))
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid status: {status_filter}")
    if priority:
        try:
            conditions.append(Ticket.priority == TicketPriority(priority))
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid priority: {priority}")

    total = await db.scalar(
        select(func.count()).select_from(Ticket).where(and_(*conditions))
    ) or 0
    rows = (
        await db.execute(
            select(Ticket)
            .where(and_(*conditions))
            .order_by(Ticket.created_at.desc())
            .offset((page - 1) * limit)
            .limit(limit)
        )
    ).scalars().all()

    return V1ListResponse(
        items=[V1TicketOut.model_validate(t) for t in rows],
        total=total,
        page=page,
        limit=limit,
    )


# ──────────────────────────────────────────────────────────────────────────────
# 단건 조회
# ──────────────────────────────────────────────────────────────────────────────

@router.get("/tickets/{ticket_id}", response_model=V1TicketOut)
async def get_ticket_v1(
    ticket_id: uuid.UUID,
    current_user: Annotated[User, Depends(get_api_key_user)],
    db: AsyncSession = Depends(get_db),
) -> V1TicketOut:
    ticket = (
        await db.execute(
            select(Ticket).where(
                Ticket.id == ticket_id,
                Ticket.tenant_id == current_user.tenant_id,
            )
        )
    ).scalar_one_or_none()
    if ticket is None:
        raise HTTPException(status_code=404, detail="Ticket not found.")
    return V1TicketOut.model_validate(ticket)


# ──────────────────────────────────────────────────────────────────────────────
# 생성
# ──────────────────────────────────────────────────────────────────────────────

@router.post("/tickets", response_model=V1TicketOut, status_code=status.HTTP_201_CREATED)
async def create_ticket_v1(
    body: V1TicketCreate,
    current_user: Annotated[User, Depends(get_api_key_user)],
    db: AsyncSession = Depends(get_db),
) -> V1TicketOut:
    from app.services import billing_service, activity_service
    from app.core.redis import get_redis

    redis = get_redis()
    await billing_service.check_ticket_limit(db, current_user.tenant_id, redis)

    # ticket_number 생성 (tickets.py 헬퍼와 동일 로직)
    from sqlalchemy import text
    from datetime import timezone
    today = datetime.now(timezone.utc).strftime("%Y%m%d")
    prefix = f"TKT-{today}-"
    lock_key = abs(hash(f"{current_user.tenant_id}:{today}")) % (2**31)
    await db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": lock_key})
    result = await db.execute(
        text("""
            SELECT COALESCE(MAX(CAST(SUBSTRING(ticket_number FROM :pl + 1) AS INTEGER)), 0)
            FROM tickets WHERE tenant_id = :tid AND ticket_number LIKE :pfx
        """),
        {"pl": len(prefix), "pfx": f"{prefix}%", "tid": str(current_user.tenant_id)},
    )
    max_seq = result.scalar() or 0
    ticket_number = f"{prefix}{str(max_seq + 1).zfill(4)}"

    ticket = Ticket(
        tenant_id=current_user.tenant_id,
        title=body.title,
        description=body.description,
        priority=body.priority,
        channel=body.channel,
        customer_id=body.customer_id,
        contract_id=body.contract_id,
        assigned_to=body.assigned_to,
        source=body.source,
        request_type=body.request_type,
        ticket_number=ticket_number,
        status=TicketStatus.open,
    )
    db.add(ticket)
    await activity_service.record(
        db, tenant_id=current_user.tenant_id, ticket_id=ticket.id,
        actor_id=current_user.id, event_type="created",
    )
    await db.commit()
    await db.refresh(ticket)
    return V1TicketOut.model_validate(ticket)


# ──────────────────────────────────────────────────────────────────────────────
# 수정
# ──────────────────────────────────────────────────────────────────────────────

@router.patch("/tickets/{ticket_id}", response_model=V1TicketOut)
async def update_ticket_v1(
    ticket_id: uuid.UUID,
    body: V1TicketUpdate,
    current_user: Annotated[User, Depends(get_api_key_user)],
    db: AsyncSession = Depends(get_db),
) -> V1TicketOut:
    from app.services import activity_service
    from datetime import timezone

    ticket = (
        await db.execute(
            select(Ticket).where(
                Ticket.id == ticket_id,
                Ticket.tenant_id == current_user.tenant_id,
            )
        )
    ).scalar_one_or_none()
    if ticket is None:
        raise HTTPException(status_code=404, detail="Ticket not found.")

    now = datetime.now(timezone.utc)

    if body.status is not None and body.status != ticket.status:
        prev = ticket.status.value if isinstance(ticket.status, TicketStatus) else str(ticket.status)
        ticket.status = body.status
        if body.status == TicketStatus.resolved and not ticket.resolved_at:
            ticket.resolved_at = now
        elif body.status == TicketStatus.closed and not ticket.closed_at:
            ticket.closed_at = now
        await activity_service.record(
            db, tenant_id=current_user.tenant_id, ticket_id=ticket_id,
            actor_id=current_user.id, event_type="status_changed",
            from_value=prev, to_value=body.status.value,
        )

    if body.priority is not None and body.priority != ticket.priority:
        prev = ticket.priority.value if isinstance(ticket.priority, TicketPriority) else str(ticket.priority)
        ticket.priority = body.priority
        await activity_service.record(
            db, tenant_id=current_user.tenant_id, ticket_id=ticket_id,
            actor_id=current_user.id, event_type="priority_changed",
            from_value=prev, to_value=body.priority.value,
        )

    if body.assigned_to is not None:
        ticket.assigned_to = body.assigned_to
        await activity_service.record(
            db, tenant_id=current_user.tenant_id, ticket_id=ticket_id,
            actor_id=current_user.id, event_type="assigned",
            to_value=str(body.assigned_to),
        )

    if body.title is not None:
        ticket.title = body.title
    if body.description is not None:
        ticket.description = body.description

    await db.commit()
    await db.refresh(ticket)
    return V1TicketOut.model_validate(ticket)


# ──────────────────────────────────────────────────────────────────────────────
# API 사용량 조회
# ──────────────────────────────────────────────────────────────────────────────

@router.get("/usage")
async def get_api_usage_v1(
    current_user: Annotated[User, Depends(get_api_key_user)],
    db: AsyncSession = Depends(get_db),
) -> dict:
    from app.core.redis import get_redis
    from app.services import billing_service
    from app.models.subscription import PLAN_LIMITS
    from datetime import timezone, date

    redis = get_redis()
    sub = await billing_service.get_subscription(db, current_user.tenant_id, redis)
    plan = billing_service._effective_plan(sub)
    limits = PLAN_LIMITS[plan]

    today = date.today().strftime("%Y%m%d")
    cache_key = f"itsm:api_calls:{current_user.tenant_id}:{today}"
    calls_today = 0
    try:
        val = await redis.get(cache_key)
        calls_today = int(val) if val else 0
    except Exception:
        pass

    return {
        "plan": plan.value,
        "api_calls_today": calls_today,
        "api_calls_daily_limit": limits.get("api_calls_daily"),
        "tickets_this_month": await billing_service._get_monthly_ticket_count(
            db, current_user.tenant_id,
            datetime.now(timezone.utc).strftime("%Y%m"), redis,
        ),
        "ticket_limit_monthly": limits["tickets_monthly"],
        "seats_used": await billing_service._get_engineer_count(db, current_user.tenant_id, redis),
        "seats_limit": limits["seats"],
    }
