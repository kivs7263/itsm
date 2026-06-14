"""티켓-알려진 이슈 연결 모델."""
from __future__ import annotations

from sqlalchemy import Column, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID

from app.models.base import Base, utcnow


class TicketKnownIssue(Base):
    __tablename__ = "ticket_known_issues"

    ticket_id = Column(
        UUID(as_uuid=True),
        ForeignKey("tickets.id", ondelete="CASCADE"),
        primary_key=True,
    )
    article_id = Column(
        UUID(as_uuid=True),
        ForeignKey("kb_articles.id", ondelete="CASCADE"),
        primary_key=True,
    )
    linked_at = Column(DateTime(timezone=True), nullable=False, default=utcnow)
    linked_by = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
