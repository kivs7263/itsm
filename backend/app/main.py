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
    import asyncio as _asyncio
    from app.workers.recurring_worker import run_recurring_worker

    # Startup
    try:
        redis = get_redis()
        await redis.ping()
        logger.info("Redis 연결 확인 완료")
    except Exception as exc:
        logger.warning("Redis 연결 확인 실패: %s", exc)

    # P5-3 반복 장애 감지 워커
    _recurring_task = _asyncio.create_task(run_recurring_worker())

    yield

    # Shutdown
    _recurring_task.cancel()
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


from app.routers import (
    auth as auth_router,
    crossapp_auth as crossapp_auth_router,
    tickets as tickets_router,
    customers as customers_router,
    assets as assets_router,
    contracts as contracts_router,
    sla as sla_router,
    cmdb as cmdb_router,
)
app.include_router(auth_router.router, prefix="/api")            # /api/auth
app.include_router(crossapp_auth_router.router, prefix="/api")  # /api/{slug}/auth/crossapp
app.include_router(tickets_router.router, prefix="/api")                        # /api/{slug}/tickets
app.include_router(tickets_router.classification_router, prefix="/api")        # /api/{slug}/symptom-categories, /cause-categories
app.include_router(customers_router.router, prefix="/api")       # /api/{slug}/customers
app.include_router(assets_router.router, prefix="/api")          # /api/{slug}/assets
app.include_router(contracts_router.router, prefix="/api")       # /api/{slug}/contracts
app.include_router(sla_router.router, prefix="/api")             # /api/{slug}/sla
app.include_router(cmdb_router.router, prefix="/api")            # /api/{slug}/cmdb

# P2-2 Calendar Events
from app.routers import calendar_events as calendar_events_router  # noqa: E402
app.include_router(calendar_events_router.router, prefix="/api")

# P2-3 Search
from app.routers import search as search_router  # noqa: E402
app.include_router(search_router.router, prefix="/api")

# P2-4 KB
from app.routers import kb as kb_router  # noqa: E402
app.include_router(kb_router.router, prefix="/api")

# P3-2 Change Management
from app.routers import change_management as change_management_router  # noqa: E402
app.include_router(change_management_router.router, prefix="/api")

# P3-3 CSAT
from app.routers import csat as csat_router  # noqa: E402
app.include_router(csat_router.router, prefix="/api")                      # /api/{slug}/csat/...
app.include_router(csat_router.router_tickets_csat, prefix="/api")         # /api/{slug}/tickets/{id}/csat
app.include_router(csat_router.router_portal)                              # /portal/{slug}/survey/{token}

# P3-5 멀티채널 알림
from app.routers import notifications as notifications_router  # noqa: E402
app.include_router(notifications_router.router, prefix="/api")             # /api/{slug}/notifications

# P4-1 공수 추적
from app.routers import work_logs as work_logs_router  # noqa: E402
app.include_router(work_logs_router.router, prefix="/api")                 # /api/{slug}/tickets/{id}/work-logs + /api/{slug}/work-logs/...

# P4-2 SA 사업카드 proxy
from app.routers import businesses as businesses_router  # noqa: E402
app.include_router(businesses_router.router, prefix="/api")                # /api/{slug}/businesses

# P4-6 공유 큐
from app.routers import shared_queue as shared_queue_router  # noqa: E402
app.include_router(shared_queue_router.router, prefix="/api")              # /api/{slug}/queue

# P5-1 설치 워크플로우
from app.routers import installation as installation_router  # noqa: E402
app.include_router(installation_router.router, prefix="/api")              # /api/{slug}/tickets/{id}/installation

# P5-2 답변 템플릿
from app.routers import reply_templates as reply_templates_router  # noqa: E402
app.include_router(reply_templates_router.router, prefix="/api")           # /api/{slug}/reply-templates

# P5-3 반복 장애 감지
from app.routers import recurring_alerts as recurring_alerts_router  # noqa: E402
app.include_router(recurring_alerts_router.router, prefix="/api")          # /api/{slug}/recurring-alerts

# P5-4 알려진 이슈
from app.routers import known_issues as known_issues_router  # noqa: E402
app.include_router(known_issues_router.router, prefix="/api")              # /api/{slug}/kb/known-issues
app.include_router(known_issues_router.router_ticket, prefix="/api")       # /api/{slug}/tickets/{id}/known-issues

# P6-1 KB 시맨틱 검색
from app.routers import kb_semantic as kb_semantic_router  # noqa: E402
app.include_router(kb_semantic_router.router, prefix="/api")               # /api/{slug}/kb/search/semantic

# P6-2 보고서 승인 워크플로우
from app.routers import reports as reports_router  # noqa: E402
app.include_router(reports_router.router, prefix="/api")                   # /api/{slug}/reports

# P4-3 Settings — 사용자 관리
from app.routers import settings_users as settings_users_router  # noqa: E402
app.include_router(settings_users_router.router, prefix="/api")            # /api/{slug}/settings/users

# ESC 에스컬레이션 + 지원팀
from app.routers import escalations as escalations_router  # noqa: E402
app.include_router(escalations_router.esc_router, prefix="/api")   # /api/{slug}/tickets/{id}/escalations
app.include_router(escalations_router.team_router, prefix="/api")  # /api/{slug}/support-teams

# ESC-3 고객 외부 알림 이력
from app.routers import external_notifications as ext_notif_router  # noqa: E402
app.include_router(ext_notif_router.router, prefix="/api")         # /api/{slug}/notifications/external
