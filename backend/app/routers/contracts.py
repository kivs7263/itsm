"""계약 라우터.

prefix : /{tenant_slug}/contracts
인증   : get_current_user
격리   : 모든 쿼리 tenant_id == current_user.tenant_id

엔드포인트:
  GET    /{tenant_slug}/contracts       — 목록 (필터 + 페이지네이션)
  POST   /{tenant_slug}/contracts       — 생성
  GET    /{tenant_slug}/contracts/{id}  — 상세
  PATCH  /{tenant_slug}/contracts/{id}  — 수정
  DELETE /{tenant_slug}/contracts/{id}  — 삭제 (admin/team_lead)
"""
from __future__ import annotations

import logging
import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user, require_roles
from app.models import Contract, ContractType, Customer, User, UserRole

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/{tenant_slug}/contracts",
    tags=["contracts"],
)


# ------------------------------------------------------------------
# 스키마
# ------------------------------------------------------------------


class ContractCreate(BaseModel):
    name: str = Field(..., max_length=200)
    customer_id: uuid.UUID
    type: ContractType
    sla_grade: str = Field(..., max_length=50)
    start_date: date
    end_date: date
    amount: Decimal | None = None
    support_hours: str | None = Field(None, max_length=100)
    memo: str | None = None
    linked_business_id: uuid.UUID | None = None


class ContractUpdate(BaseModel):
    name: str | None = Field(None, max_length=200)
    customer_id: uuid.UUID | None = None
    type: ContractType | None = None
    sla_grade: str | None = Field(None, max_length=50)
    start_date: date | None = None
    end_date: date | None = None
    amount: Decimal | None = None
    support_hours: str | None = Field(None, max_length=100)
    memo: str | None = None
    linked_business_id: uuid.UUID | None = None


class ContractOut(BaseModel):
    id: uuid.UUID
    tenant_id: uuid.UUID
    customer_id: uuid.UUID
    name: str
    type: str
    sla_grade: str
    start_date: date
    end_date: date
    amount: Decimal | None
    support_hours: str | None
    memo: str | None
    linked_business_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ------------------------------------------------------------------
# 헬퍼
# ------------------------------------------------------------------


async def _get_or_404(
    db: AsyncSession, tenant_id: uuid.UUID, contract_id: uuid.UUID
) -> Contract:
    row = await db.scalar(
        select(Contract).where(
            and_(Contract.id == contract_id, Contract.tenant_id == tenant_id)
        )
    )
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="계약을 찾을 수 없습니다.")
    return row


# ------------------------------------------------------------------
# 목록
# ------------------------------------------------------------------


@router.get(
    "",
    response_model=dict,
    summary="계약 목록 (필터 + 페이지네이션)",
)
async def list_contracts(
    tenant_slug: str,
    customer_id: uuid.UUID | None = Query(None),
    contract_type: ContractType | None = Query(None, alias="type"),
    expiring_within_days: int | None = Query(None, ge=1, le=365),
    search: str | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> dict:
    from datetime import timedelta

    conditions = [Contract.tenant_id == current_user.tenant_id]

    if customer_id:
        conditions.append(Contract.customer_id == customer_id)
    if contract_type:
        conditions.append(Contract.type == contract_type)
    if expiring_within_days is not None:
        from datetime import date as date_cls
        cutoff = date_cls.today() + timedelta(days=expiring_within_days)
        conditions.append(Contract.end_date <= cutoff)
        conditions.append(Contract.end_date >= date_cls.today())
    if search:
        conditions.append(Contract.name.ilike(f"%{search}%"))

    where_clause = and_(*conditions)
    total = await db.scalar(
        select(func.count()).select_from(Contract).where(where_clause)
    )
    rows = (
        await db.execute(
            select(Contract)
            .where(where_clause)
            .order_by(Contract.end_date.asc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    ).scalars().all()

    return {
        "items": [ContractOut.model_validate(r) for r in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


# ------------------------------------------------------------------
# 생성
# ------------------------------------------------------------------


@router.post(
    "",
    response_model=ContractOut,
    status_code=status.HTTP_201_CREATED,
    summary="계약 생성",
)
async def create_contract(
    tenant_slug: str,
    data: ContractCreate,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> ContractOut:
    cust = await db.scalar(
        select(Customer).where(
            Customer.id == data.customer_id,
            Customer.tenant_id == current_user.tenant_id,
        )
    )
    if cust is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="고객을 찾을 수 없습니다.")

    contract = Contract(
        id=uuid.uuid4(),
        tenant_id=current_user.tenant_id,
        name=data.name,
        customer_id=data.customer_id,
        type=data.type,
        sla_grade=data.sla_grade,
        start_date=data.start_date,
        end_date=data.end_date,
        amount=data.amount,
        support_hours=data.support_hours,
        memo=data.memo,
        linked_business_id=data.linked_business_id,
    )
    db.add(contract)
    await db.commit()
    await db.refresh(contract)
    return ContractOut.model_validate(contract)


# ------------------------------------------------------------------
# 상세
# ------------------------------------------------------------------


@router.get(
    "/{contract_id}",
    response_model=ContractOut,
    summary="계약 상세",
)
async def get_contract(
    tenant_slug: str,
    contract_id: uuid.UUID,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> ContractOut:
    contract = await _get_or_404(db, current_user.tenant_id, contract_id)
    return ContractOut.model_validate(contract)


# ------------------------------------------------------------------
# 수정
# ------------------------------------------------------------------


@router.patch(
    "/{contract_id}",
    response_model=ContractOut,
    summary="계약 수정",
)
async def update_contract(
    tenant_slug: str,
    contract_id: uuid.UUID,
    data: ContractUpdate,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> ContractOut:
    contract = await _get_or_404(db, current_user.tenant_id, contract_id)

    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(contract, field, value)

    await db.commit()
    await db.refresh(contract)
    return ContractOut.model_validate(contract)


# ------------------------------------------------------------------
# 삭제 (admin/team_lead)
# ------------------------------------------------------------------


@router.delete(
    "/{contract_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="계약 삭제 (admin/team_lead)",
)
async def delete_contract(
    tenant_slug: str,
    contract_id: uuid.UUID,
    current_user: Annotated[User, Depends(require_roles(UserRole.admin, UserRole.team_lead))] = None,
    db: AsyncSession = Depends(get_db),
) -> None:
    contract = await _get_or_404(db, current_user.tenant_id, contract_id)
    await db.delete(contract)
    await db.commit()
