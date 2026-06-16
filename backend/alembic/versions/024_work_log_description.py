"""ticket_work_logs에 작업 내용/완료 상태/다음 액션 컬럼 추가.

Revision ID: 024_work_log_description
Revises: 023_tenant_notification_config
Create Date: 2026-06-16
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "024_work_log_description"
down_revision = "023_tenant_notification_config"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "CREATE TYPE completion_status_enum AS ENUM ('completed', 'partial', 'needs_followup')"
    )
    op.add_column(
        "ticket_work_logs",
        sa.Column("description", sa.Text(), nullable=True),
    )
    op.add_column(
        "ticket_work_logs",
        sa.Column(
            "completion_status",
            sa.Enum(
                "completed", "partial", "needs_followup",
                name="completion_status_enum",
                create_type=False,
            ),
            nullable=True,
            server_default="completed",
        ),
    )
    op.add_column(
        "ticket_work_logs",
        sa.Column("next_action", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("ticket_work_logs", "next_action")
    op.drop_column("ticket_work_logs", "completion_status")
    op.drop_column("ticket_work_logs", "description")
    op.execute("DROP TYPE completion_status_enum")
