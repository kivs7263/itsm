"""SA 사업카드 proxy 라우터.

ITSM → SA 내부 호출로 사업카드 목록을 가져와 ITSM 프론트에 제공.
- 결과 캐시: Redis 5분 TTL
- SA_BACKEND_URL 미설정 시 빈 목록 반환 (graceful)

엔드포인트:
  GET /{tenant_slug}/businesses  — 사업카드 목록 (컨텍스트 드롭다운용)
"""
from __future__ import annotations

import json
import logging
from typing import Any

import httpx
from fastapi import APIRouter, Depends
from typing import Annotated

from app.core.config import settings
from app.core.dependencies import get_current_user
from app.core.redis import get_redis
from app.models import User

logger = logging.getLogger(__name__)

router = APIRouter(tags=["businesses"])

_CACHE_TTL = 300  # 5분


@router.get("/{tenant_slug}/businesses")
async def list_businesses(
    tenant_slug: str,
    current_user: Annotated[User, Depends(get_current_user)],
) -> list[dict[str, Any]]:
    """SA 사업카드 목록 (ITSM 헤더 컨텍스트 드롭다운용).

    SA_BACKEND_URL 미설정 시 빈 목록 반환.
    Redis에 5분 캐시.
    """
    if not settings.SA_BACKEND_URL:
        return []

    itsm_tenant_id = str(current_user.tenant_id)
    # SA_TENANT_ID 설정이 있으면 SA 테넌트 기준으로 조회 (ITSM ≠ SA 테넌트 환경 대응)
    sa_tenant_id = settings.SA_TENANT_ID or itsm_tenant_id
    cache_key = f"itsm:businesses_cache:{itsm_tenant_id}"

    redis = get_redis()
    cached = await redis.get(cache_key)
    if cached:
        try:
            return json.loads(cached)
        except Exception:
            pass

    url = f"{settings.SA_BACKEND_URL.rstrip('/')}/api/itsm-bridge/businesses"
    headers = {
        "x-internal-secret": settings.SERVICE_BUS_SECRET,
        "Content-Type": "application/json",
    }

    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(url, headers=headers, params={"tenant_id": sa_tenant_id})
        if resp.status_code == 200:
            data = resp.json()
            await redis.setex(cache_key, _CACHE_TTL, json.dumps(data))
            return data
        else:
            logger.warning("SA businesses 조회 실패: status=%d", resp.status_code)
            return []
    except Exception:
        logger.exception("SA businesses proxy 호출 오류")
        return []
