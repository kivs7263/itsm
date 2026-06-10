"""티켓, 댓글, 첨부파일 모델."""
from __future__ import annotations

import enum

from sqlalchemy import BigInteger, Boolean, Column, Enum, ForeignKey, Index, String, Text
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
