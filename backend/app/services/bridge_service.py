"""ITSM → SA KPI 브릿지 서비스.

사업카드(linked_business_id)에 연결된 테넌트의 운영 지표를 집계하여
SA /api/itsm-bridge/businesses/{business_id}/kpi 로 push한다.
"""
from __future__ import annotations

import logging
from datetime import UTC, datetime

import httpx
from pydantic import BaseModel
from sqlalchemy import text

from app.core.config import settings
from app.core.database import AsyncSessionLocal

logger = logging.getLogger(__name__)


# ──────────────────────────────────────────────────────────────────────────────
# KPI 페이로드 스키마 (SA ItsmKpiPayload 와 동일)
# ──────────────────────────────────────────────────────────────────────────────

class ItsmKpiPayload(BaseModel):
    total_tickets: int = 0
    open_tickets: int = 0
    sla_compliance_rate: float = 0.0   # 0.0~1.0
    mtta_minutes: float | None = None  # 평균 최초 응답 시간 (분)
    mttr_minutes: float | None = None  # 평균 해결 시간 (분)
    csat_score: float | None = None    # 1.0~5.0 (제출 완료 설문 평균)
    csat_response_rate: float | None = None  # 0.0~1.0 (제출 / 전체 발송)
    total_hours: float | None = None        # 총 투입 공수 (h)
    billable_hours: float | None = None     # 유상 공수 (h)
    billable_ratio: float | None = None     # 유상 비율 0.0~1.0
    contract_expire_days: int | None = None  # 계약 만료까지 남은 일수
    synced_at: str                     # ISO datetime


# ──────────────────────────────────────────────────────────────────────────────
# KPI 집계
# ──────────────────────────────────────────────────────────────────────────────

async def compute_kpi(tenant_id: str, business_id: str) -> ItsmKpiPayload | None:
    """해당 tenant의 linked_business_id=business_id 계약 기준 KPI 집계.

    집계 항목:
    - total_tickets: tenant 전체 티켓 수 (소프트 삭제 없으므로 전체)
    - open_tickets: status IN ('open', 'in_progress', 'pending')
    - sla_compliance_rate: 1 - (breached_count / max(total_tickets, 1))
    - mtta_minutes: AVG(updated_at - created_at) WHERE status != 'open'  (최초 응답 대리지표)
    - mttr_minutes: AVG(resolved_at - created_at) WHERE resolved_at IS NOT NULL
    - contract_expire_days: MIN(end_date - TODAY) WHERE linked_business_id=business_id
    """
    try:
        async with AsyncSessionLocal() as session:
            # 1. total_tickets
            row = await session.execute(
                text("""
                    SELECT COUNT(*) AS total
                    FROM tickets
                    WHERE tenant_id = :tenant_id::uuid
                """),
                {"tenant_id": tenant_id},
            )
            total_tickets = int(row.scalar_one() or 0)

            # 2. open_tickets
            row = await session.execute(
                text("""
                    SELECT COUNT(*) AS cnt
                    FROM tickets
                    WHERE tenant_id = :tenant_id::uuid
                      AND status IN ('open', 'in_progress', 'pending')
                """),
                {"tenant_id": tenant_id},
            )
            open_tickets = int(row.scalar_one() or 0)

            # 3. sla_compliance_rate: SLA breach 비율 역산
            row = await session.execute(
                text("""
                    SELECT COUNT(*) AS breached_cnt
                    FROM sla_events
                    WHERE tenant_id = :tenant_id::uuid
                      AND event_type = 'breached'
                """),
                {"tenant_id": tenant_id},
            )
            breached_count = int(row.scalar_one() or 0)
            sla_compliance_rate = round(
                1.0 - (breached_count / max(total_tickets, 1)), 4
            )
            sla_compliance_rate = max(0.0, min(1.0, sla_compliance_rate))

            # 4. mtta_minutes: 최초 응답 대리지표 (status != 'open' 인 티켓의 갱신 소요시간)
            row = await session.execute(
                text("""
                    SELECT AVG(
                        EXTRACT(EPOCH FROM (updated_at - created_at)) / 60.0
                    ) AS avg_min
                    FROM tickets
                    WHERE tenant_id = :tenant_id::uuid
                      AND status != 'open'
                """),
                {"tenant_id": tenant_id},
            )
            mtta_val = row.scalar_one()
            mtta_minutes = round(float(mtta_val), 2) if mtta_val is not None else None

            # 5. mttr_minutes: 해결 시간 평균
            row = await session.execute(
                text("""
                    SELECT AVG(
                        EXTRACT(EPOCH FROM (resolved_at - created_at)) / 60.0
                    ) AS avg_min
                    FROM tickets
                    WHERE tenant_id = :tenant_id::uuid
                      AND resolved_at IS NOT NULL
                """),
                {"tenant_id": tenant_id},
            )
            mttr_val = row.scalar_one()
            mttr_minutes = round(float(mttr_val), 2) if mttr_val is not None else None

            # 6. contract_expire_days: 해당 business_id 계약 중 가장 빠른 만료
            row = await session.execute(
                text("""
                    SELECT MIN(end_date - CURRENT_DATE) AS days_left
                    FROM contracts
                    WHERE tenant_id = :tenant_id::uuid
                      AND linked_business_id = :business_id::uuid
                """),
                {"tenant_id": tenant_id, "business_id": business_id},
            )
            expire_val = row.scalar_one()
            contract_expire_days = int(expire_val) if expire_val is not None else None

            # 7. 공수 집계 (ticket_work_logs)
            row = await session.execute(
                text("""
                    SELECT
                        COALESCE(SUM(hours), 0)                                     AS total_h,
                        COALESCE(SUM(hours) FILTER (WHERE billable = true), 0)      AS billable_h,
                        COUNT(*)                                                     AS log_cnt
                    FROM ticket_work_logs
                    WHERE tenant_id = :tenant_id::uuid
                """),
                {"tenant_id": tenant_id},
            )
            wl_row = row.one()
            total_hours = round(float(wl_row.total_h), 2) if wl_row.log_cnt else None
            billable_hours = round(float(wl_row.billable_h), 2) if wl_row.log_cnt else None
            billable_ratio = (
                round(float(wl_row.billable_h) / float(wl_row.total_h), 4)
                if wl_row.total_h and float(wl_row.total_h) > 0
                else None
            )

            # 8. csat_score / csat_response_rate: 제출 완료 설문 기준
            row = await session.execute(
                text("""
                    SELECT
                        AVG(score)                                          AS avg_score,
                        COUNT(*) FILTER (WHERE status = 'submitted')        AS submitted_cnt,
                        COUNT(*)                                             AS total_cnt
                    FROM csat_surveys
                    WHERE tenant_id = :tenant_id::uuid
                """),
                {"tenant_id": tenant_id},
            )
            csat_row = row.one()
            csat_score = round(float(csat_row.avg_score), 2) if csat_row.avg_score is not None else None
            csat_response_rate = (
                round(float(csat_row.submitted_cnt) / float(csat_row.total_cnt), 4)
                if csat_row.total_cnt and csat_row.total_cnt > 0
                else None
            )

        return ItsmKpiPayload(
            total_tickets=total_tickets,
            open_tickets=open_tickets,
            sla_compliance_rate=sla_compliance_rate,
            mtta_minutes=mtta_minutes,
            mttr_minutes=mttr_minutes,
            csat_score=csat_score,
            csat_response_rate=csat_response_rate,
            total_hours=total_hours,
            billable_hours=billable_hours,
            billable_ratio=billable_ratio,
            contract_expire_days=contract_expire_days,
            synced_at=datetime.now(UTC).isoformat(),
        )

    except Exception:
        logger.exception(
            "KPI 집계 실패: tenant_id=%s business_id=%s", tenant_id, business_id
        )
        return None


# ──────────────────────────────────────────────────────────────────────────────
# SA push
# ──────────────────────────────────────────────────────────────────────────────

async def push_to_sa(business_id: str, kpi: ItsmKpiPayload) -> bool:
    """SA /api/itsm-bridge/businesses/{business_id}/kpi 로 PATCH.

    SA_BACKEND_URL 미설정 시 graceful skip (False 반환).
    """
    if not settings.SA_BACKEND_URL:
        logger.info("SA_BACKEND_URL 미설정, KPI push 생략 (business_id=%s)", business_id)
        return False

    url = (
        f"{settings.SA_BACKEND_URL.rstrip('/')}"
        f"/api/itsm-bridge/businesses/{business_id}/kpi"
    )
    headers = {
        "x-internal-secret": settings.SERVICE_BUS_SECRET,
        "Content-Type": "application/json",
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.patch(url, json=kpi.model_dump(), headers=headers)

        if resp.status_code == 200:
            logger.info(
                "KPI push 성공: business_id=%s total=%d sla=%.3f",
                business_id,
                kpi.total_tickets,
                kpi.sla_compliance_rate,
            )
            return True
        else:
            logger.warning(
                "KPI push 실패: business_id=%s status=%d body=%s",
                business_id,
                resp.status_code,
                resp.text[:200],
            )
            return False

    except Exception:
        logger.exception("KPI push 예외: business_id=%s url=%s", business_id, url)
        return False
