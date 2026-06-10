"""ITSM 캘린더 이벤트 모델 — 현장방문·원격지원·내부일정."""
from __future__ import annotations

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID

from app.models.base import Base, TimestampMixin, uuid_pk


class CalendarEvent(Base, TimestampMixin):
    """ITSM 자체 캘린더 이벤트.

    event_type:
        visit    — 현장방문
        remote   — 원격지원
        internal — 내부일정 (default)

    cal_event_id:
        calendar-service push 성공 시 발급받은 외부 이벤트 ID.
        None 이면 push 미완료 또는 CALENDAR_SERVICE_URL 미설정.
    """

    __tablename__ = "itsm_calendar_events"

    id = uuid_pk()
    tenant_id = Column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
    )
    ticket_id = Column(
        UUID(as_uuid=True),
        ForeignKey("tickets.id", ondelete="SET NULL"),
        nullable=True,
    )
    title = Column(String(300), nullable=False)
    event_type = Column(String(20), nullable=False, default="internal")
    start_at = Column(DateTime(timezone=True), nullable=False)
    end_at = Column(DateTime(timezone=True), nullable=True)
    is_all_day = Column(Boolean, nullable=False, default=False)
    assignee_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    description = Column(Text, nullable=True)
    organization_id = Column(UUID(as_uuid=True), nullable=True)
    cal_event_id = Column(UUID(as_uuid=True), nullable=True)
