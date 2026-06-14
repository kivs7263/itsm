"""알려진 이슈: kb_articles 확장 컬럼 4개 + ticket_known_issues M2M 테이블 신규 생성.

Revision ID: 019_known_issues
Revises: 018_recurring_alerts
Create Date: 2026-06-14

설계 노트:
- kb_articles 확장 컬럼:
  - is_known_issue (BOOLEAN, NOT NULL, default FALSE): KB 문서를 "알려진 이슈"로 마킹.
    NOT NULL + server_default false → 기존 행 자동 backfill (★★ 핵심 체크 준수).
  - ki_severity (VARCHAR(20), nullable): 'critical' | 'high' | 'medium' | 'low' 등 애플리케이션 레벨 검증.
    ENUM 타입 미사용 이유: 등급 변경 시 ALTER TYPE 트랜잭션 제약 회피 (016_installation_workflow 동일 결정).
  - ki_symptom_category_id (UUID, nullable, FK symptom_categories ON DELETE SET NULL):
    알려진 이슈와 증상 카테고리 연결. 카테고리 삭제 시 KI 본문 보존.
  - ki_status (VARCHAR(20), nullable, default 'open'): 'open' | 'investigating' | 'workaround' | 'resolved' 등.
    nullable=True 유지 — 비 KI 문서(is_known_issue=false)는 NULL이어도 무방.
    DDL 명세상 NOT NULL 미요구 → DEFAULT 'open'만 적용.
- ticket_known_issues (M2M):
  - 복합 PK (ticket_id, article_id) — 중복 연결 방지 + 룩업 인덱스 자동 제공.
  - 양측 ON DELETE CASCADE: 티켓 또는 KB 문서 삭제 시 연결 자동 정리.
  - linked_by ON DELETE SET NULL: 연결자(사용자) 삭제 시 링크 이력 보존.
  - linked_at: 연결 시각 추적.
  - 별도 tenant_id 미보유 — 양측 FK 테이블이 각각 tenant_id 보유, 서비스 레이어 JOIN 시 격리 보장.
- 운영 영향: kb_articles 컬럼 4개 add는 PG11+ 메타데이터 변경(rewrite 없음), short ACCESS EXCLUSIVE 잠금.
- downgrade: DROP TABLE ticket_known_issues → DROP COLUMN kb_articles 4개 (ki_status → ki_symptom_category_id
  → ki_severity → is_known_issue 역순).
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "019_known_issues"
down_revision = "018_recurring_alerts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # kb_articles 컬럼 4개 추가
    op.add_column(
        "kb_articles",
        sa.Column(
            "is_known_issue",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.add_column(
        "kb_articles",
        sa.Column("ki_severity", sa.String(20), nullable=True),
    )
    op.add_column(
        "kb_articles",
        sa.Column(
            "ki_symptom_category_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("symptom_categories.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column(
        "kb_articles",
        sa.Column(
            "ki_status",
            sa.String(20),
            nullable=True,
            server_default=sa.text("'open'"),
        ),
    )

    # ticket_known_issues M2M 테이블
    op.create_table(
        "ticket_known_issues",
        sa.Column(
            "ticket_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tickets.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "article_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("kb_articles.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "linked_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "linked_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.PrimaryKeyConstraint("ticket_id", "article_id"),
    )


def downgrade() -> None:
    op.drop_table("ticket_known_issues")
    op.drop_column("kb_articles", "ki_status")
    op.drop_column("kb_articles", "ki_symptom_category_id")
    op.drop_column("kb_articles", "ki_severity")
    op.drop_column("kb_articles", "is_known_issue")
