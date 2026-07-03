"""Contact 모델 — 담당자/연락처 개인 (ADR-043 3정규화 신 테이블).

구 customer_contacts 를 승격한 정규화 테이블.
마이그레이션 057 스키마와 컬럼·타입·FK·인덱스 100% 일치.
- company_id: NOT NULL (반드시 특정 회사에 귀속)
- site_id:    NULLABLE (주 상주 지점, 선택)
- is_primary: 회사 대표 연락처 여부
"""
from __future__ import annotations

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Index, String, Text
from sqlalchemy.dialects.postgresql import UUID

from app.models.base import Base, gen_uuid, utcnow


class Contact(Base):
    __tablename__ = "contacts"
    __table_args__ = (
        Index("ix_contacts_tenant_company", "tenant_id", "company_id"),
        Index("ix_contacts_tenant_email", "tenant_id", "email"),
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
    site_id = Column(
        UUID(as_uuid=True),
        ForeignKey("sites.id", ondelete="SET NULL"),
        nullable=True,
    )
    name = Column(String(200), nullable=False)
    role = Column(String(100), nullable=True)
    email = Column(String(255), nullable=True)
    phone = Column(String(50), nullable=True)
    is_primary = Column(Boolean, nullable=False, default=False)
    memo = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at = Column(
        DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )
