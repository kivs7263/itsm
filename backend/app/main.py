"""FastAPI 애플리케이션 진입점.

- lifespan: Redis ping 확인 로그
- CORS: ALLOWED_ORIGINS 환경변수 기준 (wildcard origins + credentials 조합 금지)
- Prometheus: prometheus_fastapi_instrumentator 등록
- health check: GET /api/health (DB ping 포함)
- 글로벌 exception handler
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from prometheus_fastapi_instrumentator import Instrumentator
from sqlalchemy import text

from app.core.config import settings
from app.core.database import AsyncSessionLocal, engine
from app.core.redis import close_redis, get_redis

logger = logging.getLogger(__name__)

logging.basicConfig(
    level=getattr(logging, settings.LOG_LEVEL, logging.INFO),
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """애플리케이션 startup / shutdown 훅."""
    # Startup
    try:
        redis = get_redis()
        await redis.ping()
        logger.info("Redis 연결 확인 완료")
    except Exception as exc:
        logger.warning("Redis 연결 확인 실패: %s", exc)

    yield

    # Shutdown
    await close_redis()
    await engine.dispose()
    logger.info("ITSM 백엔드 종료")


app = FastAPI(
    title="ITSM API",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS — wildcard origins + credentials 조합 금지 (핵심 체크)
allowed_origins = settings.get_allowed_origins()
_allow_credentials = "*" not in allowed_origins  # wildcard + credentials 조합 차단
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=_allow_credentials,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Prometheus 메트릭
Instrumentator().instrument(app).expose(app, endpoint="/metrics")


# ------------------------------------------------------------------
# 글로벌 예외 핸들러 — str(exc) 클라이언트 반환 금지
# ------------------------------------------------------------------
@app.exception_handler(Exception)
async def _global_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.error("Unhandled exception", exc_info=exc)
    return JSONResponse(
        status_code=500,
        content={"detail": "서버 오류가 발생했습니다."},
    )


# ------------------------------------------------------------------
# 헬스체크
# ------------------------------------------------------------------
@app.get("/api/health", tags=["health"])
async def health_check():
    """DB + Redis 상태 확인."""
    db_ok = False
    redis_ok = False

    # DB ping
    try:
        async with AsyncSessionLocal() as session:
            await session.execute(text("SELECT 1"))
        db_ok = True
    except Exception as exc:
        logger.error("DB health check 실패: %s", exc)

    # Redis ping
    try:
        redis = get_redis()
        await redis.ping()
        redis_ok = True
    except Exception as exc:
        logger.error("Redis health check 실패: %s", exc)

    status_code = 200 if (db_ok and redis_ok) else 503
    return JSONResponse(
        status_code=status_code,
        content={
            "status": "ok" if (db_ok and redis_ok) else "degraded",
            "db": "ok" if db_ok else "error",
            "redis": "ok" if redis_ok else "error",
        },
    )


# TODO: register routers
# from app.routers import tickets, customers, assets, contracts, sla, auth, portal_auth, crossapp_auth
# app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
# app.include_router(tickets.router, prefix="/api/tickets", tags=["tickets"])
# app.include_router(customers.router, prefix="/api/customers", tags=["customers"])
# app.include_router(assets.router, prefix="/api/assets", tags=["assets"])
# app.include_router(contracts.router, prefix="/api/contracts", tags=["contracts"])
# app.include_router(sla.router, prefix="/api/sla", tags=["sla"])
# app.include_router(portal_auth.router, prefix="/api/portal", tags=["portal"])
# app.include_router(crossapp_auth.router, prefix="/api/auth/crossapp", tags=["crossapp"])

# P2-2 Calendar Events
from app.routers import calendar_events as calendar_events_router  # noqa: E402
app.include_router(calendar_events_router.router, prefix="/api")
