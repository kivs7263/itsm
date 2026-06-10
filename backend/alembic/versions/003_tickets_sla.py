"""003_tickets_sla — tickets, ticket_comments, ticket_attachments, sla_policies, sla_events, portal_sessions

Revision ID: 003_tickets_sla
Revises: 002_itsm_core
Create Date: 2026-06-10
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision = "003_tickets_sla"
down_revision = "002_itsm_core"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # tickets
    # ------------------------------------------------------------------
    op.create_table(
        "tickets",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "tenant_id",
            UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "customer_id",
            UUID(as_uuid=True),
            sa.ForeignKey("customers.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "contract_id",
            UUID(as_uuid=True),
            sa.ForeignKey("contracts.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "assigned_to",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column(
            "priority",
            sa.Enum(
                "low", "medium", "high", "critical",
                name="ticket_priority_enum",
            ),
            nullable=False,
            server_default="medium",
        ),
        sa.Column(
            "status",
            sa.Enum(
                "open", "in_progress", "pending", "resolved", "closed",
                name="ticket_status_enum",
            ),
            nullable=False,
            server_default="open",
        ),
        sa.Column(
            "channel",
            sa.Enum(
                "email", "phone", "portal", "internal",
                name="ticket_channel_enum",
            ),
            nullable=False,
            server_default="internal",
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_tickets_tenant_status", "tickets", ["tenant_id", "status"])
    op.create_index("ix_tickets_tenant_customer", "tickets", ["tenant_id", "customer_id"])
    op.create_index("ix_tickets_tenant_assigned", "tickets", ["tenant_id", "assigned_to"])

    # ------------------------------------------------------------------
    # ticket_comments
    # ------------------------------------------------------------------
    op.create_table(
        "ticket_comments",
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
            sa.ForeignKey("tickets.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "author_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("body", sa.Text, nullable=False),
        sa.Column("is_internal", sa.Boolean, nullable=False, server_default="false"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        "ix_ticket_comments_tenant_ticket", "ticket_comments", ["tenant_id", "ticket_id"]
    )

    # ------------------------------------------------------------------
    # ticket_attachments
    # ------------------------------------------------------------------
    op.create_table(
        "ticket_attachments",
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
            sa.ForeignKey("tickets.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("filename", sa.String(500), nullable=False),
        sa.Column("minio_key", sa.String(1000), nullable=False),
        sa.Column("size_bytes", sa.BigInteger, nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )

    # ------------------------------------------------------------------
    # sla_policies
    # ------------------------------------------------------------------
    op.create_table(
        "sla_policies",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "tenant_id",
            UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "grade",
            sa.Enum(
                "bronze", "silver", "gold", "platinum",
                name="sla_grade_enum",
            ),
            nullable=False,
        ),
        sa.Column("response_minutes", sa.Integer, nullable=False),
        sa.Column("resolution_minutes", sa.Integer, nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_unique_constraint(
        "uq_sla_policies_tenant_grade", "sla_policies", ["tenant_id", "grade"]
    )

    # ------------------------------------------------------------------
    # sla_events
    # ------------------------------------------------------------------
    op.create_table(
        "sla_events",
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
            sa.ForeignKey("tickets.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "event_type",
            sa.Enum(
                "breach_warning", "breached", "resolved",
                name="sla_event_type_enum",
            ),
            nullable=False,
        ),
        sa.Column(
            "fired_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("ix_sla_events_tenant_ticket", "sla_events", ["tenant_id", "ticket_id"])

    # ------------------------------------------------------------------
    # portal_sessions
    # ------------------------------------------------------------------
    op.create_table(
        "portal_sessions",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "tenant_id",
            UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "customer_id",
            UUID(as_uuid=True),
            sa.ForeignKey("customers.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("token_hash", sa.String(255), unique=True, nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        "ix_portal_sessions_tenant_customer",
        "portal_sessions",
        ["tenant_id", "customer_id"],
    )


def downgrade() -> None:
    # DROP 역순
    op.drop_index("ix_portal_sessions_tenant_customer", table_name="portal_sessions")
    op.drop_table("portal_sessions")

    op.drop_index("ix_sla_events_tenant_ticket", table_name="sla_events")
    op.drop_table("sla_events")

    op.drop_constraint("uq_sla_policies_tenant_grade", "sla_policies", type_="unique")
    op.drop_table("sla_policies")

    op.drop_table("ticket_attachments")

    op.drop_index("ix_ticket_comments_tenant_ticket", table_name="ticket_comments")
    op.drop_table("ticket_comments")

    op.drop_index("ix_tickets_tenant_assigned", table_name="tickets")
    op.drop_index("ix_tickets_tenant_customer", table_name="tickets")
    op.drop_index("ix_tickets_tenant_status", table_name="tickets")
    op.drop_table("tickets")

    # ENUM 타입 DROP (역순)
    op.execute("DROP TYPE IF EXISTS sla_event_type_enum")
    op.execute("DROP TYPE IF EXISTS sla_grade_enum")
    op.execute("DROP TYPE IF EXISTS ticket_channel_enum")
    op.execute("DROP TYPE IF EXISTS ticket_status_enum")
    op.execute("DROP TYPE IF EXISTS ticket_priority_enum")
