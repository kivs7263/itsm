"""Problem Management 라우터 (CA-P2-4).

prefix : /{tenant_slug}/problems
인증   : get_current_user
격리   : 모든 쿼리 tenant_id == current_user.tenant_id (명시 필터)

엔드포인트:
  GET    /{tenant_slug}/problems                           — 목록 (status·is_known_error 필터)
  GET    /{tenant_slug}/problems/known-errors              — Known Error DB (is_known_error+workaround)
  GET    /{tenant_slug}/problems/{id}                      — 상세 (linked tickets 포함)
  POST   /{tenant_slug}/problems                           — 생성 (PRB-YYYYMMDD-NNNN 발번)
  PATCH  /{tenant_slug}/problems/{id}                      — 수정 (status 전이 사이드이펙트)
  DELETE /{tenant_slug}/problems/{id}                      — 삭제
  POST   /{tenant_slug}/problems/{id}/tickets              — 인시던트 링크 (멱등)
  DELETE /{tenant_slug}/problems/{id}/tickets/{ticket_id}  — 인시던트 언링크

주의:
- /known-errors는 /{problem_id} 보다 먼저 등록 (경로 충돌 방지).
- status='known_error' → is_known_error=True 자동 설정.
- status in ('resolved','closed') → resolved_at=now() 자동 설정.
- _generate_problem_number, _link_tickets_bulk : recurring_alerts.py에서 재사용.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import and_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models import User
from app.models.problem import Problem, ProblemTicket

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/{tenant_slug}/problems",
    tags=["problems"],
)

_VALID_STATUSES = frozenset({"new", "investigating", "known_error", "resolved", "closed"})


# ──────────────────────────────────────────────────────────────────────────────
# 스키마
# ──────────────────────────────────────────────────────────────────────────────


class ProblemCreate(BaseModel):
    title: str = Field(..., max_length=500)
    description: str | None = None
    priority: str = "medium"
    assigned_to: uuid.UUID | None = None
    source_recurring_alert_id: uuid.UUID | None = None


class ProblemUpdate(BaseModel):
    title: str | None = Field(None, max_length=500)
    description: str | None = None
    status: str | None = None
    priority: str | None = None
    root_cause: str | None = None
    workaround: str | None = None
    assigned_to: uuid.UUID | None = None


class AssigneeOut(BaseModel):
    id: uuid.UUID
    name: str
    email: str


class TicketLinkRequest(BaseModel):
    ticket_id: uuid.UUID


class LinkedTicketOut(BaseModel):
    ticket_id: uuid.UUID
    linked_at: datetime

    model_config = {"from_attributes": True}


class ProblemOut(BaseModel):
    id: uuid.UUID
    tenant_id: uuid.UUID
    problem_number: str | None
    title: str
    description: str | None
    status: str
    priority: str
    root_cause: str | None
    workaround: str | None
    is_known_error: bool
    source_recurring_alert_id: uuid.UUID | None
    assigned_to: uuid.UUID | None
    created_by: uuid.UUID | None
    resolved_at: datetime | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ProblemDetailOut(ProblemOut):
    linked_tickets: list[LinkedTicketOut] = []


# ──────────────────────────────────────────────────────────────────────────────
# 공유 헬퍼 (recurring_alerts.py 에서 import하여 재사용)
# ──────────────────────────────────────────────────────────────────────────────


async def _generate_problem_number(db: AsyncSession, tenant_id: uuid.UUID) -> str:
    """PRB-YYYYMMDD-NNNN 형식 problem_number 생성.

    pg_advisory_xact_lock으로 (tenant, date) 단위 직렬화 — 동시 생성 시 중복 방지.
    ticket_number 발번 로직(_generate_ticket_number)과 동일 패턴.
    """
    today = datetime.now(timezone.utc).strftime("%Y%m%d")
    prefix = f"PRB-{today}-"
    # advisory lock key: prb: 접두어로 ticket lock과 키 공간 분리
    lock_key = abs(hash(f"prb:{tenant_id}:{today}")) % (2 ** 31)
    await db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": lock_key})

    result = await db.execute(
        text("""
            SELECT COALESCE(
                MAX(CAST(SUBSTRING(problem_number FROM :prefix_len + 1) AS INTEGER)),
                0
            )
            FROM problems
            WHERE tenant_id = :tid
              AND problem_number LIKE :prefix
        """),
        {"prefix_len": len(prefix), "prefix": f"{prefix}%", "tid": str(tenant_id)},
    )
    max_seq = result.scalar() or 0
    return f"{prefix}{str(max_seq + 1).zfill(4)}"


async def _get_problem_or_404(
    db: AsyncSession, tenant_id: uuid.UUID, problem_id: uuid.UUID
) -> Problem:
    """tenant 격리 포함 Problem 조회, 없으면 404."""
    row = await db.scalar(
        select(Problem).where(
            and_(Problem.id == problem_id, Problem.tenant_id == tenant_id)
        )
    )
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Problem을 찾을 수 없습니다.")
    return row


async def _link_tickets_bulk(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    problem_id: uuid.UUID,
    ticket_ids: list[uuid.UUID],
) -> None:
    """여러 ticket_id를 Problem에 일괄 링크 (멱등 — 이미 존재하면 건너뜀).

    recurring_alerts.py 트리거 엔드포인트에서 재사용.
    """
    for tid in ticket_ids:
        existing = await db.scalar(
            select(ProblemTicket).where(
                and_(
                    ProblemTicket.problem_id == problem_id,
                    ProblemTicket.ticket_id == tid,
                )
            )
        )
        if existing is None:
            db.add(
                ProblemTicket(
                    tenant_id=tenant_id,
                    problem_id=problem_id,
                    ticket_id=tid,
                )
            )


async def _fetch_linked_tickets(
    db: AsyncSession, problem_id: uuid.UUID
) -> list[LinkedTicketOut]:
    rows = (
        await db.execute(
            select(ProblemTicket)
            .where(ProblemTicket.problem_id == problem_id)
            .order_by(ProblemTicket.linked_at)
        )
    ).scalars().all()
    return [LinkedTicketOut.model_validate(r) for r in rows]


# ──────────────────────────────────────────────────────────────────────────────
# 엔드포인트
# ──────────────────────────────────────────────────────────────────────────────


# ⚠️ /known-errors, /assignees 는 /{problem_id} 보다 먼저 등록해야 경로 충돌 없음.
@router.get(
    "/assignees",
    response_model=list[AssigneeOut],
    summary="Problem 담당자 후보 목록 (활성 테넌트 멤버)",
)
async def list_assignees(
    tenant_slug: str,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> list[AssigneeOut]:
    rows = (
        await db.execute(
            select(User)
            .where(
                and_(
                    User.tenant_id == current_user.tenant_id,
                    User.is_active.is_(True),
                )
            )
            .order_by(User.name)
        )
    ).scalars().all()
    return [AssigneeOut(id=u.id, name=u.name, email=u.email) for u in rows]


@router.get(
    "/known-errors",
    response_model=list[ProblemOut],
    summary="Known Error DB (workaround 있는 알려진 오류 목록)",
)
async def list_known_errors(
    tenant_slug: str,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> list[ProblemOut]:
    rows = (
        await db.execute(
            select(Problem)
            .where(
                and_(
                    Problem.tenant_id == current_user.tenant_id,
                    Problem.is_known_error.is_(True),
                    Problem.workaround.isnot(None),
                )
            )
            .order_by(Problem.updated_at.desc())
        )
    ).scalars().all()
    return [ProblemOut.model_validate(r) for r in rows]


@router.get(
    "",
    response_model=list[ProblemOut],
    summary="Problem 목록 (status·is_known_error 필터)",
)
async def list_problems(
    tenant_slug: str,
    status_filter: str | None = Query(None, alias="status"),
    is_known_error: bool | None = Query(None),
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> list[ProblemOut]:
    conditions = [Problem.tenant_id == current_user.tenant_id]
    if status_filter:
        conditions.append(Problem.status == status_filter)
    if is_known_error is not None:
        conditions.append(Problem.is_known_error.is_(is_known_error))

    rows = (
        await db.execute(
            select(Problem)
            .where(and_(*conditions))
            .order_by(Problem.created_at.desc())
        )
    ).scalars().all()
    return [ProblemOut.model_validate(r) for r in rows]


@router.get(
    "/{problem_id}",
    response_model=ProblemDetailOut,
    summary="Problem 상세 (linked tickets 포함)",
)
async def get_problem(
    tenant_slug: str,
    problem_id: uuid.UUID,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> ProblemDetailOut:
    problem = await _get_problem_or_404(db, current_user.tenant_id, problem_id)
    linked = await _fetch_linked_tickets(db, problem.id)
    return ProblemDetailOut(
        **ProblemOut.model_validate(problem).model_dump(),
        linked_tickets=linked,
    )


@router.post(
    "",
    response_model=ProblemOut,
    status_code=status.HTTP_201_CREATED,
    summary="Problem 생성 (PRB-YYYYMMDD-NNNN 발번)",
)
async def create_problem(
    tenant_slug: str,
    body: ProblemCreate,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> ProblemOut:
    if body.priority not in {"low", "medium", "high", "critical"}:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="priority는 low/medium/high/critical 중 하나여야 합니다.",
        )

    problem_number = await _generate_problem_number(db, current_user.tenant_id)
    problem = Problem(
        tenant_id=current_user.tenant_id,
        problem_number=problem_number,
        title=body.title,
        description=body.description,
        priority=body.priority,
        assigned_to=body.assigned_to,
        source_recurring_alert_id=body.source_recurring_alert_id,
        created_by=current_user.id,
        status="new",
    )
    db.add(problem)
    await db.commit()
    await db.refresh(problem)
    return ProblemOut.model_validate(problem)


@router.patch(
    "/{problem_id}",
    response_model=ProblemOut,
    summary="Problem 수정 (status 전이 사이드이펙트 포함)",
)
async def update_problem(
    tenant_slug: str,
    problem_id: uuid.UUID,
    body: ProblemUpdate,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> ProblemOut:
    problem = await _get_problem_or_404(db, current_user.tenant_id, problem_id)

    if body.title is not None:
        problem.title = body.title
    if body.description is not None:
        problem.description = body.description
    if body.priority is not None:
        if body.priority not in {"low", "medium", "high", "critical"}:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="priority는 low/medium/high/critical 중 하나여야 합니다.",
            )
        problem.priority = body.priority
    if body.root_cause is not None:
        problem.root_cause = body.root_cause
    if body.workaround is not None:
        problem.workaround = body.workaround
    if "assigned_to" in body.model_fields_set:
        problem.assigned_to = body.assigned_to

    # status 전이 — 사이드이펙트
    if body.status is not None:
        if body.status not in _VALID_STATUSES:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"status는 {sorted(_VALID_STATUSES)} 중 하나여야 합니다.",
            )
        problem.status = body.status
        # known_error 전이 → is_known_error=True
        if body.status == "known_error":
            problem.is_known_error = True
        # resolved/closed → resolved_at 기록 (아직 없을 때만)
        if body.status in {"resolved", "closed"}:
            if problem.resolved_at is None:
                problem.resolved_at = datetime.now(timezone.utc)

    problem.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(problem)
    return ProblemOut.model_validate(problem)


@router.delete(
    "/{problem_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Problem 삭제",
)
async def delete_problem(
    tenant_slug: str,
    problem_id: uuid.UUID,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> None:
    problem = await _get_problem_or_404(db, current_user.tenant_id, problem_id)
    await db.delete(problem)
    await db.commit()


@router.post(
    "/{problem_id}/tickets",
    response_model=LinkedTicketOut,
    status_code=status.HTTP_201_CREATED,
    summary="인시던트(Ticket) 링크 (멱등 — 이미 존재하면 기존 반환)",
)
async def link_ticket(
    tenant_slug: str,
    problem_id: uuid.UUID,
    body: TicketLinkRequest,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> LinkedTicketOut:
    problem = await _get_problem_or_404(db, current_user.tenant_id, problem_id)

    # 멱등: 이미 링크 존재하면 기존 반환
    existing = await db.scalar(
        select(ProblemTicket).where(
            and_(
                ProblemTicket.problem_id == problem.id,
                ProblemTicket.ticket_id == body.ticket_id,
            )
        )
    )
    if existing:
        return LinkedTicketOut.model_validate(existing)

    link = ProblemTicket(
        tenant_id=current_user.tenant_id,
        problem_id=problem.id,
        ticket_id=body.ticket_id,
    )
    db.add(link)
    await db.commit()
    await db.refresh(link)
    return LinkedTicketOut.model_validate(link)


@router.delete(
    "/{problem_id}/tickets/{ticket_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="인시던트 링크 해제",
)
async def unlink_ticket(
    tenant_slug: str,
    problem_id: uuid.UUID,
    ticket_id: uuid.UUID,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> None:
    # problem tenant 격리 확인
    await _get_problem_or_404(db, current_user.tenant_id, problem_id)

    link = await db.scalar(
        select(ProblemTicket).where(
            and_(
                ProblemTicket.problem_id == problem_id,
                ProblemTicket.ticket_id == ticket_id,
            )
        )
    )
    if link is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="링크를 찾을 수 없습니다.",
        )
    await db.delete(link)
    await db.commit()
