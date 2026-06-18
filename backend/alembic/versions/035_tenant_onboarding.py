"""035 tenants — onboarding_completed_at 컬럼 추가

Revision ID: 035_tenant_onboarding
Revises: 034_email_inbound_config
Create Date: 2026-06-18
"""
import sqlalchemy as sa
from alembic import op

revision = "035_tenant_onboarding"
down_revision = "034_email_inbound_config"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "tenants",
        sa.Column("onboarding_completed_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("tenants", "onboarding_completed_at")
