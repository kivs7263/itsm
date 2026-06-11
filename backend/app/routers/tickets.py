"""티켓 라우터.

prefix : /{tenant_slug}/tickets
인증   : get_current_user
격리   : 모든 쿼리 tenant_id == current_user.tenant_id

엔드포인트:
  GET    /{tenant_slug}/tickets                  — 목록 (필터 + 페이지네이션)
  POST   /{tenant_slug}/tickets                  — 생성
  GET    /{tenant_slug}/tickets/{id}             — 상세 (댓글 포함)
  PATCH  /{tenant_slug}/tickets/{id}             — 수정
  DELETE /{tenant_slug}/tickets/{id}             — 삭제 (admin/team_lead)
  POST   /{tenant_slug}/tickets/{id}/comments    — 댓글 추가
  POST   /{tenant_slug}/tickets/bulk-status      — 대량 상태 변경
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user, require_roles
from app.models import (
    Ticket,
    TicketChannel,
    TicketComment,
    TicketPriority,
    TicketStatus,
    User,
    UserRole,
)
from app.services import search_service

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/{tenant_slug}/tickets",
    tags=["tickets"],
)

_ADMIN_ROLES = (UserRole.admin, UserRole.team_lead)


# ------------------------------------------------------------------
# 스키마
# ------------------------------------------------------------------


class TicketCreate(BaseModel):
    title: str = Field(..., max_length=500)
    description: str | None = None
    priority: TicketPriority = TicketPriority.medium
    channel: TicketChannel = TicketChannel.internal
    customer_id: uuid.UUID | None = None
    contract_id: uuid.UUID | None = None
    assigned_to: uuid.UUID | None = None


class TicketUpdate(BaseModel):
    title: str | None = Field(None, max_length=500)
    description: str | None = None
    priority: TicketPriority | None = None
    status: TicketStatus | None = None
    assigned_to: uuid.UUID | None = None
    contract_id: uuid.UUID | None = None


class TicketOut(BaseModel):
    id: uuid.UUID
    tenant_id: uuid.UUID
    title: str
    description: str | None
    priority: str
    status: str
    channel: str
    customer_id: uuid.UUID | None
    contract_id: uuid.UUID | None
    assigned_to: uuid.UUID | None
    created_at: datetime
    updated_at: datetime
    resolved_at: datetime | None
    closed_at: datetime | None

    model_config = {"from_attributes": True}


class CommentCreate(BaseModel):
    body: str = Field(..., min_length=1)
    is_internal: bool = False


class CommentOut(BaseModel):
    id: uuid.UUID
    ticket_id: uuid.UUID
    author_id: uuid.UUID
    body: str
    is_internal: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class BulkStatusRequest(BaseModel):
    ticket_ids: list[uuid.UUID] = Field(..., min_length=1, max_length=200)
    status: TicketStatus


# ------------------------------------------------------------------
# 헬퍼
# ------------------------------------------------------------------


async def _get_ticket_or_404(
    db: AsyncSession, tenant_id: uuid.UUID, ticket_id: uuid.UUID
) -> Ticket:
    row = await db.scalar(
        select(Ticket).where(
            and_(Ticket.id == ticket_id, Ticket.tenant_id == tenant_id)
        )
    )
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="티켓을 찾을 수 없습니다.")
    return row


def _apply_resolved_closed(ticket: Ticket, new_status: TicketStatus) -> None:
    now = datetime.now(timezone.utc)
    if new_status == TicketStatus.resolved and ticket.resolved_at is None:
        ticket.resolved_at = now
    elif new_status == TicketStatus.closed and ticket.closed_at is None:
        ticket.closed_at = now


# ------------------------------------------------------------------
# 목록 — bulk-status 고정 경로를 /{id} 이전에 등록
# ------------------------------------------------------------------


@router.post(
    "/bulk-status",
    status_code=status.HTTP_200_OK,
    summary="대량 상태 변경",
)
async def bulk_update_status(
    tenant_slug: str,
    data: BulkStatusRequest,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> dict:
    rows = (
        await db.execute(
            select(Ticket).where(
                and_(
                    Ticket.tenant_id == current_user.tenant_id,
                    Ticket.id.in_(data.ticket_ids),
                )
            )
        )
    ).scalars().all()

    updated = 0
    for ticket in rows:
        _apply_resolved_closed(ticket, data.status)
        ticket.status = data.status
        updated += 1

    await db.commit()
    return {"updated": updated}


@router.get(
    "",
    response_model=dict,
    summary="티켓 목록 (필터 + 페이지네이션)",
)
async def list_tickets(
    tenant_slug: str,
    ticket_status: TicketStatus | None = Query(None, alias="status"),
    priority: TicketPriority | None = Query(None),
    assigned_to: uuid.UUID | None = Query(None),
    customer_id: uuid.UUID | None = Query(None),
    search: str | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> dict:
    conditions = [Ticket.tenant_id == current_user.tenant_id]

    if ticket_status:
        conditions.append(Ticket.status == ticket_status)
    if priority:
        conditions.append(Ticket.priority == priority)
    if assigned_to:
        conditions.append(Ticket.assigned_to == assigned_to)
    if customer_id:
        conditions.append(Ticket.customer_id == customer_id)
    if search:
        conditions.append(Ticket.title.ilike(f"%{search}%"))

    where_clause = and_(*conditions)
    total = await db.scalar(
        select(func.count()).select_from(Ticket).where(where_clause)
    )
    rows = (
        await db.execute(
            select(Ticket)
            .where(where_clause)
            .order_by(Ticket.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    ).scalars().all()

    return {
        "items": [TicketOut.model_validate(r) for r in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


# ------------------------------------------------------------------
# 생성
# ------------------------------------------------------------------


@router.post(
    "",
    response_model=TicketOut,
    status_code=status.HTTP_201_CREATED,
    summary="티켓 생성",
)
async def create_ticket(
    tenant_slug: str,
    data: TicketCreate,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> TicketOut:
    ticket = Ticket(
        id=uuid.uuid4(),
        tenant_id=current_user.tenant_id,
        title=data.title,
        description=data.description,
        priority=data.priority,
        status=TicketStatus.open,
        channel=data.channel,
        customer_id=data.customer_id,
        contract_id=data.contract_id,
        assigned_to=data.assigned_to,
    )
    db.add(ticket)
    await db.commit()
    await db.refresh(ticket)

    # Meilisearch 인덱싱 (graceful fallback)
    await search_service.index_ticket(
        search_service.TicketDoc(
            id=str(ticket.id),
            tenant_id=str(ticket.tenant_id),
            title=ticket.title,
            description=ticket.description or "",
            status=ticket.status if isinstance(ticket.status, str) else ticket.status.value,
            priority=ticket.priority if isinstance(ticket.priority, str) else ticket.priority.value,
            customer_name="",
            assignee_name="",
            created_at=ticket.created_at.isoformat() if ticket.created_at else "",
        )
    )

    return TicketOut.model_validate(ticket)


# ------------------------------------------------------------------
# 상세 (댓글 포함)
# ------------------------------------------------------------------


@router.get(
    "/{ticket_id}",
    response_model=dict,
    summary="티켓 상세 (댓글 포함)",
)
async def get_ticket(
    tenant_slug: str,
    ticket_id: uuid.UUID,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> dict:
    ticket = await _get_ticket_or_404(db, current_user.tenant_id, ticket_id)

    comments = (
        await db.execute(
            select(TicketComment)
            .where(
                and_(
                    TicketComment.ticket_id == ticket_id,
                    TicketComment.tenant_id == current_user.tenant_id,
                )
            )
            .order_by(TicketComment.created_at.asc())
        )
    ).scalars().all()

    return {
        "ticket": TicketOut.model_validate(ticket),
        "comments": [CommentOut.model_validate(c) for c in comments],
    }


# ------------------------------------------------------------------
# 수정
# ------------------------------------------------------------------


@router.patch(
    "/{ticket_id}",
    response_model=TicketOut,
    summary="티켓 수정",
)
async def update_ticket(
    tenant_slug: str,
    ticket_id: uuid.UUID,
    data: TicketUpdate,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> TicketOut:
    ticket = await _get_ticket_or_404(db, current_user.tenant_id, ticket_id)

    update_fields = data.model_dump(exclude_unset=True)
    for field, value in update_fields.items():
        if field == "status" and value is not None:
            _apply_resolved_closed(ticket, value)
            # 티켓 상태가 resolved 또는 closed로 변경 시 CSAT 설문 자동 생성
            if value in (TicketStatus.resolved, TicketStatus.closed):
                from app.services.csat_service import maybe_create_survey
                await maybe_create_survey(db, ticket)
        setattr(ticket, field, value)

    await db.commit()
    await db.refresh(ticket)
    return TicketOut.model_validate(ticket)


# ------------------------------------------------------------------
# 삭제 (admin/team_lead)
# ------------------------------------------------------------------


@router.delete(
    "/{ticket_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="티켓 삭제 (admin/team_lead)",
)
async def delete_ticket(
    tenant_slug: str,
    ticket_id: uuid.UUID,
    current_user: Annotated[User, Depends(require_roles(UserRole.admin, UserRole.team_lead))] = None,
    db: AsyncSession = Depends(get_db),
) -> None:
    ticket = await _get_ticket_or_404(db, current_user.tenant_id, ticket_id)
    await db.delete(ticket)
    await db.commit()
    # Meilisearch 삭제 (graceful fallback)
    await search_service.delete_ticket(str(current_user.tenant_id), str(ticket_id))


# ------------------------------------------------------------------
# 댓글 추가
# ------------------------------------------------------------------


@router.post(
    "/{ticket_id}/comments",
    response_model=CommentOut,
    status_code=status.HTTP_201_CREATED,
    summary="댓글 추가",
)
async def add_comment(
    tenant_slug: str,
    ticket_id: uuid.UUID,
    data: CommentCreate,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> CommentOut:
    # 티켓 존재 + 테넌트 격리 확인
    await _get_ticket_or_404(db, current_user.tenant_id, ticket_id)

    comment = TicketComment(
        id=uuid.uuid4(),
        tenant_id=current_user.tenant_id,
        ticket_id=ticket_id,
        author_id=current_user.id,
        body=data.body,
        is_internal=data.is_internal,
    )
    db.add(comment)
    await db.commit()
    await db.refresh(comment)
    return CommentOut.model_validate(comment)
