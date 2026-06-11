"""인증 라우터 (회원가입 / 로그인 / 갱신 / 로그아웃 / 내 정보 / KC SSO).

prefix : /api/auth
인증   : 일부 엔드포인트는 공개 (register, login, refresh, sso, sso/callback)

엔드포인트:
  POST /api/auth/register        — 회원가입 + 테넌트 생성
  POST /api/auth/login           — 이메일/비밀번호 로그인
  POST /api/auth/refresh         — refresh token 갱신
  POST /api/auth/logout          — 서버 side-effect 없음 (200 OK)
  GET  /api/auth/me              — 현재 사용자 + 테넌트 목록
  GET  /api/auth/sso             — KC Authorization Code Flow 시작 (redirect)
  GET  /api/auth/sso/callback    — KC 콜백 → ITSM JWT 발급 → 프론트 redirect
"""
from __future__ import annotations

import logging
import secrets
import uuid
from typing import Annotated
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Cookie, Depends, HTTPException, Query, Response, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
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

_COOKIE_SECURE = settings.ENVIRONMENT == "production"
_COOKIE_SAMESITE = "lax"


def _set_auth_cookies(
    response: Response,
    access_token: str,
    refresh_token: str,
    tenant_slug: str = "",
) -> None:
    """액세스·리프레시 토큰을 HttpOnly 쿠키로 설정 + CSRF sentinel."""
    access_max = settings.JWT_EXPIRE_MINUTES * 60
    refresh_max = settings.REFRESH_TOKEN_EXPIRE_DAYS * 86400

    response.set_cookie(
        "itsm.access_token", access_token,
        httponly=True, secure=_COOKIE_SECURE, samesite=_COOKIE_SAMESITE,
        max_age=access_max, path="/",
    )
    response.set_cookie(
        "itsm.refresh_token", refresh_token,
        httponly=True, secure=_COOKIE_SECURE, samesite=_COOKIE_SAMESITE,
        max_age=refresh_max, path="/api/auth",
    )
    response.set_cookie(
        "csrf.itsm", secrets.token_urlsafe(16),
        httponly=False, secure=_COOKIE_SECURE, samesite=_COOKIE_SAMESITE,
        max_age=access_max, path="/",
    )
    if tenant_slug:
        response.set_cookie(
            "itsm.last.tenant", tenant_slug,
            httponly=False, secure=False, samesite=_COOKIE_SAMESITE,
            max_age=30 * 86400, path="/",
        )


def _clear_auth_cookies(response: Response) -> None:
    """로그아웃 시 인증 쿠키 제거."""
    for name in ("itsm.access_token", "itsm.refresh_token", "csrf.itsm"):
        response.delete_cookie(name, path="/")
    response.delete_cookie("itsm.refresh_token", path="/api/auth")


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
    refresh_token: str | None = None  # 쿠키 방식 사용 시 없어도 됨


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
    response: Response,
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

    auth = _build_auth_response(user, tenant)
    _set_auth_cookies(response, auth.access_token, auth.refresh_token, tenant.slug)
    return auth


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
    response: Response,
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

    auth = _build_auth_response(user, tenant)
    _set_auth_cookies(response, auth.access_token, auth.refresh_token, tenant.slug)
    return auth


# ------------------------------------------------------------------
# Refresh
# ------------------------------------------------------------------


@router.post(
    "/refresh",
    response_model=AuthResponse,
    summary="refresh token 갱신",
)
async def refresh_token(
    response: Response,
    data: RefreshRequest | None = None,
    itsm_refresh_token: str | None = Cookie(default=None, alias="itsm.refresh_token"),
    db: AsyncSession = Depends(get_db),
) -> AuthResponse:
    _invalid = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="refresh token이 유효하지 않습니다.",
    )
    # 쿠키 우선, body fallback
    token_str = itsm_refresh_token or (data.refresh_token if data else None)
    if not token_str:
        raise _invalid

    try:
        payload = decode_token(token_str)
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

    auth = _build_auth_response(user, tenant)
    _set_auth_cookies(response, auth.access_token, auth.refresh_token, tenant.slug)
    return auth


# ------------------------------------------------------------------
# 로그아웃
# ------------------------------------------------------------------


@router.post(
    "/logout",
    status_code=status.HTTP_200_OK,
    summary="로그아웃 (쿠키 제거)",
)
async def logout(response: Response) -> dict:
    _clear_auth_cookies(response)
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


# ------------------------------------------------------------------
# KC SSO — Authorization Code Flow
# ------------------------------------------------------------------

_SSO_ENABLED_ERR = HTTPException(
    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
    detail="SSO가 설정되지 않았습니다. KEYCLOAK_ISSUER / KEYCLOAK_CLIENT_SECRET을 환경변수에 추가하세요.",
)


def _kc_oidc_base() -> str:
    """KC OIDC endpoint base URL."""
    return f"{settings.KEYCLOAK_ISSUER}/protocol/openid-connect"


@router.get(
    "/sso",
    summary="KC SSO 로그인 시작 (브라우저 redirect)",
    include_in_schema=True,
)
async def sso_start(
    slug: str | None = Query(default=None, description="조직 슬러그 (콜백 후 리다이렉트에 사용)"),
) -> RedirectResponse:
    if not settings.KEYCLOAK_ISSUER or not settings.KEYCLOAK_CLIENT_SECRET:
        raise _SSO_ENABLED_ERR

    state = f"{secrets.token_urlsafe(16)}|{slug or ''}"
    params = {
        "client_id": settings.KEYCLOAK_CLIENT_ID,
        "redirect_uri": settings.KEYCLOAK_REDIRECT_URI,
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
    }
    auth_url = f"{_kc_oidc_base()}/auth?{urlencode(params)}"
    return RedirectResponse(url=auth_url)


@router.get(
    "/sso/callback",
    summary="KC SSO 콜백 → ITSM JWT 발급 → 프론트 redirect",
    include_in_schema=True,
)
async def sso_callback(
    code: str = Query(...),
    state: str = Query(...),
    db: AsyncSession = Depends(get_db),
) -> RedirectResponse:
    if not settings.KEYCLOAK_ISSUER or not settings.KEYCLOAK_CLIENT_SECRET:
        raise _SSO_ENABLED_ERR

    # state 파싱: "<nonce>|<slug>"
    state_parts = state.split("|", 1)
    slug = state_parts[1] if len(state_parts) > 1 else ""

    # 1. code → KC tokens
    async with httpx.AsyncClient(timeout=10) as client:
        token_resp = await client.post(
            f"{_kc_oidc_base()}/token",
            data={
                "grant_type": "authorization_code",
                "client_id": settings.KEYCLOAK_CLIENT_ID,
                "client_secret": settings.KEYCLOAK_CLIENT_SECRET,
                "redirect_uri": settings.KEYCLOAK_REDIRECT_URI,
                "code": code,
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )

    if token_resp.status_code != 200:
        logger.error("KC token exchange failed: %s", token_resp.text)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="KC 토큰 교환 실패")

    kc_tokens = token_resp.json()
    kc_access = kc_tokens.get("access_token")
    if not kc_access:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="KC access_token 없음")

    # 2. KC userinfo
    async with httpx.AsyncClient(timeout=10) as client:
        ui_resp = await client.get(
            f"{_kc_oidc_base()}/userinfo",
            headers={"Authorization": f"Bearer {kc_access}"},
        )

    if ui_resp.status_code != 200:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="KC userinfo 조회 실패")

    ui = ui_resp.json()
    email: str = ui.get("email", "")
    name: str = ui.get("name") or ui.get("preferred_username") or email.split("@")[0]
    kc_sub: str = ui.get("sub", "")

    if not email:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="KC 계정에 이메일이 없습니다.")

    # 3. ITSM 사용자 upsert
    #    slug 지정 시 해당 테넌트 우선, 없으면 이메일로 첫 번째 테넌트
    user: User | None = None
    tenant: Tenant | None = None

    if slug:
        tenant = await db.scalar(select(Tenant).where(Tenant.slug == slug))

    if tenant:
        user = await db.scalar(
            select(User).where(User.tenant_id == tenant.id, User.email == email)
        )
        if user is None:
            # 해당 테넌트에 없으면 신규 생성 (admin — 최초 SSO 진입)
            user = User(
                id=uuid.uuid4(),
                tenant_id=tenant.id,
                email=email,
                name=name,
                role=UserRole.admin,
                hashed_password=None,
                is_active=True,
            )
            db.add(user)
            await db.commit()
            await db.refresh(user)
        elif not user.is_active:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="비활성화된 계정입니다.")
    else:
        # slug 없음: 이메일로 기존 사용자 검색
        user = await db.scalar(
            select(User).where(User.email == email, User.is_active.is_(True))
            .order_by(User.created_at.asc())
        )
        if user is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="ITSM에 등록된 계정이 없습니다. 관리자에게 초대를 요청하세요.",
            )
        tenant = await db.scalar(select(Tenant).where(Tenant.id == user.tenant_id))

    if tenant is None:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="테넌트를 찾을 수 없습니다.")

    # 4. ITSM JWT 발급
    auth = _build_auth_response(user, tenant)

    # 5. 쿠키 설정 + 대시보드로 redirect
    redirect_url = f"/{tenant.slug}/tickets"
    redirect_resp = RedirectResponse(url=redirect_url, status_code=302)
    _set_auth_cookies(redirect_resp, auth.access_token, auth.refresh_token, tenant.slug)
    return redirect_resp
