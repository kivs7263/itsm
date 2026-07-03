"""add_company_site_contact_fk_cols — tickets/assets/contracts/ci에 신규 FK 컬럼 추가 (ADR-043 Phase 3).

Revision ID: 059
Revises: 058
Create Date: 2026-07-03

Notes:
- 모든 신규 컬럼: NULLABLE — 기존 앱 코드 변경 없이 무중단 배포.
- tickets  : company_id(SET NULL), site_id(SET NULL), requester_contact_id(SET NULL).
- assets   : company_id(CASCADE — 회사 삭제 시 자산도 삭제), site_id(SET NULL).
- contracts: company_id(CASCADE).
- configuration_items: company_id(SET NULL), site_id(SET NULL).
- 기존 customer_id 컬럼 그대로 유지 (이중쓰기 기간 병행 — ADR-043 §4).
- downgrade: op.drop_column 호출 시 FK 제약도 함께 제거됨(Alembic 기본 동작).
- 파괴적 작업 0건.
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "059"
down_revision = "058"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # tickets
    # ------------------------------------------------------------------
    op.add_column(
        "tickets",
        sa.Column(
            "company_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("companies.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column(
        "tickets",
        sa.Column(
            "site_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("sites.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column(
        "tickets",
        sa.Column(
            "requester_contact_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("contacts.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )

    # ------------------------------------------------------------------
    # assets
    # ------------------------------------------------------------------
    op.add_column(
        "assets",
        sa.Column(
            "company_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("companies.id", ondelete="SET NULL"),  # 062 교정 반영(재현성)
            nullable=True,
        ),
    )
    op.add_column(
        "assets",
        sa.Column(
            "site_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("sites.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )

    # ------------------------------------------------------------------
    # contracts
    # ------------------------------------------------------------------
    op.add_column(
        "contracts",
        sa.Column(
            "company_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("companies.id", ondelete="SET NULL"),  # 062 교정 반영(재현성)
            nullable=True,
        ),
    )

    # ------------------------------------------------------------------
    # configuration_items
    # ------------------------------------------------------------------
    op.add_column(
        "configuration_items",
        sa.Column(
            "company_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("companies.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column(
        "configuration_items",
        sa.Column(
            "site_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("sites.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )


def downgrade() -> None:
    # configuration_items
    op.drop_column("configuration_items", "site_id")
    op.drop_column("configuration_items", "company_id")
    # contracts
    op.drop_column("contracts", "company_id")
    # assets
    op.drop_column("assets", "site_id")
    op.drop_column("assets", "company_id")
    # tickets
    op.drop_column("tickets", "requester_contact_id")
    op.drop_column("tickets", "site_id")
    op.drop_column("tickets", "company_id")
