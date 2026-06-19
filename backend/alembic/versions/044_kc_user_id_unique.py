"""kc_user_id 테넌트 내 unique 제약 — admin_bridge upsert 레이스/중복 방지 (reviewer HIGH 5-b)

비유니크 ix_users_kc_user_id를 (tenant_id, kc_user_id) 부분 unique 인덱스로 교체한다.
동일 kc_user_id가 같은 테넌트에 중복 삽입되면 add_member의 scalar_one_or_none이
MultipleResultsFound(500)로 노출되므로 DB 레벨에서 차단한다.

Revision ID: 044_kc_user_id_unique
Revises: 043_sso_org_id_kc_user_id
Create Date: 2026-06-19
"""
from alembic import op
import sqlalchemy as sa

revision = "044_kc_user_id_unique"
down_revision = "043_sso_org_id_kc_user_id"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_index("ix_users_kc_user_id", "users")
    op.create_index(
        "uq_users_tenant_kc_user",
        "users",
        ["tenant_id", "kc_user_id"],
        unique=True,
        postgresql_where=sa.text("kc_user_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_users_tenant_kc_user", "users")
    op.create_index(
        "ix_users_kc_user_id",
        "users",
        ["kc_user_id"],
    )
