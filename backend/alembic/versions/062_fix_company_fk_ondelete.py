"""fix_company_fk_ondelete — assets/contracts.company_id FK를 CASCADE→SET NULL (RX-2 reviewer BLOCKER).

Revision ID: 062
Revises: 061
Create Date: 2026-07-04

Notes:
- 문제: 059가 assets.company_id / contracts.company_id FK를 ondelete=CASCADE로 생성.
  division 소속 자산/계약은 company_id가 부모 account의 company로 백필(060)되므로,
  account(Company) 삭제 시 division 소속 자산/계약까지 CASCADE로 삭제됨.
  구 시스템(customers.parent_id ondelete=SET NULL)은 부모 삭제 시 division이 orphan으로
  생존 → 그 하위 데이터도 생존. 이 semantics를 어겨 조용한 데이터 손실 발생.
- 수정: tickets/CI(company_id SET NULL)와 동일하게 assets/contracts도 SET NULL로 통일.
  account-소유 자산/계약은 여전히 customer_id → customers CASCADE로 삭제되므로 구 동작 보존.
- 파괴적 작업 0건 (FK ondelete 정책만 변경, 데이터 유지).
"""
from __future__ import annotations

from alembic import op

revision = "062"
down_revision = "061"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint("assets_company_id_fkey", "assets", type_="foreignkey")
    op.create_foreign_key(
        "assets_company_id_fkey", "assets", "companies",
        ["company_id"], ["id"], ondelete="SET NULL",
    )
    op.drop_constraint("contracts_company_id_fkey", "contracts", type_="foreignkey")
    op.create_foreign_key(
        "contracts_company_id_fkey", "contracts", "companies",
        ["company_id"], ["id"], ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("assets_company_id_fkey", "assets", type_="foreignkey")
    op.create_foreign_key(
        "assets_company_id_fkey", "assets", "companies",
        ["company_id"], ["id"], ondelete="CASCADE",
    )
    op.drop_constraint("contracts_company_id_fkey", "contracts", type_="foreignkey")
    op.create_foreign_key(
        "contracts_company_id_fkey", "contracts", "companies",
        ["company_id"], ["id"], ondelete="CASCADE",
    )
