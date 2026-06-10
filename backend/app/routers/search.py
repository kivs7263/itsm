"""통합 검색 라우터 — 티켓 + KB 전문 검색.

prefix : /{tenant_slug}/search
인증   : get_current_user
격리   : tenant_id 기반 인덱스 분리 (멀티테넌트)

GET /{tenant_slug}/search?q=검색어&type=ticket|kb|all&limit=20

응답:
  {
    "tickets": [{"id": "...", "title": "...", "status": "open", "score": 0.98}],
    "kb":      [{"id": "...", "title": "...", "score": 0.95}]
  }

type=ticket → kb 결과 빈 배열
type=kb     → tickets 결과 빈 배열
type=all    → 양쪽 모두 (기본값)
"""
from __future__ import annotations

import logging
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query

from app.core.dependencies import get_current_user
from app.models.user import User
from app.services import search_service

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/{tenant_slug}/search",
    tags=["search"],
)


@router.get(
    "",
    response_model=dict,
    summary="티켓 + KB 통합 전문 검색",
)
async def unified_search(
    tenant_slug: str,
    q: str = Query(..., min_length=1, description="검색어"),
    type: Literal["ticket", "kb", "all"] = Query("all", description="검색 대상"),
    limit: int = Query(20, ge=1, le=100),
    current_user: Annotated[User, Depends(get_current_user)] = None,
) -> dict:
    tenant_id = str(current_user.tenant_id)

    tickets: list[dict] = []
    kb: list[dict] = []

    if type in ("ticket", "all"):
        tickets = await search_service.search_tickets(tenant_id, q, limit)

    if type in ("kb", "all"):
        kb = await search_service.search_kb(tenant_id, q, limit)

    return {"tickets": tickets, "kb": kb}
