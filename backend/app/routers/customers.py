"""고객 라우터.

prefix : /{tenant_slug}/customers
인증   : get_current_user
격리   : 모든 쿼리 tenant_id == current_user.tenant_id

엔드포인트:
  GET    /{tenant_slug}/customers                                    — 목록 (search + 페이지네이션)
  POST   /{tenant_slug}/customers                                    — 생성
  GET    /{tenant_slug}/customers/{id}                               — 상세
  PATCH  /{tenant_slug}/customers/{id}                               — 수정
  DELETE /{tenant_slug}/customers/{id}                               — 삭제 (admin/team_lead)
  POST   /{tenant_slug}/customers/{id}/divisions                     — 하위 부서 등록
  GET    /{tenant_slug}/customers/{id}/tree                          — 하위 부서 트리 (recursive CTE)
  GET    /{tenant_slug}/customers/{id}/rollup                        — 상위 기준 집계
  GET    /{tenant_slug}/customers/{id}/notes                         — 메모 목록
  POST   /{tenant_slug}/customers/{id}/notes                         — 메모 작성
  PATCH  /{tenant_slug}/customers/{id}/notes/{note_id}               — 메모 수정
  DELETE /{tenant_slug}/customers/{id}/notes/{note_id}               — 메모 삭제
  GET    /{tenant_slug}/customers/{id}/support-history               — 고객 지원 이력 (tickets 집계)
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import and_, delete as sa_delete, func, or_, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user, require_roles
from app.models import Company, Contact, Customer, CustomerContact, CustomerNote, Site, User, UserRole

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/{tenant_slug}/customers",
    tags=["customers"],
)


# ------------------------------------------------------------------
# 스키마
# ------------------------------------------------------------------


class CustomerCreate(BaseModel):
    name: str = Field(..., max_length=200)
    email: str | None = Field(None, max_length=255)
    phone: str | None = Field(None, max_length=50)
    company: str | None = Field(None, max_length=200)
    contract_grade: str | None = Field(None, max_length=50)
    parent_id: uuid.UUID | None = None
    kind: str = Field("account", pattern="^(account|division)$")


class CustomerUpdate(BaseModel):
    name: str | None = Field(None, max_length=200)
    email: str | None = Field(None, max_length=255)
    phone: str | None = Field(None, max_length=50)
    company: str | None = Field(None, max_length=200)
    contract_grade: str | None = Field(None, max_length=50)
    parent_id: uuid.UUID | None = None
    kind: str | None = Field(None, pattern="^(account|division)$")


class DivisionCreate(BaseModel):
    name: str = Field(..., max_length=200)
    email: str | None = Field(None, max_length=255)
    phone: str | None = Field(None, max_length=50)


class CustomerOut(BaseModel):
    id: uuid.UUID
    tenant_id: uuid.UUID
    name: str
    email: str | None
    phone: str | None
    company: str | None
    contract_grade: str | None
    parent_id: uuid.UUID | None
    kind: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class CustomerTreeNode(BaseModel):
    id: uuid.UUID
    name: str
    kind: str
    children: list["CustomerTreeNode"] = []

    model_config = {"from_attributes": True}


class CustomerRollup(BaseModel):
    customer_id: uuid.UUID
    name: str
    open_tickets: int
    total_hours_this_month: float
    active_assets: int
    active_contracts: int


class NoteCreate(BaseModel):
    title: str | None = Field(None, max_length=200)
    content: str | None = None


class NoteUpdate(BaseModel):
    title: str | None = Field(None, max_length=200)
    content: str | None = None


class NoteOut(BaseModel):
    id: uuid.UUID
    customer_id: uuid.UUID
    title: str | None
    content: str | None
    author_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ------------------------------------------------------------------
# 헬퍼
# ------------------------------------------------------------------


async def _get_or_404(
    db: AsyncSession, tenant_id: uuid.UUID, customer_id: uuid.UUID
) -> Customer:
    row = await db.scalar(
        select(Customer).where(
            and_(
                Customer.id == customer_id,
                Customer.tenant_id == tenant_id,
            )
        )
    )
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="고객을 찾을 수 없습니다.")
    return row


async def _get_note_or_404(
    db: AsyncSession, tenant_id: uuid.UUID, customer_id: uuid.UUID, note_id: uuid.UUID
) -> CustomerNote:
    row = await db.scalar(
        select(CustomerNote).where(
            and_(
                CustomerNote.id == note_id,
                CustomerNote.customer_id == customer_id,
                CustomerNote.tenant_id == tenant_id,
            )
        )
    )
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="메모를 찾을 수 없습니다.")
    return row


async def _check_cycle(
    db: AsyncSession, tenant_id: uuid.UUID, node_id: uuid.UUID, new_parent_id: uuid.UUID
) -> None:
    """new_parent_id가 node_id의 자손인지 확인 — 사이클 방지."""
    # recursive CTE로 node_id의 모든 자손 ID 집합 조회
    cte_sql = text("""
        WITH RECURSIVE descendants AS (
            SELECT id FROM customers WHERE id = :node_id AND tenant_id = :tid
            UNION ALL
            SELECT c.id FROM customers c
            JOIN descendants d ON c.parent_id = d.id
            WHERE c.tenant_id = :tid
        )
        SELECT id FROM descendants WHERE id = :parent_id
    """)
    result = await db.execute(cte_sql, {"node_id": node_id, "tid": tenant_id, "parent_id": new_parent_id})
    if result.fetchone():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="계층 순환이 발생합니다. 자손을 상위로 지정할 수 없습니다.",
        )


async def _check_depth(
    db: AsyncSession, tenant_id: uuid.UUID, parent_id: uuid.UUID
) -> None:
    """parent_id의 현재 깊이 확인 — 5단계 초과 방지."""
    depth_sql = text("""
        WITH RECURSIVE ancestors AS (
            SELECT id, parent_id, 1 AS depth FROM customers
            WHERE id = :pid AND tenant_id = :tid
            UNION ALL
            SELECT c.id, c.parent_id, a.depth + 1 FROM customers c
            JOIN ancestors a ON c.id = a.parent_id
            WHERE c.tenant_id = :tid AND a.depth < 10
        )
        SELECT MAX(depth) FROM ancestors
    """)
    result = await db.execute(depth_sql, {"pid": parent_id, "tid": tenant_id})
    depth = result.scalar() or 0
    if depth >= 5:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="계층 깊이는 최대 5단계까지 허용됩니다.",
        )


# ------------------------------------------------------------------
# 목록
# ------------------------------------------------------------------


@router.get("", response_model=dict, summary="고객 목록 (search + 페이지네이션)")
async def list_customers(
    tenant_slug: str,
    search: str | None = Query(None),
    kind: str | None = Query(None, pattern="^(account|division)$"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> dict:
    conditions = [Customer.tenant_id == current_user.tenant_id]
    if search:
        like = f"%{search}%"
        conditions.append(
            or_(
                Customer.name.ilike(like),
                Customer.email.ilike(like),
                Customer.company.ilike(like),
            )
        )
    if kind:
        conditions.append(Customer.kind == kind)

    where_clause = and_(*conditions)
    total = await db.scalar(
        select(func.count()).select_from(Customer).where(where_clause)
    )
    rows = (
        await db.execute(
            select(Customer)
            .where(where_clause)
            .order_by(Customer.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    ).scalars().all()

    return {
        "items": [CustomerOut.model_validate(r) for r in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


# ------------------------------------------------------------------
# 생성
# ------------------------------------------------------------------


@router.post("", response_model=CustomerOut, status_code=status.HTTP_201_CREATED, summary="고객 생성")
async def create_customer(
    tenant_slug: str,
    data: CustomerCreate,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> CustomerOut:
    if data.parent_id:
        await _get_or_404(db, current_user.tenant_id, data.parent_id)
        await _check_depth(db, current_user.tenant_id, data.parent_id)

    customer = Customer(
        id=uuid.uuid4(),
        tenant_id=current_user.tenant_id,
        name=data.name,
        email=data.email,
        phone=data.phone,
        company=data.company,
        contract_grade=data.contract_grade,
        parent_id=data.parent_id,
        kind=data.kind,
    )
    db.add(customer)

    # ── 이중쓰기: 신 테이블 동기 INSERT (같은 트랜잭션) ──────────────
    if data.kind == "account":
        db.add(Company(
            id=customer.id,
            tenant_id=current_user.tenant_id,
            name=data.name,
            contract_grade=data.contract_grade,
            linked_business_id=None,
        ))
    elif data.kind == "division" and data.parent_id is not None:
        db.add(Site(
            id=customer.id,
            tenant_id=current_user.tenant_id,
            company_id=data.parent_id,
            name=data.name,
        ))
    # division + parent_id IS NULL → 고아 division: Site 생성 불가(company_id NOT NULL), 스킵

    await db.commit()
    await db.refresh(customer)
    return CustomerOut.model_validate(customer)


# ------------------------------------------------------------------
# 전체 트리 (루트 고객 + 하위 부서 전체)
# 주의: /{customer_id} 라우트보다 먼저 등록해야 "/tree"가 UUID로 해석되지 않음
# ------------------------------------------------------------------


@router.get(
    "/tree",
    response_model=list[CustomerTreeNode],
    summary="전체 고객사 트리 (루트→하위 부서 전체)",
)
async def get_all_customers_tree(
    tenant_slug: str,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> list[CustomerTreeNode]:
    """테넌트 내 모든 고객사를 parent_id 기준 트리로 반환."""
    result = await db.execute(
        select(Customer.id, Customer.name, Customer.kind, Customer.parent_id)  # type: ignore[arg-type]
        .where(Customer.tenant_id == current_user.tenant_id)
        .order_by(Customer.name)
    )
    nodes = [{"id": r.id, "name": r.name, "kind": r.kind, "parent_id": r.parent_id} for r in result]
    return _build_tree(nodes, None)


# ------------------------------------------------------------------
# 상세
# ------------------------------------------------------------------


@router.get("/{customer_id}", response_model=CustomerOut, summary="고객 상세")
async def get_customer(
    tenant_slug: str,
    customer_id: uuid.UUID,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> CustomerOut:
    customer = await _get_or_404(db, current_user.tenant_id, customer_id)
    return CustomerOut.model_validate(customer)


# ------------------------------------------------------------------
# 수정
# ------------------------------------------------------------------


@router.patch("/{customer_id}", response_model=CustomerOut, summary="고객 수정")
async def update_customer(
    tenant_slug: str,
    customer_id: uuid.UUID,
    data: CustomerUpdate,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> CustomerOut:
    customer = await _get_or_404(db, current_user.tenant_id, customer_id)

    if data.parent_id is not None:
        if data.parent_id == customer_id:
            raise HTTPException(status_code=400, detail="자기 자신을 상위로 지정할 수 없습니다.")
        await _get_or_404(db, current_user.tenant_id, data.parent_id)
        await _check_cycle(db, current_user.tenant_id, customer_id, data.parent_id)
        await _check_depth(db, current_user.tenant_id, data.parent_id)

    update_fields = data.model_dump(exclude_unset=True)
    # H2/H3: kind 전환·division orphan화는 신 스키마(sites.company_id NOT NULL)와 충돌 → 차단
    if "kind" in update_fields and update_fields["kind"] != customer.kind:
        raise HTTPException(status_code=400, detail="고객 유형(kind) 변경은 지원하지 않습니다.")
    if (
        customer.kind == "division"
        and "parent_id" in update_fields
        and update_fields["parent_id"] is None
    ):
        raise HTTPException(status_code=400, detail="부서의 상위 고객사(parent_id)는 비울 수 없습니다.")
    for field, value in update_fields.items():
        setattr(customer, field, value)

    # ── 이중쓰기: 신 테이블 동기 UPDATE (같은 트랜잭션) ──────────────
    # kind 변경은 별도 마이그레이션 필요 — 여기서는 현재 kind 기준으로 동기
    if customer.kind == "account":
        _company_vals: dict = {}
        if "name" in update_fields:
            _company_vals["name"] = update_fields["name"]
        if "contract_grade" in update_fields:
            _company_vals["contract_grade"] = update_fields["contract_grade"]
        if _company_vals:
            await db.execute(
                update(Company)
                .where(Company.id == customer_id, Company.tenant_id == current_user.tenant_id)
                .values(**_company_vals)
            )
    elif customer.kind == "division":
        _site_vals: dict = {}
        if "name" in update_fields:
            _site_vals["name"] = update_fields["name"]
        if "parent_id" in update_fields and update_fields["parent_id"] is not None:
            _site_vals["company_id"] = update_fields["parent_id"]
        if _site_vals:
            await db.execute(
                update(Site)
                .where(Site.id == customer_id, Site.tenant_id == current_user.tenant_id)
                .values(**_site_vals)
            )

    await db.commit()
    await db.refresh(customer)
    return CustomerOut.model_validate(customer)


# ------------------------------------------------------------------
# 삭제
# ------------------------------------------------------------------


@router.delete(
    "/{customer_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="고객 삭제 (admin/team_lead)",
)
async def delete_customer(
    tenant_slug: str,
    customer_id: uuid.UUID,
    current_user: Annotated[User, Depends(require_roles(UserRole.admin, UserRole.team_lead))] = None,
    db: AsyncSession = Depends(get_db),
) -> None:
    customer = await _get_or_404(db, current_user.tenant_id, customer_id)

    # ── 이중쓰기: 신 테이블 동기 DELETE (같은 트랜잭션) ──────────────
    if customer.kind == "account":
        # Company 삭제 → CASCADE: sites, contacts (FK ondelete=CASCADE)
        # assets.company_id / contracts.company_id 도 CASCADE — 기존 customer CASCADE와 동일 효과
        await db.execute(
            sa_delete(Company).where(
                Company.id == customer_id,
                Company.tenant_id == current_user.tenant_id,
            )
        )
    elif customer.kind == "division":
        # 이 division의 CustomerContact ID 수집 (contacts 동기 삭제용)
        _cc_ids = (await db.execute(
            select(CustomerContact.id).where(
                CustomerContact.customer_id == customer_id,
                CustomerContact.tenant_id == current_user.tenant_id,
            )
        )).scalars().all()
        if _cc_ids:
            await db.execute(sa_delete(Contact).where(Contact.id.in_(_cc_ids)))
        # Site 삭제 (contacts.site_id → SET NULL, 삭제되지 않음)
        await db.execute(
            sa_delete(Site).where(
                Site.id == customer_id,
                Site.tenant_id == current_user.tenant_id,
            )
        )

    await db.delete(customer)
    await db.commit()


# ------------------------------------------------------------------
# 하위 부서 등록
# ------------------------------------------------------------------


@router.post(
    "/{customer_id}/divisions",
    response_model=CustomerOut,
    status_code=status.HTTP_201_CREATED,
    summary="하위 부서 등록",
)
async def create_division(
    tenant_slug: str,
    customer_id: uuid.UUID,
    data: DivisionCreate,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> CustomerOut:
    parent = await _get_or_404(db, current_user.tenant_id, customer_id)
    await _check_depth(db, current_user.tenant_id, parent.id)

    division = Customer(
        id=uuid.uuid4(),
        tenant_id=current_user.tenant_id,
        name=data.name,
        email=data.email,
        phone=data.phone,
        parent_id=parent.id,
        kind="division",
    )
    db.add(division)

    # ── 이중쓰기: sites INSERT (같은 트랜잭션) ─────────────────────────
    db.add(Site(
        id=division.id,
        tenant_id=current_user.tenant_id,
        company_id=parent.id,
        name=data.name,
    ))

    await db.commit()
    await db.refresh(division)
    return CustomerOut.model_validate(division)


# ------------------------------------------------------------------
# 계층 트리
# ------------------------------------------------------------------


def _build_tree(nodes: list[dict], parent_id: uuid.UUID | None) -> list[CustomerTreeNode]:
    children = [n for n in nodes if n["parent_id"] == parent_id]
    return [
        CustomerTreeNode(
            id=n["id"],
            name=n["name"],
            kind=n["kind"],
            children=_build_tree(nodes, n["id"]),
        )
        for n in children
    ]


@router.get(
    "/{customer_id}/tree",
    response_model=list[CustomerTreeNode],
    summary="고객사 하위 부서 트리 (recursive CTE)",
)
async def get_customer_tree(
    tenant_slug: str,
    customer_id: uuid.UUID,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> list[CustomerTreeNode]:
    await _get_or_404(db, current_user.tenant_id, customer_id)

    cte_sql = text("""
        WITH RECURSIVE subtree AS (
            SELECT id, name, kind, parent_id FROM customers
            WHERE id = :root_id AND tenant_id = :tid
            UNION ALL
            SELECT c.id, c.name, c.kind, c.parent_id FROM customers c
            JOIN subtree s ON c.parent_id = s.id
            WHERE c.tenant_id = :tid
        )
        SELECT id, name, kind, parent_id FROM subtree
    """)
    result = await db.execute(cte_sql, {"root_id": customer_id, "tid": current_user.tenant_id})
    nodes = [{"id": r.id, "name": r.name, "kind": r.kind, "parent_id": r.parent_id} for r in result]
    return _build_tree(nodes, None)


# ------------------------------------------------------------------
# 롤업 집계
# ------------------------------------------------------------------


@router.get(
    "/{customer_id}/rollup",
    response_model=CustomerRollup,
    summary="고객사 기준 집계 (하위 부서 포함)",
)
async def get_customer_rollup(
    tenant_slug: str,
    customer_id: uuid.UUID,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> CustomerRollup:
    customer = await _get_or_404(db, current_user.tenant_id, customer_id)

    # 하위 모든 customer_id 수집 (자기 포함)
    desc_sql = text("""
        WITH RECURSIVE subtree AS (
            SELECT id FROM customers WHERE id = :root_id AND tenant_id = :tid
            UNION ALL
            SELECT c.id FROM customers c
            JOIN subtree s ON c.parent_id = s.id
            WHERE c.tenant_id = :tid
        )
        SELECT id FROM subtree
    """)
    desc_result = await db.execute(desc_sql, {"root_id": customer_id, "tid": current_user.tenant_id})
    all_ids = [r.id for r in desc_result]

    rollup_sql = text("""
        SELECT
            (SELECT COUNT(*) FROM tickets
             WHERE tenant_id = :tid AND customer_id = ANY(:ids)
               AND status NOT IN ('resolved', 'closed')) AS open_tickets,

            COALESCE((SELECT SUM(twl.hours)
             FROM ticket_work_logs twl
             JOIN tickets t ON twl.ticket_id = t.id
             WHERE twl.tenant_id = :tid AND t.customer_id = ANY(:ids)
               AND twl.logged_at >= date_trunc('month', now())), 0) AS total_hours_this_month,

            (SELECT COUNT(*) FROM assets
             WHERE tenant_id = :tid AND customer_id = ANY(:ids)
               AND status = 'active') AS active_assets,

            (SELECT COUNT(*) FROM contracts
             WHERE tenant_id = :tid AND customer_id = ANY(:ids)
               AND status = 'active') AS active_contracts
    """)
    r = (await db.execute(rollup_sql, {"tid": current_user.tenant_id, "ids": all_ids})).fetchone()

    return CustomerRollup(
        customer_id=customer_id,
        name=customer.name,
        open_tickets=r.open_tickets or 0,
        total_hours_this_month=float(r.total_hours_this_month or 0),
        active_assets=r.active_assets or 0,
        active_contracts=r.active_contracts or 0,
    )


# ------------------------------------------------------------------
# 메모 목록
# ------------------------------------------------------------------


@router.get(
    "/{customer_id}/notes",
    response_model=list[NoteOut],
    summary="고객 메모 목록",
)
async def list_notes(
    tenant_slug: str,
    customer_id: uuid.UUID,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> list[NoteOut]:
    await _get_or_404(db, current_user.tenant_id, customer_id)
    rows = (
        await db.execute(
            select(CustomerNote)
            .where(
                and_(
                    CustomerNote.customer_id == customer_id,
                    CustomerNote.tenant_id == current_user.tenant_id,
                )
            )
            .order_by(CustomerNote.updated_at.desc())
        )
    ).scalars().all()
    return [NoteOut.model_validate(r) for r in rows]


# ------------------------------------------------------------------
# 메모 작성
# ------------------------------------------------------------------


@router.post(
    "/{customer_id}/notes",
    response_model=NoteOut,
    status_code=status.HTTP_201_CREATED,
    summary="고객 메모 작성",
)
async def create_note(
    tenant_slug: str,
    customer_id: uuid.UUID,
    data: NoteCreate,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> NoteOut:
    await _get_or_404(db, current_user.tenant_id, customer_id)
    note = CustomerNote(
        id=uuid.uuid4(),
        tenant_id=current_user.tenant_id,
        customer_id=customer_id,
        title=data.title,
        content=data.content,
        author_id=current_user.id,
    )
    db.add(note)
    await db.commit()
    await db.refresh(note)
    return NoteOut.model_validate(note)


# ------------------------------------------------------------------
# 메모 수정
# ------------------------------------------------------------------


@router.patch(
    "/{customer_id}/notes/{note_id}",
    response_model=NoteOut,
    summary="고객 메모 수정",
)
async def update_note(
    tenant_slug: str,
    customer_id: uuid.UUID,
    note_id: uuid.UUID,
    data: NoteUpdate,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> NoteOut:
    note = await _get_note_or_404(db, current_user.tenant_id, customer_id, note_id)
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(note, field, value)
    await db.commit()
    await db.refresh(note)
    return NoteOut.model_validate(note)


# ------------------------------------------------------------------
# 메모 삭제
# ------------------------------------------------------------------


@router.delete(
    "/{customer_id}/notes/{note_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="고객 메모 삭제",
)
async def delete_note(
    tenant_slug: str,
    customer_id: uuid.UUID,
    note_id: uuid.UUID,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> None:
    note = await _get_note_or_404(db, current_user.tenant_id, customer_id, note_id)
    await db.delete(note)
    await db.commit()


# ------------------------------------------------------------------
# 연락처 스키마 (P6-3)
# ------------------------------------------------------------------


class ContactCreate(BaseModel):
    name: str = Field(..., max_length=100)
    role: str | None = Field(None, max_length=100)
    email: str | None = Field(None, max_length=255)
    phone: str | None = Field(None, max_length=50)
    is_primary: bool = False
    memo: str | None = None


class ContactUpdate(BaseModel):
    name: str | None = Field(None, max_length=100)
    role: str | None = Field(None, max_length=100)
    email: str | None = Field(None, max_length=255)
    phone: str | None = Field(None, max_length=50)
    memo: str | None = None


class ContactOut(BaseModel):
    id: uuid.UUID
    customer_id: uuid.UUID
    name: str
    role: str | None
    email: str | None
    phone: str | None
    is_primary: bool
    memo: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


# ------------------------------------------------------------------
# 연락처 헬퍼 (P6-3)
# ------------------------------------------------------------------


async def _get_contact_or_404(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    customer_id: uuid.UUID,
    contact_id: uuid.UUID,
) -> CustomerContact:
    row = await db.scalar(
        select(CustomerContact).where(
            and_(
                CustomerContact.id == contact_id,
                CustomerContact.customer_id == customer_id,
                CustomerContact.tenant_id == tenant_id,
            )
        )
    )
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="연락처를 찾을 수 없습니다.")
    return row


async def _sync_primary_to_customer(
    db: AsyncSession,
    customer_id: uuid.UUID,
    contact: CustomerContact,
) -> None:
    """주 연락처 변경 시 customers.email/phone 동기화."""
    await db.execute(
        update(Customer)
        .where(Customer.id == customer_id)
        .values(email=contact.email, phone=contact.phone)
    )


# ------------------------------------------------------------------
# 연락처 목록 (P6-3)
# ------------------------------------------------------------------


@router.get(
    "/{customer_id}/contacts",
    response_model=dict,
    summary="고객 연락처 목록",
)
async def list_contacts(
    tenant_slug: str,
    customer_id: uuid.UUID,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> dict:
    await _get_or_404(db, current_user.tenant_id, customer_id)
    where_clause = and_(
        CustomerContact.customer_id == customer_id,
        CustomerContact.tenant_id == current_user.tenant_id,
    )
    total = await db.scalar(
        select(func.count()).select_from(CustomerContact).where(where_clause)
    )
    rows = (
        await db.execute(
            select(CustomerContact)
            .where(where_clause)
            .order_by(CustomerContact.is_primary.desc(), CustomerContact.created_at.asc())
        )
    ).scalars().all()
    return {"items": [ContactOut.model_validate(r) for r in rows], "total": total}


# ------------------------------------------------------------------
# 연락처 추가 (P6-3)
# ------------------------------------------------------------------


@router.post(
    "/{customer_id}/contacts",
    response_model=ContactOut,
    status_code=status.HTTP_201_CREATED,
    summary="고객 연락처 추가 (engineer+)",
)
async def create_contact(
    tenant_slug: str,
    customer_id: uuid.UUID,
    data: ContactCreate,
    current_user: Annotated[User, Depends(require_roles(UserRole.admin, UserRole.team_lead, UserRole.engineer))] = None,
    db: AsyncSession = Depends(get_db),
) -> ContactOut:
    cust = await _get_or_404(db, current_user.tenant_id, customer_id)

    # is_primary=True이면 기존 primary를 먼저 False로 전환
    if data.is_primary:
        # 기존 primary ID 수집 (contacts 동기화용)
        _old_primary_ids = (await db.execute(
            select(CustomerContact.id).where(
                and_(
                    CustomerContact.customer_id == customer_id,
                    CustomerContact.tenant_id == current_user.tenant_id,
                    CustomerContact.is_primary.is_(True),
                )
            )
        )).scalars().all()

        await db.execute(
            update(CustomerContact)
            .where(
                and_(
                    CustomerContact.customer_id == customer_id,
                    CustomerContact.tenant_id == current_user.tenant_id,
                    CustomerContact.is_primary == True,  # noqa: E712
                )
            )
            .values(is_primary=False)
        )

        # ── 이중쓰기: 기존 primary contacts도 동기 해제 ──────────────
        if _old_primary_ids:
            await db.execute(
                update(Contact)
                .where(Contact.id.in_(_old_primary_ids))
                .values(is_primary=False)
            )

    contact = CustomerContact(
        id=uuid.uuid4(),
        tenant_id=current_user.tenant_id,
        customer_id=customer_id,
        name=data.name,
        role=data.role,
        email=data.email,
        phone=data.phone,
        is_primary=data.is_primary,
        memo=data.memo,
    )
    db.add(contact)
    await db.flush()  # contact.id 확보

    # ── 이중쓰기: contacts INSERT (같은 트랜잭션) ─────────────────────
    # company_id 결정: account → cust.id, division → cust.parent_id
    if cust.kind == "account":
        _company_id: uuid.UUID | None = cust.id
        _site_id: uuid.UUID | None = None
    elif cust.kind == "division" and cust.parent_id is not None:
        _company_id = cust.parent_id
        _site_id = cust.id
    else:
        _company_id = None
        _site_id = None

    if _company_id is not None:
        db.add(Contact(
            id=contact.id,
            tenant_id=current_user.tenant_id,
            company_id=_company_id,
            site_id=_site_id,
            name=data.name,
            role=data.role,
            email=data.email,
            phone=data.phone,
            is_primary=data.is_primary,
            memo=data.memo,
        ))

    if data.is_primary:
        await _sync_primary_to_customer(db, customer_id, contact)

    await db.commit()
    await db.refresh(contact)
    return ContactOut.model_validate(contact)


# ------------------------------------------------------------------
# 연락처 수정 (P6-3)
# ------------------------------------------------------------------


@router.patch(
    "/{customer_id}/contacts/{contact_id}",
    response_model=ContactOut,
    summary="고객 연락처 수정 (engineer+) — is_primary 변경 불가",
)
async def update_contact(
    tenant_slug: str,
    customer_id: uuid.UUID,
    contact_id: uuid.UUID,
    data: ContactUpdate,
    current_user: Annotated[User, Depends(require_roles(UserRole.admin, UserRole.team_lead, UserRole.engineer))] = None,
    db: AsyncSession = Depends(get_db),
) -> ContactOut:
    await _get_or_404(db, current_user.tenant_id, customer_id)
    contact = await _get_contact_or_404(db, current_user.tenant_id, customer_id, contact_id)

    contact_update_fields = data.model_dump(exclude_unset=True)
    for field, value in contact_update_fields.items():
        setattr(contact, field, value)

    # ── 이중쓰기: contacts 동기 UPDATE (같은 트랜잭션) ───────────────
    if contact_update_fields:
        _contact_sync: dict = {
            k: v for k, v in contact_update_fields.items()
            if k in {"name", "role", "email", "phone", "memo"}
        }
        if _contact_sync:
            await db.execute(
                update(Contact)
                .where(Contact.id == contact_id)
                .values(**_contact_sync)
            )

    await db.commit()
    await db.refresh(contact)
    return ContactOut.model_validate(contact)


# ------------------------------------------------------------------
# 연락처 삭제 (P6-3)
# ------------------------------------------------------------------


@router.delete(
    "/{customer_id}/contacts/{contact_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="고객 연락처 삭제 (team_lead+)",
)
async def delete_contact(
    tenant_slug: str,
    customer_id: uuid.UUID,
    contact_id: uuid.UUID,
    current_user: Annotated[User, Depends(require_roles(UserRole.admin, UserRole.team_lead))] = None,
    db: AsyncSession = Depends(get_db),
) -> None:
    await _get_or_404(db, current_user.tenant_id, customer_id)
    contact = await _get_contact_or_404(db, current_user.tenant_id, customer_id, contact_id)

    if contact.is_primary:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="다른 주 연락처를 지정한 후 삭제하세요.",
        )

    # ── 이중쓰기: contacts 동기 DELETE (같은 트랜잭션) ──────────────
    await db.execute(sa_delete(Contact).where(Contact.id == contact_id))

    await db.delete(contact)
    await db.commit()


# ------------------------------------------------------------------
# 고객 지원 이력 (support-history)
# ------------------------------------------------------------------


class SupportHistoryItem(BaseModel):
    id: uuid.UUID
    ticket_number: str | None
    title: str
    request_type: str | None
    status: str
    priority: str
    created_at: datetime
    resolved_at: datetime | None
    closed_at: datetime | None
    total_hours: float
    billable_hours: float
    escalation_count: int
    escalation_team_names: list[str]
    assigned_user_name: str | None
    contract_name: str | None
    linked_kb_article_id: uuid.UUID | None


class SupportHistoryOut(BaseModel):
    items: list[SupportHistoryItem]
    total: int


@router.get(
    "/{customer_id}/support-history",
    response_model=SupportHistoryOut,
    summary="고객 지원 이력 (티켓 집계 포함)",
)
async def get_support_history(
    tenant_slug: str,
    customer_id: uuid.UUID,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status: str | None = Query(None, pattern="^(open|in_progress|pending|resolved|closed)$"),
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> SupportHistoryOut:
    await _get_or_404(db, current_user.tenant_id, customer_id)

    tid = current_user.tenant_id
    cid = customer_id
    offset = (page - 1) * page_size

    status_filter = "AND t.status = :status" if status else ""

    count_sql = text(f"""
        SELECT COUNT(*)
        FROM tickets t
        WHERE t.tenant_id = :tid
          AND t.customer_id = :cid
          {status_filter}
    """)
    count_params: dict = {"tid": tid, "cid": cid}
    if status:
        count_params["status"] = status

    total = (await db.execute(count_sql, count_params)).scalar() or 0

    history_sql = text(f"""
        SELECT
            t.id,
            t.ticket_number,
            t.title,
            t.request_type,
            t.status,
            t.priority,
            t.created_at,
            t.resolved_at,
            t.closed_at,
            t.assigned_to,
            t.contract_id,
            COALESCE(wl.total_hours, 0.0)    AS total_hours,
            COALESCE(wl.billable_hours, 0.0) AS billable_hours,
            COALESCE(esc.escalation_count, 0) AS escalation_count,
            COALESCE(esc.team_names, ARRAY[]::text[]) AS escalation_team_names,
            u.name                            AS assigned_user_name,
            c.name                            AS contract_name,
            kb.id                             AS linked_kb_article_id
        FROM tickets t
        -- 공수 집계 서브쿼리
        LEFT JOIN (
            SELECT
                ticket_id,
                SUM(hours)                                           AS total_hours,
                SUM(CASE WHEN billable THEN hours ELSE 0 END)        AS billable_hours
            FROM ticket_work_logs
            WHERE tenant_id = :tid
            GROUP BY ticket_id
        ) wl ON wl.ticket_id = t.id
        -- 에스컬레이션 집계 서브쿼리
        LEFT JOIN (
            SELECT
                te.ticket_id,
                COUNT(te.id)                        AS escalation_count,
                ARRAY_AGG(st.name ORDER BY te.created_at) AS team_names
            FROM ticket_escalations te
            JOIN support_teams st ON st.id = te.to_team_id
            WHERE te.tenant_id = :tid
            GROUP BY te.ticket_id
        ) esc ON esc.ticket_id = t.id
        -- 담당자
        LEFT JOIN users u ON u.id = t.assigned_to
        -- 계약
        LEFT JOIN contracts c ON c.id = t.contract_id
        -- KB 문서 (LIMIT 1 — DISTINCT ON 사용)
        LEFT JOIN LATERAL (
            SELECT id
            FROM kb_articles
            WHERE linked_ticket_id = t.id
              AND tenant_id = :tid
            ORDER BY created_at ASC
            LIMIT 1
        ) kb ON TRUE
        WHERE t.tenant_id = :tid
          AND t.customer_id = :cid
          {status_filter}
        ORDER BY t.created_at DESC
        LIMIT :limit OFFSET :offset
    """)

    query_params: dict = {
        "tid": tid,
        "cid": cid,
        "limit": page_size,
        "offset": offset,
    }
    if status:
        query_params["status"] = status

    rows = (await db.execute(history_sql, query_params)).fetchall()

    items = [
        SupportHistoryItem(
            id=r.id,
            ticket_number=r.ticket_number,
            title=r.title,
            request_type=r.request_type,
            status=r.status,
            priority=r.priority,
            created_at=r.created_at,
            resolved_at=r.resolved_at,
            closed_at=r.closed_at,
            total_hours=float(r.total_hours),
            billable_hours=float(r.billable_hours),
            escalation_count=int(r.escalation_count),
            escalation_team_names=list(r.escalation_team_names) if r.escalation_team_names else [],
            assigned_user_name=r.assigned_user_name,
            contract_name=r.contract_name,
            linked_kb_article_id=r.linked_kb_article_id,
        )
        for r in rows
    ]

    return SupportHistoryOut(items=items, total=total)


# ------------------------------------------------------------------
# 주 연락처 지정 (P6-3)
# ------------------------------------------------------------------


@router.post(
    "/{customer_id}/contacts/{contact_id}/set-primary",
    response_model=ContactOut,
    summary="주 연락처 지정 (engineer+)",
)
async def set_primary_contact(
    tenant_slug: str,
    customer_id: uuid.UUID,
    contact_id: uuid.UUID,
    current_user: Annotated[User, Depends(require_roles(UserRole.admin, UserRole.team_lead, UserRole.engineer))] = None,
    db: AsyncSession = Depends(get_db),
) -> ContactOut:
    await _get_or_404(db, current_user.tenant_id, customer_id)
    contact = await _get_contact_or_404(db, current_user.tenant_id, customer_id, contact_id)

    # 기존 primary 먼저 False (unique 위반 방지)
    await db.execute(
        update(CustomerContact)
        .where(
            and_(
                CustomerContact.customer_id == customer_id,
                CustomerContact.tenant_id == current_user.tenant_id,
                CustomerContact.is_primary == True,  # noqa: E712
            )
        )
        .values(is_primary=False)
    )

    # 대상 contact → True
    contact.is_primary = True
    await db.flush()

    # customers.email/phone 동기화
    await _sync_primary_to_customer(db, customer_id, contact)

    # ── 이중쓰기: contacts is_primary 동기 (같은 트랜잭션) ────────────
    # 이 customer의 다른 모든 ContactContact → False
    _other_cc_ids = (await db.execute(
        select(CustomerContact.id).where(
            and_(
                CustomerContact.customer_id == customer_id,
                CustomerContact.tenant_id == current_user.tenant_id,
                CustomerContact.id != contact_id,
            )
        )
    )).scalars().all()
    if _other_cc_ids:
        await db.execute(
            update(Contact)
            .where(Contact.id.in_(_other_cc_ids))
            .values(is_primary=False)
        )
    # 대상 Contact → True
    await db.execute(
        update(Contact)
        .where(Contact.id == contact_id)
        .values(is_primary=True)
    )

    await db.commit()
    await db.refresh(contact)
    return ContactOut.model_validate(contact)
