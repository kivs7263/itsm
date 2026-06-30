"""티켓, 댓글, 첨부파일, 분류 모델."""
from __future__ import annotations

import enum

from sqlalchemy import BigInteger, Boolean, Column, DateTime, Enum, ForeignKey, Index, Integer, SmallInteger, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.models.base import Base, gen_uuid, utcnow


class TicketPriority(str, enum.Enum):
    low = "low"
    medium = "medium"
    high = "high"
    critical = "critical"


class TicketStatus(str, enum.Enum):
    open = "open"
    in_progress = "in_progress"
    pending = "pending"
    resolved = "resolved"
    closed = "closed"


class TicketChannel(str, enum.Enum):
    email = "email"
    phone = "phone"
    portal = "portal"
    internal = "internal"


_ticket_priority_enum = Enum(
    "low", "medium", "high", "critical",
    name="ticket_priority_enum",
)
_ticket_status_enum = Enum(
    "open", "in_progress", "pending", "resolved", "closed",
    name="ticket_status_enum",
)
_ticket_channel_enum = Enum(
    "email", "phone", "portal", "internal",
    name="ticket_channel_enum",
)


class Ticket(Base):
    __tablename__ = "tickets"
    __table_args__ = (
        Index("ix_tickets_tenant_status", "tenant_id", "status"),
        Index("ix_tickets_tenant_customer", "tenant_id", "customer_id"),
        Index("ix_tickets_tenant_assigned", "tenant_id", "assigned_to"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=gen_uuid)
    tenant_id = Column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
    )
    customer_id = Column(
        UUID(as_uuid=True),
        ForeignKey("customers.id", ondelete="SET NULL"),
        nullable=True,
    )
    contract_id = Column(
        UUID(as_uuid=True),
        ForeignKey("contracts.id", ondelete="SET NULL"),
        nullable=True,
    )
    assigned_to = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    title = Column(String(500), nullable=False)
    description = Column(Text, nullable=True)
    priority = Column(_ticket_priority_enum, nullable=False, default=TicketPriority.medium)
    status = Column(_ticket_status_enum, nullable=False, default=TicketStatus.open)
    channel = Column(_ticket_channel_enum, nullable=False, default=TicketChannel.internal)
    # P4-4 추가 필드
    source = Column(String(30), nullable=True)         # customer_direct | customer_relay | engineer_found | monitoring
    request_type = Column(String(30), nullable=True)   # incident | service_request | installation | upgrade | technical_inquiry | maintenance
    parent_ticket_id = Column(
        UUID(as_uuid=True),
        ForeignKey("tickets.id", ondelete="SET NULL"),
        nullable=True,
    )
    ticket_number = Column(String(25), nullable=True)  # TKT-YYYYMMDD-NNNN (tenant+number unique via constraint)
    sla_response_deadline = Column(DateTime(timezone=True), nullable=True)
    sla_resolution_deadline = Column(DateTime(timezone=True), nullable=True)
    # P5-3 반복 장애 감지
    symptom_category_id = Column(
        UUID(as_uuid=True),
        ForeignKey("symptom_categories.id", ondelete="SET NULL"),
        nullable=True,
    )
    is_recurring_flag = Column(Boolean, nullable=False, default=False)
    recurring_detected_at = Column(DateTime(timezone=True), nullable=True)
    # P5-1 설치 워크플로우 (request_type='installation' 티켓 전용)
    installation_step = Column(String(30), nullable=True)
    installation_history = Column(JSONB, nullable=False, default=list)
    created_at = Column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow)
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    closed_at = Column(DateTime(timezone=True), nullable=True)
    # KPI-1
    first_responded_at = Column(DateTime(timezone=True), nullable=True)
    reopen_count = Column(SmallInteger, nullable=False, default=0)
    # WF-4: SLA 에스컬레이션 결재 (ADR-048)
    sla_escalation_approval_id = Column(String(128), nullable=True)  # GW 결재 doc_id, NULL=미생성
    # WF-1: 결재 선행 티켓 유형 (license_request/budget_request/access_request) — ADR-048
    gw_approval_doc_id = Column(String(128), nullable=True)   # GW 결재 doc_id, NULL=비대상 또는 미생성
    gw_approval_status = Column(String(30), nullable=True)    # pending/approved/rejected/gw_not_configured
    # CA-P1-5: 서비스 카탈로그 연결 (service_offerings.id, SET NULL)
    service_offering_id = Column(
        UUID(as_uuid=True),
        ForeignKey("service_offerings.id", ondelete="SET NULL"),
        nullable=True,
    )


class TicketComment(Base):
    __tablename__ = "ticket_comments"
    __table_args__ = (
        Index("ix_ticket_comments_tenant_ticket", "tenant_id", "ticket_id"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=gen_uuid)
    tenant_id = Column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
    )
    ticket_id = Column(
        UUID(as_uuid=True),
        ForeignKey("tickets.id", ondelete="CASCADE"),
        nullable=False,
    )
    author_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,   # 고객 포털 코멘트는 author 없음 (source='customer_portal')
    )
    body = Column(Text, nullable=False)
    is_internal = Column(Boolean, nullable=False, default=False)
    source = Column(String(30), nullable=True)  # None=내부, 'customer_portal'=고객 발신
    created_at = Column(DateTime(timezone=True), nullable=False, default=utcnow)


class TicketAttachment(Base):
    __tablename__ = "ticket_attachments"

    id = Column(UUID(as_uuid=True), primary_key=True, default=gen_uuid)
    tenant_id = Column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
    )
    ticket_id = Column(
        UUID(as_uuid=True),
        ForeignKey("tickets.id", ondelete="CASCADE"),
        nullable=False,
    )
    filename = Column(String(500), nullable=False)
    minio_key = Column(String(1000), nullable=False)
    size_bytes = Column(BigInteger, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, default=utcnow)


class SymptomCategory(Base):
    __tablename__ = "symptom_categories"
    __table_args__ = (
        Index("ix_symptom_categories_tenant_parent", "tenant_id", "parent_id"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=gen_uuid)
    tenant_id = Column(UUID(as_uuid=True), nullable=False)
    name = Column(String(100), nullable=False)
    parent_id = Column(
        UUID(as_uuid=True),
        ForeignKey("symptom_categories.id", ondelete="CASCADE"),
        nullable=True,
    )
    display_order = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), nullable=False, default=utcnow)


class CauseCategory(Base):
    __tablename__ = "cause_categories"
    __table_args__ = (
        Index("ix_cause_categories_tenant_parent", "tenant_id", "parent_id"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=gen_uuid)
    tenant_id = Column(UUID(as_uuid=True), nullable=False)
    name = Column(String(100), nullable=False)
    parent_id = Column(
        UUID(as_uuid=True),
        ForeignKey("cause_categories.id", ondelete="CASCADE"),
        nullable=True,
    )
    display_order = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), nullable=False, default=utcnow)


class TicketCause(Base):
    __tablename__ = "ticket_causes"
    __table_args__ = (
        Index("ix_ticket_causes_ticket", "ticket_id"),
    )

    ticket_id = Column(
        UUID(as_uuid=True),
        ForeignKey("tickets.id", ondelete="CASCADE"),
        primary_key=True,
    )
    cause_category_id = Column(
        UUID(as_uuid=True),
        ForeignKey("cause_categories.id", ondelete="CASCADE"),
        primary_key=True,
    )
    action_taken = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=utcnow)
