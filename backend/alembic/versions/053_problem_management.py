"""problem_management — problems + problem_tickets 테이블 생성 (CA-P2-4).

Revision ID: 053
Revises: 052
Create Date: 2026-06-30

Notes:
- status: String(20) + CHECK constraint (async alembic enum CREATE TYPE 중복 트랩 회피).
  enum 대신 String+CHECK 패턴 — 051/052 동일 원칙.
- priority: 기존 ticket_priority_enum PG 타입 재사용 (create_type=False — DuplicateObject 방지).
- JSONB 컬럼 없음 → 2단계 ALTER TABLE 불필요.
- 인덱스 이름은 모델 __table_args__ Index 이름과 동일 (alembic autogenerate 드리프트 방지).
- 시드 없음.
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "053"
down_revision = "052"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── 1. problems 테이블 ────────────────────────────────────────────
    op.create_table(
        "problems",
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
        # PRB-YYYYMMDD-NNNN 형식, 생성 직후 UPDATE (ticket_number 동일 패턴)
        sa.Column("problem_number", sa.String(25), nullable=True),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        # status: String(20) + CHECK — enum CREATE TYPE 중복 트랩 회피
        sa.Column(
            "status",
            sa.String(20),
            nullable=False,
            server_default="new",
        ),
        # priority: 기존 ticket_priority_enum 재사용 (create_type=False)
        sa.Column(
            "priority",
            postgresql.ENUM(
                "low", "medium", "high", "critical",
                name="ticket_priority_enum",
                create_type=False,
            ),
            nullable=False,
            server_default="medium",
        ),
        sa.Column("root_cause", sa.Text(), nullable=True),
        sa.Column("workaround", sa.Text(), nullable=True),
        sa.Column(
            "is_known_error",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column(
            "source_recurring_alert_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("recurring_alerts.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "assigned_to",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
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
        # status 허용값 CHECK
        sa.CheckConstraint(
            "status IN ('new','investigating','known_error','resolved','closed')",
            name="ck_problems_status",
        ),
    )

    op.create_index(
        "ix_problems_tenant_status",
        "problems",
        ["tenant_id", "status"],
    )
    op.create_index(
        "ix_problems_tenant_known_error",
        "problems",
        ["tenant_id", "is_known_error"],
    )

    # ── 2. problem_tickets 테이블 (M:N 인시던트 링크) ────────────────
    op.create_table(
        "problem_tickets",
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
            "problem_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("problems.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "ticket_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tickets.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "linked_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint(
            "problem_id", "ticket_id",
            name="uq_problem_tickets_problem_ticket",
        ),
    )

    op.create_index(
        "ix_problem_tickets_tenant_ticket",
        "problem_tickets",
        ["tenant_id", "ticket_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_problem_tickets_tenant_ticket", table_name="problem_tickets")
    op.drop_table("problem_tickets")
    op.drop_index("ix_problems_tenant_known_error", table_name="problems")
    op.drop_index("ix_problems_tenant_status", table_name="problems")
    op.drop_table("problems")
