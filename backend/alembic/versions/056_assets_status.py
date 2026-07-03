"""assets_status — assets 테이블에 status 컬럼 추가 (RX-0a).

Revision ID: 056
Revises: 055
Create Date: 2026-07-03

Notes:
- ENUM CREATE TYPE 트랩 회피: String(20) + CHECK (051~055 동일 원칙).
- server_default='active' 로 기존 행 백필.
- nullable=False: server_default 설정 후 NOT NULL 가능.
- customers.py 롤업 `AND status = 'active'` 쿼리 정합 해소.
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "056"
down_revision = "055"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. status 컬럼 추가 (server_default으로 기존 행 백필)
    op.add_column(
        "assets",
        sa.Column(
            "status",
            sa.String(20),
            nullable=False,
            server_default="active",
        ),
    )

    # 2. CHECK 제약 추가
    op.create_check_constraint(
        "ck_assets_status",
        "assets",
        "status IN ('active', 'retired', 'disposed')",
    )


def downgrade() -> None:
    op.drop_constraint("ck_assets_status", "assets", type_="check")
    op.drop_column("assets", "status")
