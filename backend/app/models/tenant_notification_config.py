"""테넌트별 알림 채널 설정 모델.

tenant당 row 1개 (unique=True on tenant_id).
Webhook URL / API Key 등 민감 값은 평문 저장.
운영 환경에서 암호화가 필요하다면 Fernet 레이어 추가 고려.
"""
from __future__ import annotations

from sqlalchemy import Column, DateTime, ForeignKey, String, Text, UniqueConstraint
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

    created_at = Column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow)
