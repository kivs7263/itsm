"""tenant_subscriptions and usage_metering tables

Revision ID: 040_billing_plan
Revises: 039_webhooks
Create Date: 2026-06-18
"""
from alembic import op
import sqlalchemy as sa

revision = "040_billing_plan"
down_revision = "039_webhooks"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "tenant_subscriptions",
        sa.Column("id", sa.UUID(), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", sa.UUID(), nullable=False),
        sa.Column("plan", sa.String(20), nullable=False, server_default=sa.text("'free'")),
        sa.Column("stripe_customer_id", sa.String(100), nullable=True),
        sa.Column("stripe_subscription_id", sa.String(100), nullable=True),
        sa.Column("current_period_end", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("seats_limit", sa.Integer(), nullable=False, server_default=sa.text("3")),
        sa.Column("ticket_limit_monthly", sa.Integer(), nullable=True),  # NULL = unlimited
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("TRUE")),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("tenant_id", name="uq_tenant_subscriptions_tenant"),
    )
    op.create_index("idx_tenant_subscriptions_stripe_customer", "tenant_subscriptions", ["stripe_customer_id"])

    op.create_table(
        "usage_metering",
        sa.Column("id", sa.UUID(), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", sa.UUID(), nullable=False),
        sa.Column("month", sa.String(7), nullable=False),  # yyyymm
        sa.Column("engineer_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("ticket_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("api_call_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("computed_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("tenant_id", "month", name="uq_usage_metering_tenant_month"),
    )
    op.create_index("idx_usage_metering_tenant_month", "usage_metering", ["tenant_id", "month"])


def downgrade() -> None:
    op.drop_index("idx_usage_metering_tenant_month", "usage_metering")
    op.drop_table("usage_metering")
    op.drop_index("idx_tenant_subscriptions_stripe_customer", "tenant_subscriptions")
    op.drop_table("tenant_subscriptions")
    pass  # String 컬럼 — 별도 타입 없음
