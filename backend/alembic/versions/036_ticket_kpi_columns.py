"""KPI-1: tickets에 first_responded_at + reopen_count 추가.

Revision ID: 036
Revises: 035
Create Date: 2026-06-18
"""
from alembic import op
import sqlalchemy as sa

revision = "036_ticket_kpi_columns"
down_revision = "035_tenant_onboarding"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "tickets",
        sa.Column("first_responded_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "tickets",
        sa.Column("reopen_count", sa.SmallInteger(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_column("tickets", "reopen_count")
    op.drop_column("tickets", "first_responded_at")
