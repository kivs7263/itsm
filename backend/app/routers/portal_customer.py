"""고객 포털 세션 인증 라우터 (P1-PORTAL).

고객이 이메일로 매직링크를 요청하면 백엔드가 링크를 발송하고,
링크 클릭 시 HttpOnly 쿠키 세션을 발급합니다.

prefix: /portal/{tenant_slug}

엔드포인트:
  POST /portal/{tenant_slug}/auth/login    — 매직링크 이메일 발송
  GET  /portal/{tenant_slug}/auth/verify   — 토큰 검증 → 세션 쿠키 발급
  POST /portal/{tenant_slug}/auth/logout   — 세션 쿠키 삭제
  GET  /portal/{tenant_slug}/me            — 현재 고객 정보 (세션 쿠키 필요)
  GET  /portal/{tenant_slug}/tickets       — 내 티켓 목록 (세션 쿠키 필요)
"""
from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Cookie, Depends, HTTPException, Query, Request, Response, status
from pydantic import BaseModel
from sqlalchemy import and_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.customer import Customer
from app.models.portal_session import PortalSession
from app.models.tenant import Tenant

router = APIRouter(prefix="/portal/{tenant_slug}", tags=["portal-customer"])

_SESSION_COOKIE = "itsm_portal_session"
_SESSION_TTL_HOURS = 24 * 7  # 7일
_MAGIC_TTL_MINUTES = 30


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


async def _get_tenant(db: AsyncSession, slug: str) -> Tenant:
    t = (
        await db.execute(select(Tenant).where(Tenant.slug == slug))
    ).scalar_one_or_none()
    if not t:
        raise HTTPException(status_code=404, detail="테넌트를 찾을 수 없습니다.")
    return t


async def _get_customer_from_session(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    session_token: str | None,
) -> Customer | None:
    if not session_token:
        return None
    thash = _token_hash(session_token)
    ps = (
        await db.execute(
            select(PortalSession).where(
                and_(
                    PortalSession.token_hash == thash,
                    PortalSession.tenant_id == tenant_id,
                    PortalSession.purpose == "customer_session",
                    PortalSession.expires_at > datetime.now(timezone.utc),
                )
            )
        )
    ).scalar_one_or_none()
    if not ps:
        return None
    return await db.get(Customer, ps.customer_id)


# ------------------------------------------------------------------
# 스키마
# ------------------------------------------------------------------


class LoginRequest(BaseModel):
    email: str


class PortalMeOut(BaseModel):
    id: str
    name: str
    email: str
    company: str | None = None


class PortalTicketOut(BaseModel):
    id: str
    ticket_number: str | None
    title: str
    status: str
    priority: str
    contract_name: str | None = None
    created_at: datetime
    updated_at: datetime


# ------------------------------------------------------------------
# 매직링크 발송
# ------------------------------------------------------------------


@router.post("/auth/login", status_code=status.HTTP_202_ACCEPTED, summary="매직링크 이메일 발송")
async def portal_login(
    tenant_slug: str,
    body: LoginRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    """고객 이메일로 매직링크를 발송합니다. 보안을 위해 등록 여부 무관하게 202를 반환합니다."""
    tenant = await _get_tenant(db, tenant_slug)

    customer = (
        await db.execute(
            select(Customer).where(
                and_(
                    Customer.tenant_id == tenant.id,
                    Customer.email == body.email.strip().lower(),
                )
            )
        )
    ).scalar_one_or_none()

    if customer:
        token = secrets.token_urlsafe(32)
        thash = _token_hash(token)
        expires_at = datetime.now(timezone.utc) + timedelta(minutes=_MAGIC_TTL_MINUTES)

        ps = PortalSession(
            id=uuid.uuid4(),
            tenant_id=tenant.id,
            customer_id=customer.id,
            token_hash=thash,
            purpose="magic_login",
            expires_at=expires_at,
        )
        db.add(ps)
        await db.commit()

        # 외부 알림 큐에 매직링크 이메일 등록
        try:
            from app.services.external_notif_service import queue_notification
            verify_url = f"/portal/{tenant_slug}/auth/verify?token={token}"
            await queue_notification(
                db,
                tenant_id=tenant.id,
                ticket_id=None,
                escalation_id=None,
                channel="email",
                event_type="portal_magic_link",
                recipient=customer.email,
                payload={
                    "customer_name": customer.name,
                    "verify_url": verify_url,
                    "expires_minutes": _MAGIC_TTL_MINUTES,
                },
            )
        except Exception:
            pass  # 메인 응답은 항상 성공 반환

    return {"message": "이메일을 확인해주세요."}


# ------------------------------------------------------------------
# 매직링크 검증 → 세션 쿠키 발급
# ------------------------------------------------------------------


@router.get("/auth/verify", summary="매직링크 토큰 검증 → 세션 쿠키")
async def portal_verify(
    tenant_slug: str,
    token: str = Query(...),
    response: Response = None,
    db: AsyncSession = Depends(get_db),
) -> dict:
    tenant = await _get_tenant(db, tenant_slug)
    thash = _token_hash(token)

    ps = (
        await db.execute(
            select(PortalSession).where(
                and_(
                    PortalSession.token_hash == thash,
                    PortalSession.tenant_id == tenant.id,
                    PortalSession.purpose == "magic_login",
                    PortalSession.expires_at > datetime.now(timezone.utc),
                    PortalSession.used_at.is_(None),
                )
            )
        )
    ).scalar_one_or_none()

    if not ps:
        raise HTTPException(status_code=401, detail="링크가 만료되었거나 이미 사용되었습니다.")

    # 매직링크 사용 처리
    ps.used_at = datetime.now(timezone.utc)
    await db.commit()

    # 세션 쿠키 발급
    session_token = secrets.token_urlsafe(32)
    session_hash = _token_hash(session_token)
    expires_at = datetime.now(timezone.utc) + timedelta(hours=_SESSION_TTL_HOURS)

    session = PortalSession(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        customer_id=ps.customer_id,
        token_hash=session_hash,
        purpose="customer_session",
        expires_at=expires_at,
    )
    db.add(session)
    await db.commit()

    response.set_cookie(
        key=_SESSION_COOKIE,
        value=session_token,
        httponly=True,
        secure=False,  # HTTPS 환경에서는 True
        samesite="lax",
        max_age=_SESSION_TTL_HOURS * 3600,
        path=f"/portal/{tenant_slug}",
    )

    return {"redirect": f"/portal/{tenant_slug}"}


# ------------------------------------------------------------------
# 로그아웃
# ------------------------------------------------------------------


@router.post("/auth/logout", summary="포털 로그아웃")
async def portal_logout(
    tenant_slug: str,
    response: Response,
    db: AsyncSession = Depends(get_db),
    session_token: str | None = Cookie(default=None, alias=_SESSION_COOKIE),
) -> dict:
    if session_token:
        thash = _token_hash(session_token)
        ps = (
            await db.execute(
                select(PortalSession).where(
                    and_(
                        PortalSession.token_hash == thash,
                        PortalSession.purpose == "customer_session",
                    )
                )
            )
        ).scalar_one_or_none()
        if ps:
            await db.delete(ps)
            await db.commit()

    response.delete_cookie(key=_SESSION_COOKIE, path=f"/portal/{tenant_slug}")
    return {"message": "로그아웃 완료"}


# ------------------------------------------------------------------
# /me — 현재 고객 정보
# ------------------------------------------------------------------


@router.get("/me", response_model=PortalMeOut, summary="포털 현재 사용자")
async def portal_me(
    tenant_slug: str,
    db: AsyncSession = Depends(get_db),
    session_token: str | None = Cookie(default=None, alias=_SESSION_COOKIE),
) -> PortalMeOut:
    tenant = await _get_tenant(db, tenant_slug)
    customer = await _get_customer_from_session(db, tenant.id, session_token)
    if not customer:
        raise HTTPException(status_code=401, detail="인증이 필요합니다.")

    return PortalMeOut(
        id=str(customer.id),
        name=customer.name,
        email=customer.email or "",
        company=customer.company,
    )


# ------------------------------------------------------------------
# /tickets — 내 티켓 목록
# ------------------------------------------------------------------


@router.get("/tickets", response_model=list[PortalTicketOut], summary="포털 내 티켓 목록")
async def portal_tickets(
    tenant_slug: str,
    status_filter: str | None = Query(default=None, alias="status"),
    db: AsyncSession = Depends(get_db),
    session_token: str | None = Cookie(default=None, alias=_SESSION_COOKIE),
) -> list[PortalTicketOut]:
    tenant = await _get_tenant(db, tenant_slug)
    customer = await _get_customer_from_session(db, tenant.id, session_token)
    if not customer:
        raise HTTPException(status_code=401, detail="인증이 필요합니다.")

    # status 필터 파싱 (쉼표 구분)
    status_list: list[str] = []
    if status_filter:
        status_list = [s.strip() for s in status_filter.split(",") if s.strip()]

    where_clause = "t.tenant_id = :tenant_id AND t.customer_id = :customer_id"
    params: dict = {
        "tenant_id": str(tenant.id),
        "customer_id": str(customer.id),
    }
    if status_list:
        where_clause += " AND t.status = ANY(:statuses)"
        params["statuses"] = status_list

    rows = (
        await db.execute(
            text(f"""
                SELECT
                    t.id,
                    t.ticket_number,
                    t.title,
                    t.status,
                    t.priority,
                    c.name AS contract_name,
                    t.created_at,
                    t.updated_at
                FROM tickets t
                LEFT JOIN contracts c ON c.id = t.contract_id
                WHERE {where_clause}
                ORDER BY t.updated_at DESC
                LIMIT 100
            """),
            params,
        )
    ).fetchall()

    return [
        PortalTicketOut(
            id=str(r.id),
            ticket_number=r.ticket_number,
            title=r.title,
            status=r.status,
            priority=r.priority,
            contract_name=r.contract_name,
            created_at=r.created_at,
            updated_at=r.updated_at,
        )
        for r in rows
    ]
