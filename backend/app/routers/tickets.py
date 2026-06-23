"""티켓 라우터.

prefix : /{tenant_slug}/tickets
인증   : get_current_user
격리   : 모든 쿼리 tenant_id == current_user.tenant_id

엔드포인트:
  GET    /{tenant_slug}/tickets                          — 목록 (필터 + 페이지네이션)
  POST   /{tenant_slug}/tickets                          — 생성 (ticket_number 자동 부여)
  GET    /{tenant_slug}/tickets/{id}                     — 상세 (댓글 포함)
  PATCH  /{tenant_slug}/tickets/{id}                     — 수정
  DELETE /{tenant_slug}/tickets/{id}                     — 삭제 (admin/team_lead)
  POST   /{tenant_slug}/tickets/{id}/comments            — 댓글 추가
  POST   /{tenant_slug}/tickets/bulk-status              — 대량 상태 변경
  POST   /{tenant_slug}/tickets/{id}/sub-tickets         — 서브티켓 생성
  GET    /{tenant_slug}/tickets/{id}/sub-tickets         — 서브티켓 목록
  POST   /{tenant_slug}/tickets/{id}/causes              — 원인 확정 등록
  GET    /{tenant_slug}/symptom-categories               — 증상 분류 트리
  GET    /{tenant_slug}/cause-categories                 — 원인 분류 트리
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import and_, func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user, require_roles
from app.services import gw_approval_service
from app.models import (
    CauseCategory,
    SymptomCategory,
    Ticket,
    TicketCause,
    TicketChannel,
    TicketComment,
    TicketPriority,
    TicketStatus,
    TicketWorkLog,
    User,
    UserRole,
)
from app.services import search_service
from app.services import activity_service
from app.models.ticket_activity import TicketActivity

logger = logging.getLogger(__name__)
_SENTINEL = object()  # update_ticket에서 "필드 미전달" vs None 구분용

# 분류 트리 라우터 (/{tenant_slug}/symptom-categories, /{tenant_slug}/cause-categories)
classification_router = APIRouter(tags=["classifications"])

router = APIRouter(
    prefix="/{tenant_slug}/tickets",
    tags=["tickets"],
)

_ADMIN_ROLES = (UserRole.admin, UserRole.team_lead)


# ------------------------------------------------------------------
# 스키마
# ------------------------------------------------------------------


class TicketCreate(BaseModel):
    title: str = Field(..., max_length=500)
    description: str | None = None
    priority: TicketPriority = TicketPriority.medium
    channel: TicketChannel = TicketChannel.internal
    customer_id: uuid.UUID | None = None
    contract_id: uuid.UUID | None = None
    assigned_to: uuid.UUID | None = None
    source: str | None = None         # customer_direct | customer_relay | engineer_found | monitoring
    request_type: str | None = None   # incident | service_request | installation | upgrade | technical_inquiry | maintenance
    parent_ticket_id: uuid.UUID | None = None


class TicketUpdate(BaseModel):
    title: str | None = Field(None, max_length=500)
    description: str | None = None
    priority: TicketPriority | None = None
    status: TicketStatus | None = None
    assigned_to: uuid.UUID | None = None
    contract_id: uuid.UUID | None = None
    source: str | None = None
    request_type: str | None = None


class TicketOut(BaseModel):
    id: uuid.UUID
    tenant_id: uuid.UUID
    title: str
    description: str | None
    priority: str
    status: str
    channel: str
    customer_id: uuid.UUID | None
    contract_id: uuid.UUID | None
    assigned_to: uuid.UUID | None
    source: str | None
    request_type: str | None
    parent_ticket_id: uuid.UUID | None
    ticket_number: str | None
    sla_response_deadline: datetime | None = None
    sla_resolution_deadline: datetime | None = None
    total_hours: float | None = None
    customer_name: str | None = None
    assignee_name: str | None = None
    created_at: datetime
    updated_at: datetime
    resolved_at: datetime | None
    closed_at: datetime | None
    # WF-1 (ADR-048): GW 결재 연동 필드
    gw_approval_doc_id: str | None = None
    gw_approval_status: str | None = None

    model_config = {"from_attributes": True}


class CategoryNode(BaseModel):
    id: uuid.UUID
    name: str
    display_order: int
    children: list["CategoryNode"] = []

    model_config = {"from_attributes": True}


class CauseIn(BaseModel):
    cause_category_id: uuid.UUID
    action_taken: str | None = None


class CausesRegisterRequest(BaseModel):
    causes: list[CauseIn] = Field(..., min_length=1)


class CommentCreate(BaseModel):
    body: str = Field(..., min_length=1)
    is_internal: bool = False


class CommentOut(BaseModel):
    id: uuid.UUID
    ticket_id: uuid.UUID
    author_id: uuid.UUID
    body: str
    is_internal: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class BulkStatusRequest(BaseModel):
    ticket_ids: list[uuid.UUID] = Field(..., min_length=1, max_length=200)
    status: TicketStatus


# ------------------------------------------------------------------
# 헬퍼
# ------------------------------------------------------------------


async def _get_ticket_or_404(
    db: AsyncSession, tenant_id: uuid.UUID, ticket_id: uuid.UUID
) -> Ticket:
    row = await db.scalar(
        select(Ticket).where(
            and_(Ticket.id == ticket_id, Ticket.tenant_id == tenant_id)
        )
    )
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="티켓을 찾을 수 없습니다.")
    return row


async def _generate_ticket_number(db: AsyncSession, tenant_id: uuid.UUID) -> str:
    """TKT-YYYYMMDD-NNNN 형식 ticket_number 생성.

    pg_advisory_xact_lock으로 (tenant, date) 단위 직렬화 — 동시 생성 시 중복 방지.
    트랜잭션 범위 lock이므로 commit/rollback 시 자동 해제.
    """
    today = datetime.now(timezone.utc).strftime("%Y%m%d")
    prefix = f"TKT-{today}-"
    # advisory lock key: tenant_id + date 기반 정수 (31비트 범위)
    lock_key = abs(hash(f"{tenant_id}:{today}")) % (2 ** 31)
    await db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": lock_key})

    result = await db.execute(
        text("""
            SELECT COALESCE(
                MAX(CAST(SUBSTRING(ticket_number FROM :prefix_len + 1) AS INTEGER)),
                0
            )
            FROM tickets
            WHERE tenant_id = :tid
              AND ticket_number LIKE :prefix
        """),
        {"prefix_len": len(prefix), "prefix": f"{prefix}%", "tid": str(tenant_id)},
    )
    max_seq = result.scalar() or 0
    return f"{prefix}{str(max_seq + 1).zfill(4)}"


async def _compute_sla_deadlines(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    contract_id: uuid.UUID | None,
    base_time: datetime,
) -> tuple[datetime | None, datetime | None]:
    """계약 SLA 정책에서 response/resolution 마감 시각 계산."""
    if not contract_id:
        return None, None
    row = await db.execute(
        text("""
            SELECT sp.response_minutes, sp.resolution_minutes
            FROM sla_policies sp
            JOIN contracts c
                ON c.tenant_id = sp.tenant_id
               AND sp.grade = c.sla_grade
            WHERE c.id = :cid AND c.tenant_id = :tid
            LIMIT 1
        """),
        {"cid": str(contract_id), "tid": str(tenant_id)},
    )
    policy = row.first()
    if not policy:
        return None, None
    return (
        base_time + timedelta(minutes=policy.response_minutes),
        base_time + timedelta(minutes=policy.resolution_minutes),
    )


def _build_category_tree(
    nodes: list, parent_id: uuid.UUID | None
) -> list[CategoryNode]:
    children = [n for n in nodes if n.parent_id == parent_id]
    return [
        CategoryNode(
            id=n.id,
            name=n.name,
            display_order=n.display_order,
            children=_build_category_tree(nodes, n.id),
        )
        for n in sorted(children, key=lambda x: x.display_order)
    ]


def _apply_resolved_closed(ticket: Ticket, new_status: TicketStatus) -> None:
    now = datetime.now(timezone.utc)
    if new_status == TicketStatus.resolved and ticket.resolved_at is None:
        ticket.resolved_at = now
    elif new_status == TicketStatus.closed and ticket.closed_at is None:
        ticket.closed_at = now


# WF-1 (ADR-048): GW 결재 선행 티켓 유형 — 이 request_type이면 GW 결재 자동 기안
_WF1_APPROVAL_REQUEST_TYPES = frozenset({"license_request", "budget_request", "access_request"})


def _is_wf1_ticket(request_type: str | None) -> bool:
    """WF-1 결재 대상 여부."""
    return bool(request_type and request_type in _WF1_APPROVAL_REQUEST_TYPES)


# ------------------------------------------------------------------
# 목록 — bulk-status 고정 경로를 /{id} 이전에 등록
# ------------------------------------------------------------------


@router.post(
    "/bulk-status",
    status_code=status.HTTP_200_OK,
    summary="대량 상태 변경",
)
async def bulk_update_status(
    tenant_slug: str,
    data: BulkStatusRequest,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> dict:
    rows = (
        await db.execute(
            select(Ticket).where(
                and_(
                    Ticket.tenant_id == current_user.tenant_id,
                    Ticket.id.in_(data.ticket_ids),
                )
            )
        )
    ).scalars().all()

    updated = 0
    for ticket in rows:
        _apply_resolved_closed(ticket, data.status)
        ticket.status = data.status
        updated += 1

    await db.commit()
    return {"updated": updated}


@router.get(
    "",
    response_model=dict,
    summary="티켓 목록 (필터 + 페이지네이션)",
)
async def list_tickets(
    tenant_slug: str,
    ticket_status: TicketStatus | None = Query(None, alias="status"),
    priority: TicketPriority | None = Query(None),
    assigned_to: uuid.UUID | None = Query(None),
    customer_id: uuid.UUID | None = Query(None),
    search: str | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> dict:
    conditions = [Ticket.tenant_id == current_user.tenant_id]

    if ticket_status:
        conditions.append(Ticket.status == ticket_status)
    if priority:
        conditions.append(Ticket.priority == priority)
    if assigned_to:
        conditions.append(Ticket.assigned_to == assigned_to)
    if customer_id:
        conditions.append(Ticket.customer_id == customer_id)
    if search:
        conditions.append(Ticket.title.ilike(f"%{search}%"))

    where_clause = and_(*conditions)
    total = await db.scalar(
        select(func.count()).select_from(Ticket).where(where_clause)
    )
    hours_sq = (
        select(func.coalesce(func.sum(TicketWorkLog.hours), 0))
        .where(TicketWorkLog.ticket_id == Ticket.id)
        .correlate(Ticket)
        .scalar_subquery()
    )

    rows = (
        await db.execute(
            text("""
                SELECT
                    t.*,
                    COALESCE(SUM(wl.hours), 0) AS total_hours,
                    cu.name AS customer_name,
                    us.name AS assignee_name
                FROM tickets t
                LEFT JOIN customers cu ON cu.id = t.customer_id
                LEFT JOIN users us ON us.id = t.assigned_to
                LEFT JOIN ticket_work_logs wl ON wl.ticket_id = t.id
                WHERE t.tenant_id = :tenant_id
                  {status_cond}
                  {priority_cond}
                  {assigned_cond}
                  {customer_cond}
                  {search_cond}
                GROUP BY t.id, cu.name, us.name
                ORDER BY t.created_at DESC
                LIMIT :limit OFFSET :offset
            """.format(
                status_cond="AND t.status = :status" if ticket_status else "",
                priority_cond="AND t.priority = :priority" if priority else "",
                assigned_cond="AND t.assigned_to = :assigned_to" if assigned_to else "",
                customer_cond="AND t.customer_id = :customer_id" if customer_id else "",
                search_cond="AND t.title ILIKE :search" if search else "",
            )),
            {
                "tenant_id": str(current_user.tenant_id),
                **( {"status": ticket_status.value if hasattr(ticket_status, "value") else ticket_status} if ticket_status else {}),
                **( {"priority": priority.value if hasattr(priority, "value") else priority} if priority else {}),
                **( {"assigned_to": str(assigned_to)} if assigned_to else {}),
                **( {"customer_id": str(customer_id)} if customer_id else {}),
                **( {"search": f"%{search}%"} if search else {}),
                "limit": page_size,
                "offset": (page - 1) * page_size,
            },
        )
    ).mappings().all()

    items = []
    for row in rows:
        d = dict(row)
        d["total_hours"] = round(float(d.get("total_hours") or 0), 2)
        d["customer_name"] = d.get("customer_name")
        d["assignee_name"] = d.get("assignee_name")
        items.append(d)

    return {
        "items": items,
        "total": total or 0,
        "page": page,
        "page_size": page_size,
    }


# ------------------------------------------------------------------
# 생성
# ------------------------------------------------------------------


@router.post(
    "",
    response_model=TicketOut,
    status_code=status.HTTP_201_CREATED,
    summary="티켓 생성",
)
async def create_ticket(
    tenant_slug: str,
    data: TicketCreate,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> TicketOut:
    # 플랜 티켓 한도 확인
    try:
        from app.services import billing_service
        from app.core.redis import get_redis
        await billing_service.check_ticket_limit(db, current_user.tenant_id, get_redis())
    except Exception as e:
        if hasattr(e, "status_code") and e.status_code == 402:
            raise
        pass  # 빌링 서비스 오류는 graceful skip

    ticket_number = await _generate_ticket_number(db, current_user.tenant_id)
    now = datetime.now(timezone.utc)
    sla_response_deadline, sla_resolution_deadline = await _compute_sla_deadlines(
        db, current_user.tenant_id, data.contract_id, now
    )
    ticket = Ticket(
        id=uuid.uuid4(),
        tenant_id=current_user.tenant_id,
        title=data.title,
        description=data.description,
        priority=data.priority,
        status=TicketStatus.open,
        channel=data.channel,
        customer_id=data.customer_id,
        contract_id=data.contract_id,
        assigned_to=data.assigned_to,
        source=data.source,
        request_type=data.request_type,
        parent_ticket_id=data.parent_ticket_id,
        ticket_number=ticket_number,
        sla_response_deadline=sla_response_deadline,
        sla_resolution_deadline=sla_resolution_deadline,
    )
    db.add(ticket)
    await activity_service.record(
        db,
        tenant_id=current_user.tenant_id,
        ticket_id=ticket.id,
        actor_id=current_user.id,
        event_type="created",
        to_value=ticket.title,
        meta={"priority": str(ticket.priority), "channel": str(ticket.channel)},
    )
    await db.commit()
    await db.refresh(ticket)

    # WF-1 (ADR-048): 결재 선행 유형 → GW 결재 자동 기안
    # 멱등성: gw_approval_doc_id IS NULL 일 때만. 외부 HTTP는 1차 commit 후 독립 처리.
    # graceful: GW/KC 미설정 시 None 반환 → 티켓 흐름 차단 금지.
    # 상태 폴링·자동클로즈는 요청 경로에서 완전 제거 — wf1_approval_worker 전담.
    if _is_wf1_ticket(data.request_type):
        gw_result = None
        try:
            gw_result = await gw_approval_service.submit_approval_draft(
                requester_email=current_user.email,
                title=f"[ITSM] {ticket.title}",
                content_text=(
                    f"티켓 번호: {ticket.ticket_number}\n"
                    f"유형: {data.request_type}\n"
                    f"내용: {ticket.description or ticket.title}"
                ),
            )
        except Exception:
            logger.exception("WF-1 GW 결재 기안 중 예외 (graceful skip): ticket=%s", ticket.id)

        if gw_result:
            ticket.gw_approval_doc_id = str(gw_result.get("id", ""))
            ticket.gw_approval_status = "pending"
            logger.info(
                "WF-1 GW 결재 기안 성공: ticket=%s doc_id=%s",
                ticket.id, ticket.gw_approval_doc_id,
            )
        else:
            ticket.gw_approval_status = "gw_not_configured"
            logger.info(
                "WF-1 GW 결재 휴면(env 미설정 또는 기안 실패): ticket=%s request_type=%s",
                ticket.id, data.request_type,
            )

        # 2차 commit: gw_approval_doc_id / gw_approval_status 저장.
        # 실패해도 티켓 자체는 이미 1차 commit으로 생성됨 — orphan doc_id 추적용 로그만.
        try:
            await db.commit()
            await db.refresh(ticket)
        except Exception:
            doc_id = ticket.gw_approval_doc_id or "(미발급)"
            logger.error(
                "WF-1 2차 commit 실패 — gw_approval_doc_id orphan 가능: ticket=%s doc_id=%s",
                ticket.id,
                doc_id,
            )

    # Meilisearch 인덱싱 (graceful fallback)
    await search_service.index_ticket(
        search_service.TicketDoc(
            id=str(ticket.id),
            tenant_id=str(ticket.tenant_id),
            title=ticket.title,
            description=ticket.description or "",
            status=ticket.status if isinstance(ticket.status, str) else ticket.status.value,
            priority=ticket.priority if isinstance(ticket.priority, str) else ticket.priority.value,
            customer_name="",
            assignee_name="",
            created_at=ticket.created_at.isoformat() if ticket.created_at else "",
        )
    )

    # 담당자 알림 (graceful)
    if ticket.assigned_to:
        try:
            from app.services.notification_service import notify_ticket_created
            await notify_ticket_created(db, ticket, assigned_user_phone=None)
        except Exception:
            pass

    # Webhook: ticket.created
    try:
        from app.services import webhook_service
        await webhook_service.fire(
            "ticket.created",
            {"ticket_id": str(ticket.id), "number": ticket.ticket_number, "title": ticket.title, "status": str(ticket.status), "priority": str(ticket.priority)},
            current_user.tenant_id,
            db,
        )
    except Exception:
        pass

    return TicketOut.model_validate(ticket)


# ------------------------------------------------------------------
# 상세 (댓글 포함)
# ------------------------------------------------------------------


@router.get(
    "/{ticket_id}",
    response_model=dict,
    summary="티켓 상세 (댓글 포함)",
)
async def get_ticket(
    tenant_slug: str,
    ticket_id: uuid.UUID,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> dict:
    ticket = await _get_ticket_or_404(db, current_user.tenant_id, ticket_id)

    # WF-1 결재 상태 폴링·자동클로즈는 요청 경로에서 제거됨.
    # → wf1_approval_worker(120s 주기)가 백그라운드에서 전담.

    comments = (
        await db.execute(
            select(TicketComment)
            .where(
                and_(
                    TicketComment.ticket_id == ticket_id,
                    TicketComment.tenant_id == current_user.tenant_id,
                )
            )
            .order_by(TicketComment.created_at.asc())
        )
    ).scalars().all()

    return {
        "ticket": TicketOut.model_validate(ticket),
        "comments": [CommentOut.model_validate(c) for c in comments],
    }


# ------------------------------------------------------------------
# 수정
# ------------------------------------------------------------------


@router.patch(
    "/{ticket_id}",
    response_model=TicketOut,
    summary="티켓 수정",
)
async def update_ticket(
    tenant_slug: str,
    ticket_id: uuid.UUID,
    data: TicketUpdate,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> TicketOut:
    ticket = await _get_ticket_or_404(db, current_user.tenant_id, ticket_id)

    update_fields = data.model_dump(exclude_unset=True)
    new_contract_id = update_fields.get("contract_id", _SENTINEL)

    # 변경 전 값 스냅샷 (활동 기록용)
    _prev_status   = str(ticket.status.value if hasattr(ticket.status, "value") else ticket.status)
    _prev_priority = str(ticket.priority.value if hasattr(ticket.priority, "value") else ticket.priority)
    _prev_assigned = str(ticket.assigned_to) if ticket.assigned_to else None

    for field, value in update_fields.items():
        if field == "status" and value is not None:
            _apply_resolved_closed(ticket, value)
            # resolved/closed → open/in_progress 재개 시 reopen_count 증가
            prev_status = ticket.status if isinstance(ticket.status, str) else ticket.status.value
            is_reopened = (
                prev_status in ("resolved", "closed")
                and value in (TicketStatus.open, TicketStatus.in_progress)
            )
            if is_reopened:
                ticket.reopen_count = (ticket.reopen_count or 0) + 1
            # resolved/closed → CSAT 설문 자동 생성 + 이메일 발송
            if value in (TicketStatus.resolved, TicketStatus.closed):
                from app.services.csat_service import maybe_create_survey
                await maybe_create_survey(db, ticket)
            # 해결 알림 (graceful)
            if value == TicketStatus.resolved:
                try:
                    from app.services.notification_service import notify_ticket_resolved
                    await notify_ticket_resolved(db, ticket, customer_phone=None)
                except Exception:
                    pass
        # 최초 담당자 배정 시 first_responded_at 기록 (KPI-1 MTTA)
        if field == "assigned_to" and value is not None and ticket.first_responded_at is None:
            ticket.first_responded_at = datetime.now(timezone.utc)
        setattr(ticket, field, value)

    # contract_id 변경 시 SLA deadline 재계산
    if new_contract_id is not _SENTINEL:
        r_dl, res_dl = await _compute_sla_deadlines(
            db, current_user.tenant_id, new_contract_id, ticket.created_at
        )
        ticket.sla_response_deadline = r_dl
        ticket.sla_resolution_deadline = res_dl

    # 활동 이벤트 기록
    _new_status   = str(ticket.status.value if hasattr(ticket.status, "value") else ticket.status)
    _new_priority = str(ticket.priority.value if hasattr(ticket.priority, "value") else ticket.priority)
    _new_assigned = str(ticket.assigned_to) if ticket.assigned_to else None

    if "status" in update_fields and _prev_status != _new_status:
        await activity_service.record(
            db, tenant_id=current_user.tenant_id, ticket_id=ticket.id,
            actor_id=current_user.id, event_type="status_changed",
            from_value=_prev_status, to_value=_new_status,
        )
    if "priority" in update_fields and _prev_priority != _new_priority:
        await activity_service.record(
            db, tenant_id=current_user.tenant_id, ticket_id=ticket.id,
            actor_id=current_user.id, event_type="priority_changed",
            from_value=_prev_priority, to_value=_new_priority,
        )
    if "assigned_to" in update_fields and _prev_assigned != _new_assigned:
        await activity_service.record(
            db, tenant_id=current_user.tenant_id, ticket_id=ticket.id,
            actor_id=current_user.id, event_type="assigned",
            from_value=_prev_assigned, to_value=_new_assigned,
        )

    await db.commit()
    await db.refresh(ticket)

    # Webhook: status_changed / assigned (graceful)
    try:
        from app.services import webhook_service as _wh
        _fields = data.model_dump(exclude_unset=True)
        if "status" in _fields:
            await _wh.fire(
                "ticket.status_changed",
                {"ticket_id": str(ticket.id), "status": str(ticket.status)},
                current_user.tenant_id, db,
            )
        if "assigned_to" in _fields and _fields["assigned_to"]:
            await _wh.fire(
                "ticket.assigned",
                {"ticket_id": str(ticket.id), "assigned_to": str(ticket.assigned_to)},
                current_user.tenant_id, db,
            )
    except Exception:
        pass

    return TicketOut.model_validate(ticket)


# ------------------------------------------------------------------
# 삭제 (admin/team_lead)
# ------------------------------------------------------------------


@router.delete(
    "/{ticket_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="티켓 삭제 (admin/team_lead)",
)
async def delete_ticket(
    tenant_slug: str,
    ticket_id: uuid.UUID,
    current_user: Annotated[User, Depends(require_roles(UserRole.admin, UserRole.team_lead))] = None,
    db: AsyncSession = Depends(get_db),
) -> None:
    ticket = await _get_ticket_or_404(db, current_user.tenant_id, ticket_id)
    await db.delete(ticket)
    await db.commit()
    # Meilisearch 삭제 (graceful fallback)
    await search_service.delete_ticket(str(current_user.tenant_id), str(ticket_id))


# ------------------------------------------------------------------
# AI 답변 초안 제안 (P3-2)
# ------------------------------------------------------------------


@router.post(
    "/{ticket_id}/ai-suggest-reply",
    summary="KB 기반 AI 답변 초안 제안 (Claude sonnet-4-6)",
)
async def ai_suggest_reply(
    tenant_slug: str,
    ticket_id: uuid.UUID,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """KB 문서를 근거로 Claude가 답변 초안을 생성합니다.

    상담원이 검토 후 발송 — 자동 발송 아님.

    반환:
        {"draft": "초안 텍스트", "kb_sources": [{"id": "...", "title": "..."}]}
        ANTHROPIC_API_KEY 미설정:
        {"draft": null, "reason": "ai_disabled", "kb_sources": []}
    """
    from app.services import ai_service

    ticket = await _get_ticket_or_404(db, current_user.tenant_id, ticket_id)

    # ANTHROPIC_API_KEY 미설정 → 즉시 graceful 반환 (500 금지)
    from app.core.config import settings as _settings
    if not _settings.ANTHROPIC_API_KEY:
        return {"draft": None, "reason": "ai_disabled", "kb_sources": []}

    # 1) 관련 KB 문서 조회 (suggest_kb_articles — OpenAI 임베딩 기반)
    kb_articles = await ai_service.suggest_kb_articles(
        title=ticket.title,
        description=ticket.description,
        tenant_id=current_user.tenant_id,
        db=db,
        top_k=3,
    )

    # 고객 컨텍스트: customer 이름 조회 (graceful)
    customer_context: str | None = None
    if ticket.customer_id:
        try:
            row = await db.execute(
                text("SELECT name FROM customers WHERE id = :cid AND tenant_id = :tid LIMIT 1"),
                {"cid": str(ticket.customer_id), "tid": str(current_user.tenant_id)},
            )
            customer_row = row.first()
            if customer_row:
                customer_context = customer_row[0]
        except Exception:
            pass

    ticket_status_str = (
        ticket.status.value if hasattr(ticket.status, "value") else str(ticket.status)
    )

    # 2) 답변 초안 생성
    draft = await ai_service.suggest_ticket_reply(
        ticket_title=ticket.title,
        ticket_description=ticket.description,
        ticket_status=ticket_status_str,
        customer_context=customer_context,
        kb_articles=kb_articles,
    )

    kb_sources = [{"id": art["id"], "title": art["title"]} for art in kb_articles]

    if draft is None:
        return {"draft": None, "reason": "ai_error", "kb_sources": kb_sources}

    return {"draft": draft, "kb_sources": kb_sources}


# ------------------------------------------------------------------
# AI KB 제안 (AI-3)
# ------------------------------------------------------------------


@router.get(
    "/{ticket_id}/kb-suggestions",
    summary="티켓 관련 KB 문서 AI 추천 (Top 3)",
)
async def get_kb_suggestions(
    tenant_slug: str,
    ticket_id: uuid.UUID,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    """OPENAI_API_KEY 미설정 시 빈 리스트 반환 (graceful)."""
    ticket = await _get_ticket_or_404(db, current_user.tenant_id, ticket_id)
    from app.services import ai_service
    return await ai_service.suggest_kb_articles(
        title=ticket.title,
        description=ticket.description,
        tenant_id=current_user.tenant_id,
        db=db,
        top_k=3,
    )


# ------------------------------------------------------------------
# AI 티켓 분류 (AI-2)
# ------------------------------------------------------------------


@router.post(
    "/ai-classify",
    summary="AI 티켓 분류 제안 (Claude haiku)",
)
async def ai_classify_ticket(
    tenant_slug: str,
    body: dict,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """body: {title, description}. ANTHROPIC_API_KEY 미설정 시 빈 dict."""
    from app.services import ai_service
    result = await ai_service.classify_ticket(
        title=body.get("title", ""),
        description=body.get("description"),
        tenant_id=current_user.tenant_id,
        db=db,
    )
    return result or {}


# ------------------------------------------------------------------
# 댓글 목록 조회
# ------------------------------------------------------------------


@router.get(
    "/{ticket_id}/comments",
    response_model=list[CommentOut],
    summary="댓글 목록 (시간순)",
)
async def list_comments(
    tenant_slug: str,
    ticket_id: uuid.UUID,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> list[CommentOut]:
    await _get_ticket_or_404(db, current_user.tenant_id, ticket_id)
    comments = (
        await db.execute(
            select(TicketComment)
            .where(
                and_(
                    TicketComment.ticket_id == ticket_id,
                    TicketComment.tenant_id == current_user.tenant_id,
                )
            )
            .order_by(TicketComment.created_at.asc())
        )
    ).scalars().all()
    return [CommentOut.model_validate(c) for c in comments]


# ------------------------------------------------------------------
# 댓글 추가
# ------------------------------------------------------------------


@router.post(
    "/{ticket_id}/comments",
    response_model=CommentOut,
    status_code=status.HTTP_201_CREATED,
    summary="댓글 추가",
)
async def add_comment(
    tenant_slug: str,
    ticket_id: uuid.UUID,
    data: CommentCreate,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> CommentOut:
    ticket = await _get_ticket_or_404(db, current_user.tenant_id, ticket_id)

    # 최초 직원 댓글 시 first_responded_at 기록 (KPI-1 MTTA)
    if ticket.first_responded_at is None and not data.is_internal:
        ticket.first_responded_at = datetime.now(timezone.utc)

    comment = TicketComment(
        id=uuid.uuid4(),
        tenant_id=current_user.tenant_id,
        ticket_id=ticket_id,
        author_id=current_user.id,
        body=data.body,
        is_internal=data.is_internal,
    )
    db.add(comment)
    await activity_service.record(
        db, tenant_id=current_user.tenant_id, ticket_id=ticket_id,
        actor_id=current_user.id, event_type="comment_added",
        meta={"is_internal": data.is_internal, "preview": data.body[:100]},
    )
    await db.commit()
    await db.refresh(comment)
    return CommentOut.model_validate(comment)


# ------------------------------------------------------------------
# 서브티켓
# ------------------------------------------------------------------


@router.post(
    "/{ticket_id}/sub-tickets",
    response_model=TicketOut,
    status_code=status.HTTP_201_CREATED,
    summary="서브티켓 생성",
)
async def create_sub_ticket(
    tenant_slug: str,
    ticket_id: uuid.UUID,
    data: TicketCreate,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> TicketOut:
    await _get_ticket_or_404(db, current_user.tenant_id, ticket_id)
    ticket_number = await _generate_ticket_number(db, current_user.tenant_id)
    sub = Ticket(
        id=uuid.uuid4(),
        tenant_id=current_user.tenant_id,
        title=data.title,
        description=data.description,
        priority=data.priority,
        status=TicketStatus.open,
        channel=data.channel,
        customer_id=data.customer_id,
        contract_id=data.contract_id,
        assigned_to=data.assigned_to,
        source=data.source,
        request_type=data.request_type,
        parent_ticket_id=ticket_id,
        ticket_number=ticket_number,
    )
    db.add(sub)
    await db.commit()
    await db.refresh(sub)
    return TicketOut.model_validate(sub)


@router.get(
    "/{ticket_id}/sub-tickets",
    response_model=list[TicketOut],
    summary="서브티켓 목록",
)
async def list_sub_tickets(
    tenant_slug: str,
    ticket_id: uuid.UUID,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> list[TicketOut]:
    await _get_ticket_or_404(db, current_user.tenant_id, ticket_id)
    rows = (
        await db.execute(
            select(Ticket).where(
                and_(
                    Ticket.tenant_id == current_user.tenant_id,
                    Ticket.parent_ticket_id == ticket_id,
                )
            ).order_by(Ticket.created_at.asc())
        )
    ).scalars().all()
    return [TicketOut.model_validate(r) for r in rows]


# ------------------------------------------------------------------
# 원인 확정
# ------------------------------------------------------------------


@router.post(
    "/{ticket_id}/causes",
    status_code=status.HTTP_201_CREATED,
    summary="원인 확정 등록 (복수)",
)
async def register_causes(
    tenant_slug: str,
    ticket_id: uuid.UUID,
    data: CausesRegisterRequest,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> dict:
    await _get_ticket_or_404(db, current_user.tenant_id, ticket_id)

    # 기존 원인 삭제 후 재등록
    existing = (
        await db.execute(
            select(TicketCause).where(TicketCause.ticket_id == ticket_id)
        )
    ).scalars().all()
    for c in existing:
        await db.delete(c)

    for item in data.causes:
        cause = TicketCause(
            ticket_id=ticket_id,
            cause_category_id=item.cause_category_id,
            action_taken=item.action_taken,
        )
        db.add(cause)

    await db.commit()
    return {"registered": len(data.causes)}


# ------------------------------------------------------------------
# 분류 트리 (classification_router)
# ------------------------------------------------------------------


@classification_router.get(
    "/{tenant_slug}/symptom-categories",
    response_model=list[CategoryNode],
    summary="증상 분류 트리",
)
async def list_symptom_categories(
    tenant_slug: str,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> list[CategoryNode]:
    rows = (
        await db.execute(
            select(SymptomCategory)
            .where(SymptomCategory.tenant_id == current_user.tenant_id)
            .order_by(SymptomCategory.display_order)
        )
    ).scalars().all()
    return _build_category_tree(list(rows), None)


@classification_router.get(
    "/{tenant_slug}/cause-categories",
    response_model=list[CategoryNode],
    summary="원인 분류 트리",
)
async def list_cause_categories(
    tenant_slug: str,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
) -> list[CategoryNode]:
    rows = (
        await db.execute(
            select(CauseCategory)
            .where(CauseCategory.tenant_id == current_user.tenant_id)
            .order_by(CauseCategory.display_order)
        )
    ).scalars().all()
    return _build_category_tree(list(rows), None)


# ------------------------------------------------------------------
# 분류 체계 CRUD (team_lead+/admin)
# ------------------------------------------------------------------


class CategoryCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    parent_id: uuid.UUID | None = None


class CategoryUpdate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)


# ---- SymptomCategory CRUD ----

@classification_router.post(
    "/{tenant_slug}/symptom-categories",
    response_model=CategoryNode,
    status_code=status.HTTP_201_CREATED,
    summary="증상 분류 생성 (team_lead+)",
)
async def create_symptom_category(
    tenant_slug: str,
    data: CategoryCreate,
    current_user: Annotated[
        User, Depends(require_roles(UserRole.team_lead, UserRole.admin))
    ] = None,
    db: AsyncSession = Depends(get_db),
) -> CategoryNode:
    # 부모 존재 확인 (tenant 격리)
    if data.parent_id is not None:
        parent = await db.scalar(
            select(SymptomCategory).where(
                and_(
                    SymptomCategory.id == data.parent_id,
                    SymptomCategory.tenant_id == current_user.tenant_id,
                )
            )
        )
        if parent is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="부모 증상 분류를 찾을 수 없습니다.",
            )

    cat = SymptomCategory(
        id=uuid.uuid4(),
        tenant_id=current_user.tenant_id,
        name=data.name,
        parent_id=data.parent_id,
    )
    db.add(cat)
    await db.commit()
    await db.refresh(cat)
    return CategoryNode(id=cat.id, name=cat.name, display_order=cat.display_order)


@classification_router.patch(
    "/{tenant_slug}/symptom-categories/{category_id}",
    response_model=CategoryNode,
    summary="증상 분류 수정 (team_lead+)",
)
async def update_symptom_category(
    tenant_slug: str,
    category_id: uuid.UUID,
    data: CategoryUpdate,
    current_user: Annotated[
        User, Depends(require_roles(UserRole.team_lead, UserRole.admin))
    ] = None,
    db: AsyncSession = Depends(get_db),
) -> CategoryNode:
    cat = await db.scalar(
        select(SymptomCategory).where(
            and_(
                SymptomCategory.id == category_id,
                SymptomCategory.tenant_id == current_user.tenant_id,
            )
        )
    )
    if cat is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="증상 분류를 찾을 수 없습니다.",
        )
    cat.name = data.name
    await db.commit()
    await db.refresh(cat)
    return CategoryNode(id=cat.id, name=cat.name, display_order=cat.display_order)


@classification_router.delete(
    "/{tenant_slug}/symptom-categories/{category_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="증상 분류 삭제 (admin)",
)
async def delete_symptom_category(
    tenant_slug: str,
    category_id: uuid.UUID,
    current_user: Annotated[User, Depends(require_roles(UserRole.admin))] = None,
    db: AsyncSession = Depends(get_db),
) -> None:
    cat = await db.scalar(
        select(SymptomCategory).where(
            and_(
                SymptomCategory.id == category_id,
                SymptomCategory.tenant_id == current_user.tenant_id,
            )
        )
    )
    if cat is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="증상 분류를 찾을 수 없습니다.",
        )

    # 자식 카테고리 존재 체크
    child_count = await db.scalar(
        select(func.count()).select_from(SymptomCategory).where(
            and_(
                SymptomCategory.parent_id == category_id,
                SymptomCategory.tenant_id == current_user.tenant_id,
            )
        )
    )
    if child_count and child_count > 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="자식 분류가 있습니다. 먼저 자식을 삭제해주세요.",
        )

    await db.delete(cat)
    await db.commit()


# ---- CauseCategory CRUD ----

@classification_router.post(
    "/{tenant_slug}/cause-categories",
    response_model=CategoryNode,
    status_code=status.HTTP_201_CREATED,
    summary="원인 분류 생성 (team_lead+)",
)
async def create_cause_category(
    tenant_slug: str,
    data: CategoryCreate,
    current_user: Annotated[
        User, Depends(require_roles(UserRole.team_lead, UserRole.admin))
    ] = None,
    db: AsyncSession = Depends(get_db),
) -> CategoryNode:
    if data.parent_id is not None:
        parent = await db.scalar(
            select(CauseCategory).where(
                and_(
                    CauseCategory.id == data.parent_id,
                    CauseCategory.tenant_id == current_user.tenant_id,
                )
            )
        )
        if parent is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="부모 원인 분류를 찾을 수 없습니다.",
            )

    cat = CauseCategory(
        id=uuid.uuid4(),
        tenant_id=current_user.tenant_id,
        name=data.name,
        parent_id=data.parent_id,
    )
    db.add(cat)
    await db.commit()
    await db.refresh(cat)
    return CategoryNode(id=cat.id, name=cat.name, display_order=cat.display_order)


@classification_router.patch(
    "/{tenant_slug}/cause-categories/{category_id}",
    response_model=CategoryNode,
    summary="원인 분류 수정 (team_lead+)",
)
async def update_cause_category(
    tenant_slug: str,
    category_id: uuid.UUID,
    data: CategoryUpdate,
    current_user: Annotated[
        User, Depends(require_roles(UserRole.team_lead, UserRole.admin))
    ] = None,
    db: AsyncSession = Depends(get_db),
) -> CategoryNode:
    cat = await db.scalar(
        select(CauseCategory).where(
            and_(
                CauseCategory.id == category_id,
                CauseCategory.tenant_id == current_user.tenant_id,
            )
        )
    )
    if cat is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="원인 분류를 찾을 수 없습니다.",
        )
    cat.name = data.name
    await db.commit()
    await db.refresh(cat)
    return CategoryNode(id=cat.id, name=cat.name, display_order=cat.display_order)


@classification_router.delete(
    "/{tenant_slug}/cause-categories/{category_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="원인 분류 삭제 (admin)",
)
async def delete_cause_category(
    tenant_slug: str,
    category_id: uuid.UUID,
    current_user: Annotated[User, Depends(require_roles(UserRole.admin))] = None,
    db: AsyncSession = Depends(get_db),
) -> None:
    cat = await db.scalar(
        select(CauseCategory).where(
            and_(
                CauseCategory.id == category_id,
                CauseCategory.tenant_id == current_user.tenant_id,
            )
        )
    )
    if cat is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="원인 분류를 찾을 수 없습니다.",
        )

    # 자식 카테고리 존재 체크
    child_count = await db.scalar(
        select(func.count()).select_from(CauseCategory).where(
            and_(
                CauseCategory.parent_id == category_id,
                CauseCategory.tenant_id == current_user.tenant_id,
            )
        )
    )
    if child_count and child_count > 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="자식 분류가 있습니다. 먼저 자식을 삭제해주세요.",
        )

    # TicketCause에서 사용 중인지 확인
    used_count = await db.scalar(
        select(func.count()).select_from(TicketCause).where(
            TicketCause.cause_category_id == category_id
        )
    )
    if used_count and used_count > 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="티켓에서 사용 중인 분류는 삭제할 수 없습니다.",
        )

    await db.delete(cat)
    await db.commit()


# ─────────────────────────────────────────────────────────────────────────────
# 티켓 활동 감사 로그
# ─────────────────────────────────────────────────────────────────────────────

class ActivityOut(BaseModel):
    id: uuid.UUID
    event_type: str
    from_value: str | None
    to_value: str | None
    meta: dict | None
    actor_id: uuid.UUID | None
    actor_name: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


@router.get(
    "/{ticket_id}/activities",
    response_model=list[ActivityOut],
)
async def list_ticket_activities(
    tenant_slug: str,
    ticket_id: uuid.UUID,
    current_user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
):
    # 티켓 접근 권한 확인
    result = await db.execute(
        select(Ticket).where(
            Ticket.id == ticket_id,
            Ticket.tenant_id == current_user.tenant_id,
        )
    )
    ticket = result.scalar_one_or_none()
    if ticket is None:
        raise HTTPException(status_code=404, detail="티켓을 찾을 수 없습니다.")

    rows = await db.execute(
        select(TicketActivity, User)
        .outerjoin(User, TicketActivity.actor_id == User.id)
        .where(
            TicketActivity.ticket_id == ticket_id,
            TicketActivity.tenant_id == current_user.tenant_id,
        )
        .order_by(TicketActivity.created_at.asc())
    )
    return [
        ActivityOut(
            id=act.id,
            event_type=act.event_type,
            from_value=act.from_value,
            to_value=act.to_value,
            meta=act.meta,
            actor_id=act.actor_id,
            actor_name=user.name if user else None,
            created_at=act.created_at,
        )
        for act, user in rows.all()
    ]
