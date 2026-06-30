"""ITSM → GW 글로벌 검색 프록시 (ADR-051 §2.6.4).

GET /api/search/global-proxy
    ?q=<검색어, min=1, max=100>
    &limit=<1~20, default=10>

인증: ITSM get_current_user (itsm.access_token 쿠키 우선, Bearer fallback)
응답: GW /api/search/global 응답 pass-through
      {items:[GlobalSearchItem], partial:bool, failed_sources:[str]}

동작 순서:
  1. ITSM get_current_user 로컬 인증
  2. user.email + tenant_slug 추출 (Tenant.id → Tenant.slug 조인)
  3. service_token_client.get_service_headers() → itsm-svc Bearer 발급
  4. GW /api/search/global 호출:
       params: {q, limit, on_behalf_email, tenant_slug, exclude_sources=ITSM}
       exclude_sources=ITSM 필수 — GW가 ITSM external search를 재호출하지 않도록 (순환 방지)
  5. GW 응답 그대로 반환 (변환 없음)
  6. GW 연결 실패 / 타임아웃 / 비정상 응답 시
       {items:[], partial:true, failed_sources:["GW"]} graceful 반환 (5xx 전파 금지)

라우터 등록: main.py 에서 /{tenant_slug}/search 계열보다 먼저 include_router 필수.
  /api/search/global-proxy 경로가 /api/{tenant_slug}/search 패턴에 흡수되지 않도록.
"""
from __future__ import annotations

import logging

import httpx
from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models.tenant import Tenant
from app.models.user import User
from app.services.service_token_client import get_service_headers

logger = logging.getLogger(__name__)

router = APIRouter(tags=["search-proxy"])

# ADR-051 §2.6.4: GW 호출 타임아웃 ~3s
_PROXY_TIMEOUT = 3.0

_GRACEFUL_GW_DOWN: dict = {"items": [], "partial": True, "failed_sources": ["GW"]}


def _gw_search_url() -> str:
    """GW 내부 글로벌 검색 엔드포인트 URL.

    settings.GW_BACKEND_URL 이 있으면 그것을 사용하고, 없으면 Docker 내부 기본값으로 fallback.
    gw_approval_service.py 와 동일한 설정 참조 방식.
    """
    base = settings.GW_BACKEND_URL or "http://gw_backend:8000"
    return f"{base.rstrip('/')}/api/search/global"


@router.get("/api/search/global-proxy", summary="글로벌 통합 검색 프록시 (GW 팬아웃)")
async def global_search_proxy(
    q: str = Query(..., min_length=1, max_length=100, description="검색어 (1~100자)"),
    limit: int = Query(10, ge=1, le=20, description="결과 수 (1~20, 기본 10)"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> JSONResponse:
    """ITSM 유저 인증 후 GW 글로벌 검색을 프록시하여 반환한다.

    - GW /api/search/global 에 on_behalf_email + tenant_slug + exclude_sources=ITSM 전달.
    - GW 응답 {items, partial, failed_sources} 을 변환 없이 그대로 반환.
    - GW 장애·타임아웃·비정상 응답 시 {items:[], partial:true, failed_sources:["GW"]} graceful 반환.
    - 절대 5xx 를 upstream 에 전파하지 않는다.
    """
    # 1. tenant_slug 추출 — Tenant.id → Tenant.slug 조인
    tenant_slug: str | None = None
    if current_user.tenant_id is not None:
        tenant_result = await db.execute(
            select(Tenant.slug).where(
                Tenant.id == current_user.tenant_id,
            )
        )
        tenant_slug = tenant_result.scalar_one_or_none()

    if not tenant_slug:
        logger.warning(
            "global_search_proxy — tenant_slug 조회 실패 (graceful): user_id=%s tenant_id=%s",
            current_user.id,
            current_user.tenant_id,
        )
        return JSONResponse(content=_GRACEFUL_GW_DOWN)

    # 2. GW 글로벌 검색 호출 (itsm-svc 서비스 토큰)
    url = _gw_search_url()
    params: dict[str, str | int] = {
        "q": q,
        "limit": limit,
        "on_behalf_email": current_user.email,
        "tenant_slug": tenant_slug,
        "exclude_sources": "ITSM",  # ADR-051 §2.6.3/§2.6.4: ITSM 순환 호출 방지 필수
    }

    try:
        svc_headers = await get_service_headers()
        async with httpx.AsyncClient(timeout=_PROXY_TIMEOUT) as client:
            resp = await client.get(url, params=params, headers=svc_headers)

        if resp.status_code == 200:
            return JSONResponse(content=resp.json())

        # GW 가 4xx/5xx 반환 — upstream 전파 금지, graceful 처리
        logger.warning(
            "global_search_proxy — GW 비정상 응답 (graceful): status=%s user=%s",
            resp.status_code,
            current_user.email,
        )
        return JSONResponse(content=_GRACEFUL_GW_DOWN)

    except (httpx.TimeoutException, httpx.ConnectError, httpx.NetworkError) as exc:
        logger.warning(
            "global_search_proxy — GW 연결 실패 (graceful): %s",
            exc,
        )
        return JSONResponse(content=_GRACEFUL_GW_DOWN)

    except RuntimeError as exc:
        # service_token_client.get_service_headers(): KC_SERVICE_CLIENT_SECRET 미설정 시
        logger.error(
            "global_search_proxy — 서비스 토큰 발급 불가 (graceful): %s",
            exc,
        )
        return JSONResponse(content=_GRACEFUL_GW_DOWN)

    except Exception as exc:  # noqa: BLE001
        logger.error(
            "global_search_proxy — 예상치 못한 오류 (graceful): %s",
            exc,
            exc_info=True,
        )
        return JSONResponse(content=_GRACEFUL_GW_DOWN)
