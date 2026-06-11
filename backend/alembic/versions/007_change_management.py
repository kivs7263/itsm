"""007_change_management — change_requests, cr_ci_links (Change Management)

Revision ID: 007_change_management
Revises: 006_cmdb
Create Date: 2026-06-11

설계 노트:
- ENUM 4종 (cr_change_type_enum, cr_status_enum, cr_risk_enum, cr_priority_enum)은
  sa.Enum() 호출 시 자동 생성 (create_type 기본 True).
- TIMESTAMPTZ 컬럼은 server_default=sa.func.now() 사용 (utcnow 금지).
- 모든 도메인 테이블은 tenant_id NOT NULL + (tenant_id, ...) 복합 인덱스.
- cr_ci_links junction: (change_request_id, ci_id) UNIQUE name="uq_cr_ci_links_cr_ci"
  — 무명 UNIQUE 금지, migration/모델 양쪽 이름 일치.
- gw_approval_doc_id 는 GW(그룹웨어) 결재 시스템 외부 참조 — FK 미설정(다른 DB).
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

# revision identifiers
revision = "007_change_management"
down_revision = "006_cmdb"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # change_requests
    # ------------------------------------------------------------------
    op.create_table(
        "change_requests",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "tenant_id",
            UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column(
            "change_type",
            sa.Enum(
                "normal",
                "emergency",
                "standard",
                name="cr_change_type_enum",
            ),
            nullable=False,
            server_default="normal",
        ),
        sa.Column(
            "status",
            sa.Enum(
                "draft",
                "pending_review",
                "pending_approval",
                "approved",
                "scheduled",
                "in_progress",
                "completed",
                "rejected",
                "cancelled",
                name="cr_status_enum",
            ),
            nullable=False,
            server_default="draft",
        ),
        sa.Column(
            "risk_level",
            sa.Enum(
                "low",
                "medium",
                "high",
                "critical",
                name="cr_risk_enum",
            ),
            nullable=False,
            server_default="medium",
        ),
        sa.Column(
            "priority",
            sa.Enum(
                "low",
                "medium",
                "high",
                "critical",
                name="cr_priority_enum",
            ),
            nullable=False,
            server_default="medium",
        ),
        sa.Column("planned_start", sa.DateTime(timezone=True), nullable=True),
        sa.Column("planned_end", sa.DateTime(timezone=True), nullable=True),
        sa.Column("actual_start", sa.DateTime(timezone=True), nullable=True),
        sa.Column("actual_end", sa.DateTime(timezone=True), nullable=True),
        sa.Column("rollback_plan", sa.Text, nullable=True),
        sa.Column("implementation_plan", sa.Text, nullable=True),
        sa.Column("test_plan", sa.Text, nullable=True),
        sa.Column(
            "requestor_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "implementor_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "reviewer_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "gw_approval_doc_id",
            UUID(as_uuid=True),
            nullable=True,
            comment="GW 결재 document ID (외부 시스템 참조, FK 없음)",
        ),
        sa.Column(
            "gw_approval_status",
            sa.String(50),
            nullable=False,
            server_default="not_submitted",
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
    )
    op.create_index(
        "ix_change_requests_tenant",
        "change_requests",
        ["tenant_id"],
    )
    op.create_index(
        "ix_change_requests_tenant_status",
        "change_requests",
        ["tenant_id", "status"],
    )
    op.create_index(
        "ix_change_requests_tenant_type",
        "change_requests",
        ["tenant_id", "change_type"],
    )
    op.create_index(
        "ix_change_requests_requestor",
        "change_requests",
        ["requestor_id"],
    )

    # ------------------------------------------------------------------
    # cr_ci_links (change_requests ↔ configuration_items junction)
    # ------------------------------------------------------------------
    op.create_table(
        "cr_ci_links",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "change_request_id",
            UUID(as_uuid=True),
            sa.ForeignKey("change_requests.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "ci_id",
            UUID(as_uuid=True),
            sa.ForeignKey("configuration_items.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "tenant_id",
            UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("notes", sa.Text, nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint(
            "change_request_id",
            "ci_id",
            name="uq_cr_ci_links_cr_ci",
        ),
    )
    op.create_index(
        "ix_cr_ci_links_cr",
        "cr_ci_links",
        ["change_request_id"],
    )
    op.create_index(
        "ix_cr_ci_links_ci",
        "cr_ci_links",
        ["ci_id"],
    )


def downgrade() -> None:
    # cr_ci_links
    op.drop_index("ix_cr_ci_links_ci", table_name="cr_ci_links")
    op.drop_index("ix_cr_ci_links_cr", table_name="cr_ci_links")
    op.drop_table("cr_ci_links")

    # change_requests
    op.drop_index("ix_change_requests_requestor", table_name="change_requests")
    op.drop_index("ix_change_requests_tenant_type", table_name="change_requests")
    op.drop_index("ix_change_requests_tenant_status", table_name="change_requests")
    op.drop_index("ix_change_requests_tenant", table_name="change_requests")
    op.drop_table("change_requests")

    # ENUM 정리 (테이블 모두 drop 후) — 각 op.execute()는 별도 호출
    # (asyncpg 다중 statement DDL 불가 회피)
    sa.Enum(name="cr_priority_enum").drop(op.get_bind(), checkfirst=True)
    sa.Enum(name="cr_risk_enum").drop(op.get_bind(), checkfirst=True)
    sa.Enum(name="cr_status_enum").drop(op.get_bind(), checkfirst=True)
    sa.Enum(name="cr_change_type_enum").drop(op.get_bind(), checkfirst=True)
