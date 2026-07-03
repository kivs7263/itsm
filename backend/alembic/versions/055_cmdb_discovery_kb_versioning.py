"""cmdb_discovery_kb_versioning — CMDB Discovery + KB 카테고리/버전 (RA-C10).

Revision ID: 055
Revises: 054
Create Date: 2026-07-03

Notes:
- ENUM CREATE TYPE 트랩 회피: status/source 컬럼은 String + CHECK (051~054 동일 원칙).
- JSONB server_default: '[]'::jsonb 사용.
- discovery_runs: target(host/CIDR), status(pending|running|completed|failed).
- kb_categories: 계층형 (parent_id 자기참조 SET NULL). tenant_id+name+parent_id 복합 UNIQUE.
- kb_article_versions: article_id+version_no UNIQUE. edited_by SET NULL.
- kb_articles에 category_id FK 컬럼 추가 (SET NULL).
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "055"
down_revision = "054"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ----------------------------------------------------------------
    # 1. discovery_runs
    # ----------------------------------------------------------------
    op.create_table(
        "discovery_runs",
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
        sa.Column("target", sa.String(500), nullable=False),
        sa.Column(
            "status",
            sa.String(50),
            nullable=False,
            server_default="pending",
        ),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "discovered_count",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
        sa.Column(
            "error_count",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
        sa.Column(
            "errors",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column(
            "created_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'running', 'completed', 'failed')",
            name="ck_discovery_runs_status",
        ),
    )
    op.create_index(
        "ix_discovery_runs_tenant_created",
        "discovery_runs",
        ["tenant_id", sa.text("created_at DESC")],
    )

    # ----------------------------------------------------------------
    # 2. kb_categories
    # ----------------------------------------------------------------
    op.create_table(
        "kb_categories",
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
        sa.Column("description", sa.Text(), nullable=True),
        # 자기참조 FK — SET NULL (삭제 시 자식은 root로 승격)
        sa.Column(
            "parent_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("kb_categories.id", ondelete="SET NULL"),
            nullable=True,
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
        sa.UniqueConstraint(
            "tenant_id", "name", "parent_id",
            name="uq_kb_categories_tenant_name_parent",
        ),
    )
    op.create_index(
        "ix_kb_categories_tenant_id",
        "kb_categories",
        ["tenant_id"],
    )

    # ----------------------------------------------------------------
    # 3. kb_articles에 category_id 추가
    # ----------------------------------------------------------------
    op.add_column(
        "kb_articles",
        sa.Column(
            "category_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("kb_categories.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_kb_articles_category_id",
        "kb_articles",
        ["tenant_id", "category_id"],
    )

    # ----------------------------------------------------------------
    # 4. kb_article_versions
    # ----------------------------------------------------------------
    op.create_table(
        "kb_article_versions",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "article_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("kb_articles.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("version_no", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column(
            "tags",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column(
            "edited_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("edited_by_name", sa.String(255), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint(
            "article_id", "version_no",
            name="uq_kb_article_versions_article_version",
        ),
    )
    op.create_index(
        "ix_kb_article_versions_article_id",
        "kb_article_versions",
        ["article_id"],
    )
    op.create_index(
        "ix_kb_article_versions_tenant_id",
        "kb_article_versions",
        ["tenant_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_kb_article_versions_tenant_id", table_name="kb_article_versions")
    op.drop_index("ix_kb_article_versions_article_id", table_name="kb_article_versions")
    op.drop_table("kb_article_versions")

    op.drop_index("ix_kb_articles_category_id", table_name="kb_articles")
    op.drop_column("kb_articles", "category_id")

    op.drop_index("ix_kb_categories_tenant_id", table_name="kb_categories")
    op.drop_table("kb_categories")

    op.drop_index("ix_discovery_runs_tenant_created", table_name="discovery_runs")
    op.drop_table("discovery_runs")
