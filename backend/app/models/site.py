"""Site 모델 — 지점/사무소/현장 (ADR-043 3정규화 신 테이블).

구 customers.kind='division' 를 승격한 정규화 테이블.
마이그레이션 057 스키마와 컬럼·타입·FK·인덱스 100% 일치.
address 컬럼: {line1, line2, city, state, country, postal_code} JSONB.
"""
from __future__ import annotations

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Index, String
from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.models.base import Base, gen_uuid, utcnow


class Site(Base):
    __tablename__ = "sites"
    __table_args__ = (
        Index("ix_sites_tenant_company", "tenant_id", "company_id"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=gen_uuid)
    tenant_id = Column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
    )
    company_id = Column(
        UUID(as_uuid=True),
        ForeignKey("companies.id", ondelete="CASCADE"),
        nullable=False,
    )
    name = Column(String(200), nullable=False)
    address = Column(JSONB, nullable=True)
    phone = Column(String(50), nullable=True)
    timezone = Column(String(100), nullable=True)
    is_headquarters = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at = Column(
        DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )
