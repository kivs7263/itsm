"""Webhook 엔드포인트 관리 라우터.

prefix : /api/{tenant_slug}/settings/webhooks
권한   : admin 전용

엔드포인트:
  GET    /settings/webhooks              — 목록
  POST   /settings/webhooks              — 등록 (secret 자동 생성)
  PATCH  /settings/webhooks/{id}         — 수정 (url/events/is_active)
  DELETE /settings/webhooks/{id}         — 삭제
  POST   /settings/webhooks/{id}/test    — 테스트 발송
  GET    /settings/webhooks/{id}/logs    — 최근 10건 이력
"""
from __future__ import annotations

import secrets
import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, HttpUrl
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import require_roles
from app.models.user import User, UserRole
from app.models.webhook import WebhookDeliveryLog, WebhookEndpoint

router = APIRouter(
    prefix="/{tenant_slug}/settings/webhooks",
    tags=["webhooks"],
)

_ALLOWED_EVENTS = {
    "ticket.created",
    "ticket.status_changed",
    "ticket.assigned",
    "ticket.escalated",
    "csat.submitted",
}


# ------------------------------------------------------------------
# 스키마
# ------------------------------------------------------------------

class WebhookCreate(BaseModel):
    url: str = Field(..., max_length=500)
    events: list[str] = Field(default_factory=list)


class WebhookUpdate(BaseModel):
    url: str | None = Field(None, max_length=500)
    events: list[str] | None = None
    is_active: bool | None = None


class WebhookOut(BaseModel):
    id: uuid.UUID
    url: str
    events: list[str]
    secret: str
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class DeliveryLogOut(BaseModel):
    id: uuid.UUID
    event_type: str
    status: str
    http_status: int | None
    attempt_count: int
    delivered_at: datetime | None
    created_at: datetime

    model_config = {"from_attributes": True}


# ------------------------------------------------------------------
# 목록
# ------------------------------------------------------------------

@router.get("", response_model=list[WebhookOut])
async def list_webhooks(
    tenant_slug: str,
    current_user: Annotated[User, Depends(require_roles(UserRole.admin))],
    db: AsyncSession = Depends(get_db),
) -> list[WebhookOut]:
    rows = (
        await db.execute(
            select(WebhookEndpoint)
            .where(WebhookEndpoint.tenant_id == current_user.tenant_id)
            .order_by(WebhookEndpoint.created_at.desc())
        )
    ).scalars().all()
    return [WebhookOut.model_validate(r) for r in rows]


# ------------------------------------------------------------------
# 등록
# ------------------------------------------------------------------

@router.post("", response_model=WebhookOut, status_code=status.HTTP_201_CREATED)
async def create_webhook(
    tenant_slug: str,
    data: WebhookCreate,
    current_user: Annotated[User, Depends(require_roles(UserRole.admin))],
    db: AsyncSession = Depends(get_db),
) -> WebhookOut:
    invalid = [e for e in data.events if e not in _ALLOWED_EVENTS]
    if invalid:
        raise HTTPException(400, detail=f"유효하지 않은 이벤트: {invalid}")

    endpoint = WebhookEndpoint(
        id=uuid.uuid4(),
        tenant_id=current_user.tenant_id,
        url=data.url,
        events=data.events,
        secret=secrets.token_hex(32),
    )
    db.add(endpoint)
    await db.commit()
    await db.refresh(endpoint)
    return WebhookOut.model_validate(endpoint)


# ------------------------------------------------------------------
# 수정
# ------------------------------------------------------------------

@router.patch("/{endpoint_id}", response_model=WebhookOut)
async def update_webhook(
    tenant_slug: str,
    endpoint_id: uuid.UUID,
    data: WebhookUpdate,
    current_user: Annotated[User, Depends(require_roles(UserRole.admin))],
    db: AsyncSession = Depends(get_db),
) -> WebhookOut:
    endpoint = await _get_or_404(db, current_user.tenant_id, endpoint_id)

    if data.url is not None:
        endpoint.url = data.url
    if data.events is not None:
        invalid = [e for e in data.events if e not in _ALLOWED_EVENTS]
        if invalid:
            raise HTTPException(400, detail=f"유효하지 않은 이벤트: {invalid}")
        endpoint.events = data.events
    if data.is_active is not None:
        endpoint.is_active = data.is_active

    await db.commit()
    await db.refresh(endpoint)
    return WebhookOut.model_validate(endpoint)


# ------------------------------------------------------------------
# 삭제
# ------------------------------------------------------------------

@router.delete("/{endpoint_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_webhook(
    tenant_slug: str,
    endpoint_id: uuid.UUID,
    current_user: Annotated[User, Depends(require_roles(UserRole.admin))],
    db: AsyncSession = Depends(get_db),
) -> None:
    endpoint = await _get_or_404(db, current_user.tenant_id, endpoint_id)
    await db.delete(endpoint)
    await db.commit()


# ------------------------------------------------------------------
# 테스트 발송
# ------------------------------------------------------------------

@router.post("/{endpoint_id}/test", response_model=dict)
async def test_webhook(
    tenant_slug: str,
    endpoint_id: uuid.UUID,
    current_user: Annotated[User, Depends(require_roles(UserRole.admin))],
    db: AsyncSession = Depends(get_db),
) -> dict:
    endpoint = await _get_or_404(db, current_user.tenant_id, endpoint_id)

    from app.services import webhook_service
    await webhook_service._deliver(
        event_type="webhook.test",
        payload={"message": "ITSM Webhook 테스트 메시지입니다."},
        endpoint=endpoint,
        db=db,
    )
    return {"ok": True}


# ------------------------------------------------------------------
# 최근 발송 이력 (10건)
# ------------------------------------------------------------------

@router.get("/{endpoint_id}/logs", response_model=list[DeliveryLogOut])
async def get_webhook_logs(
    tenant_slug: str,
    endpoint_id: uuid.UUID,
    current_user: Annotated[User, Depends(require_roles(UserRole.admin))],
    db: AsyncSession = Depends(get_db),
) -> list[DeliveryLogOut]:
    await _get_or_404(db, current_user.tenant_id, endpoint_id)

    rows = (
        await db.execute(
            select(WebhookDeliveryLog)
            .where(WebhookDeliveryLog.endpoint_id == endpoint_id)
            .order_by(WebhookDeliveryLog.created_at.desc())
            .limit(10)
        )
    ).scalars().all()
    return [DeliveryLogOut.model_validate(r) for r in rows]


# ------------------------------------------------------------------
# 내부 헬퍼
# ------------------------------------------------------------------

async def _get_or_404(
    db: AsyncSession, tenant_id: uuid.UUID, endpoint_id: uuid.UUID
) -> WebhookEndpoint:
    row = (
        await db.execute(
            select(WebhookEndpoint).where(
                WebhookEndpoint.id == endpoint_id,
                WebhookEndpoint.tenant_id == tenant_id,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="웹훅 엔드포인트를 찾을 수 없습니다.")
    return row
