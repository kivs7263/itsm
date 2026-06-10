"""ITSM 캘린더 이벤트 라우터.

현장방문·원격지원·내부일정 이벤트 CRUD + calendar-service push.

prefix : /{tenant_slug}/calendar
인증   : get_current_user (일반 JWT)
격리   : 모든 쿼리에 tenant_id == current_user.tenant_id 조건 필수

push 정책:
  - 생성/수정 시 calendar-service에 push 시도
  - push 실패해도 ITSM 이벤트 저장은 성공 처리 (graceful fallback)
  - CALENDAR_SERVICE_URL 미설정 시 push 자동 스킵
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models.calendar_event import CalendarEvent
from app.models.user import User
from app.services import calendar_push_service

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/{tenant_slug}/calendar",
    tags=["calendar"],
)


# ------------------------------------------------------------------
# 스키마
# ------------------------------------------------------------------


class CalendarEventCreate(BaseModel):
    title: str = Field(..., max_length=300)
    event_type: Literal["visit", "remote", "internal"] = "internal"
    start_at: datetime
    end_at: datetime | None = None
    is_all_day: bool = False
    ticket_id: uuid.UUID | None = None
    assignee_id: uuid.UUID | None = None
    description: str | None = Field(None, max_length=1000)
    organization_id: uuid.UUID | None = None  # calendar-service 전달용


class CalendarEventUpdate(BaseModel):
    title: str | None = Field(None, max_length=300)
    event_type: Literal["visit", "remote", "internal"] | None = None
    start_at: datetime | None = None
    end_at: datetime | None = None
    is_all_day: bool | None = None
    ticket_id: uuid.UUID | None = None
    assignee_id: uuid.UUID | None = None
    description: str | None = Field(None, max_length=1000)
    organization_id: uuid.UUID | None = None


class CalendarEventResponse(BaseModel):
    id: uuid.UUID
    tenant_id: uuid.UUID
    title: str
    event_type: str
    start_at: datetime
    end_at: datetime | None
    is_all_day: bool
    ticket_id: uuid.UUID | None
    assignee_id: uuid.UUID | None
    description: str | None
    organization_id: uuid.UUID | None
    cal_event_id: uuid.UUID | None  # calendar-service에서 발급한 이벤트 ID
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ------------------------------------------------------------------
# 엔드포인트
# ------------------------------------------------------------------


@router.post(
    "",
    response_model=CalendarEventResponse,
    status_code=status.HTTP_201_CREATED,
    summary="캘린더 이벤트 생성 + calendar-service push",
)
async def create_calendar_event(
    tenant_slug: str,
    data: CalendarEventCreate,
    current_user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
) -> CalendarEventResponse:
    event = CalendarEvent(
        id=uuid.uuid4(),
        tenant_id=current_user.tenant_id,
        ticket_id=data.ticket_id,
        title=data.title,
        event_type=data.event_type,
        start_at=data.start_at,
        end_at=data.end_at,
        is_all_day=data.is_all_day,
        assignee_id=data.assignee_id,
        description=data.description,
        organization_id=data.organization_id,
    )
    db.add(event)
    await db.flush()  # id 확보 (calendar push에서 event.id 사용)

    # calendar-service push (실패해도 ITSM 저장 성공)
    cal_event_id = await calendar_push_service.push_event(event)
    if cal_event_id:
        event.cal_event_id = cal_event_id

    await db.commit()
    await db.refresh(event)
    return CalendarEventResponse.model_validate(event)


@router.get(
    "",
    response_model=list[CalendarEventResponse],
    summary="캘린더 이벤트 목록 (월/주 필터)",
)
async def list_calendar_events(
    tenant_slug: str,
    year: int | None = Query(None, ge=2000, le=2100, description="연도 (월 필터와 함께 사용)"),
    month: int | None = Query(None, ge=1, le=12, description="월 (1~12)"),
    from_date: datetime | None = Query(None, description="조회 시작 일시 (ISO 8601)"),
    to_date: datetime | None = Query(None, description="조회 종료 일시 (ISO 8601)"),
    event_type: str | None = Query(None, description="이벤트 유형 필터: visit | remote | internal"),
    ticket_id: uuid.UUID | None = Query(None, description="티켓 ID 필터"),
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> list[CalendarEventResponse]:
    filters = [CalendarEvent.tenant_id == current_user.tenant_id]

    if event_type:
        filters.append(CalendarEvent.event_type == event_type)
    if ticket_id:
        filters.append(CalendarEvent.ticket_id == ticket_id)

    # 월 범위 필터 (year+month 우선, 없으면 from_date~to_date)
    if year and month:
        from calendar import monthrange
        from datetime import timezone

        _, last_day = monthrange(year, month)
        month_start = datetime(year, month, 1, tzinfo=timezone.utc)
        month_end = datetime(year, month, last_day, 23, 59, 59, tzinfo=timezone.utc)
        filters.append(CalendarEvent.start_at >= month_start)
        filters.append(CalendarEvent.start_at <= month_end)
    else:
        if from_date:
            filters.append(CalendarEvent.start_at >= from_date)
        if to_date:
            filters.append(CalendarEvent.start_at <= to_date)

    stmt = (
        select(CalendarEvent)
        .where(and_(*filters))
        .order_by(CalendarEvent.start_at)
    )
    result = await db.execute(stmt)
    events = result.scalars().all()
    return [CalendarEventResponse.model_validate(e) for e in events]


@router.get(
    "/{event_id}",
    response_model=CalendarEventResponse,
    summary="캘린더 이벤트 단일 조회",
)
async def get_calendar_event(
    tenant_slug: str,
    event_id: uuid.UUID,
    current_user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
) -> CalendarEventResponse:
    event = await _get_event_or_404(db, event_id, current_user.tenant_id)
    return CalendarEventResponse.model_validate(event)


@router.patch(
    "/{event_id}",
    response_model=CalendarEventResponse,
    summary="캘린더 이벤트 수정 + calendar-service upsert",
)
async def update_calendar_event(
    tenant_slug: str,
    event_id: uuid.UUID,
    data: CalendarEventUpdate,
    current_user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
) -> CalendarEventResponse:
    event = await _get_event_or_404(db, event_id, current_user.tenant_id)

    # 변경된 필드만 적용
    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(event, field, value)

    await db.flush()

    # calendar-service upsert (실패해도 ITSM 저장 성공)
    cal_event_id = await calendar_push_service.push_event(event)
    if cal_event_id:
        event.cal_event_id = cal_event_id

    await db.commit()
    await db.refresh(event)
    return CalendarEventResponse.model_validate(event)


@router.delete(
    "/{event_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="캘린더 이벤트 삭제 + calendar-service delete",
)
async def delete_calendar_event(
    tenant_slug: str,
    event_id: uuid.UUID,
    current_user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
) -> None:
    event = await _get_event_or_404(db, event_id, current_user.tenant_id)

    # calendar-service 이벤트 삭제 (실패해도 ITSM 삭제 진행)
    if event.cal_event_id and event.organization_id:
        await calendar_push_service.delete_event(
            cal_event_id=event.cal_event_id,
            organization_id=event.organization_id,
        )

    await db.delete(event)
    await db.commit()


# ------------------------------------------------------------------
# 내부 헬퍼
# ------------------------------------------------------------------


async def _get_event_or_404(
    db: AsyncSession,
    event_id: uuid.UUID,
    tenant_id: uuid.UUID,
) -> CalendarEvent:
    """tenant_id 격리 포함 단건 조회. 미존재·크로스 테넌트 모두 404."""
    stmt = select(CalendarEvent).where(
        and_(
            CalendarEvent.id == event_id,
            CalendarEvent.tenant_id == tenant_id,  # 크로스 테넌트 차단 → 404
        )
    )
    result = await db.execute(stmt)
    event = result.scalar_one_or_none()
    if event is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="캘린더 이벤트를 찾을 수 없습니다.",
        )
    return event
