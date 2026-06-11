"""변경 관리 (Change Management) 라우터.

prefix : /{tenant_slug}/change-requests
인증   : get_current_user
격리   : 모든 쿼리 tenant_id == current_user.tenant_id

엔드포인트:
  GET    /{tenant_slug}/change-requests                         — 목록
  POST   /{tenant_slug}/change-requests                         — 생성
  GET    /{tenant_slug}/change-requests/{cr_id}                 — 상세 (linked CIs 포함)
  PATCH  /{tenant_slug}/change-requests/{cr_id}                 — 수정 (draft/pending_review 상태만)
  DELETE /{tenant_slug}/change-requests/{cr_id}                 — 삭제 (draft 상태만, admin/team_lead)
  POST   /{tenant_slug}/change-requests/{cr_id}/submit          — 검토 제출
  POST   /{tenant_slug}/change-requests/{cr_id}/submit-gw       — GW 결재 제출
  POST   /{tenant_slug}/change-requests/{cr_id}/approve         — 승인
  POST   /{tenant_slug}/change-requests/{cr_id}/reject          — 반려
  POST   /{tenant_slug}/change-requests/{cr_id}/schedule        — 일정 등록
  POST   /{tenant_slug}/change-requests/{cr_id}/start           — 시작
  POST   /{tenant_slug}/change-requests/{cr_id}/complete        — 완료
  POST   /{tenant_slug}/change-requests/{cr_id}/sync-gw         — GW 상태 동기화
  POST   /{tenant_slug}/change-requests/{cr_id}/ci-links        — CI 연결 추가
  DELETE /{tenant_slug}/change-requests/{cr_id}/ci-links/{ci_id} — CI 연결 제거
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
from app.models.change_request import (
    CRCILink,
    CRChangeType,
    CRPriority,
    CRRiskLevel,
    CRStatus,
    ChangeRequest,
)
from app.models.cmdb import ConfigurationItem
from app.models.user import User, UserRole
from app.services import gw_approval_service

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/{tenant_slug}/change-requests",
    tags=["change-requests"],
)


# ------------------------------------------------------------------
# Pydantic 스키마
# ------------------------------------------------------------------


class CRCreate(BaseModel):
    title: str = Field(..., max_length=500)
    description: str | None = None
    change_type: CRChangeType = CRChangeType.normal
    risk_level: CRRiskLevel = CRRiskLevel.medium
    priority: CRPriority = CRPriority.medium
    rollback_plan: str | None = None
    implementation_plan: str | None = None
    test_plan: str | None = None


class CRUpdate(BaseModel):
    title: str | None = Field(None, max_length=500)
    description: str | None = None
    change_type: CRChangeType | None = None
    risk_level: CRRiskLevel | None = None
    priority: CRPriority | None = None
    rollback_plan: str | None = None
    implementation_plan: str | None = None
    test_plan: str | None = None


class CRCILinkCreate(BaseModel):
    ci_id: uuid.UUID
    notes: str | None = None


class CRScheduleBody(BaseModel):
    planned_start: datetime
    planned_end: datetime


class CRRejectBody(BaseModel):
    reason: str | None = None


class _LinkedCIOut(BaseModel):
    ci_id: uuid.UUID
    ci_name: str | None
    notes: str | None

    model_config = {"from_attributes": True}


class CROut(BaseModel):
    id: uuid.UUID
    tenant_id: uuid.UUID
    title: str
    description: str | None
    change_type: str
    status: str
    risk_level: str
    priority: str
    rollback_plan: str | None
    implementation_plan: str | None
    test_plan: str | None
    requestor_id: uuid.UUID | None
    requestor_name: str | None
    implementor_id: uuid.UUID | None
    implementor_name: str | None
    reviewer_id: uuid.UUID | None
    reviewer_name: str | None
    gw_approval_doc_id: str | None
    gw_approval_status: str | None
    planned_start: datetime | None
    planned_end: datetime | None
    actual_start: datetime | None
    actual_end: datetime | None
    rejection_reason: str | None
    linked_cis: list[_LinkedCIOut]
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class CRListOut(BaseModel):
    items: list[CROut]
    total: int
    page: int
    page_size: int


# ------------------------------------------------------------------
# 헬퍼
# ------------------------------------------------------------------


async def _get_cr_or_404(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    cr_id: uuid.UUID,
) -> ChangeRequest:
    row = await db.scalar(
        select(ChangeRequest).where(
            and_(
                ChangeRequest.id == cr_id,
                ChangeRequest.tenant_id == tenant_id,
            )
        )
    )
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="변경 요청을 찾을 수 없습니다.",
        )
    return row


async def _build_cr_out(
    db: AsyncSession,
    cr: ChangeRequest,
) -> CROut:
    """CR 단건을 linked_cis + 이름 포함 dict로 변환."""
    # linked CIs 조회
    ci_link_rows = (
        await db.execute(
            select(CRCILink).where(
                and_(
                    CRCILink.cr_id == cr.id,
                    CRCILink.tenant_id == cr.tenant_id,
                )
            )
        )
    ).scalars().all()

    # CI 이름 일괄 조회
    ci_ids = [link.ci_id for link in ci_link_rows]
    ci_name_map: dict[uuid.UUID, str] = {}
    if ci_ids:
        ci_rows = (
            await db.execute(
                select(ConfigurationItem.id, ConfigurationItem.name).where(
                    and_(
                        ConfigurationItem.tenant_id == cr.tenant_id,
                        ConfigurationItem.id.in_(ci_ids),
                    )
                )
            )
        ).all()
        ci_name_map = {r.id: r.name for r in ci_rows}

    linked_cis = [
        _LinkedCIOut(
            ci_id=link.ci_id,
            ci_name=ci_name_map.get(link.ci_id),
            notes=link.notes,
        )
        for link in ci_link_rows
    ]

    # 유저 이름 조회 (requestor / implementor / reviewer)
    user_ids = {
        uid
        for uid in [cr.requestor_id, cr.implementor_id, cr.reviewer_id]
        if uid is not None
    }
    user_name_map: dict[uuid.UUID, str] = {}
    if user_ids:
        user_rows = (
            await db.execute(
                select(User.id, User.name).where(
                    and_(
                        User.tenant_id == cr.tenant_id,
                        User.id.in_(user_ids),
                    )
                )
            )
        ).all()
        user_name_map = {r.id: r.name for r in user_rows}

    return CROut(
        id=cr.id,
        tenant_id=cr.tenant_id,
        title=cr.title,
        description=cr.description,
        change_type=cr.change_type.value if hasattr(cr.change_type, "value") else cr.change_type,
        status=cr.status.value if hasattr(cr.status, "value") else cr.status,
        risk_level=cr.risk_level.value if hasattr(cr.risk_level, "value") else cr.risk_level,
        priority=cr.priority.value if hasattr(cr.priority, "value") else cr.priority,
        rollback_plan=cr.rollback_plan,
        implementation_plan=cr.implementation_plan,
        test_plan=cr.test_plan,
        requestor_id=cr.requestor_id,
        requestor_name=user_name_map.get(cr.requestor_id) if cr.requestor_id else None,
        implementor_id=cr.implementor_id,
        implementor_name=user_name_map.get(cr.implementor_id) if cr.implementor_id else None,
        reviewer_id=cr.reviewer_id,
        reviewer_name=user_name_map.get(cr.reviewer_id) if cr.reviewer_id else None,
        gw_approval_doc_id=cr.gw_approval_doc_id,
        gw_approval_status=cr.gw_approval_status,
        planned_start=cr.planned_start,
        planned_end=cr.planned_end,
        actual_start=cr.actual_start,
        actual_end=cr.actual_end,
        rejection_reason=cr.rejection_reason,
        linked_cis=linked_cis,
        created_at=cr.created_at,
        updated_at=cr.updated_at,
    )


def _is_admin_or_lead(user: User) -> bool:
    return user.role in (UserRole.admin, UserRole.team_lead)


# ------------------------------------------------------------------
# 목록
# ------------------------------------------------------------------


@router.get(
    "",
    response_model=CRListOut,
    summary="변경 요청 목록 (필터 + 페이지네이션)",
)
async def list_change_requests(
    tenant_slug: str,
    cr_status: CRStatus | None = Query(None, alias="status"),
    change_type: CRChangeType | None = Query(None),
    risk_level: CRRiskLevel | None = Query(None),
    search: str | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> CRListOut:
    conditions = [ChangeRequest.tenant_id == current_user.tenant_id]

    if cr_status:
        conditions.append(ChangeRequest.status == cr_status)
    if change_type:
        conditions.append(ChangeRequest.change_type == change_type)
    if risk_level:
        conditions.append(ChangeRequest.risk_level == risk_level)
    if search:
        like = f"%{search}%"
        conditions.append(
            or_(
                ChangeRequest.title.ilike(like),
                ChangeRequest.description.ilike(like),
            )
        )

    where_clause = and_(*conditions)
    total = await db.scalar(
        select(func.count()).select_from(ChangeRequest).where(where_clause)
    )
    rows = (
        await db.execute(
            select(ChangeRequest)
            .where(where_clause)
            .order_by(ChangeRequest.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    ).scalars().all()

    items = []
    for cr in rows:
        items.append(await _build_cr_out(db, cr))

    return CRListOut(items=items, total=total or 0, page=page, page_size=page_size)


# ------------------------------------------------------------------
# 생성
# ------------------------------------------------------------------


@router.post(
    "",
    response_model=CROut,
    status_code=status.HTTP_201_CREATED,
    summary="변경 요청 생성",
)
async def create_change_request(
    tenant_slug: str,
    data: CRCreate,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> CROut:
    cr = ChangeRequest(
        id=uuid.uuid4(),
        tenant_id=current_user.tenant_id,
        title=data.title,
        description=data.description,
        change_type=data.change_type,
        status=CRStatus.draft,
        risk_level=data.risk_level,
        priority=data.priority,
        rollback_plan=data.rollback_plan,
        implementation_plan=data.implementation_plan,
        test_plan=data.test_plan,
        requestor_id=current_user.id,
    )
    db.add(cr)
    await db.commit()
    await db.refresh(cr)
    return await _build_cr_out(db, cr)


# ------------------------------------------------------------------
# 상세 (fixed path 먼저 — 파라미터 경로보다 위에 위치)
# ------------------------------------------------------------------


@router.get(
    "/{cr_id}",
    response_model=CROut,
    summary="변경 요청 상세 (linked CIs 포함)",
)
async def get_change_request(
    tenant_slug: str,
    cr_id: uuid.UUID,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> CROut:
    cr = await _get_cr_or_404(db, current_user.tenant_id, cr_id)
    return await _build_cr_out(db, cr)


# ------------------------------------------------------------------
# 수정 (draft/pending_review 상태만)
# ------------------------------------------------------------------


@router.patch(
    "/{cr_id}",
    response_model=CROut,
    summary="변경 요청 수정 (draft/pending_review 상태, requestor 또는 admin/team_lead)",
)
async def update_change_request(
    tenant_slug: str,
    cr_id: uuid.UUID,
    data: CRUpdate,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> CROut:
    cr = await _get_cr_or_404(db, current_user.tenant_id, cr_id)

    # 상태 검증
    editable_statuses = {CRStatus.draft, CRStatus.pending_review}
    cr_status = CRStatus(cr.status) if isinstance(cr.status, str) else cr.status
    if cr_status not in editable_statuses:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="draft 또는 pending_review 상태에서만 수정할 수 있습니다.",
        )

    # 권한 검증: 본인(requestor) 또는 admin/team_lead
    is_requestor = cr.requestor_id == current_user.id
    if not is_requestor and not _is_admin_or_lead(current_user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="이 작업을 수행할 권한이 없습니다.",
        )

    update_fields = data.model_dump(exclude_none=True)
    for field, value in update_fields.items():
        setattr(cr, field, value)

    await db.commit()
    await db.refresh(cr)
    return await _build_cr_out(db, cr)


# ------------------------------------------------------------------
# 삭제 (draft 상태만, admin/team_lead)
# ------------------------------------------------------------------


@router.delete(
    "/{cr_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="변경 요청 삭제 (draft 상태만, admin/team_lead)",
)
async def delete_change_request(
    tenant_slug: str,
    cr_id: uuid.UUID,
    current_user: Annotated[User, Depends(require_roles(UserRole.admin, UserRole.team_lead))] = None,
    db: AsyncSession = Depends(get_db),
) -> None:
    cr = await _get_cr_or_404(db, current_user.tenant_id, cr_id)

    cr_status = CRStatus(cr.status) if isinstance(cr.status, str) else cr.status
    if cr_status != CRStatus.draft:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="draft 상태에서만 삭제할 수 있습니다.",
        )

    await db.delete(cr)
    await db.commit()


# ------------------------------------------------------------------
# 상태 전이 — submit (draft → pending_review)
# ------------------------------------------------------------------


@router.post(
    "/{cr_id}/submit",
    response_model=CROut,
    summary="검토 제출 (draft → pending_review, requestor 또는 admin)",
)
async def submit_change_request(
    tenant_slug: str,
    cr_id: uuid.UUID,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> CROut:
    cr = await _get_cr_or_404(db, current_user.tenant_id, cr_id)

    cr_status = CRStatus(cr.status) if isinstance(cr.status, str) else cr.status
    if cr_status != CRStatus.draft:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="draft 상태에서만 검토 제출할 수 있습니다.",
        )

    is_requestor = cr.requestor_id == current_user.id
    if not is_requestor and not _is_admin_or_lead(current_user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="이 작업을 수행할 권한이 없습니다.",
        )

    cr.status = CRStatus.pending_review
    await db.commit()
    await db.refresh(cr)
    return await _build_cr_out(db, cr)


# ------------------------------------------------------------------
# 상태 전이 — submit-gw (pending_review → pending_approval)
# ------------------------------------------------------------------


@router.post(
    "/{cr_id}/submit-gw",
    response_model=CROut,
    summary="GW 결재 제출 (pending_review → pending_approval, admin/team_lead)",
)
async def submit_gw_approval(
    tenant_slug: str,
    cr_id: uuid.UUID,
    current_user: Annotated[User, Depends(require_roles(UserRole.admin, UserRole.team_lead))] = None,
    db: AsyncSession = Depends(get_db),
) -> CROut:
    cr = await _get_cr_or_404(db, current_user.tenant_id, cr_id)

    cr_status = CRStatus(cr.status) if isinstance(cr.status, str) else cr.status
    if cr_status != CRStatus.pending_review:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="pending_review 상태에서만 GW 결재 제출할 수 있습니다.",
        )

    # requestor 이메일 조회
    requestor_email: str | None = None
    if cr.requestor_id:
        requestor = await db.scalar(
            select(User).where(
                and_(
                    User.id == cr.requestor_id,
                    User.tenant_id == current_user.tenant_id,
                )
            )
        )
        if requestor:
            requestor_email = requestor.email

    # GW 결재 연동 시도
    gw_result = None
    if requestor_email:
        gw_result = await gw_approval_service.submit_approval_draft(
            requester_email=requestor_email,
            title=cr.title,
            content_text=cr.description or cr.title,
        )

    cr.status = CRStatus.pending_approval

    if gw_result:
        cr.gw_approval_doc_id = str(gw_result.get("id", ""))
        cr.gw_approval_status = "pending"
    else:
        cr.gw_approval_status = "gw_not_configured"

    await db.commit()
    await db.refresh(cr)
    return await _build_cr_out(db, cr)


# ------------------------------------------------------------------
# 상태 전이 — approve (pending_approval → approved)
# ------------------------------------------------------------------


@router.post(
    "/{cr_id}/approve",
    response_model=CROut,
    summary="승인 (pending_approval → approved, admin/team_lead)",
)
async def approve_change_request(
    tenant_slug: str,
    cr_id: uuid.UUID,
    current_user: Annotated[User, Depends(require_roles(UserRole.admin, UserRole.team_lead))] = None,
    db: AsyncSession = Depends(get_db),
) -> CROut:
    cr = await _get_cr_or_404(db, current_user.tenant_id, cr_id)

    cr_status = CRStatus(cr.status) if isinstance(cr.status, str) else cr.status
    if cr_status != CRStatus.pending_approval:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="pending_approval 상태에서만 승인할 수 있습니다.",
        )

    cr.status = CRStatus.approved
    cr.reviewer_id = current_user.id
    await db.commit()
    await db.refresh(cr)
    return await _build_cr_out(db, cr)


# ------------------------------------------------------------------
# 상태 전이 — reject (pending_review/pending_approval → rejected)
# ------------------------------------------------------------------


@router.post(
    "/{cr_id}/reject",
    response_model=CROut,
    summary="반려 (pending_review/pending_approval → rejected, admin/team_lead)",
)
async def reject_change_request(
    tenant_slug: str,
    cr_id: uuid.UUID,
    data: CRRejectBody = CRRejectBody(),
    current_user: Annotated[User, Depends(require_roles(UserRole.admin, UserRole.team_lead))] = None,
    db: AsyncSession = Depends(get_db),
) -> CROut:
    cr = await _get_cr_or_404(db, current_user.tenant_id, cr_id)

    cr_status = CRStatus(cr.status) if isinstance(cr.status, str) else cr.status
    rejectable_statuses = {CRStatus.pending_review, CRStatus.pending_approval}
    if cr_status not in rejectable_statuses:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="pending_review 또는 pending_approval 상태에서만 반려할 수 있습니다.",
        )

    cr.status = CRStatus.rejected
    cr.reviewer_id = current_user.id
    if data.reason:
        cr.rejection_reason = data.reason
    await db.commit()
    await db.refresh(cr)
    return await _build_cr_out(db, cr)


# ------------------------------------------------------------------
# 상태 전이 — schedule (approved → scheduled)
# ------------------------------------------------------------------


@router.post(
    "/{cr_id}/schedule",
    response_model=CROut,
    summary="일정 등록 (approved → scheduled, admin/team_lead)",
)
async def schedule_change_request(
    tenant_slug: str,
    cr_id: uuid.UUID,
    data: CRScheduleBody,
    current_user: Annotated[User, Depends(require_roles(UserRole.admin, UserRole.team_lead))] = None,
    db: AsyncSession = Depends(get_db),
) -> CROut:
    cr = await _get_cr_or_404(db, current_user.tenant_id, cr_id)

    cr_status = CRStatus(cr.status) if isinstance(cr.status, str) else cr.status
    if cr_status != CRStatus.approved:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="approved 상태에서만 일정을 등록할 수 있습니다.",
        )

    cr.status = CRStatus.scheduled
    cr.planned_start = data.planned_start
    cr.planned_end = data.planned_end
    await db.commit()
    await db.refresh(cr)
    return await _build_cr_out(db, cr)


# ------------------------------------------------------------------
# 상태 전이 — start (scheduled → in_progress)
# ------------------------------------------------------------------


@router.post(
    "/{cr_id}/start",
    response_model=CROut,
    summary="시작 (scheduled → in_progress, admin/team_lead)",
)
async def start_change_request(
    tenant_slug: str,
    cr_id: uuid.UUID,
    current_user: Annotated[User, Depends(require_roles(UserRole.admin, UserRole.team_lead))] = None,
    db: AsyncSession = Depends(get_db),
) -> CROut:
    cr = await _get_cr_or_404(db, current_user.tenant_id, cr_id)

    cr_status = CRStatus(cr.status) if isinstance(cr.status, str) else cr.status
    if cr_status != CRStatus.scheduled:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="scheduled 상태에서만 시작할 수 있습니다.",
        )

    from datetime import timezone
    cr.status = CRStatus.in_progress
    cr.actual_start = datetime.now(timezone.utc)
    cr.implementor_id = current_user.id
    await db.commit()
    await db.refresh(cr)
    return await _build_cr_out(db, cr)


# ------------------------------------------------------------------
# 상태 전이 — complete (in_progress → completed)
# ------------------------------------------------------------------


@router.post(
    "/{cr_id}/complete",
    response_model=CROut,
    summary="완료 (in_progress → completed, admin/team_lead)",
)
async def complete_change_request(
    tenant_slug: str,
    cr_id: uuid.UUID,
    current_user: Annotated[User, Depends(require_roles(UserRole.admin, UserRole.team_lead))] = None,
    db: AsyncSession = Depends(get_db),
) -> CROut:
    cr = await _get_cr_or_404(db, current_user.tenant_id, cr_id)

    cr_status = CRStatus(cr.status) if isinstance(cr.status, str) else cr.status
    if cr_status != CRStatus.in_progress:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="in_progress 상태에서만 완료 처리할 수 있습니다.",
        )

    from datetime import timezone
    cr.status = CRStatus.completed
    cr.actual_end = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(cr)
    return await _build_cr_out(db, cr)


# ------------------------------------------------------------------
# GW 상태 동기화
# ------------------------------------------------------------------


@router.post(
    "/{cr_id}/sync-gw",
    response_model=CROut,
    summary="GW 결재 상태 동기화",
)
async def sync_gw_approval(
    tenant_slug: str,
    cr_id: uuid.UUID,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> CROut:
    cr = await _get_cr_or_404(db, current_user.tenant_id, cr_id)

    if not cr.gw_approval_doc_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="연결된 GW 결재 문서가 없습니다.",
        )

    # requestor 이메일 조회
    requestor_email: str | None = None
    if cr.requestor_id:
        requestor = await db.scalar(
            select(User).where(
                and_(
                    User.id == cr.requestor_id,
                    User.tenant_id == current_user.tenant_id,
                )
            )
        )
        if requestor:
            requestor_email = requestor.email

    if requestor_email:
        gw_status = await gw_approval_service.get_approval_status(
            requester_email=requestor_email,
            gw_doc_id=cr.gw_approval_doc_id,
        )
        if gw_status:
            cr.gw_approval_status = gw_status
            await db.commit()
            await db.refresh(cr)

    return await _build_cr_out(db, cr)


# ------------------------------------------------------------------
# CI 연결 — 추가 (고정 경로, 파라미터 경로보다 먼저)
# ------------------------------------------------------------------


@router.post(
    "/{cr_id}/ci-links",
    response_model=CROut,
    status_code=status.HTTP_201_CREATED,
    summary="CI 연결 추가",
)
async def add_ci_link(
    tenant_slug: str,
    cr_id: uuid.UUID,
    data: CRCILinkCreate,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> CROut:
    cr = await _get_cr_or_404(db, current_user.tenant_id, cr_id)

    # CI가 같은 테넌트에 존재하는지 확인
    ci = await db.scalar(
        select(ConfigurationItem).where(
            and_(
                ConfigurationItem.id == data.ci_id,
                ConfigurationItem.tenant_id == current_user.tenant_id,
            )
        )
    )
    if ci is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="CI를 찾을 수 없습니다.",
        )

    # 중복 확인
    existing = await db.scalar(
        select(CRCILink).where(
            and_(
                CRCILink.cr_id == cr_id,
                CRCILink.ci_id == data.ci_id,
                CRCILink.tenant_id == current_user.tenant_id,
            )
        )
    )
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="이미 연결된 CI입니다.",
        )

    link = CRCILink(
        id=uuid.uuid4(),
        tenant_id=current_user.tenant_id,
        cr_id=cr_id,
        ci_id=data.ci_id,
        notes=data.notes,
    )
    db.add(link)
    await db.commit()
    await db.refresh(cr)
    return await _build_cr_out(db, cr)


# ------------------------------------------------------------------
# CI 연결 — 제거 (admin/team_lead)
# ------------------------------------------------------------------


@router.delete(
    "/{cr_id}/ci-links/{ci_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="CI 연결 제거 (admin/team_lead)",
)
async def remove_ci_link(
    tenant_slug: str,
    cr_id: uuid.UUID,
    ci_id: uuid.UUID,
    current_user: Annotated[User, Depends(require_roles(UserRole.admin, UserRole.team_lead))] = None,
    db: AsyncSession = Depends(get_db),
) -> None:
    await _get_cr_or_404(db, current_user.tenant_id, cr_id)

    link = await db.scalar(
        select(CRCILink).where(
            and_(
                CRCILink.cr_id == cr_id,
                CRCILink.ci_id == ci_id,
                CRCILink.tenant_id == current_user.tenant_id,
            )
        )
    )
    if link is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="CI 연결을 찾을 수 없습니다.",
        )

    await db.delete(link)
    await db.commit()
