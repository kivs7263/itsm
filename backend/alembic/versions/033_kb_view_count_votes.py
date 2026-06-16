"""033 kb_articles — view_count, helpful_votes, not_helpful_votes 컬럼 추가

Revision ID: 033_kb_view_count_votes
Revises: 032_contract_sla_grade_enum
Create Date: 2026-06-16
"""
import sqlalchemy as sa
from alembic import op

revision = "033_kb_view_count_votes"
down_revision = "032_contract_sla_grade_enum"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "kb_articles",
        sa.Column("view_count", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "kb_articles",
        sa.Column("helpful_votes", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "kb_articles",
        sa.Column("not_helpful_votes", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "kb_articles",
        sa.Column("author_name", sa.String(255), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("kb_articles", "author_name")
    op.drop_column("kb_articles", "not_helpful_votes")
    op.drop_column("kb_articles", "helpful_votes")
    op.drop_column("kb_articles", "view_count")
