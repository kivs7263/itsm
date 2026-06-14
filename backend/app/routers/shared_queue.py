"""공유 큐 라우터.

prefix : /{tenant_slug}/queue
인증   : get_current_user
격리   : tenant_id 필터

미배정 티켓 팀 공개 + SELECT FOR UPDATE SKIP LOCKED (Optimistic Locking)

엔드포인트:
  GET    /{tenant_slug}/queue                         — 미배정 티켓 목록
  POST   /{tenant_slug}/queue/{ticket_id}/claim       — 접수하기 (SKIP LOCKED)
  POST   /{tenant_slug}/queue/{ticket_id}/assign      — 배정하기 (팀장/admin)
  POST   /{tenant_slug}/queue/{ticket_id}/release     — 반납 (담당자 → 미배정)
  GET    /{tenant_slug}/queue/count                   — 미배정 카운트 (배지용)
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user, require_roles
from app.models import Ticket, TicketStatus, User, UserRole

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/{tenant_slug}/queue",
    tags=["shared_queue"],
)


# ------------------------------------------------------------------
# 스키마
# ------------------------------------------------------------------


class QueueTicketOut(BaseModel):
    id: uuid.UUID
    ticket_number: str | None
    title: str
    priority: str
    request_type: str | None
    customer_id: uuid.UUID | None
    assigned_to: uuid.UUID | None
    created_at: datetime

    model_config = {"from_attributes": True}


class AssignRequest(BaseModel):
    engineer_id: uuid.UUID


# ------------------------------------------------------------------
# 목록 — 고정 경로 먼저
# ------------------------------------------------------------------


@router.get(
    "/count",
    response_model=dict,
    summary="미배정 티켓 카운트 (배지용)",
)
async def get_queue_count(
    tenant_slug: str,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> dict:
    count = await db.scalar(
        select(func.count()).select_from(Ticket).where(
            and_(
                Ticket.tenant_id == current_user.tenant_id,
                Ticket.assigned_to.is_(None),
                Ticket.status.in_([TicketStatus.open, TicketStatus.pending]),
            )
        )
    )
    return {"count": count or 0}


@router.get(
    "",
    response_model=dict,
    summary="미배정 티켓 목록",
)
async def list_queue(
    tenant_slug: str,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> dict:
    conditions = [
        Ticket.tenant_id == current_user.tenant_id,
        Ticket.assigned_to.is_(None),
        Ticket.status.in_([TicketStatus.open, TicketStatus.pending]),
    ]
    total = await db.scalar(
        select(func.count()).select_from(Ticket).where(and_(*conditions))
    )
    rows = (
        await db.execute(
            select(Ticket)
            .where(and_(*conditions))
            .order_by(Ticket.created_at.asc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    ).scalars().all()

    return {
        "items": [QueueTicketOut.model_validate(r) for r in rows],
        "total": total or 0,
        "page": page,
        "page_size": page_size,
    }


# ------------------------------------------------------------------
# 접수하기 (SELECT FOR UPDATE SKIP LOCKED)
# ------------------------------------------------------------------


@router.post(
    "/{ticket_id}/claim",
    response_model=QueueTicketOut,
    summary="접수하기 — 선착순 (SKIP LOCKED)",
)
async def claim_ticket(
    tenant_slug: str,
    ticket_id: uuid.UUID,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> QueueTicketOut:
    async with db.begin():
        # SKIP LOCKED: 이미 다른 트랜잭션이 잠근 행은 건너뜀
        ticket = await db.scalar(
            select(Ticket)
            .where(
                and_(
                    Ticket.id == ticket_id,
                    Ticket.tenant_id == current_user.tenant_id,
                    Ticket.assigned_to.is_(None),
                )
            )
            .with_for_update(skip_locked=True)
        )
        if ticket is None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="이미 다른 담당자가 접수했습니다.",
            )
        ticket.assigned_to = current_user.id

    await db.refresh(ticket)
    return QueueTicketOut.model_validate(ticket)


# ------------------------------------------------------------------
# 배정하기 (팀장/admin)
# ------------------------------------------------------------------


@router.post(
    "/{ticket_id}/assign",
    response_model=QueueTicketOut,
    summary="배정하기 (팀장/admin 전용)",
)
async def assign_ticket(
    tenant_slug: str,
    ticket_id: uuid.UUID,
    data: AssignRequest,
    current_user: Annotated[User, Depends(require_roles(UserRole.team_lead, UserRole.admin))] = None,
    db: AsyncSession = Depends(get_db),
) -> QueueTicketOut:
    ticket = await db.scalar(
        select(Ticket).where(
            and_(
                Ticket.id == ticket_id,
                Ticket.tenant_id == current_user.tenant_id,
            )
        )
    )
    if ticket is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="티켓을 찾을 수 없습니다.")

    ticket.assigned_to = data.engineer_id
    await db.commit()
    await db.refresh(ticket)
    return QueueTicketOut.model_validate(ticket)


# ------------------------------------------------------------------
# 반납 (담당자 → 미배정)
# ------------------------------------------------------------------


@router.post(
    "/{ticket_id}/release",
    response_model=QueueTicketOut,
    summary="반납 — 담당자 해제",
)
async def release_ticket(
    tenant_slug: str,
    ticket_id: uuid.UUID,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> QueueTicketOut:
    ticket = await db.scalar(
        select(Ticket).where(
            and_(
                Ticket.id == ticket_id,
                Ticket.tenant_id == current_user.tenant_id,
            )
        )
    )
    if ticket is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="티켓을 찾을 수 없습니다.")

    # 본인 담당 티켓이거나 팀장/admin인 경우만 반납 가능
    if ticket.assigned_to != current_user.id and current_user.role not in (
        UserRole.team_lead, UserRole.admin
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="본인 담당 티켓만 반납할 수 있습니다.",
        )

    ticket.assigned_to = None
    await db.commit()
    await db.refresh(ticket)
    return QueueTicketOut.model_validate(ticket)
