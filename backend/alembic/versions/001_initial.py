"""001_initial — tenants, users, sso_configs, audit_logs, teams, team_members

Revision ID: 001_initial
Revises:
Create Date: 2026-06-10

참고 패턴:
- ENUM 타입은 op.execute("CREATE TYPE ...") 로 별도 생성 (asyncpg 캐시 충돌 방지)
- CREATE TABLE 순서: tenants → users → sso_configs → audit_logs → teams → team_members
- self-referential/순환 FK: CREATE TABLE 후 별도 ALTER 사용
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # tenants
    # ------------------------------------------------------------------
    op.create_table(
        "tenants",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("slug", sa.String(50), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("settings", JSONB, nullable=False, server_default="{}"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("ix_tenants_slug", "tenants", ["slug"], unique=True)

    # ------------------------------------------------------------------
    # users
    # ------------------------------------------------------------------
    op.create_table(
        "users",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "tenant_id",
            UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column(
            "role",
            sa.Enum(
                "engineer", "team_lead", "admin", "customer",
                name="user_role_enum",
            ),
            nullable=False,
            server_default="engineer",
        ),
        sa.Column("hashed_password", sa.Text, nullable=True),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default="true"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("ix_users_tenant_id", "users", ["tenant_id"])
    op.create_unique_constraint(
        "uq_users_tenant_email", "users", ["tenant_id", "email"]
    )

    # ------------------------------------------------------------------
    # sso_configs
    # ------------------------------------------------------------------
    op.create_table(
        "sso_configs",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "tenant_id",
            UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("oidc_issuer", sa.String(500), nullable=False),
        sa.Column("client_id", sa.String(255), nullable=False),
        sa.Column("client_secret_enc", sa.Text, nullable=True),
        sa.Column("attribute_mapping", JSONB, nullable=False, server_default="{}"),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default="true"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_unique_constraint(
        "uq_sso_configs_tenant_id", "sso_configs", ["tenant_id"]
    )

    # ------------------------------------------------------------------
    # audit_logs
    # ------------------------------------------------------------------
    op.create_table(
        "audit_logs",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "tenant_id",
            UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("user_id", UUID(as_uuid=True), nullable=True),
        sa.Column("action", sa.String(100), nullable=False),
        sa.Column("target_type", sa.String(100), nullable=True),
        sa.Column("target_id", sa.String(255), nullable=True),
        sa.Column("meta", JSONB, nullable=False, server_default="{}"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        "ix_audit_logs_tenant_created", "audit_logs", ["tenant_id", "created_at"]
    )

    # ------------------------------------------------------------------
    # teams
    # ------------------------------------------------------------------
    op.create_table(
        "teams",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "tenant_id",
            UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("lead_user_id", UUID(as_uuid=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("ix_teams_tenant_id", "teams", ["tenant_id"])

    # lead_user_id → users.id FK: CREATE TABLE 후 별도 ALTER (멱등성 보장)
    op.create_foreign_key(
        "fk_teams_lead_user_id",
        "teams",
        "users",
        ["lead_user_id"],
        ["id"],
        ondelete="SET NULL",
    )

    # ------------------------------------------------------------------
    # team_members
    # ------------------------------------------------------------------
    op.create_table(
        "team_members",
        sa.Column(
            "team_id",
            UUID(as_uuid=True),
            sa.ForeignKey("teams.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "tenant_id",
            UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("team_id", "user_id"),
    )


def downgrade() -> None:
    # DROP TABLE 역순
    op.drop_table("team_members")

    op.drop_constraint("fk_teams_lead_user_id", "teams", type_="foreignkey")
    op.drop_table("teams")

    op.drop_index("ix_audit_logs_tenant_created", table_name="audit_logs")
    op.drop_table("audit_logs")

    op.drop_constraint("uq_sso_configs_tenant_id", "sso_configs", type_="unique")
    op.drop_table("sso_configs")

    op.drop_constraint("uq_users_tenant_email", "users", type_="unique")
    op.drop_index("ix_users_tenant_id", table_name="users")
    op.drop_table("users")

    op.drop_index("ix_tenants_slug", table_name="tenants")
    op.drop_table("tenants")

    # ENUM 타입 DROP (역순)
    op.execute("DROP TYPE IF EXISTS user_role_enum")
