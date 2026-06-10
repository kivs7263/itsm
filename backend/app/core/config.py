"""애플리케이션 설정 — pydantic-settings 기반.

분류:
- [필수] 미설정 시 기동 실패
- [선택] 미설정 시 해당 기능만 비활성 (fallback 처리)
"""
from __future__ import annotations

from typing import Literal

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )

    # ------------------------------------------------------------------
    # [필수] 데이터베이스
    # ------------------------------------------------------------------
    DATABASE_URL: str  # postgresql+asyncpg://...

    # ------------------------------------------------------------------
    # [필수] Redis
    # ------------------------------------------------------------------
    REDIS_URL: str  # redis://itsm_redis:6379/0

    # ------------------------------------------------------------------
    # [필수] JWT
    # ------------------------------------------------------------------
    SECRET_KEY: str
    JWT_EXPIRE_MINUTES: int = 60
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    @field_validator("SECRET_KEY")
    @classmethod
    def secret_key_min_length(cls, v: str) -> str:
        if len(v) < 32:
            raise ValueError("SECRET_KEY는 최소 32자 이상이어야 합니다. openssl rand -base64 48 로 생성하세요.")
        return v

    # ------------------------------------------------------------------
    # [필수] 서비스 간 내부 인증 시크릿
    # CrossApp SSO HMAC-SHA256 서명 (GW/SA ↔ ITSM 교차 로그인)
    # ------------------------------------------------------------------
    SERVICE_BUS_SECRET: str = ""

    # ------------------------------------------------------------------
    # [선택] Meilisearch
    # ------------------------------------------------------------------
    MEILISEARCH_HOST: str = "http://itsm_meilisearch:7700"
    MEILISEARCH_API_KEY: str = ""

    # ------------------------------------------------------------------
    # [선택] MinIO / S3 파일 저장소
    # 미설정 시 파일 업로드 기능 비활성
    # ------------------------------------------------------------------
    MINIO_ENDPOINT: str = ""       # itsm_minio:9000
    MINIO_ACCESS_KEY: str = ""
    MINIO_SECRET_KEY: str = ""
    MINIO_BUCKET: str = "itsm-files"

    # ------------------------------------------------------------------
    # [선택] Keycloak OIDC
    # 미설정 시 자체 HS256 JWT만 동작
    # ------------------------------------------------------------------
    KEYCLOAK_ISSUER: str = ""       # http://10.61.2.151:58080/realms/platform
    KEYCLOAK_CLIENT_ID: str = ""    # itsm

    # ------------------------------------------------------------------
    # [선택] 환경 / 로깅
    # ------------------------------------------------------------------
    ENVIRONMENT: Literal["development", "production"] = "production"
    LOG_LEVEL: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"

    # ------------------------------------------------------------------
    # [선택] CORS — 개발: * / 운영: 환경변수로 주입
    # ------------------------------------------------------------------
    ALLOWED_ORIGINS: str = "*"

    def get_allowed_origins(self) -> list[str]:
        if self.ALLOWED_ORIGINS == "*":
            return ["*"]
        return [o.strip() for o in self.ALLOWED_ORIGINS.split(",") if o.strip()]


settings = Settings()
