"""공수 추적: ticket_work_logs 테이블 신규 생성.

Revision ID: 010_work_logs
Revises: 009_notification_logs
Create Date: 2026-06-14

설계 노트:
- work_type_enum: op.create_table 내 sa.Enum에서 자동 생성 (csat 마이그레이션 패턴 동일).
  별도 .create() 호출 없음 — 이중 생성 방지.
- downgrade: 테이블 drop 후 ENUM drop (asyncpg 다중 statement DDL 불가로 별도 호출).
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "010_work_logs"
down_revision = "009_notification_logs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ticket_work_logs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "ticket_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tickets.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "work_type",
            sa.Enum(
                "remote", "onsite", "phone", "email", "internal",
                name="work_type_enum",
            ),
            nullable=False,
            server_default="remote",
        ),
        # NUMERIC(5,2): 최대 999.99h, 0.25 단위 (15분)
        sa.Column("hours", sa.Numeric(5, 2), nullable=False),
        sa.Column("billable", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("memo", sa.Text(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "logged_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )

    op.create_index(
        "ix_work_logs_tenant_ticket",
        "ticket_work_logs",
        ["tenant_id", "ticket_id"],
    )
    op.create_index(
        "ix_work_logs_tenant_user_logged",
        "ticket_work_logs",
        ["tenant_id", "user_id", "logged_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_work_logs_tenant_user_logged", table_name="ticket_work_logs")
    op.drop_index("ix_work_logs_tenant_ticket", table_name="ticket_work_logs")
    op.drop_table("ticket_work_logs")
    sa.Enum(name="work_type_enum").drop(op.get_bind(), checkfirst=True)
