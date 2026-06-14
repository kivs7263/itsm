"""답변 템플릿 테이블 신규 생성: reply_templates.

Revision ID: 017_reply_templates
Revises: 016_installation_workflow
Create Date: 2026-06-14

설계 노트:
- tenant_id FK + ix_reply_templates_tenant 인덱스로 멀티테넌트 격리 (DB 전문가 ★★ 핵심 체크).
- author_id ON DELETE SET NULL: 작성자 삭제 시 템플릿 보존 (공유 자산).
- is_shared (default TRUE): false 면 author 전용 개인 템플릿.
- use_count: 사용 빈도 기반 정렬·추천용 카운터. 동시성 갱신은 서비스 레이어에서 UPDATE ... SET use_count = use_count + 1.
- id PK는 server_default=gen_random_uuid() 명시 — PostgreSQL 13+ pgcrypto 불필요(내장). DB 측 생성으로 일부 클라이언트(미지정) 호환.
- downgrade: 인덱스는 drop_table 시 자동 제거되지만 명시적 drop_index 후 drop_table (alembic 관례).
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "017_reply_templates"
down_revision = "016_installation_workflow"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "reply_templates",
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
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("category", sa.String(50), nullable=True),
        sa.Column(
            "is_shared",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        sa.Column(
            "author_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "use_count",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
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

    op.create_index(
        "ix_reply_templates_tenant",
        "reply_templates",
        ["tenant_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_reply_templates_tenant", table_name="reply_templates")
    op.drop_table("reply_templates")
