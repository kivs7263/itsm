"""Problem Management 모델 (CA-P2-4).

Problem      : ITIL 문제 관리 레코드 (RCA / Known Error / Workaround)
ProblemTicket: Problem ↔ Ticket M:N 링크 테이블

설계 주의:
- status: String(20) — CHECK 제약은 마이그레이션(053)에만 존재.
  async alembic enum CREATE TYPE 중복 트랩 회피 (051/052 동일 패턴).
- priority: 기존 ticket_priority_enum 재사용 (create_type=False — 중복 CREATE TYPE 방지).
- Column(index=True) 금지 → __table_args__ Index 선언 (alembic autogenerate 드리프트 방지).
  인덱스 이름은 migration 053과 동일.
"""
from __future__ import annotations

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Index,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import ENUM as pgENUM, UUID

from app.models.base import Base, gen_uuid, utcnow

# 기존 ticket_priority_enum 재사용 — create_type=False 필수 (중복 CREATE TYPE 방지)
_priority_ref = pgENUM(
    "low", "medium", "high", "critical",
    name="ticket_priority_enum",
    create_type=False,
)


class Problem(Base):
    """ITIL Problem record — RCA, Known Error, Workaround 관리."""

    __tablename__ = "problems"
    __table_args__ = (
        # migration 053 인덱스 이름과 동일 (autogenerate 드리프트 방지)
        Index("ix_problems_tenant_status", "tenant_id", "status"),
        Index("ix_problems_tenant_known_error", "tenant_id", "is_known_error"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=gen_uuid)
    tenant_id = Column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
    )
    # PRB-YYYYMMDD-NNNN 형식, 생성 직후 부여 (ticket_number 동일 패턴)
    problem_number = Column(String(25), nullable=True)
    title = Column(String(500), nullable=False)
    description = Column(Text, nullable=True)
    # status: String(20), CHECK 제약은 migration에 존재
    status = Column(String(20), nullable=False, default="new")
    priority = Column(_priority_ref, nullable=False, default="medium")
    root_cause = Column(Text, nullable=True)
    workaround = Column(Text, nullable=True)
    is_known_error = Column(Boolean, nullable=False, default=False)
    source_recurring_alert_id = Column(
        UUID(as_uuid=True),
        ForeignKey("recurring_alerts.id", ondelete="SET NULL"),
        nullable=True,
    )
    assigned_to = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_by = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow)


class ProblemTicket(Base):
    """Problem ↔ Ticket M:N 링크 (인시던트 연결)."""

    __tablename__ = "problem_tickets"
    __table_args__ = (
        UniqueConstraint(
            "problem_id", "ticket_id",
            name="uq_problem_tickets_problem_ticket",
        ),
        # migration 053 인덱스 이름과 동일
        Index("ix_problem_tickets_tenant_ticket", "tenant_id", "ticket_id"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=gen_uuid)
    tenant_id = Column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
    )
    problem_id = Column(
        UUID(as_uuid=True),
        ForeignKey("problems.id", ondelete="CASCADE"),
        nullable=False,
    )
    ticket_id = Column(
        UUID(as_uuid=True),
        ForeignKey("tickets.id", ondelete="CASCADE"),
        nullable=False,
    )
    linked_at = Column(DateTime(timezone=True), nullable=False, default=utcnow)
