from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base

import enum


class BillingPlan(str, enum.Enum):
    free = "free"
    starter = "starter"
    professional = "professional"
    enterprise = "enterprise"


# 플랜별 제한 설정 (seats_limit, ticket_limit_monthly=None은 무제한)
PLAN_LIMITS: dict[BillingPlan, dict] = {
    BillingPlan.free:         {"seats": 3,    "tickets_monthly": 100, "api_keys": False, "api_calls_daily": 0},
    BillingPlan.starter:      {"seats": 10,   "tickets_monthly": None, "api_keys": False, "api_calls_daily": 1000},
    BillingPlan.professional: {"seats": 30,   "tickets_monthly": None, "api_keys": True,  "api_calls_daily": 10000},
    BillingPlan.enterprise:   {"seats": 9999, "tickets_monthly": None, "api_keys": True,  "api_calls_daily": None},
}


class TenantSubscription(Base):
    __tablename__ = "tenant_subscriptions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, server_default=text("gen_random_uuid()"))
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, unique=True)
    plan: Mapped[str] = mapped_column(String(20), nullable=False, default="free")
    stripe_customer_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    stripe_subscription_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    current_period_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    seats_limit: Mapped[int] = mapped_column(Integer, nullable=False, default=3)
    ticket_limit_monthly: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=text("NOW()"))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=text("NOW()"))


class UsageMetering(Base):
    __tablename__ = "usage_metering"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, server_default=text("gen_random_uuid()"))
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    month: Mapped[str] = mapped_column(String(7), nullable=False)  # yyyymm
    engineer_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    ticket_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    api_call_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    computed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=text("NOW()"))
