"""서비스 간 수신 인증 — KC service-account Bearer JWT 검증 (ADR-003 / ADR-051).

SA service_auth.py 패턴 이식 (azp 화이트리스트만 다름).

_ALLOWED_AZP = {"gw-svc"}
  Phase 1 최소. GW 게이트웨이가 /api/external/search 호출 시 사용.
  확장 필요 시 "sa-svc" 추가.

KEYCLOAK_ISSUER / KEYCLOAK_INTERNAL_URL 미설정 시 503 (graceful degradation).
"""
from __future__ import annotations

import asyncio
import logging
import time

import httpx
from fastapi import HTTPException, Request, status
from jose import JWTError, jwt

from app.core.config import settings

logger = logging.getLogger(__name__)

_JWKS_CACHE: dict | None = None
_JWKS_FETCHED_AT: float = 0.0
_JWKS_TTL = 3600.0
_jwks_lock: asyncio.Lock | None = None

# Phase 1 최소 허용 azp. KC service-account client_id 와 일치해야 한다.
# CA-P2-3: sa-svc 추가 — SA Workspace → ITSM external KPI 호출.
_ALLOWED_AZP: frozenset[str] = frozenset({"gw-svc", "sa-svc"})


def _get_jwks_lock() -> asyncio.Lock:
    global _jwks_lock
    if _jwks_lock is None:
        _jwks_lock = asyncio.Lock()
    return _jwks_lock


def _extract_realm(issuer: str) -> str:
    """KEYCLOAK_ISSUER URL에서 realm 이름 추출."""
    parts = issuer.rstrip("/").split("/realms/", 1)
    return parts[1] if len(parts) == 2 else "master"


async def _get_jwks() -> dict | None:
    """KEYCLOAK_INTERNAL_URL 기반 JWKS 페치. 1시간 TTL 메모리 캐시.

    두 설정 중 하나라도 없으면 None 반환 (graceful — 503 상위에서 처리).
    """
    global _JWKS_CACHE, _JWKS_FETCHED_AT
    if _JWKS_CACHE and time.monotonic() - _JWKS_FETCHED_AT < _JWKS_TTL:
        return _JWKS_CACHE
    if not (settings.KEYCLOAK_ISSUER and settings.KEYCLOAK_INTERNAL_URL):
        return None
    lock = _get_jwks_lock()
    async with lock:
        # 락 획득 후 이중 확인 (경쟁 스레드가 먼저 갱신했을 수 있음)
        if _JWKS_CACHE and time.monotonic() - _JWKS_FETCHED_AT < _JWKS_TTL:
            return _JWKS_CACHE
        realm = _extract_realm(settings.KEYCLOAK_ISSUER)
        jwks_url = (
            f"{settings.KEYCLOAK_INTERNAL_URL.rstrip('/')}"
            f"/realms/{realm}/protocol/openid-connect/certs"
        )
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(jwks_url)
                resp.raise_for_status()
            _JWKS_CACHE = resp.json()
            _JWKS_FETCHED_AT = time.monotonic()
            return _JWKS_CACHE
        except Exception:
            logger.warning("JWKS 페치 실패: %s", jwks_url, exc_info=True)
            return None


async def _verify_bearer_jwt(token: str) -> bool:
    """Bearer JWT를 KC JWKS RS256으로 검증. 유효하면 True, 실패 시 False.

    verify_aud=False 의도적 우회:
      service-account 토큰의 aud는 발급 client마다 달라 단일 audience 고정 불가.
      issuer(KC realm) + azp 화이트리스트 이중 검증으로 동등 보안 확보 (ADR-003).
    """
    jwks = await _get_jwks()
    if not jwks:
        return False
    try:
        payload = jwt.decode(
            token,
            jwks,
            algorithms=["RS256"],
            issuer=settings.KEYCLOAK_ISSUER,
            options={"verify_aud": False},
        )
    except JWTError as exc:
        # 키 회전(kid 변경) 가능성 → 캐시 무효화 후 1회 재시도
        global _JWKS_CACHE, _JWKS_FETCHED_AT
        _JWKS_CACHE = None
        _JWKS_FETCHED_AT = 0.0
        refreshed = await _get_jwks()
        if not refreshed:
            logger.warning("서비스 JWT 검증 실패: %s", exc)
            return False
        try:
            payload = jwt.decode(
                token,
                refreshed,
                algorithms=["RS256"],
                issuer=settings.KEYCLOAK_ISSUER,
                options={"verify_aud": False},
            )
        except JWTError as exc2:
            logger.warning("서비스 JWT 검증 실패 (JWKS 갱신 후): %s", exc2)
            return False

    azp = payload.get("azp", "")
    if azp not in _ALLOWED_AZP:
        logger.warning(
            "서비스 JWT azp 거부: azp='%s' (allowed=%s)", azp, sorted(_ALLOWED_AZP)
        )
        return False
    return True


async def require_service_auth(request: Request) -> None:
    """서비스 인증 FastAPI 의존성 — KC service-account Bearer JWT 전용.

    KEYCLOAK_ISSUER 미설정 시 503 반환.
    Authorization: Bearer <token> 누락 또는 검증 실패(서명·issuer·azp) 시 401 반환.

    사용:
        @router.get("/api/external/search")
        async def handler(_: None = Depends(require_service_auth)):
            ...
    """
    if not settings.KEYCLOAK_ISSUER:
        logger.error("KEYCLOAK_ISSUER 미설정 — 서비스 인증 불가")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="서비스 인증 미설정",
        )

    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="서비스 인증 헤더 없음",
        )

    token = auth_header[7:]
    if await _verify_bearer_jwt(token):
        return
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="서비스 JWT 검증 실패",
    )
