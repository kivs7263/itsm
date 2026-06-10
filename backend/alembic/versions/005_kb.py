"""005_kb — kb_articles 테이블 추가 (P2-4 KB 모듈)

Revision ID: 005_kb
Revises: 004_calendar_events
Create Date: 2026-06-10
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

# revision identifiers
revision = "005_kb"
down_revision = "004_calendar_events"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "kb_articles",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "tenant_id",
            UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("content", sa.Text, nullable=False),
        sa.Column("tags", JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column(
            "linked_ticket_id",
            UUID(as_uuid=True),
            sa.ForeignKey("tickets.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "author_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=False,
        ),
        sa.Column("is_published", sa.Boolean, nullable=False, server_default="true"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
    )

    op.create_index(
        "ix_kb_articles_tenant_id",
        "kb_articles",
        ["tenant_id"],
    )
    op.create_index(
        "ix_kb_articles_tenant_published",
        "kb_articles",
        ["tenant_id", "is_published"],
    )


def downgrade() -> None:
    op.drop_index("ix_kb_articles_tenant_published", table_name="kb_articles")
    op.drop_index("ix_kb_articles_tenant_id", table_name="kb_articles")
    op.drop_table("kb_articles")
