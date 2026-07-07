"""고객 매직링크 포털 라우터 (ESC-4).

인증: JWT 토큰 기반 (HS256, 7일 TTL) — 로그인 없이 링크만으로 접근.
prefix:
  /{tenant_slug}/tickets/{ticket_id}/portal-link  — 링크 발급 (staff 인증 필요)
  /portal/*                                        — 고객 공개 접근 (JWT 검증만)

엔드포인트:
  POST /{tenant_slug}/tickets/{ticket_id}/portal-link  — 매직링크 발급
  GET  /portal/verify/{token}                          — 토큰 검증 + 티켓 요약 반환
  GET  /portal/{token}/timeline                        — 공개 타임라인
  POST /portal/{token}/comments                        — 고객 코멘트 추가
"""
from __future__ import annotations

import hashlib
import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from jose import JWTError, jwt
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models import Customer, Ticket, TicketComment, User  # noqa: F401
from app.models.escalation import SupportTeam, TicketEscalation
from app.models.portal_session import PortalSession

# ── 라우터 정의 ────────────────────────────────────────────────────────────────

router_staff = APIRouter(
    prefix="/{tenant_slug}/tickets/{ticket_id}",
    tags=["customer-portal"],
)
router_portal = APIRouter(
    prefix="/portal",
    tags=["customer-portal"],
)

_PORTAL_ALGO = "HS256"
_PORTAL_TTL_DAYS = 7


def _portal_secret() -> str:
    return settings.ITSM_PORTAL_SECRET or settings.SECRET_KEY


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _issue_token(ticket_id: uuid.UUID, customer_id: uuid.UUID, tenant_id: uuid.UUID) -> str:
    exp = datetime.now(timezone.utc) + timedelta(days=_PORTAL_TTL_DAYS)
    payload = {
        "ticket_id": str(ticket_id),
        "customer_id": str(customer_id),
        "tenant_id": str(tenant_id),
        "exp": exp,
    }
    return jwt.encode(payload, _portal_secret(), algorithm=_PORTAL_ALGO)


def _decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, _portal_secret(), algorithms=[_PORTAL_ALGO])
    except JWTError as exc:
        raise HTTPException(status_code=401, detail=f"유효하지 않은 포털 링크입니다: {exc}")


# ── 링크 발급 (staff 인증) ──────────────────────────────────────────────────────


class PortalLinkOut(BaseModel):
    token: str
    expires_at: datetime
    portal_url: str


@router_staff.post(
    "/portal-link",
    response_model=PortalLinkOut,
    status_code=status.HTTP_201_CREATED,
    summary="고객 포털 매직링크 발급",
)
async def issue_portal_link(
    tenant_slug: str,
    ticket_id: uuid.UUID,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> PortalLinkOut:
    """티켓에 연결된 고객에게 공유할 매직링크를 발급합니다 (7일 유효)."""
    ticket = await db.get(Ticket, ticket_id)
    if not ticket or ticket.tenant_id != current_user.tenant_id:
        raise HTTPException(status_code=404, detail="티켓을 찾을 수 없습니다.")
    if not ticket.customer_id:
        raise HTTPException(status_code=400, detail="티켓에 고객이 연결되어 있지 않습니다.")

    token = _issue_token(ticket_id, ticket.customer_id, current_user.tenant_id)
    expires_at = datetime.now(timezone.utc) + timedelta(days=_PORTAL_TTL_DAYS)

    session = PortalSession(
        id=uuid.uuid4(),
        tenant_id=current_user.tenant_id,
        customer_id=ticket.customer_id,
        ticket_id=ticket_id,
        token_hash=_token_hash(token),
        expires_at=expires_at,
        purpose="magic_link",
    )
    db.add(session)
    await db.commit()

    # 포털 URL 구성: 실제 매직 뷰 라우트는 /portal/magic/{token} (Next.js app/portal/magic/[token]).
    # 구 "/portal/{token}" 는 존재하지 않는 라우트라 404 → magic 경로로 교정 (IPA-1 2026-07-07).
    portal_url = f"/portal/magic/{token}"

    return PortalLinkOut(token=token, expires_at=expires_at, portal_url=portal_url)


# ── 고객 공개 포털 ────────────────────────────────────────────────────────────────


class TicketSummaryOut(BaseModel):
    ticket_id: uuid.UUID
    ticket_number: str | None
    title: str
    status: str
    priority: str
    escalation_level: int
    escalation_count: int
    created_at: datetime
    updated_at: datetime
    current_team_name: str | None
    customer_name: str | None


class TimelineEventOut(BaseModel):
    type: str             # "status_change" | "comment" | "escalation"
    content: str
    created_at: datetime


class CustomerCommentRequest(BaseModel):
    content: str


@router_portal.get("/verify/{token}", response_model=TicketSummaryOut, summary="포털 토큰 검증")
async def verify_portal_token(
    token: str,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> TicketSummaryOut:
    """매직링크 토큰 검증 후 티켓 기본 정보 반환 (고객용 공개 뷰)."""
    payload = _decode_token(token)

    ticket_id = uuid.UUID(payload["ticket_id"])
    tenant_id = uuid.UUID(payload["tenant_id"])

    # DB 세션 유효성 확인 (발급 이후 삭제되지 않았는지)
    thash = _token_hash(token)
    ps = (
        await db.execute(
            select(PortalSession).where(
                PortalSession.token_hash == thash,
                PortalSession.tenant_id == tenant_id,  # reviewer 권고-1: 방어심층(JWT서명 외 tenant 이중검증)
                PortalSession.expires_at > datetime.now(timezone.utc),
            )
        )
    ).scalar_one_or_none()
    if not ps:
        raise HTTPException(status_code=401, detail="만료되었거나 유효하지 않은 포털 링크입니다.")

    ticket = await db.get(Ticket, ticket_id)
    if not ticket or ticket.tenant_id != tenant_id:
        raise HTTPException(status_code=404, detail="티켓을 찾을 수 없습니다.")

    # 현재 담당팀 이름 (마지막 에스컬레이션 기준)
    last_esc = (
        await db.execute(
            select(TicketEscalation)
            .where(TicketEscalation.ticket_id == ticket_id)
            .order_by(TicketEscalation.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()

    team_name = None
    if last_esc:
        team = await db.get(SupportTeam, last_esc.to_team_id)
        team_name = team.name if team else None

    customer = await db.get(Customer, ticket.customer_id) if ticket.customer_id else None

    return TicketSummaryOut(
        ticket_id=ticket.id,
        ticket_number=ticket.ticket_number,
        title=ticket.title,
        status=ticket.status,
        priority=ticket.priority,
        escalation_level=getattr(ticket, "escalation_level", 1),
        escalation_count=getattr(ticket, "escalation_count", 0),
        created_at=ticket.created_at,
        updated_at=ticket.updated_at,
        current_team_name=team_name,
        customer_name=customer.name if customer else None,
    )


@router_portal.get("/{token}/timeline", response_model=list[TimelineEventOut], summary="공개 타임라인")
async def portal_timeline(
    token: str,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[TimelineEventOut]:
    """에스컬레이션 고객 요약 + 공개 코멘트만 시간순 반환 (내부 메모 제외)."""
    payload = _decode_token(token)
    ticket_id = uuid.UUID(payload["ticket_id"])
    tenant_id = uuid.UUID(payload["tenant_id"])

    thash = _token_hash(token)
    ps = (
        await db.execute(
            select(PortalSession).where(
                PortalSession.token_hash == thash,
                PortalSession.tenant_id == tenant_id,  # reviewer 권고-1: 방어심층(JWT서명 외 tenant 이중검증)
                PortalSession.expires_at > datetime.now(timezone.utc),
            )
        )
    ).scalar_one_or_none()
    if not ps:
        raise HTTPException(status_code=401, detail="만료되었거나 유효하지 않은 링크입니다.")

    events: list[TimelineEventOut] = []

    # 에스컬레이션 이벤트 (customer_summary만 노출)
    escs = (
        await db.execute(
            select(TicketEscalation)
            .where(
                TicketEscalation.ticket_id == ticket_id,
                TicketEscalation.tenant_id == tenant_id,
                TicketEscalation.customer_summary.is_not(None),
            )
            .order_by(TicketEscalation.created_at)
        )
    ).scalars().all()
    for esc in escs:
        events.append(TimelineEventOut(
            type="escalation",
            content=esc.customer_summary,
            created_at=esc.created_at,
        ))

    # 공개 코멘트 (is_internal=False인 것만)
    comments = (
        await db.execute(
            select(TicketComment)
            .where(
                TicketComment.ticket_id == ticket_id,
                TicketComment.is_internal.is_(False),
            )
            .order_by(TicketComment.created_at)
        )
    ).scalars().all()
    for c in comments:
        events.append(TimelineEventOut(
            type="comment",
            content=c.body[:500],
            created_at=c.created_at,
        ))

    events.sort(key=lambda e: e.created_at)
    return events


@router_portal.post("/{token}/comments", status_code=status.HTTP_201_CREATED, summary="고객 코멘트 추가")
async def portal_add_comment(
    token: str,
    body: CustomerCommentRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    """고객이 포털에서 추가 코멘트를 남깁니다 (비공개 플래그 없음 — 담당자에게 노출)."""
    payload = _decode_token(token)
    ticket_id = uuid.UUID(payload["ticket_id"])
    tenant_id = uuid.UUID(payload["tenant_id"])

    thash = _token_hash(token)
    ps = (
        await db.execute(
            select(PortalSession).where(
                PortalSession.token_hash == thash,
                PortalSession.tenant_id == tenant_id,  # reviewer 권고-1: 방어심층(JWT서명 외 tenant 이중검증)
                PortalSession.expires_at > datetime.now(timezone.utc),
            )
        )
    ).scalar_one_or_none()
    if not ps:
        raise HTTPException(status_code=401, detail="만료되었거나 유효하지 않은 링크입니다.")

    ticket = await db.get(Ticket, ticket_id)
    if not ticket or ticket.tenant_id != tenant_id:
        raise HTTPException(status_code=404, detail="티켓을 찾을 수 없습니다.")

    if not body.content or not body.content.strip():
        raise HTTPException(status_code=400, detail="내용을 입력해 주세요.")

    comment = TicketComment(
        id=uuid.uuid4(),
        ticket_id=ticket_id,
        tenant_id=tenant_id,
        body=body.content.strip(),
        is_internal=False,
        source="customer_portal",
    )
    db.add(comment)
    await db.commit()
    return {"message": "코멘트가 등록되었습니다."}
