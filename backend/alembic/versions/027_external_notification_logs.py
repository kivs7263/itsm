"""외부 알림 발송 이력 테이블 신규 생성: external_notification_logs.

Revision ID: 027_external_notification_logs
Revises: 026_tickets_escalation_columns
Create Date: 2026-06-16

설계 노트:
- 기존 notification_logs는 내부(Slack/Teams) 전용 — email 채널 없음 → 별도 테이블 신규 생성.
- ticket_id / escalation_id: soft ref (FK 없음) → 티켓/에스컬레이션 삭제 후에도 이력 보존.
- status: pending → sent(성공) or retrying(재시도 중) → failed(최종 실패).
- payload JSONB: 발송 요청 원문 저장 (감사용, 재발송 시 재사용 가능).
- provider_ref: 외부 API 응답 메시지 ID (SMTP MessageId, 카카오 msgKey 등).
- Enum: sa.Enum 기본 create_type=True로 테이블 생성 시 자동 생성.
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "027_external_notification_logs"
down_revision = "026_tickets_escalation_columns"
branch_labels = None
depends_on = None

_channel_enum = sa.Enum("email", "sms", "kakao", name="ext_notif_channel_enum")
_status_enum = sa.Enum("pending", "sent", "failed", "retrying", name="ext_notif_status_enum")


def upgrade() -> None:
    op.create_table(
        "external_notification_logs",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "tenant_id",
            UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        # soft refs — 이력 보존 위해 FK 없음
        sa.Column("ticket_id", UUID(as_uuid=True), nullable=True),
        sa.Column("escalation_id", UUID(as_uuid=True), nullable=True),
        sa.Column("channel", _channel_enum, nullable=False),
        sa.Column("event_type", sa.String(100), nullable=False),
        sa.Column("recipient", sa.String(200), nullable=False),
        sa.Column("status", _status_enum, nullable=False, server_default="pending"),
        sa.Column("payload", JSONB, nullable=True),
        sa.Column("provider_ref", sa.String(200), nullable=True),
        sa.Column("error_msg", sa.Text, nullable=True),
        sa.Column("retry_count", sa.SmallInteger, nullable=False, server_default="0"),
        sa.Column("next_retry_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )

    op.create_index(
        "ix_ext_notif_tenant",
        "external_notification_logs",
        ["tenant_id", "created_at"],
    )
    op.create_index(
        "ix_ext_notif_retry",
        "external_notification_logs",
        ["status", "next_retry_at"],
        postgresql_where=sa.text("status IN ('pending', 'retrying')"),
    )
    op.create_index(
        "ix_ext_notif_ticket",
        "external_notification_logs",
        ["ticket_id"],
        postgresql_where=sa.text("ticket_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_ext_notif_ticket", table_name="external_notification_logs")
    op.drop_index("ix_ext_notif_retry", table_name="external_notification_logs")
    op.drop_index("ix_ext_notif_tenant", table_name="external_notification_logs")
    op.drop_table("external_notification_logs")
    _status_enum.drop(op.get_bind(), checkfirst=True)
    _channel_enum.drop(op.get_bind(), checkfirst=True)
