"""tickets.symptom_category_id 컬럼 추가 — recurring_worker 감지 기준

Revision ID: 041_tickets_symptom_category
Revises: 040_billing_plan
Create Date: 2026-06-18
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "041_tickets_symptom_category"
down_revision = "040_billing_plan"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "tickets",
        sa.Column(
            "symptom_category_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("symptom_categories.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_tickets_symptom_category",
        "tickets",
        ["tenant_id", "symptom_category_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_tickets_symptom_category", table_name="tickets")
    op.drop_column("tickets", "symptom_category_id")
