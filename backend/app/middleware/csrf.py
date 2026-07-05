"""Double Submit Cookie CSRF 보호 미들웨어 — ITSM.

쿠키 이름: csrf.itsm  (auth_cookies.set_auth_cookies 에서 httponly=False 로 발급)
enforce=True 시 CSRF 미스매치 요청을 403 CSRF_VALIDATION_FAILED 로 차단.

skip 정책:
  - GET/HEAD/OPTIONS/TRACE: 안전 메서드 — skip
  - _SKIP_PREFIXES: 쿠키 인증이 아닌 정적 경로 — skip
  - _SKIP_PATH_FRAGMENTS: /auth/crossapp/ — slug 동적이라 prefix 매칭 불가, 포함 여부로 skip
"""
from __future__ import annotations

import hmac
import logging

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response

logger = logging.getLogger(__name__)

_SKIP_METHODS = frozenset({"GET", "HEAD", "OPTIONS", "TRACE"})

# 쿠키 인증이 아닌 엔드포인트 — prefix 정적 매칭
_SKIP_PREFIXES = (
    "/api/auth/",                       # 인증 엔드포인트 (login, SSO 콜백, refresh, logout)
    "/api/health",
    "/metrics",
    # admin_bridge: SSO Admin Portal → ITSM, verify_admin_portal_jwt (Bearer RS256, 쿠키 미사용)
    # 미면제 시 POST/PUT/DELETE 403 CSRF_VALIDATION_FAILED (테넌트 생성·수정 등 조용히 차단).
    "/api/admin/",
    # 서비스간 브리지 (Bearer/HMAC 인증, 쿠키 미사용)
    "/api/external/",                   # external_search, external_kpi (service-auth Bearer)
    "/api/search/",                     # search_proxy (service-auth Bearer)
    "/api/internal/",                   # internal_workflow (HMAC)
    # 고객 포털 (매직링크 세션 쿠키 — itsm.access_token 과 별개 체계)
    "/portal/",
    # PU-D19: 고객포털 API 는 /api/portal/ 로도 병행 마운트됨(nginx /portal/→프론트라 브라우저는 /api 로만 도달).
    # 포털 세션은 csrf.itsm 쿠키가 없으므로 미면제 시 login/logout/tickets/comments/survey POST 가 403.
    "/api/portal/",
    # 공개 API v1 (API 키 Bearer 인증, 쿠키 미사용)
    "/v1/",
    # Stripe 웹훅 (HMAC-SHA256 서명 검증, 쿠키 미사용)
    "/api/billing/stripe-webhook",
)

# CrossApp SSO: /api/{tenant_slug}/auth/crossapp/ — slug 동적이라 startswith 불가
# HMAC(SERVICE_BUS_SECRET) 인증이므로 CSRF 대상 아님.
_SKIP_PATH_FRAGMENTS = (
    "/auth/crossapp/",
)


class CSRFMiddleware(BaseHTTPMiddleware):
    def __init__(
        self,
        app,
        *,
        enforce: bool = False,
        cookie_name: str = "csrf.itsm",
    ) -> None:
        super().__init__(app)
        self._enforce = enforce
        self._cookie = cookie_name

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        if request.method in _SKIP_METHODS:
            return await call_next(request)

        path = request.url.path
        for prefix in _SKIP_PREFIXES:
            if path.startswith(prefix):
                return await call_next(request)
        for fragment in _SKIP_PATH_FRAGMENTS:
            if fragment in path:
                return await call_next(request)

        cookie_val = request.cookies.get(self._cookie, "")
        header_val = request.headers.get("x-csrf-token", "")
        valid = bool(
            cookie_val
            and header_val
            and hmac.compare_digest(cookie_val, header_val)
        )

        if not valid:
            logger.warning(
                "CSRF 미스매치: path=%s method=%s enforce=%s",
                path,
                request.method,
                self._enforce,
            )
            if self._enforce:
                from starlette.responses import JSONResponse
                return JSONResponse({"code": "CSRF_VALIDATION_FAILED"}, status_code=403)

        return await call_next(request)
