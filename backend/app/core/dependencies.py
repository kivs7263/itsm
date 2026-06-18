"""FastAPI 공통 의존성.

멀티테넌트:
- get_current_user: JWT 검증 또는 API 키 검증 → User 반환
- get_current_tenant_id: JWT에서 tenant_id 추출
- require_roles: 역할 기반 접근 제어 (engineer/team_lead/admin)
"""
from __future__ import annotations

import hashlib
import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db, _rls_tenant_id
from app.core.redis import get_redis
from app.core.security import decode_token
from app.models.api_key import ApiKey
from app.models.user import User, UserRole

logger = logging.getLogger(__name__)

# auto_error=False: 헤더 없어도 401 자동 발생 안 함
_optional_bearer = HTTPBearer(auto_error=False)

_CREDENTIALS_EXCEPTION = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="인증 정보가 유효하지 않습니다.",
    headers={"WWW-Authenticate": "Bearer"},
)


def _extract_token(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None,
) -> str | None:
    """Authorization 헤더(Bearer) 우선, 없으면 itsm.access_token 쿠키 사용."""
    if credentials:
        return credentials.credentials
    return request.cookies.get("itsm.access_token")


async def _auth_via_api_key(token: str, db: AsyncSession) -> User | None:
    """itsm_ 접두어 API 키 검증 → User 반환. 실패 시 None."""
    if not token.startswith("itsm_"):
        return None

    key_hash = hashlib.sha256(token.encode()).hexdigest()
    record: ApiKey | None = (
        await db.execute(select(ApiKey).where(ApiKey.key_hash == key_hash))
    ).scalar_one_or_none()

    if not record or not record.is_active:
        return None
    if record.expires_at and record.expires_at < datetime.now(timezone.utc):
        return None

    user: User | None = (
        await db.execute(select(User).where(User.id == record.created_by))
    ).scalar_one_or_none()
    if not user or not user.is_active:
        return None

    # last_used_at 비동기 업데이트 (오류 무시)
    try:
        await db.execute(
            update(ApiKey)
            .where(ApiKey.id == record.id)
            .values(last_used_at=datetime.now(timezone.utc))
        )
        await db.commit()
    except Exception:
        pass

    return user


async def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_optional_bearer),
    db: AsyncSession = Depends(get_db),
) -> User:
    """JWT access token 또는 API 키 검증 → User 객체 반환.

    API 키: Authorization: Bearer itsm_... 형식
    Raises:
        401: 토큰 없음/무효/만료/타입 불일치
        401: 사용자 미존재 또는 비활성
    """
    token = _extract_token(request, credentials)
    if not token:
        raise _CREDENTIALS_EXCEPTION

    # API 키 경로 (itsm_ 접두어)
    if token.startswith("itsm_"):
        user = await _auth_via_api_key(token, db)
        if user:
            return user
        raise _CREDENTIALS_EXCEPTION

    try:
        payload = decode_token(token)
    except JWTError:
        raise _CREDENTIALS_EXCEPTION

    # jti 블랙리스트 체크 (세션 강제 로그아웃)
    jti: str | None = payload.get("jti")
    if jti:
        redis = get_redis()
        if await redis.exists(f"blacklist:jti:{jti}"):
            raise _CREDENTIALS_EXCEPTION

    # type 검증 (access 토큰만 허용, type 클레임 없는 경우도 차단)
    token_type = payload.get("type")
    if token_type != "access":
        raise _CREDENTIALS_EXCEPTION

    user_id: Optional[str] = payload.get("sub")
    if not user_id:
        raise _CREDENTIALS_EXCEPTION

    try:
        uid = uuid.UUID(user_id)
    except ValueError:
        raise _CREDENTIALS_EXCEPTION

    result = await db.execute(select(User).where(User.id == uid))
    user: Optional[User] = result.scalar_one_or_none()

    if user is None or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="사용자를 찾을 수 없거나 비활성 상태입니다.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


async def get_current_tenant_id(
    current_user: User = Depends(get_current_user),
    credentials: HTTPAuthorizationCredentials | None = Depends(_optional_bearer),
    request: Request = None,
) -> uuid.UUID:
    """JWT에서 tenant_id 추출.

    Returns:
        현재 요청의 tenant_id (UUID)

    Raises:
        401: tenant_id 없음 또는 형식 오류
    """
    token = _extract_token(request, credentials)
    if not token:
        raise _CREDENTIALS_EXCEPTION

    try:
        payload = decode_token(token)
    except JWTError:
        raise _CREDENTIALS_EXCEPTION

    raw_tenant_id: Optional[str] = payload.get("tenant_id")
    if not raw_tenant_id:
        # users 테이블에서 tenant_id 직접 조회 (Keycloak 토큰 fallback)
        if current_user.tenant_id is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="테넌트 정보를 찾을 수 없습니다.",
            )
        _rls_tenant_id.set(str(current_user.tenant_id))
        return current_user.tenant_id

    try:
        tenant_id = uuid.UUID(raw_tenant_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="테넌트 ID 형식이 올바르지 않습니다.",
        )

    # 크로스 테넌트 접근 차단 — 404 반환 (존재 노출 금지)
    if current_user.tenant_id != tenant_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="해당 조직을 찾을 수 없습니다.",
        )

    _rls_tenant_id.set(str(tenant_id))
    return tenant_id


async def get_api_key_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_optional_bearer),
    db: AsyncSession = Depends(get_db),
) -> User:
    """API 키 전용 인증 — /v1/* 공개 REST API에서 사용.

    JWT 쿠키 인증은 허용하지 않음. itsm_ 접두어 Bearer 토큰만 수락.
    인증 성공 후 rate limit 검사 + 사용량 카운터 증가.
    """
    token = credentials.credentials if credentials else None
    if not token or not token.startswith("itsm_"):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="API 키가 필요합니다. Authorization: Bearer itsm_xxx",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user = await _auth_via_api_key(token, db)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="API 키가 유효하지 않거나 만료되었습니다.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Rate limit 검사 + 사용량 카운터
    await _check_and_increment_api_rate(user, db)
    return user


async def _check_and_increment_api_rate(user: User, db: AsyncSession) -> None:
    """일일 API 호출 한도 검사 후 Redis 카운터 증가.

    플랜별 한도 (PLAN_LIMITS["api_calls_daily"]):
      free         → 0    (API 키 자체가 차단되지만 이중 방어)
      starter      → 1000
      professional → 10000
      enterprise   → None (무제한)
    """
    from app.models.subscription import PLAN_LIMITS
    from app.services import billing_service
    from datetime import date

    redis = get_redis()
    sub = await billing_service.get_subscription(db, user.tenant_id, redis)
    plan = billing_service._effective_plan(sub)
    daily_limit = PLAN_LIMITS[plan].get("api_calls_daily")

    today = date.today().strftime("%Y%m%d")
    rate_key = f"itsm:api_calls:{user.tenant_id}:{today}"

    try:
        current = await redis.incr(rate_key)
        if current == 1:
            await redis.expire(rate_key, 86400)  # 첫 호출 시 TTL 설정
    except Exception:
        return  # Redis 장애 시 fail-open (서비스 중단 방지)

    if daily_limit is not None and current > daily_limit:
        raise HTTPException(
            status_code=429,
            detail={
                "message": f"일일 API 호출 한도({daily_limit:,}회)를 초과했습니다.",
                "reset_at": "자정(UTC)",
                "upgrade_url": "/settings?tab=billing",
            },
        )


def require_roles(*roles: UserRole):
    """역할 기반 접근 제어 dependency factory.

    사용 예:
        Depends(require_roles(UserRole.admin, UserRole.team_lead))

    Raises:
        403: 해당 역할이 아닌 경우
    """
    async def _check(
        current_user: User = Depends(get_current_user),
    ) -> User:
        if current_user.role not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="이 작업을 수행할 권한이 없습니다.",
            )
        return current_user
    return _check
