"""테넌트별 알림 채널 설정 모델.

tenant당 row 1개 (unique=True on tenant_id).
Webhook URL / API Key 등 민감 값은 평문 저장.
운영 환경에서 암호화가 필요하다면 Fernet 레이어 추가 고려.
"""
from __future__ import annotations

from sqlalchemy import (
    Boolean, Column, DateTime, ForeignKey, SmallInteger, String, Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID

from app.models.base import Base, gen_uuid, utcnow


class TenantNotificationConfig(Base):
    __tablename__ = "tenant_notification_configs"
    __table_args__ = (
        UniqueConstraint("tenant_id", name="uq_tenant_notification_config_tenant"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=gen_uuid)
    tenant_id = Column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )

    # Slack
    slack_webhook_url = Column(Text, nullable=True)

    # Microsoft Teams
    teams_webhook_url = Column(Text, nullable=True)

    # 카카오
    kakao_api_key = Column(Text, nullable=True)
    kakao_sender_key = Column(Text, nullable=True)

    # SMS
    sms_api_key = Column(Text, nullable=True)
    sms_api_secret = Column(Text, nullable=True)
    sms_from_number = Column(String(30), nullable=True)

    # SMTP (고객 외부 알림 — ESC-3)
    smtp_host = Column(String(200), nullable=True)
    smtp_port = Column(SmallInteger, nullable=False, default=587)
    smtp_user = Column(String(200), nullable=True)
    smtp_password_enc = Column(Text, nullable=True)  # Fernet 암호화, app.core.crypto
    smtp_use_tls = Column(Boolean, nullable=False, default=True)
    smtp_from_email = Column(String(200), nullable=True)
    smtp_from_name = Column(String(100), nullable=True)

    # 카카오 알림톡 템플릿 코드 (고객 발송용 — ESC-B1 예정, 컬럼만 선반영)
    kakao_template_ticket_created = Column(String(100), nullable=True)
    kakao_template_escalated = Column(String(100), nullable=True)
    kakao_template_resolved = Column(String(100), nullable=True)

    created_at = Column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow)
