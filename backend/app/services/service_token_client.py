"""ITSM 서비스 토큰 클라이언트 — KC client_credentials grant (ADR-051 §2.6.2).

gw_approval_service._get_kc_token() 재사용으로 캐시 중복 없이 동일 토큰 캐시 사용.
KC_SERVICE_CLIENT_ID=itsm-svc / KC_SERVICE_CLIENT_SECRET / KC_TOKEN_URL
세 가지 모두 설정돼 있어야 토큰 발급 가능 (gw_approval_service.py 참조).
"""
from __future__ import annotations

from app.services.gw_approval_service import _get_kc_token


async def get_service_headers() -> dict[str, str]:
    """itsm-svc KC 서비스 토큰으로 Authorization 헤더 반환.

    gw_approval_service._get_kc_token() 을 직접 재사용하므로
    모듈 레벨 캐시(_kc_token_cache)가 공유된다 — KC 토큰 발급 중복 없음.

    Returns:
        {"Authorization": "Bearer <token>", "X-Service-Name": "itsm-svc"}

    Raises:
        RuntimeError: KC_TOKEN_URL 또는 KC_SERVICE_CLIENT_SECRET 미설정 / 발급 실패 시.
    """
    token = await _get_kc_token()
    if not token:
        raise RuntimeError("itsm-svc 토큰 발급 불가 (KC_TOKEN_URL/KC_SERVICE_CLIENT_SECRET 미설정)")
    return {"Authorization": f"Bearer {token}", "X-Service-Name": "itsm-svc"}
