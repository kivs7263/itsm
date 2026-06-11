"""009_notification_logs — 멀티채널 알림 발송 로그 (P3-5)

Revision ID: 009_notification_logs
Revises: 008_csat
Create Date: 2026-06-11

설계 노트:
- 카카오/SMS/Slack/Teams 다채널 알림 발송 결과 추적용 단일 로그 테이블.
- ENUM(notif_channel_enum, notif_status_enum)은 sa.Enum() 호출 시 자동 생성
  (create_type 기본 True). 모델 측에서는 create_type=False 로 선언.
- TIMESTAMPTZ 컬럼은 server_default=sa.func.now() 사용 (utcnow 금지).
- ticket_id: soft reference (FK 없음). 티켓 삭제와 알림 로그 라이프사이클을
  분리해 발송 이력은 보존. tenant_id 만 FK 로 정합성 보장.
- UNIQUE 제약 없음 — 동일 이벤트 재발송도 모두 별건으로 기록.
- 인덱스: tenant 기본 + (tenant_id, created_at DESC) 시계열 조회 + (tenant_id, channel)
  채널별 집계.
- DESC 인덱스는 sa.text("created_at DESC") 로 표현식 명시 (모델·migration 양쪽 동일).
- downgrade: 테이블 drop 후 ENUM drop. 각 op.execute()/Enum.drop() 별도 호출
  (asyncpg 다중 statement DDL 불가 회피).
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

# revision identifiers
revision = "009_notification_logs"
down_revision = "008_csat"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # notification_logs
    # ------------------------------------------------------------------
    op.create_table(
        "notification_logs",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "tenant_id",
            UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "channel",
            sa.Enum(
                "kakao",
                "sms",
                "slack",
                "teams",
                name="notif_channel_enum",
            ),
            nullable=False,
        ),
        sa.Column(
            "event_type",
            sa.String(100),
            nullable=False,
            comment="ticket_created / ticket_resolved / sla_breach_warning / sla_breached 등",
        ),
        sa.Column(
            "recipient",
            sa.String(200),
            nullable=False,
            comment="전화번호 또는 이메일/웹훅 식별자",
        ),
        sa.Column(
            "status",
            sa.Enum(
                "sent",
                "failed",
                "skipped",
                name="notif_status_enum",
            ),
            nullable=False,
            server_default="sent",
        ),
        sa.Column(
            "message_summary",
            sa.Text,
            nullable=True,
            comment="발송 내용 요약",
        ),
        sa.Column(
            "error_msg",
            sa.Text,
            nullable=True,
            comment="실패 시 오류 메시지",
        ),
        sa.Column(
            "ticket_id",
            UUID(as_uuid=True),
            nullable=True,
            comment="연관 티켓 soft ref (FK 없음 — 라이프사이클 분리)",
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        "ix_notification_logs_tenant",
        "notification_logs",
        ["tenant_id"],
    )
    op.create_index(
        "ix_notification_logs_tenant_created",
        "notification_logs",
        ["tenant_id", sa.text("created_at DESC")],
    )
    op.create_index(
        "ix_notification_logs_tenant_channel",
        "notification_logs",
        ["tenant_id", "channel"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_notification_logs_tenant_channel",
        table_name="notification_logs",
    )
    op.drop_index(
        "ix_notification_logs_tenant_created",
        table_name="notification_logs",
    )
    op.drop_index(
        "ix_notification_logs_tenant",
        table_name="notification_logs",
    )
    op.drop_table("notification_logs")

    # ENUM 정리 (테이블 drop 후) — 별도 호출 (asyncpg 다중 statement DDL 불가)
    sa.Enum(name="notif_status_enum").drop(op.get_bind(), checkfirst=True)
    sa.Enum(name="notif_channel_enum").drop(op.get_bind(), checkfirst=True)
