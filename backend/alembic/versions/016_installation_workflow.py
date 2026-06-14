"""설치 4단계 워크플로우: tickets.installation_step / installation_history.

Revision ID: 016_installation_workflow
Revises: 015_user_role_extend
Create Date: 2026-06-14

설계 노트:
- installation_step (VARCHAR 30, nullable): NULL이면 비설치 티켓.
  허용값(애플리케이션 레벨 검증): 'survey' | 'executing' | 'verification' | 'acceptance'
  ENUM 타입을 쓰지 않은 이유: 단계 변경 시 ALTER TYPE 트랜잭션 제약 회피 + 비설치 NULL 처리 용이.
- installation_history (JSONB, NOT NULL, default []): 단계 전이 이력 누적.
  요소 스키마: {step: str, actor_id: str, note: str|null, ts: ISO}
  server_default는 asyncpg 호환을 위해 sa.text("'[]'::jsonb") 사용 — 문자열 '[]'::jsonb 직접 지정
  시 InvalidTextRepresentationError 발생 (database.md 패턴: JSONB server_default sa.text 필수).
- downgrade: 두 컬럼 모두 DROP (history 손실 명시).
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "016_installation_workflow"
down_revision = "015_user_role_extend"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "tickets",
        sa.Column("installation_step", sa.String(30), nullable=True),
    )
    op.add_column(
        "tickets",
        sa.Column(
            "installation_history",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )


def downgrade() -> None:
    op.drop_column("tickets", "installation_history")
    op.drop_column("tickets", "installation_step")
