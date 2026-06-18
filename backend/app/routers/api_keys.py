"""API 키 관리 라우터.

prefix : /api/{tenant_slug}/settings/api-keys
권한   : admin 전용
저장   : key_hash = SHA-256(raw_key), raw_key은 생성 시 1회만 반환
형식   : itsm_{secrets.token_urlsafe(32)}
"""
from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user, require_roles
from app.models.api_key import ApiKey
from app.models.user import User, UserRole

router = APIRouter(
    prefix="/{tenant_slug}/settings/api-keys",
    tags=["api-keys"],
)


# ------------------------------------------------------------------
# 스키마
# ------------------------------------------------------------------

class ApiKeyCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    expires_at: datetime | None = None


class ApiKeyOut(BaseModel):
    id: uuid.UUID
    name: str
    created_by_name: str | None = None
    is_active: bool
    last_used_at: datetime | None = None
    expires_at: datetime | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class ApiKeyCreateResponse(ApiKeyOut):
    raw_key: str


# ------------------------------------------------------------------
# 목록
# ------------------------------------------------------------------

@router.get("", response_model=list[ApiKeyOut])
async def list_api_keys(
    tenant_slug: str,
    current_user: Annotated[User, Depends(require_roles(UserRole.admin))],
    db: AsyncSession = Depends(get_db),
) -> list[ApiKeyOut]:
    rows = (
        await db.execute(
            select(ApiKey)
            .where(ApiKey.tenant_id == current_user.tenant_id)
            .order_by(ApiKey.created_at.desc())
        )
    ).scalars().all()
    return [
        ApiKeyOut(
            id=r.id,
            name=r.name,
            created_by_name=r.creator.name if r.creator else None,
            is_active=r.is_active,
            last_used_at=r.last_used_at,
            expires_at=r.expires_at,
            created_at=r.created_at,
        )
        for r in rows
    ]


# ------------------------------------------------------------------
# 생성 — raw_key 1회 반환
# ------------------------------------------------------------------

@router.post("", response_model=ApiKeyCreateResponse, status_code=status.HTTP_201_CREATED)
async def create_api_key(
    tenant_slug: str,
    data: ApiKeyCreate,
    current_user: Annotated[User, Depends(require_roles(UserRole.admin))],
    db: AsyncSession = Depends(get_db),
) -> ApiKeyCreateResponse:
    raw_key = f"itsm_{secrets.token_urlsafe(32)}"
    key_hash = hashlib.sha256(raw_key.encode()).hexdigest()

    record = ApiKey(
        id=uuid.uuid4(),
        tenant_id=current_user.tenant_id,
        name=data.name,
        key_hash=key_hash,
        created_by=current_user.id,
        expires_at=data.expires_at,
    )
    db.add(record)
    await db.commit()
    await db.refresh(record)

    return ApiKeyCreateResponse(
        id=record.id,
        name=record.name,
        created_by_name=current_user.name,
        is_active=record.is_active,
        last_used_at=None,
        expires_at=record.expires_at,
        created_at=record.created_at,
        raw_key=raw_key,
    )


# ------------------------------------------------------------------
# 비활성화 (삭제 대신 is_active=False)
# ------------------------------------------------------------------

@router.delete("/{key_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_api_key(
    tenant_slug: str,
    key_id: uuid.UUID,
    current_user: Annotated[User, Depends(require_roles(UserRole.admin))],
    db: AsyncSession = Depends(get_db),
) -> None:
    record = (
        await db.execute(
            select(ApiKey).where(
                ApiKey.id == key_id,
                ApiKey.tenant_id == current_user.tenant_id,
            )
        )
    ).scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=404, detail="API 키를 찾을 수 없습니다.")
    record.is_active = False
    await db.commit()
