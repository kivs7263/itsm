"""034 email_inbound_configs 테이블 신규 — IMAP 수신 설정 저장

Revision ID: 034_email_inbound_config
Revises: 033_kb_view_count_votes
Create Date: 2026-06-18
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "034_email_inbound_config"
down_revision = "033_kb_view_count_votes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "email_inbound_configs",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("imap_host", sa.String(255), nullable=False),
        sa.Column("imap_port", sa.Integer(), nullable=False, server_default="993"),
        sa.Column("imap_user", sa.String(255), nullable=False),
        sa.Column("imap_password_enc", sa.Text(), nullable=False),
        sa.Column("imap_folder", sa.String(100), nullable=False, server_default="'INBOX'"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="TRUE"),
        sa.Column("last_checked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id"], ["tenants.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", name="uq_email_inbound_configs_tenant"),
    )
    op.create_index(
        "ix_email_inbound_configs_tenant",
        "email_inbound_configs",
        ["tenant_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_email_inbound_configs_tenant", table_name="email_inbound_configs")
    op.drop_table("email_inbound_configs")
