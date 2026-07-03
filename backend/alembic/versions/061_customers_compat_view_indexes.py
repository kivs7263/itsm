"""customers_compat_view_indexes — 호환 뷰 생성 + 성능 인덱스 (ADR-043 Phase 5).

Revision ID: 061
Revises: 060
Create Date: 2026-07-03

Notes:
- customers_compat 뷰:
    - companies → kind='account' 행으로 노출 (기존 /customers 라우터 READ 하위호환).
    - sites → kind='division' 행으로 노출 (parent_id = company_id).
    - email/phone/company 컬럼: 정본이 contacts 테이블로 이동했으므로 NULL 반환.
    - 뷰는 autogenerate 비추적 객체(_include_object: table type only) — drift 걱정 없음.
- 성능 인덱스 6개: tickets/assets/contracts/ci의 신규 FK 컬럼 대상.
    인덱스 이름은 ADR-043 §Phase 5 스펙과 동일.
- downgrade: 인덱스 역순 제거 → 뷰 DROP.
- 파괴적 작업 0건.
"""
from __future__ import annotations

from alembic import op

revision = "061"
down_revision = "060"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # 1. customers_compat 호환 뷰
    #    컬럼 순서: id, tenant_id, name, email, phone, company,
    #               contract_grade, linked_business_id, parent_id, kind,
    #               created_at, updated_at  (구 customers 스키마 일치)
    # ------------------------------------------------------------------
    op.execute("""
        CREATE VIEW customers_compat AS
        SELECT
            id,
            tenant_id,
            name,
            NULL::VARCHAR           AS email,
            NULL::VARCHAR           AS phone,
            NULL::VARCHAR           AS company,
            contract_grade,
            linked_business_id,
            NULL::UUID              AS parent_id,
            'account'::VARCHAR      AS kind,
            created_at,
            updated_at
        FROM companies

        UNION ALL

        SELECT
            id,
            tenant_id,
            name,
            NULL::VARCHAR           AS email,
            NULL::VARCHAR           AS phone,
            NULL::VARCHAR           AS company,
            NULL::VARCHAR           AS contract_grade,
            NULL::UUID              AS linked_business_id,
            company_id              AS parent_id,
            'division'::VARCHAR     AS kind,
            created_at,
            updated_at
        FROM sites
    """)

    # ------------------------------------------------------------------
    # 2. 성능 인덱스 (Phase 3~4 신규 FK 컬럼 대상)
    # ------------------------------------------------------------------
    op.create_index(
        "ix_tickets_company",
        "tickets",
        ["tenant_id", "company_id"],
    )
    op.create_index(
        "ix_tickets_requester_contact",
        "tickets",
        ["tenant_id", "requester_contact_id"],
    )
    op.create_index(
        "ix_assets_company",
        "assets",
        ["tenant_id", "company_id"],
    )
    op.create_index(
        "ix_assets_site",
        "assets",
        ["tenant_id", "site_id"],
    )
    op.create_index(
        "ix_contracts_company",
        "contracts",
        ["tenant_id", "company_id"],
    )
    op.create_index(
        "ix_ci_company",
        "configuration_items",
        ["tenant_id", "company_id"],
    )


def downgrade() -> None:
    # 인덱스 역순 제거
    op.drop_index("ix_ci_company", table_name="configuration_items")
    op.drop_index("ix_contracts_company", table_name="contracts")
    op.drop_index("ix_assets_site", table_name="assets")
    op.drop_index("ix_assets_company", table_name="assets")
    op.drop_index("ix_tickets_requester_contact", table_name="tickets")
    op.drop_index("ix_tickets_company", table_name="tickets")

    op.execute("DROP VIEW IF EXISTS customers_compat")
