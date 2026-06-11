"""008_csat — csat_surveys (고객 포털 CSAT 설문)

Revision ID: 008_csat
Revises: 007_change_management
Create Date: 2026-06-11

설계 노트:
- ENUM(csat_status_enum)은 sa.Enum() 호출 시 자동 생성 (create_type 기본 True).
- TIMESTAMPTZ 컬럼은 server_default=sa.func.now() 사용 (utcnow 금지).
- expires_at 은 application 레이어에서 sent_at + 7일 계산 후 삽입 (DB default 없음).
- UNIQUE 제약은 모두 name= 명시 (무명 UNIQUE 금지 — alembic check drift 방지).
- 티켓당 설문 1개 제한: ticket_id UNIQUE.
- survey_token: 외부 매직링크용 토큰 (URL 안전 64자), 전역 UNIQUE.
- downgrade: 테이블 drop 후 ENUM drop. 각 op.execute()/Enum.drop() 별도 호출
  (asyncpg 다중 statement DDL 불가 회피).
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

# revision identifiers
revision = "008_csat"
down_revision = "007_change_management"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # csat_surveys
    # ------------------------------------------------------------------
    op.create_table(
        "csat_surveys",
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
        sa.Column(
            "ticket_id",
            UUID(as_uuid=True),
            sa.ForeignKey("tickets.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "customer_id",
            UUID(as_uuid=True),
            sa.ForeignKey("customers.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("survey_token", sa.String(64), nullable=False),
        sa.Column(
            "score",
            sa.SmallInteger,
            nullable=True,
            comment="제출 후에만 값 존재 (1-5)",
        ),
        sa.Column("comment", sa.Text, nullable=True),
        sa.Column(
            "status",
            sa.Enum(
                "pending",
                "submitted",
                "expired",
                name="csat_status_enum",
            ),
            nullable=False,
            server_default="pending",
        ),
        sa.Column(
            "sent_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "submitted_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
        sa.Column(
            "expires_at",
            sa.DateTime(timezone=True),
            nullable=False,
            comment="application 에서 sent_at + 7일 계산 후 삽입",
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint(
            "survey_token",
            name="uq_csat_surveys_token",
        ),
        sa.UniqueConstraint(
            "ticket_id",
            name="uq_csat_surveys_ticket",
        ),
    )
    op.create_index(
        "ix_csat_surveys_tenant",
        "csat_surveys",
        ["tenant_id"],
    )
    op.create_index(
        "ix_csat_surveys_tenant_status",
        "csat_surveys",
        ["tenant_id", "status"],
    )


def downgrade() -> None:
    op.drop_index("ix_csat_surveys_tenant_status", table_name="csat_surveys")
    op.drop_index("ix_csat_surveys_tenant", table_name="csat_surveys")
    op.drop_table("csat_surveys")

    # ENUM 정리 (테이블 drop 후) — 별도 호출 (asyncpg 다중 statement DDL 불가)
    sa.Enum(name="csat_status_enum").drop(op.get_bind(), checkfirst=True)
