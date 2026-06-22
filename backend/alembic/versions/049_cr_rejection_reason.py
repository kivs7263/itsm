"""049_cr_rejection_reason — change_requests.rejection_reason 컬럼 추가

Revision ID: 049_cr_rejection_reason
Revises: 048_wf2_gw_approval_ticket_unique
Create Date: 2026-06-22

설계 노트:
- migration 007 에서 change_requests 테이블이 rejection_reason 컬럼 없이 생성됨.
- 라우터의 reject 엔드포인트와 CROut 스키마가 이 컬럼을 참조하므로 500 발생.
- nullable=True — 반려 사유는 선택 입력.
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "049_cr_rejection_reason"
down_revision = "048_wf2_ticket_unique"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "change_requests",
        sa.Column("rejection_reason", sa.Text, nullable=True),
    )


def downgrade() -> None:
    op.drop_column("change_requests", "rejection_reason")
