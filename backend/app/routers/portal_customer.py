"""고객 포털 세션 인증 라우터 (P1-PORTAL).

고객이 이메일로 매직링크를 요청하면 백엔드가 링크를 발송하고,
링크 클릭 시 HttpOnly 쿠키 세션을 발급합니다.

prefix: /portal/{tenant_slug}

엔드포인트:
  POST /portal/{tenant_slug}/auth/login              — 매직링크 이메일 발송
  GET  /portal/{tenant_slug}/auth/verify             — 토큰 검증 → 세션 쿠키 발급
  POST /portal/{tenant_slug}/auth/logout             — 세션 쿠키 삭제
  GET  /portal/{tenant_slug}/me                      — 현재 고객 정보 (세션 쿠키 필요)
  GET  /portal/{tenant_slug}/tickets                 — 내 티켓 목록 (세션 쿠키 필요)
  GET  /portal/{tenant_slug}/tickets/{ticket_id}     — 티켓 상세 (세션 쿠키 필요)
  GET  /portal/{tenant_slug}/tickets/{ticket_id}/comments  — 공개 댓글 목록
  POST /portal/{tenant_slug}/tickets/{ticket_id}/comments  — 고객 댓글 추가
  GET  /portal/{tenant_slug}/tickets/{ticket_id}/timeline  — 통합 타임라인
"""
from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Cookie, Depends, HTTPException, Query, Request, Response, status
from pydantic import BaseModel, Field
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


class PortalTicketDetailOut(BaseModel):
    id: str
    ticket_number: str | None
    title: str
    description: str | None
    status: str
    priority: str
    channel: str
    contract_name: str | None = None
    assignee_name: str | None = None
    sla_resolution_deadline: datetime | None = None
    created_at: datetime
    updated_at: datetime
    resolved_at: datetime | None = None


class PortalCommentOut(BaseModel):
    id: str
    body: str
    author_name: str
    author_id: str | None
    is_customer: bool
    created_at: datetime


class PortalCommentCreate(BaseModel):
    body: str


class PortalTimelineEventOut(BaseModel):
    id: str
    type: str  # "created" | "comment"
    body: str | None
    author_name: str | None
    is_customer: bool
    created_at: datetime


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


# ------------------------------------------------------------------
# 티켓 상세
# ------------------------------------------------------------------


@router.get("/tickets/{ticket_id}", response_model=PortalTicketDetailOut, summary="포털 티켓 상세")
async def portal_ticket_detail(
    tenant_slug: str,
    ticket_id: str,
    db: AsyncSession = Depends(get_db),
    session_token: str | None = Cookie(default=None, alias=_SESSION_COOKIE),
) -> PortalTicketDetailOut:
    tenant = await _get_tenant(db, tenant_slug)
    customer = await _get_customer_from_session(db, tenant.id, session_token)
    if not customer:
        raise HTTPException(status_code=401, detail="인증이 필요합니다.")

    row = (
        await db.execute(
            text("""
                SELECT
                    t.id, t.ticket_number, t.title, t.description,
                    t.status, t.priority, t.channel,
                    t.sla_resolution_deadline,
                    t.created_at, t.updated_at, t.resolved_at,
                    c.name AS contract_name,
                    u.name AS assignee_name
                FROM tickets t
                LEFT JOIN contracts c ON c.id = t.contract_id
                LEFT JOIN users u ON u.id = t.assigned_to
                WHERE t.id = :ticket_id
                  AND t.tenant_id = :tenant_id
                  AND t.customer_id = :customer_id
            """),
            {
                "ticket_id": ticket_id,
                "tenant_id": str(tenant.id),
                "customer_id": str(customer.id),
            },
        )
    ).fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="티켓을 찾을 수 없습니다.")

    return PortalTicketDetailOut(
        id=str(row.id),
        ticket_number=row.ticket_number,
        title=row.title,
        description=row.description,
        status=row.status,
        priority=row.priority,
        channel=row.channel,
        contract_name=row.contract_name,
        assignee_name=row.assignee_name,
        sla_resolution_deadline=row.sla_resolution_deadline,
        created_at=row.created_at,
        updated_at=row.updated_at,
        resolved_at=row.resolved_at,
    )


# ------------------------------------------------------------------
# 공개 댓글 목록 + 추가
# ------------------------------------------------------------------


@router.get("/tickets/{ticket_id}/comments", response_model=list[PortalCommentOut], summary="포털 공개 댓글 목록")
async def portal_ticket_comments(
    tenant_slug: str,
    ticket_id: str,
    db: AsyncSession = Depends(get_db),
    session_token: str | None = Cookie(default=None, alias=_SESSION_COOKIE),
) -> list[PortalCommentOut]:
    tenant = await _get_tenant(db, tenant_slug)
    customer = await _get_customer_from_session(db, tenant.id, session_token)
    if not customer:
        raise HTTPException(status_code=401, detail="인증이 필요합니다.")

    ticket_check = (
        await db.execute(
            text("SELECT id FROM tickets WHERE id = :tid AND tenant_id = :tenant_id AND customer_id = :cid"),
            {"tid": ticket_id, "tenant_id": str(tenant.id), "cid": str(customer.id)},
        )
    ).fetchone()
    if not ticket_check:
        raise HTTPException(status_code=404, detail="티켓을 찾을 수 없습니다.")

    rows = (
        await db.execute(
            text("""
                SELECT
                    tc.id, tc.body, tc.author_id, tc.source, tc.created_at,
                    u.name AS user_name,
                    cust.name AS customer_name
                FROM ticket_comments tc
                LEFT JOIN users u ON u.id = tc.author_id
                LEFT JOIN customers cust ON cust.id = :customer_id AND tc.source = 'customer_portal'
                WHERE tc.ticket_id = :ticket_id
                  AND tc.tenant_id = :tenant_id
                  AND tc.is_internal = FALSE
                ORDER BY tc.created_at ASC
            """),
            {
                "ticket_id": ticket_id,
                "tenant_id": str(tenant.id),
                "customer_id": str(customer.id),
            },
        )
    ).fetchall()

    result = []
    for r in rows:
        is_customer = r.source == "customer_portal"
        if is_customer:
            author_name = customer.name
        else:
            author_name = r.user_name or "담당자"
        result.append(
            PortalCommentOut(
                id=str(r.id),
                body=r.body,
                author_name=author_name,
                author_id=str(r.author_id) if r.author_id else None,
                is_customer=is_customer,
                created_at=r.created_at,
            )
        )
    return result


@router.post("/tickets/{ticket_id}/comments", status_code=201, summary="포털 고객 댓글 추가")
async def portal_add_comment(
    tenant_slug: str,
    ticket_id: str,
    body: PortalCommentCreate,
    db: AsyncSession = Depends(get_db),
    session_token: str | None = Cookie(default=None, alias=_SESSION_COOKIE),
) -> dict:
    tenant = await _get_tenant(db, tenant_slug)
    customer = await _get_customer_from_session(db, tenant.id, session_token)
    if not customer:
        raise HTTPException(status_code=401, detail="인증이 필요합니다.")

    ticket_check = (
        await db.execute(
            text("""
                SELECT id, status FROM tickets
                WHERE id = :tid AND tenant_id = :tenant_id AND customer_id = :cid
            """),
            {"tid": ticket_id, "tenant_id": str(tenant.id), "cid": str(customer.id)},
        )
    ).fetchone()
    if not ticket_check:
        raise HTTPException(status_code=404, detail="티켓을 찾을 수 없습니다.")
    if ticket_check.status in ("closed", "resolved"):
        raise HTTPException(status_code=400, detail="종료된 티켓에는 댓글을 추가할 수 없습니다.")

    trimmed = body.body.strip()
    if not trimmed:
        raise HTTPException(status_code=422, detail="댓글 내용을 입력해주세요.")

    await db.execute(
        text("""
            INSERT INTO ticket_comments (id, tenant_id, ticket_id, author_id, body, is_internal, source, created_at)
            VALUES (gen_random_uuid(), :tenant_id, :ticket_id, NULL, :body, FALSE, 'customer_portal', NOW())
        """),
        {
            "tenant_id": str(tenant.id),
            "ticket_id": ticket_id,
            "body": trimmed,
        },
    )
    await db.commit()
    return {"ok": True}


# ------------------------------------------------------------------
# 통합 타임라인
# ------------------------------------------------------------------


@router.get("/tickets/{ticket_id}/timeline", response_model=list[PortalTimelineEventOut], summary="포털 통합 타임라인")
async def portal_ticket_timeline(
    tenant_slug: str,
    ticket_id: str,
    db: AsyncSession = Depends(get_db),
    session_token: str | None = Cookie(default=None, alias=_SESSION_COOKIE),
) -> list[PortalTimelineEventOut]:
    tenant = await _get_tenant(db, tenant_slug)
    customer = await _get_customer_from_session(db, tenant.id, session_token)
    if not customer:
        raise HTTPException(status_code=401, detail="인증이 필요합니다.")

    ticket_row = (
        await db.execute(
            text("SELECT id, created_at FROM tickets WHERE id = :tid AND tenant_id = :tenant_id AND customer_id = :cid"),
            {"tid": ticket_id, "tenant_id": str(tenant.id), "cid": str(customer.id)},
        )
    ).fetchone()
    if not ticket_row:
        raise HTTPException(status_code=404, detail="티켓을 찾을 수 없습니다.")

    events: list[PortalTimelineEventOut] = [
        PortalTimelineEventOut(
            id=f"created-{ticket_id}",
            type="created",
            body="티켓이 접수되었습니다.",
            author_name=None,
            is_customer=False,
            created_at=ticket_row.created_at,
        )
    ]

    comment_rows = (
        await db.execute(
            text("""
                SELECT
                    tc.id, tc.body, tc.source, tc.created_at,
                    u.name AS user_name
                FROM ticket_comments tc
                LEFT JOIN users u ON u.id = tc.author_id
                WHERE tc.ticket_id = :ticket_id
                  AND tc.tenant_id = :tenant_id
                  AND tc.is_internal = FALSE
                ORDER BY tc.created_at ASC
            """),
            {"ticket_id": ticket_id, "tenant_id": str(tenant.id)},
        )
    ).fetchall()

    for r in comment_rows:
        is_customer = r.source == "customer_portal"
        author_name = customer.name if is_customer else (r.user_name or "담당자")
        events.append(
            PortalTimelineEventOut(
                id=str(r.id),
                type="comment",
                body=r.body,
                author_name=author_name,
                is_customer=is_customer,
                created_at=r.created_at,
            )
        )

    return events


# ===========================================================================
# CA-P1-5 Phase 2: 서비스 카탈로그 포털 엔드포인트
#
# GET  /portal/{tenant_slug}/catalog           — 활성 카테고리 + offering 트리
# GET  /portal/{tenant_slug}/catalog/{code}    — 단일 offering + form_schema
# POST /portal/{tenant_slug}/tickets           — 카탈로그 기반 티켓 생성 (신설)
# ===========================================================================

import logging as _logging

_cat_logger = _logging.getLogger(__name__)


# ------------------------------------------------------------------
# 카탈로그 스키마
# ------------------------------------------------------------------


class CatalogOfferingCard(BaseModel):
    """카탈로그 목록용 카드 — form_schema 제외."""

    code: str
    name: str
    description: str | None = None
    icon: str | None = None
    request_type: str
    default_priority: str


class CatalogCategoryOut(BaseModel):
    """카테고리 + 소속 offering 트리."""

    id: str
    name: str
    slug: str
    icon: str | None = None
    display_order: int
    offerings: list[CatalogOfferingCard] = []


class CatalogOfferingDetailOut(BaseModel):
    """단일 offering 상세 — form_schema 포함 (동적 폼 렌더용)."""

    id: str
    code: str
    name: str
    description: str | None = None
    icon: str | None = None
    request_type: str
    default_priority: str
    default_sla_grade: str | None = None
    form_schema: dict
    category_id: str | None = None


class PortalCatalogTicketCreate(BaseModel):
    """카탈로그 기반 티켓 생성 요청."""

    offering_code: str
    title: str = Field(..., max_length=500)
    form_data: dict
    priority: str | None = None  # offering.default_priority override


class PortalCatalogTicketOut(BaseModel):
    """카탈로그 티켓 생성 응답."""

    id: str
    ticket_number: str | None
    title: str
    status: str
    priority: str
    offering_code: str
    gw_approval_status: str | None = None
    created_at: datetime


# ------------------------------------------------------------------
# 헬퍼: offering.default_sla_grade 기반 SLA 마감 계산
# ------------------------------------------------------------------


async def _compute_sla_by_grade(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    grade: str,
    base_time: datetime,
) -> tuple[datetime | None, datetime | None]:
    """sla_policies 테이블에서 grade 직접 조회하여 response/resolution 마감 계산."""
    row = (
        await db.execute(
            text("""
                SELECT response_minutes, resolution_minutes
                FROM sla_policies
                WHERE tenant_id = :tid AND grade = :grade
                LIMIT 1
            """),
            {"tid": str(tenant_id), "grade": grade},
        )
    ).first()
    if not row:
        return None, None
    return (
        base_time + timedelta(minutes=row.response_minutes),
        base_time + timedelta(minutes=row.resolution_minutes),
    )


# ------------------------------------------------------------------
# GET /portal/{tenant_slug}/catalog — 활성 카테고리 + offering 트리
# ------------------------------------------------------------------


@router.get(
    "/catalog",
    response_model=list[CatalogCategoryOut],
    summary="포털 서비스 카탈로그 목록 (카테고리 트리)",
)
async def portal_catalog_list(
    tenant_slug: str,
    db: AsyncSession = Depends(get_db),
    session_token: str | None = Cookie(default=None, alias=_SESSION_COOKIE),
) -> list[CatalogCategoryOut]:
    """활성 카테고리별로 그룹화된 서비스 offering 목록을 반환합니다.
    form_schema는 포함하지 않습니다(목록은 메타만).
    """
    tenant = await _get_tenant(db, tenant_slug)
    customer = await _get_customer_from_session(db, tenant.id, session_token)
    if not customer:
        raise HTTPException(status_code=401, detail="인증이 필요합니다.")

    from app.models.service_catalog import ServiceCategory, ServiceOffering

    # 활성 카테고리 (is_active=True, display_order ASC)
    cat_rows = (
        await db.execute(
            select(ServiceCategory)
            .where(
                and_(
                    ServiceCategory.tenant_id == tenant.id,
                    ServiceCategory.is_active.is_(True),
                )
            )
            .order_by(ServiceCategory.display_order)
        )
    ).scalars().all()

    # 활성 offering (is_active=True, display_order ASC)
    off_rows = (
        await db.execute(
            select(ServiceOffering)
            .where(
                and_(
                    ServiceOffering.tenant_id == tenant.id,
                    ServiceOffering.is_active.is_(True),
                )
            )
            .order_by(ServiceOffering.display_order)
        )
    ).scalars().all()

    # offering → category_id 기준 그룹핑
    cat_to_offerings: dict[uuid.UUID | None, list[CatalogOfferingCard]] = {}
    for off in off_rows:
        card = CatalogOfferingCard(
            code=off.code,
            name=off.name,
            description=off.description,
            icon=off.icon,
            request_type=off.request_type,
            default_priority=(
                off.default_priority
                if isinstance(off.default_priority, str)
                else off.default_priority.value
            ),
        )
        cat_to_offerings.setdefault(off.category_id, []).append(card)

    result: list[CatalogCategoryOut] = []
    cat_ids_seen: set[uuid.UUID] = set()

    for cat in cat_rows:
        cat_ids_seen.add(cat.id)
        result.append(
            CatalogCategoryOut(
                id=str(cat.id),
                name=cat.name,
                slug=cat.slug,
                icon=cat.icon,
                display_order=cat.display_order,
                offerings=cat_to_offerings.get(cat.id, []),
            )
        )

    # 카테고리 없는(category_id IS NULL 또는 비활성 카테고리) offering → 기타
    uncategorized: list[CatalogOfferingCard] = []
    for cid, cards in cat_to_offerings.items():
        if cid is None or cid not in cat_ids_seen:
            uncategorized.extend(cards)

    if uncategorized:
        result.append(
            CatalogCategoryOut(
                id="uncategorized",
                name="기타",
                slug="uncategorized",
                icon=None,
                display_order=9999,
                offerings=uncategorized,
            )
        )

    return result


# ------------------------------------------------------------------
# GET /portal/{tenant_slug}/catalog/{code} — 단일 offering + form_schema
# ------------------------------------------------------------------


@router.get(
    "/catalog/{code}",
    response_model=CatalogOfferingDetailOut,
    summary="포털 서비스 카탈로그 단일 오퍼링 (form_schema 포함)",
)
async def portal_catalog_detail(
    tenant_slug: str,
    code: str,
    db: AsyncSession = Depends(get_db),
    session_token: str | None = Cookie(default=None, alias=_SESSION_COOKIE),
) -> CatalogOfferingDetailOut:
    """단일 서비스 offering을 반환합니다. form_schema를 포함합니다(동적 폼 렌더용)."""
    tenant = await _get_tenant(db, tenant_slug)
    customer = await _get_customer_from_session(db, tenant.id, session_token)
    if not customer:
        raise HTTPException(status_code=401, detail="인증이 필요합니다.")

    from app.models.service_catalog import ServiceOffering

    offering = (
        await db.execute(
            select(ServiceOffering).where(
                and_(
                    ServiceOffering.tenant_id == tenant.id,
                    ServiceOffering.code == code,
                    ServiceOffering.is_active.is_(True),
                )
            )
        )
    ).scalar_one_or_none()

    if not offering:
        raise HTTPException(status_code=404, detail="서비스 항목을 찾을 수 없습니다.")

    return CatalogOfferingDetailOut(
        id=str(offering.id),
        code=offering.code,
        name=offering.name,
        description=offering.description,
        icon=offering.icon,
        request_type=offering.request_type,
        default_priority=(
            offering.default_priority
            if isinstance(offering.default_priority, str)
            else offering.default_priority.value
        ),
        default_sla_grade=(
            offering.default_sla_grade
            if isinstance(offering.default_sla_grade, str)
            else (offering.default_sla_grade.value if offering.default_sla_grade else None)
        ),
        form_schema=offering.form_schema or {},
        category_id=str(offering.category_id) if offering.category_id else None,
    )


# ------------------------------------------------------------------
# POST /portal/{tenant_slug}/tickets — 카탈로그 기반 티켓 생성 (신설)
# ------------------------------------------------------------------


@router.post(
    "/tickets",
    response_model=PortalCatalogTicketOut,
    status_code=201,
    summary="포털 서비스 카탈로그 티켓 생성",
)
async def portal_create_catalog_ticket(
    tenant_slug: str,
    body: PortalCatalogTicketCreate,
    db: AsyncSession = Depends(get_db),
    session_token: str | None = Cookie(default=None, alias=_SESSION_COOKIE),
) -> PortalCatalogTicketOut:
    """서비스 카탈로그 offering 기반으로 티켓을 생성합니다.

    처리 순서:
      1. 세션 인증 + offering 조회 (tenant+code, is_active=True)
      2. form_data → offering.form_schema 서버 검증 (422 + 필드별 에러 반환)
      3. ticket_number 발번 (기존 _generate_ticket_number 재사용)
      4. SLA: offering.default_sla_grade 있으면 grade 기반 계산
      5. Ticket INSERT + ServiceOfferingSubmission INSERT
      6. 결재 트리거: offering.approval_policy.required == True이면 GW 기안 (graceful)
    """
    tenant = await _get_tenant(db, tenant_slug)
    customer = await _get_customer_from_session(db, tenant.id, session_token)
    if not customer:
        raise HTTPException(status_code=401, detail="인증이 필요합니다.")

    # ── 1. Offering 조회 ──────────────────────────────────────────
    from app.models.service_catalog import ServiceOffering, ServiceOfferingSubmission
    from app.models.ticket import Ticket, TicketChannel, TicketStatus, TicketPriority
    from app.services.catalog_form import validate_form_data
    from app.routers.tickets import _generate_ticket_number
    from app.services import activity_service

    offering = (
        await db.execute(
            select(ServiceOffering).where(
                and_(
                    ServiceOffering.tenant_id == tenant.id,
                    ServiceOffering.code == body.offering_code,
                    ServiceOffering.is_active.is_(True),
                )
            )
        )
    ).scalar_one_or_none()

    if not offering:
        raise HTTPException(status_code=404, detail="서비스 항목을 찾을 수 없습니다.")

    # ── 2. form_data 서버 검증 ────────────────────────────────────
    ok, form_errors = validate_form_data(
        form_schema=offering.form_schema or {},
        form_data=body.form_data,
    )
    if not ok:
        raise HTTPException(
            status_code=422,
            detail={"message": "폼 데이터 검증에 실패했습니다.", "errors": form_errors},
        )

    # ── 3. priority 결정 (요청 override 허용) ─────────────────────
    _valid_priorities = {"low", "medium", "high", "critical"}
    if body.priority and body.priority in _valid_priorities:
        priority_val = body.priority
    else:
        priority_val = (
            offering.default_priority
            if isinstance(offering.default_priority, str)
            else offering.default_priority.value
        )

    # ── 4. ticket_number 발번 ──────────────────────────────────────
    ticket_number = await _generate_ticket_number(db, tenant.id)

    # ── 5. SLA 마감 계산 ─────────────────────────────────────────
    now = datetime.now(timezone.utc)
    sla_response_deadline: datetime | None = None
    sla_resolution_deadline: datetime | None = None

    if offering.default_sla_grade:
        grade_str = (
            offering.default_sla_grade
            if isinstance(offering.default_sla_grade, str)
            else offering.default_sla_grade.value
        )
        sla_response_deadline, sla_resolution_deadline = await _compute_sla_by_grade(
            db, tenant.id, grade_str, now
        )

    # ── 6. Ticket INSERT ───────────────────────────────────────────
    ticket = Ticket(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        title=body.title,
        description=None,
        priority=priority_val,
        status=TicketStatus.open,
        channel=TicketChannel.portal,
        customer_id=customer.id,
        contract_id=None,
        assigned_to=None,
        source="customer_direct",
        request_type=offering.request_type,
        ticket_number=ticket_number,
        sla_response_deadline=sla_response_deadline,
        sla_resolution_deadline=sla_resolution_deadline,
        service_offering_id=offering.id,
    )
    db.add(ticket)

    await activity_service.record(
        db,
        tenant_id=tenant.id,
        ticket_id=ticket.id,
        actor_id=None,  # 포털 고객 — 내부 User 없음
        event_type="created",
        to_value=ticket.title,
        meta={
            "priority": priority_val,
            "channel": "portal",
            "source": "customer_direct",
            "offering_code": offering.code,
        },
    )

    # ── 7. ServiceOfferingSubmission INSERT ───────────────────────
    submission = ServiceOfferingSubmission(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        ticket_id=ticket.id,
        offering_id=offering.id,
        offering_version=1,
        form_data=body.form_data,
    )
    db.add(submission)

    # 1차 commit: 티켓 + 제출 레코드 확정
    await db.commit()
    await db.refresh(ticket)

    # ── 8. 결재 트리거 (graceful) ─────────────────────────────────
    approval_policy = offering.approval_policy or {}
    if isinstance(approval_policy, dict) and approval_policy.get("required") and customer.email:
        from app.services import gw_approval_service

        gw_result = None
        try:
            gw_result = await gw_approval_service.submit_approval_draft(
                requester_email=customer.email,
                title=f"[포털 서비스요청] {offering.name} — {ticket.title}",
                content_text=(
                    f"티켓 번호: {ticket.ticket_number}\n"
                    f"서비스 항목: {offering.name} ({offering.code})\n"
                    f"요청자: {customer.name} ({customer.email})\n"
                    f"우선순위: {priority_val}\n"
                    f"제목: {ticket.title}"
                ),
            )
        except Exception:
            _cat_logger.exception(
                "포털 카탈로그 GW 결재 기안 중 예외 (graceful skip): ticket=%s", ticket.id
            )

        if gw_result:
            ticket.gw_approval_doc_id = str(gw_result.get("id", ""))
            ticket.gw_approval_status = "pending"
            _cat_logger.info(
                "포털 카탈로그 GW 결재 기안 성공: ticket=%s doc_id=%s",
                ticket.id, ticket.gw_approval_doc_id,
            )
        else:
            ticket.gw_approval_status = "gw_not_configured"
            _cat_logger.info(
                "포털 카탈로그 GW 결재 휴면(env 미설정 또는 기안 실패): ticket=%s offering=%s",
                ticket.id, offering.code,
            )

        # 2차 commit: gw_approval_doc_id / gw_approval_status 저장
        # 실패해도 티켓 자체는 1차 commit으로 이미 확정 — 로그만 남김
        try:
            await db.commit()
            await db.refresh(ticket)
        except Exception:
            # reviewer 🟡3: 2차 commit 실패 시 DB는 1차 상태(gw_approval_status=NULL)인데
            # 응답이 in-memory "pending"을 반환하면 호출자가 결재 기안됐다고 오인.
            # 세션 롤백 + in-memory 값을 DB 실제(미저장)로 리셋해 응답 정합.
            await db.rollback()
            ticket.gw_approval_status = None
            ticket.gw_approval_doc_id = None
            _cat_logger.error(
                "포털 카탈로그 결재 2차 commit 실패 (graceful): ticket=%s", ticket.id
            )

    return PortalCatalogTicketOut(
        id=str(ticket.id),
        ticket_number=ticket.ticket_number,
        title=ticket.title,
        status=(
            ticket.status
            if isinstance(ticket.status, str)
            else ticket.status.value
        ),
        priority=(
            ticket.priority
            if isinstance(ticket.priority, str)
            else ticket.priority.value
        ),
        offering_code=offering.code,
        gw_approval_status=ticket.gw_approval_status,
        created_at=ticket.created_at,
    )
