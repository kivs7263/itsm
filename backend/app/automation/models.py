"""자동화 룰 엔진 SQLAlchemy 모델.

Tables:
- automation_rules: 룰 정의 (tenant_id, trigger_event, conditions, actions)
- automation_rule_runs: 실행 이력 + 감사 로그
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    SmallInteger,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID

# app.models.__init__이 automation.models를 임포트하지 않으므로 순환 없음
from app.models.base import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class AutomationRule(Base):
    """자동화 룰 정의.

    conditions: JSONLogic 표현식 배열 — 빈 배열([]) = 무조건 실행.
    actions: [{type, params}] 배열 — 순서대로 실행.
    priority: 높을수록 먼저 평가.
    run_limit_per_hour: None = 무제한.
    """

    __tablename__ = "automation_rules"
    __table_args__ = (
        UniqueConstraint("tenant_id", "name", name="uq_automation_rules_tenant_name"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
    )
    name = Column(Text, nullable=False)
    description = Column(Text, nullable=True)
    enabled = Column(Boolean, nullable=False, default=True)
    trigger_event = Column(Text, nullable=False)
    conditions = Column(JSONB, nullable=False, default=list)
    actions = Column(JSONB, nullable=False, default=list)
    priority = Column(Integer, nullable=False, default=0)
    run_limit_per_hour = Column(Integer, nullable=True)  # None = 무제한
    created_by = Column(UUID(as_uuid=True), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, default=_utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow)


class AutomationRuleRun(Base):
    """자동화 룰 실행 이력 + 감사 로그.

    status: pending | running | done | failed | skipped | rate_limited
    depth: 무한루프 방지용 실행 깊이 (최대 3)
    idempotency_key: UNIQUE — 동일 이벤트 중복 실행 차단
    """

    __tablename__ = "automation_rule_runs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    rule_id = Column(
        UUID(as_uuid=True),
        ForeignKey("automation_rules.id", ondelete="CASCADE"),
        nullable=False,
    )
    tenant_id = Column(UUID(as_uuid=True), nullable=False)
    trigger_event = Column(Text, nullable=False)
    trigger_payload = Column(JSONB, nullable=False)
    matched = Column(Boolean, nullable=False)
    depth = Column(SmallInteger, nullable=False, default=0)
    idempotency_key = Column(Text, nullable=True, unique=True)
    actions_result = Column(JSONB, nullable=True)
    status = Column(Text, nullable=False, default="pending")
    error = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=_utcnow)
    completed_at = Column(DateTime(timezone=True), nullable=True)
