"""티켓 구조 보강: source, request_type, parent_ticket_id, ticket_number 추가.

Revision ID: 013_ticket_structure
Revises: 012_customer_notes
Create Date: 2026-06-14

설계 노트:
- source: 발견 주체 (channel=입력경로와 별개)
- request_type: 워크플로우 분기 핵심 (incident/service_request/installation 등)
- parent_ticket_id: 서브티켓 지원, ON DELETE SET NULL
- ticket_number: TKT-YYYYMMDD-NNNN 형식, tenant별 daily unique
  기존 rows는 NULL로 시작 → P4-4c에서 백필
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "013_ticket_structure"
down_revision = "012_customer_notes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("tickets", sa.Column("source", sa.String(30), nullable=True))
    op.add_column("tickets", sa.Column("request_type", sa.String(30), nullable=True))
    op.add_column(
        "tickets",
        sa.Column(
            "parent_ticket_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tickets.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column("tickets", sa.Column("ticket_number", sa.String(25), nullable=True))

    # 부분 unique index: ticket_number NOT NULL 행에만 적용
    op.execute(
        "CREATE UNIQUE INDEX ix_tickets_tenant_number "
        "ON tickets(tenant_id, ticket_number) WHERE ticket_number IS NOT NULL"
    )
    op.execute(
        "CREATE INDEX ix_tickets_tenant_parent "
        "ON tickets(tenant_id, parent_ticket_id) WHERE parent_ticket_id IS NOT NULL"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_tickets_tenant_parent")
    op.execute("DROP INDEX IF EXISTS ix_tickets_tenant_number")
    op.drop_column("tickets", "ticket_number")
    op.drop_column("tickets", "parent_ticket_id")
    op.drop_column("tickets", "request_type")
    op.drop_column("tickets", "source")
