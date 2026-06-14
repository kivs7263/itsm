"""티켓, 댓글, 첨부파일, 분류 모델."""
from __future__ import annotations

import enum

from sqlalchemy import BigInteger, Boolean, Column, Enum, ForeignKey, Index, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID

from app.models.base import Base, gen_uuid, utcnow
from sqlalchemy import DateTime


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
    ticket_number = Column(String(25), nullable=True, unique=False)  # TKT-YYYYMMDD-NNNN
    created_at = Column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow)
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    closed_at = Column(DateTime(timezone=True), nullable=True)


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
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    body = Column(Text, nullable=False)
    is_internal = Column(Boolean, nullable=False, default=False)
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
