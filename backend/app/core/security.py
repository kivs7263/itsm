"""인증 보안 유틸리티.

- 비밀번호: bcrypt 해싱
- JWT: access token (짧은 만료) + refresh token (긴 만료)
- token payload: {"sub": user_id, "tenant_id": tenant_id, "role": role, "type": "access"|"refresh", "jti": jti}
- CrossApp HMAC-SHA256: GW/SA ↔ ITSM 교차 로그인용 단기 토큰 (60s TTL)
"""
from __future__ import annotations

import hashlib
import hmac
import json
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Literal

from jose import JWTError, jwt
from passlib.context import CryptContext

from app.core.config import settings

_pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

ALGORITHM = "HS256"


def hash_password(password: str) -> str:
    """bcrypt 해싱."""
    return _pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    """비밀번호 검증."""
    return _pwd_context.verify(plain, hashed)


def _build_token(
    data: dict,
    token_type: Literal["access", "refresh"],
    expires_delta: timedelta,
) -> str:
    """JWT 생성 공통 로직."""
    now = datetime.now(timezone.utc)
    payload = {
        **data,
        "type": token_type,
        "jti": str(uuid.uuid4()),
        "iat": now,
        "exp": now + expires_delta,
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=ALGORITHM)


def create_access_token(data: dict) -> str:
    """Access token 생성.

    data 필수 키: sub (user_id), tenant_id, role
    """
    return _build_token(
        data,
        token_type="access",
        expires_delta=timedelta(minutes=settings.JWT_EXPIRE_MINUTES),
    )


def create_refresh_token(data: dict) -> str:
    """Refresh token 생성.

    data 필수 키: sub (user_id), tenant_id, role
    """
    return _build_token(
        data,
        token_type="refresh",
        expires_delta=timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
    )


def decode_token(token: str) -> dict:
    """JWT 검증 + 디코드 (HS256 자체 발급 토큰 전용).

    Returns:
        payload dict

    Raises:
        JWTError: 토큰 유효하지 않음 (만료 포함)
    """
    payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[ALGORITHM])
    return payload


# ------------------------------------------------------------------
# CrossApp HMAC-SHA256 토큰 (GW/SA ↔ ITSM 교차 로그인)
# ------------------------------------------------------------------

_CROSSAPP_TTL = 60  # 60초 단기 토큰


def issue_crossapp_token(
    *,
    user_id: str,
    tenant_id: str,
    email: str,
    iss: str,
    secret: str | None = None,
) -> str:
    """CrossApp 단기 토큰 발급 (HMAC-SHA256, 60s TTL).

    iss: 발급 서비스 식별자 (예: "itsm", "gw", "sa")
    """
    if secret is None:
        secret = settings.SERVICE_BUS_SECRET
    if not secret:
        raise ValueError("SERVICE_BUS_SECRET이 설정되지 않았습니다.")

    payload = json.dumps(
        {
            "sub": user_id,
            "tenant_id": tenant_id,
            "email": email,
            "iss": iss,
            "iat": int(time.time()),
            "exp": int(time.time()) + _CROSSAPP_TTL,
        },
        separators=(",", ":"),
        sort_keys=True,
    )
    sig = hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()
    token_data = json.dumps({"payload": payload, "sig": sig}, separators=(",", ":"))
    import base64
    return base64.urlsafe_b64encode(token_data.encode()).decode()


def verify_crossapp_token(token: str, *, secret: str | None = None) -> dict:
    """CrossApp 토큰 검증.

    Returns:
        payload dict (sub, tenant_id, email, iss, iat, exp)

    Raises:
        ValueError: 서명 불일치 또는 만료
    """
    if secret is None:
        secret = settings.SERVICE_BUS_SECRET
    if not secret:
        raise ValueError("SERVICE_BUS_SECRET이 설정되지 않았습니다.")

    import base64
    try:
        token_data = json.loads(base64.urlsafe_b64decode(token.encode()).decode())
        payload_str: str = token_data["payload"]
        sig: str = token_data["sig"]
    except Exception as exc:
        raise ValueError("CrossApp 토큰 형식이 올바르지 않습니다.") from exc

    expected_sig = hmac.new(secret.encode(), payload_str.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig, expected_sig):
        raise ValueError("CrossApp 토큰 서명이 유효하지 않습니다.")

    try:
        payload = json.loads(payload_str)
    except Exception as exc:
        raise ValueError("CrossApp 토큰 페이로드 파싱 실패.") from exc

    if int(time.time()) > payload.get("exp", 0):
        raise ValueError("CrossApp 토큰이 만료되었습니다.")

    return payload
