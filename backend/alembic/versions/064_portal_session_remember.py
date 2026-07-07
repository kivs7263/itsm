"""portal_sessions.is_remember — 장수명 세션 플래그 추가.

remember=True 세션(절대 TTL 90일·idle 30일)과 기본 세션(절대 30일·idle 14일)을
서버 측에서 구분하기 위한 boolean 컬럼.  기존 행은 DEFAULT FALSE 로 소급 처리.

Revision ID: 064
Revises: 063
Create Date: 2026-07-07
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "064"
down_revision = "063"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # NOT NULL + server_default="false" → 기존 행 포함 안전 추가 (재기동 불필요)
    op.add_column(
        "portal_sessions",
        sa.Column(
            "is_remember",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )


def downgrade() -> None:
    op.drop_column("portal_sessions", "is_remember")
