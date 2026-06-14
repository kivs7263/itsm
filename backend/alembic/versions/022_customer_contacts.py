"""고객 다중 연락처 테이블 신규 생성: customer_contacts.

Revision ID: 022_customer_contacts
Revises: 021_reports
Create Date: 2026-06-14

설계 노트:
- tenant_id FK + 인덱스에 tenant_id 선두 컬럼 → 멀티테넌트 격리 (★★ 핵심 체크).
- customer_id ON DELETE CASCADE: 고객 삭제 시 연락처 자동 제거(독립적 가치 없음).
- is_primary 단일 primary 보장: partial UNIQUE 인덱스
    uq_customer_contacts_primary ON (customer_id) WHERE is_primary = TRUE
  → 동일 customer 에 is_primary=TRUE 인 행이 최대 1개만 존재. is_primary=FALSE 인 행은 제약 없음.
  쿼리 표현식 `WHERE is_primary = TRUE` 와 정확히 일치해야 인덱스 활용됨 — 서비스 레이어 INSERT/UPDATE
  시 동일 표현 유지 필수.
- ix_customer_contacts_tenant_customer: 고객 상세 화면에서 연락처 목록 조회용 (tenant_id, customer_id).
  tenant_id 선두 → 테넌트 격리 + customer 선택성 결합.
- email / phone: 형식 검증은 서비스 레이어(Pydantic) 담당. DB 는 길이만 제약.
- is_primary 기본값 FALSE: 첫 행 추가 시 서비스 레이어에서 명시적으로 TRUE 지정.
- created_at / updated_at: TIMESTAMPTZ(`DateTime(timezone=True)`) — UTC 보장.
- downgrade: 인덱스 → 테이블 역순. partial UNIQUE 인덱스도 drop_index 로 명시 제거.
- 운영 영향: 신규 테이블 생성만 — 잠금 영향 없음.
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "022_customer_contacts"
down_revision = "021_reports"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "customer_contacts",
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
            "customer_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("customers.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(100), nullable=False),
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

    # 고객당 단일 primary 보장 — partial UNIQUE
    op.create_index(
        "uq_customer_contacts_primary",
        "customer_contacts",
        ["customer_id"],
        unique=True,
        postgresql_where=sa.text("is_primary = TRUE"),
    )

    # 테넌트 격리 + 고객별 연락처 조회 최적화
    op.create_index(
        "ix_customer_contacts_tenant_customer",
        "customer_contacts",
        ["tenant_id", "customer_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_customer_contacts_tenant_customer", table_name="customer_contacts"
    )
    op.drop_index("uq_customer_contacts_primary", table_name="customer_contacts")
    op.drop_table("customer_contacts")
