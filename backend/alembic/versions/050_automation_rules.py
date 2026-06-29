"""automation_rules + automation_rule_runs 테이블 생성.

Revision ID: 050
Revises: 049_cr_rejection_reason
Create Date: 2026-06-30

Note: JSONB NOT NULL 기본값은 ALTER TABLE로 별도 설정 (asyncpg CREATE TABLE 인라인 JSONB
server_default 렌더링 버그 회피 — migration 016 op.add_column은 작동하나 op.create_table 인라인은
triple-quote 오류 발생).
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "050"
down_revision = "049_cr_rejection_reason"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ----------------------------------------------------------------
    # automation_rules — JSONB 컬럼은 nullable=True로 생성 후 ALTER DEFAULT 설정
    # ----------------------------------------------------------------
    op.create_table(
        "automation_rules",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("trigger_event", sa.Text(), nullable=False),
        sa.Column("conditions", postgresql.JSONB(), nullable=True),
        sa.Column("actions", postgresql.JSONB(), nullable=True),
        sa.Column("priority", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("run_limit_per_hour", sa.Integer(), nullable=True),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("tenant_id", "name", name="uq_automation_rules_tenant_name"),
    )
    # JSONB 기본값 + NOT NULL 제약
    op.execute("ALTER TABLE automation_rules ALTER COLUMN conditions SET DEFAULT '[]'::jsonb")
    op.execute("ALTER TABLE automation_rules ALTER COLUMN conditions SET NOT NULL")
    op.execute("ALTER TABLE automation_rules ALTER COLUMN actions SET DEFAULT '[]'::jsonb")
    op.execute("ALTER TABLE automation_rules ALTER COLUMN actions SET NOT NULL")

    op.create_index(
        "ix_automation_rules_tenant_event",
        "automation_rules",
        ["tenant_id", "trigger_event"],
        postgresql_where=sa.text("enabled = true"),
    )

    # ----------------------------------------------------------------
    # automation_rule_runs
    # ----------------------------------------------------------------
    op.create_table(
        "automation_rule_runs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("rule_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("automation_rules.id", ondelete="CASCADE"), nullable=False),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("trigger_event", sa.Text(), nullable=False),
        sa.Column("trigger_payload", postgresql.JSONB(), nullable=True),
        sa.Column("matched", sa.Boolean(), nullable=False),
        sa.Column("depth", sa.SmallInteger(), nullable=False, server_default="0"),
        sa.Column("idempotency_key", sa.Text(), nullable=True, unique=True),
        sa.Column("actions_result", postgresql.JSONB(), nullable=True),
        sa.Column("status", sa.Text(), nullable=False, server_default="pending"),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
    )
    # trigger_payload NOT NULL
    op.execute("ALTER TABLE automation_rule_runs ALTER COLUMN trigger_payload SET DEFAULT '{}'::jsonb")
    op.execute("ALTER TABLE automation_rule_runs ALTER COLUMN trigger_payload SET NOT NULL")

    op.create_index(
        "ix_automation_rule_runs_rule_created",
        "automation_rule_runs",
        ["rule_id", sa.text("created_at DESC")],
    )
    op.create_index(
        "ix_automation_rule_runs_tenant_created",
        "automation_rule_runs",
        ["tenant_id", sa.text("created_at DESC")],
    )


def downgrade() -> None:
    op.drop_table("automation_rule_runs")
    op.drop_table("automation_rules")
