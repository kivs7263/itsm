"""CSAT Survey 모델 — CSATSurvey (고객 포털 만족도 설문).

설계 노트:
- ENUM(csat_status_enum)은 migration 008 에서 생성되며 모델 선언은 동일 name + 동일 값 순서 유지.
- create_type=False — migration 에서 이미 생성됨.
- 멀티테넌트: tenant_id NOT NULL + (tenant_id, ...) 복합 인덱스.
- survey_token: 모델에서는 unique=True 선언하지 않음 — migration UNIQUE constraint
  (uq_csat_surveys_token) 가 단일 source of truth. 무명 UNIQUE 회피.
- ticket_id: 모델 unique 선언 없음 — migration UNIQUE constraint (uq_csat_surveys_ticket).
- TIMESTAMPTZ 컬럼 기본값은 base.utcnow() 함수 사용 (datetime.utcnow() 금지).
- expires_at 은 application 레이어에서 sent_at + 7일 계산 후 삽입 (DB default 없음).
"""
from __future__ import annotations

import enum

from sqlalchemy import (
    Column,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    SmallInteger,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.models.base import Base, gen_uuid


# ----------------------------------------------------------------------
# Python enum (코드 체인 동기화용 — 서비스/Pydantic 레이어에서 import)
# ----------------------------------------------------------------------
class CSATStatus(str, enum.Enum):
    pending = "pending"
    submitted = "submitted"
    expired = "expired"


# ----------------------------------------------------------------------
# SQLAlchemy ENUM 컬럼 정의 (create_type=False — migration 에서 이미 생성)
# ----------------------------------------------------------------------
_csat_status_enum = Enum(
    "pending",
    "submitted",
    "expired",
    name="csat_status_enum",
    create_type=False,
)


# ----------------------------------------------------------------------
# CSATSurvey
# ----------------------------------------------------------------------
class CSATSurvey(Base):
    __tablename__ = "csat_surveys"
    __table_args__ = (
        Index("ix_csat_surveys_tenant", "tenant_id"),
        Index("ix_csat_surveys_tenant_status", "tenant_id", "status"),
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
    customer_id = Column(
        UUID(as_uuid=True),
        ForeignKey("customers.id", ondelete="SET NULL"),
        nullable=True,
    )
    survey_token = Column(String(64), nullable=False)
    score = Column(
        SmallInteger,
        nullable=True,
        comment="제출 후에만 값 존재 (1-5)",
    )
    comment = Column(Text, nullable=True)
    status = Column(
        _csat_status_enum,
        nullable=False,
        default=CSATStatus.pending,
    )
    sent_at = Column(
        DateTime(timezone=True),
        nullable=False,
    )
    submitted_at = Column(
        DateTime(timezone=True),
        nullable=True,
    )
    expires_at = Column(
        DateTime(timezone=True),
        nullable=False,
        comment="application 에서 sent_at + 7일 계산 후 삽입",
    )
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
    )

    # relationships
    ticket = relationship("Ticket", lazy="select")
    customer = relationship("Customer", lazy="select")
