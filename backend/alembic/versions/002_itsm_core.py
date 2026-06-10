"""002_itsm_core — customers, assets, contracts

Revision ID: 002_itsm_core
Revises: 001_initial
Create Date: 2026-06-10
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision = "002_itsm_core"
down_revision = "001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # customers
    # ------------------------------------------------------------------
    op.create_table(
        "customers",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "tenant_id",
            UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("email", sa.String(255), nullable=True),
        sa.Column("phone", sa.String(50), nullable=True),
        sa.Column("company", sa.String(200), nullable=True),
        sa.Column("contract_grade", sa.String(50), nullable=True),
        sa.Column("linked_business_id", UUID(as_uuid=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("ix_customers_tenant_email", "customers", ["tenant_id", "email"])
    op.create_index("ix_customers_tenant_company", "customers", ["tenant_id", "company"])

    # ------------------------------------------------------------------
    # assets
    # ------------------------------------------------------------------
    op.create_table(
        "assets",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "tenant_id",
            UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "customer_id",
            UUID(as_uuid=True),
            sa.ForeignKey("customers.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("asset_tag", sa.String(100), nullable=False),
        sa.Column("model", sa.String(200), nullable=False),
        sa.Column("serial", sa.String(200), nullable=True),
        sa.Column(
            "asset_type",
            sa.Enum("hw", "sw", name="asset_type_enum"),
            nullable=False,
        ),
        sa.Column("location", sa.JSON, nullable=False, server_default="{}"),
        sa.Column("installed_at", sa.Date, nullable=True),
        sa.Column("warranty_end", sa.Date, nullable=True),
        sa.Column("license_end", sa.Date, nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("ix_assets_tenant_customer", "assets", ["tenant_id", "customer_id"])
    op.create_index("ix_assets_tenant_tag", "assets", ["tenant_id", "asset_tag"])

    # ------------------------------------------------------------------
    # contracts
    # ------------------------------------------------------------------
    op.create_table(
        "contracts",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "tenant_id",
            UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "customer_id",
            UUID(as_uuid=True),
            sa.ForeignKey("customers.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("linked_business_id", UUID(as_uuid=True), nullable=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column(
            "type",
            sa.Enum("warranty", "paid", "maintenance", name="contract_type_enum"),
            nullable=False,
        ),
        sa.Column("sla_grade", sa.String(50), nullable=False),
        sa.Column("support_hours", sa.String(100), nullable=True),
        sa.Column("start_date", sa.Date, nullable=False),
        sa.Column("end_date", sa.Date, nullable=False),
        sa.Column("amount", sa.Numeric(15, 2), nullable=True),
        sa.Column("memo", sa.Text, nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("ix_contracts_tenant_customer", "contracts", ["tenant_id", "customer_id"])
    op.create_index("ix_contracts_tenant_end_date", "contracts", ["tenant_id", "end_date"])


def downgrade() -> None:
    # DROP 역순
    op.drop_index("ix_contracts_tenant_end_date", table_name="contracts")
    op.drop_index("ix_contracts_tenant_customer", table_name="contracts")
    op.drop_table("contracts")

    op.drop_index("ix_assets_tenant_tag", table_name="assets")
    op.drop_index("ix_assets_tenant_customer", table_name="assets")
    op.drop_table("assets")

    op.drop_index("ix_customers_tenant_company", table_name="customers")
    op.drop_index("ix_customers_tenant_email", table_name="customers")
    op.drop_table("customers")

    # ENUM 타입 DROP (역순)
    op.execute("DROP TYPE IF EXISTS contract_type_enum")
    op.execute("DROP TYPE IF EXISTS asset_type_enum")
