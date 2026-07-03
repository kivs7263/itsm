"""Company 모델 — 법인/고객사 (ADR-043 3정규화 신 테이블).

구 customers.kind='account' 를 승격한 정규화 테이블.
마이그레이션 057 스키마와 컬럼·타입·FK·인덱스 100% 일치.
"""
from __future__ import annotations

from sqlalchemy import Column, DateTime, ForeignKey, Index, String, Text
from sqlalchemy.dialects.postgresql import UUID

from app.models.base import Base, gen_uuid, utcnow


class Company(Base):
    __tablename__ = "companies"
    __table_args__ = (
        Index("ix_companies_tenant_name", "tenant_id", "name"),
        Index("ix_companies_tenant_contract_grade", "tenant_id", "contract_grade"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=gen_uuid)
    tenant_id = Column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
    )
    name = Column(String(200), nullable=False)
    industry = Column(String(100), nullable=True)
    contract_grade = Column(String(50), nullable=True)
    linked_business_id = Column(UUID(as_uuid=True), nullable=True)
    website = Column(String(500), nullable=True)
    memo = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at = Column(
        DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )
