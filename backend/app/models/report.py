"""보고서 모델 (P6-2 보고서 승인 워크플로우).

상태 전이:
  draft → submitted → approved
                   ↘ rejected

설계 원칙:
- status / report_type: VARCHAR(20) — ENUM 미사용 (asyncpg 캐시 이슈 + ALTER TYPE 제약 회피, 016/019 결정과 동일)
- summary_data: JSONB — 집계 스냅샷 저장
- submitted_by / reviewed_by: ON DELETE SET NULL — 사용자 삭제 시 이력 보존
- tenant_id 선두 인덱스: 멀티테넌트 격리 (★★ 핵심 체크)
"""
from __future__ import annotations

import uuid

from sqlalchemy import Column, Date, DateTime, ForeignKey, Index, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.models.base import Base, gen_uuid, utcnow


class ReportStatus:
    """보고서 상태 상수 (str)."""

    DRAFT = "draft"
    SUBMITTED = "submitted"
    APPROVED = "approved"
    REJECTED = "rejected"


class Report(Base):
    __tablename__ = "reports"
    __table_args__ = (
        Index("ix_reports_tenant_status", "tenant_id", "status"),
        Index("ix_reports_tenant_period", "tenant_id", "period_start", "period_end"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=gen_uuid)
    tenant_id = Column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
    )
    report_type = Column(String(20), nullable=False)   # 'monthly' | 'weekly'
    period_start = Column(Date, nullable=False)
    period_end = Column(Date, nullable=False)
    title = Column(String(300), nullable=False)
    summary_data = Column(JSONB, nullable=False, default=dict, server_default="'{}'::jsonb")
    status = Column(String(20), nullable=False, default=ReportStatus.DRAFT)
    submitted_by = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    submitted_at = Column(DateTime(timezone=True), nullable=True)
    reviewed_by = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    reviewed_at = Column(DateTime(timezone=True), nullable=True)
    review_comment = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow)
