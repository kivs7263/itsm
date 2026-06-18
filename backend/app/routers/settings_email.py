"""IMAP 수신 설정 라우터 (ONB-2).

prefix: /{tenant_slug}/settings/email-inbound

엔드포인트:
  GET  /api/{slug}/settings/email-inbound        — 설정 조회 (비밀번호 마스킹)
  PUT  /api/{slug}/settings/email-inbound        — 설정 저장 (Fernet 암호화)
  POST /api/{slug}/settings/email-inbound/test   — IMAP 연결 테스트
"""
from __future__ import annotations

import imaplib
import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import require_roles
from app.models.email_inbound_config import EmailInboundConfig
from app.models.user import User, UserRole
from app.services.crypto import decrypt_value, encrypt_value

router = APIRouter(
    prefix="/{tenant_slug}/settings/email-inbound",
    tags=["settings-email"],
)

_PASSWORD_MASK = "***"


# ------------------------------------------------------------------
# 스키마
# ------------------------------------------------------------------


class EmailInboundOut(BaseModel):
    imap_host: str
    imap_port: int
    imap_user: str
    imap_password: str  # 항상 "***" 마스킹
    imap_folder: str
    is_active: bool
    last_checked_at: datetime | None
    last_error: str | None


class EmailInboundUpdate(BaseModel):
    imap_host: str
    imap_port: int = 993
    imap_user: str
    imap_password: str | None = None  # None이면 기존 비밀번호 유지
    imap_folder: str = "INBOX"
    is_active: bool = True


class EmailInboundTestResult(BaseModel):
    ok: bool
    message: str


# ------------------------------------------------------------------
# 엔드포인트
# ------------------------------------------------------------------


@router.get("", response_model=EmailInboundOut | None, summary="IMAP 수신 설정 조회")
async def get_email_inbound(
    tenant_slug: str,
    current_user: Annotated[User, Depends(require_roles(UserRole.admin))],
    db: AsyncSession = Depends(get_db),
) -> EmailInboundOut | None:
    cfg = (
        await db.execute(
            select(EmailInboundConfig).where(
                EmailInboundConfig.tenant_id == current_user.tenant_id
            )
        )
    ).scalar_one_or_none()

    if not cfg:
        return None

    return EmailInboundOut(
        imap_host=cfg.imap_host,
        imap_port=cfg.imap_port,
        imap_user=cfg.imap_user,
        imap_password=_PASSWORD_MASK,
        imap_folder=cfg.imap_folder,
        is_active=cfg.is_active,
        last_checked_at=cfg.last_checked_at,
        last_error=cfg.last_error,
    )


@router.put("", response_model=EmailInboundOut, summary="IMAP 수신 설정 저장")
async def put_email_inbound(
    tenant_slug: str,
    body: EmailInboundUpdate,
    current_user: Annotated[User, Depends(require_roles(UserRole.admin))],
    db: AsyncSession = Depends(get_db),
) -> EmailInboundOut:
    cfg = (
        await db.execute(
            select(EmailInboundConfig).where(
                EmailInboundConfig.tenant_id == current_user.tenant_id
            )
        )
    ).scalar_one_or_none()

    if cfg is None:
        if not body.imap_password:
            raise HTTPException(status_code=422, detail="최초 설정 시 비밀번호는 필수입니다.")
        cfg = EmailInboundConfig(
            id=uuid.uuid4(),
            tenant_id=current_user.tenant_id,
            imap_host=body.imap_host,
            imap_port=body.imap_port,
            imap_user=body.imap_user,
            imap_password_enc=encrypt_value(body.imap_password),
            imap_folder=body.imap_folder,
            is_active=body.is_active,
        )
        db.add(cfg)
    else:
        cfg.imap_host = body.imap_host
        cfg.imap_port = body.imap_port
        cfg.imap_user = body.imap_user
        cfg.imap_folder = body.imap_folder
        cfg.is_active = body.is_active
        cfg.updated_at = datetime.now(timezone.utc)
        if body.imap_password and body.imap_password != _PASSWORD_MASK:
            cfg.imap_password_enc = encrypt_value(body.imap_password)

    await db.commit()
    await db.refresh(cfg)

    return EmailInboundOut(
        imap_host=cfg.imap_host,
        imap_port=cfg.imap_port,
        imap_user=cfg.imap_user,
        imap_password=_PASSWORD_MASK,
        imap_folder=cfg.imap_folder,
        is_active=cfg.is_active,
        last_checked_at=cfg.last_checked_at,
        last_error=cfg.last_error,
    )


@router.post("/test", response_model=EmailInboundTestResult, summary="IMAP 연결 테스트")
async def test_email_inbound(
    tenant_slug: str,
    body: EmailInboundUpdate,
    current_user: Annotated[User, Depends(require_roles(UserRole.admin))],
    db: AsyncSession = Depends(get_db),
) -> EmailInboundTestResult:
    # 비밀번호가 마스크이면 DB에서 가져옴
    password = body.imap_password
    if not password or password == _PASSWORD_MASK:
        cfg = (
            await db.execute(
                select(EmailInboundConfig).where(
                    EmailInboundConfig.tenant_id == current_user.tenant_id
                )
            )
        ).scalar_one_or_none()
        if cfg:
            password = decrypt_value(cfg.imap_password_enc)
        if not password:
            return EmailInboundTestResult(ok=False, message="비밀번호를 입력해주세요.")

    try:
        imap = imaplib.IMAP4_SSL(body.imap_host, body.imap_port)
        imap.login(body.imap_user, password)
        status, _ = imap.select(body.imap_folder)
        imap.logout()
        if status != "OK":
            return EmailInboundTestResult(ok=False, message=f"폴더 '{body.imap_folder}'를 찾을 수 없습니다.")
        return EmailInboundTestResult(ok=True, message="연결 성공!")
    except imaplib.IMAP4.error as e:
        return EmailInboundTestResult(ok=False, message=f"IMAP 오류: {e}")
    except OSError as e:
        return EmailInboundTestResult(ok=False, message=f"연결 실패: {e}")
    except Exception as e:
        return EmailInboundTestResult(ok=False, message=f"오류: {e}")
