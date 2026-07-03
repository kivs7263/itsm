"""companies_sites_contacts — 고객 데이터 모델 3정규화 신 테이블 CREATE (ADR-043 Phase 1).

Revision ID: 057
Revises: 056
Create Date: 2026-07-03

Notes:
- 순수 추가: 기존 테이블·FK 변경 없음. 롤백 = DROP TABLE 3개(역순).
- FK 의존 순서: companies → sites(company_id→companies) → contacts(company_id→companies, site_id→sites).
- server_default=now() : 실제 원본 created_at/updated_at 은 Phase 2(058) 백필이 덮어씀.
- ENUM 없음 — String + CHECK 정책 불필요(컬럼 자체가 자유문자열).
- 파괴적 작업 0건.
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "057"
down_revision = "056"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # 1. companies (법인/고객사 — 구 customers.kind='account' 승격)
    # ------------------------------------------------------------------
    op.create_table(
        "companies",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("industry", sa.String(100), nullable=True),
        sa.Column("contract_grade", sa.String(50), nullable=True),
        sa.Column(
            "linked_business_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
        sa.Column("website", sa.String(500), nullable=True),
        sa.Column("memo", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index("ix_companies_tenant_name", "companies", ["tenant_id", "name"])
    op.create_index(
        "ix_companies_tenant_contract_grade", "companies", ["tenant_id", "contract_grade"]
    )

    # ------------------------------------------------------------------
    # 2. sites (지점/사무소/현장 — 구 customers.kind='division' 승격)
    # ------------------------------------------------------------------
    op.create_table(
        "sites",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "company_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("companies.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("address", postgresql.JSONB(), nullable=True),
        sa.Column("phone", sa.String(50), nullable=True),
        sa.Column("timezone", sa.String(100), nullable=True),
        sa.Column(
            "is_headquarters",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index("ix_sites_tenant_company", "sites", ["tenant_id", "company_id"])

    # ------------------------------------------------------------------
    # 3. contacts (담당자/연락처 개인 — 구 customer_contacts 승격)
    # ------------------------------------------------------------------
    op.create_table(
        "contacts",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "company_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("companies.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "site_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("sites.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("role", sa.String(100), nullable=True),
        sa.Column("email", sa.String(255), nullable=True),
        sa.Column("phone", sa.String(50), nullable=True),
        sa.Column(
            "is_primary",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column("memo", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index("ix_contacts_tenant_company", "contacts", ["tenant_id", "company_id"])
    op.create_index("ix_contacts_tenant_email", "contacts", ["tenant_id", "email"])


def downgrade() -> None:
    # 역순: contacts(FK→sites,companies) → sites(FK→companies) → companies
    op.drop_index("ix_contacts_tenant_email", table_name="contacts")
    op.drop_index("ix_contacts_tenant_company", table_name="contacts")
    op.drop_table("contacts")

    op.drop_index("ix_sites_tenant_company", table_name="sites")
    op.drop_table("sites")

    op.drop_index("ix_companies_tenant_contract_grade", table_name="companies")
    op.drop_index("ix_companies_tenant_name", table_name="companies")
    op.drop_table("companies")
