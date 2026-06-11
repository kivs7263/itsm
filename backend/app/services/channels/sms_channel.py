"""
Solapi SMS 채널.
SMS_API_KEY 미설정 시 graceful skip.
Solapi API v4: POST https://api.solapi.com/messages/v4/send
인증: HMAC-SHA256 (date + nonce)
"""
from __future__ import annotations

import hashlib
import hmac
import logging
import secrets
import time

import httpx

from app.core.config import settings

_SOLAPI_URL = "https://api.solapi.com/messages/v4/send"
logger = logging.getLogger(__name__)


def _make_auth_header() -> str:
    """HMAC-SHA256 인증 헤더 생성 (date + nonce 서명)."""
    date = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    nonce = secrets.token_hex(16)
    msg = date + nonce
    sig = hmac.new(
        settings.SMS_API_SECRET.encode(),
        msg.encode(),
        hashlib.sha256,
    ).hexdigest()
    return (
        f"HMAC-SHA256 apiKey={settings.SMS_API_KEY},"
        f" date={date},"
        f" salt={nonce},"
        f" signature={sig}"
    )


async def send_sms(to: str, text: str) -> bool:
    """SMS 발송. 성공 True / 실패·미설정 False."""
    if not settings.SMS_API_KEY or not settings.SMS_API_SECRET or not settings.SMS_FROM_NUMBER:
        return False
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                _SOLAPI_URL,
                headers={
                    "Content-Type": "application/json",
                    "Authorization": _make_auth_header(),
                },
                json={
                    "message": {
                        "to": to,
                        "from": settings.SMS_FROM_NUMBER,
                        "text": text,
                    }
                },
            )
        if resp.status_code in (200, 201):
            return True
        logger.warning(
            "Solapi SMS 실패: status=%s body=%s",
            resp.status_code,
            resp.text[:200],
        )
        return False
    except Exception as exc:
        logger.warning("Solapi SMS 예외: %s", exc)
        return False
