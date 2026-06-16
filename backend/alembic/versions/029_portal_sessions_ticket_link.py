"""portal_sessions에 ticket_id, purpose 컬럼 추가 (ESC-4 매직링크).

Revision ID: 029_portal_sessions_ticket_link
Revises: 028_notification_config_smtp
Create Date: 2026-06-16

설계 노트:
- ticket_id: nullable FK (ondelete CASCADE) — 매직링크용 세션만 채움, 기존 세션 NULL 유지
- purpose: varchar(30) default 'magic_link' — 향후 다른 포털 용도와 구분
- used_at: 1회용 옵션 지원 (None = 미사용 / 값 있으면 사용됨)
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision = "029_portal_sessions_ticket_link"
down_revision = "028_notification_config_smtp"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # portal_sessions — ticket_id + purpose + used_at
    op.add_column(
        "portal_sessions",
        sa.Column(
            "ticket_id",
            UUID(as_uuid=True),
            sa.ForeignKey("tickets.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    op.add_column(
        "portal_sessions",
        sa.Column("purpose", sa.String(30), nullable=False, server_default="magic_link"),
    )
    op.add_column(
        "portal_sessions",
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_portal_sessions_ticket",
        "portal_sessions",
        ["ticket_id"],
        postgresql_where=sa.text("ticket_id IS NOT NULL"),
    )

    # ticket_comments — author_id nullable (고객 포털 코멘트는 시스템 user 없음)
    # + source 컬럼으로 출처 구분 (null=내부, 'customer_portal'=고객 발신)
    op.alter_column("ticket_comments", "author_id", nullable=True)
    op.add_column(
        "ticket_comments",
        sa.Column("source", sa.String(30), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("ticket_comments", "source")
    op.alter_column("ticket_comments", "author_id", nullable=False)
    op.drop_index("ix_portal_sessions_ticket", table_name="portal_sessions")
    op.drop_column("portal_sessions", "used_at")
    op.drop_column("portal_sessions", "purpose")
    op.drop_column("portal_sessions", "ticket_id")
