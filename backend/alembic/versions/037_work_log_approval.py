"""KPI-6: ticket_work_logs에 approved_by + approved_at 추가.

Revision ID: 037
Revises: 036
Create Date: 2026-06-18
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "037_work_log_approval"
down_revision = "036_ticket_kpi_columns"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "ticket_work_logs",
        sa.Column("approved_by", UUID(as_uuid=True), nullable=True),
    )
    op.add_column(
        "ticket_work_logs",
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_work_logs_approved_by_users",
        "ticket_work_logs",
        "users",
        ["approved_by"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_work_logs_approved_by_users", "ticket_work_logs", type_="foreignkey")
    op.drop_column("ticket_work_logs", "approved_at")
    op.drop_column("ticket_work_logs", "approved_by")
