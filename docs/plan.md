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
- SA redeem: `ALLOWED_ISS = {"gw", "itsm"}`
- GW redeem: `ALLOWED_ISS = {"sa", "itsm"}`
- ITSM redeem (신규): `ALLOWED_ISS = {"sa", "gw"}`
- 공유 시크릿: `SERVICE_BUS_SECRET` (SA/GW와 동일값)
- 앱 전환기: WorkspaceSwitcher 3×2 그리드, ITSM 셀 추가 (LifeBuoy 아이콘)

### Calendar-service 연동
- source `"itsm"` 추가 — DB 마이그레이션 없음 (String(20) 컬럼, 코드 화이트리스트만 수정)
- ITSM 이벤트: 현장방문(파랑) / 원격지원(주황) / 내부일정(초록)

### KPI → SA 브릿지 (Phase 2)
- ITSM 운영 지표 → SA `itsm_bridge.py`로 push (`X-Service-Secret`)
- `itsm_contract.linked_business_id` → SA business 카드 1:1
- SA 사업카드에 표시: 장애 건수/등급, SLA 준수율, MTTA/MTTR, CSAT, 투입 공수, 계약 만료 D-day

### 고객 셀프서비스 포털
- 내부 앱: `/{tenantSlug}/itsm/...`
- 고객 포털: `/portal/{tenantSlug}/...` (별도 layout, 별도 쿠키 `itsm_portal_session`)
- 인증: 이메일 매직링크 (Phase 1)

### 멀티테넌트
- 전 테이블 `tenant_id BIGINT NOT NULL` + 복합 인덱스 첫 컬럼
- 소스 오브 트루스: SSO Admin Portal

---

## Pre-Phase: 기반 환경 구성

### P0-1. 기존 서비스 연동 업데이트 [ DONE 2026-06-10 ]
> SA, GW, calendar-service에 ITSM 연동을 위한 최소 수정 적용

- [x] SA `crossapp_auth.py` — `ALLOWED_ISS = {"gw", "itsm"}` 화이트리스트
- [x] GW `crossapp_auth.py` — `ALLOWED_ISS = {"sa", "itsm"}` 화이트리스트
- [x] GW `WorkspaceSwitcher.tsx` — ITSM 셀 추가 (3×2 그리드, LifeBuoy 아이콘, `NEXT_PUBLIC_ITSM_URL`)
- [x] SA `OrgAppSwitcher.tsx` — 동일하게 ITSM 셀 추가
- [x] calendar-service `calendar_service.py` — `_READONLY_SOURCES`, `delete_events_by_org` itsm 추가
- [x] calendar-service `routers/external.py` — sources/docstring 업데이트
- [x] calendar-service `schemas/calendar.py` — 설명 문자열 업데이트
- [x] SA `.env.example`, GW `.env.example` — `NEXT_PUBLIC_ITSM_URL` 추가
- [x] ADR 작성: ADR-001 ITSM 도입 결정, ADR-002 CrossApp 화이트리스트 전환

### P0-2. ITSM 프로젝트 초기 세팅 [ DONE 2026-06-10 ]
- [x] Git 초기화 + README + main 브랜치 (https://github.com/kivs7263/itsm)
- [x] 디렉터리 구조 생성 (backend/, frontend/, nginx/, postgres/, docs/)
- [x] CLAUDE.md 작성 (기술 스택, 핵심 파일 위치, 빌드 명령어, 자동 빌드 규칙)
- [x] `.env.example` 작성
- [x] `docker-compose.yml` 작성 (13서비스, itsm_ prefix, 8890 포트)
- [x] `nginx/nginx.conf` 작성 (resolver/$http_host/rate limit/SSE/portal 별도 zone)

---

## Phase 1: MVP — 운영 코어 (6개 모듈)

> 목표: 티켓 접수 → 처리 → SLA 추적 → 고객 알림 → 셀프서비스 포털 한 사이클 완성
> 완료 기준: 실제 엔지니어가 티켓을 받아 처리하고, 고객이 포털에서 확인 가능한 상태

### P1-1. DB 스키마 확정 (Migration 001~003) [ DONE 2026-06-10 ]

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

**Migration 003 — 티켓 + SLA**
- [ ] `tickets` (id, tenant_id, customer_id, contract_id NULL, assigned_to NULL, title, description, priority enum: low|medium|high|critical, status enum: open|in_progress|pending|resolved|closed, channel enum: email|phone|portal|internal, created_at, resolved_at NULL, closed_at NULL) + INDEX(tenant_id, status), INDEX(tenant_id, customer_id), INDEX(tenant_id, assigned_to)
- [ ] `ticket_comments` (id, tenant_id, ticket_id, author_id, body, is_internal bool, created_at) + INDEX(tenant_id, ticket_id)
- [ ] `ticket_attachments` (id, tenant_id, ticket_id, filename, minio_key, size_bytes, created_at)
- [ ] `sla_policies` (id, tenant_id, grade enum: bronze|silver|gold|platinum, response_minutes, resolution_minutes)
- [ ] `sla_events` (id, tenant_id, ticket_id, event_type enum: breach_warning|breached|resolved, fired_at)
- [ ] `portal_sessions` (id, tenant_id, customer_id, token_hash, expires_at, created_at) — 고객 포털 매직링크

### P1-2. Backend 기반 구조 [ DONE 2026-06-10 ]
- [ ] `main.py` — FastAPI 앱, CORS, 라우터 등록, lifespan
- [ ] `core/config.py` — Settings (pydantic-settings), DATABASE_URL, SERVICE_BUS_SECRET 등
- [ ] `core/database.py` — AsyncSession, get_session
- [ ] `core/security.py` — JWT 발급/검증, crossapp HMAC
- [ ] `core/redis.py` — Redis 연결 싱글톤
- [ ] `routers/auth.py` — 로그인, 토큰 갱신, 로그아웃
- [ ] `routers/crossapp_auth.py` — issue/redeem (ALLOWED_ISS={"sa","gw"})
- [ ] `routers/portal_auth.py` — 매직링크 발송/검증
- [ ] `routers/tickets.py` — CRUD + 상태 전환 + 댓글 + 첨부파일
- [ ] `routers/customers.py` — CRUD
- [ ] `routers/assets.py` — CRUD + 자산 이력
- [ ] `routers/contracts.py` — CRUD + 만료 D-day
- [ ] `workers/sla_worker.py` — Redis 분산 lock 기반 SLA breach 감지·알림
- [ ] Alembic 마이그레이션 001~003 실행 및 검증

### P1-3. Frontend 기반 구조 [ DONE 2026-06-10 ]
- [x] `frontend/` Next.js 프로젝트 초기화 (GW 패턴 동일)
- [x] `Dockerfile`, `next.config.js`, `tailwind.config.ts`, `shadcn/ui` 설정
- [x] AppShell, Sidebar, WorkspaceSwitcher (4앱: GW/SA/ITSM/Admin)
- [x] 인증 흐름: `/login` → JWT → `/{slug}/tickets`
- [x] CrossApp 수신 페이지: `/{slug}/crossapp`
- [x] 고객 포털 레이아웃: `/portal/{slug}/...`

### P1-4. 티켓 모듈 UI [ DONE 2026-06-10 ]
- [x] 티켓 목록 (테이블뷰, 필터: status/priority/담당자/고객)
- [x] 티켓 상세 슬라이더 (댓글 타임라인, 내부 메모 구분, 첨부파일)
- [x] 티켓 생성 모달
- [x] SLA 배지 (응답/해결 마감까지 남은 시간, breach 시 빨간색)
- [x] 대량 상태 변경

### P1-5. 고객 셀프서비스 포털 [ DONE 2026-06-10 ]
- [x] 매직링크 인증 흐름 (`/portal/{slug}/login` → 이메일 → `/portal/{slug}/verify`)
- [x] 내 티켓 목록 / 상세 (내부 코멘트 완전 차단 — `is_internal === false` strict filter)
- [x] 새 티켓 접수 폼
- [x] 자산/계약 조회

### P1-6. nginx + Docker Compose 완성 [ DONE 2026-06-10 ]
- [x] `postgres/init.sql` — pgvector extension 활성화 (기존 완성)
- [x] `postgres/haproxy.cfg` — primary:5432 라우팅 (기존 완성)
- [x] `monitoring/prometheus.yml`, `monitoring/promtail.yml` (기존 완성)
- [x] `backend/Dockerfile` — P1-2에서 완성
- [x] `frontend/Dockerfile` — P1-3에서 완성
- [x] `workers/sla_worker.py` 구현 (Redis 분산 lock, SLA breach 감지)
- [x] 전체 `docker compose up -d` 성공 확인 (13개 서비스 모두 Up)

---

## Phase 2: SA KPI 브릿지 + 고도화 [ PENDING ]

- [ ] `itsm_bridge.py` — SA push: 장애 건수/SLA 준수율/MTTA/MTTR/CSAT/투입 공수
- [ ] Calendar-service push: 현장방문·원격지원 이벤트
- [ ] Meilisearch 인덱싱: 티켓·KB 전문 검색
- [ ] KB(지식베이스) 모듈: 문서 작성·검색·티켓 연결
- [ ] 이메일 채널 수신 (IMAP 폴링 또는 웹훅)
- [ ] Slack/Teams 알림 연동

---

## Phase 3: 엔터프라이즈 확장 [ PENDING ]

- [ ] CMDB (Configuration Management DB) 심화
- [ ] Change Management (변경 요청 결재 — GW 결재 연동)
- [ ] 고객 포털 CSAT 설문
- [ ] SLA 리포트 PDF 생성
- [ ] 멀티 채널 (카카오 알림톡, SMS)
