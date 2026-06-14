"""고객사 계층 구조: customers.parent_id + customers.kind 컬럼 추가.

Revision ID: 011_customer_hierarchy
Revises: 010_work_logs
Create Date: 2026-06-14

설계 노트:
- parent_id: self-reference, ON DELETE SET NULL (상위 삭제 시 하위는 root로 승격)
- kind: 'account'(최상위) | 'division'(하위 사업부/팀), 기본값 'account'
- 기존 rows: parent_id=NULL, kind='account' — 영향 없음
- cycle 방지 및 깊이 5단계 제한은 애플리케이션 레이어에서 처리
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "011_customer_hierarchy"
down_revision = "010_work_logs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "customers",
        sa.Column(
            "parent_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("customers.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column(
        "customers",
        sa.Column(
            "kind",
            sa.String(20),
            nullable=False,
            server_default="account",
        ),
    )
    op.create_index(
        "ix_customers_tenant_parent",
        "customers",
        ["tenant_id", "parent_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_customers_tenant_parent", table_name="customers")
    op.drop_column("customers", "kind")
    op.drop_column("customers", "parent_id")
