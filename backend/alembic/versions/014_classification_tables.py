"""분류 체계: symptom_categories, cause_categories, ticket_causes 신규 생성.

Revision ID: 014_classification_tables
Revises: 013_ticket_structure
Create Date: 2026-06-14

설계 노트:
- symptom_categories: 2단계 트리 (parent_id self-FK), tenant별 관리
- cause_categories: 동일 구조
- ticket_causes: 티켓-원인 다대다, 복수 원인 + 조치 내용 기록
- 초기 시드는 애플리케이션 startup 또는 별도 스크립트에서 주입
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "014_classification_tables"
down_revision = "013_ticket_structure"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 증상 분류
    op.create_table(
        "symptom_categories",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column(
            "parent_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("symptom_categories.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("display_order", sa.Integer, nullable=False, server_default="0"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index(
        "ix_symptom_categories_tenant_parent",
        "symptom_categories",
        ["tenant_id", "parent_id"],
    )

    # 원인 분류
    op.create_table(
        "cause_categories",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column(
            "parent_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("cause_categories.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("display_order", sa.Integer, nullable=False, server_default="0"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index(
        "ix_cause_categories_tenant_parent",
        "cause_categories",
        ["tenant_id", "parent_id"],
    )

    # 티켓-원인 다대다
    op.create_table(
        "ticket_causes",
        sa.Column(
            "ticket_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tickets.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "cause_category_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("cause_categories.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("action_taken", sa.Text, nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("ticket_id", "cause_category_id"),
    )
    op.create_index(
        "ix_ticket_causes_ticket",
        "ticket_causes",
        ["ticket_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_ticket_causes_ticket", table_name="ticket_causes")
    op.drop_table("ticket_causes")
    op.drop_index("ix_cause_categories_tenant_parent", table_name="cause_categories")
    op.drop_table("cause_categories")
    op.drop_index("ix_symptom_categories_tenant_parent", table_name="symptom_categories")
    op.drop_table("symptom_categories")
