"""알려진 이슈 라우터.

prefix : /{tenant_slug}/kb/known-issues  (목록/제안)
         /{tenant_slug}/tickets/{ticket_id}/known-issues  (연결/해제)
인증   : get_current_user
격리   : tenant_id 필터

엔드포인트:
  GET    /{tenant_slug}/kb/known-issues                       — 알려진 이슈 목록 (?ki_status=)
  GET    /{tenant_slug}/kb/known-issues/suggest               — ?symptom_category_id=UUID 제안
  POST   /{tenant_slug}/tickets/{ticket_id}/known-issues      — 연결 (body: {article_id})
  DELETE /{tenant_slug}/tickets/{ticket_id}/known-issues/{article_id} — 연결 해제
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models import KbArticle, Ticket, User
from app.models.ticket_known_issue import TicketKnownIssue

logger = logging.getLogger(__name__)

# ------------------------------------------------------------------
# 알려진 이슈 KB 라우터 (목록·제안)
# ------------------------------------------------------------------
router = APIRouter(
    prefix="/{tenant_slug}/kb/known-issues",
    tags=["known_issues"],
)

# ------------------------------------------------------------------
# 티켓-알려진 이슈 연결 라우터
# ------------------------------------------------------------------
router_ticket = APIRouter(
    prefix="/{tenant_slug}/tickets/{ticket_id}/known-issues",
    tags=["known_issues"],
)


# ------------------------------------------------------------------
# 스키마
# ------------------------------------------------------------------


class KnownIssueOut(BaseModel):
    id: uuid.UUID
    tenant_id: uuid.UUID
    title: str
    is_known_issue: bool
    ki_severity: str | None
    ki_symptom_category_id: uuid.UUID | None
    ki_status: str | None
    is_published: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class LinkKnownIssueRequest(BaseModel):
    article_id: uuid.UUID


class TicketKnownIssueOut(BaseModel):
    ticket_id: uuid.UUID
    article_id: uuid.UUID
    linked_at: datetime
    linked_by: uuid.UUID | None

    model_config = {"from_attributes": True}


# ------------------------------------------------------------------
# 고정 경로 먼저: /suggest (파라미터 경로 충돌 방지)
# ------------------------------------------------------------------


@router.get(
    "/suggest",
    response_model=list[KnownIssueOut],
    summary="증상 카테고리 기반 알려진 이슈 제안",
)
async def suggest_known_issues(
    tenant_slug: str,
    symptom_category_id: uuid.UUID = Query(..., description="증상 카테고리 UUID"),
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> list[KnownIssueOut]:
    rows = (
        await db.execute(
            select(KbArticle).where(
                and_(
                    KbArticle.tenant_id == current_user.tenant_id,
                    KbArticle.is_known_issue.is_(True),
                    KbArticle.is_published.is_(True),  # RA-D7: 미게시 이슈 제안 차단
                    KbArticle.ki_symptom_category_id == symptom_category_id,
                    KbArticle.ki_status != "resolved",
                )
            )
            .order_by(KbArticle.updated_at.desc())
        )
    ).scalars().all()
    return [KnownIssueOut.model_validate(r) for r in rows]


@router.get(
    "",
    response_model=list[KnownIssueOut],
    summary="알려진 이슈 목록",
)
async def list_known_issues(
    tenant_slug: str,
    ki_status: str | None = Query(None, description="ki_status 필터 (open/in_progress/resolved)"),
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> list[KnownIssueOut]:
    conditions = [
        KbArticle.tenant_id == current_user.tenant_id,
        KbArticle.is_known_issue.is_(True),
        KbArticle.is_published.is_(True),  # RA-D7: 미게시 이슈 엔지니어 노출 차단
    ]
    if ki_status is not None:
        conditions.append(KbArticle.ki_status == ki_status)

    rows = (
        await db.execute(
            select(KbArticle)
            .where(and_(*conditions))
            .order_by(KbArticle.updated_at.desc())
        )
    ).scalars().all()
    return [KnownIssueOut.model_validate(r) for r in rows]


# ------------------------------------------------------------------
# 티켓-알려진 이슈 연결/해제
# ------------------------------------------------------------------


@router_ticket.get(
    "",
    response_model=list[KnownIssueOut],
    summary="티켓에 연결된 알려진 이슈 목록",
)
async def list_ticket_known_issues(
    tenant_slug: str,
    ticket_id: uuid.UUID,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> list[KnownIssueOut]:
    # 티켓 tenant 격리 확인
    ticket = await db.scalar(
        select(Ticket).where(
            and_(
                Ticket.id == ticket_id,
                Ticket.tenant_id == current_user.tenant_id,
            )
        )
    )
    if ticket is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="티켓을 찾을 수 없습니다.")

    rows = (
        await db.execute(
            select(KbArticle)
            .join(TicketKnownIssue, TicketKnownIssue.article_id == KbArticle.id)
            .where(
                and_(
                    TicketKnownIssue.ticket_id == ticket_id,
                    KbArticle.tenant_id == current_user.tenant_id,
                )
            )
            .order_by(TicketKnownIssue.linked_at.desc())
        )
    ).scalars().all()
    return [KnownIssueOut.model_validate(r) for r in rows]


@router_ticket.post(
    "",
    response_model=TicketKnownIssueOut,
    status_code=status.HTTP_201_CREATED,
    summary="티켓에 알려진 이슈 연결",
)
async def link_known_issue(
    tenant_slug: str,
    ticket_id: uuid.UUID,
    data: LinkKnownIssueRequest,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> TicketKnownIssueOut:
    # 티켓 tenant 격리 확인
    ticket = await db.scalar(
        select(Ticket).where(
            and_(
                Ticket.id == ticket_id,
                Ticket.tenant_id == current_user.tenant_id,
            )
        )
    )
    if ticket is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="티켓을 찾을 수 없습니다.")

    # KB 아티클 tenant 격리 확인
    article = await db.scalar(
        select(KbArticle).where(
            and_(
                KbArticle.id == data.article_id,
                KbArticle.tenant_id == current_user.tenant_id,
                KbArticle.is_known_issue.is_(True),
            )
        )
    )
    if article is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="알려진 이슈 KB 문서를 찾을 수 없습니다.")

    # 중복 연결 확인
    existing = await db.scalar(
        select(TicketKnownIssue).where(
            and_(
                TicketKnownIssue.ticket_id == ticket_id,
                TicketKnownIssue.article_id == data.article_id,
            )
        )
    )
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="이미 연결된 이슈입니다.")

    link = TicketKnownIssue(
        ticket_id=ticket_id,
        article_id=data.article_id,
        linked_at=datetime.now(timezone.utc),
        linked_by=current_user.id,
    )
    db.add(link)
    await db.commit()
    await db.refresh(link)
    return TicketKnownIssueOut.model_validate(link)


@router_ticket.delete(
    "/{article_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="티켓 알려진 이슈 연결 해제",
)
async def unlink_known_issue(
    tenant_slug: str,
    ticket_id: uuid.UUID,
    article_id: uuid.UUID,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> None:
    # 티켓 tenant 격리 확인
    ticket = await db.scalar(
        select(Ticket).where(
            and_(
                Ticket.id == ticket_id,
                Ticket.tenant_id == current_user.tenant_id,
            )
        )
    )
    if ticket is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="티켓을 찾을 수 없습니다.")

    link = await db.scalar(
        select(TicketKnownIssue).where(
            and_(
                TicketKnownIssue.ticket_id == ticket_id,
                TicketKnownIssue.article_id == article_id,
            )
        )
    )
    if link is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="연결된 이슈를 찾을 수 없습니다.")

    await db.delete(link)
    await db.commit()
