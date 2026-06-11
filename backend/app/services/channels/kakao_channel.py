"""
카카오 알림톡 채널.
KAKAO_API_KEY 또는 KAKAO_SENDER_KEY 미설정 시 graceful skip.
Kakao Bizm API v2: POST https://alimtalk-api.biz.m.me/v2/sender/send
"""
from __future__ import annotations

import logging

import httpx

from app.core.config import settings

_KAKAO_URL = "https://alimtalk-api.biz.m.me/v2/sender/send"
logger = logging.getLogger(__name__)


async def send_alimtalk(
    to: str,            # 수신자 전화번호 (01012345678)
    template_code: str, # 카카오 템플릿 코드
    variables: dict,    # {#{변수명}: 값} 매핑
) -> bool:
    """알림톡 발송. 성공 True / 실패·미설정 False."""
    if not settings.KAKAO_API_KEY or not settings.KAKAO_SENDER_KEY:
        return False
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                _KAKAO_URL,
                headers={
                    "Content-Type": "application/json",
                    "apiKey": settings.KAKAO_API_KEY,
                },
                json={
                    "senderKey": settings.KAKAO_SENDER_KEY,
                    "templateCode": template_code,
                    "messages": [{"to": to, "variables": variables}],
                },
            )
        if resp.status_code in (200, 201):
            return True
        logger.warning(
            "카카오 알림톡 실패: status=%s body=%s",
            resp.status_code,
            resp.text[:200],
        )
        return False
    except Exception as exc:
        logger.warning("카카오 알림톡 예외: %s", exc)
        return False
