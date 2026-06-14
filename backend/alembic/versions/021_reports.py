"""보고서 테이블 신규 생성: reports.

Revision ID: 021_reports
Revises: 020_kb_embedding
Create Date: 2026-06-14

설계 노트:
- tenant_id FK + 모든 인덱스에 tenant_id 선두 컬럼 포함 → 멀티테넌트 격리(★★ 핵심 체크).
- report_type / status: VARCHAR(20) + 서비스 레이어 검증. ENUM 미사용 이유는 016_installation_workflow,
  019_known_issues 결정과 동일 — 등급/상태 추가 시 ALTER TYPE 트랜잭션 제약 회피, asyncpg 캐시 이슈 회피.
- summary_data JSONB: server_default 는 반드시 sa.text("'{}'::jsonb") 패턴. asyncpg 가 텍스트 캐스팅
  없이 '{}' 를 전달 받으면 InvalidTextRepresentationError 발생(database.md patterns 기록).
- submitted_by / reviewed_by ON DELETE SET NULL: 사용자 삭제 시 보고서 이력 보존 (감사 추적).
- 인덱스:
  * ix_reports_tenant_status: 테넌트별 상태 필터(목록 화면 — draft/submitted/reviewed).
  * ix_reports_tenant_period: 테넌트별 기간 조회(월별·분기별 리포트 검색). period_start, period_end 복합 — 범위 스캔 효율.
- 단일 컬럼 인덱스는 index=True 가 아닌 op.create_index 로 일괄 처리 (DuplicateObject 방지).
- created_at / updated_at: TIMESTAMPTZ — DateTime(timezone=True). UTC 보장.
- downgrade: 인덱스 → 테이블 역순.
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "021_reports"
down_revision = "020_kb_embedding"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "reports",
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
        sa.Column("report_type", sa.String(20), nullable=False),
        sa.Column("period_start", sa.Date(), nullable=False),
        sa.Column("period_end", sa.Date(), nullable=False),
        sa.Column("title", sa.String(300), nullable=False),
        sa.Column(
            "summary_data",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column(
            "status",
            sa.String(20),
            nullable=False,
            server_default=sa.text("'draft'"),
        ),
        sa.Column(
            "submitted_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "reviewed_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("review_comment", sa.Text(), nullable=True),
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
    )

    op.create_index(
        "ix_reports_tenant_status",
        "reports",
        ["tenant_id", "status"],
    )
    op.create_index(
        "ix_reports_tenant_period",
        "reports",
        ["tenant_id", "period_start", "period_end"],
    )


def downgrade() -> None:
    op.drop_index("ix_reports_tenant_period", table_name="reports")
    op.drop_index("ix_reports_tenant_status", table_name="reports")
    op.drop_table("reports")
