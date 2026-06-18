"""IMAP 수신 설정 모델 (ONB-1)."""
from __future__ import annotations

from sqlalchemy import Boolean, Column, DateTime, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID

from app.models.base import Base, gen_uuid, utcnow


class EmailInboundConfig(Base):
    __tablename__ = "email_inbound_configs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=gen_uuid)
    tenant_id = Column(UUID(as_uuid=True), nullable=False, unique=True)
    imap_host = Column(String(255), nullable=False)
    imap_port = Column(Integer, nullable=False, default=993)
    imap_user = Column(String(255), nullable=False)
    imap_password_enc = Column(Text, nullable=False)
    imap_folder = Column(String(100), nullable=False, default="INBOX")
    is_active = Column(Boolean, nullable=False, default=True)
    last_checked_at = Column(DateTime(timezone=True), nullable=True)
    last_error = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow)
