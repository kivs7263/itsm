"""고객 모델."""
from __future__ import annotations

from sqlalchemy import Column, ForeignKey, Index, String
from sqlalchemy.dialects.postgresql import UUID

from app.models.base import Base, gen_uuid, utcnow
from sqlalchemy import DateTime


class Customer(Base):
    __tablename__ = "customers"
    __table_args__ = (
        Index("ix_customers_tenant_email", "tenant_id", "email"),
        Index("ix_customers_tenant_company", "tenant_id", "company"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=gen_uuid)
    tenant_id = Column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
    )
    name = Column(String(200), nullable=False)
    email = Column(String(255), nullable=True)
    phone = Column(String(50), nullable=True)
    company = Column(String(200), nullable=True)
    contract_grade = Column(String(50), nullable=True)
    linked_business_id = Column(UUID(as_uuid=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow)
