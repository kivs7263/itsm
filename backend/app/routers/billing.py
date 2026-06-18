"""빌링 라우터.

prefix: /api/{slug}/billing  (인증 필요)
        /api/billing          (공개 — Stripe 웹훅)

엔드포인트:
  GET   /{slug}/billing/subscription     — 현재 구독 조회
  POST  /{slug}/billing/checkout         — Stripe Checkout Session 생성
  GET   /{slug}/billing/invoices         — Stripe 인보이스 목록
  POST  /billing/stripe-webhook          — Stripe 웹훅 수신 (공개)
  POST  /{slug}/billing/signup-free      — Free 플랜 테넌트 등록 (self-serve)
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.dependencies import get_current_user, require_roles
from app.models.subscription import BillingPlan, PLAN_LIMITS, TenantSubscription
from app.models.user import User, UserRole
from app.services import billing_service

router = APIRouter(
    prefix="/{tenant_slug}/billing",
    tags=["billing"],
)

# 공개 웹훅 라우터 (인증 없음)
router_webhook = APIRouter(
    prefix="/billing",
    tags=["billing-webhook"],
)


# ------------------------------------------------------------------
# 스키마
# ------------------------------------------------------------------

class SubscriptionOut(BaseModel):
    plan: str
    seats_limit: int
    ticket_limit_monthly: int | None
    api_keys_allowed: bool
    current_period_end: datetime | None
    stripe_customer_id: str | None
    is_active: bool
    seat_usage: int = 0
    ticket_usage_this_month: int = 0


class CheckoutRequest(BaseModel):
    plan: str
    success_url: str
    cancel_url: str


# ------------------------------------------------------------------
# 구독 조회
# ------------------------------------------------------------------

@router.get("/subscription", response_model=SubscriptionOut)
async def get_subscription(
    tenant_slug: str,
    current_user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
) -> SubscriptionOut:
    from app.core.redis import get_redis
    sub = await billing_service.get_subscription(db, current_user.tenant_id, get_redis())
    plan = billing_service._effective_plan(sub)
    limits = PLAN_LIMITS[plan]

    # 사용량 조회
    from datetime import timezone
    month_str = datetime.now(timezone.utc).strftime("%Y%m")
    ticket_count = await billing_service._get_monthly_ticket_count(
        db, current_user.tenant_id, month_str, get_redis()
    )
    engineer_count = await billing_service._get_engineer_count(
        db, current_user.tenant_id, get_redis()
    )

    return SubscriptionOut(
        plan=plan.value,
        seats_limit=limits["seats"],
        ticket_limit_monthly=limits["tickets_monthly"],
        api_keys_allowed=limits["api_keys"],
        current_period_end=sub.current_period_end if sub else None,
        stripe_customer_id=sub.stripe_customer_id if sub else None,
        is_active=sub.is_active if sub else True,
        seat_usage=engineer_count,
        ticket_usage_this_month=ticket_count,
    )


# ------------------------------------------------------------------
# Stripe Checkout
# ------------------------------------------------------------------

@router.post("/checkout")
async def create_checkout(
    tenant_slug: str,
    data: CheckoutRequest,
    current_user: Annotated[User, Depends(require_roles(UserRole.admin))],
    db: AsyncSession = Depends(get_db),
) -> dict:
    if not settings.STRIPE_SECRET_KEY:
        raise HTTPException(status_code=501, detail="결제 기능이 설정되지 않았습니다.")

    if data.plan not in ("starter", "professional"):
        raise HTTPException(status_code=400, detail="유효하지 않은 플랜입니다.")

    sub = await billing_service.get_subscription(db, current_user.tenant_id)
    customer_id = sub.stripe_customer_id if sub else None

    url = await billing_service.create_stripe_checkout(
        tenant_id=current_user.tenant_id,
        plan=data.plan,
        success_url=data.success_url,
        cancel_url=data.cancel_url,
        customer_id=customer_id,
    )
    if not url:
        raise HTTPException(status_code=500, detail="체크아웃 세션 생성에 실패했습니다.")

    return {"checkout_url": url}


# ------------------------------------------------------------------
# 인보이스 목록
# ------------------------------------------------------------------

@router.get("/invoices")
async def list_invoices(
    tenant_slug: str,
    current_user: Annotated[User, Depends(require_roles(UserRole.admin))],
    db: AsyncSession = Depends(get_db),
) -> dict:
    if not settings.STRIPE_SECRET_KEY:
        return {"invoices": []}

    sub = await billing_service.get_subscription(db, current_user.tenant_id)
    if not sub or not sub.stripe_customer_id:
        return {"invoices": []}

    try:
        import stripe
        stripe.api_key = settings.STRIPE_SECRET_KEY
        invoices = stripe.Invoice.list(customer=sub.stripe_customer_id, limit=10)
        return {
            "invoices": [
                {
                    "id": inv.id,
                    "amount_paid": inv.amount_paid,
                    "currency": inv.currency,
                    "status": inv.status,
                    "period_end": inv.period_end,
                    "hosted_invoice_url": inv.hosted_invoice_url,
                    "invoice_pdf": inv.invoice_pdf,
                }
                for inv in invoices.data
            ]
        }
    except Exception:
        return {"invoices": []}


# ------------------------------------------------------------------
# Stripe 웹훅 (공개)
# ------------------------------------------------------------------

@router_webhook.post("/stripe-webhook")
async def stripe_webhook(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> dict:
    payload = await request.body()
    sig = request.headers.get("stripe-signature", "")
    return await billing_service.handle_stripe_webhook(payload, sig, db)


# ------------------------------------------------------------------
# Free 플랜 테넌트 등록 (self-serve signup 완료 후 호출)
# ------------------------------------------------------------------

@router.post("/signup-free", status_code=status.HTTP_201_CREATED)
async def register_free_plan(
    tenant_slug: str,
    current_user: Annotated[User, Depends(require_roles(UserRole.admin))],
    db: AsyncSession = Depends(get_db),
) -> dict:
    existing = (
        await db.execute(
            select(TenantSubscription).where(
                TenantSubscription.tenant_id == current_user.tenant_id
            )
        )
    ).scalar_one_or_none()

    if not existing:
        db.add(TenantSubscription(
            tenant_id=current_user.tenant_id,
            plan=BillingPlan.free,
            seats_limit=PLAN_LIMITS[BillingPlan.free]["seats"],
            ticket_limit_monthly=PLAN_LIMITS[BillingPlan.free]["tickets_monthly"],
        ))
        await db.commit()

    return {"plan": "free", "registered": True}
