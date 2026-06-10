"""테넌트(조직) 모델."""
from __future__ import annotations

from sqlalchemy import Column, String
from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.models.base import Base, gen_uuid, utcnow
from sqlalchemy import DateTime


class Tenant(Base):
    __tablename__ = "tenants"

    id = Column(UUID(as_uuid=True), primary_key=True, default=gen_uuid)
    slug = Column(String(50), unique=True, nullable=False)
    name = Column(String(100), nullable=False)
    settings = Column(JSONB, nullable=False, default=dict, server_default="{}")
    created_at = Column(DateTime(timezone=True), nullable=False, default=utcnow)
