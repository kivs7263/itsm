"""에스컬레이션 라우터.

prefix : /{tenant_slug}/tickets/{ticket_id}/escalations
         /{tenant_slug}/support-teams

인증   : get_current_user
격리   : 모든 쿼리 tenant_id == current_user.tenant_id

엔드포인트:
  POST   /{tenant_slug}/tickets/{id}/escalations              — 수동 에스컬레이션 (admin, team_lead)
  GET    /{tenant_slug}/tickets/{id}/escalations              — 이력 목록
  PATCH  /{tenant_slug}/tickets/{id}/escalations/{esc_id}/acknowledge — 인지 처리
  GET    /{tenant_slug}/support-teams                         — 팀 목록
  POST   /{tenant_slug}/support-teams                         — 팀 생성 (admin)
  PATCH  /{tenant_slug}/support-teams/{team_id}               — 팀 수정 (admin)
  POST   /{tenant_slug}/support-teams/{team_id}/members       — 팀원 추가 (admin)
  DELETE /{tenant_slug}/support-teams/{team_id}/members/{uid} — 팀원 제거 (admin)
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Annotated, Literal

import logging

from fastapi import APIRouter, Depends, HTTPException, Query, status

logger = logging.getLogger(__name__)
from pydantic import BaseModel, Field
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user, require_roles
from app.models import Ticket, User, UserRole
from app.models.escalation import (
    EscalationReason,
    SupportTeam,
    SupportTeamMember,
    TicketEscalation,
)
from app.services.external_notif_service import queue_notification, resolve_customer_email

esc_router = APIRouter(
    prefix="/{tenant_slug}/tickets/{ticket_id}/escalations",
    tags=["escalations"],
)
team_router = APIRouter(
    prefix="/{tenant_slug}/support-teams",
    tags=["support-teams"],
)

_ADMIN_ROLES = (UserRole.admin, UserRole.team_lead)

# ── Schemas ───────────────────────────────────────────────────────────────────


class EscalateRequest(BaseModel):
    to_team_id: uuid.UUID
    to_assigned: uuid.UUID | None = None
    reason: EscalationReason
    handover_memo: str = Field(..., min_length=10)
    customer_summary: str | None = Field(None, max_length=300)
    notify_channels: list[Literal["email", "kakao"]] = ["email"]


class EscalationOut(BaseModel):
    id: uuid.UUID
    ticket_id: uuid.UUID
    from_level: int
    to_level: int
    from_assigned: uuid.UUID | None
    to_team_id: uuid.UUID
    to_team_name: str | None
    to_assigned: uuid.UUID | None
    to_assigned_name: str | None
    reason: str
    handover_memo: str
    customer_summary: str | None
    triggered_by: uuid.UUID | None
    triggered_by_name: str | None
    acknowledged_at: datetime | None
    created_at: datetime

    class Config:
        from_attributes = True


class SupportTeamCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    level: int = Field(2, ge=1, le=3)
    description: str | None = None


class SupportTeamOut(BaseModel):
    id: uuid.UUID
    name: str
    level: int
    description: str | None
    is_active: bool
    member_count: int = 0
    created_at: datetime

    class Config:
        from_attributes = True


# ── Helpers ───────────────────────────────────────────────────────────────────


async def _get_ticket(
    tenant_id: uuid.UUID,
    ticket_id: uuid.UUID,
    db: AsyncSession,
) -> Ticket:
    row = await db.get(Ticket, ticket_id)
    if not row or row.tenant_id != tenant_id:
        raise HTTPException(status_code=404, detail="티켓을 찾을 수 없습니다.")
    return row


async def _get_team(
    tenant_id: uuid.UUID,
    team_id: uuid.UUID,
    db: AsyncSession,
) -> SupportTeam:
    row = await db.get(SupportTeam, team_id)
    if not row or row.tenant_id != tenant_id:
        raise HTTPException(status_code=404, detail="지원팀을 찾을 수 없습니다.")
    return row


async def _user_name(user_id: uuid.UUID | None, db: AsyncSession) -> str | None:
    if not user_id:
        return None
    u = await db.get(User, user_id)
    return u.name if u else None


async def _enrich_escalation(esc: TicketEscalation, db: AsyncSession) -> EscalationOut:
    team = await db.get(SupportTeam, esc.to_team_id)
    return EscalationOut(
        id=esc.id,
        ticket_id=esc.ticket_id,
        from_level=esc.from_level,
        to_level=esc.to_level,
        from_assigned=esc.from_assigned,
        to_team_id=esc.to_team_id,
        to_team_name=team.name if team else None,
        to_assigned=esc.to_assigned,
        to_assigned_name=await _user_name(esc.to_assigned, db),
        reason=esc.reason,
        handover_memo=esc.handover_memo,
        customer_summary=esc.customer_summary,
        triggered_by=esc.triggered_by,
        triggered_by_name=await _user_name(esc.triggered_by, db),
        acknowledged_at=esc.acknowledged_at,
        created_at=esc.created_at,
    )


# ── Escalation endpoints ──────────────────────────────────────────────────────


@esc_router.post("", status_code=status.HTTP_201_CREATED, response_model=EscalationOut)
async def escalate_ticket(
    tenant_slug: str,
    ticket_id: uuid.UUID,
    body: EscalateRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """1차→2차(또는 N차→N+1차) 에스컬레이션. admin, team_lead만 가능."""
    if current_user.role not in _ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="권한이 없습니다.")

    ticket = await _get_ticket(current_user.tenant_id, ticket_id, db)
    to_team = await _get_team(current_user.tenant_id, body.to_team_id, db)

    if not to_team.is_active:
        raise HTTPException(status_code=400, detail="비활성화된 팀으로 이관할 수 없습니다.")

    from_level = ticket.escalation_level if hasattr(ticket, "escalation_level") else 1
    to_level = from_level + 1

    esc = TicketEscalation(
        id=uuid.uuid4(),
        tenant_id=current_user.tenant_id,
        ticket_id=ticket_id,
        from_level=from_level,
        to_level=to_level,
        from_assigned=ticket.assigned_to,
        to_team_id=body.to_team_id,
        to_assigned=body.to_assigned,
        reason=body.reason.value,
        handover_memo=body.handover_memo,
        customer_summary=body.customer_summary,
        triggered_by=current_user.id,
    )
    db.add(esc)

    # tickets 비정규화 컬럼 동기 업데이트
    ticket.escalation_level = to_level
    ticket.escalation_count = (getattr(ticket, "escalation_count", 0) or 0) + 1
    ticket.last_escalated_at = datetime.now(timezone.utc)
    if body.to_assigned:
        ticket.assigned_to = body.to_assigned

    await db.commit()
    await db.refresh(esc)

    # ESC-3: 고객 외부 알림 큐 등록 (설정된 채널 + notify_channels 교차)
    if body.notify_channels and ticket.customer_id:
        try:
            customer_email, customer_name = await resolve_customer_email(db, ticket)
            if customer_email:
                summary = body.customer_summary or ""
                for ch in body.notify_channels:
                    await queue_notification(
                        db,
                        tenant_id=current_user.tenant_id,
                        ticket_id=ticket_id,
                        escalation_id=esc.id,
                        channel=ch,
                        event_type="ticket_escalated",
                        recipient=customer_email,
                        payload={
                            "ticket_title": ticket.title,
                            "ticket_number": ticket.ticket_number or str(ticket_id)[:8],
                            "customer_name": customer_name,
                            "customer_summary": summary,
                        },
                    )
                await db.commit()
        except Exception:
            logger.warning("에스컬레이션 외부 알림 큐 실패 (무시)", exc_info=True)

    return await _enrich_escalation(esc, db)


@esc_router.get("", response_model=list[EscalationOut])
async def list_escalations(
    tenant_slug: str,
    ticket_id: uuid.UUID,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """티켓 에스컬레이션 이력 목록."""
    await _get_ticket(current_user.tenant_id, ticket_id, db)

    rows = (await db.execute(
        select(TicketEscalation)
        .where(
            TicketEscalation.tenant_id == current_user.tenant_id,
            TicketEscalation.ticket_id == ticket_id,
        )
        .order_by(TicketEscalation.created_at)
    )).scalars().all()

    return [await _enrich_escalation(r, db) for r in rows]


@esc_router.patch("/{esc_id}/acknowledge", response_model=EscalationOut)
async def acknowledge_escalation(
    tenant_slug: str,
    ticket_id: uuid.UUID,
    esc_id: uuid.UUID,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """2차 담당자가 인계를 인지했음을 기록."""
    esc = await db.get(TicketEscalation, esc_id)
    if not esc or esc.tenant_id != current_user.tenant_id or esc.ticket_id != ticket_id:
        raise HTTPException(status_code=404, detail="에스컬레이션 기록을 찾을 수 없습니다.")
    if esc.acknowledged_at:
        raise HTTPException(status_code=400, detail="이미 인지 처리된 항목입니다.")

    esc.acknowledged_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(esc)
    return await _enrich_escalation(esc, db)


# ── Support-team endpoints ────────────────────────────────────────────────────


@team_router.get("", response_model=list[SupportTeamOut])
async def list_support_teams(
    tenant_slug: str,
    level: int | None = Query(None),
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
):
    q = select(SupportTeam).where(SupportTeam.tenant_id == current_user.tenant_id)
    if level is not None:
        q = q.where(SupportTeam.level == level)
    q = q.order_by(SupportTeam.level, SupportTeam.name)
    rows = (await db.execute(q)).scalars().all()

    result = []
    for team in rows:
        cnt = len((await db.execute(
            select(SupportTeamMember).where(SupportTeamMember.team_id == team.id)
        )).scalars().all())
        result.append(SupportTeamOut(
            id=team.id,
            name=team.name,
            level=team.level,
            description=team.description,
            is_active=team.is_active,
            member_count=cnt,
            created_at=team.created_at,
        ))
    return result


@team_router.post("", status_code=status.HTTP_201_CREATED, response_model=SupportTeamOut)
async def create_support_team(
    tenant_slug: str,
    body: SupportTeamCreate,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    if current_user.role not in _ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="권한이 없습니다.")

    team = SupportTeam(
        id=uuid.uuid4(),
        tenant_id=current_user.tenant_id,
        name=body.name,
        level=body.level,
        description=body.description,
    )
    db.add(team)
    await db.commit()
    await db.refresh(team)
    return SupportTeamOut(
        id=team.id, name=team.name, level=team.level,
        description=team.description, is_active=team.is_active,
        member_count=0, created_at=team.created_at,
    )


@team_router.patch("/{team_id}", response_model=SupportTeamOut)
async def update_support_team(
    tenant_slug: str,
    team_id: uuid.UUID,
    body: SupportTeamCreate,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    if current_user.role not in _ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="권한이 없습니다.")

    team = await _get_team(current_user.tenant_id, team_id, db)
    team.name = body.name
    team.level = body.level
    team.description = body.description
    await db.commit()
    await db.refresh(team)
    return SupportTeamOut(
        id=team.id, name=team.name, level=team.level,
        description=team.description, is_active=team.is_active,
        member_count=0, created_at=team.created_at,
    )


@team_router.post("/{team_id}/members", status_code=status.HTTP_204_NO_CONTENT)
async def add_team_member(
    tenant_slug: str,
    team_id: uuid.UUID,
    user_id: uuid.UUID,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    if current_user.role not in _ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="권한이 없습니다.")

    await _get_team(current_user.tenant_id, team_id, db)
    user = await db.get(User, user_id)
    if not user or user.tenant_id != current_user.tenant_id:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다.")

    existing = await db.get(SupportTeamMember, {"team_id": team_id, "user_id": user_id})
    if existing:
        return

    db.add(SupportTeamMember(team_id=team_id, user_id=user_id))
    await db.commit()


@team_router.delete("/{team_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_team_member(
    tenant_slug: str,
    team_id: uuid.UUID,
    user_id: uuid.UUID,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    if current_user.role not in _ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="권한이 없습니다.")

    member = await db.get(SupportTeamMember, {"team_id": team_id, "user_id": user_id})
    if member:
        await db.delete(member)
        await db.commit()
