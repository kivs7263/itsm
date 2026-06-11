"""인증 라우터 (회원가입 / 로그인 / 갱신 / 로그아웃 / 내 정보).

prefix : /api/auth
인증   : 일부 엔드포인트는 공개 (register, login, refresh)

엔드포인트:
  POST /api/auth/register  — 회원가입 + 테넌트 생성
  POST /api/auth/login     — 이메일/비밀번호 로그인
  POST /api/auth/refresh   — refresh token 갱신
  POST /api/auth/logout    — 서버 side-effect 없음 (200 OK)
  GET  /api/auth/me        — 현재 사용자 + 테넌트 목록
"""
from __future__ import annotations

import logging
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)
from app.models import Tenant, User, UserRole
from jose import JWTError

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/auth",
    tags=["auth"],
)


# ------------------------------------------------------------------
# 스키마
# ------------------------------------------------------------------


class RegisterRequest(BaseModel):
    email: str = Field(..., max_length=255)
    password: str = Field(..., min_length=8)
    name: str = Field(..., max_length=100)
    organization_name: str = Field(..., max_length=100)
    slug: str = Field(..., min_length=2, max_length=50, pattern=r"^[a-z0-9\-]+$")


class LoginRequest(BaseModel):
    email: str = Field(..., max_length=255)
    password: str
    slug: str | None = None


class RefreshRequest(BaseModel):
    refresh_token: str


class UserOut(BaseModel):
    id: uuid.UUID
    name: str
    email: str
    role: str
    tenant_id: uuid.UUID
    organization_name: str
    avatar_url: str | None = None

    model_config = {"from_attributes": True}


class TenantOut(BaseModel):
    id: uuid.UUID
    name: str
    slug: str

    model_config = {"from_attributes": True}


class AuthResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user: UserOut


# ------------------------------------------------------------------
# 헬퍼
# ------------------------------------------------------------------


def _build_token_data(user: User) -> dict:
    return {
        "sub": str(user.id),
        "tenant_id": str(user.tenant_id),
        "role": user.role if isinstance(user.role, str) else user.role.value,
    }


def _build_user_out(user: User, tenant: Tenant) -> UserOut:
    return UserOut(
        id=user.id,
        name=user.name,
        email=user.email,
        role=user.role if isinstance(user.role, str) else user.role.value,
        tenant_id=user.tenant_id,
        organization_name=tenant.name,
        avatar_url=None,
    )


def _build_auth_response(user: User, tenant: Tenant) -> AuthResponse:
    token_data = _build_token_data(user)
    return AuthResponse(
        access_token=create_access_token(token_data),
        refresh_token=create_refresh_token(token_data),
        user=_build_user_out(user, tenant),
    )


# ------------------------------------------------------------------
# 회원가입
# ------------------------------------------------------------------


@router.post(
    "/register",
    response_model=AuthResponse,
    status_code=status.HTTP_201_CREATED,
    summary="회원가입 + 테넌트 생성",
)
async def register(
    data: RegisterRequest,
    db: AsyncSession = Depends(get_db),
) -> AuthResponse:
    # slug 중복 검사
    existing_slug = await db.scalar(
        select(Tenant).where(Tenant.slug == data.slug)
    )
    if existing_slug:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="이미 사용 중인 조직 슬러그입니다.",
        )

    # 테넌트 생성
    tenant = Tenant(
        id=uuid.uuid4(),
        slug=data.slug,
        name=data.organization_name,
    )
    db.add(tenant)
    await db.flush()  # tenant.id 확보

    # 이메일 중복 검사 (tenant 내)
    existing_email = await db.scalar(
        select(User).where(
            User.tenant_id == tenant.id,
            User.email == data.email,
        )
    )
    if existing_email:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="이미 사용 중인 이메일입니다.",
        )

    # admin 사용자 생성
    user = User(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        email=data.email,
        name=data.name,
        role=UserRole.admin,
        hashed_password=hash_password(data.password),
        is_active=True,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    await db.refresh(tenant)

    return _build_auth_response(user, tenant)


# ------------------------------------------------------------------
# 로그인
# ------------------------------------------------------------------


@router.post(
    "/login",
    response_model=AuthResponse,
    summary="이메일/비밀번호 로그인",
)
async def login(
    data: LoginRequest,
    db: AsyncSession = Depends(get_db),
) -> AuthResponse:
    _INVALID = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="이메일 또는 비밀번호가 올바르지 않습니다.",
    )

    # slug 지정 시 해당 테넌트에서만 조회
    if data.slug:
        tenant = await db.scalar(
            select(Tenant).where(Tenant.slug == data.slug)
        )
        if tenant is None:
            raise _INVALID
        user = await db.scalar(
            select(User).where(
                User.tenant_id == tenant.id,
                User.email == data.email,
                User.is_active.is_(True),
            )
        )
    else:
        # slug 미제공: 단일 테넌트 환경 fallback (created_at 오름차순 첫 번째)
        user = await db.scalar(
            select(User).where(
                User.email == data.email,
                User.is_active.is_(True),
            ).order_by(User.created_at.asc())
        )
        if user is None:
            raise _INVALID
        tenant = await db.scalar(
            select(Tenant).where(Tenant.id == user.tenant_id)
        )

    if user is None or tenant is None:
        raise _INVALID

    if not user.hashed_password or not verify_password(data.password, user.hashed_password):
        raise _INVALID

    return _build_auth_response(user, tenant)


# ------------------------------------------------------------------
# Refresh
# ------------------------------------------------------------------


@router.post(
    "/refresh",
    response_model=AuthResponse,
    summary="refresh token 갱신",
)
async def refresh_token(
    data: RefreshRequest,
    db: AsyncSession = Depends(get_db),
) -> AuthResponse:
    _invalid = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="refresh token이 유효하지 않습니다.",
    )
    try:
        payload = decode_token(data.refresh_token)
    except JWTError:
        raise _invalid

    if payload.get("type") != "refresh":
        raise _invalid

    user_id_str: str | None = payload.get("sub")
    if not user_id_str:
        raise _invalid

    try:
        uid = uuid.UUID(user_id_str)
    except ValueError:
        raise _invalid

    user = await db.scalar(
        select(User).where(User.id == uid, User.is_active.is_(True))
    )
    if user is None:
        raise _invalid

    tenant = await db.scalar(
        select(Tenant).where(Tenant.id == user.tenant_id)
    )
    if tenant is None:
        raise _invalid

    return _build_auth_response(user, tenant)


# ------------------------------------------------------------------
# 로그아웃 (fire-and-forget)
# ------------------------------------------------------------------


@router.post(
    "/logout",
    status_code=status.HTTP_200_OK,
    summary="로그아웃 (클라이언트 토큰 삭제 책임)",
)
async def logout() -> dict:
    return {"detail": "로그아웃되었습니다."}


# ------------------------------------------------------------------
# 내 정보
# ------------------------------------------------------------------


@router.get(
    "/me",
    summary="현재 사용자 + 테넌트 목록",
)
async def me(
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> dict:
    tenant = await db.scalar(
        select(Tenant).where(Tenant.id == current_user.tenant_id)
    )
    if tenant is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="테넌트를 찾을 수 없습니다.")

    # 같은 이메일로 가입된 모든 테넌트 목록
    users_same_email = (
        await db.execute(
            select(User).where(User.email == current_user.email, User.is_active.is_(True))
        )
    ).scalars().all()

    tenant_ids = {u.tenant_id for u in users_same_email}
    tenants = (
        await db.execute(
            select(Tenant).where(Tenant.id.in_(list(tenant_ids)))
        )
    ).scalars().all()

    return {
        "user": {
            "id": str(current_user.id),
            "name": current_user.name,
            "email": current_user.email,
            "role": current_user.role if isinstance(current_user.role, str) else current_user.role.value,
            "tenant_id": str(current_user.tenant_id),
            "organization_name": tenant.name,
            "avatar_url": None,
        },
        "tenants": [
            {"id": str(t.id), "name": t.name, "slug": t.slug}
            for t in tenants
        ],
    }
