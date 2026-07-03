"""ITSM 외부 KPI 집계 서비스 (CA-P2-3).

SA Workspace 경영 스코어카드가 호출하는 테넌트별 KPI.
기존 집계 로직(csat_service.get_summary, sla.py 쿼리)을 재사용한다.
LLM 호출 없음. 마이그레이션 없음(읽기 집계만).

반환 스키마:
    sla_compliance_rate : float (%)  1 - (SLA 위반 고유 티켓 수 / 전체 티켓 수) × 100
    csat_avg            : float | None  제출 기준 평균 점수 (1~5)
    csat_response_rate  : float  제출 / 전체 설문 (0~1)
    open_ticket_count   : int  open/in_progress/pending 티켓 수
    breached_ticket_count: int  SLA 위반 진행 중 티켓 수
    avg_resolution_minutes: float  평균 해결 시간 (분)
    as_of               : str  ISO 8601 UTC
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.csat_survey import CSATSurvey, CSATStatus
from app.models.sla import SLAEvent, SLAEventType
from app.models.ticket import Ticket, TicketStatus
from app.services import csat_service

logger = logging.getLogger(__name__)

_ACTIVE_STATUSES = [TicketStatus.open, TicketStatus.in_progress, TicketStatus.pending]
_CLOSED_STATUSES = [TicketStatus.resolved, TicketStatus.closed]


async def get_kpi(db: AsyncSession, tenant_id: uuid.UUID) -> dict:
    """테넌트별 ITSM KPI 집계.

    csat_service.get_summary / sla.py 쿼리 로직을 직접 재사용.
    모든 쿼리 실패는 graceful fallback 값 반환 (500 절대 금지).
    """
    as_of = datetime.now(timezone.utc).isoformat()

    # ── 1. SLA 지표 ─────────────────────────────────────────────────────
    try:
        # 활성 티켓
        open_ticket_count: int = await db.scalar(
            select(func.count())
            .select_from(Ticket)
            .where(
                and_(
                    Ticket.tenant_id == tenant_id,
                    Ticket.status.in_(_ACTIVE_STATUSES),
                )
            )
        ) or 0

        # SLA 위반(breach) 진행 중 티켓 수
        breached_subq = (
            select(SLAEvent.ticket_id)
            .join(Ticket, SLAEvent.ticket_id == Ticket.id)
            .where(
                and_(
                    SLAEvent.tenant_id == tenant_id,
                    SLAEvent.event_type == SLAEventType.breached,
                    Ticket.status.notin_(_CLOSED_STATUSES),
                )
            )
            .distinct()
            .scalar_subquery()
        )
        breached_ticket_count: int = await db.scalar(
            select(func.count()).select_from(breached_subq.alias())
        ) or 0

        # SLA 준수율: 1 - (SLA 위반 고유 티켓 수 / 전체 티켓 수) × 100
        # 이전 공식 resolved+closed / total = 해결률(다른 지표) — 잘못된 대입 수정.
        # breach 기반 공식으로 reports.py / sla.py 대시보드와 통일.
        # 이벤트 건수(COUNT(*)) 사용 시 response+resolution 2건 위반 → 음수 가능하므로
        # distinct ticket_id 기준으로 집계 (sla_worker.py 참조).
        # 분모: 전체 티켓 수. SLA 미적용 티켓 포함 시 준수율 과대계상 가능.
        # (sla_worker.py:235 contract_id IS NOT NULL 참조 — 분모 정제는 향후 개선 과제)
        total_tickets: int = await db.scalar(
            select(func.count()).select_from(Ticket).where(Ticket.tenant_id == tenant_id)
        ) or 0
        sla_breach_ticket_count: int = await db.scalar(
            select(func.count(SLAEvent.ticket_id.distinct()))
            .select_from(SLAEvent)
            .where(
                and_(
                    SLAEvent.tenant_id == tenant_id,
                    SLAEvent.event_type == SLAEventType.breached,
                )
            )
        ) or 0
        sla_compliance_rate = (
            round(max(0.0, 1.0 - sla_breach_ticket_count / total_tickets) * 100, 2)
            if total_tickets > 0 else 100.0
        )

        # 평균 해결 시간 (분)
        avg_minutes_row = await db.scalar(
            select(
                func.avg(
                    func.extract("epoch", Ticket.resolved_at - Ticket.created_at) / 60
                )
            ).where(
                and_(
                    Ticket.tenant_id == tenant_id,
                    Ticket.resolved_at.isnot(None),
                )
            )
        )
        avg_resolution_minutes = round(float(avg_minutes_row), 1) if avg_minutes_row else 0.0

    except Exception:
        logger.warning("ITSM KPI SLA 집계 실패 (tenant_id=%s)", tenant_id, exc_info=True)
        open_ticket_count = 0
        breached_ticket_count = 0
        sla_compliance_rate = 0.0
        avg_resolution_minutes = 0.0

    # ── 2. CSAT 지표 ─────────────────────────────────────────────────────
    try:
        csat_summary = await csat_service.get_summary(db, tenant_id)
        csat_avg: float | None = csat_summary.get("avg_score")
        csat_response_rate: float = float(csat_summary.get("response_rate", 0.0))
    except Exception:
        logger.warning("ITSM KPI CSAT 집계 실패 (tenant_id=%s)", tenant_id, exc_info=True)
        csat_avg = None
        csat_response_rate = 0.0

    return {
        "sla_compliance_rate": sla_compliance_rate,
        "csat_avg": csat_avg,
        "csat_response_rate": csat_response_rate,
        "open_ticket_count": open_ticket_count,
        "breached_ticket_count": breached_ticket_count,
        "avg_resolution_minutes": avg_resolution_minutes,
        "as_of": as_of,
    }
