"""설치 워크플로우 라우터.

prefix: /{tenant_slug}/tickets/{ticket_id}/installation

인증: get_current_user (JWT HttpOnly 쿠키)
격리: 모든 쿼리 tenant_id == current_user.tenant_id

엔드포인트:
  GET  /{slug}/tickets/{ticket_id}/installation          — 현재 단계 + 이력 조회
  POST /{slug}/tickets/{ticket_id}/installation/advance  — 다음 단계로 전진
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models import Ticket, TicketStatus, User

logger = logging.getLogger(__name__)

router = APIRouter(tags=["installation"])

# 설치 워크플로우 단계 (단방향 강제)
INSTALLATION_STEPS: list[str] = ["survey", "executing", "verification", "acceptance"]


# ──────────────────────────────────────────────────────────────────────────────
# 스키마
# ──────────────────────────────────────────────────────────────────────────────

class InstallationAdvanceBody(BaseModel):
    note: str | None = None


class InstallationOut(BaseModel):
    installation_step: str | None
    installation_history: list
    ticket_status: str


# ──────────────────────────────────────────────────────────────────────────────
# 엔드포인트
# ──────────────────────────────────────────────────────────────────────────────

@router.get(
    "/{tenant_slug}/tickets/{ticket_id}/installation",
    response_model=InstallationOut,
)
async def get_installation(
    tenant_slug: str,
    ticket_id: uuid.UUID,
    current_user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
):
    """설치 워크플로우 현재 단계 및 이력 조회."""
    ticket = await _assert_installation_ticket(db, ticket_id, current_user)
    return InstallationOut(
        installation_step=ticket.installation_step,
        installation_history=ticket.installation_history or [],
        ticket_status=ticket.status if isinstance(ticket.status, str) else ticket.status.value,
    )


@router.post(
    "/{tenant_slug}/tickets/{ticket_id}/installation/advance",
    response_model=InstallationOut,
)
async def advance_installation(
    tenant_slug: str,
    ticket_id: uuid.UUID,
    body: InstallationAdvanceBody,
    current_user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
):
    """설치 워크플로우를 다음 단계로 전진시킨다.

    단계 순서: survey → executing → verification → acceptance
    acceptance 도달 시 티켓 status = resolved, resolved_at 기록.
    """
    ticket = await _assert_installation_ticket(db, ticket_id, current_user)

    # 현재 단계 결정
    current_step = ticket.installation_step

    if current_step is None:
        # 첫 번째 호출: survey 초기화
        new_step = INSTALLATION_STEPS[0]
    elif current_step == INSTALLATION_STEPS[-1]:
        # 이미 acceptance — 완료된 설치
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="설치 워크플로우가 이미 완료(acceptance)되었습니다.",
        )
    else:
        current_idx = INSTALLATION_STEPS.index(current_step)
        new_step = INSTALLATION_STEPS[current_idx + 1]

    # 이력 항목 추가
    history_entry = {
        "step": new_step,
        "actor_id": str(current_user.id),
        "note": body.note or None,
        "ts": datetime.now(timezone.utc).isoformat(),
    }

    # JSONB 변경 감지: 리스트를 새 객체로 교체해야 SQLAlchemy가 변경을 인식
    updated_history = list(ticket.installation_history or [])
    updated_history.append(history_entry)

    ticket.installation_step = new_step
    ticket.installation_history = updated_history

    # acceptance 도달 시 티켓 자동 resolved 처리
    if new_step == INSTALLATION_STEPS[-1]:
        ticket.status = TicketStatus.resolved
        ticket.resolved_at = datetime.now(timezone.utc)

    await db.commit()
    await db.refresh(ticket)

    return InstallationOut(
        installation_step=ticket.installation_step,
        installation_history=ticket.installation_history or [],
        ticket_status=ticket.status if isinstance(ticket.status, str) else ticket.status.value,
    )


# ──────────────────────────────────────────────────────────────────────────────
# 헬퍼
# ──────────────────────────────────────────────────────────────────────────────

async def _assert_installation_ticket(
    db: AsyncSession,
    ticket_id: uuid.UUID,
    current_user: User,
) -> Ticket:
    """티켓 존재 확인 + 테넌트 격리 + request_type 검증."""
    result = await db.execute(
        select(Ticket).where(
            Ticket.id == ticket_id,
            Ticket.tenant_id == current_user.tenant_id,
        )
    )
    ticket = result.scalar_one_or_none()
    if ticket is None:
        raise HTTPException(status_code=404, detail="티켓을 찾을 수 없습니다.")

    if ticket.request_type != "installation":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="설치(installation) 유형의 티켓에만 사용할 수 있습니다.",
        )
    return ticket
