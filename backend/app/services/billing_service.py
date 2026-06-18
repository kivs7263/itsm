"""빌링 서비스 — 플랜 조회, 사용량 집계, 제한 enforcement.

Redis 캐시 키:
  itsm:plan:{tenant_id}           TTL 3600s — TenantSubscription 직렬화
  itsm:tickets:{tenant_id}:{yyyymm}  TTL 3600s — 당월 티켓 수
  itsm:engineers:{tenant_id}      TTL 3600s — 활성 엔지니어 수

제한 초과 시 HTTP 402 반환.
STRIPE_SECRET_KEY 미설정 시 checkout → 501 반환.
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.subscription import BillingPlan, PLAN_LIMITS, TenantSubscription
from app.models.ticket import Ticket
from app.models.user import User, UserRole

_ENGINEER_ROLES = {UserRole.engineer, UserRole.team_lead, UserRole.admin}
_CACHE_TTL = 3600


def _upgrade_url(tenant_id: uuid.UUID) -> str:
    return "/settings?tab=billing"


def _plan_limit_error(tenant_id: uuid.UUID, message: str) -> HTTPException:
    return HTTPException(
        status_code=402,
        detail={"message": message, "upgrade_url": _upgrade_url(tenant_id)},
    )


async def get_subscription(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    redis: Any | None = None,
) -> TenantSubscription | None:
    """구독 정보 조회 (Redis 캐시 우선)."""
    cache_key = f"itsm:plan:{tenant_id}"

    if redis:
        try:
            cached = await redis.get(cache_key)
            if cached:
                data = json.loads(cached)
                sub = TenantSubscription()
                for k, v in data.items():
                    setattr(sub, k, v)
                return sub
        except Exception:
            pass

    row = (
        await db.execute(
            select(TenantSubscription).where(TenantSubscription.tenant_id == tenant_id)
        )
    ).scalar_one_or_none()

    if row and redis:
        try:
            await redis.set(
                cache_key,
                json.dumps({
                    "plan": row.plan if isinstance(row.plan, str) else row.plan.value,
                    "seats_limit": row.seats_limit,
                    "ticket_limit_monthly": row.ticket_limit_monthly,
                    "is_active": row.is_active,
                }),
                ex=_CACHE_TTL,
            )
        except Exception:
            pass

    return row


def _effective_plan(sub: TenantSubscription | None) -> BillingPlan:
    if sub is None or not sub.is_active:
        return BillingPlan.free
    val = sub.plan if isinstance(sub.plan, BillingPlan) else BillingPlan(sub.plan)
    return val


async def _get_monthly_ticket_count(
    db: AsyncSession, tenant_id: uuid.UUID, month_str: str, redis: Any | None
) -> int:
    cache_key = f"itsm:tickets:{tenant_id}:{month_str}"
    if redis:
        try:
            val = await redis.get(cache_key)
            if val is not None:
                return int(val)
        except Exception:
            pass

    year = int(month_str[:4])
    month = int(month_str[4:])
    if month == 12:
        next_year, next_month = year + 1, 1
    else:
        next_year, next_month = year, month + 1

    from datetime import datetime
    start = datetime(year, month, 1, tzinfo=timezone.utc)
    end = datetime(next_year, next_month, 1, tzinfo=timezone.utc)

    count = await db.scalar(
        select(func.count()).select_from(Ticket).where(
            Ticket.tenant_id == tenant_id,
            Ticket.created_at >= start,
            Ticket.created_at < end,
        )
    ) or 0

    if redis:
        try:
            await redis.set(cache_key, str(count), ex=_CACHE_TTL)
        except Exception:
            pass
    return count


async def _get_engineer_count(
    db: AsyncSession, tenant_id: uuid.UUID, redis: Any | None
) -> int:
    cache_key = f"itsm:engineers:{tenant_id}"
    if redis:
        try:
            val = await redis.get(cache_key)
            if val is not None:
                return int(val)
        except Exception:
            pass

    count = await db.scalar(
        select(func.count()).select_from(User).where(
            User.tenant_id == tenant_id,
            User.is_active.is_(True),
            User.role.in_([r.value for r in _ENGINEER_ROLES]),
        )
    ) or 0

    if redis:
        try:
            await redis.set(cache_key, str(count), ex=_CACHE_TTL)
        except Exception:
            pass
    return count


async def check_ticket_limit(
    db: AsyncSession, tenant_id: uuid.UUID, redis: Any | None = None
) -> None:
    """Free 플랜 월 100건 제한 초과 시 402."""
    sub = await get_subscription(db, tenant_id, redis)
    plan = _effective_plan(sub)
    limits = PLAN_LIMITS[plan]
    if limits["tickets_monthly"] is None:
        return  # 무제한

    month_str = datetime.now(timezone.utc).strftime("%Y%m")
    count = await _get_monthly_ticket_count(db, tenant_id, month_str, redis)
    if count >= limits["tickets_monthly"]:
        raise _plan_limit_error(
            tenant_id,
            f"이번 달 티켓 생성 한도({limits['tickets_monthly']}건)에 도달했습니다. 플랜을 업그레이드하세요.",
        )


async def check_seat_limit(
    db: AsyncSession, tenant_id: uuid.UUID, redis: Any | None = None
) -> None:
    """엔지니어 시트 한도 초과 시 402."""
    sub = await get_subscription(db, tenant_id, redis)
    plan = _effective_plan(sub)
    seats_limit = PLAN_LIMITS[plan]["seats"]

    count = await _get_engineer_count(db, tenant_id, redis)
    if count >= seats_limit:
        raise _plan_limit_error(
            tenant_id,
            f"엔지니어 시트 한도({seats_limit}명)에 도달했습니다. 플랜을 업그레이드하세요.",
        )


async def check_api_key_allowed(
    db: AsyncSession, tenant_id: uuid.UUID, redis: Any | None = None
) -> None:
    """Free/Starter 플랜에서 API 키 생성 시도 시 402."""
    sub = await get_subscription(db, tenant_id, redis)
    plan = _effective_plan(sub)
    if not PLAN_LIMITS[plan]["api_keys"]:
        raise _plan_limit_error(
            tenant_id,
            "API 키는 Professional 플랜 이상에서 사용할 수 있습니다.",
        )


async def create_stripe_checkout(
    tenant_id: uuid.UUID,
    plan: str,
    success_url: str,
    cancel_url: str,
    customer_id: str | None = None,
) -> str:
    """Stripe Checkout Session 생성 → URL 반환. 미설정 시 '' 반환."""
    if not settings.STRIPE_SECRET_KEY:
        return ""

    price_map = {
        "starter": settings.STRIPE_PRICE_STARTER,
        "professional": settings.STRIPE_PRICE_PROFESSIONAL,
    }
    price_id = price_map.get(plan, "")
    if not price_id:
        return ""

    try:
        import stripe
        stripe.api_key = settings.STRIPE_SECRET_KEY

        params: dict = {
            "mode": "subscription",
            "line_items": [{"price": price_id, "quantity": 1}],
            "success_url": success_url,
            "cancel_url": cancel_url,
            "metadata": {"tenant_id": str(tenant_id)},
        }
        if customer_id:
            params["customer"] = customer_id

        session = stripe.checkout.Session.create(**params)
        return session.url or ""
    except Exception:
        return ""


async def handle_stripe_webhook(payload: bytes, sig_header: str, db: AsyncSession) -> dict:
    """Stripe 웹훅 이벤트 처리."""
    if not settings.STRIPE_WEBHOOK_SECRET or not settings.STRIPE_SECRET_KEY:
        return {"received": True}

    try:
        import stripe
        stripe.api_key = settings.STRIPE_SECRET_KEY
        event = stripe.Webhook.construct_event(payload, sig_header, settings.STRIPE_WEBHOOK_SECRET)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid signature: {e}")

    event_type = event["type"]
    obj = event["data"]["object"]

    if event_type in ("customer.subscription.created", "customer.subscription.updated"):
        await _upsert_subscription_from_stripe(db, obj)
    elif event_type == "customer.subscription.deleted":
        await _downgrade_to_free(db, obj)

    return {"received": True}


async def _upsert_subscription_from_stripe(db: AsyncSession, obj: dict) -> None:
    from datetime import datetime
    import uuid

    tenant_id_str = obj.get("metadata", {}).get("tenant_id")
    if not tenant_id_str:
        return

    try:
        tenant_id = uuid.UUID(tenant_id_str)
    except ValueError:
        return

    price_id = obj.get("items", {}).get("data", [{}])[0].get("price", {}).get("id", "")
    plan = BillingPlan.free
    if price_id == settings.STRIPE_PRICE_STARTER:
        plan = BillingPlan.starter
    elif price_id == settings.STRIPE_PRICE_PROFESSIONAL:
        plan = BillingPlan.professional

    limits = PLAN_LIMITS[plan]
    period_end_ts = obj.get("current_period_end")
    period_end = datetime.fromtimestamp(period_end_ts, tz=timezone.utc) if period_end_ts else None

    existing = (
        await db.execute(
            select(TenantSubscription).where(TenantSubscription.tenant_id == tenant_id)
        )
    ).scalar_one_or_none()

    if existing:
        existing.plan = plan
        existing.stripe_subscription_id = obj.get("id")
        existing.stripe_customer_id = obj.get("customer")
        existing.current_period_end = period_end
        existing.seats_limit = limits["seats"]
        existing.ticket_limit_monthly = limits["tickets_monthly"]
        existing.is_active = True
    else:
        db.add(TenantSubscription(
            tenant_id=tenant_id,
            plan=plan,
            stripe_customer_id=obj.get("customer"),
            stripe_subscription_id=obj.get("id"),
            current_period_end=period_end,
            seats_limit=limits["seats"],
            ticket_limit_monthly=limits["tickets_monthly"],
        ))
    await db.commit()


async def _downgrade_to_free(db: AsyncSession, obj: dict) -> None:
    tenant_id_str = obj.get("metadata", {}).get("tenant_id")
    if not tenant_id_str:
        return
    try:
        tenant_id = uuid.UUID(tenant_id_str)
    except ValueError:
        return

    row = (
        await db.execute(
            select(TenantSubscription).where(TenantSubscription.tenant_id == tenant_id)
        )
    ).scalar_one_or_none()

    if row:
        row.plan = BillingPlan.free
        row.seats_limit = PLAN_LIMITS[BillingPlan.free]["seats"]
        row.ticket_limit_monthly = PLAN_LIMITS[BillingPlan.free]["tickets_monthly"]
        row.stripe_subscription_id = None
        row.current_period_end = None
        await db.commit()
