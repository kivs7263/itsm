"""SLA 정책, 이벤트, 업무시간 캘린더 모델."""
from __future__ import annotations

import enum

import sqlalchemy as sa
from sqlalchemy import Column, DateTime, Enum, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.models.base import Base, gen_uuid, utcnow


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


class SLABusinessCalendar(Base):
    """테넌트별 업무시간 캘린더 (테넌트당 1행 — UNIQUE tenant_id).

    business_hours_json 형식:
        {"mon":[["09:00","18:00"]], ..., "sat":[], "sun":[]}
        요일키: mon/tue/wed/thu/fri/sat/sun, 빈 리스트=휴무.
        복수 구간 가능: [["09:00","12:00"],["13:00","18:00"]]

    holidays_json: ["YYYY-MM-DD", ...] — 해당일 종일 휴무.
    timezone: IANA tz name (예: "Asia/Seoul").
    """

    __tablename__ = "sla_business_calendar"
    __table_args__ = (
        UniqueConstraint("tenant_id", name="uq_sla_business_calendar_tenant"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=gen_uuid)
    tenant_id = Column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
    )
    business_hours_json = Column(JSONB, nullable=False)
    timezone = Column(
        String(64),
        nullable=False,
        default="Asia/Seoul",
        server_default="Asia/Seoul",
    )
    holidays_json = Column(
        JSONB,
        nullable=False,
        default=list,
        server_default=sa.text("'[]'::jsonb"),
    )
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        default=utcnow,
        server_default=sa.text("now()"),
    )
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        default=utcnow,
        onupdate=utcnow,
        server_default=sa.text("now()"),
    )
