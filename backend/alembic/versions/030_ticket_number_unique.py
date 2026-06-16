"""030 ticket_number unique constraint per tenant

Revision ID: 030
Revises: 029
Create Date: 2026-06-16
"""
from alembic import op

revision = "030_ticket_number_unique"
down_revision = "029_portal_sessions_ticket_link"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 기존 중복 ticket_number 정리 (NULL 또는 중복값은 NULL로 초기화)
    op.execute("""
        WITH dupes AS (
            SELECT id,
                   ROW_NUMBER() OVER (PARTITION BY tenant_id, ticket_number ORDER BY created_at) AS rn
            FROM tickets
            WHERE ticket_number IS NOT NULL
        )
        UPDATE tickets SET ticket_number = NULL
        FROM dupes
        WHERE tickets.id = dupes.id AND dupes.rn > 1
    """)

    op.create_unique_constraint(
        "uq_tickets_tenant_ticket_number",
        "tickets",
        ["tenant_id", "ticket_number"],
    )


def downgrade() -> None:
    op.drop_constraint("uq_tickets_tenant_ticket_number", "tickets", type_="unique")
