"""cmdb_import_runs — CMDB Discovery Import 실행 이력 테이블 (CA-P2-5).

Revision ID: 054
Revises: 053
Create Date: 2026-06-30

Notes:
- source/target/status: String(50) + CHECK (ENUM CREATE TYPE 트랩 회피 — 051/052/053 동일 원칙).
- errors: JSONB NOT NULL default '[]'::jsonb (2단계 ALTER TABLE 패턴 — JSONB server_default).
- 복합 인덱스 (tenant_id, created_at DESC): 인덱스명·정렬이 모델 __table_args__와 정확히 일치.
- bulk_insert 미사용 (f-string JSON 바인드 오인 트랩 회피).
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "054"
down_revision = "053"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "cmdb_import_runs",
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
        # 'csv' | 'json_api'
        sa.Column("source", sa.String(50), nullable=False),
        # 'ci' | 'asset'
        sa.Column("target", sa.String(50), nullable=False),
        # 'completed' | 'partial' | 'failed'
        sa.Column(
            "status",
            sa.String(50),
            nullable=False,
            server_default="completed",
        ),
        sa.Column(
            "total_rows",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
        sa.Column(
            "created_count",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
        sa.Column(
            "updated_count",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
        sa.Column(
            "skipped_count",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
        sa.Column(
            "error_count",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
        sa.Column(
            "errors",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column("dedup_key", sa.String(50), nullable=True),
        sa.Column(
            "created_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        # CHECK 제약 — String + CHECK 패턴
        sa.CheckConstraint(
            "source IN ('csv', 'json_api')",
            name="ck_cmdb_import_runs_source",
        ),
        sa.CheckConstraint(
            "target IN ('ci', 'asset')",
            name="ck_cmdb_import_runs_target",
        ),
        sa.CheckConstraint(
            "status IN ('completed', 'partial', 'failed')",
            name="ck_cmdb_import_runs_status",
        ),
    )

    # 복합 인덱스 (tenant_id, created_at DESC) — 모델 Index명 정확히 일치
    op.create_index(
        "ix_cmdb_import_runs_tenant_created",
        "cmdb_import_runs",
        ["tenant_id", sa.text("created_at DESC")],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_cmdb_import_runs_tenant_created",
        table_name="cmdb_import_runs",
    )
    op.drop_table("cmdb_import_runs")
