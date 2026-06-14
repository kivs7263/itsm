"""반복 장애 감지 라우터.

prefix : /{tenant_slug}/recurring-alerts
인증   : get_current_user
격리   : tenant_id 필터

엔드포인트:
  GET  /{tenant_slug}/recurring-alerts              — 미인지 알림 목록
  POST /{tenant_slug}/recurring-alerts/{id}/acknowledge — 인지 처리
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models import User
from app.models.recurring_alert import RecurringAlert

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
    response_model=list[RecurringAlertOut],
    summary="미인지 반복 장애 알림 목록",
)
async def list_recurring_alerts(
    tenant_slug: str,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> list[RecurringAlertOut]:
    rows = (
        await db.execute(
            select(RecurringAlert)
            .where(
                and_(
                    RecurringAlert.tenant_id == current_user.tenant_id,
                    RecurringAlert.is_acknowledged.is_(False),
                )
            )
            .order_by(RecurringAlert.detected_at.desc())
        )
    ).scalars().all()
    return [RecurringAlertOut.model_validate(r) for r in rows]


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
