"""SQLAlchemy declarative base + 공통 Mixin.

설계 원칙:
- 모든 도메인 테이블은 멀티테넌트(row-level isolation) → TenantMixin 사용.
- TIMESTAMPTZ 컬럼 비교 시 `datetime.now(timezone.utc)` 사용 — `datetime.utcnow()` 금지.
- soft delete: `deleted_at IS NULL` partial index — 쿼리 표현식 동일하게 유지할 것.
- tenant_id 자동 필터는 미들웨어/repository 레벨에서 수행 (SQLAlchemy event hook 의존 X).
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import DeclarativeBase, declared_attr


def utcnow() -> datetime:
    """TIMESTAMPTZ 컬럼용 UTC 시각. datetime.utcnow() 사용 금지."""
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    """모든 모델의 declarative base."""

    pass


class TimestampMixin:
    """created_at / updated_at 공통."""

    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        default=utcnow,
        server_default=None,
    )
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        default=utcnow,
        onupdate=utcnow,
    )


class SoftDeleteMixin:
    """soft delete. partial index 사용 시 `WHERE deleted_at IS NULL`."""

    deleted_at = Column(DateTime(timezone=True), nullable=True, index=False)


class TenantMixin(TimestampMixin):
    """멀티테넌트 row-level isolation 공통 컬럼."""

    @declared_attr
    def tenant_id(cls):  # noqa: N805
        return Column(
            UUID(as_uuid=True),
            ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
        )


def gen_uuid() -> uuid.UUID:
    return uuid.uuid4()


# UUID PK 공통 Column factory
def uuid_pk():
    return Column(UUID(as_uuid=True), primary_key=True, default=gen_uuid)
