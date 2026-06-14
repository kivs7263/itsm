"""CrossApp SSO 라우터 (GW/SA ↔ ITSM HMAC-SHA256 기반).

prefix : /{tenant_slug}/auth/crossapp
인증   : issue는 get_current_user, redeem은 공개

엔드포인트:
  POST /{tenant_slug}/auth/crossapp/issue   — ITSM→SA/GW 방향 단기 토큰 발급
  POST /{tenant_slug}/auth/crossapp/redeem  — SA/GW→ITSM 방향 토큰 수신 + ITSM 세션 발급
"""
from __future__ import annotations

import logging
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_cookies import set_auth_cookies

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.core.redis import get_redis
from app.core.security import (
    _CROSSAPP_TTL,
    create_access_token,
    create_refresh_token,
    issue_crossapp_token,
    verify_crossapp_token,
)
from app.models import Tenant, User, UserRole

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/{tenant_slug}/auth/crossapp",
    tags=["crossapp-auth"],
)

# CrossApp 토큰을 발급할 수 있는 신뢰 발급자
_ALLOWED_ISS = {"sa", "gw"}


# ------------------------------------------------------------------
# 스키마
# ------------------------------------------------------------------


class CrossAppIssueResponse(BaseModel):
    token: str


class CrossAppRedeemRequest(BaseModel):
    token: str


class UserOut(BaseModel):
    id: uuid.UUID
    name: str
    email: str
    role: str
    tenant_id: uuid.UUID

    model_config = {"from_attributes": True}


class CrossAppAuthResponse(BaseModel):
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


# ------------------------------------------------------------------
# Issue: ITSM→SA/GW
# ------------------------------------------------------------------


@router.post(
    "/issue",
    response_model=CrossAppIssueResponse,
    summary="ITSM → SA/GW 방향 CrossApp 단기 토큰 발급",
)
async def issue(
    tenant_slug: str,
    current_user: Annotated[User, Depends(get_current_user)] = None,
) -> CrossAppIssueResponse:
    try:
        token = issue_crossapp_token(
            user_id=str(current_user.id),
            tenant_id=str(current_user.tenant_id),
            email=current_user.email,
            name=current_user.name or "",
            tenant_slug=tenant_slug,
            iss="itsm",
        )
    except ValueError as exc:
        logger.error("CrossApp 토큰 발급 실패: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="CrossApp 토큰 발급에 실패했습니다.",
        )
    return CrossAppIssueResponse(token=token)


# ------------------------------------------------------------------
# Redeem: SA/GW→ITSM
# ------------------------------------------------------------------


@router.post(
    "/redeem",
    response_model=CrossAppAuthResponse,
    summary="SA/GW → ITSM 방향 CrossApp 토큰 수신 + ITSM 세션 발급",
)
async def redeem(
    tenant_slug: str,
    data: CrossAppRedeemRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> CrossAppAuthResponse:
    # CrossApp 토큰 검증
    try:
        payload = verify_crossapp_token(data.token)
    except ValueError as exc:
        logger.warning("CrossApp 토큰 검증 실패: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="CrossApp 토큰이 유효하지 않습니다.",
        )

    # CRIT-2: Replay 방어 — jti 1회 사용 보장
    jti: str | None = payload.get("jti")
    if jti:
        redis = get_redis()
        nonce_key = f"crossapp:jti:{jti}"
        set_result = await redis.set(nonce_key, "1", ex=_CROSSAPP_TTL, nx=True)
        if not set_result:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="CrossApp 토큰이 이미 사용되었습니다.",
            )

    # 발급자 검증 (sa/gw만 허용)
    iss = payload.get("iss", "")
    if iss not in _ALLOWED_ISS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="허용되지 않은 CrossApp 토큰 발급자입니다.",
        )

    # CRIT-1: 테넌트 격리 검증
    # SA/GW 토큰은 tenant_slug만 포함 (tenant_id 없음); ITSM 토큰은 둘 다 포함
    tenant = await db.scalar(
        select(Tenant).where(Tenant.slug == tenant_slug)
    )
    if tenant is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="테넌트를 찾을 수 없습니다.",
        )

    # tenant_id가 있으면 cross-check; tenant_slug가 있으면 URL과 일치 확인
    payload_tenant_id_str: str | None = payload.get("tenant_id")
    if payload_tenant_id_str:
        try:
            payload_tenant_id = uuid.UUID(payload_tenant_id_str)
            if tenant.id != payload_tenant_id:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="CrossApp 토큰의 테넌트 정보가 올바르지 않습니다.",
                )
        except ValueError:
            pass

    payload_tenant_slug: str | None = payload.get("tenant_slug")
    if payload_tenant_slug and payload_tenant_slug != tenant_slug:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="CrossApp 토큰의 테넌트 정보가 올바르지 않습니다.",
        )

    # 사용자 조회: sub(UUID) 우선, 없으면 email fallback (SA/GW 호환)
    user: User | None = None
    user_id_str: str | None = payload.get("sub")
    if user_id_str:
        try:
            uid = uuid.UUID(user_id_str)
            user = await db.scalar(
                select(User).where(
                    User.id == uid,
                    User.is_active.is_(True),
                    User.tenant_id == tenant.id,
                )
            )
        except ValueError:
            pass

    if user is None:
        email: str | None = payload.get("email")
        if not email:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="CrossApp 토큰에 사용자 정보가 없습니다.",
            )
        user = await db.scalar(
            select(User).where(
                User.email == email,
                User.is_active.is_(True),
                User.tenant_id == tenant.id,
            )
        )

    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="사용자를 찾을 수 없습니다.",
        )

    token_data = _build_token_data(user)
    access_token = create_access_token(token_data)
    refresh_token = create_refresh_token(token_data)

    # HttpOnly 쿠키 세팅 — 프론트엔드는 쿠키 수신 후 바로 redirect
    set_auth_cookies(response, access_token, refresh_token, tenant_slug)

    return CrossAppAuthResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        user=UserOut(
            id=user.id,
            name=user.name,
            email=user.email,
            role=user.role if isinstance(user.role, str) else user.role.value,
            tenant_id=user.tenant_id,
        ),
    )
