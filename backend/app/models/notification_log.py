"""NotificationLog 모델 — 멀티채널 알림 발송 로그 (P3-5).

설계 노트:
- ENUM(notif_channel_enum, notif_status_enum)은 migration 009 에서 생성.
  모델 측 Enum() 선언은 동일 name + 동일 값 순서 + create_type=False 유지.
- 멀티테넌트: tenant_id NOT NULL + (tenant_id, ...) 복합 인덱스.
- ticket_id: soft reference — FK 없음. 티켓 삭제 시에도 발송 이력 보존.
- DESC 인덱스는 sa.text("created_at DESC") 로 표현식 명시 (생략 시 autogenerate
  가 인덱스 삭제로 감지하여 영구 drift 발생).
- UNIQUE 제약 없음 — 동일 이벤트 재발송도 별건 기록.
- TIMESTAMPTZ 기본값은 DB server_default=now() 사용 (utcnow 금지).
"""
from __future__ import annotations

import enum

from sqlalchemy import (
    Column,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    String,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.models.base import Base, gen_uuid


# ----------------------------------------------------------------------
# Python enum (코드 체인 동기화용 — 서비스/Pydantic 레이어에서 import)
# ----------------------------------------------------------------------
class NotifChannel(str, enum.Enum):
    kakao = "kakao"
    sms = "sms"
    slack = "slack"
    teams = "teams"


class NotifStatus(str, enum.Enum):
    sent = "sent"
    failed = "failed"
    skipped = "skipped"


# ----------------------------------------------------------------------
# SQLAlchemy ENUM 컬럼 정의 (create_type=False — migration 에서 이미 생성)
# ----------------------------------------------------------------------
_notif_channel_enum = Enum(
    "kakao",
    "sms",
    "slack",
    "teams",
    name="notif_channel_enum",
    create_type=False,
)

_notif_status_enum = Enum(
    "sent",
    "failed",
    "skipped",
    name="notif_status_enum",
    create_type=False,
)


# ----------------------------------------------------------------------
# NotificationLog
# ----------------------------------------------------------------------
class NotificationLog(Base):
    __tablename__ = "notification_logs"
    __table_args__ = (
        Index("ix_notification_logs_tenant", "tenant_id"),
        Index(
            "ix_notification_logs_tenant_created",
            "tenant_id",
            text("created_at DESC"),
        ),
        Index(
            "ix_notification_logs_tenant_channel",
            "tenant_id",
            "channel",
        ),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=gen_uuid)
    tenant_id = Column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
    )
    channel = Column(
        _notif_channel_enum,
        nullable=False,
    )
    event_type = Column(
        String(100),
        nullable=False,
        comment="ticket_created / ticket_resolved / sla_breach_warning / sla_breached 등",
    )
    recipient = Column(
        String(200),
        nullable=False,
        comment="전화번호 또는 이메일/웹훅 식별자",
    )
    status = Column(
        _notif_status_enum,
        nullable=False,
        default=NotifStatus.sent,
    )
    message_summary = Column(
        Text,
        nullable=True,
        comment="발송 내용 요약",
    )
    error_msg = Column(
        Text,
        nullable=True,
        comment="실패 시 오류 메시지",
    )
    ticket_id = Column(
        UUID(as_uuid=True),
        nullable=True,
        comment="연관 티켓 soft ref (FK 없음 — 라이프사이클 분리)",
    )
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
    )

    # relationships — tenant 만 (ticket 은 soft ref 라 미연결)
    tenant = relationship("Tenant", lazy="select")
