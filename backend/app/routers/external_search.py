"""외부 서비스 검색 엔드포인트 — service-auth (ADR-051 Phase 2).

GET /api/external/search
    ?q=<검색어>
    &tenant_slug=<테넌트 슬러그>
    &limit=<1~20, default 5>
인증: KC service-account Bearer JWT (require_service_auth, _ALLOWED_AZP={"gw-svc"})
응답: {"items": [GlobalSearchItem]}

설계 원칙:
- tenant_slug → tenant_id: tenants 테이블 직접 조회. 해석 실패 시 빈 items (500 금지).
- search_service.search_tickets + search_service.search_kb 재사용. 시그니처 변경 없음.
- Meilisearch 미연결 시 search_service가 빈 배열 반환 → 빈 items 전파.
- 기존 /{tenant_slug}/search (get_current_user 인증) 동작 변경 없음.
- 라우터 전체 경로(/api/external/search)를 포함 — main.py에서 prefix 없이 등록.

충돌 방지:
  기존 /api/{tenant_slug}/search 라우터보다 main.py에서 먼저 include_router 해야
  FastAPI 라우팅이 "external"을 tenant_slug 로 오해하지 않는다.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select

from app.core.database import AsyncSessionLocal
from app.core.service_auth import require_service_auth
from app.models.tenant import Tenant
from app.services import search_service

logger = logging.getLogger(__name__)

router = APIRouter(tags=["external-search"])


async def _resolve_tenant_id(slug: str) -> str | None:
    """tenant_slug → tenant_id UUID 문자열. 존재하지 않으면 None 반환."""
    try:
        async with AsyncSessionLocal() as session:
            result = await session.execute(
                select(Tenant.id).where(Tenant.slug == slug)
            )
            row = result.scalar_one_or_none()
            return str(row) if row is not None else None
    except Exception as exc:
        logger.warning("tenant_slug 해석 실패 (slug=%s): %s", slug, exc)
        return None


@router.get(
    "/api/external/search",
    response_model=dict,
    summary="외부 서비스 ITSM 검색 — GW 게이트웨이 전용 (ADR-051)",
)
async def external_search(
    q: str = Query(..., min_length=1, description="검색어"),
    tenant_slug: str = Query(..., description="테넌트 슬러그"),
    limit: int = Query(5, ge=1, le=20, description="결과 수 (최대 20, 기본 5)"),
    _: None = Depends(require_service_auth),
) -> dict:
    """GW 글로벌 검색 게이트웨이(/api/search/global)가 호출하는 ITSM 검색 엔드포인트.

    응답은 ADR-051 §2.3 GlobalSearchItem 포맷으로 어댑팅된다:
      itsm_ticket: {id, type="itsm_ticket", title, subtitle=status,
                    href="/{tenant_slug}/tickets/{id}", source="ITSM", score}
      itsm_kb:    {id, type="itsm_kb", title, subtitle="",
                    href="/{tenant_slug}/kb/{id}", source="ITSM", score}

    tenant 해석 실패 또는 Meilisearch 다운 → 빈 items, 500 절대 금지.
    """
    tenant_id = await _resolve_tenant_id(tenant_slug)
    if tenant_id is None:
        logger.info(
            "external_search: tenant_slug='%s' 미존재 — 빈 결과 반환", tenant_slug
        )
        return {"items": []}

    tickets = await search_service.search_tickets(tenant_id, q, limit)
    kb = await search_service.search_kb(tenant_id, q, limit)

    items: list[dict] = []

    for t in tickets:
        items.append(
            {
                "id": str(t["id"]),
                "type": "itsm_ticket",
                "title": t.get("title", ""),
                "subtitle": t.get("status", ""),
                "href": f"/{tenant_slug}/tickets/{t['id']}",
                "source": "ITSM",
                "score": float(t.get("score", 0.0)),
            }
        )

    for k in kb:
        items.append(
            {
                "id": str(k["id"]),
                "type": "itsm_kb",
                "title": k.get("title", ""),
                "subtitle": "",
                "href": f"/{tenant_slug}/kb/{k['id']}",
                "source": "ITSM",
                "score": float(k.get("score", 0.0)),
            }
        )

    # score 내림차순 정렬 (GW 게이트웨이 혼합 랭킹 일관성)
    items.sort(key=lambda x: x["score"], reverse=True)

    return {"items": items}
