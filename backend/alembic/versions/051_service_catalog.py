"""service_catalog — service_categories / service_offerings / service_offering_submissions 테이블 생성,
tickets.service_offering_id 컬럼 추가, 시스템 오퍼링 6개 시드.

Revision ID: 051
Revises: 050
Create Date: 2026-06-30

Notes:
- ticket_priority_enum / sla_grade_enum 기존 PG 타입 재사용 (create_type=False — 중복 생성 시
  DuplicateObject 에러 방지).
- JSONB NOT NULL 기본값은 ALTER TABLE로 별도 설정 (asyncpg CREATE TABLE 인라인 JSONB
  server_default 렌더링 버그 회피 — migration 050 동일 패턴).
- 시드: 모든 기존 테넌트에 is_system=TRUE 오퍼링 6개 INSERT (category_id=NULL).
"""
from __future__ import annotations

import uuid

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "051"
down_revision = "050"
branch_labels = None
depends_on = None

# ── 시드 데이터 ─────────────────────────────────────────────────────────────
_SYSTEM_OFFERINGS = [
    ("incident",           "장애 신고"),
    ("service_request",    "일반 서비스 요청"),
    ("installation",       "설치 요청"),
    ("upgrade",            "업그레이드"),
    ("technical_inquiry",  "기술 문의"),
    ("maintenance",        "유지보수"),
]

# ⚠️ 콜론 뒤 공백 필수: op.execute f-string의 SET DEFAULT 에 JSON을 인라인할 때
#    SQLAlchemy text()가 `:1`/`:키` 를 바인드 파라미터로 오인한다(`"version":1`→바인드).
#    `: 1` 처럼 공백을 두면 바인드 정규식(:(\w+))에 안 걸린다. JSON 의미는 동일.
_EMPTY_FORM_SCHEMA   = '{"version": 1, "fields": []}'
_EMPTY_APPROVAL_POLICY = '{"required": false}'


def upgrade() -> None:
    # ----------------------------------------------------------------
    # 1. service_categories
    # ----------------------------------------------------------------
    op.create_table(
        "service_categories",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("slug", sa.String(60), nullable=False),
        sa.Column("icon", sa.String(60), nullable=True),
        sa.Column("parent_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("service_categories.id", ondelete="CASCADE"), nullable=True),
        sa.Column("display_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.UniqueConstraint("tenant_id", "slug", name="uq_service_categories_tenant_slug"),
    )
    op.create_index(
        "ix_service_categories_tenant_parent",
        "service_categories",
        ["tenant_id", "parent_id"],
    )

    # ----------------------------------------------------------------
    # 2. service_offerings — enum 컬럼 create_type=False
    # ----------------------------------------------------------------
    op.create_table(
        "service_offerings",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("category_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("service_categories.id", ondelete="SET NULL"), nullable=True),
        sa.Column("code", sa.String(60), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("icon", sa.String(60), nullable=True),
        sa.Column("request_type", sa.String(30), nullable=False),
        sa.Column(
            "default_priority",
            postgresql.ENUM("low", "medium", "high", "critical",
                            name="ticket_priority_enum", create_type=False),
            nullable=False,
            server_default="medium",
        ),
        sa.Column(
            "default_sla_grade",
            postgresql.ENUM("bronze", "silver", "gold", "platinum",
                            name="sla_grade_enum", create_type=False),
            nullable=True,
        ),
        # JSONB NOT NULL 기본값은 아래 ALTER TABLE로 설정
        sa.Column("form_schema", postgresql.JSONB(), nullable=True),
        sa.Column("approval_policy", postgresql.JSONB(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("is_system", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("display_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.UniqueConstraint("tenant_id", "code", name="uq_service_offerings_tenant_code"),
    )
    # JSONB NOT NULL 기본값 설정
    op.execute(f"ALTER TABLE service_offerings ALTER COLUMN form_schema SET DEFAULT '{_EMPTY_FORM_SCHEMA}'::jsonb")
    op.execute("ALTER TABLE service_offerings ALTER COLUMN form_schema SET NOT NULL")
    op.execute(f"ALTER TABLE service_offerings ALTER COLUMN approval_policy SET DEFAULT '{_EMPTY_APPROVAL_POLICY}'::jsonb")
    op.execute("ALTER TABLE service_offerings ALTER COLUMN approval_policy SET NOT NULL")

    op.create_index(
        "ix_service_offerings_tenant_active_category",
        "service_offerings",
        ["tenant_id", "is_active", "category_id"],
    )

    # ----------------------------------------------------------------
    # 3. service_offering_submissions
    # ----------------------------------------------------------------
    op.create_table(
        "service_offering_submissions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("ticket_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("tickets.id", ondelete="CASCADE"),
                  nullable=False, unique=True),
        sa.Column("offering_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("service_offerings.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("offering_version", sa.Integer(), nullable=False, server_default="1"),
        # JSONB NOT NULL 기본값은 아래 ALTER TABLE로 설정
        sa.Column("form_data", postgresql.JSONB(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
    )
    # JSONB NOT NULL 기본값 설정
    op.execute("ALTER TABLE service_offering_submissions ALTER COLUMN form_data SET DEFAULT '{}'::jsonb")
    op.execute("ALTER TABLE service_offering_submissions ALTER COLUMN form_data SET NOT NULL")

    op.create_index(
        "ix_service_offering_submissions_tenant_offering",
        "service_offering_submissions",
        ["tenant_id", "offering_id"],
    )

    # ----------------------------------------------------------------
    # 4. tickets.service_offering_id 컬럼 추가
    # ----------------------------------------------------------------
    op.add_column(
        "tickets",
        sa.Column(
            "service_offering_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("service_offerings.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_tickets_tenant_service_offering",
        "tickets",
        ["tenant_id", "service_offering_id"],
    )

    # ----------------------------------------------------------------
    # 5. 시드 — 기존 테넌트별 system offering 6개 INSERT
    # ----------------------------------------------------------------
    bind = op.get_bind()
    tenant_ids = [row[0] for row in bind.execute(sa.text("SELECT id FROM tenants")).fetchall()]

    if tenant_ids:
        # op.bulk_insert + 타입드 테이블 — raw SQL `::cast` 와 명명 바인드 혼용을
        # asyncpg가 파싱 못하는 문제 회피. enum/jsonb 바인딩을 컬럼 타입이 처리.
        offerings_tbl = sa.table(
            "service_offerings",
            sa.column("id", postgresql.UUID(as_uuid=True)),
            sa.column("tenant_id", postgresql.UUID(as_uuid=True)),
            sa.column("category_id", postgresql.UUID(as_uuid=True)),
            sa.column("code", sa.String),
            sa.column("name", sa.String),
            sa.column("description", sa.Text),
            sa.column("icon", sa.String),
            sa.column("request_type", sa.String),
            sa.column("default_priority",
                      postgresql.ENUM("low", "medium", "high", "critical",
                                      name="ticket_priority_enum", create_type=False)),
            sa.column("default_sla_grade",
                      postgresql.ENUM("bronze", "silver", "gold", "platinum",
                                      name="sla_grade_enum", create_type=False)),
            sa.column("form_schema", postgresql.JSONB),
            sa.column("approval_policy", postgresql.JSONB),
            sa.column("is_active", sa.Boolean),
            sa.column("is_system", sa.Boolean),
            sa.column("display_order", sa.Integer),
        )
        rows = []
        for tenant_id in tenant_ids:
            for idx, (code, name) in enumerate(_SYSTEM_OFFERINGS):
                rows.append({
                    "id": uuid.uuid4(),
                    "tenant_id": tenant_id,
                    "category_id": None,
                    "code": code,
                    "name": name,
                    "description": None,
                    "icon": None,
                    "request_type": code,
                    "default_priority": "medium",
                    "default_sla_grade": None,
                    "form_schema": {"version": 1, "fields": []},
                    "approval_policy": {"required": False},
                    "is_active": True,
                    "is_system": True,
                    "display_order": idx,
                })
        op.bulk_insert(offerings_tbl, rows)


def downgrade() -> None:
    # 역순: index → 컬럼 → 테이블 (FK 의존 역순)
    op.drop_index("ix_tickets_tenant_service_offering", table_name="tickets")
    op.drop_column("tickets", "service_offering_id")

    op.drop_index("ix_service_offering_submissions_tenant_offering",
                  table_name="service_offering_submissions")
    op.drop_table("service_offering_submissions")

    op.drop_index("ix_service_offerings_tenant_active_category",
                  table_name="service_offerings")
    op.drop_table("service_offerings")

    op.drop_index("ix_service_categories_tenant_parent",
                  table_name="service_categories")
    op.drop_table("service_categories")
