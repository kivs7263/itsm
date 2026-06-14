"""ITSM → SA KPI 브릿지 서비스.

사업카드(linked_business_id)에 연결된 계약 기준으로 운영 지표를 집계하여
SA /api/itsm-bridge/businesses/{business_id}/kpi 로 push한다.

버그 수정 (2026-06-14):
  - 이전: 모든 집계가 tenant_id 기준 → 멀티 계약 테넌트에서 사업별 오염
  - 수정: tickets/work_logs/csat 집계를 tickets→contracts→linked_business_id JOIN 경로로 한정
"""
from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Literal

import httpx
from pydantic import BaseModel
from sqlalchemy import text

from app.core.config import settings
from app.core.database import AsyncSessionLocal

logger = logging.getLogger(__name__)


# ──────────────────────────────────────────────────────────────────────────────
# KPI 페이로드 스키마 (SA ItsmKpiPayload 와 동일하게 유지)
# ──────────────────────────────────────────────────────────────────────────────

class ItsmKpiPayload(BaseModel):
    # 기존 필드
    total_tickets: int = 0
    open_tickets: int = 0
    sla_compliance_rate: float = 0.0
    mtta_minutes: float | None = None
    mttr_minutes: float | None = None
    csat_score: float | None = None
    csat_response_rate: float | None = None
    total_hours: float | None = None
    billable_hours: float | None = None
    billable_ratio: float | None = None
    contract_expire_days: int | None = None
    synced_at: str

    # 신규 해석 레이어 필드 (BIZCARD-A)
    risk_band: Literal["healthy", "watch", "at_risk", "critical"] | None = None
    top_anomaly: dict | None = None          # {type, message, since}
    tickets_delta_14d: float | None = None   # 최근 14일 vs 직전 14일 티켓 발생 변화율 (%)
    engineer_concentration: float | None = None  # 상위 1인 공수 점유율 0.0~1.0
    ticket_breakdown: dict | None = None     # {incident, install, retention, other} 건수
    retention_risk_score: float | None = None    # 0.0~1.0
    action_hints: list | None = None         # [{code, label}]
    user_hours: list | None = None           # [{user_id, hours, billable_hours, work_type_breakdown}]

    # P&L 필드 (BIZCARD-C)
    actual_cost: float | None = None           # 실제 투입 인건비 (원)
    actual_margin_rate: float | None = None    # (contract_value - actual_cost) / contract_value × 100 (%)
    projected_total_cost: float | None = None  # actual_cost + daily_rate × remaining_days
    burn_rate_alert: bool = False              # projected > contract_value × 0.90
    contract_value: float | None = None        # 계약 금액 합산 (contracts.amount)


# ──────────────────────────────────────────────────────────────────────────────
# P&L 계산 (BIZCARD-C)
# ──────────────────────────────────────────────────────────────────────────────

async def fetch_labor_rates(tenant_id: str) -> dict[str, float]:
    """SA /api/itsm-bridge/labor-rates?tenant_id={tid} 에서 단가 pull.

    반환: {user_id: hourly_rate} (개인 단가 우선) + {"role:{role}": hourly_rate} (role 단가)
    SA_BACKEND_URL 미설정 시 빈 dict 반환 (graceful skip)
    """
    if not settings.SA_BACKEND_URL:
        logger.info("SA_BACKEND_URL 미설정, labor_rates pull 생략 (tenant_id=%s)", tenant_id)
        return {}

    url = (
        f"{settings.SA_BACKEND_URL.rstrip('/')}"
        f"/api/itsm-bridge/labor-rates"
    )
    headers = {"x-internal-secret": settings.SERVICE_BUS_SECRET}

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url, params={"tenant_id": tenant_id}, headers=headers)
        if resp.status_code != 200:
            logger.warning(
                "labor_rates pull 실패: status=%d body=%s", resp.status_code, resp.text[:200]
            )
            return {}
        rates: dict[str, float] = {}
        for item in resp.json():
            hourly = float(item.get("hourly_rate") or 0.0)
            if item.get("user_id"):
                rates[item["user_id"]] = hourly
            if item.get("role"):
                role_key = f"role:{item['role']}"
                # 같은 role이 여러 row일 때 평균 — 단순히 덮어씀 (마지막 값 사용)
                rates[role_key] = hourly
        return rates
    except Exception:
        logger.exception("labor_rates pull 예외: tenant_id=%s", tenant_id)
        return {}


async def compute_pl(
    user_hours: list,
    labor_rates: dict[str, float],
    contract_value: float | None,
    days_remaining: int | None,
) -> dict:
    """P&L 계산.

    actual_cost = Σ(user.hours × rate)
      — user_id 있으면 개인 단가, 없으면 "role:default" fallback (0.0)
    actual_margin_rate = (contract_value - actual_cost) / contract_value * 100
      (contract_value 있을 때만)
    daily_rate = actual_cost / max(elapsed_days, 1) — 단순 추정
    projected_total_cost = actual_cost + daily_rate * days_remaining
    burn_rate_alert = projected_total_cost > contract_value * 0.90

    반환: {actual_cost, actual_margin_rate, projected_total_cost, burn_rate_alert, contract_value}
    """
    actual_cost = 0.0
    for u in user_hours:
        uid = u.get("user_id")
        hours = float(u.get("hours") or 0.0)
        if uid and uid in labor_rates:
            rate = labor_rates[uid]
        else:
            rate = labor_rates.get("role:default", 0.0)
        actual_cost += hours * rate

    actual_cost = round(actual_cost, 2)

    actual_margin_rate: float | None = None
    if contract_value and contract_value > 0:
        actual_margin_rate = round(
            (contract_value - actual_cost) / contract_value * 100, 2
        )

    # elapsed_days 추정: 전체 공수 / 8시간 근무 기준 (days_remaining 없으면 projected 생략)
    total_h = sum(float(u.get("hours") or 0.0) for u in user_hours)
    elapsed_days = max(total_h / 8.0, 1.0)
    daily_rate = actual_cost / elapsed_days

    projected_total_cost: float | None = None
    burn_rate_alert = False
    if days_remaining is not None:
        projected_total_cost = round(actual_cost + daily_rate * days_remaining, 2)
        if contract_value and contract_value > 0:
            burn_rate_alert = projected_total_cost > contract_value * 0.90

    return {
        "actual_cost": actual_cost,
        "actual_margin_rate": actual_margin_rate,
        "projected_total_cost": projected_total_cost,
        "burn_rate_alert": burn_rate_alert,
        "contract_value": contract_value,
    }


# ──────────────────────────────────────────────────────────────────────────────
# 리텐션 위험 스코어
# ──────────────────────────────────────────────────────────────────────────────

def compute_retention_risk(
    csat_score: float | None,
    sla_compliance_rate: float,
    open_tickets: int,
    total_tickets: int,
    retention_ticket_count: int,
    contract_expire_days: int | None,
) -> float:
    """리텐션 위험 스코어 0.0~1.0 계산.

    가중치: CSAT 30% + SLA 위반율 25% + 미해결 적체율 20% +
            retention 티켓 존재 15% + 계약 만료 임박 10%
    """
    csat_term = ((5.0 - (csat_score or 3.0)) / 4.0) * 0.30
    sla_term = (1.0 - sla_compliance_rate) * 0.25
    open_ratio = open_tickets / max(total_tickets, 1)
    open_term = open_ratio * 0.20
    retention_term = (1.0 if retention_ticket_count > 0 else 0.0) * 0.15
    if contract_expire_days is not None:
        expire_term = (1.0 - min(contract_expire_days, 365) / 365) * 0.10
    else:
        expire_term = 0.0

    score = csat_term + sla_term + open_term + retention_term + expire_term
    return round(max(0.0, min(1.0, score)), 4)


def compute_risk_band(
    retention_score: float,
    sla_compliance_rate: float,
    csat_score: float | None,
) -> Literal["healthy", "watch", "at_risk", "critical"]:
    """risk_band 4등급 산출."""
    if (
        retention_score > 0.8
        or sla_compliance_rate < 0.70
        or (csat_score is not None and csat_score < 2.5)
    ):
        return "critical"
    if (
        retention_score > 0.6
        or sla_compliance_rate < 0.80
        or (csat_score is not None and csat_score < 3.0)
    ):
        return "at_risk"
    if (
        retention_score > 0.3
        or sla_compliance_rate < 0.90
    ):
        return "watch"
    return "healthy"


def compute_action_hints(
    risk_band: str,
    contract_expire_days: int | None,
    engineer_concentration: float | None,
    csat_score: float | None,
    retention_risk_score: float,
) -> list[dict]:
    """risk_band 및 이상 신호 기반 Action Hints 최대 2개 반환."""
    hints = []
    if contract_expire_days is not None and contract_expire_days <= 30:
        hints.append({"code": "contract_expiring_soon", "label": "계약 갱신 협상 시작"})
    if csat_score is not None and csat_score < 3.5:
        hints.append({"code": "csat_dropping", "label": "리텐션 미팅 제안"})
    if engineer_concentration is not None and engineer_concentration > 0.70:
        hints.append({"code": "engineer_concentration_risk", "label": "백업 엔지니어 지정"})
    if risk_band in ("at_risk", "critical") and not hints:
        hints.append({"code": "general_risk", "label": "사업 현황 점검 미팅 제안"})
    return hints[:2]


# ──────────────────────────────────────────────────────────────────────────────
# KPI 집계 (버그 수정: business_id 기준 필터)
# ──────────────────────────────────────────────────────────────────────────────

async def compute_kpi(tenant_id: str, business_id: str) -> ItsmKpiPayload | None:
    """linked_business_id = business_id 계약에 속한 티켓만 집계.

    수정 (2026-06-14): 이전 구현은 tenant_id 전체 집계로 사업별 오염 발생.
    tickets.contract_id → contracts.linked_business_id 경로로 필터링.
    """
    try:
        async with AsyncSessionLocal() as session:

            # ── 1. total_tickets (business 한정) ──────────────────────────────
            row = await session.execute(
                text("""
                    SELECT COUNT(*) AS total
                    FROM tickets t
                    JOIN contracts c ON c.id = t.contract_id
                    WHERE c.linked_business_id = CAST(:business_id AS uuid)
                      AND t.tenant_id = CAST(:tenant_id AS uuid)
                """),
                {"tenant_id": tenant_id, "business_id": business_id},
            )
            total_tickets = int(row.scalar_one() or 0)

            # ── 2. open_tickets ───────────────────────────────────────────────
            row = await session.execute(
                text("""
                    SELECT COUNT(*) AS cnt
                    FROM tickets t
                    JOIN contracts c ON c.id = t.contract_id
                    WHERE c.linked_business_id = CAST(:business_id AS uuid)
                      AND t.tenant_id = CAST(:tenant_id AS uuid)
                      AND t.status IN ('open', 'in_progress', 'pending')
                """),
                {"tenant_id": tenant_id, "business_id": business_id},
            )
            open_tickets = int(row.scalar_one() or 0)

            # ── 3. sla_compliance_rate ────────────────────────────────────────
            row = await session.execute(
                text("""
                    SELECT COUNT(*) AS breached_cnt
                    FROM sla_events se
                    JOIN tickets t ON t.id = se.ticket_id
                    JOIN contracts c ON c.id = t.contract_id
                    WHERE c.linked_business_id = CAST(:business_id AS uuid)
                      AND se.tenant_id = CAST(:tenant_id AS uuid)
                      AND se.event_type = 'breached'
                """),
                {"tenant_id": tenant_id, "business_id": business_id},
            )
            breached_count = int(row.scalar_one() or 0)
            sla_compliance_rate = round(
                1.0 - (breached_count / max(total_tickets, 1)), 4
            )
            sla_compliance_rate = max(0.0, min(1.0, sla_compliance_rate))

            # ── 4. mtta_minutes ───────────────────────────────────────────────
            row = await session.execute(
                text("""
                    SELECT AVG(
                        EXTRACT(EPOCH FROM (t.updated_at - t.created_at)) / 60.0
                    ) AS avg_min
                    FROM tickets t
                    JOIN contracts c ON c.id = t.contract_id
                    WHERE c.linked_business_id = CAST(:business_id AS uuid)
                      AND t.tenant_id = CAST(:tenant_id AS uuid)
                      AND t.status != 'open'
                """),
                {"tenant_id": tenant_id, "business_id": business_id},
            )
            mtta_val = row.scalar_one()
            mtta_minutes = round(float(mtta_val), 2) if mtta_val is not None else None

            # ── 5. mttr_minutes ───────────────────────────────────────────────
            row = await session.execute(
                text("""
                    SELECT AVG(
                        EXTRACT(EPOCH FROM (t.resolved_at - t.created_at)) / 60.0
                    ) AS avg_min
                    FROM tickets t
                    JOIN contracts c ON c.id = t.contract_id
                    WHERE c.linked_business_id = CAST(:business_id AS uuid)
                      AND t.tenant_id = CAST(:tenant_id AS uuid)
                      AND t.resolved_at IS NOT NULL
                """),
                {"tenant_id": tenant_id, "business_id": business_id},
            )
            mttr_val = row.scalar_one()
            mttr_minutes = round(float(mttr_val), 2) if mttr_val is not None else None

            # ── 6. contract_expire_days ───────────────────────────────────────
            row = await session.execute(
                text("""
                    SELECT MIN(end_date - CURRENT_DATE) AS days_left
                    FROM contracts
                    WHERE tenant_id = CAST(:tenant_id AS uuid)
                      AND linked_business_id = CAST(:business_id AS uuid)
                """),
                {"tenant_id": tenant_id, "business_id": business_id},
            )
            expire_val = row.scalar_one()
            contract_expire_days = int(expire_val) if expire_val is not None else None

            # ── 6b. contract_value 합산 ───────────────────────────────────────
            row = await session.execute(
                text("""
                    SELECT COALESCE(SUM(amount), 0) AS contract_total
                    FROM contracts
                    WHERE tenant_id = CAST(:tenant_id AS uuid)
                      AND linked_business_id = CAST(:business_id AS uuid)
                """),
                {"tenant_id": tenant_id, "business_id": business_id},
            )
            contract_value_raw = row.scalar_one()
            contract_value = float(contract_value_raw) if contract_value_raw else None

            # ── 7. 공수 집계 — business 한정, per-user 분해 포함 ─────────────
            row = await session.execute(
                text("""
                    SELECT
                        COALESCE(SUM(wl.hours), 0)                                            AS total_h,
                        COALESCE(SUM(wl.hours) FILTER (WHERE wl.billable = true), 0)          AS billable_h,
                        COUNT(wl.id)                                                           AS log_cnt
                    FROM ticket_work_logs wl
                    JOIN tickets t ON t.id = wl.ticket_id
                    JOIN contracts c ON c.id = t.contract_id
                    WHERE c.linked_business_id = CAST(:business_id AS uuid)
                      AND wl.tenant_id = CAST(:tenant_id AS uuid)
                """),
                {"tenant_id": tenant_id, "business_id": business_id},
            )
            wl_row = row.one()
            total_hours = round(float(wl_row.total_h), 2) if wl_row.log_cnt else None
            billable_hours = round(float(wl_row.billable_h), 2) if wl_row.log_cnt else None
            billable_ratio = (
                round(float(wl_row.billable_h) / float(wl_row.total_h), 4)
                if wl_row.total_h and float(wl_row.total_h) > 0
                else None
            )

            # per-user 공수 분해 (P&L 계산용)
            user_rows = await session.execute(
                text("""
                    SELECT
                        wl.user_id::text                                                       AS user_id,
                        SUM(wl.hours)                                                          AS hours,
                        SUM(wl.hours) FILTER (WHERE wl.billable = true)                       AS billable_hours,
                        SUM(wl.hours) FILTER (WHERE wl.work_type = 'remote')                  AS remote_h,
                        SUM(wl.hours) FILTER (WHERE wl.work_type = 'onsite')                  AS onsite_h,
                        SUM(wl.hours) FILTER (WHERE wl.work_type = 'phone')                   AS phone_h,
                        SUM(wl.hours) FILTER (WHERE wl.work_type = 'email')                   AS email_h,
                        SUM(wl.hours) FILTER (WHERE wl.work_type = 'internal')                AS internal_h
                    FROM ticket_work_logs wl
                    JOIN tickets t ON t.id = wl.ticket_id
                    JOIN contracts c ON c.id = t.contract_id
                    WHERE c.linked_business_id = CAST(:business_id AS uuid)
                      AND wl.tenant_id = CAST(:tenant_id AS uuid)
                      AND wl.user_id IS NOT NULL
                    GROUP BY wl.user_id
                """),
                {"tenant_id": tenant_id, "business_id": business_id},
            )
            user_hours_list = []
            total_h_all = float(wl_row.total_h) if wl_row.total_h else 0.0
            for ur in user_rows.fetchall():
                user_hours_list.append({
                    "user_id": ur.user_id,
                    "hours": round(float(ur.hours), 2),
                    "billable_hours": round(float(ur.billable_hours or 0), 2),
                    "work_type_breakdown": {
                        "remote": round(float(ur.remote_h or 0), 2),
                        "onsite": round(float(ur.onsite_h or 0), 2),
                        "phone": round(float(ur.phone_h or 0), 2),
                        "email": round(float(ur.email_h or 0), 2),
                        "internal": round(float(ur.internal_h or 0), 2),
                    },
                })

            # work_type_breakdown (전체 비율)
            work_type_breakdown = None
            if total_h_all > 0 and user_hours_list:
                def _sum_type(key: str) -> float:
                    return sum(u["work_type_breakdown"][key] for u in user_hours_list)
                work_type_breakdown = {
                    "remote": round(_sum_type("remote") / total_h_all, 4),
                    "onsite": round(_sum_type("onsite") / total_h_all, 4),
                    "phone": round(_sum_type("phone") / total_h_all, 4),
                    "email": round(_sum_type("email") / total_h_all, 4),
                    "internal": round(_sum_type("internal") / total_h_all, 4),
                }

            # engineer_concentration (상위 1인 점유율)
            engineer_concentration = None
            if total_h_all > 0 and user_hours_list:
                top_hours = max(u["hours"] for u in user_hours_list)
                engineer_concentration = round(top_hours / total_h_all, 4)

            # ── 8. CSAT — business 한정 ────────────────────────────────────
            row = await session.execute(
                text("""
                    SELECT
                        AVG(cs.score)                                                         AS avg_score,
                        COUNT(*) FILTER (WHERE cs.status = 'submitted')                       AS submitted_cnt,
                        COUNT(*)                                                               AS total_cnt
                    FROM csat_surveys cs
                    JOIN tickets t ON t.id = cs.ticket_id
                    JOIN contracts c ON c.id = t.contract_id
                    WHERE c.linked_business_id = CAST(:business_id AS uuid)
                      AND cs.tenant_id = CAST(:tenant_id AS uuid)
                """),
                {"tenant_id": tenant_id, "business_id": business_id},
            )
            csat_row = row.one()
            csat_score = round(float(csat_row.avg_score), 2) if csat_row.avg_score is not None else None
            csat_response_rate = (
                round(float(csat_row.submitted_cnt) / float(csat_row.total_cnt), 4)
                if csat_row.total_cnt and csat_row.total_cnt > 0
                else None
            )

            # ── 9. tickets_delta_14d ──────────────────────────────────────────
            row = await session.execute(
                text("""
                    SELECT
                        COUNT(*) FILTER (WHERE t.created_at >= NOW() - INTERVAL '14 days')    AS recent_14,
                        COUNT(*) FILTER (WHERE t.created_at >= NOW() - INTERVAL '28 days'
                                           AND t.created_at  < NOW() - INTERVAL '14 days')   AS prev_14
                    FROM tickets t
                    JOIN contracts c ON c.id = t.contract_id
                    WHERE c.linked_business_id = CAST(:business_id AS uuid)
                      AND t.tenant_id = CAST(:tenant_id AS uuid)
                """),
                {"tenant_id": tenant_id, "business_id": business_id},
            )
            delta_row = row.one()
            recent_14 = int(delta_row.recent_14 or 0)
            prev_14 = int(delta_row.prev_14 or 0)
            if prev_14 > 0:
                tickets_delta_14d = round((recent_14 - prev_14) / prev_14 * 100, 1)
            elif recent_14 > 0:
                tickets_delta_14d = 100.0  # 직전 14일 0건 → 신규 발생
            else:
                tickets_delta_14d = None

            # ── 10. ticket_breakdown (유형별 건수) ────────────────────────────
            row = await session.execute(
                text("""
                    SELECT
                        COUNT(*) FILTER (WHERE t.request_type = 'incident')   AS incident_cnt,
                        COUNT(*) FILTER (WHERE t.request_type = 'install')    AS install_cnt,
                        COUNT(*) FILTER (WHERE t.request_type = 'retention')  AS retention_cnt,
                        COUNT(*) FILTER (WHERE t.request_type NOT IN ('incident','install','retention')
                                           OR t.request_type IS NULL)         AS other_cnt
                    FROM tickets t
                    JOIN contracts c ON c.id = t.contract_id
                    WHERE c.linked_business_id = CAST(:business_id AS uuid)
                      AND t.tenant_id = CAST(:tenant_id AS uuid)
                """),
                {"tenant_id": tenant_id, "business_id": business_id},
            )
            bd_row = row.one()
            ticket_breakdown = {
                "incident": int(bd_row.incident_cnt or 0),
                "install": int(bd_row.install_cnt or 0),
                "retention": int(bd_row.retention_cnt or 0),
                "other": int(bd_row.other_cnt or 0),
            }
            retention_ticket_count = ticket_breakdown["retention"]

        # ── 해석 레이어 계산 (DB 세션 외부) ─────────────────────────────────
        retention_risk_score = compute_retention_risk(
            csat_score=csat_score,
            sla_compliance_rate=sla_compliance_rate,
            open_tickets=open_tickets,
            total_tickets=total_tickets,
            retention_ticket_count=retention_ticket_count,
            contract_expire_days=contract_expire_days,
        )
        risk_band = compute_risk_band(
            retention_score=retention_risk_score,
            sla_compliance_rate=sla_compliance_rate,
            csat_score=csat_score,
        )

        # top_anomaly: 가장 심각한 이상 신호 1줄
        top_anomaly = _build_top_anomaly(
            risk_band=risk_band,
            tickets_delta_14d=tickets_delta_14d,
            sla_compliance_rate=sla_compliance_rate,
            csat_score=csat_score,
            engineer_concentration=engineer_concentration,
            contract_expire_days=contract_expire_days,
        )

        action_hints = compute_action_hints(
            risk_band=risk_band,
            contract_expire_days=contract_expire_days,
            engineer_concentration=engineer_concentration,
            csat_score=csat_score,
            retention_risk_score=retention_risk_score,
        )

        # ── P&L 계산 (BIZCARD-C) ──────────────────────────────────────────────
        labor_rates = await fetch_labor_rates(tenant_id)
        pl = await compute_pl(
            user_hours=user_hours_list,
            labor_rates=labor_rates,
            contract_value=contract_value,
            days_remaining=contract_expire_days,
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
            # 신규 해석 레이어
            risk_band=risk_band,
            top_anomaly=top_anomaly,
            tickets_delta_14d=tickets_delta_14d,
            engineer_concentration=engineer_concentration,
            ticket_breakdown=ticket_breakdown,
            retention_risk_score=retention_risk_score,
            action_hints=action_hints if action_hints else None,
            user_hours=user_hours_list if user_hours_list else None,
            # P&L (BIZCARD-C)
            actual_cost=pl["actual_cost"],
            actual_margin_rate=pl["actual_margin_rate"],
            projected_total_cost=pl["projected_total_cost"],
            burn_rate_alert=pl["burn_rate_alert"],
            contract_value=pl["contract_value"],
        )

    except Exception:
        logger.exception(
            "KPI 집계 실패: tenant_id=%s business_id=%s", tenant_id, business_id
        )
        return None


def _build_top_anomaly(
    risk_band: str,
    tickets_delta_14d: float | None,
    sla_compliance_rate: float,
    csat_score: float | None,
    engineer_concentration: float | None,
    contract_expire_days: int | None,
) -> dict | None:
    """가장 심각한 이상 신호 1개를 {type, message, since} 형태로 반환."""
    if risk_band == "healthy":
        return None

    candidates = []
    if tickets_delta_14d is not None and tickets_delta_14d > 50:
        candidates.append((tickets_delta_14d, {
            "type": "ticket_surge",
            "message": f"최근 14일 티켓 발생 +{tickets_delta_14d:.0f}% 급증",
            "since": "14일",
        }))
    if sla_compliance_rate < 0.80:
        candidates.append(((1 - sla_compliance_rate) * 100, {
            "type": "sla_breach",
            "message": f"SLA 준수율 {sla_compliance_rate*100:.0f}% (목표 90% 미달)",
            "since": "이번 달",
        }))
    if csat_score is not None and csat_score < 3.0:
        candidates.append(((3.0 - csat_score) * 20, {
            "type": "csat_low",
            "message": f"고객 만족도 ★{csat_score:.1f} (기준 3.0 미달)",
            "since": "최근 설문",
        }))
    if engineer_concentration is not None and engineer_concentration > 0.70:
        candidates.append((engineer_concentration * 50, {
            "type": "engineer_concentration",
            "message": f"담당 엔지니어 1인 공수 집중 {engineer_concentration*100:.0f}%",
            "since": "이번 달",
        }))
    if contract_expire_days is not None and contract_expire_days <= 30:
        candidates.append(((30 - contract_expire_days) * 2, {
            "type": "contract_expiring",
            "message": f"계약 만료 D-{contract_expire_days}",
            "since": f"{contract_expire_days}일 후",
        }))

    if not candidates:
        return None
    candidates.sort(key=lambda x: x[0], reverse=True)
    return candidates[0][1]


# ──────────────────────────────────────────────────────────────────────────────
# SA push
# ──────────────────────────────────────────────────────────────────────────────

async def push_to_sa(business_id: str, kpi: ItsmKpiPayload) -> bool:
    """SA /api/itsm-bridge/businesses/{business_id}/kpi 로 PATCH."""
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
                "KPI push 성공: business_id=%s total=%d sla=%.3f risk=%s",
                business_id, kpi.total_tickets, kpi.sla_compliance_rate, kpi.risk_band,
            )
            return True
        else:
            logger.warning(
                "KPI push 실패: business_id=%s status=%d body=%s",
                business_id, resp.status_code, resp.text[:200],
            )
            return False

    except Exception:
        logger.exception("KPI push 예외: business_id=%s url=%s", business_id, url)
        return False
