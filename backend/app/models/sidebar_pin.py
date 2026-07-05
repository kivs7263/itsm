"""SidebarPin 모델 — 사용자별 사이드바 즐겨찾기(pin) 저장 (ITSM-SIDEBAR-P1).

pinned_keys JSONB = ["tickets", "kb", ...] (NavItem.key — 사이드바 안정 key, href 아님).
인덱스는 migration 063과 동일명 __table_args__로 선언 (alembic check 드리프트 방지).
SA Workspace app/models/sidebar_pin.py 패턴 그대로 미러링.
"""
from __future__ import annotations

from sqlalchemy import Column, DateTime, ForeignKey, Index, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.models.base import Base, TimestampMixin, gen_uuid


class SidebarPin(Base, TimestampMixin):
    __tablename__ = "sidebar_pins"
    __table_args__ = (
        UniqueConstraint("tenant_id", "user_id", name="uq_sidebar_pins_user"),
        Index("ix_sidebar_pins_tenant_user", "tenant_id", "user_id"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=gen_uuid)
    tenant_id = Column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
    )
    user_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    pinned_keys = Column(JSONB, nullable=False, server_default="'[]'::jsonb")
