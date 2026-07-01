"""반복 장애 감지 라우터.

prefix : /{tenant_slug}/recurring-alerts
인증   : get_current_user
격리   : tenant_id 필터

엔드포인트:
  GET  /{tenant_slug}/recurring-alerts                            — 미인지 알림 목록
  POST /{tenant_slug}/recurring-alerts/{id}/acknowledge           — 인지 처리
  POST /{tenant_slug}/recurring-alerts/{id}/create-problem        — Problem 생성 트리거 (CA-P2-4)
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models import User
from app.models.recurring_alert import RecurringAlert
from app.models.problem import Problem
from app.routers.problems import (
    ProblemOut,
    _generate_problem_number,
    _link_tickets_bulk,
)

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/{tenant_slug}/recurring-alerts",
    tags=["recurring_alerts"],
)


# ------------------------------------------------------------------
# 스키마
# ------------------------------------------------------------------


class RecurringAlertOut(BaseModel):
    id: uuid.UUID
    customer_id: uuid.UUID | None
    symptom_category_id: uuid.UUID | None
    trigger_ticket_ids: list[uuid.UUID]
    occurrence_count: int
    detected_at: datetime
    is_acknowledged: bool

    model_config = {"from_attributes": True}


# ------------------------------------------------------------------
# 엔드포인트
# ------------------------------------------------------------------


@router.get(
    "",
    response_model=dict,
    summary="미인지 반복 장애 알림 목록",
)
async def list_recurring_alerts(
    tenant_slug: str,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> dict:
    where_clause = and_(
        RecurringAlert.tenant_id == current_user.tenant_id,
        RecurringAlert.is_acknowledged.is_(False),
    )
    total = await db.scalar(
        select(func.count()).select_from(RecurringAlert).where(where_clause)
    )
    rows = (
        await db.execute(
            select(RecurringAlert)
            .where(where_clause)
            .order_by(RecurringAlert.detected_at.desc())
        )
    ).scalars().all()
    return {"items": [RecurringAlertOut.model_validate(r) for r in rows], "total": total}


@router.post(
    "/{alert_id}/acknowledge",
    response_model=RecurringAlertOut,
    summary="반복 장애 알림 인지 처리",
)
async def acknowledge_alert(
    tenant_slug: str,
    alert_id: uuid.UUID,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> RecurringAlertOut:
    alert = await db.scalar(
        select(RecurringAlert).where(
            and_(
                RecurringAlert.id == alert_id,
                RecurringAlert.tenant_id == current_user.tenant_id,
            )
        )
    )
    if alert is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="알림을 찾을 수 없습니다.")

    alert.is_acknowledged = True
    alert.acknowledged_by = current_user.id
    alert.acknowledged_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(alert)
    return RecurringAlertOut.model_validate(alert)


@router.post(
    "/{alert_id}/create-problem",
    response_model=ProblemOut,
    status_code=status.HTTP_201_CREATED,
    summary="반복 장애 알림에서 Problem 생성 (멱등 — 이미 존재하면 기존 반환)",
)
async def create_problem_from_alert(
    tenant_slug: str,
    alert_id: uuid.UUID,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> ProblemOut:
    """recurring_alert → Problem 트리거 (CA-P2-4).

    처리 흐름:
    1. alert 조회 (tenant 격리)
    2. 멱등 체크 — source_recurring_alert_id == alert.id 인 Problem 이미 존재하면 기존 반환
    3. Problem 생성 (title=증상카테고리/요약, status='investigating')
    4. alert.trigger_ticket_ids → problem_tickets 일괄 링크 (helpers 재사용)
    5. alert.is_acknowledged = True

    헬퍼 재사용: _generate_problem_number, _link_tickets_bulk (problems.py)
    """
    # 1. alert 조회 (tenant 격리)
    alert = await db.scalar(
        select(RecurringAlert).where(
            and_(
                RecurringAlert.id == alert_id,
                RecurringAlert.tenant_id == current_user.tenant_id,
            )
        )
    )
    if alert is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="알림을 찾을 수 없습니다.")

    # 2. 멱등 체크 — 이미 Problem이 생성되어 있으면 기존 반환
    existing_problem = await db.scalar(
        select(Problem).where(
            and_(
                Problem.tenant_id == current_user.tenant_id,
                Problem.source_recurring_alert_id == alert_id,
            )
        )
    )
    if existing_problem is not None:
        return ProblemOut.model_validate(existing_problem)

    # 3. Problem 생성 — problems router helper 재사용
    problem_number = await _generate_problem_number(db, current_user.tenant_id)
    title = f"반복 장애 (발생 {alert.occurrence_count}회)"

    problem = Problem(
        tenant_id=current_user.tenant_id,
        problem_number=problem_number,
        title=title,
        status="investigating",
        source_recurring_alert_id=alert.id,
        created_by=current_user.id,
    )
    db.add(problem)
    await db.flush()  # problem.id 확보 (commit 전)

    # 4. trigger_ticket_ids → problem_tickets 일괄 링크 (helper 재사용)
    ticket_ids = [uuid.UUID(str(tid)) for tid in (alert.trigger_ticket_ids or [])]
    await _link_tickets_bulk(db, current_user.tenant_id, problem.id, ticket_ids)

    # 5. alert 인지 처리
    alert.is_acknowledged = True
    alert.acknowledged_by = current_user.id
    alert.acknowledged_at = datetime.now(timezone.utc)

    await db.commit()
    await db.refresh(problem)
    return ProblemOut.model_validate(problem)
