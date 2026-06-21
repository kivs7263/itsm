"""비동기 SQLAlchemy 엔진 + 세션 팩토리.

멀티테넌트 전략:
- tenant_id 자동 필터는 이벤트 훅 방식 사용 안 함.
- 각 repository/서비스에서 tenant_id를 명시적으로 WHERE 조건으로 추가.
- get_current_tenant_id dependency가 JWT에서 tenant_id를 추출하여 반환.
"""
from __future__ import annotations

import uuid
from contextvars import ContextVar
from typing import AsyncGenerator

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.core.config import settings
from backend_core import rls as _bc_rls

# RLS 컨텍스트 — auth dependency(get_current_tenant_id)에서 요청마다 설정
_rls_tenant_id: ContextVar[str] = ContextVar("rls_tenant_id", default="")

engine = create_async_engine(
    settings.DATABASE_URL,
    echo=(settings.ENVIRONMENT == "development"),
    pool_pre_ping=True,
    pool_size=10,
    max_overflow=20,
)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency — DB 세션 주입."""
    async with AsyncSessionLocal() as session:
        try:
            tid = _rls_tenant_id.get()
            if tid:
                await _bc_rls.set_app_tenant_id(session, tid)
            yield session
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
