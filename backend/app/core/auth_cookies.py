"""ITSM 인증 쿠키 헬퍼 (auth + crossapp_auth 공유)."""
from __future__ import annotations

import secrets

from fastapi import Response
from backend_core import cookies as _bc_cookies

from app.core.config import settings

_COOKIE_SECURE = settings.ENVIRONMENT == "production"
_COOKIE_SAMESITE = "lax"
# COOKIE_DOMAIN이 설정된 경우 cross-subdomain 공유 (.apistech.co.kr)
_COOKIE_DOMAIN = settings.COOKIE_DOMAIN or None


def set_auth_cookies(
    response: Response,
    access_token: str,
    refresh_token: str,
    tenant_slug: str = "",
) -> None:
    access_max = settings.JWT_EXPIRE_MINUTES * 60
    refresh_max = settings.REFRESH_TOKEN_EXPIRE_DAYS * 86400

    _bc_cookies.set_cookie(
        response, "itsm.access_token", access_token,
        domain=_COOKIE_DOMAIN, max_age=access_max, secure=_COOKIE_SECURE,
    )
    _bc_cookies.set_cookie(
        response, "itsm.refresh_token", refresh_token,
        domain=_COOKIE_DOMAIN, max_age=refresh_max, secure=_COOKIE_SECURE, path="/api/auth",
    )
    _bc_cookies.set_cookie(
        response, "csrf.itsm", secrets.token_urlsafe(16),
        domain=_COOKIE_DOMAIN, max_age=access_max, secure=_COOKIE_SECURE, httponly=False,
    )
    if tenant_slug:
        _bc_cookies.set_cookie(
            response, "itsm.last.tenant", tenant_slug,
            domain=_COOKIE_DOMAIN, max_age=30 * 86400, secure=False, httponly=False,
        )


def clear_auth_cookies(response: Response) -> None:
    for name in ("itsm.access_token", "itsm.refresh_token", "csrf.itsm"):
        _bc_cookies.clear_cookie(response, name, domain=_COOKIE_DOMAIN, path="/")
    _bc_cookies.clear_cookie(response, "itsm.refresh_token", domain=_COOKIE_DOMAIN, path="/api/auth")
