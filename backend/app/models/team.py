"""팀 및 팀 멤버 모델."""
from __future__ import annotations

from sqlalchemy import Column, ForeignKey, PrimaryKeyConstraint, String
from sqlalchemy.dialects.postgresql import UUID

from app.models.base import Base, gen_uuid, utcnow
from sqlalchemy import DateTime


class Team(Base):
    __tablename__ = "teams"

    id = Column(UUID(as_uuid=True), primary_key=True, default=gen_uuid)
    tenant_id = Column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
    )
    name = Column(String(100), nullable=False)
    lead_user_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at = Column(DateTime(timezone=True), nullable=False, default=utcnow)


class TeamMember(Base):
    __tablename__ = "team_members"
    __table_args__ = (
        PrimaryKeyConstraint("team_id", "user_id"),
    )

    team_id = Column(
        UUID(as_uuid=True),
        ForeignKey("teams.id", ondelete="CASCADE"),
        nullable=False,
    )
    user_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    tenant_id = Column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
    )
