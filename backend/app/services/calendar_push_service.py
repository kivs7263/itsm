"""ITSM → calendar-service 이벤트 push 서비스.

설계 원칙:
  - CALENDAR_SERVICE_URL 미설정 시 완전 스킵 (graceful fallback)
  - organization_id 또는 assignee_id 미설정 시 push 스킵
  - HTTP 실패·타임아웃은 WARNING 로그만, 메인 로직에 영향 없음
  - push 실패해도 ITSM 이벤트 저장은 성공 처리
  - str(exc) 클라이언트 반환 금지 — 로그에만

환경변수:
  - CALENDAR_SERVICE_URL : calendar-service base URL (빈 문자열이면 비활성)
                           예) http://cal_nginx
  - SERVICE_BUS_SECRET   : X-Internal-Secret 헤더 인증값

push endpoint  : POST   {CALENDAR_SERVICE_URL}/api/v1/external/events
delete endpoint: DELETE {CALENDAR_SERVICE_URL}/api/v1/external/events/itsm/{entity_id}
"""
from __future__ import annotations

import logging
import uuid

import httpx

from app.core.config import settings
from app.models.calendar_event import CalendarEvent

logger = logging.getLogger(__name__)

_TIMEOUT_SECONDS = 5.0

# event_type → calendar-service entity_type 매핑
ENTITY_TYPES: dict[str, str] = {
    "visit": "visit",
    "remote": "remote_support",
    "internal": "meeting",
}

# event_type → 표시 색상 (calendar-service 측 color 필드용)
EVENT_COLORS: dict[str, str] = {
    "visit": "#3B82F6",     # 파랑
    "remote": "#F97316",    # 주황
    "internal": "#22C55E",  # 초록
}


def _make_headers() -> dict[str, str]:
    return {
        "x-internal-secret": settings.SERVICE_BUS_SECRET,
        "x-service-name": "itsm",
        "Content-Type": "application/json",
    }


async def push_event(event: CalendarEvent) -> uuid.UUID | None:
    """calendar-service에 이벤트 push.

    Returns:
        calendar-service에서 발급한 이벤트 UUID (push 성공 시)
        None (CALENDAR_SERVICE_URL 미설정, 필수 필드 누락, HTTP 오류 시)
    """
    if not settings.CALENDAR_SERVICE_URL:
        return None

    if not event.organization_id or not event.assignee_id:
        logger.debug(
            "calendar push 스킵 — organization_id 또는 assignee_id 미설정: event_id=%s",
            event.id,
        )
        return None

    payload: dict = {
        "service_name": "itsm",
        "entity_type": ENTITY_TYPES.get(event.event_type, "meeting"),
        "entity_id": str(event.id),
        "title": event.title,
        "start_at": event.start_at.isoformat(),
        "end_at": event.end_at.isoformat() if event.end_at else None,
        "is_all_day": event.is_all_day,
        "source": "itsm",
        "description": event.description,
        "organization_id": str(event.organization_id),
        "user_id": str(event.assignee_id),
        "deep_link_url": None,
    }

    url = f"{settings.CALENDAR_SERVICE_URL.rstrip('/')}/api/v1/external/events"
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT_SECONDS) as client:
            resp = await client.post(url, json=payload, headers=_make_headers())
        if resp.status_code in (200, 201):
            data = resp.json()
            cal_id = data.get("id")
            if cal_id:
                return uuid.UUID(cal_id)
            logger.warning(
                "calendar push 응답에 id 없음: event_id=%s status=%d",
                event.id, resp.status_code,
            )
        else:
            logger.warning(
                "calendar push 응답 오류: event_id=%s status=%d",
                event.id, resp.status_code,
            )
    except httpx.TimeoutException:
        logger.warning(
            "calendar push 타임아웃 (%.1fs): event_id=%s", _TIMEOUT_SECONDS, event.id,
        )
    except httpx.ConnectError:
        logger.warning(
            "calendar push 연결 실패: event_id=%s url=%s",
            event.id, settings.CALENDAR_SERVICE_URL,
        )
    except Exception:
        # 예외 메시지는 클라이언트에 노출 금지 — exc_info=True로 스택 트레이스만 보존
        logger.warning("calendar push 예외: event_id=%s", event.id, exc_info=True)

    return None


async def delete_event(cal_event_id: uuid.UUID, organization_id: uuid.UUID) -> bool:
    """calendar-service에서 ITSM 이벤트 삭제.

    Returns:
        True (성공 또는 이미 없음) / False (HTTP 오류, 연결 실패)
    """
    if not settings.CALENDAR_SERVICE_URL:
        return True  # 비활성 상태에서는 삭제 성공으로 처리

    url = (
        f"{settings.CALENDAR_SERVICE_URL.rstrip('/')}"
        f"/api/v1/external/events/itsm/{cal_event_id}"
    )
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT_SECONDS) as client:
            resp = await client.delete(url, headers=_make_headers())
        if resp.status_code in (200, 204, 404):
            # 404 = 이미 없는 이벤트 → 성공으로 처리
            return True
        logger.warning(
            "calendar delete 응답 오류: cal_event_id=%s status=%d",
            cal_event_id, resp.status_code,
        )
    except httpx.TimeoutException:
        logger.warning(
            "calendar delete 타임아웃 (%.1fs): cal_event_id=%s",
            _TIMEOUT_SECONDS, cal_event_id,
        )
    except httpx.ConnectError:
        logger.warning(
            "calendar delete 연결 실패: cal_event_id=%s url=%s",
            cal_event_id, settings.CALENDAR_SERVICE_URL,
        )
    except Exception:
        logger.warning("calendar delete 예외: cal_event_id=%s", cal_event_id, exc_info=True)

    return False
