"""고객 메모 테이블 신규 생성.

Revision ID: 012_customer_notes
Revises: 011_customer_hierarchy
Create Date: 2026-06-14

설계 노트:
- KB(knowledge_base)와 별개 — 고객 카드 전용 내부 메모/문서
- content: Markdown 원문 저장 (렌더링은 프론트)
- ON DELETE CASCADE: 고객 삭제 시 메모도 함께 삭제
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "012_customer_notes"
down_revision = "011_customer_hierarchy"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "customer_notes",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "customer_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("customers.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("title", sa.String(200), nullable=True),
        sa.Column("content", sa.Text, nullable=True),
        sa.Column(
            "author_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index(
        "ix_customer_notes_tenant_customer",
        "customer_notes",
        ["tenant_id", "customer_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_customer_notes_tenant_customer", table_name="customer_notes")
    op.drop_table("customer_notes")
