"""004_calendar_events — itsm_calendar_events 테이블 추가 (P2-2 calendar-service 연동)

Revision ID: 004_calendar_events
Revises: 003_tickets_sla
Create Date: 2026-06-10
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

# revision identifiers
revision = "004_calendar_events"
down_revision = "003_tickets_sla"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "itsm_calendar_events",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "tenant_id",
            UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "ticket_id",
            UUID(as_uuid=True),
            sa.ForeignKey("tickets.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("title", sa.String(300), nullable=False),
        sa.Column("event_type", sa.String(20), nullable=False, server_default="internal"),
        # visit=현장방문, remote=원격지원, internal=내부일정
        sa.Column("start_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("end_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_all_day", sa.Boolean, nullable=False, server_default="false"),
        sa.Column(
            "assignee_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("organization_id", UUID(as_uuid=True), nullable=True),
        sa.Column("cal_event_id", UUID(as_uuid=True), nullable=True),
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
    )

    # (tenant_id, start_at) 복합 인덱스 — 월별 조회 최적화
    op.create_index(
        "ix_itsm_cal_tenant_start",
        "itsm_calendar_events",
        ["tenant_id", "start_at"],
    )

    # (tenant_id, ticket_id) 복합 인덱스 — 티켓 연결 이벤트 조회
    op.create_index(
        "ix_itsm_cal_tenant_ticket",
        "itsm_calendar_events",
        ["tenant_id", "ticket_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_itsm_cal_tenant_ticket", table_name="itsm_calendar_events")
    op.drop_index("ix_itsm_cal_tenant_start", table_name="itsm_calendar_events")
    op.drop_table("itsm_calendar_events")
