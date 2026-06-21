"""ITSM 내부 워크플로우 라우터 — 서비스 간 내부 전용 엔드포인트.

ADR-048 WF-2: GW 결재 승인 → ITSM 작업 티켓 자동 생성.

인증: X-Internal-Secret (SERVICE_BUS_SECRET).
외부 인터넷에 노출 금지 — nginx에서 /api/internal/* 경로 차단 권장.

엔드포인트:
  POST /api/internal/workflow/create-ticket
    - GW outbox worker가 결재 승인 완료 시 호출
    - payload: form_key, doc_id, title, content, drafter_email, tenant_slug
    - 멱등성: gw_approval_doc_id 중복 시 기존 ticket_id 반환 (201 아닌 200)
    - 성공 응답: {"ticket_id": "<uuid>", "ticket_number": "TKT-...", "created": bool}
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.models.ticket import Ticket, TicketStatus, TicketChannel, TicketPriority
from app.models.tenant import Tenant
from app.routers.tickets import _generate_ticket_number, _compute_sla_deadlines

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/internal", tags=["internal-workflow"])


# ------------------------------------------------------------------
# 요청/응답 스키마
# ------------------------------------------------------------------

class WorkflowCreateTicketRequest(BaseModel):
    """GW outbox worker가 전달하는 WF-2 payload."""
    form_key: str
    doc_id: str                         # GW ApprovalDocument.id (문자열)
    title: str
    content: dict[str, Any] = {}        # 결재 본문 (JSONB)
    drafter_email: str = ""             # 기안자 이메일 (담당자 배정 힌트)
    tenant_slug: str                    # ITSM 테넌트 slug — 테넌트 격리 기준


class WorkflowCreateTicketResponse(BaseModel):
    ticket_id: str
    ticket_number: str | None
    created: bool                       # True=신규 생성, False=기존 반환(멱등)


# ------------------------------------------------------------------
# 내부 시크릿 의존성
# ------------------------------------------------------------------

def _verify_internal_secret(x_internal_secret: str = Header(default="")) -> None:
    """X-Internal-Secret 헤더 검증.

    - SERVICE_BUS_SECRET 미설정 시: 503 (fail-closed). 엔드포인트는 ops가 시크릿을 설정할 때까지 닫힘.
    - 헤더 불일치 시: 403.
    dev 우회 제거 — 빈 시크릿으로 통과하는 경로 없음.
    """
    expected = settings.SERVICE_BUS_SECRET or ""
    if not expected:
        logger.error(
            "SERVICE_BUS_SECRET 미설정 — /api/internal/workflow 엔드포인트 차단 (fail-closed). "
            "ops: SERVICE_BUS_SECRET 환경변수 설정 후 itsm_backend 재시작 필요."
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="내부 인증 미설정 — 엔드포인트 비활성 상태입니다. ops에 문의하세요.",
        )
    if x_internal_secret != expected:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="내부 인증 실패",
        )


# ------------------------------------------------------------------
# POST /api/internal/workflow/create-ticket
# ------------------------------------------------------------------

@router.post(
    "/workflow/create-ticket",
    response_model=WorkflowCreateTicketResponse,
    status_code=status.HTTP_201_CREATED,
    summary="[WF-2] GW 결재 승인 → ITSM 작업 티켓 자동 생성 (내부 전용)",
    dependencies=[Depends(_verify_internal_secret)],
)
async def create_ticket_from_gw_approval(
    body: WorkflowCreateTicketRequest,
    db: AsyncSession = Depends(get_db),
) -> WorkflowCreateTicketResponse:
    """GW 결재(form_key='itsm_task_request') 승인 완료 시 ITSM 작업 티켓을 자동 생성한다.

    멱등성:
    - gw_approval_doc_id(=body.doc_id) 중복 확인 → 이미 존재하면 기존 ticket_id 반환.
    - DB 레벨: tickets 테이블 uix_tickets_gw_approval_doc_id partial UNIQUE index.

    테넌트 격리:
    - body.tenant_slug → tenants.slug 조회 → tenant_id 확정.
    - 해당 slug의 tenant가 ITSM DB에 없으면 404.

    담당자 배정:
    - 기존 담당자 배정 로직(_compute_sla_deadlines 포함) 재사용.
    - source='gw_approval' 로 기록.
    """
    # 1. 테넌트 slug → tenant_id 변환
    tenant_result = await db.execute(
        select(Tenant).where(Tenant.slug == body.tenant_slug)
    )
    tenant = tenant_result.scalar_one_or_none()
    if tenant is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"테넌트를 찾을 수 없습니다: {body.tenant_slug}",
        )
    tenant_id: uuid.UUID = tenant.id

    # 2. 멱등성 확인 — gw_approval_doc_id 중복 체크
    existing_result = await db.execute(
        select(Ticket).where(
            Ticket.tenant_id == tenant_id,
            Ticket.gw_approval_doc_id == body.doc_id,
        )
    )
    existing = existing_result.scalar_one_or_none()
    if existing is not None:
        logger.info(
            "WF-2 멱등성 hit: gw_approval_doc_id=%s 기존 ticket_id=%s",
            body.doc_id, existing.id,
        )
        return WorkflowCreateTicketResponse(
            ticket_id=str(existing.id),
            ticket_number=existing.ticket_number,
            created=False,
        )

    # 3. 티켓 번호 생성
    ticket_number = await _generate_ticket_number(db, tenant_id)
    now = datetime.now(timezone.utc)

    # 4. SLA 데드라인 계산 (contract_id=None — 일반 작업 티켓)
    sla_response_deadline, sla_resolution_deadline = await _compute_sla_deadlines(
        db, tenant_id, None, now
    )

    # 5. 티켓 생성
    ticket = Ticket(
        id=uuid.uuid4(),
        tenant_id=tenant_id,
        title=body.title or f"[GW 결재 이행] {body.doc_id[:8]}",
        description=_build_description(body),
        priority=TicketPriority.medium,
        status=TicketStatus.open,
        channel=TicketChannel.internal,
        source="gw_approval",               # WF-2 식별자
        gw_approval_doc_id=body.doc_id,     # 역추적 + 멱등성 기준
        ticket_number=ticket_number,
        sla_response_deadline=sla_response_deadline,
        sla_resolution_deadline=sla_resolution_deadline,
    )
    db.add(ticket)

    # 6. 활동 로그 (선택적 — activity_service import 오류 시 graceful skip)
    try:
        from app.services import activity_service
        await activity_service.record(
            db,
            tenant_id=tenant_id,
            ticket_id=ticket.id,
            actor_id=None,  # 시스템 생성
            event_type="created",
            to_value=ticket.title,
            meta={"source": "gw_approval", "gw_approval_doc_id": body.doc_id},
        )
    except Exception:
        logger.warning("WF-2 activity_service.record 실패 — graceful skip", exc_info=True)

    try:
        await db.commit()
        await db.refresh(ticket)
    except IntegrityError:
        # DB 레벨 UNIQUE 위반 (uix_tickets_gw_approval_doc_id) — check-then-insert 경쟁 조건 처리.
        # rollback 후 기존 레코드를 SELECT 하여 멱등 200 반환.
        await db.rollback()
        race_result = await db.execute(
            select(Ticket).where(
                Ticket.tenant_id == tenant_id,
                Ticket.gw_approval_doc_id == body.doc_id,
            )
        )
        existing = race_result.scalar_one_or_none()
        if existing is None:
            # UNIQUE 위반이지만 레코드를 찾을 수 없는 비정상 상태 — 재시도 가능 에러
            logger.error(
                "WF-2 IntegrityError 후 기존 ticket 조회 실패: gw_approval_doc_id=%s tenant=%s",
                body.doc_id, body.tenant_slug,
            )
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="티켓 생성 충돌 — 잠시 후 재시도하세요.",
            )
        logger.info(
            "WF-2 IntegrityError → 멱등 hit (race): gw_approval_doc_id=%s 기존 ticket_id=%s",
            body.doc_id, existing.id,
        )
        return WorkflowCreateTicketResponse(
            ticket_id=str(existing.id),
            ticket_number=existing.ticket_number,
            created=False,
        )

    logger.info(
        "WF-2 ITSM 작업 티켓 생성 완료: ticket_id=%s number=%s gw_approval_doc_id=%s tenant=%s",
        ticket.id, ticket.ticket_number, body.doc_id, body.tenant_slug,
    )

    # 7. notification fan-in (graceful — 실패해도 티켓 생성은 완료)
    if ticket.assigned_to:
        try:
            from app.services.notification_service import notify_ticket_created
            await notify_ticket_created(db, ticket, assigned_user_phone=None)
        except Exception:
            logger.warning("WF-2 notification fan-in 실패 — graceful skip", exc_info=True)

    return WorkflowCreateTicketResponse(
        ticket_id=str(ticket.id),
        ticket_number=ticket.ticket_number,
        created=True,
    )


def _build_description(body: WorkflowCreateTicketRequest) -> str:
    """결재 본문(content JSONB)에서 티켓 설명 텍스트를 구성한다."""
    parts: list[str] = [
        f"GW 결재 승인 자동 이행 티켓 (ADR-048 WF-2)",
        f"결재 문서 ID: {body.doc_id}",
    ]
    if body.drafter_email:
        parts.append(f"기안자: {body.drafter_email}")
    if body.content:
        reason = body.content.get("reason") or body.content.get("content") or body.content.get("description")
        if reason:
            parts.append(f"내용: {str(reason)[:500]}")
    return "\n".join(parts)
