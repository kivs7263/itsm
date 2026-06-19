"""sso_org_id + kc_user_id 컬럼 추가 — ADR-044 SSO 자동 프로비저닝 레일 편입

Revision ID: 043_sso_org_id_kc_user_id
Revises: 042_ticket_activities
Create Date: 2026-06-19
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "043_sso_org_id_kc_user_id"
down_revision = "042_ticket_activities"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # tenants.sso_org_id — KC org UUID (ADR-002 정본)
    op.add_column(
        "tenants",
        sa.Column(
            "sso_org_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_tenants_sso_org_id",
        "tenants",
        ["sso_org_id"],
        unique=True,
        postgresql_where=sa.text("sso_org_id IS NOT NULL"),
    )

    # users.kc_user_id — KC sub string (KC sub는 UUID 문자열이나 String으로 저장)
    op.add_column(
        "users",
        sa.Column(
            "kc_user_id",
            sa.String(100),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_users_kc_user_id",
        "users",
        ["kc_user_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_users_kc_user_id", "users")
    op.drop_column("users", "kc_user_id")

    op.drop_index("ix_tenants_sso_org_id", "tenants")
    op.drop_column("tenants", "sso_org_id")
