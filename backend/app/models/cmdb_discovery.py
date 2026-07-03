"""CMDB Discovery Run 모델 (RA-C10-A).

SNMP 기반 자동 발견 실행 1건 이력.
status: pending → running → completed | failed
errors: [{host: str, message: str}, ...]
"""
from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy import Column, DateTime, ForeignKey, Index, Integer, String
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.sql import text

from app.models.base import Base, gen_uuid, utcnow


class DiscoveryRun(Base):
    __tablename__ = "discovery_runs"
    __table_args__ = (
        Index(
            "ix_discovery_runs_tenant_created",
            "tenant_id",
            text("created_at DESC"),
        ),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=gen_uuid)
    tenant_id = Column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
    )
    # 단일 호스트("192.168.1.1") 또는 CIDR("192.168.1.0/24")
    target = Column(String(500), nullable=False)
    # pending | running | completed | failed
    status = Column(String(50), nullable=False, default="pending")
    started_at = Column(DateTime(timezone=True), nullable=True)
    finished_at = Column(DateTime(timezone=True), nullable=True)
    discovered_count = Column(Integer, nullable=False, default=0)
    error_count = Column(Integer, nullable=False, default=0)
    errors = Column(
        JSONB,
        nullable=False,
        default=list,
        server_default=sa.text("'[]'::jsonb"),
    )
    created_by = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        default=utcnow,
        server_default=sa.text("now()"),
    )
