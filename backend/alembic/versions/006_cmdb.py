"""006_cmdb — configuration_items, ci_relationships, ci_change_log (CMDB 심화)

Revision ID: 006_cmdb
Revises: 005_kb
Create Date: 2026-06-11

설계 노트:
- ENUM 4종 (ci_type_enum, ci_env_enum, ci_status_enum, ci_criticality_enum,
  ci_rel_type_enum)은 sa.Enum() 호출 시 자동 생성 (create_type 기본 True).
- self-referential FK: ci_relationships.from_ci_id / to_ci_id 는
  CREATE TABLE 후 별도 ALTER ADD CONSTRAINT 로 분리 (멱등성·순환 의존 회피).
- TIMESTAMPTZ 컬럼은 server_default=sa.func.now() 사용 (utcnow 금지).
- 모든 도메인 테이블은 tenant_id NOT NULL + (tenant_id, ...) 복합 인덱스.
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

# revision identifiers
revision = "006_cmdb"
down_revision = "005_kb"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # configuration_items
    # ------------------------------------------------------------------
    op.create_table(
        "configuration_items",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "tenant_id",
            UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "asset_id",
            UUID(as_uuid=True),
            sa.ForeignKey("assets.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "ci_type",
            sa.Enum(
                "server",
                "workstation",
                "network_device",
                "application",
                "service",
                "database",
                "virtual_machine",
                "cloud_resource",
                "storage",
                "firewall",
                "router_switch",
                "printer",
                name="ci_type_enum",
            ),
            nullable=False,
        ),
        sa.Column("name", sa.String(500), nullable=False),
        sa.Column("hostname", sa.String(500), nullable=True),
        sa.Column("ip_address", sa.String(50), nullable=True),
        sa.Column("os_type", sa.String(200), nullable=True),
        sa.Column("os_version", sa.String(200), nullable=True),
        sa.Column(
            "environment",
            sa.Enum(
                "production",
                "staging",
                "development",
                "test",
                name="ci_env_enum",
            ),
            nullable=False,
            server_default="production",
        ),
        sa.Column(
            "status",
            sa.Enum(
                "active",
                "inactive",
                "maintenance",
                "decommissioned",
                name="ci_status_enum",
            ),
            nullable=False,
            server_default="active",
        ),
        sa.Column(
            "criticality",
            sa.Enum(
                "critical",
                "high",
                "medium",
                "low",
                name="ci_criticality_enum",
            ),
            nullable=False,
            server_default="medium",
        ),
        sa.Column(
            "owner_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "customer_id",
            UUID(as_uuid=True),
            sa.ForeignKey("customers.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "attributes",
            JSONB,
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        "ix_ci_tenant_type",
        "configuration_items",
        ["tenant_id", "ci_type"],
    )
    op.create_index(
        "ix_ci_tenant_status",
        "configuration_items",
        ["tenant_id", "status"],
    )
    op.create_index(
        "ix_ci_tenant_customer",
        "configuration_items",
        ["tenant_id", "customer_id"],
    )

    # ------------------------------------------------------------------
    # ci_relationships  (self-referential FK 분리 ALTER)
    # ------------------------------------------------------------------
    op.create_table(
        "ci_relationships",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "tenant_id",
            UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        # self-ref FK 는 아래 ALTER 로 추가
        sa.Column("from_ci_id", UUID(as_uuid=True), nullable=False),
        sa.Column("to_ci_id", UUID(as_uuid=True), nullable=False),
        sa.Column(
            "rel_type",
            sa.Enum(
                "depends_on",
                "hosted_on",
                "runs_on",
                "connects_to",
                "part_of",
                "manages",
                "backed_up_to",
                name="ci_rel_type_enum",
            ),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint(
            "tenant_id",
            "from_ci_id",
            "to_ci_id",
            "rel_type",
            name="uq_ci_rel",
        ),
    )
    # self-referential FK 별도 ALTER (멱등성 확보)
    op.create_foreign_key(
        "fk_ci_rel_from_ci",
        "ci_relationships",
        "configuration_items",
        ["from_ci_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_foreign_key(
        "fk_ci_rel_to_ci",
        "ci_relationships",
        "configuration_items",
        ["to_ci_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index(
        "ix_ci_rel_from",
        "ci_relationships",
        ["tenant_id", "from_ci_id"],
    )
    op.create_index(
        "ix_ci_rel_to",
        "ci_relationships",
        ["tenant_id", "to_ci_id"],
    )

    # ------------------------------------------------------------------
    # ci_change_log
    # ------------------------------------------------------------------
    op.create_table(
        "ci_change_log",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "tenant_id",
            UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "ci_id",
            UUID(as_uuid=True),
            sa.ForeignKey("configuration_items.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "changed_by",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("field_name", sa.String(100), nullable=False),
        sa.Column("old_value", sa.Text, nullable=True),
        sa.Column("new_value", sa.Text, nullable=True),
        sa.Column("change_reason", sa.Text, nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        "ix_ci_change_log_tenant_ci",
        "ci_change_log",
        ["tenant_id", "ci_id"],
    )
    # DESC 인덱스 — 최신순 페이징 최적화
    op.create_index(
        "ix_ci_change_log_tenant_created",
        "ci_change_log",
        ["tenant_id", sa.text("created_at DESC")],
    )


def downgrade() -> None:
    # ci_change_log
    op.drop_index("ix_ci_change_log_tenant_created", table_name="ci_change_log")
    op.drop_index("ix_ci_change_log_tenant_ci", table_name="ci_change_log")
    op.drop_table("ci_change_log")

    # ci_relationships
    op.drop_index("ix_ci_rel_to", table_name="ci_relationships")
    op.drop_index("ix_ci_rel_from", table_name="ci_relationships")
    op.drop_constraint("fk_ci_rel_to_ci", "ci_relationships", type_="foreignkey")
    op.drop_constraint("fk_ci_rel_from_ci", "ci_relationships", type_="foreignkey")
    op.drop_table("ci_relationships")

    # configuration_items
    op.drop_index("ix_ci_tenant_customer", table_name="configuration_items")
    op.drop_index("ix_ci_tenant_status", table_name="configuration_items")
    op.drop_index("ix_ci_tenant_type", table_name="configuration_items")
    op.drop_table("configuration_items")

    # ENUM 정리 (테이블 모두 drop 후)
    sa.Enum(name="ci_rel_type_enum").drop(op.get_bind(), checkfirst=True)
    sa.Enum(name="ci_criticality_enum").drop(op.get_bind(), checkfirst=True)
    sa.Enum(name="ci_status_enum").drop(op.get_bind(), checkfirst=True)
    sa.Enum(name="ci_env_enum").drop(op.get_bind(), checkfirst=True)
    sa.Enum(name="ci_type_enum").drop(op.get_bind(), checkfirst=True)
