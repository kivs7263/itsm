"""에스컬레이션 지원팀 + 이력 테이블 신규 생성.

Revision ID: 025_escalation_tables
Revises: 024_work_log_description
Create Date: 2026-06-16

설계 노트:
- support_teams: level(1=1차/2=2차/3=3차) — 인계 대상 팀 마스터.
- support_team_members: 팀-유저 M:N 매핑. 팀 삭제 시 CASCADE.
- escalation_reason_enum: ticket_escalations 테이블 생성 시 sa.Enum이 자동 생성.
- ticket_escalations: 이력 전체 보존 (이관 건별 행 추가, 수정 없음).
  - to_team_id 필수 + to_assigned 선택 → 팀 인계 후 담당자 내부 배정 허용.
  - handover_memo NOT NULL → 맥락 없는 인계 방지.
  - customer_summary nullable → 고객 공개용 요약 (내부 메모와 분리).
  - triggered_by NULL = 자동 에스컬레이션 (SLA 워커), NOT NULL = 수동.
  - acknowledged_at: 2차 담당자가 인계를 인지한 시각.
- 인덱스: tenant_id 선두 컬럼 — 멀티테넌트 격리 (★★ 핵심).
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision = "025_escalation_tables"
down_revision = "024_work_log_description"
branch_labels = None
depends_on = None

_escalation_reason_enum = sa.Enum(
    "technical_complexity",
    "permission_lack",
    "sla_breach",
    "sla_warning",
    "customer_request",
    "manual",
    "other",
    name="escalation_reason_enum",
)


def upgrade() -> None:
    # ── support_teams ─────────────────────────────────────────────────────────
    op.create_table(
        "support_teams",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "tenant_id",
            UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("level", sa.SmallInteger, nullable=False, server_default="2"),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default="true"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index("ix_support_teams_tenant", "support_teams", ["tenant_id", "level"])

    # ── support_team_members ──────────────────────────────────────────────────
    op.create_table(
        "support_team_members",
        sa.Column(
            "team_id",
            UUID(as_uuid=True),
            sa.ForeignKey("support_teams.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("team_id", "user_id"),
    )

    # ── ticket_escalations (enum auto-created by sa.Enum) ────────────────────
    op.create_table(
        "ticket_escalations",
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
        sa.Column("from_level", sa.SmallInteger, nullable=False, server_default="1"),
        sa.Column("to_level", sa.SmallInteger, nullable=False, server_default="2"),
        sa.Column(
            "from_assigned",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "to_team_id",
            UUID(as_uuid=True),
            sa.ForeignKey("support_teams.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "to_assigned",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("reason", _escalation_reason_enum, nullable=False),
        sa.Column("handover_memo", sa.Text, nullable=False),
        sa.Column("customer_summary", sa.Text, nullable=True),
        sa.Column(
            "triggered_by",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("acknowledged_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index(
        "ix_ticket_escalations_ticket",
        "ticket_escalations",
        ["tenant_id", "ticket_id"],
    )
    op.create_index(
        "ix_ticket_escalations_team",
        "ticket_escalations",
        ["to_team_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_ticket_escalations_team", table_name="ticket_escalations")
    op.drop_index("ix_ticket_escalations_ticket", table_name="ticket_escalations")
    op.drop_table("ticket_escalations")
    op.drop_table("support_team_members")
    op.drop_index("ix_support_teams_tenant", table_name="support_teams")
    op.drop_table("support_teams")
    _escalation_reason_enum.drop(op.get_bind(), checkfirst=True)
