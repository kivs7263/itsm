"""자산 라우터.

prefix : /{tenant_slug}/assets
인증   : get_current_user
격리   : 모든 쿼리 tenant_id == current_user.tenant_id

엔드포인트:
  GET    /{tenant_slug}/assets       — 목록 (필터 + 페이지네이션)
  POST   /{tenant_slug}/assets       — 생성
  GET    /{tenant_slug}/assets/{id}  — 상세
  PATCH  /{tenant_slug}/assets/{id}  — 수정
  DELETE /{tenant_slug}/assets/{id}  — 삭제 (admin/team_lead)
"""
from __future__ import annotations

import logging
import uuid
from datetime import date, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user, require_roles
from app.models import Asset, AssetType, Customer, User, UserRole

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/{tenant_slug}/assets",
    tags=["assets"],
)


# ------------------------------------------------------------------
# 스키마
# ------------------------------------------------------------------


class AssetCreate(BaseModel):
    asset_tag: str = Field(..., max_length=100)
    model: str = Field(..., max_length=200)
    serial: str | None = Field(None, max_length=200)
    asset_type: AssetType
    customer_id: uuid.UUID
    location: dict | None = None
    installed_at: date | None = None
    warranty_end: date | None = None
    license_end: date | None = None


class AssetUpdate(BaseModel):
    asset_tag: str | None = Field(None, max_length=100)
    model: str | None = Field(None, max_length=200)
    serial: str | None = Field(None, max_length=200)
    asset_type: AssetType | None = None
    customer_id: uuid.UUID | None = None
    location: dict | None = None
    installed_at: date | None = None
    warranty_end: date | None = None
    license_end: date | None = None


class AssetOut(BaseModel):
    id: uuid.UUID
    tenant_id: uuid.UUID
    customer_id: uuid.UUID
    asset_tag: str
    model: str
    serial: str | None
    asset_type: str
    location: dict | None
    installed_at: date | None
    warranty_end: date | None
    license_end: date | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ------------------------------------------------------------------
# 헬퍼
# ------------------------------------------------------------------


async def _get_or_404(
    db: AsyncSession, tenant_id: uuid.UUID, asset_id: uuid.UUID
) -> Asset:
    row = await db.scalar(
        select(Asset).where(
            and_(Asset.id == asset_id, Asset.tenant_id == tenant_id)
        )
    )
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="자산을 찾을 수 없습니다.")
    return row


# ------------------------------------------------------------------
# 목록
# ------------------------------------------------------------------


@router.get(
    "",
    response_model=dict,
    summary="자산 목록 (필터 + 페이지네이션)",
)
async def list_assets(
    tenant_slug: str,
    customer_id: uuid.UUID | None = Query(None),
    asset_type: AssetType | None = Query(None),
    search: str | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> dict:
    conditions = [Asset.tenant_id == current_user.tenant_id]

    if customer_id:
        conditions.append(Asset.customer_id == customer_id)
    if asset_type:
        conditions.append(Asset.asset_type == asset_type)
    if search:
        like = f"%{search}%"
        conditions.append(
            or_(
                Asset.asset_tag.ilike(like),
                Asset.model.ilike(like),
                Asset.serial.ilike(like),
            )
        )

    where_clause = and_(*conditions)
    total = await db.scalar(
        select(func.count()).select_from(Asset).where(where_clause)
    )
    rows = (
        await db.execute(
            select(Asset)
            .where(where_clause)
            .order_by(Asset.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    ).scalars().all()

    return {
        "items": [AssetOut.model_validate(r) for r in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


# ------------------------------------------------------------------
# 생성
# ------------------------------------------------------------------


@router.post(
    "",
    response_model=AssetOut,
    status_code=status.HTTP_201_CREATED,
    summary="자산 생성",
)
async def create_asset(
    tenant_slug: str,
    data: AssetCreate,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> AssetOut:
    if data.customer_id:
        cust = await db.scalar(
            select(Customer).where(
                Customer.id == data.customer_id,
                Customer.tenant_id == current_user.tenant_id,
            )
        )
        if cust is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="고객을 찾을 수 없습니다.")

    asset = Asset(
        id=uuid.uuid4(),
        tenant_id=current_user.tenant_id,
        asset_tag=data.asset_tag,
        model=data.model,
        serial=data.serial,
        asset_type=data.asset_type,
        customer_id=data.customer_id,
        location=data.location or {},
        installed_at=data.installed_at,
        warranty_end=data.warranty_end,
        license_end=data.license_end,
    )
    db.add(asset)
    await db.commit()
    await db.refresh(asset)
    return AssetOut.model_validate(asset)


# ------------------------------------------------------------------
# 상세
# ------------------------------------------------------------------


@router.get(
    "/{asset_id}",
    response_model=AssetOut,
    summary="자산 상세",
)
async def get_asset(
    tenant_slug: str,
    asset_id: uuid.UUID,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> AssetOut:
    asset = await _get_or_404(db, current_user.tenant_id, asset_id)
    return AssetOut.model_validate(asset)


# ------------------------------------------------------------------
# 수정
# ------------------------------------------------------------------


@router.patch(
    "/{asset_id}",
    response_model=AssetOut,
    summary="자산 수정",
)
async def update_asset(
    tenant_slug: str,
    asset_id: uuid.UUID,
    data: AssetUpdate,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> AssetOut:
    asset = await _get_or_404(db, current_user.tenant_id, asset_id)

    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(asset, field, value)

    await db.commit()
    await db.refresh(asset)
    return AssetOut.model_validate(asset)


# ------------------------------------------------------------------
# 삭제 (admin/team_lead)
# ------------------------------------------------------------------


@router.delete(
    "/{asset_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="자산 삭제 (admin/team_lead)",
)
async def delete_asset(
    tenant_slug: str,
    asset_id: uuid.UUID,
    current_user: Annotated[User, Depends(require_roles(UserRole.admin, UserRole.team_lead))] = None,
    db: AsyncSession = Depends(get_db),
) -> None:
    asset = await _get_or_404(db, current_user.tenant_id, asset_id)
    await db.delete(asset)
    await db.commit()
