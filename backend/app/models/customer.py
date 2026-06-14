"""고객 모델."""
from __future__ import annotations

from sqlalchemy import Column, ForeignKey, Index, String, Text
from sqlalchemy.dialects.postgresql import UUID

from app.models.base import Base, gen_uuid, utcnow
from sqlalchemy import DateTime


class Customer(Base):
    __tablename__ = "customers"
    __table_args__ = (
        Index("ix_customers_tenant_email", "tenant_id", "email"),
        Index("ix_customers_tenant_company", "tenant_id", "company"),
        Index("ix_customers_tenant_parent", "tenant_id", "parent_id"),
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
    # 계층 구조 (P4-3)
    parent_id = Column(
        UUID(as_uuid=True),
        ForeignKey("customers.id", ondelete="SET NULL"),
        nullable=True,
    )
    kind = Column(String(20), nullable=False, default="account")  # account | division
    created_at = Column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow)


class CustomerNote(Base):
    __tablename__ = "customer_notes"
    __table_args__ = (
        Index("ix_customer_notes_tenant_customer", "tenant_id", "customer_id"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=gen_uuid)
    tenant_id = Column(UUID(as_uuid=True), nullable=False)
    customer_id = Column(
        UUID(as_uuid=True),
        ForeignKey("customers.id", ondelete="CASCADE"),
        nullable=False,
    )
    title = Column(String(200), nullable=True)
    content = Column(Text, nullable=True)
    author_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at = Column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow)
