"""외부 알림 발송 이력 모델."""
from __future__ import annotations

import enum

from sqlalchemy import (
    Column, DateTime, Enum, Index, SmallInteger, String, Text,
    ForeignKey,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.models.base import Base, gen_uuid, utcnow


class ExtNotifChannel(str, enum.Enum):
    email = "email"
    sms = "sms"
    kakao = "kakao"


class ExtNotifStatus(str, enum.Enum):
    pending = "pending"
    sent = "sent"
    failed = "failed"
    retrying = "retrying"


_channel_pg = Enum("email", "sms", "kakao", name="ext_notif_channel_enum", create_type=False)
_status_pg = Enum(
    "pending", "sent", "failed", "retrying",
    name="ext_notif_status_enum",
    create_type=False,
)


class ExternalNotificationLog(Base):
    __tablename__ = "external_notification_logs"
    __table_args__ = (
        Index("ix_ext_notif_tenant", "tenant_id", "created_at"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=gen_uuid)
    tenant_id = Column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
    )
    # soft refs — FK 없음 (삭제 후에도 이력 보존)
    ticket_id = Column(UUID(as_uuid=True), nullable=True)
    escalation_id = Column(UUID(as_uuid=True), nullable=True)

    channel = Column(_channel_pg, nullable=False)
    event_type = Column(String(100), nullable=False)
    recipient = Column(String(200), nullable=False)
    status = Column(_status_pg, nullable=False, default=ExtNotifStatus.pending)

    payload = Column(JSONB, nullable=True)
    provider_ref = Column(String(200), nullable=True)
    error_msg = Column(Text, nullable=True)
    retry_count = Column(SmallInteger, nullable=False, default=0)
    next_retry_at = Column(DateTime(timezone=True), nullable=True)
    sent_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=utcnow)
