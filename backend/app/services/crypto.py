"""필드 레벨 암호화 — SMTP 비밀번호 등 민감 설정값 저장용 (AES-256-GCM).

저장 포맷: base64(nonce[12] + ciphertext+tag).
키: ITSM_ENCRYPTION_KEY 환경변수(32바이트, base64) — 미설정 시 SECRET_KEY를
sha256 해시해 32바이트 키로 파생 (신규 필수 env var 없이 동작, 운영에서는
ITSM_ENCRYPTION_KEY 명시 설정 + 키 로테이션 권장).
"""
from __future__ import annotations

import base64
import hashlib
import os

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.core.config import settings


def _load_key() -> bytes:
    if settings.ITSM_ENCRYPTION_KEY:
        return base64.urlsafe_b64decode(settings.ITSM_ENCRYPTION_KEY)
    return hashlib.sha256(settings.SECRET_KEY.encode()).digest()


_KEY = _load_key()
_aesgcm = AESGCM(_KEY)


def encrypt_value(plaintext: str) -> str:
    nonce = os.urandom(12)
    ciphertext = _aesgcm.encrypt(nonce, plaintext.encode(), None)
    return base64.b64encode(nonce + ciphertext).decode()


def decrypt_value(stored: str) -> str | None:
    """복호화 실패(키 변경 등) 시 None 반환 — 예외 전파 금지."""
    try:
        raw = base64.b64decode(stored)
        nonce, ciphertext = raw[:12], raw[12:]
        return _aesgcm.decrypt(nonce, ciphertext, None).decode()
    except (InvalidTag, ValueError):
        return None
