"""FastAPI 애플리케이션 진입점.

- lifespan: Redis ping 확인 로그
- CORS: ALLOWED_ORIGINS 환경변수 기준 (wildcard origins + credentials 조합 금지)
- Prometheus: prometheus_fastapi_instrumentator 등록
- health check: GET /api/health (DB ping 포함)
- 글로벌 exception handler
"""
from __future__ import annotations

import logging
import os
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
    from app.workers.wf1_approval_worker import run_wf1_approval_worker

    # Startup
    try:
        redis = get_redis()
        await redis.ping()
        logger.info("Redis 연결 확인 완료")
    except Exception as exc:
        logger.warning("Redis 연결 확인 실패: %s", exc)

    # P5-3 반복 장애 감지 워커
    _recurring_task = _asyncio.create_task(run_recurring_worker())
    # WF-1 GW 결재 상태 폴링 워커 (ADR-048) — 120s 주기
    _wf1_task = _asyncio.create_task(run_wf1_approval_worker())

    yield

    # Shutdown
    _recurring_task.cancel()
    _wf1_task.cancel()
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

# CSRF 보호 — Double Submit Cookie (csrf.itsm)
# enforce=True: CSRF_ENFORCE 환경변수 또는 settings.CSRF_ENFORCE 로 제어.
# OS env 우선, 없으면 pydantic-settings(.env 파일) 값 사용.
from app.middleware.csrf import CSRFMiddleware  # noqa: E402
_csrf_enforce = os.getenv("CSRF_ENFORCE", str(settings.CSRF_ENFORCE)).lower() == "true"
app.add_middleware(CSRFMiddleware, enforce=_csrf_enforce, cookie_name="csrf.itsm")

# Prometheus 메트릭
Instrumentator().instrument(app).expose(app, endpoint="/metrics")


# ------------------------------------------------------------------
# 글로벌 예외 핸들러 — 예외 원문 클라이언트 반환 금지 (generic 메시지만)
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


# ADR-051 Phase 2: 외부 서비스 검색 엔드포인트 (service-auth, gw-svc)
# ⚠️ 반드시 /{tenant_slug}/... 라우터보다 먼저 등록해야 한다.
#    /api/external/search 가 /api/{tenant_slug}/search 에 먹히지 않도록 경로 특이성 확보.
from app.routers import external_search as external_search_router  # noqa: E402
app.include_router(external_search_router.router)                # /api/external/search (prefix 없음)

# CA-P2-3: 외부 서비스 KPI 엔드포인트 (service-auth, sa-svc / gw-svc)
# ⚠️ /{tenant_slug}/... 라우터보다 먼저 등록 필수 (경로 충돌 방지).
from app.routers import external_kpi as external_kpi_router  # noqa: E402
app.include_router(external_kpi_router.router)               # /api/external/kpi (prefix 없음)

# ADR-051 Phase 3b: ITSM → GW 글로벌 검색 프록시 (ITSM 유저 인증 → itsm-svc JWT → GW)
# ⚠️ /{tenant_slug}/search 라우터보다 먼저 등록 필수.
#    /api/search/global-proxy 가 /api/{tenant_slug}/search 패턴에 흡수되지 않도록.
from app.routers import search_proxy as search_proxy_router  # noqa: E402
app.include_router(search_proxy_router.router)               # /api/search/global-proxy (prefix 없음)

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

# P2-3 Search
from app.routers import search as search_router  # noqa: E402
app.include_router(search_router.router, prefix="/api")

# P2-4 KB
from app.routers import kb as kb_router  # noqa: E402
app.include_router(kb_router.router, prefix="/api")
app.include_router(kb_router.router_portal_kb)              # /portal/{slug}/kb/search (비인증)
# PU-D19: nginx 는 /portal/ 를 프론트로 프록시 → 브라우저는 /api/* 로만 백엔드 도달.
# 프론트 @/lib/api(baseURL /api)가 /portal/{slug}/kb/search 호출 → /api/portal/... 병행 마운트 필수.
app.include_router(kb_router.router_portal_kb, prefix="/api")   # /api/portal/{slug}/kb/search

# P3-2 Change Management
from app.routers import change_management as change_management_router  # noqa: E402
app.include_router(change_management_router.router, prefix="/api")

# P3-3 CSAT
from app.routers import csat as csat_router  # noqa: E402
app.include_router(csat_router.router, prefix="/api")                      # /api/{slug}/csat/...
app.include_router(csat_router.router_tickets_csat, prefix="/api")         # /api/{slug}/tickets/{id}/csat
app.include_router(csat_router.router_portal)                              # /portal/{slug}/survey/{token}
app.include_router(csat_router.router_portal, prefix="/api")               # PU-D19: /api/portal/{slug}/survey/{token} (프론트 @/lib/api 도달경로)

# P3-5 멀티채널 알림
from app.routers import notifications as notifications_router  # noqa: E402
app.include_router(notifications_router.router, prefix="/api")             # /api/{slug}/notifications
app.include_router(notifications_router.inbox_router, prefix="/api")       # /api/notifications (통합 인박스 proxy)

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

# P4-3 Settings — 사용자 관리 + 온보딩 setup
from app.routers import settings_users as settings_users_router  # noqa: E402
app.include_router(settings_users_router.router, prefix="/api")            # /api/{slug}/settings/users
app.include_router(settings_users_router.setup_router, prefix="/api")      # /api/{slug}/settings/setup

from app.routers import settings_email as settings_email_router  # noqa: E402
app.include_router(settings_email_router.router, prefix="/api")            # /api/{slug}/settings/email-inbound

# ESC 에스컬레이션 + 지원팀
from app.routers import escalations as escalations_router  # noqa: E402
app.include_router(escalations_router.esc_router, prefix="/api")   # /api/{slug}/tickets/{id}/escalations
app.include_router(escalations_router.team_router, prefix="/api")  # /api/{slug}/support-teams

# ESC-4 고객 포털 매직링크
from app.routers import portal as portal_router  # noqa: E402
app.include_router(portal_router.router_staff, prefix="/api")      # /api/{slug}/tickets/{id}/portal-link
app.include_router(portal_router.router_portal)                    # /portal/* (인증 없음)
from app.routers import portal_customer as portal_customer_router  # noqa: E402
app.include_router(portal_customer_router.router)                   # /portal/{slug}/auth/*, /portal/{slug}/me, /portal/{slug}/tickets
# PU-D19: 프론트 고객포털은 @/lib/api(baseURL /api)로 /portal/{slug}/... 호출 → 실제 /api/portal/{slug}/...
# nginx /portal/ 는 프론트로 가므로 위 bare 마운트는 브라우저 미도달 → /api 병행 마운트로 백엔드 매칭.
app.include_router(portal_customer_router.router, prefix="/api")    # /api/portal/{slug}/auth/*, /me, /tickets, /assets, /contracts, /catalog

# API-1 공개 REST API 키 관리
from app.routers import api_keys as api_keys_router  # noqa: E402
app.include_router(api_keys_router.router, prefix="/api")           # /api/{slug}/settings/api-keys

# API-4 Webhook 엔드포인트 관리
from app.routers import webhooks as webhooks_router  # noqa: E402
app.include_router(webhooks_router.router, prefix="/api")           # /api/{slug}/settings/webhooks

# BILLING-1 플랜 모델 + Stripe 결제
from app.routers import billing as billing_router  # noqa: E402
app.include_router(billing_router.router, prefix="/api")            # /api/{slug}/billing
app.include_router(billing_router.router_webhook, prefix="/api")    # /api/billing/stripe-webhook

# API-2 공개 REST API v1 (API 키 Bearer 인증)
from app.routers import public_v1 as public_v1_router  # noqa: E402
app.include_router(public_v1_router.router)             # /v1/tickets, /v1/usage

# ADR-044: SSO Portal admin_bridge (KC JWT 인증)
from app.routers import admin_bridge as admin_bridge_router  # noqa: E402
app.include_router(admin_bridge_router.router)               # /api/admin/*

# ADR-048 WF-2: GW 결재 승인 → ITSM 작업 티켓 자동 생성 (내부 전용)
from app.routers import internal_workflow as internal_workflow_router  # noqa: E402
app.include_router(internal_workflow_router.router)          # /api/internal/workflow/create-ticket

# ADR-050: 자동화 룰 엔진 관리자 API (Phase 1a)
from app.automation.router import router as automation_router  # noqa: E402
app.include_router(automation_router, prefix="/api")         # /api/{slug}/automation/rules, /api/{slug}/automation/runs

# CA-P1-5 Phase 2: 서비스 카탈로그 관리자(staff) CRUD
from app.routers import service_catalog as service_catalog_router  # noqa: E402
app.include_router(service_catalog_router.router, prefix="/api")  # /api/{slug}/service-catalog/categories, /api/{slug}/service-catalog/offerings

# CA-P2-4 Problem Management (ITIL RCA / Known Error)
from app.routers import problems as problems_router  # noqa: E402
app.include_router(problems_router.router, prefix="/api")          # /api/{slug}/problems
