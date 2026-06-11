"""GW 결재 연동 서비스 — KC client credentials + GW external bridge.

GW_BACKEND_URL 미설정 시 모든 함수 graceful None 반환.
KC_TOKEN_URL 미설정 시 graceful None 반환.
KC 토큰 캐시: 모듈 레벨 dict (_kc_token_cache) — expires_at 기준 30초 여유 만료.
"""
from __future__ import annotations

import logging
import time

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

# 모듈 레벨 토큰 캐시
_kc_token_cache: dict[str, float | str] = {
    "access_token": "",
    "expires_at": 0.0,
}

_TOKEN_EXPIRY_BUFFER = 30  # 만료 30초 전 재발급


async def _get_kc_token() -> str | None:
    """KC client credentials grant로 Bearer 토큰 취득 (캐시).

    Returns:
        access_token 문자열. 미설정 또는 실패 시 None.
    """
    if not settings.KC_TOKEN_URL:
        return None

    now = time.time()
    cached_token = _kc_token_cache.get("access_token", "")
    cached_expires = _kc_token_cache.get("expires_at", 0.0)

    # 유효한 캐시가 있으면 바로 반환
    if cached_token and isinstance(cached_expires, float) and now < cached_expires:
        return str(cached_token)

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                settings.KC_TOKEN_URL,
                data={
                    "grant_type": "client_credentials",
                    "client_id": settings.KC_SERVICE_CLIENT_ID,
                    "client_secret": settings.KC_SERVICE_CLIENT_SECRET,
                },
            )
            resp.raise_for_status()
            data = resp.json()

        access_token: str = data["access_token"]
        expires_in: int = int(data.get("expires_in", 300))

        _kc_token_cache["access_token"] = access_token
        _kc_token_cache["expires_at"] = now + expires_in - _TOKEN_EXPIRY_BUFFER

        return access_token

    except httpx.HTTPStatusError as exc:
        logger.error(
            "KC 토큰 발급 실패 (HTTP %s): %s",
            exc.response.status_code,
            exc.response.text[:200],
        )
        return None
    except Exception as exc:
        logger.error("KC 토큰 발급 중 오류: %s", type(exc).__name__)
        return None


async def submit_approval_draft(
    requester_email: str,
    title: str,
    content_text: str,
) -> dict | None:
    """GW external 엔드포인트로 결재 기안 제출.

    Args:
        requester_email: 기안자 이메일
        title: 결재 제목
        content_text: 결재 내용

    Returns:
        GW 응답 dict {id, title, status} 또는 None (미설정/실패 시).
    """
    if not settings.GW_BACKEND_URL:
        return None
    if not settings.KC_TOKEN_URL:
        return None

    token = await _get_kc_token()
    if token is None:
        return None

    url = f"{settings.GW_BACKEND_URL}/api/approvals/external/draft"
    payload = {
        "requester_email": requester_email,
        "title": title,
        "content_text": content_text,
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                url,
                json=payload,
                headers={"Authorization": f"Bearer {token}"},
            )

        if resp.status_code == 201:
            return resp.json()

        logger.error(
            "GW 결재 기안 제출 실패 (HTTP %s): %s",
            resp.status_code,
            resp.text[:200],
        )
        return None

    except httpx.HTTPStatusError as exc:
        logger.error(
            "GW 결재 기안 제출 HTTP 오류 (%s): %s",
            exc.response.status_code,
            exc.response.text[:200],
        )
        return None
    except Exception as exc:
        logger.error("GW 결재 기안 제출 중 오류: %s", type(exc).__name__)
        return None


async def get_approval_status(
    requester_email: str,
    gw_doc_id: str,
) -> str | None:
    """GW external 엔드포인트에서 결재 상태 조회.

    Args:
        requester_email: 조회 대상 사용자 이메일
        gw_doc_id: GW 결재 문서 ID (str)

    Returns:
        status 문자열 또는 None (미설정/실패/미발견 시).
    """
    if not settings.GW_BACKEND_URL:
        return None
    if not settings.KC_TOKEN_URL:
        return None

    token = await _get_kc_token()
    if token is None:
        return None

    url = f"{settings.GW_BACKEND_URL}/api/approvals/external"
    params = {"user_email": requester_email, "status": "all"}

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                url,
                params=params,
                headers={"Authorization": f"Bearer {token}"},
            )

        if resp.status_code != 200:
            logger.error(
                "GW 결재 상태 조회 실패 (HTTP %s): %s",
                resp.status_code,
                resp.text[:200],
            )
            return None

        data = resp.json()
        # 응답이 목록이거나 {"items": [...]} 구조 모두 처리
        items: list = data if isinstance(data, list) else data.get("items", [])

        for item in items:
            doc_id = item.get("id") or item.get("doc_id")
            if str(doc_id) == str(gw_doc_id):
                return item.get("status")

        return None

    except Exception as exc:
        logger.error("GW 결재 상태 조회 중 오류: %s", type(exc).__name__)
        return None
