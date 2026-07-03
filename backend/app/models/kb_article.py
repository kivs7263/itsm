"""KB 지식베이스 문서 모델."""
from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy import Boolean, Column, ForeignKey, Index, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import relationship

from app.models.base import Base, TimestampMixin, gen_uuid, utcnow  # noqa: F401 (utcnow used by TimestampMixin)


class KbArticle(Base, TimestampMixin):
    __tablename__ = "kb_articles"
    __table_args__ = (
        Index("ix_kb_articles_tenant_id", "tenant_id"),
        Index("ix_kb_articles_tenant_published", "tenant_id", "is_published"),
        # RA-C10: 마이그 055가 만든 복합 인덱스를 모델에도 선언(autogenerate 정합)
        Index("ix_kb_articles_category_id", "tenant_id", "category_id"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=gen_uuid)
    tenant_id = Column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
    )
    title = Column(String(500), nullable=False)
    content = Column(Text, nullable=False)
    tags = Column(JSONB, nullable=False, default=list, server_default="'[]'::jsonb")
    linked_ticket_id = Column(
        UUID(as_uuid=True),
        ForeignKey("tickets.id", ondelete="SET NULL"),
        nullable=True,
    )
    author_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=False,
    )
    is_published = Column(Boolean, nullable=False, default=True)
    view_count = Column(sa.Integer, nullable=False, default=0, server_default="0")
    helpful_votes = Column(sa.Integer, nullable=False, default=0, server_default="0")
    not_helpful_votes = Column(sa.Integer, nullable=False, default=0, server_default="0")
    author_name = Column(String(255), nullable=True)
    # P5-4 알려진 이슈
    is_known_issue = Column(Boolean, nullable=False, default=False)
    ki_severity = Column(String(20), nullable=True)
    ki_symptom_category_id = Column(
        UUID(as_uuid=True),
        ForeignKey("symptom_categories.id", ondelete="SET NULL"),
        nullable=True,
    )
    ki_status = Column(String(20), nullable=True, default="open")

    # RA-C10-B: KB 카테고리 FK (migration 055)
    category_id = Column(
        UUID(as_uuid=True),
        ForeignKey("kb_categories.id", ondelete="SET NULL"),
        nullable=True,
    )

    # TimestampMixin에서 created_at / updated_at 상속
    # 단, server_default 없이 Python default만 사용하므로 아래에서 명시 오버라이드
    # (TimestampMixin의 created_at/updated_at는 Column() 직접 정의로 상속됨)

    # relationship (lazy="select")
    ticket = relationship(
        "Ticket",
        foreign_keys=[linked_ticket_id],
        lazy="select",
    )
