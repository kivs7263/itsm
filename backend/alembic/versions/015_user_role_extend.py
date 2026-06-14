"""UserRole enum에 sales, c_level 추가.

Revision ID: 015_user_role_extend
Revises: 014_classification_tables
Create Date: 2026-06-14

설계 노트:
- PostgreSQL ALTER TYPE ADD VALUE는 트랜잭션 내 사용 불가.
  op.execute()로 직접 실행 + autocommit 모드 필요.
- alembic transactional_ddl = False 인 경우 그냥 execute 가능.
  현재 프로젝트 설정(env.py)은 transactional_ddl=True → COMMIT 선행 필요.
- downgrade: PostgreSQL은 ENUM 값 삭제를 직접 지원하지 않으므로
  pg_enum 카탈로그 직접 DELETE (운영 DB는 downgrade 전 데이터 정리 필수).
"""
from __future__ import annotations

from alembic import op

revision = "015_user_role_extend"
down_revision = "014_classification_tables"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # COMMIT 선행 후 ADD VALUE (non-transactional DDL)
    op.execute("COMMIT")
    op.execute("ALTER TYPE user_role_enum ADD VALUE IF NOT EXISTS 'sales'")
    op.execute("ALTER TYPE user_role_enum ADD VALUE IF NOT EXISTS 'c_level'")


def downgrade() -> None:
    # 주의: 해당 값을 사용 중인 rows가 없을 때만 안전
    op.execute("COMMIT")
    op.execute(
        "DELETE FROM pg_enum "
        "WHERE enumlabel IN ('sales', 'c_level') "
        "AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'user_role_enum')"
    )
