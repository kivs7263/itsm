"""자산 모델."""
from __future__ import annotations

import enum

from sqlalchemy import Column, Date, Enum, ForeignKey, Index, String
from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.models.base import Base, gen_uuid, utcnow
from sqlalchemy import DateTime


class AssetType(str, enum.Enum):
    hw = "hw"
    sw = "sw"


_asset_type_enum = Enum("hw", "sw", name="asset_type_enum")


class Asset(Base):
    __tablename__ = "assets"
    __table_args__ = (
        Index("ix_assets_tenant_customer", "tenant_id", "customer_id"),
        Index("ix_assets_tenant_tag", "tenant_id", "asset_tag"),
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
    asset_tag = Column(String(100), nullable=False)
    model = Column(String(200), nullable=False)
    serial = Column(String(200), nullable=True)
    asset_type = Column(_asset_type_enum, nullable=False)
    location = Column(JSONB, nullable=False, default=dict, server_default="{}")
    installed_at = Column(Date, nullable=True)
    warranty_end = Column(Date, nullable=True)
    license_end = Column(Date, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow)
