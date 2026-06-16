"""031 ticket sla response/resolution deadline columns

Revision ID: 031
Revises: 030
Create Date: 2026-06-16
"""
import sqlalchemy as sa
from alembic import op

revision = "031_ticket_sla_deadlines"
down_revision = "030_ticket_number_unique"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "tickets",
        sa.Column("sla_response_deadline", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "tickets",
        sa.Column("sla_resolution_deadline", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_tickets_tenant_sla_response",
        "tickets",
        ["tenant_id", "sla_response_deadline"],
    )


def downgrade() -> None:
    op.drop_index("ix_tickets_tenant_sla_response", table_name="tickets")
    op.drop_column("tickets", "sla_resolution_deadline")
    op.drop_column("tickets", "sla_response_deadline")
