"""SMTP 이메일 채널 — 고객 외부 알림 (ESC-3).

테넌트별 SMTP 설정 미구성 시 graceful skip (False 반환, 예외 없음).
"""
from __future__ import annotations

import logging

import aiosmtplib
from email.message import EmailMessage

logger = logging.getLogger(__name__)


async def send_email(
    *,
    smtp_host: str,
    smtp_port: int,
    smtp_user: str | None,
    smtp_password: str | None,
    smtp_use_tls: bool,
    from_email: str,
    from_name: str | None,
    to: str,
    subject: str,
    html_body: str,
    text_body: str | None = None,
) -> tuple[bool, str | None]:
    """이메일 발송. 반환: (성공 여부, 실패 사유 또는 None)."""
    if not smtp_host or not from_email:
        return False, "SMTP 미설정"

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = f"{from_name} <{from_email}>" if from_name else from_email
    msg["To"] = to
    msg.set_content(text_body or _strip_html(html_body))
    msg.add_alternative(html_body, subtype="html")

    try:
        if smtp_port == 465:
            await aiosmtplib.send(
                msg,
                hostname=smtp_host,
                port=smtp_port,
                username=smtp_user or None,
                password=smtp_password or None,
                use_tls=True,
                timeout=15,
            )
        else:
            await aiosmtplib.send(
                msg,
                hostname=smtp_host,
                port=smtp_port,
                username=smtp_user or None,
                password=smtp_password or None,
                start_tls=smtp_use_tls,
                timeout=15,
            )
        return True, None
    except Exception as exc:
        logger.warning("SMTP 발송 실패: host=%s to=%s exc=%s", smtp_host, to, exc)
        return False, str(exc)[:500]


def _strip_html(html: str) -> str:
    """매우 단순한 텍스트 fallback — 태그 제거."""
    import re
    return re.sub(r"<[^>]+>", "", html).strip()
