"""외부 서비스 KPI 엔드포인트 — service-auth 전용 (CA-P2-3).

GET /api/external/kpi?tenant_slug=<slug>
    인증: KC service-account Bearer JWT (require_service_auth)
    _ALLOWED_AZP: {"gw-svc", "sa-svc"}  (CA-P2-3: sa-svc 추가)
    응답: ITSMKpiResponse (kpi_service.get_kpi)

설계 원칙:
- tenant_slug → tenant_id: external_search.py:38 _resolve_tenant_id 패턴 재사용.
- kpi_service.get_kpi 호출 (기존 집계 로직 재사용, LLM 호출 없음).
- tenant 해석 실패 → 404.
- 내부 오류 → graceful 500 (전역 예외 핸들러 위임).
- main.py에서 prefix 없이 등록 (/{tenant_slug}/... 라우터보다 먼저).
"""
from __future__ import annotations

import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select

from app.core.database import AsyncSessionLocal
from app.core.service_auth import require_service_auth
from app.models.tenant import Tenant
from app.services import kpi_service

logger = logging.getLogger(__name__)

router = APIRouter(tags=["external-kpi"])


async def _resolve_tenant_id(org_id: uuid.UUID) -> uuid.UUID | None:
    """sso_org_id → ITSM 내부 tenant_id. 존재하지 않으면 None.

    ⚠️ cross-service 정본 키 = sso_org_id (ADR-002). slug는 서비스별 상이.
    ITSM sso_org_id 미populate 테넌트는 매칭 불가 → None → 호출측 graceful fallback.
    """
    try:
        async with AsyncSessionLocal() as session:
            row = await session.scalar(
                select(Tenant.id).where(Tenant.sso_org_id == org_id)
            )
            return row if row is not None else None
    except Exception as exc:
        logger.warning("sso_org_id 해석 실패 (org_id=%s): %s", org_id, exc)
        return None


@router.get(
    "/api/external/kpi",
    response_model=dict,
    summary="외부 서비스 ITSM KPI — SA Workspace 경영 스코어카드 (CA-P2-3)",
)
async def external_kpi(
    org_id: uuid.UUID = Query(..., description="sso_org_id (cross-service 정본 키, ADR-002)"),
    _: None = Depends(require_service_auth),
) -> dict:
    """SA Workspace 경영 스코어카드가 호출하는 ITSM KPI 엔드포인트.

    org_id(sso_org_id)→ITSM 내부 tenant 해석. 미존재 → 404 (SA itsm_available=False).
    집계 실패는 kpi_service 내에서 graceful fallback (0/None 반환).
    """
    tenant_id = await _resolve_tenant_id(org_id)
    if tenant_id is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"org_id의 ITSM 테넌트 미존재: {org_id}",
        )

    async with AsyncSessionLocal() as db:
        return await kpi_service.get_kpi(db, tenant_id)
