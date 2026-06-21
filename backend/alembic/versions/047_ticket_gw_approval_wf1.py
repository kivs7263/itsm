"""tickets.gw_approval_doc_id / gw_approval_status — WF-1 ITSM→GW 결재 자동생성

ADR-048 WF-1: 특정 request_type 티켓(license_request / budget_request /
access_request) 생성 시 GW 결재를 자동 기안하고, 승인 시 티켓 자동 클로즈.

sla_escalation_approval_id(WF-4)와 별개 컬럼.

Revision ID: 047_ticket_gw_approval_wf1
Revises: 046_sla_escalation_approval
Create Date: 2026-06-21
"""
import sqlalchemy as sa
from alembic import op

revision = "047_ticket_gw_approval_wf1"
down_revision = "046_sla_escalation_approval"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "tickets",
        sa.Column(
            "gw_approval_doc_id",
            sa.String(128),
            nullable=True,
            comment="WF-1: GW 결재 doc_id (license/budget/access_request). NULL=미생성.",
        ),
    )
    op.add_column(
        "tickets",
        sa.Column(
            "gw_approval_status",
            sa.String(30),
            nullable=True,
            comment="WF-1: GW 결재 상태 (pending/approved/rejected/gw_not_configured). NULL=비대상.",
        ),
    )
    op.create_index(
        "ix_tickets_gw_approval_doc_id",
        "tickets",
        ["gw_approval_doc_id"],
        unique=False,
        postgresql_where=sa.text("gw_approval_doc_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_tickets_gw_approval_doc_id", table_name="tickets")
    op.drop_column("tickets", "gw_approval_status")
    op.drop_column("tickets", "gw_approval_doc_id")
