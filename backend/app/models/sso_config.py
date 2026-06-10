"""SSO 설정 모델."""
from __future__ import annotations

from sqlalchemy import Boolean, Column, ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.models.base import Base, gen_uuid, utcnow
from sqlalchemy import DateTime


class SSOConfig(Base):
    __tablename__ = "sso_configs"
    __table_args__ = (
        UniqueConstraint("tenant_id", name="uq_sso_configs_tenant_id"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=gen_uuid)
    tenant_id = Column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )
    oidc_issuer = Column(String(500), nullable=False)
    client_id = Column(String(255), nullable=False)
    client_secret_enc = Column(String, nullable=True)
    attribute_mapping = Column(JSONB, nullable=False, default=dict, server_default="{}")
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=utcnow)
