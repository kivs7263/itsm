"""CMDB (Configuration Management Database) 라우터.

prefix : /{tenant_slug}/cmdb
인증   : get_current_user
격리   : 모든 쿼리 tenant_id == current_user.tenant_id

엔드포인트:
  GET    /{tenant_slug}/cmdb/cis                         — CI 목록
  POST   /{tenant_slug}/cmdb/cis                         — CI 생성
  GET    /{tenant_slug}/cmdb/cis/{id}                    — CI 상세 (관계 포함)
  PUT    /{tenant_slug}/cmdb/cis/{id}                    — CI 전체 수정 + 변경이력
  DELETE /{tenant_slug}/cmdb/cis/{id}                    — CI 삭제 (admin/team_lead)
  GET    /{tenant_slug}/cmdb/cis/{id}/relationships      — 관계 목록
  POST   /{tenant_slug}/cmdb/cis/{id}/relationships      — 관계 추가
  DELETE /{tenant_slug}/cmdb/cis/{id}/relationships/{rel_id} — 관계 삭제
  GET    /{tenant_slug}/cmdb/cis/{id}/history            — 변경 이력
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import and_, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user, require_roles
from app.models import (
    CIChangeLog,
    CICriticality,
    CIEnvironment,
    CIRelType,
    CIRelationship,
    CIStatus,
    CIType,
    ConfigurationItem,
    User,
    UserRole,
)

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/{tenant_slug}/cmdb",
    tags=["cmdb"],
)

# CI 수정 가능 필드 (변경 이력 추적 대상)
_TRACKED_FIELDS = [
    "ci_type", "name", "hostname", "ip_address", "os_type", "os_version",
    "environment", "status", "criticality", "owner_id", "customer_id",
    "asset_id", "attributes",
]


# ------------------------------------------------------------------
# 스키마
# ------------------------------------------------------------------


class CICreate(BaseModel):
    ci_type: CIType
    name: str = Field(..., max_length=500)
    hostname: str | None = Field(None, max_length=500)
    ip_address: str | None = Field(None, max_length=50)
    os_type: str | None = Field(None, max_length=200)
    os_version: str | None = Field(None, max_length=200)
    environment: CIEnvironment = CIEnvironment.production
    status: CIStatus = CIStatus.active
    criticality: CICriticality = CICriticality.medium
    owner_id: uuid.UUID | None = None
    customer_id: uuid.UUID | None = None
    asset_id: uuid.UUID | None = None
    attributes: dict | None = None


class CIUpdate(BaseModel):
    ci_type: CIType | None = None
    name: str | None = Field(None, max_length=500)
    hostname: str | None = Field(None, max_length=500)
    ip_address: str | None = Field(None, max_length=50)
    os_type: str | None = Field(None, max_length=200)
    os_version: str | None = Field(None, max_length=200)
    environment: CIEnvironment | None = None
    status: CIStatus | None = None
    criticality: CICriticality | None = None
    owner_id: uuid.UUID | None = None
    customer_id: uuid.UUID | None = None
    asset_id: uuid.UUID | None = None
    attributes: dict | None = None
    change_reason: str | None = None


class CIOut(BaseModel):
    id: uuid.UUID
    tenant_id: uuid.UUID
    ci_type: str
    name: str
    hostname: str | None
    ip_address: str | None
    os_type: str | None
    os_version: str | None
    environment: str
    status: str
    criticality: str
    owner_id: uuid.UUID | None
    customer_id: uuid.UUID | None
    asset_id: uuid.UUID | None
    attributes: dict
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class RelationshipCreate(BaseModel):
    to_ci_id: uuid.UUID
    rel_type: CIRelType


class RelationshipOut(BaseModel):
    id: uuid.UUID
    from_ci_id: uuid.UUID
    to_ci_id: uuid.UUID
    rel_type: str
    created_at: datetime

    model_config = {"from_attributes": True}


class ChangeLogOut(BaseModel):
    id: uuid.UUID
    ci_id: uuid.UUID
    changed_by: uuid.UUID | None
    field_name: str
    old_value: str | None
    new_value: str | None
    change_reason: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


# ------------------------------------------------------------------
# 헬퍼
# ------------------------------------------------------------------


def _val_to_str(val) -> str | None:
    if val is None:
        return None
    if isinstance(val, dict):
        import json as _json
        return _json.dumps(val, sort_keys=True, ensure_ascii=False)
    return str(val)


async def _get_ci_or_404(
    db: AsyncSession, tenant_id: uuid.UUID, ci_id: uuid.UUID
) -> ConfigurationItem:
    row = await db.scalar(
        select(ConfigurationItem).where(
            and_(
                ConfigurationItem.id == ci_id,
                ConfigurationItem.tenant_id == tenant_id,
            )
        )
    )
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="CI를 찾을 수 없습니다.")
    return row


async def _record_changes(
    db: AsyncSession,
    ci: ConfigurationItem,
    changed_by_id: uuid.UUID,
    update_fields: dict,
    change_reason: str | None,
) -> None:
    """변경된 필드를 CIChangeLog에 기록."""
    for field in _TRACKED_FIELDS:
        if field not in update_fields:
            continue
        old_val = getattr(ci, field, None)
        new_val = update_fields[field]
        if _val_to_str(old_val) == _val_to_str(new_val):
            continue
        log = CIChangeLog(
            id=uuid.uuid4(),
            tenant_id=ci.tenant_id,
            ci_id=ci.id,
            changed_by=changed_by_id,
            field_name=field,
            old_value=_val_to_str(old_val),
            new_value=_val_to_str(new_val),
            change_reason=change_reason,
        )
        db.add(log)


# ------------------------------------------------------------------
# CI 목록
# ------------------------------------------------------------------


@router.get(
    "/cis",
    response_model=dict,
    summary="CI 목록 (필터 + 페이지네이션)",
)
async def list_cis(
    tenant_slug: str,
    ci_type: CIType | None = Query(None),
    ci_status: CIStatus | None = Query(None, alias="status"),
    environment: CIEnvironment | None = Query(None),
    criticality: CICriticality | None = Query(None),
    customer_id: uuid.UUID | None = Query(None),
    search: str | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> dict:
    conditions = [ConfigurationItem.tenant_id == current_user.tenant_id]

    if ci_type:
        conditions.append(ConfigurationItem.ci_type == ci_type)
    if ci_status:
        conditions.append(ConfigurationItem.status == ci_status)
    if environment:
        conditions.append(ConfigurationItem.environment == environment)
    if criticality:
        conditions.append(ConfigurationItem.criticality == criticality)
    if customer_id:
        conditions.append(ConfigurationItem.customer_id == customer_id)
    if search:
        like = f"%{search}%"
        conditions.append(
            or_(
                ConfigurationItem.name.ilike(like),
                ConfigurationItem.hostname.ilike(like),
                ConfigurationItem.ip_address.ilike(like),
            )
        )

    where_clause = and_(*conditions)
    total = await db.scalar(
        select(func.count()).select_from(ConfigurationItem).where(where_clause)
    )
    rows = (
        await db.execute(
            select(ConfigurationItem)
            .where(where_clause)
            .order_by(ConfigurationItem.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    ).scalars().all()

    return {
        "items": [CIOut.model_validate(r) for r in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


# ------------------------------------------------------------------
# CI 생성
# ------------------------------------------------------------------


@router.post(
    "/cis",
    response_model=CIOut,
    status_code=status.HTTP_201_CREATED,
    summary="CI 생성",
)
async def create_ci(
    tenant_slug: str,
    data: CICreate,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> CIOut:
    ci = ConfigurationItem(
        id=uuid.uuid4(),
        tenant_id=current_user.tenant_id,
        ci_type=data.ci_type,
        name=data.name,
        hostname=data.hostname,
        ip_address=data.ip_address,
        os_type=data.os_type,
        os_version=data.os_version,
        environment=data.environment,
        status=data.status,
        criticality=data.criticality,
        owner_id=data.owner_id,
        customer_id=data.customer_id,
        asset_id=data.asset_id,
        attributes=data.attributes or {},
    )
    db.add(ci)
    await db.commit()
    await db.refresh(ci)
    return CIOut.model_validate(ci)


# ------------------------------------------------------------------
# CI 상세 (관계 포함)
# ------------------------------------------------------------------


@router.get(
    "/cis/{ci_id}",
    response_model=dict,
    summary="CI 상세 (관계 포함)",
)
async def get_ci(
    tenant_slug: str,
    ci_id: uuid.UUID,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> dict:
    ci = await _get_ci_or_404(db, current_user.tenant_id, ci_id)

    # outbound: ci_id = from_ci_id
    out_rels = (
        await db.execute(
            select(CIRelationship).where(
                and_(
                    CIRelationship.tenant_id == current_user.tenant_id,
                    CIRelationship.from_ci_id == ci_id,
                )
            )
        )
    ).scalars().all()

    # inbound: ci_id = to_ci_id
    in_rels = (
        await db.execute(
            select(CIRelationship).where(
                and_(
                    CIRelationship.tenant_id == current_user.tenant_id,
                    CIRelationship.to_ci_id == ci_id,
                )
            )
        )
    ).scalars().all()

    # related CI 조회
    related_ids = {r.to_ci_id for r in out_rels} | {r.from_ci_id for r in in_rels}
    related_cis: dict[uuid.UUID, ConfigurationItem] = {}
    if related_ids:
        related_rows = (
            await db.execute(
                select(ConfigurationItem).where(
                    and_(
                        ConfigurationItem.tenant_id == current_user.tenant_id,
                        ConfigurationItem.id.in_(list(related_ids)),
                    )
                )
            )
        ).scalars().all()
        related_cis = {r.id: r for r in related_rows}

    relationships = []
    for rel in out_rels:
        related = related_cis.get(rel.to_ci_id)
        relationships.append({
            "id": str(rel.id),
            "rel_type": rel.rel_type if isinstance(rel.rel_type, str) else rel.rel_type.value,
            "direction": "out",
            "related_ci": {
                "id": str(related.id),
                "name": related.name,
                "ci_type": related.ci_type if isinstance(related.ci_type, str) else related.ci_type.value,
                "status": related.status if isinstance(related.status, str) else related.status.value,
            } if related else None,
        })
    for rel in in_rels:
        related = related_cis.get(rel.from_ci_id)
        relationships.append({
            "id": str(rel.id),
            "rel_type": rel.rel_type if isinstance(rel.rel_type, str) else rel.rel_type.value,
            "direction": "in",
            "related_ci": {
                "id": str(related.id),
                "name": related.name,
                "ci_type": related.ci_type if isinstance(related.ci_type, str) else related.ci_type.value,
                "status": related.status if isinstance(related.status, str) else related.status.value,
            } if related else None,
        })

    return {
        "ci": CIOut.model_validate(ci),
        "relationships": relationships,
    }


# ------------------------------------------------------------------
# CI 전체 수정 + 변경 이력
# ------------------------------------------------------------------


@router.put(
    "/cis/{ci_id}",
    response_model=CIOut,
    summary="CI 전체 수정 (변경 필드 자동 이력 기록)",
)
async def update_ci(
    tenant_slug: str,
    ci_id: uuid.UUID,
    data: CIUpdate,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> CIOut:
    ci = await _get_ci_or_404(db, current_user.tenant_id, ci_id)

    update_fields = data.model_dump(exclude_unset=True, exclude={"change_reason"})

    # 변경 이력 기록 (커밋 전)
    await _record_changes(db, ci, current_user.id, update_fields, data.change_reason)

    # 실제 업데이트
    for field, value in update_fields.items():
        setattr(ci, field, value)

    await db.commit()
    await db.refresh(ci)
    return CIOut.model_validate(ci)


# ------------------------------------------------------------------
# CI 삭제 (admin/team_lead)
# ------------------------------------------------------------------


@router.delete(
    "/cis/{ci_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="CI 삭제 (admin/team_lead)",
)
async def delete_ci(
    tenant_slug: str,
    ci_id: uuid.UUID,
    current_user: Annotated[User, Depends(require_roles(UserRole.admin, UserRole.team_lead))] = None,
    db: AsyncSession = Depends(get_db),
) -> None:
    ci = await _get_ci_or_404(db, current_user.tenant_id, ci_id)
    await db.delete(ci)
    await db.commit()


# ------------------------------------------------------------------
# 관계 목록
# ------------------------------------------------------------------


@router.get(
    "/cis/{ci_id}/relationships",
    response_model=list[RelationshipOut],
    summary="CI 관계 목록",
)
async def list_relationships(
    tenant_slug: str,
    ci_id: uuid.UUID,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> list[RelationshipOut]:
    await _get_ci_or_404(db, current_user.tenant_id, ci_id)

    rows = (
        await db.execute(
            select(CIRelationship).where(
                and_(
                    CIRelationship.tenant_id == current_user.tenant_id,
                    or_(
                        CIRelationship.from_ci_id == ci_id,
                        CIRelationship.to_ci_id == ci_id,
                    ),
                )
            )
        )
    ).scalars().all()
    return [RelationshipOut.model_validate(r) for r in rows]


# ------------------------------------------------------------------
# 관계 추가
# ------------------------------------------------------------------


@router.post(
    "/cis/{ci_id}/relationships",
    response_model=RelationshipOut,
    status_code=status.HTTP_201_CREATED,
    summary="CI 관계 추가",
)
async def add_relationship(
    tenant_slug: str,
    ci_id: uuid.UUID,
    data: RelationshipCreate,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> RelationshipOut:
    await _get_ci_or_404(db, current_user.tenant_id, ci_id)

    # to_ci_id 도 같은 테넌트인지 확인
    await _get_ci_or_404(db, current_user.tenant_id, data.to_ci_id)

    rel = CIRelationship(
        id=uuid.uuid4(),
        tenant_id=current_user.tenant_id,
        from_ci_id=ci_id,
        to_ci_id=data.to_ci_id,
        rel_type=data.rel_type,
    )
    db.add(rel)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="이미 동일한 관계가 존재합니다.",
        )
    await db.refresh(rel)
    return RelationshipOut.model_validate(rel)


# ------------------------------------------------------------------
# 관계 삭제
# ------------------------------------------------------------------


@router.delete(
    "/cis/{ci_id}/relationships/{rel_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="CI 관계 삭제",
)
async def delete_relationship(
    tenant_slug: str,
    ci_id: uuid.UUID,
    rel_id: uuid.UUID,
    current_user: Annotated[User, Depends(require_roles(UserRole.admin, UserRole.team_lead))] = None,
    db: AsyncSession = Depends(get_db),
) -> None:
    await _get_ci_or_404(db, current_user.tenant_id, ci_id)

    rel = await db.scalar(
        select(CIRelationship).where(
            and_(
                CIRelationship.id == rel_id,
                CIRelationship.tenant_id == current_user.tenant_id,
                or_(
                    CIRelationship.from_ci_id == ci_id,
                    CIRelationship.to_ci_id == ci_id,
                ),
            )
        )
    )
    if rel is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="관계를 찾을 수 없습니다.")
    await db.delete(rel)
    await db.commit()


# ------------------------------------------------------------------
# 변경 이력
# ------------------------------------------------------------------


@router.get(
    "/cis/{ci_id}/history",
    response_model=dict,
    summary="CI 변경 이력 (최신 순)",
)
async def get_ci_history(
    tenant_slug: str,
    ci_id: uuid.UUID,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> dict:
    await _get_ci_or_404(db, current_user.tenant_id, ci_id)

    where_clause = and_(
        CIChangeLog.ci_id == ci_id,
        CIChangeLog.tenant_id == current_user.tenant_id,
    )
    total = await db.scalar(
        select(func.count()).select_from(CIChangeLog).where(where_clause)
    )
    rows = (
        await db.execute(
            select(CIChangeLog)
            .where(where_clause)
            .order_by(CIChangeLog.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    ).scalars().all()

    return {
        "items": [ChangeLogOut.model_validate(r) for r in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
    }
