"""IMAP 폴링 워커 — 받은편지함 새 메일 → ITSM 티켓 자동 생성.

- imaplib (표준 라이브러리) 사용 (SSL: IMAP4_SSL)
- 처리한 메일에 \\Seen 플래그 설정 (중복 방지)
- 메일 파싱: subject → title, text/plain body → description
- 티켓 생성: channel="email", priority="medium", status="open"
- 설정 우선순위: DB email_inbound_configs (활성화된 것) > 환경변수 fallback
- DB 설정 없고 IMAP_HOST 환경변수도 없으면 조용히 sleep
"""
from __future__ import annotations

import asyncio
import email
import imaplib
import logging
import signal
from datetime import datetime, timezone
from email.header import decode_header, make_header

from sqlalchemy import text

from app.core.config import settings
from app.core.database import AsyncSessionLocal, engine

logger = logging.getLogger(__name__)

_running = True


def _handle_signal(sig: int, _frame) -> None:
    global _running
    logger.info("Email worker shutting down (signal %s)", sig)
    _running = False


# ---------------------------------------------------------------------------
# IMAP helpers (동기 — imaplib은 동기 라이브러리)
# ---------------------------------------------------------------------------


def _decode_str(raw: bytes | str | None) -> str:
    """RFC2047 인코딩된 헤더 문자열을 디코딩."""
    if raw is None:
        return ""
    if isinstance(raw, bytes):
        raw = raw.decode("utf-8", errors="replace")
    try:
        return str(make_header(decode_header(raw)))
    except Exception:
        return raw


def _extract_plain_body(msg: email.message.Message) -> str:
    """multipart 메시지에서 text/plain 파트 추출."""
    if msg.is_multipart():
        for part in msg.walk():
            if part.get_content_type() == "text/plain":
                charset = part.get_content_charset() or "utf-8"
                payload = part.get_payload(decode=True)
                if payload:
                    return payload.decode(charset, errors="replace")
        return ""
    else:
        payload = msg.get_payload(decode=True)
        if payload:
            charset = msg.get_content_charset() or "utf-8"
            return payload.decode(charset, errors="replace")
        return ""


def _fetch_unseen_emails(
    host: str,
    port: int,
    user: str,
    password: str,
    folder: str = "INBOX",
) -> list[dict]:
    """IMAP에서 UNSEEN 메일 목록을 동기 방식으로 읽어 반환.

    반환값: [{"uid": bytes, "subject": str, "body": str, "from": str}, ...]
    """
    imap = imaplib.IMAP4_SSL(host, port)
    try:
        imap.login(user, password)
        imap.select(folder)

        status, data = imap.search(None, "UNSEEN")
        if status != "OK" or not data or not data[0]:
            return []

        uid_list = data[0].split()
        results: list[dict] = []

        for uid in uid_list:
            try:
                status, msg_data = imap.fetch(uid, "(RFC822)")
                if status != "OK" or not msg_data or not msg_data[0]:
                    continue
                raw = msg_data[0][1]
                msg = email.message_from_bytes(raw)

                subject = _decode_str(msg.get("Subject", ""))
                from_addr = _decode_str(msg.get("From", ""))
                body = _extract_plain_body(msg)

                results.append({
                    "uid": uid,
                    "subject": subject or "(제목 없음)",
                    "body": body,
                    "from": from_addr,
                })

                # Seen 플래그 설정 (중복 방지)
                imap.store(uid, "+FLAGS", "\\Seen")

            except Exception:
                logger.exception("메일 파싱 오류 (uid=%s), 건너뜀", uid)
                continue

        return results

    finally:
        try:
            imap.logout()
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Async DB logic
# ---------------------------------------------------------------------------


async def _get_tenant_id(slug: str) -> str | None:
    """IMAP_TENANT_SLUG → tenants.id 조회. 없으면 None."""
    async with AsyncSessionLocal() as session:
        row = await session.execute(
            text("SELECT id FROM tenants WHERE slug = :slug LIMIT 1"),
            {"slug": slug},
        )
        result = row.fetchone()
        return str(result.id) if result else None


async def _get_db_configs() -> list[dict]:
    """DB에서 활성화된 email_inbound_configs 전체 조회."""
    try:
        async with AsyncSessionLocal() as session:
            rows = (
                await session.execute(
                    text("""
                        SELECT id, tenant_id, imap_host, imap_port, imap_user,
                               imap_password_enc, imap_folder
                        FROM email_inbound_configs
                        WHERE is_active = TRUE
                    """)
                )
            ).fetchall()
            return [
                {
                    "id": str(r.id),
                    "tenant_id": str(r.tenant_id),
                    "imap_host": r.imap_host,
                    "imap_port": r.imap_port,
                    "imap_user": r.imap_user,
                    "imap_password_enc": r.imap_password_enc,
                    "imap_folder": r.imap_folder,
                }
                for r in rows
            ]
    except Exception:
        logger.exception("email_inbound_configs 조회 실패")
        return []


async def _update_config_status(cfg_id: str, error: str | None) -> None:
    """last_checked_at + last_error 갱신."""
    try:
        async with AsyncSessionLocal() as session:
            await session.execute(
                text("""
                    UPDATE email_inbound_configs
                    SET last_checked_at = :now, last_error = :err
                    WHERE id = :id
                """),
                {"now": datetime.now(timezone.utc), "err": error, "id": cfg_id},
            )
            await session.commit()
    except Exception:
        logger.exception("email_inbound_configs 상태 갱신 실패")


async def _insert_ticket(
    tenant_id: str,
    title: str,
    description: str,
) -> str:
    """tickets 테이블에 이메일 채널 티켓 INSERT."""
    async with AsyncSessionLocal() as session:
        row = await session.execute(
            text("""
                INSERT INTO tickets (
                    id, tenant_id, title, description,
                    priority, status, channel,
                    created_at, updated_at
                )
                VALUES (
                    gen_random_uuid(), :tenant_id, :title, :description,
                    'medium', 'open', 'email',
                    now(), now()
                )
                RETURNING id
            """),
            {
                "tenant_id": tenant_id,
                "title": title[:500],
                "description": description or None,
            },
        )
        ticket_id = str(row.fetchone().id)
        await session.commit()
        return ticket_id


async def _process_one_config(cfg: dict, password: str) -> None:
    """단일 IMAP 설정으로 폴링 → 티켓 생성."""
    loop = asyncio.get_event_loop()
    try:
        mails = await loop.run_in_executor(
            None,
            _fetch_unseen_emails,
            cfg["imap_host"],
            cfg["imap_port"],
            cfg["imap_user"],
            password,
            cfg["imap_folder"],
        )
    except Exception as e:
        logger.exception("IMAP 연결/폴링 오류 (tenant=%s)", cfg["tenant_id"])
        await _update_config_status(cfg["id"], str(e))
        return

    if not mails:
        await _update_config_status(cfg["id"], None)
        return

    logger.info("UNSEEN 메일 %d건 처리 (tenant=%s)", len(mails), cfg["tenant_id"])
    for mail in mails:
        try:
            ticket_id = await _insert_ticket(
                tenant_id=cfg["tenant_id"],
                title=mail["subject"],
                description=mail["body"],
            )
            logger.info(
                "이메일 티켓 생성: ticket_id=%s subject=%r from=%s",
                ticket_id,
                mail["subject"][:80],
                mail["from"][:100],
            )
        except Exception:
            logger.exception("티켓 INSERT 오류 (subject=%r), 건너뜀", mail["subject"][:80])

    await _update_config_status(cfg["id"], None)


async def _fetch_and_create_tickets() -> None:
    """DB 설정 + 환경변수 fallback으로 IMAP 폴링 → 티켓 생성."""
    from app.services.crypto import decrypt_value

    # 1) DB에서 활성 설정 조회
    db_configs = await _get_db_configs()

    if db_configs:
        for cfg in db_configs:
            password = decrypt_value(cfg["imap_password_enc"])
            if not password:
                logger.warning("비밀번호 복호화 실패 (tenant=%s), 건너뜀", cfg["tenant_id"])
                continue
            await _process_one_config(cfg, password)
        return

    # 2) DB 설정 없음 → 환경변수 fallback
    if not (settings.IMAP_HOST and settings.IMAP_USER and settings.IMAP_PASSWORD):
        logger.debug("IMAP 미설정, 건너뜀")
        return

    if not settings.IMAP_TENANT_SLUG:
        logger.warning("IMAP_TENANT_SLUG 미설정, 건너뜀")
        return

    tenant_id = await _get_tenant_id(settings.IMAP_TENANT_SLUG)
    if not tenant_id:
        logger.warning("IMAP_TENANT_SLUG=%r 에 해당하는 테넌트 없음, 건너뜀", settings.IMAP_TENANT_SLUG)
        return

    env_cfg = {
        "id": "env-fallback",
        "tenant_id": tenant_id,
        "imap_host": settings.IMAP_HOST,
        "imap_port": settings.IMAP_PORT,
        "imap_user": settings.IMAP_USER,
        "imap_folder": settings.IMAP_FOLDER,
    }
    await _process_one_config(env_cfg, settings.IMAP_PASSWORD)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


async def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    signal.signal(signal.SIGTERM, _handle_signal)
    signal.signal(signal.SIGINT, _handle_signal)

    logger.info(
        "Email worker starting (interval=%ds) — DB 설정 우선, 환경변수 fallback",
        settings.EMAIL_INTERVAL_SECONDS,
    )

    try:
        while _running:
            try:
                await _fetch_and_create_tickets()
            except Exception:
                logger.exception("이메일 폴링 오류")
            await asyncio.sleep(settings.EMAIL_INTERVAL_SECONDS)
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
