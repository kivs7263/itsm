"""Change Management 모델 — ChangeRequest, CRCILink.

설계 노트:
- ENUM은 migration 007 에서 생성되며 모델 선언은 동일 name + 동일 값 순서 유지.
- create_type=False — migration 에서 이미 생성, ORM 에서 중복 생성 금지.
- 멀티테넌트: 모든 테이블 tenant_id NOT NULL + (tenant_id, ...) 복합 인덱스.
- UNIQUE constraint name: uq_cr_ci_links_cr_ci — migration/모델 양쪽 동일.
- TIMESTAMPTZ 컬럼 기본값은 base.utcnow() 함수 사용 (datetime.utcnow() 금지).
- gw_approval_doc_id 는 GW 결재 시스템 외부 참조 — FK 없음.
- relationship: ChangeRequest.ci_links → List[CRCILink] (lazy="select" 기본)
- ChangeRequest.requestor / implementor / reviewer → User (lazy="select")
"""
from __future__ import annotations

import enum

from sqlalchemy import (
    Column,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.models.base import Base, gen_uuid, utcnow


# ----------------------------------------------------------------------
# Python enums (코드 체인 동기화용 — 서비스/Pydantic 레이어에서 import)
# ----------------------------------------------------------------------
class CRChangeType(str, enum.Enum):
    normal = "normal"
    emergency = "emergency"
    standard = "standard"


class CRStatus(str, enum.Enum):
    draft = "draft"
    pending_review = "pending_review"
    pending_approval = "pending_approval"
    approved = "approved"
    scheduled = "scheduled"
    in_progress = "in_progress"
    completed = "completed"
    rejected = "rejected"
    cancelled = "cancelled"


class CRRiskLevel(str, enum.Enum):
    low = "low"
    medium = "medium"
    high = "high"
    critical = "critical"


class CRPriority(str, enum.Enum):
    low = "low"
    medium = "medium"
    high = "high"
    critical = "critical"


# ----------------------------------------------------------------------
# SQLAlchemy ENUM 컬럼 정의 (create_type=False — migration 에서 이미 생성)
# ----------------------------------------------------------------------
_cr_change_type_enum = Enum(
    "normal",
    "emergency",
    "standard",
    name="cr_change_type_enum",
    create_type=False,
)
_cr_status_enum = Enum(
    "draft",
    "pending_review",
    "pending_approval",
    "approved",
    "scheduled",
    "in_progress",
    "completed",
    "rejected",
    "cancelled",
    name="cr_status_enum",
    create_type=False,
)
_cr_risk_enum = Enum(
    "low",
    "medium",
    "high",
    "critical",
    name="cr_risk_enum",
    create_type=False,
)
_cr_priority_enum = Enum(
    "low",
    "medium",
    "high",
    "critical",
    name="cr_priority_enum",
    create_type=False,
)


# ----------------------------------------------------------------------
# ChangeRequest
# ----------------------------------------------------------------------
class ChangeRequest(Base):
    __tablename__ = "change_requests"
    __table_args__ = (
        Index("ix_change_requests_tenant", "tenant_id"),
        Index("ix_change_requests_tenant_status", "tenant_id", "status"),
        Index("ix_change_requests_tenant_type", "tenant_id", "change_type"),
        Index("ix_change_requests_requestor", "requestor_id"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=gen_uuid)
    tenant_id = Column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
    )
    title = Column(String(500), nullable=False)
    description = Column(Text, nullable=True)
    change_type = Column(
        _cr_change_type_enum,
        nullable=False,
        default=CRChangeType.normal,
    )
    status = Column(
        _cr_status_enum,
        nullable=False,
        default=CRStatus.draft,
    )
    risk_level = Column(
        _cr_risk_enum,
        nullable=False,
        default=CRRiskLevel.medium,
    )
    priority = Column(
        _cr_priority_enum,
        nullable=False,
        default=CRPriority.medium,
    )
    planned_start = Column(DateTime(timezone=True), nullable=True)
    planned_end = Column(DateTime(timezone=True), nullable=True)
    actual_start = Column(DateTime(timezone=True), nullable=True)
    actual_end = Column(DateTime(timezone=True), nullable=True)
    rollback_plan = Column(Text, nullable=True)
    implementation_plan = Column(Text, nullable=True)
    test_plan = Column(Text, nullable=True)
    requestor_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    implementor_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    reviewer_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    gw_approval_doc_id = Column(
        UUID(as_uuid=True),
        nullable=True,
        comment="GW 결재 document ID (외부 시스템 참조, FK 없음)",
    )
    gw_approval_status = Column(
        String(50),
        nullable=False,
        default="not_submitted",
    )
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        default=utcnow,
    )
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        default=utcnow,
        onupdate=utcnow,
    )

    # relationships
    ci_links = relationship(
        "CRCILink",
        back_populates="change_request",
        cascade="all, delete-orphan",
        lazy="select",
    )
    requestor = relationship(
        "User",
        foreign_keys=[requestor_id],
        lazy="select",
    )
    implementor = relationship(
        "User",
        foreign_keys=[implementor_id],
        lazy="select",
    )
    reviewer = relationship(
        "User",
        foreign_keys=[reviewer_id],
        lazy="select",
    )


# ----------------------------------------------------------------------
# CRCILink (change_request ↔ CI junction)
# ----------------------------------------------------------------------
class CRCILink(Base):
    __tablename__ = "cr_ci_links"
    __table_args__ = (
        UniqueConstraint(
            "change_request_id",
            "ci_id",
            name="uq_cr_ci_links_cr_ci",
        ),
        Index("ix_cr_ci_links_cr", "change_request_id"),
        Index("ix_cr_ci_links_ci", "ci_id"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=gen_uuid)
    change_request_id = Column(
        UUID(as_uuid=True),
        ForeignKey("change_requests.id", ondelete="CASCADE"),
        nullable=False,
    )
    ci_id = Column(
        UUID(as_uuid=True),
        ForeignKey("configuration_items.id", ondelete="CASCADE"),
        nullable=False,
    )
    tenant_id = Column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
    )
    notes = Column(Text, nullable=True)
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        default=utcnow,
    )

    # relationships
    change_request = relationship(
        "ChangeRequest",
        back_populates="ci_links",
        lazy="select",
    )
