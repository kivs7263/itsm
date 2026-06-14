"""티켓 라우터.

prefix : /{tenant_slug}/tickets
인증   : get_current_user
격리   : 모든 쿼리 tenant_id == current_user.tenant_id

엔드포인트:
  GET    /{tenant_slug}/tickets                          — 목록 (필터 + 페이지네이션)
  POST   /{tenant_slug}/tickets                          — 생성 (ticket_number 자동 부여)
  GET    /{tenant_slug}/tickets/{id}                     — 상세 (댓글 포함)
  PATCH  /{tenant_slug}/tickets/{id}                     — 수정
  DELETE /{tenant_slug}/tickets/{id}                     — 삭제 (admin/team_lead)
  POST   /{tenant_slug}/tickets/{id}/comments            — 댓글 추가
  POST   /{tenant_slug}/tickets/bulk-status              — 대량 상태 변경
  POST   /{tenant_slug}/tickets/{id}/sub-tickets         — 서브티켓 생성
  GET    /{tenant_slug}/tickets/{id}/sub-tickets         — 서브티켓 목록
  POST   /{tenant_slug}/tickets/{id}/causes              — 원인 확정 등록
  GET    /{tenant_slug}/symptom-categories               — 증상 분류 트리
  GET    /{tenant_slug}/cause-categories                 — 원인 분류 트리
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import and_, func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user, require_roles
from app.models import (
    CauseCategory,
    SymptomCategory,
    Ticket,
    TicketCause,
    TicketChannel,
    TicketComment,
    TicketPriority,
    TicketStatus,
    User,
    UserRole,
)
from app.services import search_service

logger = logging.getLogger(__name__)

# 분류 트리 라우터 (/{tenant_slug}/symptom-categories, /{tenant_slug}/cause-categories)
classification_router = APIRouter(tags=["classifications"])

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
    source: str | None = None         # customer_direct | customer_relay | engineer_found | monitoring
    request_type: str | None = None   # incident | service_request | installation | upgrade | technical_inquiry | maintenance
    parent_ticket_id: uuid.UUID | None = None


class TicketUpdate(BaseModel):
    title: str | None = Field(None, max_length=500)
    description: str | None = None
    priority: TicketPriority | None = None
    status: TicketStatus | None = None
    assigned_to: uuid.UUID | None = None
    contract_id: uuid.UUID | None = None
    source: str | None = None
    request_type: str | None = None


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
    source: str | None
    request_type: str | None
    parent_ticket_id: uuid.UUID | None
    ticket_number: str | None
    created_at: datetime
    updated_at: datetime
    resolved_at: datetime | None
    closed_at: datetime | None

    model_config = {"from_attributes": True}


class CategoryNode(BaseModel):
    id: uuid.UUID
    name: str
    display_order: int
    children: list["CategoryNode"] = []

    model_config = {"from_attributes": True}


class CauseIn(BaseModel):
    cause_category_id: uuid.UUID
    action_taken: str | None = None


class CausesRegisterRequest(BaseModel):
    causes: list[CauseIn] = Field(..., min_length=1)


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


async def _generate_ticket_number(db: AsyncSession, tenant_id: uuid.UUID) -> str:
    """TKT-YYYYMMDD-NNNN 형식 ticket_number 생성 (tenant별 daily 시퀀스)."""
    today = datetime.now(timezone.utc).strftime("%Y%m%d")
    prefix = f"TKT-{today}-"
    # 오늘 발급된 이 tenant의 최대 시퀀스 조회
    result = await db.execute(
        text("""
            SELECT MAX(CAST(SUBSTRING(ticket_number FROM :prefix_len + 1) AS INTEGER))
            FROM tickets
            WHERE tenant_id = :tid
              AND ticket_number LIKE :prefix
        """),
        {"prefix_len": len(prefix), "prefix": f"{prefix}%", "tid": str(tenant_id)},
    )
    max_seq = result.scalar() or 0
    return f"{prefix}{str(max_seq + 1).zfill(4)}"


def _build_category_tree(
    nodes: list, parent_id: uuid.UUID | None
) -> list[CategoryNode]:
    children = [n for n in nodes if n.parent_id == parent_id]
    return [
        CategoryNode(
            id=n.id,
            name=n.name,
            display_order=n.display_order,
            children=_build_category_tree(nodes, n.id),
        )
        for n in sorted(children, key=lambda x: x.display_order)
    ]


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
    ticket_number = await _generate_ticket_number(db, current_user.tenant_id)
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
        source=data.source,
        request_type=data.request_type,
        parent_ticket_id=data.parent_ticket_id,
        ticket_number=ticket_number,
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

    # 담당자 알림 (graceful)
    if ticket.assigned_to:
        try:
            from app.services.notification_service import notify_ticket_created
            # assigned user phone은 현재 컨텍스트에서 조회 불필요 — phone 없으면 dispatch가 skip
            await notify_ticket_created(db, ticket, assigned_user_phone=None)
        except Exception:
            pass

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
            # 티켓 해결 시 고객 알림 (graceful)
            if value == TicketStatus.resolved:
                try:
                    from app.services.notification_service import notify_ticket_resolved
                    # customer_phone은 None — 실제 운영 시 Customer 테이블 조회로 교체 가능
                    # dispatch는 None이면 카카오/SMS 자동 skip, 웹훅은 발송
                    await notify_ticket_resolved(db, ticket, customer_phone=None)
                except Exception:
                    pass
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


# ------------------------------------------------------------------
# 서브티켓
# ------------------------------------------------------------------


@router.post(
    "/{ticket_id}/sub-tickets",
    response_model=TicketOut,
    status_code=status.HTTP_201_CREATED,
    summary="서브티켓 생성",
)
async def create_sub_ticket(
    tenant_slug: str,
    ticket_id: uuid.UUID,
    data: TicketCreate,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> TicketOut:
    await _get_ticket_or_404(db, current_user.tenant_id, ticket_id)
    ticket_number = await _generate_ticket_number(db, current_user.tenant_id)
    sub = Ticket(
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
        source=data.source,
        request_type=data.request_type,
        parent_ticket_id=ticket_id,
        ticket_number=ticket_number,
    )
    db.add(sub)
    await db.commit()
    await db.refresh(sub)
    return TicketOut.model_validate(sub)


@router.get(
    "/{ticket_id}/sub-tickets",
    response_model=list[TicketOut],
    summary="서브티켓 목록",
)
async def list_sub_tickets(
    tenant_slug: str,
    ticket_id: uuid.UUID,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> list[TicketOut]:
    await _get_ticket_or_404(db, current_user.tenant_id, ticket_id)
    rows = (
        await db.execute(
            select(Ticket).where(
                and_(
                    Ticket.tenant_id == current_user.tenant_id,
                    Ticket.parent_ticket_id == ticket_id,
                )
            ).order_by(Ticket.created_at.asc())
        )
    ).scalars().all()
    return [TicketOut.model_validate(r) for r in rows]


# ------------------------------------------------------------------
# 원인 확정
# ------------------------------------------------------------------


@router.post(
    "/{ticket_id}/causes",
    status_code=status.HTTP_201_CREATED,
    summary="원인 확정 등록 (복수)",
)
async def register_causes(
    tenant_slug: str,
    ticket_id: uuid.UUID,
    data: CausesRegisterRequest,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> dict:
    await _get_ticket_or_404(db, current_user.tenant_id, ticket_id)

    # 기존 원인 삭제 후 재등록
    existing = (
        await db.execute(
            select(TicketCause).where(TicketCause.ticket_id == ticket_id)
        )
    ).scalars().all()
    for c in existing:
        await db.delete(c)

    for item in data.causes:
        cause = TicketCause(
            ticket_id=ticket_id,
            cause_category_id=item.cause_category_id,
            action_taken=item.action_taken,
        )
        db.add(cause)

    await db.commit()
    return {"registered": len(data.causes)}


# ------------------------------------------------------------------
# 분류 트리 (classification_router)
# ------------------------------------------------------------------


@classification_router.get(
    "/{tenant_slug}/symptom-categories",
    response_model=list[CategoryNode],
    summary="증상 분류 트리",
)
async def list_symptom_categories(
    tenant_slug: str,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> list[CategoryNode]:
    rows = (
        await db.execute(
            select(SymptomCategory)
            .where(SymptomCategory.tenant_id == current_user.tenant_id)
            .order_by(SymptomCategory.display_order)
        )
    ).scalars().all()
    return _build_category_tree(list(rows), None)


@classification_router.get(
    "/{tenant_slug}/cause-categories",
    response_model=list[CategoryNode],
    summary="원인 분류 트리",
)
async def list_cause_categories(
    tenant_slug: str,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> list[CategoryNode]:
    rows = (
        await db.execute(
            select(CauseCategory)
            .where(CauseCategory.tenant_id == current_user.tenant_id)
            .order_by(CauseCategory.display_order)
        )
    ).scalars().all()
    return _build_category_tree(list(rows), None)


# ------------------------------------------------------------------
# 분류 체계 CRUD (team_lead+/admin)
# ------------------------------------------------------------------


class CategoryCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    parent_id: uuid.UUID | None = None


class CategoryUpdate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)


# ---- SymptomCategory CRUD ----

@classification_router.post(
    "/{tenant_slug}/symptom-categories",
    response_model=CategoryNode,
    status_code=status.HTTP_201_CREATED,
    summary="증상 분류 생성 (team_lead+)",
)
async def create_symptom_category(
    tenant_slug: str,
    data: CategoryCreate,
    current_user: Annotated[
        User, Depends(require_roles(UserRole.team_lead, UserRole.admin))
    ] = None,
    db: AsyncSession = Depends(get_db),
) -> CategoryNode:
    # 부모 존재 확인 (tenant 격리)
    if data.parent_id is not None:
        parent = await db.scalar(
            select(SymptomCategory).where(
                and_(
                    SymptomCategory.id == data.parent_id,
                    SymptomCategory.tenant_id == current_user.tenant_id,
                )
            )
        )
        if parent is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="부모 증상 분류를 찾을 수 없습니다.",
            )

    cat = SymptomCategory(
        id=uuid.uuid4(),
        tenant_id=current_user.tenant_id,
        name=data.name,
        parent_id=data.parent_id,
    )
    db.add(cat)
    await db.commit()
    await db.refresh(cat)
    return CategoryNode(id=cat.id, name=cat.name, display_order=cat.display_order)


@classification_router.patch(
    "/{tenant_slug}/symptom-categories/{category_id}",
    response_model=CategoryNode,
    summary="증상 분류 수정 (team_lead+)",
)
async def update_symptom_category(
    tenant_slug: str,
    category_id: uuid.UUID,
    data: CategoryUpdate,
    current_user: Annotated[
        User, Depends(require_roles(UserRole.team_lead, UserRole.admin))
    ] = None,
    db: AsyncSession = Depends(get_db),
) -> CategoryNode:
    cat = await db.scalar(
        select(SymptomCategory).where(
            and_(
                SymptomCategory.id == category_id,
                SymptomCategory.tenant_id == current_user.tenant_id,
            )
        )
    )
    if cat is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="증상 분류를 찾을 수 없습니다.",
        )
    cat.name = data.name
    await db.commit()
    await db.refresh(cat)
    return CategoryNode(id=cat.id, name=cat.name, display_order=cat.display_order)


@classification_router.delete(
    "/{tenant_slug}/symptom-categories/{category_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="증상 분류 삭제 (admin)",
)
async def delete_symptom_category(
    tenant_slug: str,
    category_id: uuid.UUID,
    current_user: Annotated[User, Depends(require_roles(UserRole.admin))] = None,
    db: AsyncSession = Depends(get_db),
) -> None:
    cat = await db.scalar(
        select(SymptomCategory).where(
            and_(
                SymptomCategory.id == category_id,
                SymptomCategory.tenant_id == current_user.tenant_id,
            )
        )
    )
    if cat is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="증상 분류를 찾을 수 없습니다.",
        )

    # 자식 카테고리 존재 체크
    child_count = await db.scalar(
        select(func.count()).select_from(SymptomCategory).where(
            and_(
                SymptomCategory.parent_id == category_id,
                SymptomCategory.tenant_id == current_user.tenant_id,
            )
        )
    )
    if child_count and child_count > 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="자식 분류가 있습니다. 먼저 자식을 삭제해주세요.",
        )

    await db.delete(cat)
    await db.commit()


# ---- CauseCategory CRUD ----

@classification_router.post(
    "/{tenant_slug}/cause-categories",
    response_model=CategoryNode,
    status_code=status.HTTP_201_CREATED,
    summary="원인 분류 생성 (team_lead+)",
)
async def create_cause_category(
    tenant_slug: str,
    data: CategoryCreate,
    current_user: Annotated[
        User, Depends(require_roles(UserRole.team_lead, UserRole.admin))
    ] = None,
    db: AsyncSession = Depends(get_db),
) -> CategoryNode:
    if data.parent_id is not None:
        parent = await db.scalar(
            select(CauseCategory).where(
                and_(
                    CauseCategory.id == data.parent_id,
                    CauseCategory.tenant_id == current_user.tenant_id,
                )
            )
        )
        if parent is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="부모 원인 분류를 찾을 수 없습니다.",
            )

    cat = CauseCategory(
        id=uuid.uuid4(),
        tenant_id=current_user.tenant_id,
        name=data.name,
        parent_id=data.parent_id,
    )
    db.add(cat)
    await db.commit()
    await db.refresh(cat)
    return CategoryNode(id=cat.id, name=cat.name, display_order=cat.display_order)


@classification_router.patch(
    "/{tenant_slug}/cause-categories/{category_id}",
    response_model=CategoryNode,
    summary="원인 분류 수정 (team_lead+)",
)
async def update_cause_category(
    tenant_slug: str,
    category_id: uuid.UUID,
    data: CategoryUpdate,
    current_user: Annotated[
        User, Depends(require_roles(UserRole.team_lead, UserRole.admin))
    ] = None,
    db: AsyncSession = Depends(get_db),
) -> CategoryNode:
    cat = await db.scalar(
        select(CauseCategory).where(
            and_(
                CauseCategory.id == category_id,
                CauseCategory.tenant_id == current_user.tenant_id,
            )
        )
    )
    if cat is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="원인 분류를 찾을 수 없습니다.",
        )
    cat.name = data.name
    await db.commit()
    await db.refresh(cat)
    return CategoryNode(id=cat.id, name=cat.name, display_order=cat.display_order)


@classification_router.delete(
    "/{tenant_slug}/cause-categories/{category_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="원인 분류 삭제 (admin)",
)
async def delete_cause_category(
    tenant_slug: str,
    category_id: uuid.UUID,
    current_user: Annotated[User, Depends(require_roles(UserRole.admin))] = None,
    db: AsyncSession = Depends(get_db),
) -> None:
    cat = await db.scalar(
        select(CauseCategory).where(
            and_(
                CauseCategory.id == category_id,
                CauseCategory.tenant_id == current_user.tenant_id,
            )
        )
    )
    if cat is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="원인 분류를 찾을 수 없습니다.",
        )

    # 자식 카테고리 존재 체크
    child_count = await db.scalar(
        select(func.count()).select_from(CauseCategory).where(
            and_(
                CauseCategory.parent_id == category_id,
                CauseCategory.tenant_id == current_user.tenant_id,
            )
        )
    )
    if child_count and child_count > 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="자식 분류가 있습니다. 먼저 자식을 삭제해주세요.",
        )

    # TicketCause에서 사용 중인지 확인
    used_count = await db.scalar(
        select(func.count()).select_from(TicketCause).where(
            TicketCause.cause_category_id == category_id
        )
    )
    if used_count and used_count > 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="티켓에서 사용 중인 분류는 삭제할 수 없습니다.",
        )

    await db.delete(cat)
    await db.commit()
