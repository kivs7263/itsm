"""KB 아티클 버전 이력 모델.

편집 시마다 편집 직전 스냅샷을 저장 (version_no AUTO 증가).
version_no: 아티클별 단조 증가 (1, 2, 3, …). 복원 시 새 버전 생성.
"""
from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy import Column, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.models.base import Base, gen_uuid, utcnow


class KbArticleVersion(Base):
    __tablename__ = "kb_article_versions"
    __table_args__ = (
        UniqueConstraint(
            "article_id", "version_no",
            name="uq_kb_article_versions_article_version",
        ),
        Index("ix_kb_article_versions_article_id", "article_id"),
        Index("ix_kb_article_versions_tenant_id", "tenant_id"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=gen_uuid)
    article_id = Column(
        UUID(as_uuid=True),
        ForeignKey("kb_articles.id", ondelete="CASCADE"),
        nullable=False,
    )
    tenant_id = Column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
    )
    version_no = Column(Integer, nullable=False)
    title = Column(String(500), nullable=False)
    content = Column(Text, nullable=False)
    tags = Column(
        JSONB,
        nullable=False,
        default=list,
        server_default=sa.text("'[]'::jsonb"),
    )
    edited_by = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    edited_by_name = Column(String(255), nullable=True)
    created_at = Column(
        sa.DateTime(timezone=True),
        nullable=False,
        default=utcnow,
        server_default=sa.text("now()"),
    )
