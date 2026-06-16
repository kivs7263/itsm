"""032 contract sla_grade String → sla_grade_enum (safe default bronze)

Revision ID: 032
Revises: 031
Create Date: 2026-06-16
"""
from alembic import op

revision = "032_contract_sla_grade_enum"
down_revision = "031_ticket_sla_deadlines"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 유효하지 않은 값을 bronze로 정규화 후 타입 변환
    op.execute("""
        UPDATE contracts
        SET sla_grade = 'bronze'
        WHERE sla_grade NOT IN ('bronze', 'silver', 'gold', 'platinum')
    """)
    op.execute("""
        ALTER TABLE contracts
        ALTER COLUMN sla_grade TYPE sla_grade_enum
        USING sla_grade::sla_grade_enum
    """)


def downgrade() -> None:
    op.execute("""
        ALTER TABLE contracts
        ALTER COLUMN sla_grade TYPE VARCHAR(50)
        USING sla_grade::text
    """)
