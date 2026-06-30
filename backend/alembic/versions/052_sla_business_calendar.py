"""sla_business_calendar — 테넌트별 업무시간 캘린더 (CA-P1-6).

Revision ID: 052
Revises: 051
Create Date: 2026-06-30

Notes:
- 기존 enum 변경 없음 — create_type 불필요.
- JSONB NOT NULL 컬럼(business_hours_json, holidays_json): nullable 생성 후 ALTER TABLE
  2단계로 NOT NULL 적용 (asyncpg CREATE TABLE 인라인 JSONB server_default 렌더링 버그
  회피 — migration 051 동일 패턴).
- timezone 컬럼은 String — 인라인 server_default 안전(JSONB 버그 해당 없음).
- 시드 없음: 기존 테넌트는 캘린더 미설정 = 벽시계 유지 (하위호환 보장).
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "052"
down_revision = "051"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ----------------------------------------------------------------
    # 1. sla_business_calendar 테이블 생성
    #    business_hours_json, holidays_json: nullable=True → 2단계 NOT NULL
    # ----------------------------------------------------------------
    op.create_table(
        "sla_business_calendar",
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
        # JSONB NOT NULL: nullable로 먼저 생성 → 아래 ALTER TABLE로 NOT NULL
        sa.Column("business_hours_json", postgresql.JSONB(), nullable=True),
        sa.Column(
            "timezone",
            sa.String(64),
            nullable=False,
            server_default="Asia/Seoul",
        ),
        # JSONB NOT NULL default '[]': nullable로 먼저 생성 → 아래 ALTER TABLE
        sa.Column("holidays_json", postgresql.JSONB(), nullable=True),
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
        # 테넌트당 캘린더 1개 UNIQUE
        sa.UniqueConstraint("tenant_id", name="uq_sla_business_calendar_tenant"),
    )

    # ----------------------------------------------------------------
    # 2. JSONB NOT NULL 2단계 적용
    # ----------------------------------------------------------------
    # business_hours_json: default 없음 — SET NOT NULL만
    op.execute(
        "ALTER TABLE sla_business_calendar "
        "ALTER COLUMN business_hours_json SET NOT NULL"
    )

    # holidays_json: default '[]' 먼저, 그 다음 NOT NULL
    op.execute(
        "ALTER TABLE sla_business_calendar "
        "ALTER COLUMN holidays_json SET DEFAULT '[]'::jsonb"
    )
    op.execute(
        "ALTER TABLE sla_business_calendar "
        "ALTER COLUMN holidays_json SET NOT NULL"
    )


def downgrade() -> None:
    op.drop_table("sla_business_calendar")
