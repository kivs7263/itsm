"""반복 장애 감지: tickets 플래그 컬럼 2개 + recurring_alerts 테이블 신규 생성.

Revision ID: 018_recurring_alerts
Revises: 017_reply_templates
Create Date: 2026-06-14

설계 노트:
- tickets.is_recurring_flag (BOOLEAN, NOT NULL, default FALSE): 반복 장애로 분류된 티켓 표시 플래그.
  add_column에 server_default=false 필수 — NOT NULL 컬럼 추가 시 기존 행 backfill 자동 수행
  (DB 전문가 ★★ 핵심 체크: backfill 먼저 → NOT NULL 순서 위반 방지).
- tickets.recurring_detected_at (TIMESTAMPTZ, nullable): 반복 감지 시각. NULL = 미감지.
- recurring_alerts: 반복 패턴이 감지된 알림 레코드.
  - tenant_id FK + ix_recurring_alerts_tenant 인덱스로 멀티테넌트 격리 (★★).
  - customer_id / symptom_category_id ON DELETE SET NULL: 마스터 삭제 시 알림 이력 보존.
  - trigger_ticket_ids (UUID[]): 반복 패턴 트리거가 된 티켓 ID 목록.
    postgresql.ARRAY(UUID) 사용 — asyncpg가 native UUID[] 매핑 지원.
  - occurrence_count: 감지된 동일 패턴 발생 횟수.
  - acknowledged_by / acknowledged_at: 담당자 확인 흐름. is_acknowledged 플래그로 빠른 필터.
- 인덱스 ix_recurring_alerts_tenant: (tenant_id, detected_at DESC) — 테넌트별 최신순 조회.
  DESC 인덱스는 Index("name", text("col DESC"))로 모델 동기화 필요 — autogenerate 삭제 감지 방지 (★★).
- 운영 영향: tickets 컬럼 추가는 short ACCESS EXCLUSIVE 잠금 발생. 컬럼 추가 자체는 PG11+ 메타데이터만 변경(O(1))
  되어 짧지만, server_default 있는 NOT NULL 컬럼은 PG11+에서도 rewrite 회피됨.
- downgrade: DROP INDEX → DROP TABLE recurring_alerts → DROP COLUMN tickets.recurring_detected_at, is_recurring_flag.
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "018_recurring_alerts"
down_revision = "017_reply_templates"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # tickets 컬럼 추가
    op.add_column(
        "tickets",
        sa.Column(
            "is_recurring_flag",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.add_column(
        "tickets",
        sa.Column(
            "recurring_detected_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )

    # recurring_alerts 신규 테이블
    op.create_table(
        "recurring_alerts",
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
            "customer_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("customers.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "symptom_category_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("symptom_categories.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "trigger_ticket_ids",
            postgresql.ARRAY(postgresql.UUID(as_uuid=True)),
            nullable=False,
        ),
        sa.Column("occurrence_count", sa.Integer(), nullable=False),
        sa.Column(
            "detected_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "acknowledged_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "acknowledged_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
        sa.Column(
            "is_acknowledged",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )

    op.create_index(
        "ix_recurring_alerts_tenant",
        "recurring_alerts",
        ["tenant_id", sa.text("detected_at DESC")],
    )


def downgrade() -> None:
    op.drop_index("ix_recurring_alerts_tenant", table_name="recurring_alerts")
    op.drop_table("recurring_alerts")
    op.drop_column("tickets", "recurring_detected_at")
    op.drop_column("tickets", "is_recurring_flag")
