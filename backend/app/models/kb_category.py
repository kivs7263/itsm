"""KB 카테고리 모델.

계층형 분류 (parent_id 자기참조 FK — 최대 2단계 권장, 무제한 허용).
멀티테넌트: tenant_id NOT NULL, 모든 쿼리 tenant_id 필터.
"""
from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy import Column, ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.models.base import Base, TimestampMixin, gen_uuid


class KbCategory(Base, TimestampMixin):
    __tablename__ = "kb_categories"
    __table_args__ = (
        Index("ix_kb_categories_tenant_id", "tenant_id"),
        UniqueConstraint(
            "tenant_id", "name", "parent_id",
            name="uq_kb_categories_tenant_name_parent",
        ),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=gen_uuid)
    tenant_id = Column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
    )
    name = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    parent_id = Column(
        UUID(as_uuid=True),
        ForeignKey("kb_categories.id", ondelete="SET NULL"),
        nullable=True,
    )

    # relationship (lazy="select" — cold-load only when explicitly needed)
    children = relationship(
        "KbCategory",
        foreign_keys=[parent_id],
        lazy="select",
    )
