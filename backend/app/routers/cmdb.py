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

  [CA-P2-5] Discovery Import:
  POST   /{tenant_slug}/cmdb/import/csv                  — CSV 파일 일괄 import (admin/team_lead)
  POST   /{tenant_slug}/cmdb/import/json                 — JSON API 일괄 import (admin/team_lead)
  GET    /{tenant_slug}/cmdb/import/runs                 — import 이력 목록
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy import and_, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import AsyncSessionLocal, get_db
from app.core.dependencies import get_current_user, require_roles
from app.models import (
    CIChangeLog,
    CICriticality,
    CIEnvironment,
    CIRelType,
    CIRelationship,
    CIStatus,
    CIType,
    CmdbImportRun,
    ConfigurationItem,
    User,
    UserRole,
)
from app.services.cmdb_import import ImportResult, parse_csv, upsert_assets, upsert_cis

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


class ImportRunOut(BaseModel):
    id: uuid.UUID
    tenant_id: uuid.UUID
    source: str
    target: str
    status: str
    total_rows: int
    created_count: int
    updated_count: int
    skipped_count: int
    error_count: int
    errors: list[dict]
    dedup_key: str | None
    created_by: uuid.UUID | None
    created_at: datetime

    model_config = {"from_attributes": True}


# [CA-P2-5] 단일 import 요청 행 수 상한 — 커넥션 풀 고갈/타임아웃 방지
MAX_IMPORT_ROWS = 5000


class JsonImportBody(BaseModel):
    target: str = Field(..., pattern="^(ci|asset)$")
    items: list[dict] = Field(..., max_length=MAX_IMPORT_ROWS)


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


# ------------------------------------------------------------------
# [CA-P2-5] Discovery Import — CSV
# ------------------------------------------------------------------


@router.post(
    "/import/csv",
    response_model=ImportRunOut,
    status_code=status.HTTP_201_CREATED,
    summary="CMDB Discovery CSV Import (admin/team_lead)",
)
async def import_csv(
    tenant_slug: str,
    file: UploadFile = File(..., description="text/csv"),
    target: str = Query(..., pattern="^(ci|asset)$", description="'ci' 또는 'asset'"),
    current_user: Annotated[User, Depends(require_roles(UserRole.admin, UserRole.team_lead))] = None,
    db: AsyncSession = Depends(get_db),
) -> ImportRunOut:
    """CSV 파일을 읽어 CI 또는 Asset을 일괄 생성/수정.

    - Content-Type: multipart/form-data
    - target: 'ci' | 'asset'  (query param)
    - 부분 성공: 에러 행은 skip, 나머지 반영 후 import_run 기록
    """
    content_bytes = await file.read()
    try:
        content = content_bytes.decode("utf-8-sig")  # BOM 있는 Excel CSV도 처리
    except UnicodeDecodeError:
        try:
            content = content_bytes.decode("cp949")  # strict — 손상 시 식별자 깨짐 차단
        except UnicodeDecodeError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="CSV 인코딩을 인식할 수 없습니다 (UTF-8 또는 CP949만 지원).",
            )

    rows = parse_csv(content, target)

    if len(rows) > MAX_IMPORT_ROWS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"한 번에 import 가능한 행 수는 최대 {MAX_IMPORT_ROWS}건입니다 "
                   f"(요청 {len(rows)}건). 파일을 분할해 주세요.",
        )

    if target == "ci":
        result = await upsert_cis(db, current_user.tenant_id, rows, current_user)
    else:
        result = await upsert_assets(db, current_user.tenant_id, rows, current_user)

    # upsert 커밋 (savepoint들 확정)
    await db.commit()

    # import_run 별도 커밋 — upsert 커밋 이후 독립 세션으로 기록
    run = await _record_import_run(
        tenant_id=current_user.tenant_id,
        source="csv",
        target=target,
        result=result,
        created_by=current_user.id,
    )
    return ImportRunOut.model_validate(run)


# ------------------------------------------------------------------
# [CA-P2-5] Discovery Import — JSON API
# ------------------------------------------------------------------


@router.post(
    "/import/json",
    response_model=ImportRunOut,
    status_code=status.HTTP_201_CREATED,
    summary="CMDB Discovery JSON Import (admin/team_lead)",
)
async def import_json(
    tenant_slug: str,
    body: JsonImportBody,
    current_user: Annotated[User, Depends(require_roles(UserRole.admin, UserRole.team_lead))] = None,
    db: AsyncSession = Depends(get_db),
) -> ImportRunOut:
    """JSON 페이로드로 CI 또는 Asset을 일괄 생성/수정.

    body: {"target": "ci"|"asset", "items": [{...}, ...]}
    """
    target = body.target
    rows = body.items

    if target == "ci":
        result = await upsert_cis(db, current_user.tenant_id, rows, current_user)
    else:
        result = await upsert_assets(db, current_user.tenant_id, rows, current_user)

    await db.commit()

    run = await _record_import_run(
        tenant_id=current_user.tenant_id,
        source="json_api",
        target=target,
        result=result,
        created_by=current_user.id,
    )
    return ImportRunOut.model_validate(run)


# ------------------------------------------------------------------
# [CA-P2-5] Import 이력 목록
# ------------------------------------------------------------------


@router.get(
    "/import/runs",
    response_model=dict,
    summary="CMDB Import 이력 목록 (최신순)",
)
async def list_import_runs(
    tenant_slug: str,
    target: str | None = Query(None, pattern="^(ci|asset)$"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> dict:
    conditions = [CmdbImportRun.tenant_id == current_user.tenant_id]
    if target:
        conditions.append(CmdbImportRun.target == target)

    where_clause = and_(*conditions)
    total = await db.scalar(
        select(func.count()).select_from(CmdbImportRun).where(where_clause)
    )
    run_rows = (
        await db.execute(
            select(CmdbImportRun)
            .where(where_clause)
            .order_by(CmdbImportRun.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    ).scalars().all()

    return {
        "items": [ImportRunOut.model_validate(r) for r in run_rows],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


# ------------------------------------------------------------------
# 헬퍼 — import_run 기록 (별도 세션, 독립 커밋)
# ------------------------------------------------------------------


async def _record_import_run(
    *,
    tenant_id: uuid.UUID,
    source: str,
    target: str,
    result: ImportResult,
    created_by: uuid.UUID,
) -> CmdbImportRun:
    """CmdbImportRun을 별도 AsyncSessionLocal 세션으로 커밋.

    upsert 트랜잭션과 격리 — 이력 기록 실패가 upsert 커밋에 영향 없음.
    """
    run = CmdbImportRun(
        id=uuid.uuid4(),
        tenant_id=tenant_id,
        source=source,
        target=target,
        status=result.status,
        total_rows=result.total_rows,
        created_count=result.created_count,
        updated_count=result.updated_count,
        skipped_count=result.skipped_count,
        error_count=result.error_count,
        errors=result.errors,
        dedup_key=result.dedup_key,
        created_by=created_by,
    )
    try:
        async with AsyncSessionLocal() as run_db:
            run_db.add(run)
            await run_db.commit()
            await run_db.refresh(run)
    except Exception as exc:
        logger.error("import_run 기록 실패 (upsert는 이미 커밋됨): %s", exc)
        # 이력 기록 실패 시 run 객체는 id만 있어도 응답 가능 (graceful)
    return run
