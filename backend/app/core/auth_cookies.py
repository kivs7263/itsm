"""ITSM 인증 쿠키 헬퍼 (auth + crossapp_auth 공유)."""
from __future__ import annotations

import secrets

from fastapi import Response

from app.core.config import settings

_COOKIE_SECURE = settings.ENVIRONMENT == "production"
_COOKIE_SAMESITE = "lax"


def set_auth_cookies(
    response: Response,
    access_token: str,
    refresh_token: str,
    tenant_slug: str = "",
) -> None:
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


def clear_auth_cookies(response: Response) -> None:
    for name in ("itsm.access_token", "itsm.refresh_token", "csrf.itsm"):
        response.delete_cookie(name, path="/")
    response.delete_cookie("itsm.refresh_token", path="/api/auth")
