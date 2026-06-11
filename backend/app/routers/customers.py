"""고객 라우터.

prefix : /{tenant_slug}/customers
인증   : get_current_user
격리   : 모든 쿼리 tenant_id == current_user.tenant_id

엔드포인트:
  GET    /{tenant_slug}/customers       — 목록 (search + 페이지네이션)
  POST   /{tenant_slug}/customers       — 생성
  GET    /{tenant_slug}/customers/{id}  — 상세
  PATCH  /{tenant_slug}/customers/{id}  — 수정
  DELETE /{tenant_slug}/customers/{id}  — 삭제 (admin/team_lead)
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user, require_roles
from app.models import Customer, User, UserRole

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


class CustomerUpdate(BaseModel):
    name: str | None = Field(None, max_length=200)
    email: str | None = Field(None, max_length=255)
    phone: str | None = Field(None, max_length=50)
    company: str | None = Field(None, max_length=200)
    contract_grade: str | None = Field(None, max_length=50)


class CustomerOut(BaseModel):
    id: uuid.UUID
    tenant_id: uuid.UUID
    name: str
    email: str | None
    phone: str | None
    company: str | None
    contract_grade: str | None
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


# ------------------------------------------------------------------
# 목록
# ------------------------------------------------------------------


@router.get(
    "",
    response_model=dict,
    summary="고객 목록 (search + 페이지네이션)",
)
async def list_customers(
    tenant_slug: str,
    search: str | None = Query(None),
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


@router.post(
    "",
    response_model=CustomerOut,
    status_code=status.HTTP_201_CREATED,
    summary="고객 생성",
)
async def create_customer(
    tenant_slug: str,
    data: CustomerCreate,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> CustomerOut:
    customer = Customer(
        id=uuid.uuid4(),
        tenant_id=current_user.tenant_id,
        name=data.name,
        email=data.email,
        phone=data.phone,
        company=data.company,
        contract_grade=data.contract_grade,
    )
    db.add(customer)
    await db.commit()
    await db.refresh(customer)
    return CustomerOut.model_validate(customer)


# ------------------------------------------------------------------
# 상세
# ------------------------------------------------------------------


@router.get(
    "/{customer_id}",
    response_model=CustomerOut,
    summary="고객 상세",
)
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


@router.patch(
    "/{customer_id}",
    response_model=CustomerOut,
    summary="고객 수정",
)
async def update_customer(
    tenant_slug: str,
    customer_id: uuid.UUID,
    data: CustomerUpdate,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> CustomerOut:
    customer = await _get_or_404(db, current_user.tenant_id, customer_id)

    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(customer, field, value)

    await db.commit()
    await db.refresh(customer)
    return CustomerOut.model_validate(customer)


# ------------------------------------------------------------------
# 삭제 (admin/team_lead)
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
    await db.delete(customer)
    await db.commit()
