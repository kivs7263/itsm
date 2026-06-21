"""tickets.gw_approval_doc_id UNIQUE — WF-2 GW결재→ITSM 작업 티켓 멱등성

ADR-048 WF-2: GW 결재(form_key=itsm_task_request) 승인 시 ITSM 내부 라우터가
자동으로 작업 티켓을 생성한다. gw_approval_doc_id 중복 요청 시 기존 ticket_id를 반환.
UNIQUE 제약으로 DB 레벨 중복 방어.

source 컬럼은 이미 존재(047 이전) — server_default='manual' ALTER로 기본값 보완.
gw_approval_doc_id UNIQUE partial index (NOT NULL 행에만 적용).

Revision ID: 048_wf2_gw_approval_ticket_unique
Revises: 047_ticket_gw_approval_wf1
Create Date: 2026-06-21
"""
import sqlalchemy as sa
from alembic import op

revision = "048_wf2_ticket_unique"
down_revision = "047_ticket_gw_approval_wf1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # WF-2 멱등성: gw_approval_doc_id 중복 생성 방지 — partial UNIQUE index
    # (gw_approval_doc_id IS NOT NULL 행에만 적용 — 기존 NULL 행 영향 없음)
    op.create_index(
        "uix_tickets_gw_approval_doc_id",
        "tickets",
        ["gw_approval_doc_id"],
        unique=True,
        postgresql_where=sa.text("gw_approval_doc_id IS NOT NULL"),
    )

    # source 컬럼 server_default 'manual' 추가 (신규 티켓 source 미지정 시 기본값)
    # 기존 NULL 행은 그대로 유지 (nullable=True 유지)
    op.alter_column(
        "tickets",
        "source",
        server_default="manual",
        existing_type=sa.String(30),
        existing_nullable=True,
    )


def downgrade() -> None:
    op.alter_column(
        "tickets",
        "source",
        server_default=None,
        existing_type=sa.String(30),
        existing_nullable=True,
    )
    op.drop_index("uix_tickets_gw_approval_doc_id", table_name="tickets")
