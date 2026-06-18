"""Webhook 발송 서비스.

이벤트 타입:
  ticket.created / ticket.status_changed / ticket.assigned
  ticket.escalated / csat.submitted

HMAC-SHA256 서명을 X-ITSM-Signature 헤더에 포함.
최대 3회 재시도, 지수 백오프(1s, 2s, 4s).
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging
import uuid
from datetime import datetime, timezone

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.webhook import WebhookEndpoint, WebhookDeliveryLog

logger = logging.getLogger(__name__)

_MAX_ATTEMPTS = 3
_BACKOFF_BASE = 1.0  # seconds


def _sign(secret: str, body: bytes) -> str:
    return hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


async def fire(
    event_type: str,
    payload: dict,
    tenant_id: uuid.UUID,
    db: AsyncSession,
) -> None:
    """활성 엔드포인트에 이벤트를 비동기로 발송한다 (fire-and-forget)."""
    rows = (
        await db.execute(
            select(WebhookEndpoint).where(
                WebhookEndpoint.tenant_id == tenant_id,
                WebhookEndpoint.is_active.is_(True),
            )
        )
    ).scalars().all()

    endpoints = [r for r in rows if event_type in (r.events or [])]
    if not endpoints:
        return

    for endpoint in endpoints:
        asyncio.create_task(_deliver(event_type, payload, endpoint, db))


async def _deliver(
    event_type: str,
    payload: dict,
    endpoint: WebhookEndpoint,
    db: AsyncSession,
) -> None:
    body_dict = {
        "event": event_type,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "data": payload,
    }
    body_bytes = json.dumps(body_dict, ensure_ascii=False).encode()
    signature = _sign(endpoint.secret, body_bytes)

    log = WebhookDeliveryLog(
        id=uuid.uuid4(),
        endpoint_id=endpoint.id,
        event_type=event_type,
        payload=body_dict,
        status="pending",
        attempt_count=0,
    )
    db.add(log)
    await db.commit()

    last_exc: Exception | None = None
    for attempt in range(_MAX_ATTEMPTS):
        log.attempt_count = attempt + 1
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(
                    endpoint.url,
                    content=body_bytes,
                    headers={
                        "Content-Type": "application/json",
                        "X-ITSM-Signature": f"sha256={signature}",
                        "X-ITSM-Event": event_type,
                    },
                )
            log.http_status = resp.status_code
            log.response_body = resp.text[:500] if resp.text else None
            if resp.status_code < 300:
                log.status = "success"
                log.delivered_at = datetime.now(timezone.utc)
                break
            else:
                log.status = "failed"
                last_exc = None
        except Exception as exc:
            last_exc = exc
            log.status = "failed"
            log.response_body = str(exc)[:500]

        if attempt < _MAX_ATTEMPTS - 1:
            await asyncio.sleep(_BACKOFF_BASE * (2 ** attempt))

    if log.status != "success":
        logger.warning(
            "webhook delivery failed endpoint=%s event=%s attempts=%d err=%s",
            endpoint.id, event_type, log.attempt_count, last_exc,
        )

    await db.commit()
