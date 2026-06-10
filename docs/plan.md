# ITSM 작업 계획서
# 버전: v1.0 | 작성일: 2026-06-10

> **단일 정본** — 모든 상태 변경은 이 파일에서만 관리
> 상태: `[ PENDING ]` / `[ IN PROGRESS ]` / `[ DONE YYYY-MM-DD ]`

---

## 프로젝트 개요

통합 기술지원 및 자산 관리 시스템 (ITSM & Asset Management)
- SA Workspace + Groupware(GW) + ITSM 3앱 에코시스템의 세 번째 서비스
- 장애·요청 티켓 관리, 고객/자산/계약 관리, SLA 추적이 핵심
- KPI 실적은 SA로 흘러 사업카드(business)와 연계 — ITSM은 운영, SA는 전략
- Git: https://github.com/kivs7263/itsm
- 로컬 경로: /teamwork/itsm/

---

## 아키텍처 결정 요약

### 기술 스택 (GW와 동일)
| 레이어 | 기술 |
|---|---|
| Backend | FastAPI + Python 3.11 + SQLAlchemy 2.0 async + Alembic + Pydantic v2 |
| Frontend | Next.js 14 (App Router) + TypeScript + Tailwind CSS + shadcn/ui + Radix UI |
| DB | PostgreSQL 16 (pgvector/pgvector:pg16 이미지 — KB 의미검색 대비) |
| 캐시/락 | Redis 7 (SLA 타이머 분산 lock, 세션, rate limit) |
| 검색 | Meilisearch 1.10 (티켓·KB 전문 검색) |
| 파일 | MinIO (첨부파일 — ITSM 전용 버킷) |
| 인프라 | Docker Compose + nginx (13서비스), 외부 포트 8890 |
| 모니터링 | Prometheus + Promtail → 중앙 Loki (GW 패턴 동일) |

### 컨테이너 명명 규칙
전 컨테이너 `itsm_` prefix 필수 (GW의 backend/postgres-ha DNS 충돌 장애 사례 방지)
`itsm_nginx`, `itsm_frontend`, `itsm_backend`, `itsm_sla_worker`,
`itsm_postgres_primary`, `itsm_postgres_standby`, `itsm_postgres_ha`,
`itsm_redis`, `itsm_meilisearch`, `itsm_minio`, `itsm_minio_init`,
`itsm_prometheus`, `itsm_promtail`

### CrossApp SSO (3방향)
- 패턴: HMAC-SHA256 기반 일회용 토큰 (SA ↔ GW 기존 패턴 그대로 확장)
- SA/GW 기존 코드: `iss != "sa"` / `iss != "gw"` 하드코딩 → 화이트리스트로 전환
  - SA redeem: `ALLOWED_ISS = {"gw", "itsm"}`
  - GW redeem: `ALLOWED_ISS = {"sa", "itsm"}`
  - ITSM redeem (신규): `ALLOWED_ISS = {"sa", "gw"}`
- 공유 시크릿: `SERVICE_BUS_SECRET` (SA/GW와 동일값)
- 앱 전환기: WorkspaceSwitcher 3×2 그리드, ITSM 셀 추가 (LifeBuoy 아이콘)

### Calendar-service 연동
- source `"itsm"` 추가 — DB 마이그레이션 없음 (String(20) 컬럼, 코드 화이트리스트만 수정)
- 수정 위치 3곳: calendar_service.py:436 / external.py:184 / schemas/calendar.py
- ITSM 이벤트: 현장방문(파랑) / 원격지원(주황) / 내부일정(초록)
- 엔지니어는 GW 캘린더에서도 ITSM 현장방문 일정 통합 확인 가능

### KPI → SA 브릿지 (Phase 2)
- ITSM 운영 지표 → SA `itsm_bridge.py`로 push (`X-Service-Secret`)
- 연계 지점 2곳:
  - `itsm_contract.linked_business_id` → SA business 카드 1:1 (계약 단위 KPI)
  - `itsm_customer.linked_business_id` → SA business 카드 (회사 대표 카드, 전체 집계)
- 한 회사의 SA 사업카드가 복수일 경우(부서/사업별) → 각 카드가 해당 계약 ITSM 데이터만 표시
- SA 사업카드에 표시: 장애 건수/등급, SLA 준수율, MTTA/MTTR, CSAT, 투입 공수, 계약 만료 D-day

### 고객 셀프서비스 포털
- 내부 앱: `/{tenantSlug}/itsm/...` (기존 AppShell 재사용)
- 고객 포털: `/portal/{tenantSlug}/...` (별도 layout, 별도 쿠키 `itsm_portal_session`)
- 인증: 이메일 매직링크 (Phase 1) — Keycloak realm과 분리
- 고객은 자기 customer_id 티켓/자산만 접근, 내부 코멘트 완전 차단

### 멀티테넌트
- 전 테이블 `tenant_id BIGINT NOT NULL` + 복합 인덱스 첫 컬럼 (Migration 001부터)
- 소스 오브 트루스: SSO Admin Portal (첫 로그인 시 ITSM tenants upsert)

---

## Pre-Phase: 기반 환경 구성

### P0-1. 기존 서비스 연동 업데이트 [ PENDING ]
> SA, GW, calendar-service에 ITSM 연동을 위한 최소 수정 적용

- [ ] SA `crossapp_auth.py` — `iss != "gw"` → `ALLOWED_ISS = {"gw", "itsm"}` 화이트리스트
- [ ] GW `crossapp_auth.py` — `iss != "sa"` → `ALLOWED_ISS = {"sa", "itsm"}` 화이트리스트
- [ ] GW `WorkspaceSwitcher.tsx` — ITSM 셀 추가 (3×2 그리드, LifeBuoy 아이콘, `NEXT_PUBLIC_ITSM_URL`)
- [ ] SA `WorkspaceSwitcher` (또는 `OrgAppSwitcher.tsx`) — 동일하게 ITSM 셀 추가
- [ ] calendar-service `calendar_service.py:436` — source 화이트리스트 `["sa","gw","itsm"]`
- [ ] calendar-service `routers/external.py:184` — 동일
- [ ] calendar-service `schemas/calendar.py` — 설명 문자열 업데이트
- [ ] SA `.env.example`, GW `.env.example` — `NEXT_PUBLIC_ITSM_URL` 추가
- [ ] ADR 작성: ADR-001 ITSM 도입 결정, ADR-002 CrossApp 화이트리스트 전환

### P0-2. ITSM 프로젝트 초기 세팅 [ PENDING ]
- [ ] Git 초기화 + README + main 브랜치 push (https://github.com/kivs7263/itsm)
- [ ] 디렉터리 구조 생성 (backend/, frontend/, nginx/, postgres/, docs/)
- [ ] CLAUDE.md 작성 (기술 스택, 핵심 파일 위치, 빌드 명령어, 자동 빌드 규칙)
- [ ] `.env.example` 작성
- [ ] `docker-compose.yml` 작성 (13서비스, itsm_ prefix, 8890 포트)
- [ ] `nginx/nginx.conf` 작성 (resolver/$http_host/rate limit/SSE/portal 별도 zone)

---

## Phase 1: MVP — 운영 코어 (6개 모듈)

> 목표: 티켓 접수 → 처리 → SLA 추적 → 고객 알림 → 셀프서비스 포털 한 사이클 완성
> 완료 기준: 실제 엔지니어가 티켓을 받아 처리하고, 고객이 포털에서 확인 가능한 상태

### P1-1. DB 스키마 확정 (Migration 001~003) [ PENDING ]

**Migration 001 — 멀티테넌트 + 사용자 기반**
- [ ] `tenants` (id, slug UQ, name, settings jsonb, created_at)
- [ ] `users` (id, tenant_id, email, name, role enum, hashed_pw, created_at) + UNIQUE(tenant_id, email)
- [ ] `roles` enum: engineer | team_lead | admin | customer
- [ ] `sso_configs` (id, tenant_id, oidc_issuer, client_id, ...) — GW 패턴 동일
- [ ] `audit_logs` (id, tenant_id, user_id, action, target_type, target_id, meta jsonb, created_at)
- [ ] `teams` (id, tenant_id, name, lead_user_id)
- [ ] `team_members` (team_id, user_id, tenant_id) PRIMARY KEY(team_id, user_id)

**Migration 002 — ITSM 코어 엔티티**
- [ ] `customers` (id, tenant_id, name, email, phone, company, contract_grade, linked_business_id UUID NULL, created_at) + INDEX(tenant_id, email)
- [ ] `assets` (id, tenant_id, customer_id, asset_tag, model, serial, asset_type enum: hw|sw, location jsonb, installed_at, warranty_end, license_end NULL) + INDEX(tenant_id, customer_id), INDEX(tenant_id, asset_tag)
- [ ] `contracts` (id, tenant_id, customer_id, linked_business_id UUID NULL, name, type enum: warranty|paid|maintenance, sla_grade, support_hours, start_date, end_date, amount, memo) + INDEX(tenant_id, customer_id), INDEX(tenant_id, end_date)
- [ ] `tickets` (id, tenant_id, ticket_no UQ-within-tenant, parent_ticket_id NULL, customer_id, asset_id NULL, contract_id NULL, title, description, type enum: incident|request|change|inquiry|maintenance|other, status enum: new|assigned|in_progress|on_hold|resolved|closed|cancelled, priority enum: low|normal|high|critical, source enum: portal|email|phone|engineer|api, assignee_user_id NULL, team_id NULL, internal bool default false, created_by_user_id NULL, created_at, updated_at, resolved_at NULL, closed_at NULL, deleted_at NULL) + INDEX(tenant_id, status, priority), INDEX(tenant_id, assignee_user_id, status), INDEX(tenant_id, customer_id, created_at DESC), INDEX(tenant_id, parent_ticket_id)
- [ ] `ticket_comments` (id, ticket_id, tenant_id, user_id, body, is_internal bool, created_at, deleted_at) + INDEX(ticket_id, created_at)
- [ ] `ticket_attachments` (id, ticket_id, tenant_id, s3_key, filename, size, mime, uploaded_by_user_id, created_at)
- [ ] `ticket_history` (id, ticket_id, tenant_id, user_id, field, old_value, new_value, created_at) — Audit trail
- [ ] `symptom_categories` (id, tenant_id, name, parent_id, sort_order) — 증상 분류 트리
- [ ] `cause_categories` (id, tenant_id, name, parent_id) — 원인 분류 트리

**Migration 003 — SLA / 에스컬레이션 / 방문 / 알림**
- [ ] `sla_policies` (id, tenant_id, name, contract_grade, priority, response_minutes, resolve_minutes, business_hours jsonb, active bool)
- [ ] `sla_targets` (id, ticket_id, tenant_id, policy_id, response_due_at, resolve_due_at, response_met_at NULL, resolve_met_at NULL, breach_response bool, breach_resolve bool, paused_total_seconds int) + INDEX(tenant_id, response_due_at WHERE response_met_at IS NULL), INDEX(tenant_id, resolve_due_at WHERE resolve_met_at IS NULL)
- [ ] `escalation_policies` (id, tenant_id, name, steps jsonb [{after_minutes, notify_user_ids, change_priority}])
- [ ] `ticket_escalations` (id, ticket_id, tenant_id, policy_id, step, triggered_at)
- [ ] `visits` (id, ticket_id, tenant_id, engineer_user_id, scheduled_at, started_at NULL, ended_at NULL, address, lat NULL, lng NULL, status enum: scheduled|on_route|on_site|done|cancelled, calendar_event_id NULL) + INDEX(tenant_id, engineer_user_id, scheduled_at)
- [ ] `notification_outbox` (id, tenant_id, ticket_id NULL, event_type, payload jsonb, attempts, last_attempt_at NULL, sent_at NULL, error NULL) + INDEX(sent_at WHERE sent_at IS NULL)
- [ ] `portal_sessions` (id, customer_id, tenant_id, token_hash, email, expires_at, created_at) — 고객 포털 매직링크 세션
- [ ] `csat_surveys` (id, ticket_id, tenant_id, engineer_user_id, token UQ, sent_at, responded_at NULL, rating NULL, comment NULL) + INDEX(tenant_id, responded_at)

### P1-2. Backend 기반 구조 [ PENDING ]

- [ ] FastAPI 프로젝트 구조 생성 (main.py, core/, routers/, services/, models/, schemas/, alembic/)
- [ ] `core/config.py` — 환경변수 (DATABASE_URL, REDIS_URL, SERVICE_BUS_SECRET, CALENDAR_SERVICE_URL, NOTIFICATION_SERVICE_URL, MEILISEARCH_URL, MINIO_*)
- [ ] `core/database.py` — AsyncSession, lifespan
- [ ] `core/security.py` — JWT 발급/검증, 비밀번호 해싱
- [ ] `core/auth.py` — `get_current_user`, `get_tenant_id_from_slug`, RBAC 의존성
- [ ] `core/redis.py` — Redis 연결
- [ ] `middleware/request_id.py` — X-Request-ID 헤더
- [ ] `routers/crossapp_auth.py` — `/api/auth/crossapp/issue` + `/redeem` (GW 패턴 복제, `ALLOWED_ISS={"sa","gw"}`, `iss="itsm"`)
- [ ] `routers/auth.py` — 로그인/로그아웃/토큰 갱신
- [ ] Alembic 초기 설정 + migration 001~003 실행 및 검증
- [ ] `services/notification_service.py` — notification-service 호출 + outbox fallback
- [ ] `services/calendar_service.py` — calendar-service push (X-Service-Secret)
- [ ] `services/sla_service.py` — SLA 타이머 계산, 위반 감지

### P1-3. sla-worker 컨테이너 [ PENDING ]
- [ ] APScheduler 기반 독립 워커 (backend 이미지 공유, entrypoint 분리)
- [ ] 30초 주기: SLA 임박(50%/80%) 감지 → notification_outbox 삽입
- [ ] 5분 주기: SLA 위반 감지 → 티켓 상태 업데이트 + 에스컬레이션 트리거
- [ ] Redis lock으로 worker 중복 실행 방지 (multi-instance 안전)
- [ ] notification_outbox 재전송 워커 (30초 주기, 최대 3회 retry)

### P1-4. 핵심 API 라우터 [ PENDING ]

**티켓 관리**
- [ ] `GET /api/tickets` — 전체 목록 (페이지네이션, 필터: status/priority/assignee/customer/type)
- [ ] `GET /api/tickets/shared-queue` — 미배정 공유 큐 (팀 전체 공개)
- [ ] `POST /api/tickets` — 티켓 생성 (ticket_no 자동 생성: `T-YYYYMMDD-NNNN`)
- [ ] `GET /api/tickets/{id}` — 티켓 상세
- [ ] `PATCH /api/tickets/{id}` — 티켓 수정 + 이력 자동 기록
- [ ] `POST /api/tickets/{id}/assign` — 접수/담당자 배정 (Optimistic Locking: Redis lock + DB 트랜잭션)
- [ ] `POST /api/tickets/{id}/resolve` — 해결 처리 (원인 분류 필수)
- [ ] `POST /api/tickets/{id}/close` — 종료
- [ ] `POST /api/tickets/{id}/comments` — 코멘트 추가 (is_internal 분리)
- [ ] `GET /api/tickets/{id}/comments` — 코멘트 목록
- [ ] `POST /api/tickets/{id}/attachments` — 첨부파일 업로드 (S3/MinIO)
- [ ] `POST /api/tickets/{id}/subtask` — 서브티켓 생성
- [ ] `GET /api/tickets/{id}/history` — Audit 이력

**고객/자산/계약**
- [ ] `GET/POST /api/customers` — 고객사 목록/생성
- [ ] `GET/PATCH /api/customers/{id}` — 고객사 상세/수정 (SA linked_business_id 포함)
- [ ] `GET/POST /api/customers/{id}/assets` — 자산 목록/생성
- [ ] `GET/PATCH /api/assets/{id}` — 자산 상세/수정
- [ ] `GET/POST /api/customers/{id}/contracts` — 계약 목록/생성
- [ ] `GET/PATCH /api/contracts/{id}` — 계약 상세/수정 (SA linked_business_id 포함)
- [ ] 계약 만료 알림 발송 (D-180/D-90/D-30) — sla-worker에서 daily 체크

**SLA / 방문**
- [ ] `GET /api/tickets/{id}/sla` — SLA 현황 조회
- [ ] `GET/POST /api/sla-policies` — SLA 정책 관리
- [ ] `POST /api/tickets/{id}/visits` — 현장 방문 일정 등록 → calendar-service push 자동
- [ ] `PATCH /api/visits/{id}/checkin` — 체크인 (GPS 좌표 선택 첨부)
- [ ] `PATCH /api/visits/{id}/checkout` — 체크아웃

**고객 포털**
- [ ] `POST /api/portal/auth/magic-link` — 매직링크 발송
- [ ] `POST /api/portal/auth/verify` — 토큰 검증 → portal_session 발급
- [ ] `GET /api/portal/tickets` — 내 티켓 목록 (customer_id 필터 강제)
- [ ] `POST /api/portal/tickets` — 티켓 접수 (유형 3개: incident/request/inquiry만)
- [ ] `GET /api/portal/tickets/{id}` — 티켓 상세 (is_internal 코멘트 필터링)
- [ ] `POST /api/portal/tickets/{id}/comments` — 외부 코멘트만

**캘린더 통합 조회**
- [ ] `GET /api/calendar/events` — calendar-service unified 조회 래핑 (org_id 기준)

**인증/관리**
- [ ] `GET/POST /api/admin/tenants` — 테넌트 관리
- [ ] `GET/POST /api/admin/users` — 사용자 관리
- [ ] `GET/POST /api/admin/teams` — 팀 관리
- [ ] `GET/POST /api/admin/sla-policies` — SLA 정책 관리
- [ ] `GET /api/health` — 헬스체크

### P1-5. Frontend 기반 구조 [ PENDING ]

- [ ] Next.js 14 프로젝트 생성 (App Router, TypeScript, Tailwind)
- [ ] shadcn/ui 초기화 + 필수 컴포넌트 설치 (GW 동일 세트)
- [ ] Pretendard 폰트 설정 (`next/font/local`)
- [ ] `lib/api.ts` — axios 인스턴스 + JWT 갱신 인터셉터 (GW 패턴)
- [ ] `lib/auth.ts` — localStorage 토큰 관리
- [ ] `lib/slug.ts` — `useSlug()` 훅 (tenantSlug prefix 중앙화 — GW 패턴)
- [ ] `app/(auth)/` — 로그인, crossapp 수신 페이지
- [ ] `app/[tenantSlug]/(app)/` — 멀티테넌트 앱 라우트 트리
- [ ] `app/(portal)/portal/[tenantSlug]/` — 고객 포털 별도 레이아웃
- [ ] `components/layout/AppShell.tsx` — 공통 레이아웃
- [ ] `components/layout/Sidebar.tsx` — RBAC 분기 (engineer 5개 / manager+ 전체)
- [ ] `components/layout/BottomNav.tsx` — 모바일 5탭 (홈/내큐/FAB/캘린더/더보기)
- [ ] `components/layout/MobileHeader.tsx`
- [ ] `components/layout/WorkspaceSwitcher.tsx` — 3앱 전환 (SA/GW/ITSM)

### P1-6. 핵심 화면 구현 [ PENDING ]

**대시보드 (`/{slug}/itsm/home`)**
- [ ] 엔지니어 뷰: 내 큐 요약 카드 + 오늘 일정 + SLA 임박 티켓 + 미배정 큐 알림
- [ ] 팀장 뷰: 팀 KPI 5종 카드 + 엔지니어별 현황 테이블 + 미배정 큐 + SLA 위험 티켓

**티켓 큐**
- [ ] 내 큐 (`/{slug}/itsm/queue/mine`) — 내 담당 티켓, 탭(전체/긴급/대기/처리중)
- [ ] 공유 큐 (`/{slug}/itsm/queue/shared`) — 미배정 전체, [할당받기] Optimistic Lock 처리
  - 토스트: "이미 [홍길동]님이 14:05에 접수하였습니다"

**티켓 상세 (`/{slug}/itsm/tickets/[id]`)**
- [ ] 3-column 레이아웃: Sidebar + 본문+타임라인 + 우측 메타패널(TicketDetailPanel)
- [ ] SLA 타이머 sticky bar (헤더 상단, 임박=warning/초과=error 색)
- [ ] 타임라인: 상태변경·코멘트·첨부 통합 이력
- [ ] 내부/외부 코멘트 탭 분리 (고객 비공개 표시)
- [ ] 서브티켓 패널 (생성·목록·상태)
- [ ] 우측 메타패널: 담당자/우선순위/유형/고객/자산/계약/SLA 정보 (인라인 편집)

**티켓 접수 폼 (`/{slug}/itsm/tickets/new`)**
- [ ] Step 1: 6가지 유형 선택 카드 (incident/request/installation/upgrade/inquiry/maintenance)
- [ ] Step 2: 유형별 동적 단일 폼 (공통 필드 + 유형별 추가 필드)
- [ ] 우측 sticky: 임시저장 + 접수 버튼

**고객/자산/계약 관리**
- [ ] 고객 목록 (`/{slug}/itsm/customers`) + TicketSidebar 2차 nav
- [ ] 고객 상세 — 탭(기본정보/자산/계약/티켓이력)
- [ ] 자산 관리 (`/{slug}/itsm/assets`) — HW/SW 필터
- [ ] 계약 관리 (`/{slug}/itsm/contracts`) — 만료 임박 하이라이트

**캘린더 (`/{slug}/itsm/calendar`)**
- [ ] 월간/주간/일간 뷰 (calendar-service unified 조회)
- [ ] 이벤트 색상: 현장방문(파랑)/원격지원(주황)/내부일정(초록)/SA이벤트(회색)/GW이벤트(보라)
- [ ] 엔지니어: 본인 일정 중심, 클릭→티켓 상세 이동
- [ ] 팀장: 팀 전체 일정, 엔지니어 필터, 충돌 감지 경고

**고객 셀프서비스 포털**
- [ ] `/portal/{slug}/login` — 이메일 매직링크 발송
- [ ] `/portal/{slug}/` — 내 티켓 대시보드
- [ ] `/portal/{slug}/tickets` — 내 티켓 목록
- [ ] `/portal/{slug}/tickets/new` — 티켓 접수 (3가지 유형만, 미니멀 UI)
- [ ] `/portal/{slug}/tickets/[id]` — 티켓 상세 (외부 코멘트만, 내부 코멘트 완전 차단)

### P1-7. 알림 연동 [ PENDING ]
- [ ] notification-service에 ITSM 이벤트 타입 추가: `ticket_created`, `ticket_assigned`, `ticket_sla_warning`, `ticket_sla_breached`, `ticket_resolved`, `csat_requested`, `contract_expiring`
- [ ] ITSM backend `notification_service.py` — outbox 패턴 (timeout 3s + retry 1회 + fallback)
- [ ] 이메일 템플릿 등록 (7개 이벤트)

### P1-8. 기반 테스트 [ PENDING ]
- [ ] pytest-asyncio 환경 구성 (NullPool 패턴 — GW 동일)
- [ ] 인증/권한 미들웨어 테스트
- [ ] 티켓 생성·상태변경·Optimistic Lock 테스트
- [ ] SLA 타이머 계산 로직 단위 테스트
- [ ] 고객 포털 격리 테스트 (내부 코멘트 접근 불가 확인)

---

## Phase 1.5: KB + CSAT + KPI 기초

> Phase 1 출시 후 4~8주 목표
> 완료 기준: KB 자가해결 + CSAT 수집 + 팀장 KPI 확인 가능

### P1.5-1. 지식베이스 (KB) [ PENDING ]
- [ ] Migration: `kb_categories`, `kb_articles` (status, published_at, search_tsv, author_user_id)
- [ ] Meilisearch 인덱스 `itsm_kb` 설정 (티켓 인덱스 `itsm_tickets`와 분리)
- [ ] API: CRUD + 게시/비게시 + Meilisearch 인덱싱
- [ ] 티켓 접수 시 유사 KB 자동 추천 (증상 카테고리 기반, 우측 패널)
- [ ] 화면: KB 목록/상세/편집 + 티켓 접수 폼 우측 추천 패널
- [ ] 고객 포털: `/portal/{slug}/kb` 공개 KB 조회

### P1.5-2. CSAT [ PENDING ]
- [ ] Migration: `csat_surveys` 활성화 (Migration 003에 테이블 이미 포함)
- [ ] 티켓 종료 후 24시간 딜레이 → 이메일 자동 발송 (UUID 토큰, 7일 유효)
- [ ] 고객 로그인 없이 링크 클릭만으로 별점(1~5) + 코멘트 제출
- [ ] 낮은 점수 알람: 1~2점 → 즉시 알람, 3점 → 24시간 내 알람
- [ ] KPI 반영: 응답 건만 집계, 무응답 제외

### P1.5-3. KPI 대시보드 (엔지니어/팀장용) [ PENDING ]
- [ ] 엔지니어 개인 KPI: 처리 건수 / MTTA / MTTR / SLA 준수율 / CSAT 평균
- [ ] 팀 KPI 대시보드: 전체 지표 + 엔지니어별 비교 테이블
- [ ] 기간 필터 (오늘/이번주/이번달/분기)
- [ ] recharts 기반 트렌드 차트 (MTTA/MTTR 시계열)

---

## Phase 2: 고급 기능 + SA 연동

> 운영 2~3개월 후 목표

### P2-1. SA KPI 브릿지 [ PENDING ]
- [ ] ITSM `routers/sa_bridge.py` — SA API push (X-Service-Secret)
- [ ] SA `routers/itsm_bridge.py` — ITSM 지표 수신 + business 카드 갱신
- [ ] SA business 카드 UI: ITSM 섹션 추가 (장애 건수/등급, SLA 준수율, MTTA/MTTR, CSAT, 공수, 계약 D-day)
- [ ] 고객/계약 생성 시 SA business 카드 검색·연결 UI (linked_business_id)
- [ ] 푸시 이벤트: 티켓 생성/해결/SLA위반/CSAT응답 (실시간 or 15분 배치)

### P2-2. 공수/비용 추적 [ PENDING ]
- [ ] SA `time_entry` 테이블에 `ticket_id` FK 추가 (nullable)
- [ ] 티켓 상세 화면: 작업 시간 로그 (타이머 or 수동 입력, 작업 유형 선택)
- [ ] SA `labor_rate` 연동: 엔지니어 등급별 시간당 원가
- [ ] 티켓/고객별 수익성 계산 (투입비용 vs 계약금액)
- [ ] 계약 상세 화면: 월별 공수 집계, 수익률 그래프

### P2-3. 현장 방문 고급 기능 [ PENDING ]
- [ ] 모바일 체크인/체크아웃 (GPS 좌표 자동 첨부, 권한 동의)
- [ ] 이동 시간 기록 (출발~도착~귀환)
- [ ] 오프라인 큐: PWA service worker (체크인/아웃 로컬 저장 후 동기화)
- [ ] 팀장 뷰: 일정 충돌 감지 + 빨간 경고 + 담당자 변경

### P2-4. 보고서 자동화 [ PENDING ]
- [ ] 장애 보고서 자동 생성 (티켓 완료 시: 증상/원인/조치/공수/방문이력)
- [ ] GW `approval_documents` 연동: 보고서를 GW 결재 양식으로 → 팀장 검토/승인 → 고객 발송
- [ ] 미승인 상태 고객 발송 불가 (오발송 방지 강제)

### P2-5. 고급 알림 채널 [ PENDING ]
- [ ] SMS 연동 (notification-service에 SMS provider 추가)
- [ ] 카카오 알림톡 연동 (Fallback: 카카오 실패→SMS→이메일 자동 전환)
- [ ] 고객/고객사별 수신 채널 개별 설정

---

## Phase 3: 보류 (운영 데이터 6개월+ 이후 재검토)

> 타겟(중소 SI/MSP)에서 실제 수요 확인 후 결정

- [ ] **변경 관리** — SW 업데이트/패치 변경 이력, 변경 전후 비교
  - 보류 근거: 중소 SI 환경에서 CAB(변경자문위원회) 운영 사례 드묾. KB 성숙 후 재검토.
- [ ] **문제 관리 (RCA)** — 반복 장애 묶기, 근본 원인 추적
  - 보류 근거: KB "반복 태그" 1개로 80% 흡수 가능. 별도 모듈은 ITIL 학습 곡선 가파름.

---

## 북극성 지표

| 지표 | 정의 | 목표 |
|---|---|---|
| **Primary** | SLA 준수율 × CSAT 4.0+ 비율 (곱) | 0.6 (1년차) → 0.75 (2년차) |
| **Counter** | KB Deflection 비율 (자가해결/전체) | 15% (Phase 1.5) → 30% (Phase 2) |

PostHog 이벤트: `itsm.ticket.created/resolved/sla_breached/csat_replied/kb_self_resolved`
PostHog distinct_id 패턴: `itsm:${user_id}` (SA: `sa:`, GW: `gw:` 와 통일)

---

## 미결 결정 사항

| # | 항목 | 현재 결정 | 재검토 시점 |
|---|---|---|---|
| D-1 | 고객 포털 도메인 | Phase 1: `/portal/{slug}/` path 방식 | Phase 2: 서브도메인 분리 검토 |
| D-2 | 고객 포털 인증 | Phase 1: 이메일 매직링크 | Phase 2: 고객사 자체 SSO 지원 검토 |
| D-3 | SA/GW Phase 2 KC 통합 | ITSM까지는 HMAC 방식 유지 | phone/chat 추가 시 Keycloak 단일 SSO 전환 ADR |
| D-4 | 포털 도메인 분리 | path 방식 시작 | 트래픽/보안 요건 따라 재검토 |
