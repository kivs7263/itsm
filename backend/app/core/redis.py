"""Redis 클라이언트 싱글턴.

refresh token 저장: key = refresh:{user_id}:{jti}, TTL = REFRESH_TOKEN_EXPIRE_DAYS * 86400
blacklist: 로그아웃 시 해당 jti 키 삭제
"""
from __future__ import annotations

from typing import Optional

import redis.asyncio as aioredis

from app.core.config import settings

_redis_client: Optional[aioredis.Redis] = None


def get_redis() -> aioredis.Redis:
    """Redis 클라이언트 반환 (싱글턴)."""
    global _redis_client
    if _redis_client is None:
        _redis_client = aioredis.from_url(
            settings.REDIS_URL,
            encoding="utf-8",
            decode_responses=True,
        )
    return _redis_client


async def close_redis() -> None:
    """애플리케이션 종료 시 Redis 연결 해제."""
    global _redis_client
    if _redis_client is not None:
        await _redis_client.aclose()
        _redis_client = None
