"""sidebar_pins — 사용자별 사이드바 즐겨찾기(pin) 저장 (ITSM-SIDEBAR-P1).

pinned_keys JSONB = ["tickets", "kb", ...] (NavItem.key — 사이드바 안정 key, href 아님).
(tenant_id, user_id) UNIQUE — 사용자당 1행.
SA Workspace migration 187_sidebar_pins.py 그대로 미러링 (2단계 ALTER — async 함정 회피).

Revision ID: 063
Revises: 062
Create Date: 2026-07-05
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "063"
down_revision = "062"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "sidebar_pins",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        # JSONB NOT NULL DEFAULT는 nullable 생성 후 2단계 ALTER (async 함정 회피 — 053/187 동일 패턴)
        sa.Column("pinned_keys", postgresql.JSONB(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint("tenant_id", "user_id", name="uq_sidebar_pins_user"),
    )
    op.execute("ALTER TABLE sidebar_pins ALTER COLUMN pinned_keys SET DEFAULT '[]'::jsonb")
    op.execute("ALTER TABLE sidebar_pins ALTER COLUMN pinned_keys SET NOT NULL")
    op.create_index(
        "ix_sidebar_pins_tenant_user", "sidebar_pins", ["tenant_id", "user_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_sidebar_pins_tenant_user", table_name="sidebar_pins")
    op.drop_table("sidebar_pins")
