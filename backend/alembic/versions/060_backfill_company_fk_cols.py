"""backfill_company_fk_cols — customer_id → company_id 백필 (ADR-043 Phase 4).

Revision ID: 060
Revises: 059
Create Date: 2026-07-03

Notes:
- tickets.company_id 백필:
    - customer_id가 account → companies.id 직접 매핑
    - customer_id가 division → parent(companies.id) 매핑
    - division이어도 parent_id IS NULL(고아) → company_id NULL 유지(의도적 스킵)
- assets/contracts/ci: account만 직접 매핑 (division 귀속 자산은 수동 정리 대상)
- downgrade: 신규 FK 컬럼을 NULL 초기화 (컬럼 제거는 059 downgrade에서 수행)
- 파괴적 작업 0건 (기존 customer_id 유지).
"""
from __future__ import annotations

from alembic import op

revision = "060"
down_revision = "059"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # tickets — account 직접 매핑
    # ------------------------------------------------------------------
    op.execute("""
        UPDATE tickets t
        SET company_id = c.id
        FROM customers c
        WHERE t.customer_id = c.id
          AND c.kind = 'account'
          AND c.id IN (SELECT id FROM companies)
          AND t.company_id IS NULL
    """)

    # tickets — division → parent company 매핑
    op.execute("""
        UPDATE tickets t
        SET company_id = c.parent_id
        FROM customers c
        WHERE t.customer_id = c.id
          AND c.kind = 'division'
          AND c.parent_id IS NOT NULL
          AND c.parent_id IN (SELECT id FROM companies)
          AND t.company_id IS NULL
    """)

    # ------------------------------------------------------------------
    # assets — account 직접 매핑 + division → parent company & site
    # ------------------------------------------------------------------
    op.execute("""
        UPDATE assets a
        SET company_id = c.id
        FROM customers c
        WHERE a.customer_id = c.id
          AND c.kind = 'account'
          AND c.id IN (SELECT id FROM companies)
          AND a.company_id IS NULL
    """)
    op.execute("""
        UPDATE assets a
        SET company_id = s.company_id, site_id = s.id
        FROM sites s
        WHERE a.customer_id = s.id
          AND a.company_id IS NULL
    """)

    # ------------------------------------------------------------------
    # contracts — account 직접 매핑 + division → parent company
    # ------------------------------------------------------------------
    op.execute("""
        UPDATE contracts ct
        SET company_id = c.id
        FROM customers c
        WHERE ct.customer_id = c.id
          AND c.kind = 'account'
          AND c.id IN (SELECT id FROM companies)
          AND ct.company_id IS NULL
    """)
    op.execute("""
        UPDATE contracts ct
        SET company_id = s.company_id
        FROM sites s
        WHERE ct.customer_id = s.id
          AND ct.company_id IS NULL
    """)

    # ------------------------------------------------------------------
    # configuration_items — account 직접 매핑 + division → parent company & site
    # ------------------------------------------------------------------
    op.execute("""
        UPDATE configuration_items ci
        SET company_id = c.id
        FROM customers c
        WHERE ci.customer_id = c.id
          AND c.kind = 'account'
          AND c.id IN (SELECT id FROM companies)
          AND ci.company_id IS NULL
    """)
    op.execute("""
        UPDATE configuration_items ci
        SET company_id = s.company_id, site_id = s.id
        FROM sites s
        WHERE ci.customer_id = s.id
          AND ci.company_id IS NULL
    """)


def downgrade() -> None:
    # 백필 데이터 NULL 초기화 (컬럼 삭제는 059 downgrade 담당)
    op.execute(
        "UPDATE configuration_items SET company_id = NULL, site_id = NULL"
    )
    op.execute("UPDATE contracts SET company_id = NULL")
    op.execute("UPDATE assets SET company_id = NULL, site_id = NULL")
    op.execute(
        "UPDATE tickets SET company_id = NULL, site_id = NULL, requester_contact_id = NULL"
    )
