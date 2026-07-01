"""사용자 관리 Settings 라우터.

prefix : /{tenant_slug}/settings/users
tags   : ["settings-users"]
인증   : require_roles(UserRole.admin) — admin 전용
격리   : 모든 쿼리 tenant_id == current_user.tenant_id

엔드포인트:
  GET    /{tenant_slug}/settings/users                    — 테넌트 사용자 목록
  POST   /{tenant_slug}/settings/users/invite             — 사용자 초대 (신규 생성)
  PATCH  /{tenant_slug}/settings/users/{user_id}/role     — 역할 변경
  PATCH  /{tenant_slug}/settings/users/{user_id}/deactivate — 비활성화
  PATCH  /{tenant_slug}/settings/users/{user_id}/activate   — 활성화
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from sqlalchemy import func, update as sa_update

from app.core.database import get_db
from app.core.dependencies import require_roles
from app.core.security import hash_password
from app.models import User, UserRole
from app.models.tenant import Tenant
from app.models.sla import SLAPolicy
from app.models.tenant_notification_config import TenantNotificationConfig

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/{tenant_slug}/settings/users",
    tags=["settings-users"],
)

# 역할 변경 허용 목록 (customer 제외)
_ASSIGNABLE_ROLES = {
    UserRole.engineer,
    UserRole.team_lead,
    UserRole.admin,
    UserRole.sales,
    UserRole.c_level,
}


# ------------------------------------------------------------------
# 스키마
# ------------------------------------------------------------------


class UserOut(BaseModel):
    id: uuid.UUID
    email: str
    name: str
    role: str
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class InviteUserRequest(BaseModel):
    email: str
    name: str = Field(..., min_length=1, max_length=100)
    role: UserRole
    password: str = Field(..., min_length=6)


class ChangeRoleRequest(BaseModel):
    role: UserRole


# ------------------------------------------------------------------
# 헬퍼
# ------------------------------------------------------------------


async def _get_user_or_404(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
) -> User:
    """tenant 격리된 단건 조회. 없으면 404 (존재 노출 금지)."""
    row = await db.scalar(
        select(User).where(
            and_(User.id == user_id, User.tenant_id == tenant_id)
        )
    )
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="사용자를 찾을 수 없습니다.",
        )
    return row


# ------------------------------------------------------------------
# GET / — 사용자 목록
# ------------------------------------------------------------------


@router.get(
    "",
    response_model=dict,
    summary="테넌트 사용자 목록 (admin)",
)
async def list_users(
    tenant_slug: str,
    current_user: Annotated[User, Depends(require_roles(UserRole.admin))] = None,
    db: AsyncSession = Depends(get_db),
) -> dict:
    total = await db.scalar(
        select(func.count()).select_from(User).where(User.tenant_id == current_user.tenant_id)
    )
    rows = (
        await db.execute(
            select(User)
            .where(User.tenant_id == current_user.tenant_id)
            .order_by(User.created_at)
        )
    ).scalars().all()
    return {"items": [UserOut.model_validate(u) for u in rows], "total": total}


# ------------------------------------------------------------------
# POST /invite — 사용자 초대
# ------------------------------------------------------------------


@router.post(
    "/invite",
    response_model=UserOut,
    status_code=status.HTTP_201_CREATED,
    summary="사용자 초대 (admin)",
)
async def invite_user(
    tenant_slug: str,
    data: InviteUserRequest,
    current_user: Annotated[User, Depends(require_roles(UserRole.admin))] = None,
    db: AsyncSession = Depends(get_db),
) -> UserOut:
    # 엔지니어 시트 한도 확인 (engineer/team_lead/admin 역할만)
    _engineer_roles = {"engineer", "team_lead", "admin"}
    if data.role in _engineer_roles:
        try:
            from app.services import billing_service
            from app.core.redis import get_redis
            await billing_service.check_seat_limit(db, current_user.tenant_id, get_redis())
        except Exception as e:
            if hasattr(e, "status_code") and e.status_code == 402:
                raise
            pass

    # 같은 tenant_id + email 중복 체크
    existing = await db.scalar(
        select(User).where(
            and_(
                User.tenant_id == current_user.tenant_id,
                User.email == data.email,
            )
        )
    )
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="이미 이 조직에 등록된 이메일입니다.",
        )

    new_user = User(
        id=uuid.uuid4(),
        tenant_id=current_user.tenant_id,
        email=data.email,
        name=data.name,
        role=UserRole(data.role) if isinstance(data.role, str) else data.role,
        hashed_password=hash_password(data.password),
        is_active=True,
    )
    db.add(new_user)
    await db.commit()
    await db.refresh(new_user)
    return UserOut.model_validate(new_user)


# ------------------------------------------------------------------
# 고정 경로 먼저 등록 (FastAPI 경로 매칭 규칙)
# ------------------------------------------------------------------


# ------------------------------------------------------------------
# PATCH /{user_id}/role — 역할 변경
# ------------------------------------------------------------------


@router.patch(
    "/{user_id}/role",
    response_model=UserOut,
    summary="사용자 역할 변경 (admin)",
)
async def change_user_role(
    tenant_slug: str,
    user_id: uuid.UUID,
    data: ChangeRoleRequest,
    current_user: Annotated[User, Depends(require_roles(UserRole.admin))] = None,
    db: AsyncSession = Depends(get_db),
) -> UserOut:
    # 자기 자신 역할 변경 금지
    if user_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="자신의 역할은 변경할 수 없습니다.",
        )

    # 허용 역할 체크
    target_role = UserRole(data.role) if isinstance(data.role, str) else data.role
    if target_role not in _ASSIGNABLE_ROLES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"허용되지 않는 역할입니다: {target_role.value}",
        )

    user = await _get_user_or_404(db, current_user.tenant_id, user_id)
    user.role = target_role
    await db.commit()
    await db.refresh(user)
    return UserOut.model_validate(user)


# ------------------------------------------------------------------
# PATCH /{user_id}/deactivate — 비활성화
# ------------------------------------------------------------------


@router.patch(
    "/{user_id}/deactivate",
    response_model=UserOut,
    summary="사용자 비활성화 (admin)",
)
async def deactivate_user(
    tenant_slug: str,
    user_id: uuid.UUID,
    current_user: Annotated[User, Depends(require_roles(UserRole.admin))] = None,
    db: AsyncSession = Depends(get_db),
) -> UserOut:
    if user_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="자신을 비활성화할 수 없습니다.",
        )

    user = await _get_user_or_404(db, current_user.tenant_id, user_id)
    user.is_active = False
    await db.commit()
    await db.refresh(user)
    return UserOut.model_validate(user)


# ------------------------------------------------------------------
# PATCH /{user_id}/activate — 활성화
# ------------------------------------------------------------------


@router.patch(
    "/{user_id}/activate",
    response_model=UserOut,
    summary="사용자 활성화 (admin)",
)
async def activate_user(
    tenant_slug: str,
    user_id: uuid.UUID,
    current_user: Annotated[User, Depends(require_roles(UserRole.admin))] = None,
    db: AsyncSession = Depends(get_db),
) -> UserOut:
    user = await _get_user_or_404(db, current_user.tenant_id, user_id)
    user.is_active = True
    await db.commit()
    await db.refresh(user)
    return UserOut.model_validate(user)


# ------------------------------------------------------------------
# 온보딩 Setup Status (별도 prefix /{tenant_slug}/settings/setup)
# ------------------------------------------------------------------

setup_router = APIRouter(
    prefix="/{tenant_slug}/settings/setup",
    tags=["settings-setup"],
)


class SetupChecklist(BaseModel):
    smtp: bool = False
    sla: bool = False
    users_invited: bool = False


class SetupStatusOut(BaseModel):
    setup_completed: bool
    checklist: SetupChecklist


@setup_router.get("", response_model=SetupStatusOut, summary="온보딩 설정 상태 조회")
async def get_setup_status(
    tenant_slug: str,
    current_user: Annotated[User, Depends(require_roles(UserRole.admin))] = None,
    db: AsyncSession = Depends(get_db),
) -> SetupStatusOut:
    tenant = await db.get(Tenant, current_user.tenant_id)
    setup_completed = bool((tenant.settings or {}).get("setup_completed", False))

    smtp_ok = (
        await db.scalar(
            select(TenantNotificationConfig).where(
                and_(
                    TenantNotificationConfig.tenant_id == current_user.tenant_id,
                    TenantNotificationConfig.smtp_host.isnot(None),
                )
            )
        )
    ) is not None

    sla_count = await db.scalar(
        select(func.count()).select_from(SLAPolicy).where(
            SLAPolicy.tenant_id == current_user.tenant_id
        )
    )

    user_count = await db.scalar(
        select(func.count()).select_from(User).where(
            and_(
                User.tenant_id == current_user.tenant_id,
                User.is_active.is_(True),
            )
        )
    )

    return SetupStatusOut(
        setup_completed=setup_completed,
        checklist=SetupChecklist(
            smtp=smtp_ok,
            sla=(sla_count or 0) > 0,
            users_invited=(user_count or 0) > 1,
        ),
    )


@setup_router.post("/complete", summary="온보딩 완료 처리")
async def complete_setup(
    tenant_slug: str,
    current_user: Annotated[User, Depends(require_roles(UserRole.admin))] = None,
    db: AsyncSession = Depends(get_db),
) -> dict:
    tenant = await db.get(Tenant, current_user.tenant_id)
    new_settings = dict(tenant.settings or {})
    new_settings["setup_completed"] = True
    await db.execute(
        sa_update(Tenant)
        .where(Tenant.id == current_user.tenant_id)
        .values(settings=new_settings)
    )
    await db.commit()
    return {"ok": True}
