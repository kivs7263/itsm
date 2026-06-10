"""계약 모델."""
from __future__ import annotations

import enum

from sqlalchemy import Column, Date, Enum, ForeignKey, Index, Numeric, String, Text
from sqlalchemy.dialects.postgresql import UUID

from app.models.base import Base, gen_uuid, utcnow
from sqlalchemy import DateTime


class ContractType(str, enum.Enum):
    warranty = "warranty"
    paid = "paid"
    maintenance = "maintenance"


_contract_type_enum = Enum("warranty", "paid", "maintenance", name="contract_type_enum")


class Contract(Base):
    __tablename__ = "contracts"
    __table_args__ = (
        Index("ix_contracts_tenant_customer", "tenant_id", "customer_id"),
        Index("ix_contracts_tenant_end_date", "tenant_id", "end_date"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=gen_uuid)
    tenant_id = Column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
    )
    customer_id = Column(
        UUID(as_uuid=True),
        ForeignKey("customers.id", ondelete="CASCADE"),
        nullable=False,
    )
    linked_business_id = Column(UUID(as_uuid=True), nullable=True)
    name = Column(String(200), nullable=False)
    type = Column(_contract_type_enum, nullable=False)
    sla_grade = Column(String(50), nullable=False)
    support_hours = Column(String(100), nullable=True)
    start_date = Column(Date, nullable=False)
    end_date = Column(Date, nullable=False)
    amount = Column(Numeric(15, 2), nullable=True)
    memo = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow)
