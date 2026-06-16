"""에스컬레이션 지원팀 + 이력 모델."""
from __future__ import annotations

import enum

from sqlalchemy import (
    Boolean, Column, DateTime, Enum, ForeignKey,
    Index, PrimaryKeyConstraint, SmallInteger, String, Text,
)
from sqlalchemy.dialects.postgresql import UUID

from app.models.base import Base, gen_uuid, utcnow


class EscalationReason(str, enum.Enum):
    technical_complexity = "technical_complexity"
    permission_lack = "permission_lack"
    sla_breach = "sla_breach"
    sla_warning = "sla_warning"
    customer_request = "customer_request"
    manual = "manual"
    other = "other"


_escalation_reason_pg = Enum(
    "technical_complexity", "permission_lack", "sla_breach",
    "sla_warning", "customer_request", "manual", "other",
    name="escalation_reason_enum",
    create_type=False,
)


class SupportTeam(Base):
    __tablename__ = "support_teams"
    __table_args__ = (
        Index("ix_support_teams_tenant", "tenant_id", "level"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=gen_uuid)
    tenant_id = Column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
    )
    name = Column(String(100), nullable=False)
    level = Column(SmallInteger, nullable=False, default=2)
    description = Column(Text, nullable=True)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=utcnow)


class SupportTeamMember(Base):
    __tablename__ = "support_team_members"
    __table_args__ = (
        PrimaryKeyConstraint("team_id", "user_id"),
    )

    team_id = Column(
        UUID(as_uuid=True),
        ForeignKey("support_teams.id", ondelete="CASCADE"),
        nullable=False,
    )
    user_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )


class TicketEscalation(Base):
    __tablename__ = "ticket_escalations"
    __table_args__ = (
        Index("ix_ticket_escalations_ticket", "tenant_id", "ticket_id"),
        Index("ix_ticket_escalations_team", "to_team_id", "created_at"),
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
    from_level = Column(SmallInteger, nullable=False, default=1)
    to_level = Column(SmallInteger, nullable=False, default=2)
    from_assigned = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    to_team_id = Column(
        UUID(as_uuid=True),
        ForeignKey("support_teams.id", ondelete="RESTRICT"),
        nullable=False,
    )
    to_assigned = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    reason = Column(_escalation_reason_pg, nullable=False)
    handover_memo = Column(Text, nullable=False)
    customer_summary = Column(Text, nullable=True)
    triggered_by = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    acknowledged_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=utcnow)
