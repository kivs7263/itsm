"""반복 장애 감지 모델."""
from __future__ import annotations

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer
from sqlalchemy.dialects.postgresql import ARRAY, UUID, UUID as pgUUID

from app.models.base import Base, gen_uuid, utcnow


class RecurringAlert(Base):
    __tablename__ = "recurring_alerts"

    id = Column(UUID(as_uuid=True), primary_key=True, default=gen_uuid)
    tenant_id = Column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
    )
    customer_id = Column(
        UUID(as_uuid=True),
        ForeignKey("customers.id", ondelete="SET NULL"),
        nullable=True,
    )
    symptom_category_id = Column(
        UUID(as_uuid=True),
        ForeignKey("symptom_categories.id", ondelete="SET NULL"),
        nullable=True,
    )
    trigger_ticket_ids = Column(ARRAY(pgUUID(as_uuid=True)), nullable=False, default=list)
    occurrence_count = Column(Integer, nullable=False)
    detected_at = Column(DateTime(timezone=True), nullable=False, default=utcnow)
    acknowledged_by = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    acknowledged_at = Column(DateTime(timezone=True), nullable=True)
    is_acknowledged = Column(Boolean, nullable=False, default=False)
