---
name: integration
description: itsm 프로젝트 연동 인터페이스 — 서비스 간 인증(KC service account/service bus), SA KPI 브릿지, crossapp SSO, admin-bridge, 캘린더 push
type: project
tools:
  - Read
  - Glob
  - Grep
  - Bash
---

# itsm 연동 인터페이스

다른 서비스(SA, GW, SSO Admin Portal, phone-bff)가 ITSM과 연동할 때 이 파일만 보면 됨.
실측 기준: 2026-07-03 소스 대조 (`backend/app/core/service_auth.py`, `routers/`).

---

## 인증 방식

### 1. 서비스 간 수신 인증 (ADR-003 / ADR-051 — KC service account)

외부 서비스 → ITSM 호출: `Authorization: Bearer <KC client_credentials JWT>` → JWKS RS256 검증.

- **구현**: `backend/app/core/service_auth.py` (`require_service_auth`) — SA 패턴 이식
- **azp 화이트리스트**: `_ALLOWED_AZP = {"gw-svc", "sa-svc"}` (확장 시 이 frozenset 수정)
- `KEYCLOAK_ISSUER` / `KEYCLOAK_INTERNAL_URL` 미설정 시 503 (graceful degradation)
- JWKS 캐시: TTL 3600s + asyncio.Lock

### 2. 발신 인증 (ITSM → SA)

- `backend/app/services/bridge_service.py` — 헤더 `x-internal-secret: SERVICE_BUS_SECRET`

### 3. Cross-app SSO (`backend/app/routers/crossapp_auth.py`)

- `POST /{tenant_slug}/auth/crossapp/issue` — ITSM→SA/GW 단기 토큰 발급 (iss="itsm", 로그인 필요)
- `POST /{tenant_slug}/auth/crossapp/redeem` — SA/GW/phone→ITSM 토큰 수신 + ITSM 세션 발급 (공개, HMAC 검증)
- `_ALLOWED_ISS = {"sa", "gw", "phone"}` / 서명: SERVICE_BUS_SECRET HMAC-SHA256
- 쿠키 계층: `backend/app/core/auth_cookies.py` (⚠️ 4계층 계약 — ADR-046 C1, `module_contract_check.sh` 확인)

### 4. Admin Portal (SSO) → ITSM

- `backend/app/routers/admin_bridge.py` — prefix `/api/admin`, 인증 `verify_admin_portal_jwt` (KC JWKS RS256 + azp/role 이중 확인). 테넌트 프로비저닝 saga의 ITSM 측 (SSO `admin-portal/lib/saga.ts`가 호출)

### 5. Public API (고객용)

- `backend/app/routers/public_v1.py` — prefix `/v1`, API Key 인증 (`get_api_key_user`, `api_keys.py`에서 발급)

---

## 공개 API (서비스 간)

| 목적 | 엔드포인트 | 인증 |
|---|---|---|
| KPI 조회 (SA가 pull) | `GET /api/external/kpi?tenant_slug=` | KC svc JWT (sa-svc) |
| 통합 검색 (GW 게이트웨이) | `GET /api/external/search` | KC svc JWT (gw-svc) |
| 테넌트 프로비저닝/관리 | `/api/admin/*` (admin_bridge) | admin-portal JWT |
| crossapp 토큰 교환 | `POST /{tenant_slug}/auth/crossapp/redeem` | HMAC(SERVICE_BUS_SECRET) |

## 발신 연동 (ITSM →)

| 대상 | 방식 | graceful |
|---|---|---|
| SA KPI push | `bridge_service.py` → SA `/api/itsm-bridge/businesses/{id}/kpi` (worker: `workers/bridge_worker.py`) | `SA_BACKEND_URL` 미설정 시 skip |
| SA 단가 pull | SA `/api/itsm-bridge/labor-rates?business_id=` | 미설정 시 `({}, {})` |
| 캘린더 push | `services/calendar_push_service.py` → calendar-service (ADR-005) | `CALENDAR_SERVICE_URL` 미설정 시 skip |
| GW 결재 브릿지 | `GW_BACKEND_URL` 경유 | 미설정 시 skip |
| 고객 webhook | `routers/webhooks.py` (`/{tenant_slug}/settings/webhooks`) — 테넌트별 endpoint 등록/발송 로그 | 실패가 원 요청 차단 금지 |

## 외부 의존 (환경변수 — `backend/app/core/config.py`)

`SERVICE_BUS_SECRET` / `KEYCLOAK_ISSUER` + `KEYCLOAK_INTERNAL_URL` / `SA_BACKEND_URL` / `GW_BACKEND_URL` / `CALENDAR_SERVICE_URL` / `SSO_PORTAL_INTERNAL_URL` — 전부 미설정 시 해당 연동만 비활성 (graceful skip 필수 유지)

## 주의사항

- KPI 집계는 tickets→contracts→`linked_business_id` JOIN 경로 한정 (2026-06-14 멀티계약 오염 버그 수정 — tenant_id 단독 집계 금지)
- 테넌트 종속값 전역 env 금지: `tenants.sa_tenant_id` 컬럼 사용 (failure_log 2026-06-19)
- 연동 회귀 진단 시작점: `~/.claude/runbooks/cross_service_integration.md` + `bash /teamwork/total/scripts/module_contract_check.sh itsm`
