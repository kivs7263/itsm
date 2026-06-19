"""사용자 모델."""
from __future__ import annotations

import enum

from sqlalchemy import Boolean, Column, Enum, ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID

from app.models.base import Base, gen_uuid, utcnow
from sqlalchemy import DateTime


class UserRole(str, enum.Enum):
    engineer = "engineer"
    team_lead = "team_lead"
    admin = "admin"
    customer = "customer"
    sales = "sales"
    c_level = "c_level"


# PostgreSQL ENUM 타입명 — migration과 동일하게 유지
_user_role_enum = Enum(
    "engineer", "team_lead", "admin", "customer", "sales", "c_level",
    name="user_role_enum",
)


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        UniqueConstraint("tenant_id", "email", name="uq_users_tenant_email"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=gen_uuid)
    tenant_id = Column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
    )
    email = Column(String(255), nullable=False)
    name = Column(String(100), nullable=False)
    role = Column(_user_role_enum, nullable=False, default=UserRole.engineer)
    hashed_password = Column(String, nullable=True)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=utcnow)
    # ADR-044 축5: KC sub UUID — SSO Portal admin_bridge로 프로비저닝된 사용자 식별자
    kc_user_id = Column(String(100), nullable=True, index=True)
