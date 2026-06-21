"""tickets.sla_escalation_approval_id — WF-4 SLA 에스컬레이션 결재 중복 방지

ADR-048 WF-4: ITSM SLA 임박 → GW 에스컬레이션 결재 자동생성.
이미 결재가 생성된 티켓에 대한 중복 호출 방지용 컬럼.
nullable — 결재 미생성 시 NULL 유지 (graceful fallback 포함).

Revision ID: 046_ticket_sla_escalation_approval
Revises: 045_tenant_sa_tenant_id
Create Date: 2026-06-21
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "046_sla_escalation_approval"
down_revision = "045_tenant_sa_tenant_id"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "tickets",
        sa.Column(
            "sla_escalation_approval_id",
            sa.Text,
            nullable=True,
            comment="WF-4: GW 에스컬레이션 결재 doc_id. NULL=미생성. 중복 방지용.",
        ),
    )


def downgrade() -> None:
    op.drop_column("tickets", "sla_escalation_approval_id")
