"""공수 추적 모델 — TicketWorkLog."""
from __future__ import annotations

import enum

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Numeric,
    Text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.models.base import Base, gen_uuid, utcnow


class WorkType(str, enum.Enum):
    remote = "remote"
    onsite = "onsite"
    phone = "phone"
    email = "email"
    internal = "internal"


class CompletionStatus(str, enum.Enum):
    completed = "completed"
    partial = "partial"
    needs_followup = "needs_followup"


_work_type_enum = Enum(
    "remote", "onsite", "phone", "email", "internal",
    name="work_type_enum",
    create_type=False,
)

_completion_status_enum = Enum(
    "completed", "partial", "needs_followup",
    name="completion_status_enum",
    create_type=False,
)


class TicketWorkLog(Base):
    __tablename__ = "ticket_work_logs"
    __table_args__ = (
        Index("ix_work_logs_tenant_ticket", "tenant_id", "ticket_id"),
        Index("ix_work_logs_tenant_user_logged", "tenant_id", "user_id", "logged_at"),
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
    user_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    work_type = Column(_work_type_enum, nullable=False, default=WorkType.remote)
    hours = Column(Numeric(5, 2), nullable=False)
    billable = Column(Boolean, nullable=False, default=True)
    description = Column(Text, nullable=True)
    completion_status = Column(
        _completion_status_enum, nullable=True, default=CompletionStatus.completed
    )
    next_action = Column(Text, nullable=True)
    memo = Column(Text, nullable=True)
    started_at = Column(DateTime(timezone=True), nullable=True)
    logged_at = Column(DateTime(timezone=True), nullable=False, default=utcnow)
    # KPI-6: 공수 승인
    approved_by = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    approved_at = Column(DateTime(timezone=True), nullable=True)

    ticket = relationship("Ticket", lazy="select")
    user = relationship("User", foreign_keys=[user_id], lazy="select")
    approver = relationship("User", foreign_keys=[approved_by], lazy="select")
