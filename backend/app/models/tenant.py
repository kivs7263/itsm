"""테넌트(조직) 모델."""
from __future__ import annotations

from sqlalchemy import Column, String
from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.models.base import Base, gen_uuid, utcnow
from sqlalchemy import DateTime


class Tenant(Base):
    __tablename__ = "tenants"

    id = Column(UUID(as_uuid=True), primary_key=True, default=gen_uuid)
    slug = Column(String(50), unique=True, nullable=False)
    name = Column(String(100), nullable=False)
    settings = Column(JSONB, nullable=False, default=dict, server_default="{}")
    created_at = Column(DateTime(timezone=True), nullable=False, default=utcnow)
    onboarding_completed_at = Column(DateTime(timezone=True), nullable=True)
    # ADR-002: KC org UUID 연결 (SSO Portal 자동 프로비저닝 레일 편입 — ADR-044)
    sso_org_id = Column(UUID(as_uuid=True), unique=True, nullable=True)
    # SA 워크스페이스 테넌트 매핑 (per-tenant). 미설정(NULL) 시 자기 tenant_id 사용.
    # 전역 SA_TENANT_ID env 를 대체 — 멀티테넌트 크로스테넌트 오라우팅 방지.
    sa_tenant_id = Column(UUID(as_uuid=True), nullable=True)
