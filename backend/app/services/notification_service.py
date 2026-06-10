"""티켓 이벤트 → Slack / Teams 웹훅 알림.

트리거:
- 티켓 생성:    "새 티켓 #{id} — {title} ({priority})"
- 상태 변경:    "티켓 #{id} 상태 변경: {old} → {new}"
- SLA breach:   "⚠️ SLA 초과: 티켓 #{id} — {title} (응답시간 초과)"

모든 함수: 오류 시 로그만, 예외 미전파 (graceful).
SLACK_WEBHOOK_URL / TEAMS_WEBHOOK_URL 미설정 시 해당 채널 no-op.
"""
from __future__ import annotations

import logging

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

_HTTPX_TIMEOUT = 10.0  # seconds


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


async def notify_ticket_created(
    ticket_id: str,
    title: str,
    priority: str,
    tenant_slug: str,
) -> None:
    """티켓 생성 시 Slack / Teams 알림."""
    text = f"[{tenant_slug}] 새 티켓 #{ticket_id} — {title} ({priority})"
    await _broadcast(text)


async def notify_status_changed(
    ticket_id: str,
    title: str,
    old_status: str,
    new_status: str,
    tenant_slug: str,
) -> None:
    """티켓 상태 변경 시 알림."""
    text = f"[{tenant_slug}] 티켓 #{ticket_id} 상태 변경: {old_status} → {new_status} — {title}"
    await _broadcast(text)


async def notify_sla_breach(
    ticket_id: str,
    title: str,
    tenant_slug: str,
) -> None:
    """SLA breach 시 알림."""
    text = f"[{tenant_slug}] ⚠️ SLA 초과: 티켓 #{ticket_id} — {title} (응답시간 초과)"
    await _broadcast(text)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


async def _broadcast(text: str) -> None:
    """설정된 모든 채널로 알림 전송."""
    await _send_slack(text)
    await _send_teams(text)


async def _send_slack(text: str) -> None:
    """SLACK_WEBHOOK_URL로 POST. 미설정이면 skip."""
    if not settings.SLACK_WEBHOOK_URL:
        return
    try:
        async with httpx.AsyncClient(timeout=_HTTPX_TIMEOUT) as client:
            resp = await client.post(
                settings.SLACK_WEBHOOK_URL,
                json={"text": text},
            )
            if resp.status_code != 200:
                logger.warning(
                    "Slack 알림 실패: status=%d body=%s",
                    resp.status_code,
                    resp.text[:200],
                )
    except Exception:
        logger.exception("Slack 알림 오류 (text=%s)", text[:100])


async def _send_teams(text: str) -> None:
    """TEAMS_WEBHOOK_URL로 POST. 미설정이면 skip."""
    if not settings.TEAMS_WEBHOOK_URL:
        return
    try:
        async with httpx.AsyncClient(timeout=_HTTPX_TIMEOUT) as client:
            resp = await client.post(
                settings.TEAMS_WEBHOOK_URL,
                json={"text": text},
            )
            if resp.status_code not in (200, 202):
                logger.warning(
                    "Teams 알림 실패: status=%d body=%s",
                    resp.status_code,
                    resp.text[:200],
                )
    except Exception:
        logger.exception("Teams 알림 오류 (text=%s)", text[:100])
