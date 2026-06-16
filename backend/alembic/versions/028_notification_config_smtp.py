"""tenant_notification_configs에 SMTP + 카카오 템플릿 컬럼 추가.

Revision ID: 028_notification_config_smtp
Revises: 027_external_notification_logs
Create Date: 2026-06-16

설계 노트:
- smtp_password_enc: 평문 저장 금지. AES-256-GCM 암호화 후 base64 저장.
  복호화 키 = ITSM_ENCRYPTION_KEY 환경변수 (services/crypto.py 에서 처리).
- smtp_port default 587 (STARTTLS). 465(SSL)도 지원 — 서비스 레이어에서 포트에 따라 분기.
- smtp_use_tls: True=STARTTLS(587), False=SSL(465 권장) or plain(테스트용).
- kakao_template_* 컬럼: 알림톡 템플릿 코드. MVP에서는 NULL 허용 (이메일만 사용).
  카카오 Phase 2에서 채워 넣음.
- 기존 kakao_api_key / kakao_sender_key 컬럼 유지 (내부 알림용으로 사용 중).
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "028_notification_config_smtp"
down_revision = "027_external_notification_logs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "tenant_notification_configs",
        sa.Column("smtp_host", sa.String(200), nullable=True),
    )
    op.add_column(
        "tenant_notification_configs",
        sa.Column("smtp_port", sa.SmallInteger, nullable=True, server_default="587"),
    )
    op.add_column(
        "tenant_notification_configs",
        sa.Column("smtp_user", sa.String(200), nullable=True),
    )
    op.add_column(
        "tenant_notification_configs",
        # AES-256-GCM 암호화 후 base64 저장 — 평문 금지
        sa.Column("smtp_password_enc", sa.Text, nullable=True),
    )
    op.add_column(
        "tenant_notification_configs",
        sa.Column("smtp_use_tls", sa.Boolean, nullable=True, server_default="true"),
    )
    op.add_column(
        "tenant_notification_configs",
        sa.Column("smtp_from_email", sa.String(200), nullable=True),
    )
    op.add_column(
        "tenant_notification_configs",
        sa.Column("smtp_from_name", sa.String(100), nullable=True),
    )
    # 카카오 알림톡 템플릿 코드 (Phase 2, MVP에서는 NULL)
    op.add_column(
        "tenant_notification_configs",
        sa.Column("kakao_template_ticket_created", sa.String(100), nullable=True),
    )
    op.add_column(
        "tenant_notification_configs",
        sa.Column("kakao_template_escalated", sa.String(100), nullable=True),
    )
    op.add_column(
        "tenant_notification_configs",
        sa.Column("kakao_template_resolved", sa.String(100), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("tenant_notification_configs", "kakao_template_resolved")
    op.drop_column("tenant_notification_configs", "kakao_template_escalated")
    op.drop_column("tenant_notification_configs", "kakao_template_ticket_created")
    op.drop_column("tenant_notification_configs", "smtp_from_name")
    op.drop_column("tenant_notification_configs", "smtp_from_email")
    op.drop_column("tenant_notification_configs", "smtp_use_tls")
    op.drop_column("tenant_notification_configs", "smtp_password_enc")
    op.drop_column("tenant_notification_configs", "smtp_user")
    op.drop_column("tenant_notification_configs", "smtp_port")
    op.drop_column("tenant_notification_configs", "smtp_host")
