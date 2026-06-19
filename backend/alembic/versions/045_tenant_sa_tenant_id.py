"""tenants.sa_tenant_id — ITSM 테넌트별 SA 워크스페이스 테넌트 매핑

전역 SA_TENANT_ID env 를 per-tenant 컬럼으로 전환.
이전: 모든 ITSM 테넌트가 단일 전역 SA_TENANT_ID 로 SA 사업카드를 조회 →
      2번째 테넌트 온보딩 시 1번째 테넌트의 SA 데이터로 잘못 라우팅 (크로스테넌트).
이후: 테넌트 레코드의 sa_tenant_id 로 조회, 미설정 시 자기 tenant_id 사용.

기존 동작 보존: 지금까지 전역 SA_TENANT_ID 로 모든 테넌트가 동일 SA 테넌트에 매핑돼 있었으므로
마이그레이션 시점 env 값으로 기존 테넌트를 backfill. 신규 테넌트는 NULL → 자기 tenant_id fallback.

Revision ID: 045_tenant_sa_tenant_id
Revises: 044_kc_user_id_unique
Create Date: 2026-06-19
"""
import os

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "045_tenant_sa_tenant_id"
down_revision = "044_kc_user_id_unique"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "tenants",
        sa.Column("sa_tenant_id", postgresql.UUID(as_uuid=True), nullable=True),
    )

    # 기존 테넌트 backfill — 마이그레이션 시점의 전역 SA_TENANT_ID 값으로 채워
    # 기존 단일 고객의 SA 연동 동작을 그대로 유지한다 (신규 테넌트는 NULL 유지).
    legacy = (os.environ.get("SA_TENANT_ID") or "").strip()
    if legacy:
        op.execute(
            sa.text(
                "UPDATE tenants SET sa_tenant_id = CAST(:v AS uuid) "
                "WHERE sa_tenant_id IS NULL"
            ).bindparams(v=legacy)
        )


def downgrade() -> None:
    op.drop_column("tenants", "sa_tenant_id")
