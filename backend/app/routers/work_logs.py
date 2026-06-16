"""공수 추적 라우터.

prefix: /{tenant_slug}/tickets/{ticket_id}/work-logs  (티켓별)
        /{tenant_slug}/work-logs                       (집계/타이머)

인증: get_current_user (JWT HttpOnly 쿠키)
격리: 모든 쿼리 tenant_id == current_user.tenant_id

엔드포인트:
  POST   /{slug}/tickets/{id}/work-logs          — 수동 공수 입력
  GET    /{slug}/tickets/{id}/work-logs          — 티켓별 공수 목록
  DELETE /{slug}/tickets/{id}/work-logs/{log_id} — 본인 공수 삭제

  POST   /{slug}/work-logs/timer/start           — 타이머 시작
  POST   /{slug}/work-logs/timer/stop            — 타이머 중지 → 자동 log 생성
  GET    /{slug}/work-logs/timer/active          — 현재 실행 중인 타이머

  GET    /{slug}/work-logs/summary               — 기간별 집계 (user/ticket/billable)
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import require_roles
from app.core.dependencies import get_current_user
from app.core.redis import get_redis
from app.models import Ticket, TicketWorkLog, User, UserRole, WorkType
from app.models.work_log import CompletionStatus
from app.models.contract import Contract

logger = logging.getLogger(__name__)

router = APIRouter(tags=["work-logs"])

TIMER_KEY = "itsm:work_timer:{tenant_id}:{user_id}"
_DIRTY_KEY_PREFIX = "itsm:kpi:dirty:"  # bridge_worker가 소비


async def _mark_kpi_dirty(db: AsyncSession, ticket_id: uuid.UUID, tenant_id) -> None:
    """티켓 연결 계약의 business_id에 dirty-flag 설정 (TTL 300s)."""
    try:
        result = await db.execute(
            select(Contract.linked_business_id)
            .where(
                Contract.tenant_id == tenant_id,
                Contract.linked_business_id.is_not(None),
            )
            .join(Ticket, Ticket.contract_id == Contract.id)
            .where(Ticket.id == ticket_id)
            .limit(1)
        )
        row = result.scalar_one_or_none()
        if row:
            redis = get_redis()
            await redis.setex(f"{_DIRTY_KEY_PREFIX}{row}", 300, "1")
    except Exception:
        pass  # dirty-flag 실패는 무시 — 60분 주기에서 처리됨


# ──────────────────────────────────────────────────────────────────────────────
# 스키마
# ──────────────────────────────────────────────────────────────────────────────

class WorkLogCreate(BaseModel):
    work_type: WorkType = WorkType.remote
    hours: float = Field(..., gt=0, le=999.99, description="0.25 단위 (15분)")
    billable: bool = True
    description: str | None = None
    completion_status: CompletionStatus = CompletionStatus.completed
    next_action: str | None = None
    memo: str | None = None
    started_at: datetime | None = None


class WorkLogStopBody(BaseModel):
    """타이머 중지 전용 — hours=0 이면 경과 시간 자동 계산."""
    work_type: WorkType = WorkType.remote
    hours: float = Field(0.0, ge=0, le=999.99)
    billable: bool = True
    description: str  # 수행한 내용 (필수)
    completion_status: CompletionStatus = CompletionStatus.completed
    next_action: str | None = None
    memo: str | None = None


class WorkLogOut(BaseModel):
    id: uuid.UUID
    ticket_id: uuid.UUID
    user_id: uuid.UUID | None
    user_name: str | None
    work_type: str
    hours: float
    billable: bool
    description: str | None
    completion_status: str | None
    next_action: str | None
    memo: str | None
    started_at: datetime | None
    logged_at: datetime

    model_config = {"from_attributes": True}


class WorkLogSummaryOut(BaseModel):
    total_hours: float
    billable_hours: float
    unbillable_hours: float
    billable_ratio: float  # 0.0~1.0
    log_count: int


class TimerActiveOut(BaseModel):
    active: bool
    ticket_id: uuid.UUID | None = None
    ticket_number: str | None = None
    ticket_title: str | None = None
    started_at: datetime | None = None
    elapsed_seconds: int | None = None


class ActiveTimerItem(BaseModel):
    user_id: uuid.UUID
    user_name: str | None
    ticket_id: uuid.UUID
    ticket_number: str | None
    ticket_title: str | None
    started_at: datetime
    elapsed_seconds: int


class WeeklyUserHours(BaseModel):
    user_id: uuid.UUID
    user_name: str | None
    total_hours: float
    billable_hours: float
    log_count: int


# ──────────────────────────────────────────────────────────────────────────────
# 티켓별 공수 CRUD
# ──────────────────────────────────────────────────────────────────────────────

@router.post(
    "/{tenant_slug}/tickets/{ticket_id}/work-logs",
    response_model=WorkLogOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_work_log(
    tenant_slug: str,
    ticket_id: uuid.UUID,
    body: WorkLogCreate,
    current_user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
):
    await _assert_ticket_access(db, ticket_id, current_user)

    log = TicketWorkLog(
        tenant_id=current_user.tenant_id,
        ticket_id=ticket_id,
        user_id=current_user.id,
        work_type=body.work_type.value,
        hours=Decimal(str(round(body.hours, 2))),
        billable=body.billable,
        description=body.description,
        completion_status=body.completion_status.value,
        next_action=body.next_action,
        memo=body.memo,
        started_at=body.started_at,
        logged_at=datetime.now(timezone.utc),
    )
    db.add(log)
    await db.commit()
    await db.refresh(log)
    await _mark_kpi_dirty(db, ticket_id, current_user.tenant_id)
    return _serialize(log, current_user)


@router.get(
    "/{tenant_slug}/tickets/{ticket_id}/work-logs",
    response_model=list[WorkLogOut],
)
async def list_work_logs(
    tenant_slug: str,
    ticket_id: uuid.UUID,
    current_user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
):
    await _assert_ticket_access(db, ticket_id, current_user)

    result = await db.execute(
        select(TicketWorkLog, User)
        .outerjoin(User, TicketWorkLog.user_id == User.id)
        .where(
            TicketWorkLog.tenant_id == current_user.tenant_id,
            TicketWorkLog.ticket_id == ticket_id,
        )
        .order_by(TicketWorkLog.logged_at.desc())
    )
    rows = result.all()
    return [_serialize(log, user) for log, user in rows]


@router.delete(
    "/{tenant_slug}/tickets/{ticket_id}/work-logs/{log_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_work_log(
    tenant_slug: str,
    ticket_id: uuid.UUID,
    log_id: uuid.UUID,
    current_user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(TicketWorkLog).where(
            TicketWorkLog.id == log_id,
            TicketWorkLog.ticket_id == ticket_id,
            TicketWorkLog.tenant_id == current_user.tenant_id,
        )
    )
    log = result.scalar_one_or_none()
    if log is None:
        raise HTTPException(status_code=404, detail="공수 기록을 찾을 수 없습니다.")

    # 본인 또는 admin/team_lead만 삭제
    if log.user_id != current_user.id and current_user.role not in (
        UserRole.admin, UserRole.team_lead
    ):
        raise HTTPException(status_code=403, detail="본인 공수 기록만 삭제할 수 있습니다.")

    await db.delete(log)
    await db.commit()


# ──────────────────────────────────────────────────────────────────────────────
# 타이머 (Redis 기반)
# ──────────────────────────────────────────────────────────────────────────────

@router.post("/{tenant_slug}/work-logs/timer/start")
async def timer_start(
    tenant_slug: str,
    ticket_id: uuid.UUID,
    current_user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
):
    await _assert_ticket_access(db, ticket_id, current_user)

    redis = get_redis()
    key = TIMER_KEY.format(
        tenant_id=current_user.tenant_id, user_id=current_user.id
    )
    existing = await redis.get(key)
    if existing:
        raise HTTPException(
            status_code=409,
            detail="이미 실행 중인 타이머가 있습니다. 먼저 중지하세요.",
        )

    now_iso = datetime.now(timezone.utc).isoformat()
    # 24h TTL — 자정 자동 만료 방지
    await redis.setex(key, 86400, f"{ticket_id}|{now_iso}")
    return {"started_at": now_iso, "ticket_id": str(ticket_id)}


@router.post("/{tenant_slug}/work-logs/timer/stop", response_model=WorkLogOut)
async def timer_stop(
    tenant_slug: str,
    body: WorkLogStopBody,
    current_user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
):
    redis = get_redis()
    key = TIMER_KEY.format(
        tenant_id=current_user.tenant_id, user_id=current_user.id
    )
    raw = await redis.get(key)
    if not raw:
        raise HTTPException(status_code=404, detail="실행 중인 타이머가 없습니다.")

    ticket_id_str, started_at_iso = raw.decode().split("|", 1)
    ticket_id = uuid.UUID(ticket_id_str)
    started_at = datetime.fromisoformat(started_at_iso)

    await redis.delete(key)

    # hours=0 이면 경과 시간 자동 계산, >0 이면 수동 오버라이드
    elapsed_seconds = (datetime.now(timezone.utc) - started_at).total_seconds()
    auto_hours = round(elapsed_seconds / 3600, 2)
    hours = body.hours if body.hours > 0 else auto_hours

    log = TicketWorkLog(
        tenant_id=current_user.tenant_id,
        ticket_id=ticket_id,
        user_id=current_user.id,
        work_type=body.work_type.value,
        hours=Decimal(str(max(0.25, hours))),
        billable=body.billable,
        description=body.description,
        completion_status=body.completion_status.value,
        next_action=body.next_action,
        memo=body.memo,
        started_at=started_at,
        logged_at=datetime.now(timezone.utc),
    )
    db.add(log)
    await db.commit()
    await db.refresh(log)
    await _mark_kpi_dirty(db, ticket_id, current_user.tenant_id)
    return _serialize(log, current_user)


@router.get("/{tenant_slug}/work-logs/timer/active", response_model=TimerActiveOut)
async def timer_active(
    tenant_slug: str,
    current_user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
):
    redis = get_redis()
    key = TIMER_KEY.format(
        tenant_id=current_user.tenant_id, user_id=current_user.id
    )
    raw = await redis.get(key)
    if not raw:
        return TimerActiveOut(active=False)

    ticket_id_str, started_at_iso = raw.decode().split("|", 1)
    ticket_id = uuid.UUID(ticket_id_str)
    started_at = datetime.fromisoformat(started_at_iso)
    elapsed = int((datetime.now(timezone.utc) - started_at).total_seconds())

    row = (await db.execute(
        select(Ticket.title, Ticket.ticket_number)
        .where(Ticket.id == ticket_id, Ticket.tenant_id == current_user.tenant_id)
    )).one_or_none()

    return TimerActiveOut(
        active=True,
        ticket_id=ticket_id,
        ticket_number=row.ticket_number if row else None,
        ticket_title=row.title if row else None,
        started_at=started_at,
        elapsed_seconds=elapsed,
    )


# ──────────────────────────────────────────────────────────────────────────────
# 집계 요약
# ──────────────────────────────────────────────────────────────────────────────

@router.get("/{tenant_slug}/work-logs/summary", response_model=WorkLogSummaryOut)
async def work_logs_summary(
    tenant_slug: str,
    current_user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
    ticket_id: uuid.UUID | None = Query(None),
    user_id: uuid.UUID | None = Query(None),
    since: datetime | None = Query(None),
    until: datetime | None = Query(None),
):
    filters = [TicketWorkLog.tenant_id == current_user.tenant_id]
    if ticket_id:
        filters.append(TicketWorkLog.ticket_id == ticket_id)
    if user_id:
        filters.append(TicketWorkLog.user_id == user_id)
    if since:
        filters.append(TicketWorkLog.logged_at >= since)
    if until:
        filters.append(TicketWorkLog.logged_at <= until)

    result = await db.execute(
        select(
            func.coalesce(func.sum(TicketWorkLog.hours), 0).label("total"),
            func.coalesce(
                func.sum(TicketWorkLog.hours).filter(TicketWorkLog.billable.is_(True)), 0
            ).label("billable"),
            func.count().label("cnt"),
        ).where(and_(*filters))
    )
    row = result.one()
    total = float(row.total)
    billable = float(row.billable)
    return WorkLogSummaryOut(
        total_hours=round(total, 2),
        billable_hours=round(billable, 2),
        unbillable_hours=round(total - billable, 2),
        billable_ratio=round(billable / total, 4) if total > 0 else 0.0,
        log_count=row.cnt,
    )


@router.get(
    "/{tenant_slug}/work-logs/active-timers",
    response_model=list[ActiveTimerItem],
    summary="팀 전체 active 타이머 목록 (team_lead+ 전용)",
)
async def list_active_timers(
    tenant_slug: str,
    current_user: Annotated[User, Depends(require_roles(UserRole.team_lead, UserRole.admin))] = None,
    db: AsyncSession = Depends(get_db),
) -> list[ActiveTimerItem]:
    redis = get_redis()
    pattern = TIMER_KEY.format(tenant_id=current_user.tenant_id, user_id="*")
    keys = await redis.keys(pattern)
    if not keys:
        return []

    results: list[ActiveTimerItem] = []
    now = datetime.now(timezone.utc)

    for key in keys:
        raw = await redis.get(key)
        if not raw:
            continue
        try:
            ticket_id_str, started_at_iso = raw.decode().split("|", 1)
            ticket_id = uuid.UUID(ticket_id_str)
            started_at = datetime.fromisoformat(started_at_iso)
        except Exception:
            continue

        user_id_str = key.decode().split(":")[-1]
        try:
            user_id = uuid.UUID(user_id_str)
        except Exception:
            continue

        user_row = (await db.execute(
            select(User.id, User.name).where(
                User.id == user_id,
                User.tenant_id == current_user.tenant_id,
            )
        )).one_or_none()

        ticket_row = (await db.execute(
            select(Ticket.title, Ticket.ticket_number).where(
                Ticket.id == ticket_id,
                Ticket.tenant_id == current_user.tenant_id,
            )
        )).one_or_none()

        elapsed = int((now - started_at).total_seconds())
        results.append(ActiveTimerItem(
            user_id=user_id,
            user_name=user_row.name if user_row else None,
            ticket_id=ticket_id,
            ticket_number=ticket_row.ticket_number if ticket_row else None,
            ticket_title=ticket_row.title if ticket_row else None,
            started_at=started_at,
            elapsed_seconds=max(0, elapsed),
        ))

    results.sort(key=lambda x: x.started_at)
    return results


@router.get(
    "/{tenant_slug}/work-logs/weekly-by-user",
    response_model=list[WeeklyUserHours],
    summary="주간 에이전트별 공수 집계 (team_lead+ 전용)",
)
async def weekly_hours_by_user(
    tenant_slug: str,
    current_user: Annotated[User, Depends(require_roles(UserRole.team_lead, UserRole.admin))] = None,
    db: AsyncSession = Depends(get_db),
    since: datetime | None = Query(None),
    until: datetime | None = Query(None),
) -> list[WeeklyUserHours]:
    from datetime import timedelta

    now = datetime.now(timezone.utc)
    if since is None:
        # 이번 주 월요일 00:00 UTC
        days_since_monday = now.weekday()
        since = (now - timedelta(days=days_since_monday)).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
    if until is None:
        until = now

    rows = (await db.execute(
        select(
            TicketWorkLog.user_id,
            func.coalesce(func.sum(TicketWorkLog.hours), 0).label("total"),
            func.coalesce(
                func.sum(TicketWorkLog.hours).filter(TicketWorkLog.billable.is_(True)), 0
            ).label("billable"),
            func.count().label("cnt"),
        )
        .where(
            TicketWorkLog.tenant_id == current_user.tenant_id,
            TicketWorkLog.logged_at >= since,
            TicketWorkLog.logged_at <= until,
            TicketWorkLog.user_id.isnot(None),
        )
        .group_by(TicketWorkLog.user_id)
        .order_by(func.sum(TicketWorkLog.hours).desc())
    )).all()

    # user_id → name 일괄 조회
    user_ids = [r.user_id for r in rows if r.user_id]
    names: dict[uuid.UUID, str | None] = {}
    if user_ids:
        user_rows = (await db.execute(
            select(User.id, User.name).where(
                User.id.in_(user_ids),
                User.tenant_id == current_user.tenant_id,
            )
        )).all()
        names = {ur.id: ur.name for ur in user_rows}

    return [
        WeeklyUserHours(
            user_id=r.user_id,
            user_name=names.get(r.user_id),
            total_hours=round(float(r.total), 2),
            billable_hours=round(float(r.billable), 2),
            log_count=r.cnt,
        )
        for r in rows
    ]


# ──────────────────────────────────────────────────────────────────────────────
# 헬퍼
# ──────────────────────────────────────────────────────────────────────────────

async def _assert_ticket_access(
    db: AsyncSession, ticket_id: uuid.UUID, current_user: User
) -> None:
    result = await db.execute(
        select(Ticket).where(
            Ticket.id == ticket_id,
            Ticket.tenant_id == current_user.tenant_id,
        )
    )
    if result.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="티켓을 찾을 수 없습니다.")


def _serialize(log: TicketWorkLog, user: User | None) -> WorkLogOut:
    return WorkLogOut(
        id=log.id,
        ticket_id=log.ticket_id,
        user_id=log.user_id,
        user_name=user.name if user else None,
        work_type=log.work_type,
        hours=float(log.hours),
        billable=log.billable,
        description=log.description,
        completion_status=log.completion_status,
        next_action=log.next_action,
        memo=log.memo,
        started_at=log.started_at,
        logged_at=log.logged_at,
    )
