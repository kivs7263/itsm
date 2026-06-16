"""tickets 테이블에 에스컬레이션 추적 컬럼 추가.

Revision ID: 026_tickets_escalation_columns
Revises: 025_escalation_tables
Create Date: 2026-06-16

설계 노트:
- escalation_level: 현재 대응 레벨 (1=1차/2=2차/3=3차). ticket_escalations 집계 없이
  직접 조회 가능하도록 비정규화. 에스컬레이션 시 서비스 레이어에서 동기 업데이트.
- escalation_count: 총 이관 횟수. 반복 이관 패턴 감지 + 통계용.
- last_escalated_at: 가장 최근 이관 시각. 대시보드 정렬/필터용.
- sla_breach_notified_at: SLA 위반 알림 중복 발송 방지. 한 번 발송 후 NULL이 아니면
  SLA 워커가 재발송하지 않음.
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "026_tickets_escalation_columns"
down_revision = "025_escalation_tables"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "tickets",
        sa.Column("escalation_level", sa.SmallInteger, nullable=False, server_default="1"),
    )
    op.add_column(
        "tickets",
        sa.Column("escalation_count", sa.SmallInteger, nullable=False, server_default="0"),
    )
    op.add_column(
        "tickets",
        sa.Column("last_escalated_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "tickets",
        sa.Column("sla_breach_notified_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("tickets", "sla_breach_notified_at")
    op.drop_column("tickets", "last_escalated_at")
    op.drop_column("tickets", "escalation_count")
    op.drop_column("tickets", "escalation_level")
