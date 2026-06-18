"""ticket_activities 테이블 — 티켓 모든 이벤트 감사 로그

Revision ID: 042_ticket_activities
Revises: 041_tickets_symptom_category
Create Date: 2026-06-18
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "042_ticket_activities"
down_revision = "041_tickets_symptom_category"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ticket_activities",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("ticket_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("tickets.id", ondelete="CASCADE"), nullable=False),
        sa.Column("actor_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        # event_type: created | status_changed | assigned | priority_changed |
        #             comment_added | work_log_added | escalated |
        #             sla_response_breached | sla_resolution_breached |
        #             resolved | closed | reopened | kb_draft_created
        sa.Column("event_type", sa.String(50), nullable=False),
        sa.Column("from_value", sa.Text, nullable=True),
        sa.Column("to_value",   sa.Text, nullable=True),
        sa.Column("meta",       postgresql.JSONB, nullable=True),  # 추가 맥락
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False,
                  server_default=sa.text("NOW()")),
    )
    op.create_index("ix_ticket_activities_ticket",
                    "ticket_activities", ["ticket_id", "created_at"])
    op.create_index("ix_ticket_activities_tenant",
                    "ticket_activities", ["tenant_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_ticket_activities_tenant", "ticket_activities")
    op.drop_index("ix_ticket_activities_ticket", "ticket_activities")
    op.drop_table("ticket_activities")
