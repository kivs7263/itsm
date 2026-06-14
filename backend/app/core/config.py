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
    # [선택] Keycloak OIDC — 사용자 SSO 로그인 (Authorization Code Flow)
    # 미설정 시 이메일/비밀번호 로그인만 동작
    # ------------------------------------------------------------------
    KEYCLOAK_ISSUER: str = ""           # https://sso.apistech.co.kr/realms/platform
    KEYCLOAK_CLIENT_ID: str = "itsm"
    KEYCLOAK_CLIENT_SECRET: str = ""    # KC admin에서 발급한 client secret
    KEYCLOAK_REDIRECT_URI: str = ""     # https://itsm.apistech.co.kr/api/auth/sso/callback

    # ------------------------------------------------------------------
    # [선택] GW 결재 연동 (Change Management)
    # GW_BACKEND_URL 미설정 시 GW 결재 bridge 비활성 (graceful skip)
    # KC 서비스 계정: KC realm 에 'itsm-svc' client 생성 후 아래 값 주입
    # ------------------------------------------------------------------
    GW_BACKEND_URL: str = ""           # http://gw_backend:8000
    KC_TOKEN_URL: str = ""             # http://keycloak:8080/realms/platform/protocol/openid-connect/token
    KC_SERVICE_CLIENT_ID: str = "itsm-svc"
    KC_SERVICE_CLIENT_SECRET: str = ""

    # ------------------------------------------------------------------
    # [선택] Calendar Service 연동
    # CALENDAR_SERVICE_URL 미설정 시 캘린더 push 비활성 (graceful skip)
    # ------------------------------------------------------------------
    CALENDAR_SERVICE_URL: str = ""     # http://cal_nginx

    # ------------------------------------------------------------------
    # [선택] SA 브릿지 — ITSM → SA KPI push
    # SA_BACKEND_URL 미설정 시 브릿지 비활성 (graceful skip)
    # ------------------------------------------------------------------
    SA_BACKEND_URL: str = ""           # http://sa_backend:8000
    BRIDGE_INTERVAL_MINUTES: int = 30  # KPI push 주기 (분) — stale 임계값 30분

    # ------------------------------------------------------------------
    # [선택] 이메일 채널 수신 (IMAP 폴링)
    # IMAP_HOST 미설정 시 email_worker 비활성
    # ------------------------------------------------------------------
    IMAP_HOST: str = ""
    IMAP_PORT: int = 993
    IMAP_USER: str = ""
    IMAP_PASSWORD: str = ""
    IMAP_FOLDER: str = "INBOX"
    IMAP_TENANT_SLUG: str = ""   # 수신 메일을 어느 테넌트 티켓으로 생성할지
    EMAIL_INTERVAL_SECONDS: int = 60

    # ------------------------------------------------------------------
    # [선택] 카카오 알림톡
    # KAKAO_API_KEY 또는 KAKAO_SENDER_KEY 미설정 시 카카오 채널 비활성 (graceful skip)
    # ------------------------------------------------------------------
    KAKAO_API_KEY: str = ""          # 카카오 비즈니스 API key
    KAKAO_SENDER_KEY: str = ""       # 발신프로필 key

    # ------------------------------------------------------------------
    # [선택] SMS (Solapi)
    # SMS_API_KEY 미설정 시 SMS 채널 비활성 (graceful skip)
    # ------------------------------------------------------------------
    SMS_API_KEY: str = ""
    SMS_API_SECRET: str = ""
    SMS_FROM_NUMBER: str = ""        # 발신번호 (01012345678 형식)

    # ------------------------------------------------------------------
    # [선택] OpenAI API — KB 시맨틱 검색 임베딩
    # 미설정 시 시맨틱 검색 비활성 (graceful fallback: 503)
    # ------------------------------------------------------------------
    OPENAI_API_KEY: str = ""

    # ------------------------------------------------------------------
    # [선택] Slack / Teams 웹훅 알림
    # 미설정 시 해당 채널 알림 비활성
    # ------------------------------------------------------------------
    SLACK_WEBHOOK_URL: str = ""
    TEAMS_WEBHOOK_URL: str = ""

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
