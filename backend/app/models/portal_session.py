"""고객 포털 세션 모델."""
from __future__ import annotations

from sqlalchemy import Column, ForeignKey, Index, String
from sqlalchemy.dialects.postgresql import UUID

from app.models.base import Base, gen_uuid, utcnow
from sqlalchemy import DateTime


class PortalSession(Base):
    __tablename__ = "portal_sessions"
    __table_args__ = (
        Index("ix_portal_sessions_tenant_customer", "tenant_id", "customer_id"),
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
    token_hash = Column(String(255), unique=True, nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, default=utcnow)
