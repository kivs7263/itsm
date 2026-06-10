"""SLA 정책 및 이벤트 모델."""
from __future__ import annotations

import enum

from sqlalchemy import Column, Enum, ForeignKey, Index, Integer, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID

from app.models.base import Base, gen_uuid, utcnow
from sqlalchemy import DateTime


class SLAGrade(str, enum.Enum):
    bronze = "bronze"
    silver = "silver"
    gold = "gold"
    platinum = "platinum"


class SLAEventType(str, enum.Enum):
    breach_warning = "breach_warning"
    breached = "breached"
    resolved = "resolved"


_sla_grade_enum = Enum(
    "bronze", "silver", "gold", "platinum",
    name="sla_grade_enum",
)
_sla_event_type_enum = Enum(
    "breach_warning", "breached", "resolved",
    name="sla_event_type_enum",
)


class SLAPolicy(Base):
    __tablename__ = "sla_policies"
    __table_args__ = (
        UniqueConstraint("tenant_id", "grade", name="uq_sla_policies_tenant_grade"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=gen_uuid)
    tenant_id = Column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
    )
    grade = Column(_sla_grade_enum, nullable=False)
    response_minutes = Column(Integer, nullable=False)
    resolution_minutes = Column(Integer, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, default=utcnow)


class SLAEvent(Base):
    __tablename__ = "sla_events"
    __table_args__ = (
        Index("ix_sla_events_tenant_ticket", "tenant_id", "ticket_id"),
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
    event_type = Column(_sla_event_type_enum, nullable=False)
    fired_at = Column(DateTime(timezone=True), nullable=False, default=utcnow)
