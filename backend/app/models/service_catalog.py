"""서비스 카탈로그 모델 — ServiceCategory / ServiceOffering / ServiceOfferingSubmission.

설계 원칙:
- 기존 ticket_priority_enum / sla_grade_enum 재사용 (create_type=False — 중복 생성 금지).
- 모든 테이블 tenant_id NOT NULL (멀티테넌트 row-level isolation).
- JSONB 컬럼 server_default는 마이그레이션에서 ALTER TABLE로 설정 (asyncpg CREATE TABLE
  인라인 JSONB server_default 렌더링 버그 회피 — migration 050 동일 패턴).
"""
from __future__ import annotations

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.models.base import Base, gen_uuid, utcnow

# ── 기존 PG enum 타입 재사용 (새 타입 생성 금지) ──────────────────────────────
# ticket.py에서 정의된 ticket_priority_enum (low/medium/high/critical)
_ticket_priority_ref = Enum(
    "low", "medium", "high", "critical",
    name="ticket_priority_enum",
    create_type=False,
)
# sla.py에서 정의된 sla_grade_enum (bronze/silver/gold/platinum)
_sla_grade_ref = Enum(
    "bronze", "silver", "gold", "platinum",
    name="sla_grade_enum",
    create_type=False,
)


class ServiceCategory(Base):
    """서비스 카탈로그 분류 — 계층 구조(parent_id 자기참조) 지원."""

    __tablename__ = "service_categories"
    __table_args__ = (
        UniqueConstraint("tenant_id", "slug", name="uq_service_categories_tenant_slug"),
        Index("ix_service_categories_tenant_parent", "tenant_id", "parent_id"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=gen_uuid)
    tenant_id = Column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
    )
    name = Column(String(100), nullable=False)
    slug = Column(String(60), nullable=False)
    icon = Column(String(60), nullable=True)
    parent_id = Column(
        UUID(as_uuid=True),
        ForeignKey("service_categories.id", ondelete="CASCADE"),
        nullable=True,
    )
    display_order = Column(Integer, nullable=False, default=0)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at = Column(
        DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )


class ServiceOffering(Base):
    """서비스 제공 항목 — 폼 스키마·승인 정책·기본 SLA 포함."""

    __tablename__ = "service_offerings"
    __table_args__ = (
        UniqueConstraint("tenant_id", "code", name="uq_service_offerings_tenant_code"),
        Index(
            "ix_service_offerings_tenant_active_category",
            "tenant_id", "is_active", "category_id",
        ),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=gen_uuid)
    tenant_id = Column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
    )
    category_id = Column(
        UUID(as_uuid=True),
        ForeignKey("service_categories.id", ondelete="SET NULL"),
        nullable=True,
    )
    code = Column(String(60), nullable=False)
    name = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    icon = Column(String(60), nullable=True)
    request_type = Column(String(30), nullable=False)
    default_priority = Column(
        _ticket_priority_ref, nullable=False, default="medium"
    )
    default_sla_grade = Column(_sla_grade_ref, nullable=True)
    # JSONB server_default은 마이그레이션에서 ALTER TABLE로 설정 (asyncpg 버그 회피)
    form_schema = Column(JSONB, nullable=False)
    approval_policy = Column(JSONB, nullable=False)
    is_active = Column(Boolean, nullable=False, default=True)
    is_system = Column(Boolean, nullable=False, default=False)
    display_order = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at = Column(
        DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )


class ServiceOfferingSubmission(Base):
    """서비스 제공 항목 제출 — 티켓과 1:1 연결."""

    __tablename__ = "service_offering_submissions"
    __table_args__ = (
        Index(
            "ix_service_offering_submissions_tenant_offering",
            "tenant_id", "offering_id",
        ),
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
        unique=True,
    )
    offering_id = Column(
        UUID(as_uuid=True),
        ForeignKey("service_offerings.id", ondelete="RESTRICT"),
        nullable=False,
    )
    offering_version = Column(Integer, nullable=False, default=1)
    # JSONB server_default은 마이그레이션에서 ALTER TABLE로 설정
    form_data = Column(JSONB, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, default=utcnow)
