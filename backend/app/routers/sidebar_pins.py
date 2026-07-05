"""사이드바 즐겨찾기(pin) API (ITSM-SIDEBAR-P1).

사용자가 자주 쓰는 nav 항목을 고정(pin)해 사이드바 상단 즐겨찾기 그룹에 노출.
SA Workspace app/routers/sidebar_pins.py(GET/PUT upsert) 패턴 그대로 미러링.
ITSM는 RLS 미도입 — tenant 필터를 쿼리에 명시 (current_user.tenant_id).

- GET /api/{tenant_slug}/sidebar/pins   — 내 pinned_keys(없으면 빈 배열)
- PUT /api/{tenant_slug}/sidebar/pins   — upsert (tenant+user UNIQUE)
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models.sidebar_pin import SidebarPin
from app.models.user import User

router = APIRouter(prefix="/{tenant_slug}/sidebar", tags=["sidebar"])

_MAX_PINS = 30


class SidebarPinsResponse(BaseModel):
    pinned_keys: list[str]


class SidebarPinsUpdate(BaseModel):
    # nav item 안정 key(NavItem.key, 예: "tickets") 배열. 중복은 프론트에서도 걸러지지만 방어적으로 재확인.
    pinned_keys: list[str] = Field(..., max_length=_MAX_PINS)


@router.get("/pins", response_model=SidebarPinsResponse)
async def get_sidebar_pins(
    tenant_slug: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SidebarPinsResponse:
    """내 사이드바 즐겨찾기 조회. 저장된 게 없으면 빈 배열."""
    row = (
        await db.execute(
            select(SidebarPin).where(
                SidebarPin.tenant_id == current_user.tenant_id,
                SidebarPin.user_id == current_user.id,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        return SidebarPinsResponse(pinned_keys=[])
    return SidebarPinsResponse(pinned_keys=row.pinned_keys or [])


@router.put("/pins", response_model=SidebarPinsResponse)
async def put_sidebar_pins(
    tenant_slug: str,
    body: SidebarPinsUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SidebarPinsResponse:
    """사이드바 즐겨찾기 upsert (tenant+user UNIQUE)."""
    # 순서 보존 dedup
    deduped = list(dict.fromkeys(body.pinned_keys))
    now = datetime.now(timezone.utc)
    stmt = (
        pg_insert(SidebarPin)
        .values(
            id=uuid.uuid4(),
            tenant_id=current_user.tenant_id,
            user_id=current_user.id,
            pinned_keys=deduped,
            updated_at=now,
        )
        .on_conflict_do_update(
            constraint="uq_sidebar_pins_user",
            set_={"pinned_keys": deduped, "updated_at": now},
        )
    )
    await db.execute(stmt)
    await db.commit()
    return SidebarPinsResponse(pinned_keys=deduped)
