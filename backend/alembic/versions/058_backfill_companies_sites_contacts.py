"""backfill_companies_sites_contacts — 기존 데이터 이관 (ADR-043 Phase 2).

Revision ID: 058
Revises: 057
Create Date: 2026-07-03

Notes:
- 순수 데이터 이관: 스키마 변경 없음. 원본 customers/customer_contacts 테이블 유지.
- 실행 순서:
    1) customers(kind=account) → companies
    2) 고아 division 처리: parent_id IS NULL인 division이 있는 테넌트에 'Unknown Company' 생성
    3) customers(kind=division, parent_id→companies) → sites  (정상 division)
    4) customers(kind=division, parent_id IS NULL) → sites (Unknown Company 귀속)
    5) customer_contacts → contacts
       - customer_id가 account → company_id 직접 매핑
       - customer_id가 division → parent company 매핑 + site_id 설정
    6) customers(kind=account, email/phone 있음, is_primary contact 없음) → primary contact 자동 생성
- downgrade: DELETE FROM 순서 보장(contacts→sites→companies). FK TRUNCATE CASCADE 회피.
  ※ 059~061 downgrade 이후(FK 컬럼 제거)에 058 downgrade 실행이 정석 순서.
- 파괴적 작업 0건 (원본 테이블 유지).
"""
from __future__ import annotations

from alembic import op

revision = "058"
down_revision = "057"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # 1. customers.kind='account' → companies
    # ------------------------------------------------------------------
    op.execute("""
        INSERT INTO companies (
            id, tenant_id, name, contract_grade, linked_business_id, created_at, updated_at
        )
        SELECT id, tenant_id, name, contract_grade, linked_business_id, created_at, updated_at
        FROM customers
        WHERE kind = 'account'
    """)

    # ------------------------------------------------------------------
    # 2. 고아 division 처리 (ADR-043 R1):
    #    parent_id IS NULL인 division이 있는 테넌트 → 'Unknown Company' 레코드 생성.
    #    이미 companies에 'Unknown Company'가 있으면 스킵(NOT EXISTS).
    # ------------------------------------------------------------------
    op.execute("""
        INSERT INTO companies (id, tenant_id, name, created_at, updated_at)
        SELECT
            gen_random_uuid(),
            orphan_tenants.tenant_id,
            'Unknown Company',
            now(),
            now()
        FROM (
            SELECT DISTINCT tenant_id
            FROM customers
            WHERE kind = 'division' AND parent_id IS NULL
        ) AS orphan_tenants
        WHERE NOT EXISTS (
            SELECT 1
            FROM companies co
            WHERE co.tenant_id = orphan_tenants.tenant_id
              AND co.name = 'Unknown Company'
        )
    """)

    # ------------------------------------------------------------------
    # 3. customers.kind='division', parent_id→companies 정상 케이스 → sites
    # ------------------------------------------------------------------
    op.execute("""
        INSERT INTO sites (id, tenant_id, company_id, name, created_at, updated_at)
        SELECT c.id, c.tenant_id, c.parent_id, c.name, c.created_at, c.updated_at
        FROM customers c
        WHERE c.kind = 'division'
          AND c.parent_id IS NOT NULL
          AND c.parent_id IN (SELECT id FROM companies)
    """)

    # ------------------------------------------------------------------
    # 4. 고아 division → 'Unknown Company' site로 귀속
    # ------------------------------------------------------------------
    op.execute("""
        INSERT INTO sites (id, tenant_id, company_id, name, created_at, updated_at)
        SELECT
            c.id,
            c.tenant_id,
            (
                SELECT co.id
                FROM companies co
                WHERE co.tenant_id = c.tenant_id
                  AND co.name = 'Unknown Company'
                LIMIT 1
            ) AS company_id,
            c.name,
            c.created_at,
            c.updated_at
        FROM customers c
        WHERE c.kind = 'division'
          AND c.parent_id IS NULL
    """)

    # ------------------------------------------------------------------
    # 5. customer_contacts → contacts
    #    - customer_id가 account(companies에 있음): company_id 직접 매핑
    #    - customer_id가 division(sites에 있음): parent→company_id, division→site_id
    # ------------------------------------------------------------------
    op.execute("""
        INSERT INTO contacts (
            id, tenant_id, company_id, site_id,
            name, role, email, phone, is_primary, memo, created_at, updated_at
        )
        SELECT
            cc.id,
            cc.tenant_id,
            CASE
                WHEN c.kind = 'account' THEN c.id
                WHEN c.kind = 'division' THEN c.parent_id
            END AS company_id,
            CASE
                WHEN c.kind = 'division' AND c.id IN (SELECT id FROM sites) THEN c.id
                ELSE NULL
            END AS site_id,
            cc.name,
            cc.role,
            cc.email,
            cc.phone,
            cc.is_primary,
            cc.memo,
            cc.created_at,
            cc.updated_at
        FROM customer_contacts cc
        JOIN customers c ON c.id = cc.customer_id
        WHERE
            (c.kind = 'account' AND c.id IN (SELECT id FROM companies))
            OR (c.kind = 'division' AND c.parent_id IN (SELECT id FROM companies))
    """)

    # ------------------------------------------------------------------
    # 6. customers(kind=account, email/phone 보유, is_primary contact 미존재)
    #    → primary contact 자동 생성
    # ------------------------------------------------------------------
    op.execute("""
        INSERT INTO contacts (
            id, tenant_id, company_id, name, email, phone, is_primary, created_at, updated_at
        )
        SELECT
            gen_random_uuid(),
            c.tenant_id,
            c.id,
            c.name,
            c.email,
            c.phone,
            true,
            now(),
            now()
        FROM customers c
        WHERE c.kind = 'account'
          AND (c.email IS NOT NULL OR c.phone IS NOT NULL)
          AND NOT EXISTS (
              SELECT 1
              FROM contacts ct
              WHERE ct.company_id = c.id AND ct.is_primary = true
          )
    """)


def downgrade() -> None:
    # 역순 삭제 — FK 제약 고려 (contacts→sites→companies)
    op.execute("DELETE FROM contacts")
    op.execute("DELETE FROM sites")
    op.execute("DELETE FROM companies")
