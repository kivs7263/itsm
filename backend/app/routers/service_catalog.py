"""서비스 카탈로그 관리자(staff) CRUD 라우터 (CA-P1-5 P2).

prefix : /{tenant_slug}/service-catalog
인증   : get_current_user (목록/상세) / require_roles(admin, team_lead) (CUD)
격리   : 모든 쿼리 tenant_id == current_user.tenant_id (명시 필터)

엔드포인트:
  카테고리
    GET    /{tenant_slug}/service-catalog/categories               — 목록
    POST   /{tenant_slug}/service-catalog/categories               — 생성
    PATCH  /{tenant_slug}/service-catalog/categories/{cat_id}      — 수정

  오퍼링
    GET    /{tenant_slug}/service-catalog/offerings                — 목록 (필터 가능)
    GET    /{tenant_slug}/service-catalog/offerings/{off_id}       — 상세 (form_schema 포함)
    POST   /{tenant_slug}/service-catalog/offerings                — 생성
    PATCH  /{tenant_slug}/service-catalog/offerings/{off_id}       — 수정
    PATCH  /{tenant_slug}/service-catalog/offerings/{off_id}/toggle-active — 활성 토글

주의:
  - is_system=True 오퍼링은 삭제 불가 (활성 토글·form_schema·approval_policy 수정만 허용)
  - tenant_id 명시 필터 전수 적용 (멀티테넌트 row-level isolation)
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user, require_roles
from app.models.user import User, UserRole
from app.models.service_catalog import ServiceCategory, ServiceOffering

router = APIRouter(
    prefix="/{tenant_slug}/service-catalog",
    tags=["service-catalog"],
)

_ADMIN_ROLES = (UserRole.admin, UserRole.team_lead)

# ─────────────────────────────────────────────────────────────────────────────
# 스키마
# ─────────────────────────────────────────────────────────────────────────────


class CategoryCreate(BaseModel):
    name: str = Field(..., max_length=100)
    slug: str = Field(..., max_length=60)
    icon: str | None = Field(None, max_length=60)
    parent_id: uuid.UUID | None = None
    display_order: int = 0


class CategoryUpdate(BaseModel):
    name: str | None = Field(None, max_length=100)
    icon: str | None = Field(None, max_length=60)
    parent_id: uuid.UUID | None = None
    display_order: int | None = None
    is_active: bool | None = None


class CategoryOut(BaseModel):
    id: str
    name: str
    slug: str
    icon: str | None
    parent_id: str | None
    display_order: int
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class OfferingCreate(BaseModel):
    code: str = Field(..., max_length=60)
    name: str = Field(..., max_length=200)
    description: str | None = None
    icon: str | None = Field(None, max_length=60)
    category_id: uuid.UUID | None = None
    request_type: str = Field(..., max_length=30)
    default_priority: str = "medium"
    default_sla_grade: str | None = None
    form_schema: dict = Field(default_factory=dict)
    approval_policy: dict = Field(default_factory=dict)
    display_order: int = 0


class OfferingUpdate(BaseModel):
    """오퍼링 수정 요청.

    is_system=True인 경우 백엔드에서 form_schema / approval_policy 외
    필드 수정을 차단한다.
    """
    name: str | None = Field(None, max_length=200)
    description: str | None = None
    icon: str | None = Field(None, max_length=60)
    category_id: uuid.UUID | None = None
    request_type: str | None = Field(None, max_length=30)
    default_priority: str | None = None
    default_sla_grade: str | None = None
    form_schema: dict | None = None
    approval_policy: dict | None = None
    display_order: int | None = None


class OfferingOut(BaseModel):
    id: str
    code: str
    name: str
    description: str | None
    icon: str | None
    category_id: str | None
    request_type: str
    default_priority: str
    default_sla_grade: str | None
    form_schema: dict
    approval_policy: dict
    is_active: bool
    is_system: bool
    display_order: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ─────────────────────────────────────────────────────────────────────────────
# 헬퍼
# ─────────────────────────────────────────────────────────────────────────────

_VALID_PRIORITIES = frozenset({"low", "medium", "high", "critical"})
_VALID_SLA_GRADES = frozenset({"bronze", "silver", "gold", "platinum"})


def _serialize_category(cat: ServiceCategory) -> CategoryOut:
    return CategoryOut(
        id=str(cat.id),
        name=cat.name,
        slug=cat.slug,
        icon=cat.icon,
        parent_id=str(cat.parent_id) if cat.parent_id else None,
        display_order=cat.display_order,
        is_active=cat.is_active,
        created_at=cat.created_at,
        updated_at=cat.updated_at,
    )


def _serialize_offering(off: ServiceOffering) -> OfferingOut:
    return OfferingOut(
        id=str(off.id),
        code=off.code,
        name=off.name,
        description=off.description,
        icon=off.icon,
        category_id=str(off.category_id) if off.category_id else None,
        request_type=off.request_type,
        default_priority=(
            off.default_priority
            if isinstance(off.default_priority, str)
            else off.default_priority.value
        ),
        default_sla_grade=(
            off.default_sla_grade
            if isinstance(off.default_sla_grade, str)
            else (off.default_sla_grade.value if off.default_sla_grade else None)
        ),
        form_schema=off.form_schema or {},
        approval_policy=off.approval_policy or {},
        is_active=off.is_active,
        is_system=off.is_system,
        display_order=off.display_order,
        created_at=off.created_at,
        updated_at=off.updated_at,
    )


async def _get_category_or_404(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    category_id: uuid.UUID,
) -> ServiceCategory:
    cat = await db.scalar(
        select(ServiceCategory).where(
            and_(
                ServiceCategory.id == category_id,
                ServiceCategory.tenant_id == tenant_id,
            )
        )
    )
    if cat is None:
        raise HTTPException(status_code=404, detail="카테고리를 찾을 수 없습니다.")
    return cat


async def _get_offering_or_404(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    offering_id: uuid.UUID,
) -> ServiceOffering:
    off = await db.scalar(
        select(ServiceOffering).where(
            and_(
                ServiceOffering.id == offering_id,
                ServiceOffering.tenant_id == tenant_id,
            )
        )
    )
    if off is None:
        raise HTTPException(status_code=404, detail="서비스 항목을 찾을 수 없습니다.")
    return off


# ─────────────────────────────────────────────────────────────────────────────
# 카테고리 CRUD
# ─────────────────────────────────────────────────────────────────────────────


@router.get(
    "/categories",
    response_model=list[CategoryOut],
    summary="카테고리 목록",
)
async def list_categories(
    tenant_slug: str,
    include_inactive: bool = Query(default=False),
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> list[CategoryOut]:
    conditions = [ServiceCategory.tenant_id == current_user.tenant_id]
    if not include_inactive:
        conditions.append(ServiceCategory.is_active.is_(True))

    rows = (
        await db.execute(
            select(ServiceCategory)
            .where(and_(*conditions))
            .order_by(ServiceCategory.display_order)
        )
    ).scalars().all()

    return [_serialize_category(c) for c in rows]


@router.post(
    "/categories",
    response_model=CategoryOut,
    status_code=status.HTTP_201_CREATED,
    summary="카테고리 생성",
)
async def create_category(
    tenant_slug: str,
    data: CategoryCreate,
    current_user: Annotated[User, Depends(require_roles(*_ADMIN_ROLES))] = None,
    db: AsyncSession = Depends(get_db),
) -> CategoryOut:
    # slug 중복 검사 (tenant 범위)
    existing = await db.scalar(
        select(ServiceCategory).where(
            and_(
                ServiceCategory.tenant_id == current_user.tenant_id,
                ServiceCategory.slug == data.slug,
            )
        )
    )
    if existing:
        raise HTTPException(status_code=409, detail="이미 사용 중인 slug입니다.")

    # parent_id 유효성 확인
    if data.parent_id:
        await _get_category_or_404(db, current_user.tenant_id, data.parent_id)

    cat = ServiceCategory(
        id=uuid.uuid4(),
        tenant_id=current_user.tenant_id,
        name=data.name,
        slug=data.slug,
        icon=data.icon,
        parent_id=data.parent_id,
        display_order=data.display_order,
    )
    db.add(cat)
    await db.commit()
    await db.refresh(cat)
    return _serialize_category(cat)


@router.patch(
    "/categories/{cat_id}",
    response_model=CategoryOut,
    summary="카테고리 수정",
)
async def update_category(
    tenant_slug: str,
    cat_id: uuid.UUID,
    data: CategoryUpdate,
    current_user: Annotated[User, Depends(require_roles(*_ADMIN_ROLES))] = None,
    db: AsyncSession = Depends(get_db),
) -> CategoryOut:
    cat = await _get_category_or_404(db, current_user.tenant_id, cat_id)

    if data.name is not None:
        cat.name = data.name
    if data.icon is not None:
        cat.icon = data.icon
    if data.parent_id is not None:
        if data.parent_id == cat_id:
            raise HTTPException(status_code=400, detail="자기 자신을 부모로 설정할 수 없습니다.")
        await _get_category_or_404(db, current_user.tenant_id, data.parent_id)
        cat.parent_id = data.parent_id
    if data.display_order is not None:
        cat.display_order = data.display_order
    if data.is_active is not None:
        cat.is_active = data.is_active

    cat.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(cat)
    return _serialize_category(cat)


# ─────────────────────────────────────────────────────────────────────────────
# 오퍼링 CRUD
# ─────────────────────────────────────────────────────────────────────────────


@router.get(
    "/offerings",
    response_model=list[OfferingOut],
    summary="오퍼링 목록",
)
async def list_offerings(
    tenant_slug: str,
    category_id: uuid.UUID | None = Query(default=None),
    is_active: bool | None = Query(default=None),
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> list[OfferingOut]:
    conditions = [ServiceOffering.tenant_id == current_user.tenant_id]
    if category_id is not None:
        conditions.append(ServiceOffering.category_id == category_id)
    if is_active is not None:
        conditions.append(ServiceOffering.is_active.is_(is_active))

    rows = (
        await db.execute(
            select(ServiceOffering)
            .where(and_(*conditions))
            .order_by(ServiceOffering.display_order)
        )
    ).scalars().all()

    return [_serialize_offering(o) for o in rows]


@router.get(
    "/offerings/{off_id}",
    response_model=OfferingOut,
    summary="오퍼링 상세 (form_schema 포함)",
)
async def get_offering(
    tenant_slug: str,
    off_id: uuid.UUID,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> OfferingOut:
    off = await _get_offering_or_404(db, current_user.tenant_id, off_id)
    return _serialize_offering(off)


@router.post(
    "/offerings",
    response_model=OfferingOut,
    status_code=status.HTTP_201_CREATED,
    summary="오퍼링 생성",
)
async def create_offering(
    tenant_slug: str,
    data: OfferingCreate,
    current_user: Annotated[User, Depends(require_roles(*_ADMIN_ROLES))] = None,
    db: AsyncSession = Depends(get_db),
) -> OfferingOut:
    # code 중복 검사 (tenant 범위)
    existing = await db.scalar(
        select(ServiceOffering).where(
            and_(
                ServiceOffering.tenant_id == current_user.tenant_id,
                ServiceOffering.code == data.code,
            )
        )
    )
    if existing:
        raise HTTPException(status_code=409, detail="이미 사용 중인 code입니다.")

    # 필드 검증
    if data.default_priority not in _VALID_PRIORITIES:
        raise HTTPException(
            status_code=422,
            detail=f"default_priority는 {sorted(_VALID_PRIORITIES)} 중 하나여야 합니다.",
        )
    if data.default_sla_grade and data.default_sla_grade not in _VALID_SLA_GRADES:
        raise HTTPException(
            status_code=422,
            detail=f"default_sla_grade는 {sorted(_VALID_SLA_GRADES)} 중 하나여야 합니다.",
        )
    if data.category_id:
        await _get_category_or_404(db, current_user.tenant_id, data.category_id)

    off = ServiceOffering(
        id=uuid.uuid4(),
        tenant_id=current_user.tenant_id,
        code=data.code,
        name=data.name,
        description=data.description,
        icon=data.icon,
        category_id=data.category_id,
        request_type=data.request_type,
        default_priority=data.default_priority,
        default_sla_grade=data.default_sla_grade,
        form_schema=data.form_schema,
        approval_policy=data.approval_policy,
        display_order=data.display_order,
        is_active=True,
        is_system=False,
    )
    db.add(off)
    await db.commit()
    await db.refresh(off)
    return _serialize_offering(off)


@router.patch(
    "/offerings/{off_id}",
    response_model=OfferingOut,
    summary="오퍼링 수정 (is_system=True는 form_schema/approval_policy만 허용)",
)
async def update_offering(
    tenant_slug: str,
    off_id: uuid.UUID,
    data: OfferingUpdate,
    current_user: Annotated[User, Depends(require_roles(*_ADMIN_ROLES))] = None,
    db: AsyncSession = Depends(get_db),
) -> OfferingOut:
    off = await _get_offering_or_404(db, current_user.tenant_id, off_id)

    if off.is_system:
        # is_system=True: form_schema / approval_policy 수정만 허용
        _system_blocked = []
        if data.name is not None:
            _system_blocked.append("name")
        if data.description is not None:
            _system_blocked.append("description")
        if data.icon is not None:
            _system_blocked.append("icon")
        if data.category_id is not None:
            _system_blocked.append("category_id")
        if data.request_type is not None:
            _system_blocked.append("request_type")
        if data.default_priority is not None:
            _system_blocked.append("default_priority")
        if data.default_sla_grade is not None:
            _system_blocked.append("default_sla_grade")
        if data.display_order is not None:
            _system_blocked.append("display_order")
        if _system_blocked:
            raise HTTPException(
                status_code=403,
                detail=(
                    f"시스템 항목은 form_schema·approval_policy만 수정 가능합니다. "
                    f"차단된 필드: {', '.join(_system_blocked)}"
                ),
            )
        # 허용된 필드만 적용
        if data.form_schema is not None:
            off.form_schema = data.form_schema
        if data.approval_policy is not None:
            off.approval_policy = data.approval_policy
    else:
        # 일반 오퍼링 — 모든 필드 허용
        if data.name is not None:
            off.name = data.name
        if data.description is not None:
            off.description = data.description
        if data.icon is not None:
            off.icon = data.icon
        if data.category_id is not None:
            await _get_category_or_404(db, current_user.tenant_id, data.category_id)
            off.category_id = data.category_id
        if data.request_type is not None:
            off.request_type = data.request_type
        if data.default_priority is not None:
            if data.default_priority not in _VALID_PRIORITIES:
                raise HTTPException(
                    status_code=422,
                    detail=f"default_priority는 {sorted(_VALID_PRIORITIES)} 중 하나여야 합니다.",
                )
            off.default_priority = data.default_priority
        if data.default_sla_grade is not None:
            if data.default_sla_grade not in _VALID_SLA_GRADES:
                raise HTTPException(
                    status_code=422,
                    detail=f"default_sla_grade는 {sorted(_VALID_SLA_GRADES)} 중 하나여야 합니다.",
                )
            off.default_sla_grade = data.default_sla_grade
        if data.form_schema is not None:
            off.form_schema = data.form_schema
        if data.approval_policy is not None:
            off.approval_policy = data.approval_policy
        if data.display_order is not None:
            off.display_order = data.display_order

    off.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(off)
    return _serialize_offering(off)


@router.patch(
    "/offerings/{off_id}/toggle-active",
    response_model=OfferingOut,
    summary="오퍼링 활성/비활성 토글 (is_system=True도 허용)",
)
async def toggle_offering_active(
    tenant_slug: str,
    off_id: uuid.UUID,
    current_user: Annotated[User, Depends(require_roles(*_ADMIN_ROLES))] = None,
    db: AsyncSession = Depends(get_db),
) -> OfferingOut:
    off = await _get_offering_or_404(db, current_user.tenant_id, off_id)
    off.is_active = not off.is_active
    off.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(off)
    return _serialize_offering(off)
