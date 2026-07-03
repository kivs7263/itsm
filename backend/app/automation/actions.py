"""자동화 액션 레지스트리 — Phase 1a 내부 액션 3개 + Phase 1b cross-product 2개 + Phase 1c 확장 3개.

등록 액션:
- notify_inbox: notification-service 통합 인박스 발행
- change_ticket_status: 티켓 상태 변경 (TicketStatus 허용값만)
- assign_ticket: 티켓 담당자 배정
- create_gw_approval_draft: GW 결재 draft 자동 기안 (WF-4 일반화, Phase 1b)
- create_itsm_ticket: ITSM 후속 티켓 자동 생성 (WF-2 일반화, Phase 1b)
- send_email: 고객/담당자/지정 수신자에게 이메일 발송 (Phase 1c, RA-C4)
- add_comment: 티켓에 시스템 코멘트 자동 추가 (Phase 1c, RA-C4)
- escalate_ticket: 지원팀 자동 이관 + 선택적 우선순위 상향 (Phase 1c, RA-C4)

등록되지 않은 action_type은 실행 거부 (ActionError).
각 액션은 Pydantic 파라미터 검증 후 실행.
액션 부분실패 격리 — 한 액션 실패가 다른 액션/룰 실행을 막지 않음.
cross-product 액션은 graceful: 외부 서비스 실패가 룰 실행/티켓 작업을 막지 않음.
"""
from __future__ import annotations

import hashlib
import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel, Field, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)


class ActionError(Exception):
    """액션 실행 실패."""


# ---------------------------------------------------------------------------
# 파라미터 스키마
# ---------------------------------------------------------------------------

_VALID_STATUSES = {"open", "in_progress", "pending", "resolved", "closed"}
_VALID_PRIORITIES = {"low", "medium", "high", "critical"}


class NotifyInboxParams(BaseModel):
    """notify_inbox 파라미터."""
    title: str
    body: str
    # 지정하지 않으면 티켓 담당자에게 발송
    user_id: str | None = None
    # 인박스 이벤트 네임스페이스 (기본값 제공)
    event_namespace: str = "itsm.automation.notify"


class ChangeTicketStatusParams(BaseModel):
    """change_ticket_status 파라미터."""
    status: str

    @field_validator("status")
    @classmethod
    def validate_status(cls, v: str) -> str:
        if v not in _VALID_STATUSES:
            raise ValueError(f"유효하지 않은 상태값: {v!r}. 허용: {_VALID_STATUSES}")
        return v


class AssignTicketParams(BaseModel):
    """assign_ticket 파라미터."""
    # 사용자 UUID 문자열 또는 payload 참조 키 ("{{assignee_id}}" 같은 템플릿은 Phase 2)
    user_id: str

    @field_validator("user_id")
    @classmethod
    def validate_uuid(cls, v: str) -> str:
        try:
            uuid.UUID(v)
        except ValueError as exc:
            raise ValueError(f"user_id는 유효한 UUID여야 합니다: {v!r}") from exc
        return v


# ---------------------------------------------------------------------------
# Phase 1b — cross-product 액션 파라미터 스키마
# ---------------------------------------------------------------------------


class CreateGwApprovalDraftParams(BaseModel):
    """create_gw_approval_draft 파라미터.

    WF-4 일반화: 룰이 GW 결재 draft를 자동 기안한다.
    gw_approval_service.submit_approval_draft()를 재사용하므로 KC 토큰·CSRF
    설정은 기존 WF-4와 동일 경로.
    """
    requester_email: str = Field(..., description="GW 기안자 이메일 (테넌트 소속 계정)")
    title: str = Field(..., max_length=500, description="결재 제목")
    content_text: str = Field(..., description="결재 내용 본문")


class CreateItsmTicketParams(BaseModel):
    """create_itsm_ticket 파라미터.

    WF-2 일반화: 룰이 ITSM 후속 티켓을 자동 생성한다.
    ⚠️ 무한루프 주의: ticket.created 트리거를 재발화하므로 depth+1로 dispatch
    하여 depth >= MAX_DEPTH(3)에서 엔진 차단.
    """
    title: str = Field(..., max_length=500, description="티켓 제목")
    description: str | None = Field(None, description="티켓 설명")
    priority: str = Field("medium", description="우선순위 (low/medium/high/critical)")
    request_type: str | None = Field(None, description="유형 (incident/service_request 등)")
    source: str = Field("automation", description="출처 — 자동화 생성 표시용")

    @field_validator("priority")
    @classmethod
    def validate_priority(cls, v: str) -> str:
        if v not in _VALID_PRIORITIES:
            raise ValueError(f"priority는 {_VALID_PRIORITIES} 중 하나여야 합니다")
        return v


# ---------------------------------------------------------------------------
# Phase 1c — 확장 액션 파라미터 스키마 (RA-C4)
# ---------------------------------------------------------------------------

_VALID_RECIPIENT_TYPES = {"customer", "assignee", "custom"}
_VALID_ESCALATION_REASONS = {
    "technical_complexity", "permission_lack", "sla_breach",
    "sla_warning", "customer_request", "manual", "other",
}


class SendEmailParams(BaseModel):
    """send_email 파라미터.

    recipient_type:
      - "customer" : 티켓 고객 이메일 (primary contact 우선)
      - "assignee" : 담당자 이메일
      - "custom"   : to_email 직접 지정
    subject, message: 자동화 룰 작성자가 직접 입력하는 제목/본문.
    external_notif_service.queue_notification() + "automation_notify" 템플릿 재사용.
    SMTP 미설정 시 graceful 실패.
    """
    recipient_type: str = Field("customer", description="customer|assignee|custom")
    to_email: str | None = Field(None, description="recipient_type=custom 시 대상 이메일")
    subject: str = Field(..., min_length=1, max_length=500, description="이메일 제목")
    message: str = Field(..., min_length=1, description="이메일 본문 (HTML 허용)")

    @field_validator("recipient_type")
    @classmethod
    def validate_recipient_type(cls, v: str) -> str:
        if v not in _VALID_RECIPIENT_TYPES:
            raise ValueError(f"recipient_type은 {_VALID_RECIPIENT_TYPES} 중 하나여야 합니다")
        return v


class AddCommentParams(BaseModel):
    """add_comment 파라미터.

    TicketComment(source='automation', author_id=None) 생성.
    is_internal=True  → 담당자 전용 내부 메모 (고객 포털에 비공개).
    is_internal=False → 고객 공개 코멘트.
    """
    body: str = Field(..., min_length=1, description="코멘트 내용")
    is_internal: bool = Field(True, description="True=담당자 전용 내부 메모 / False=고객 공개")


class EscalateTicketParams(BaseModel):
    """escalate_ticket 파라미터.

    TicketEscalation 자동 생성 + 티켓 escalation_level 증가.
    priority 지정 시 우선순위도 함께 상향.
    notify_customer=True이면 ticket_escalated 이메일 큐 등록 (SMTP 미설정 시 graceful 실패).
    """
    to_team_id: str = Field(..., description="이관 대상 지원팀 UUID")
    reason: str = Field(
        "sla_warning",
        description="에스컬레이션 사유 (sla_breach|sla_warning|technical_complexity|permission_lack|customer_request|manual|other)",
    )
    handover_memo: str = Field(..., min_length=5, description="인계 메모 (최소 5자)")
    priority: str | None = Field(None, description="우선순위 상향 (None=유지, high|critical)")
    notify_customer: bool = Field(False, description="True=고객 이메일 알림 발송")

    @field_validator("to_team_id")
    @classmethod
    def validate_team_uuid(cls, v: str) -> str:
        try:
            uuid.UUID(v)
        except ValueError as exc:
            raise ValueError(f"to_team_id는 유효한 UUID여야 합니다: {v!r}") from exc
        return v

    @field_validator("reason")
    @classmethod
    def validate_reason(cls, v: str) -> str:
        if v not in _VALID_ESCALATION_REASONS:
            raise ValueError(f"reason은 {_VALID_ESCALATION_REASONS} 중 하나여야 합니다")
        return v

    @field_validator("priority")
    @classmethod
    def validate_priority(cls, v: str | None) -> str | None:
        if v is not None and v not in _VALID_PRIORITIES:
            raise ValueError(f"priority는 {_VALID_PRIORITIES} 중 하나여야 합니다")
        return v


# ---------------------------------------------------------------------------
# 내부 액션 핸들러
# ---------------------------------------------------------------------------


async def _handle_notify_inbox(
    params_raw: dict[str, Any],
    payload: dict[str, Any],
    db: AsyncSession,
    depth: int = 0,  # Phase 1b: depth 전파 시그니처 통일 (이 액션은 사용 안 함)
) -> dict[str, Any]:
    """notification-service 통합 인박스 발행."""
    params = NotifyInboxParams.model_validate(params_raw)
    ticket_id = payload.get("ticket_id")
    if not ticket_id:
        return {"status": "skipped", "reason": "payload에 ticket_id 없음"}

    try:
        from app.models.ticket import Ticket
        from app.services.notification_service import _push_inbox_for_assignee

        ticket = await db.get(Ticket, uuid.UUID(str(ticket_id)))
        if not ticket:
            return {"status": "skipped", "reason": f"ticket {ticket_id} 미발견"}

        await _push_inbox_for_assignee(
            db,
            ticket,
            event_namespace=params.event_namespace,
            title=params.title,
            body=params.body,
            idempotency_suffix=f"automation:{ticket_id}",
        )
        return {"status": "ok"}
    except Exception as exc:
        logger.warning("notify_inbox 실패 (무시): %s", exc)
        return {"status": "error", "error": str(exc)}


async def _handle_change_ticket_status(
    params_raw: dict[str, Any],
    payload: dict[str, Any],
    db: AsyncSession,
    depth: int = 0,  # Phase 1b: depth 전파 시그니처 통일 (이 액션은 사용 안 함)
) -> dict[str, Any]:
    """티켓 상태 직접 변경."""
    params = ChangeTicketStatusParams.model_validate(params_raw)
    ticket_id = payload.get("ticket_id")
    if not ticket_id:
        return {"status": "skipped", "reason": "payload에 ticket_id 없음"}

    try:
        from app.models.ticket import Ticket, TicketStatus

        ticket = await db.get(Ticket, uuid.UUID(str(ticket_id)))
        if not ticket:
            return {"status": "skipped", "reason": f"ticket {ticket_id} 미발견"}

        prev_status = str(ticket.status.value if hasattr(ticket.status, "value") else ticket.status)
        new_status = params.status

        if prev_status == new_status:
            return {"status": "skipped", "reason": f"이미 {new_status} 상태"}

        ticket.status = TicketStatus(new_status)
        # updated_at은 onupdate로 자동 갱신
        await db.flush()
        logger.info("automation change_ticket_status: ticket=%s %s→%s", ticket_id, prev_status, new_status)
        return {"status": "ok", "prev": prev_status, "new": new_status}
    except Exception as exc:
        logger.warning("change_ticket_status 실패: %s", exc)
        raise ActionError(str(exc)) from exc


async def _handle_assign_ticket(
    params_raw: dict[str, Any],
    payload: dict[str, Any],
    db: AsyncSession,
    depth: int = 0,  # Phase 1b: depth 전파 시그니처 통일 (이 액션은 사용 안 함)
) -> dict[str, Any]:
    """티켓 담당자 배정."""
    params = AssignTicketParams.model_validate(params_raw)
    ticket_id = payload.get("ticket_id")
    if not ticket_id:
        return {"status": "skipped", "reason": "payload에 ticket_id 없음"}

    try:
        from sqlalchemy import select
        from app.models.ticket import Ticket
        from app.models.user import User

        ticket = await db.get(Ticket, uuid.UUID(str(ticket_id)))
        if not ticket:
            return {"status": "skipped", "reason": f"ticket {ticket_id} 미발견"}

        user_id = uuid.UUID(params.user_id)
        # 테넌트 소속 사용자인지 검증
        user = await db.scalar(
            select(User).where(User.id == user_id, User.tenant_id == ticket.tenant_id, User.is_active.is_(True))
        )
        if not user:
            return {"status": "error", "error": f"user {params.user_id} 미발견 또는 다른 테넌트"}

        prev_assigned = str(ticket.assigned_to) if ticket.assigned_to else None
        ticket.assigned_to = user_id
        await db.flush()
        logger.info("automation assign_ticket: ticket=%s → user=%s", ticket_id, params.user_id)
        return {"status": "ok", "prev_assigned": prev_assigned, "new_assigned": params.user_id}
    except ActionError:
        raise
    except Exception as exc:
        logger.warning("assign_ticket 실패: %s", exc)
        raise ActionError(str(exc)) from exc


# ---------------------------------------------------------------------------
# Phase 1b — cross-product 액션 헬퍼
# ---------------------------------------------------------------------------


async def _gen_ticket_number_for_action(db: AsyncSession, tenant_id: uuid.UUID) -> str:
    """TKT-YYYYMMDD-NNNN 형식 티켓 번호 자동 생성.

    routers/tickets.py _generate_ticket_number와 동일 로직 —
    순환 임포트(router→action→router) 회피를 위한 로컬 사본.
    pg_advisory_xact_lock으로 (tenant, date) 단위 직렬화 — 동시 생성 중복 방지.
    """
    from sqlalchemy import text

    today = datetime.now(timezone.utc).strftime("%Y%m%d")
    prefix = f"TKT-{today}-"
    # RA-D8: abs(hash()) 는 PYTHONHASHSEED 랜덤 → 멀티워커 advisory_lock 키 불일치.
    # hashlib.sha256 결정론 해시로 교체 (프로세스·재시작 무관 동일 키 보장).
    _lock_raw = f"{tenant_id}:{today}".encode()
    lock_key = int.from_bytes(hashlib.sha256(_lock_raw).digest()[:8], "big", signed=True)
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
    return f"{prefix}{max_seq + 1:04d}"


# ---------------------------------------------------------------------------
# Phase 1b — cross-product 액션 핸들러
# ---------------------------------------------------------------------------


async def _handle_create_gw_approval_draft(
    params_raw: dict[str, Any],
    payload: dict[str, Any],
    db: AsyncSession,
    depth: int = 0,
) -> dict[str, Any]:
    """GW 결재 draft 자동 기안 (WF-4 일반화).

    gw_approval_service.submit_approval_draft()가 이미 graceful(None 반환, 예외 없음)
    이므로 동일 패턴을 그대로 재사용. 주 트랜잭션 외부 HTTP — 실패 시 다른 액션
    /룰 실행을 막지 않음.

    멱등성: 엔진 idempotency_key(trigger_event:entity_id:rule_id 해시)가 동일
    entity+rule 중복 실행을 차단. GW 측 draft 중복은 GW의 책임.

    Args:
        depth: 미사용. cross-product 핸들러 시그니처 통일용.
    """
    try:
        params = CreateGwApprovalDraftParams.model_validate(params_raw)
    except Exception as exc:
        return {"status": "error", "error": f"파라미터 검증 실패: {exc}"}

    try:
        from app.services.gw_approval_service import submit_approval_draft

        result = await submit_approval_draft(
            requester_email=params.requester_email,
            title=params.title,
            content_text=params.content_text,
        )

        if result is None:
            # GW 미설정 또는 HTTP 실패 — graceful
            logger.warning(
                "create_gw_approval_draft: GW 기안 실패 또는 미설정 "
                "(requester=%s, graceful)",
                params.requester_email,
            )
            return {
                "status": "error",
                "error": "GW 연결 실패 또는 미설정 — 결재 draft 미생성 (graceful)",
            }

        draft_id = str(result.get("id", ""))
        logger.info(
            "create_gw_approval_draft: GW 결재 기안 성공 draft_id=%s", draft_id
        )
        return {
            "status": "ok",
            "draft_id": draft_id,
            "draft_status": result.get("status", ""),
        }

    except Exception as exc:
        logger.warning("create_gw_approval_draft 예외 (graceful): %s", exc)
        return {"status": "error", "error": str(exc)}


async def _handle_create_itsm_ticket(
    params_raw: dict[str, Any],
    payload: dict[str, Any],
    db: AsyncSession,
    depth: int = 0,
) -> dict[str, Any]:
    """ITSM 후속 티켓 자동 생성 (WF-2 일반화).

    별도 DB 세션(AsyncSessionLocal)으로 티켓 생성 → 주 세션 오염 없음.
    ticket.created 재발화 시 depth+1 전달 → MAX_DEPTH(3) 도달 시 엔진이 차단.

    무한루프 방지 흐름:
      depth=0 → create_itsm_ticket → dispatch("ticket.created", depth=1)
      depth=1 → create_itsm_ticket → dispatch("ticket.created", depth=2)
      depth=2 → create_itsm_ticket → dispatch("ticket.created", depth=3)
      depth=3 >= MAX_DEPTH → 엔진 차단 (status=skipped, max_depth_exceeded)

    멱등성: 엔진 idempotency_key가 동일 rule+entity 재실행 차단.
    advisory lock: 같은 (tenant, date)에 동시 생성 시 pg_advisory_xact_lock
    직렬화 — commit 후 lock 해제로 중첩 create_itsm_ticket도 잠금 가능.
    """
    try:
        params = CreateItsmTicketParams.model_validate(params_raw)
    except Exception as exc:
        return {"status": "error", "error": f"파라미터 검증 실패: {exc}"}

    tenant_id_raw = payload.get("tenant_id")
    if not tenant_id_raw:
        return {"status": "skipped", "reason": "payload에 tenant_id 없음"}
    try:
        tenant_id = uuid.UUID(str(tenant_id_raw))
    except (ValueError, AttributeError) as exc:
        return {"status": "error", "error": f"tenant_id 파싱 실패: {exc}"}

    new_ticket_id = uuid.uuid4()
    ticket_number: str | None = None

    try:
        from app.core.database import AsyncSessionLocal
        from app.models.ticket import Ticket, TicketChannel, TicketPriority, TicketStatus
        from app.automation.engine import dispatch as engine_dispatch

        async with AsyncSessionLocal() as new_session:
            # 1. 티켓 생성 — advisory lock 획득 후 commit으로 lock 해제
            ticket_number = await _gen_ticket_number_for_action(new_session, tenant_id)
            ticket = Ticket(
                id=new_ticket_id,
                tenant_id=tenant_id,
                title=params.title,
                description=params.description,
                priority=TicketPriority(params.priority),
                status=TicketStatus.open,
                channel=TicketChannel.internal,
                source=params.source,
                request_type=params.request_type,
                ticket_number=ticket_number,
            )
            new_session.add(ticket)
            await new_session.commit()
            # advisory lock 해제됨 — 중첩 create_itsm_ticket도 동일 날짜 lock 획득 가능

            # 2. ticket.created 트리거 발화 (depth+1 — 무한루프 방지 핵심)
            created_payload: dict[str, Any] = {
                "ticket_id": str(new_ticket_id),
                "tenant_id": str(tenant_id),
                "request_type": params.request_type or "",
                "priority": params.priority,
                "_rule_action": True,  # ADR-050 § 2.5 액션 소스 마커
            }
            try:
                await engine_dispatch(
                    "ticket.created",
                    created_payload,
                    new_session,
                    depth=depth + 1,
                )
                await new_session.commit()
            except Exception as exc_dispatch:
                logger.warning(
                    "create_itsm_ticket dispatch commit 실패 (무시): %s", exc_dispatch
                )

        logger.info(
            "automation create_itsm_ticket 완료: ticket_id=%s number=%s "
            "depth=%d→dispatch_depth=%d",
            new_ticket_id,
            ticket_number,
            depth,
            depth + 1,
        )
        return {
            "status": "ok",
            "ticket_id": str(new_ticket_id),
            "ticket_number": ticket_number,
        }

    except Exception as exc:
        logger.warning("create_itsm_ticket 실패 (graceful): %s", exc)
        return {"status": "error", "error": str(exc)}


# ---------------------------------------------------------------------------
# Phase 1c — 확장 액션 핸들러 (RA-C4)
# ---------------------------------------------------------------------------


async def _handle_send_email(
    params_raw: dict[str, Any],
    payload: dict[str, Any],
    db: AsyncSession,
    depth: int = 0,
) -> dict[str, Any]:
    """고객/담당자/지정 수신자에게 이메일 발송.

    external_notif_service.queue_notification() + "automation_notify" 템플릿 재사용.
    실제 발송은 SLA worker 루프의 process_pending()이 수행 (지수 백오프 재시도 포함).
    SMTP 미설정 시 graceful 실패 (pending row는 생성되나 worker에서 즉시 failed 처리).
    """
    try:
        params = SendEmailParams.model_validate(params_raw)
    except Exception as exc:
        return {"status": "error", "error": f"파라미터 검증 실패: {exc}"}

    ticket_id_raw = payload.get("ticket_id")
    tenant_id_raw = payload.get("tenant_id")
    if not ticket_id_raw or not tenant_id_raw:
        return {"status": "skipped", "reason": "payload에 ticket_id 또는 tenant_id 없음"}

    try:
        from app.models.ticket import Ticket
        from app.models.user import User
        from app.services.external_notif_service import queue_notification, resolve_customer_email

        tenant_id = uuid.UUID(str(tenant_id_raw))
        ticket = await db.get(Ticket, uuid.UUID(str(ticket_id_raw)))
        if not ticket:
            return {"status": "skipped", "reason": f"ticket {ticket_id_raw} 미발견"}

        # 수신자 결정
        to_email: str | None = None
        recipient_name: str = "담당자"

        if params.recipient_type == "customer":
            to_email, recipient_name = await resolve_customer_email(db, ticket)
            if not to_email:
                return {"status": "skipped", "reason": "고객 이메일 없음"}
        elif params.recipient_type == "assignee":
            if not ticket.assigned_to:
                return {"status": "skipped", "reason": "담당자 미배정"}
            user = await db.get(User, ticket.assigned_to)
            if not user or not user.email:
                return {"status": "skipped", "reason": "담당자 이메일 없음"}
            to_email = user.email
            recipient_name = user.name
        elif params.recipient_type == "custom":
            if not params.to_email:
                return {"status": "error", "error": "recipient_type=custom이면 to_email 필수"}
            to_email = params.to_email
            recipient_name = "수신자"

        await queue_notification(
            db,
            tenant_id=tenant_id,
            ticket_id=ticket.id,
            escalation_id=None,
            channel="email",
            event_type="automation_notify",
            recipient=to_email,
            payload={
                "ticket_number": ticket.ticket_number or str(ticket.id)[:8],
                "ticket_title": ticket.title,
                "customer_name": recipient_name,
                "custom_subject": params.subject,
                "custom_body": params.message,
            },
        )
        logger.info("send_email queued: ticket=%s recipient_type=%s to=%s", ticket_id_raw, params.recipient_type, to_email)
        return {"status": "ok", "to": to_email, "recipient_type": params.recipient_type}
    except Exception as exc:
        logger.warning("send_email 실패 (graceful): %s", exc)
        return {"status": "error", "error": str(exc)}


async def _handle_add_comment(
    params_raw: dict[str, Any],
    payload: dict[str, Any],
    db: AsyncSession,
    depth: int = 0,
) -> dict[str, Any]:
    """티켓에 시스템 자동 코멘트 추가.

    source='automation', author_id=None (시스템 발신).
    activity_service.record()로 ticket_activities에도 기록.
    """
    try:
        params = AddCommentParams.model_validate(params_raw)
    except Exception as exc:
        return {"status": "error", "error": f"파라미터 검증 실패: {exc}"}

    ticket_id_raw = payload.get("ticket_id")
    tenant_id_raw = payload.get("tenant_id")
    if not ticket_id_raw or not tenant_id_raw:
        return {"status": "skipped", "reason": "payload에 ticket_id 또는 tenant_id 없음"}

    try:
        from app.models.ticket import Ticket, TicketComment
        from app.services import activity_service

        ticket_id = uuid.UUID(str(ticket_id_raw))
        tenant_id = uuid.UUID(str(tenant_id_raw))

        ticket = await db.get(Ticket, ticket_id)
        if not ticket:
            return {"status": "skipped", "reason": f"ticket {ticket_id_raw} 미발견"}

        comment = TicketComment(
            tenant_id=tenant_id,
            ticket_id=ticket_id,
            author_id=None,          # 시스템 자동 발신
            body=params.body,
            is_internal=params.is_internal,
            source="automation",
        )
        db.add(comment)
        await db.flush()

        await activity_service.record(
            db,
            tenant_id=tenant_id,
            ticket_id=ticket_id,
            actor_id=None,
            event_type="comment_added",
            to_value=params.body[:100],
            meta={"source": "automation", "is_internal": params.is_internal},
        )

        logger.info(
            "add_comment: ticket=%s comment_id=%s is_internal=%s",
            ticket_id_raw, comment.id, params.is_internal,
        )
        return {"status": "ok", "comment_id": str(comment.id), "is_internal": params.is_internal}
    except Exception as exc:
        logger.warning("add_comment 실패: %s", exc)
        raise ActionError(str(exc)) from exc


async def _handle_escalate_ticket(
    params_raw: dict[str, Any],
    payload: dict[str, Any],
    db: AsyncSession,
    depth: int = 0,
) -> dict[str, Any]:
    """자동 에스컬레이션 — 지원팀 이관 + 선택적 우선순위 상향.

    TicketEscalation 생성 + 티켓 escalation_level/count/last_escalated_at 갱신.
    triggered_by=None (시스템 자동 에스컬레이션).
    notify_customer=True이면 ticket_escalated 이메일 큐 등록 (graceful).
    EscalationReason 허용값 위반 시 DB IntegrityError → ActionError 상승.
    """
    try:
        params = EscalateTicketParams.model_validate(params_raw)
    except Exception as exc:
        return {"status": "error", "error": f"파라미터 검증 실패: {exc}"}

    ticket_id_raw = payload.get("ticket_id")
    tenant_id_raw = payload.get("tenant_id")
    if not ticket_id_raw or not tenant_id_raw:
        return {"status": "skipped", "reason": "payload에 ticket_id 또는 tenant_id 없음"}

    try:
        from sqlalchemy import select as _select
        from app.models.ticket import Ticket, TicketPriority
        from app.models.escalation import TicketEscalation, SupportTeam
        from app.services import activity_service

        ticket_id = uuid.UUID(str(ticket_id_raw))
        tenant_id = uuid.UUID(str(tenant_id_raw))
        to_team_id = uuid.UUID(params.to_team_id)

        ticket = await db.get(Ticket, ticket_id)
        if not ticket:
            return {"status": "skipped", "reason": f"ticket {ticket_id_raw} 미발견"}

        # 팀 존재 + 테넌트 소속 + 활성 확인
        team = await db.scalar(
            _select(SupportTeam).where(
                SupportTeam.id == to_team_id,
                SupportTeam.tenant_id == tenant_id,
                SupportTeam.is_active.is_(True),
            )
        )
        if not team:
            return {"status": "error", "error": f"지원팀 {params.to_team_id} 미발견 또는 비활성"}

        from_level = getattr(ticket, "escalation_level", None) or 1
        to_level = from_level + 1

        esc = TicketEscalation(
            id=uuid.uuid4(),
            tenant_id=tenant_id,
            ticket_id=ticket_id,
            from_level=from_level,
            to_level=to_level,
            from_assigned=ticket.assigned_to,
            to_team_id=to_team_id,
            to_assigned=None,
            reason=params.reason,
            handover_memo=params.handover_memo,
            customer_summary=None,
            triggered_by=None,   # 시스템 자동 에스컬레이션
        )
        db.add(esc)

        # 티켓 비정규화 컬럼 업데이트 (컬럼 존재 여부 방어 — migration 선반영 시 동작)
        if hasattr(ticket, "escalation_level"):
            ticket.escalation_level = to_level
        if hasattr(ticket, "escalation_count"):
            ticket.escalation_count = (getattr(ticket, "escalation_count", 0) or 0) + 1
        if hasattr(ticket, "last_escalated_at"):
            ticket.last_escalated_at = datetime.now(timezone.utc)

        # 우선순위 상향 (요청 시)
        prev_priority: str | None = None
        if params.priority:
            prev_priority = str(
                ticket.priority.value if hasattr(ticket.priority, "value") else ticket.priority
            )
            ticket.priority = TicketPriority(params.priority)

        await db.flush()

        await activity_service.record(
            db,
            tenant_id=tenant_id,
            ticket_id=ticket_id,
            actor_id=None,
            event_type="escalated",
            from_value=str(from_level),
            to_value=str(to_level),
            meta={
                "reason": params.reason,
                "to_team_id": str(to_team_id),
                "source": "automation",
                "priority_changed": prev_priority is not None,
            },
        )

        # 선택적 고객 이메일 알림 (graceful — SMTP 미설정/실패 무시)
        if params.notify_customer and ticket.customer_id:
            try:
                from app.services.external_notif_service import queue_notification, resolve_customer_email
                customer_email, customer_name = await resolve_customer_email(db, ticket)
                if customer_email:
                    await queue_notification(
                        db,
                        tenant_id=tenant_id,
                        ticket_id=ticket_id,
                        escalation_id=esc.id,
                        channel="email",
                        event_type="ticket_escalated",
                        recipient=customer_email,
                        payload={
                            "ticket_title": ticket.title,
                            "ticket_number": ticket.ticket_number or str(ticket_id)[:8],
                            "customer_name": customer_name,
                            "customer_summary": "",
                        },
                    )
            except Exception as exc_notify:
                logger.warning("escalate_ticket 고객 알림 큐 실패 (무시): %s", exc_notify)

        logger.info(
            "automation escalate_ticket: ticket=%s %d→%d team=%s priority_changed=%s",
            ticket_id_raw, from_level, to_level, params.to_team_id, prev_priority is not None,
        )
        return {
            "status": "ok",
            "from_level": from_level,
            "to_level": to_level,
            "to_team_id": params.to_team_id,
            "priority_changed": prev_priority is not None,
            "new_priority": params.priority,
        }
    except ActionError:
        raise
    except Exception as exc:
        logger.warning("escalate_ticket 실패 (graceful): %s", exc)
        return {"status": "error", "error": str(exc)}


# ---------------------------------------------------------------------------
# 레지스트리
# ---------------------------------------------------------------------------

_REGISTRY: dict[str, Any] = {
    # Phase 1a — 내부 동기 액션
    "notify_inbox": _handle_notify_inbox,
    "change_ticket_status": _handle_change_ticket_status,
    "assign_ticket": _handle_assign_ticket,
    # Phase 1b — cross-product 비동기 액션 (graceful, fire-and-forget)
    "create_gw_approval_draft": _handle_create_gw_approval_draft,
    "create_itsm_ticket": _handle_create_itsm_ticket,
    # Phase 1c — 확장 액션 (RA-C4: 이메일·코멘트·에스컬레이션)
    "send_email": _handle_send_email,
    "add_comment": _handle_add_comment,
    "escalate_ticket": _handle_escalate_ticket,
}


def get_registered_actions() -> list[str]:
    return list(_REGISTRY.keys())


async def execute_action(
    action_type: str,
    params: dict[str, Any],
    payload: dict[str, Any],
    db: AsyncSession,
    depth: int = 0,
) -> dict[str, Any]:
    """액션 실행.

    Args:
        action_type: 등록된 액션 식별자
        params: 액션 파라미터 딕셔너리
        payload: 트리거 페이로드 (tenant_id 등 컨텍스트)
        db: 현재 세션 (cross-product 액션은 내부에서 별도 세션 사용)
        depth: 현재 실행 깊이 — cross-product 액션이 dispatch 재호출 시 depth+1
               전달하여 무한루프를 차단한다 (MAX_DEPTH=3).

    Returns:
        {"status": "ok"|"skipped"|"error", ...}

    Raises:
        ActionError: 등록되지 않은 action_type
    """
    handler = _REGISTRY.get(action_type)
    if handler is None:
        raise ActionError(
            f"등록되지 않은 action_type: {action_type!r}. 허용: {get_registered_actions()}"
        )

    return await handler(params, payload, db, depth)
