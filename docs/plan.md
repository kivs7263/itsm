# ITSM 작업 계획서
# 버전: v2.0 | 갱신: 2026-06-14

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

### Phase 4 추가 아키텍처 결정 (2026-06-14)

| 결정 | 내용 | 근거 |
|---|---|---|
| 공수 모델 | ticket_work_logs 신규 테이블 (ticket_id, user_id, hours, billable, work_type) | SA KPI "투입 시간" 분모. 현재 MTTR은 wall clock이라 실제 공수 아님 |
| SA 연동 방향 | ITSM → SA push 단방향 유지 (60분 bridge_worker) | 업계 표준 (ServiceNow MID Server 패턴). SA가 원장 데이터 직접 query하면 격리 위반 |
| 사업카드 UX | 컨텍스트 필터 방식 (헤더 드롭다운 + URL ?business_id=) | 별도 워크스페이스 복제 불필요. sessionStorage 유지 |
| 고객사 계층 | customer.parent_id self-reference + kind(account/division) | 다부서 고객(삼성전자 DS/MX 등) 지원. recursive CTE roll-up 가능 |
| SA KPI 지표 | 3축 분리 표시 (수익성/품질/속도) — 단일 점수 금지 | 단일 점수는 게이밍 유발 (Goodhart 법칙) |
| 티켓 번호 | TKT-YYYYMMDD-NNNN (tenant별 daily 시퀀스) | UUID는 고객/엔지니어 구두 참조 불가. 기존 UUID와 공존 |
| 역할 추가 | sales, c_level 추가 (현재: engineer/team_lead/admin/customer) | 계약 파이프라인(영업), 경영 대시보드(C-level) 뷰 분리 필요 |
| 공유 큐 락 | SELECT FOR UPDATE SKIP LOCKED (PostgreSQL) | Redis 분산 락보다 DB 트랜잭션 경계 안에서 원자성 보장 |

---

## Pre-Phase + Phase 1~3 — [ ALL DONE 2026-06-11 ]

> 상세 내역: [docs/plan_archive/phases_recent.md](plan_archive/phases_recent.md)
>
> 주요 산출물: backend(14 routers, 3 workers, 9 migrations) · frontend(35+ files) · docker(13 services, itsm_ prefix) · CrossApp SSO 3방향 · GW 결재 연동 · CSAT · PDF 리포트 · 멀티채널 알림

---

## Phase 4: 운영 완성 + SA 연동 고도화

> 요구사항 정의서 v5.0 + 2026-06-14 에이전트 분석 기반
> 목표: 실제 운영 가능한 수준 + SA 사업카드 효율성 연동

---

### P4-0: 즉시 버그 수정 [ DONE 2026-06-14 ]

> bridge_service.py CSAT 하드코딩 버그 — P3-3에서 CSAT를 구현했으나 SA push에 미반영

| ID | 작업 | 크기 | 상태 |
|---|---|---|---|
| `P4-0a` | `bridge_service.py:141` csat_score=None → 실제 CSAT 평균 쿼리로 교체 | S | `[ DONE 2026-06-14 ]` |
| `P4-0b` | bridge_service에 `avg_csat`, `csat_response_rate` 집계 추가 + SA itsm_bridge Pydantic 모델 동기화 | S | `[ DONE 2026-06-14 ]` |

**성공 기준**: SA 사업카드 itsm_kpi.csat_score에 실제 값 표시

---

### P4-1: 공수 추적 (Work Log) [ DONE 2026-06-14 ]

> 사용자 요청 핵심 — "투입 시간"이 없으면 SA KPI "시간당 매출" 계산 불가
> 현재 MTTR = resolved_at - created_at (wall clock), 실제 엔지니어 투입 공수가 아님

#### P4-1a: DB 마이그레이션 (010)

| ID | 작업 | 크기 | 상태 |
|---|---|---|---|
| `P4-1a` | **Migration 010** — `ticket_work_logs` 테이블 신규 | S | `[ DONE 2026-06-14 ]` |

```sql
-- ticket_work_logs 스키마
id              UUID PK
tenant_id       UUID NOT NULL  -- 멀티테넌트
ticket_id       UUID FK → tickets(id) ON DELETE CASCADE
user_id         UUID FK → users(id)
work_type       VARCHAR(20)  -- remote/onsite/phone/email/internal
hours           NUMERIC(5,2) NOT NULL  -- 0.25 단위 (15분)
billable        BOOLEAN NOT NULL DEFAULT true
memo            TEXT
started_at      TIMESTAMPTZ  -- 타이머 시작 시각 (수동 입력 시 NULL)
logged_at       TIMESTAMPTZ NOT NULL DEFAULT now()
-- 인덱스: (tenant_id, ticket_id), (tenant_id, user_id, logged_at)
```

#### P4-1b: Backend API

| ID | 작업 | 크기 | 상태 |
|---|---|---|---|
| `P4-1b` | `work_log` 라우터 — CRUD + 타이머 시작/중지 | M | `[ DONE 2026-06-14 ]` |

엔드포인트:
- `POST /{tenant}/tickets/{id}/work-logs` — 수동 입력
- `GET /{tenant}/tickets/{id}/work-logs` — 티켓별 공수 목록
- `POST /{tenant}/work-logs/timer/start` — 타이머 시작 (Redis에 user별 active timer)
- `POST /{tenant}/work-logs/timer/stop` — 타이머 중지 → 자동 log 생성
- `GET /{tenant}/work-logs/timer/active` — 현재 실행 중인 타이머 조회
- `GET /{tenant}/work-logs/summary` — 기간별 집계 (user/ticket/billable 기준)

#### P4-1c: Frontend

| ID | 작업 | 크기 | 상태 |
|---|---|---|---|
| `P4-1c` | 티켓 상세 우측 패널 — 공수 입력 섹션 | M | `[ DONE 2026-06-14 ]` |

UI 구성:
- 타이머 시작/중지 버튼 (진행 중일 때 경과 시간 실시간 표시)
- 수동 입력 폼: 시간(h), 작업 유형, 유상/무상, 메모
- 입력된 공수 목록 (본인 + 팀 전체, 합계 표시)
- 유상/무상 breakdown bar

#### P4-1d: bridge_service 공수 집계 확장

| ID | 작업 | 크기 | 상태 |
|---|---|---|---|
| `P4-1d` | bridge_service.compute_kpi에 공수 3종 추가 → SA push | S | `[ DONE 2026-06-14 ]` |

추가 KPI:
- `total_hours`: 전체 투입 공수 합계
- `billable_hours`: 유상 공수 합계
- `billable_ratio`: billable_hours / total_hours (%)

**성공 기준**: 티켓에 공수 입력 → 60분 이내 SA 사업카드에 total_hours 표시

---

### P4-2: SA 사업카드 연동 고도화 [ DONE 2026-06-14 ]

> 공수 추적(P4-1) 완료 후 진행

#### P4-2a: ITSM 헤더 — 사업카드 컨텍스트 필터

| ID | 작업 | 크기 | 상태 |
|---|---|---|---|
| `P4-2a` | Frontend — 앱 헤더에 "현재 사업" 드롭다운 컴포넌트 | M | `[ DONE 2026-06-14 ]` |

동작:
- 드롭다운: `GET /api/{tenant}/contracts?linked=true` 로 사업카드 연결 계약 목록 조회
- 선택 시 sessionStorage `active_business_id` 저장
- 티켓 목록/캘린더: `?business_id=` 자동 필터 적용
- 신규 티켓 생성 폼: 해당 사업의 계약 자동 기본값 설정
- "전체 보기" 선택 시 필터 해제

```
헤더 레이아웃:
[ITSM 로고] [현재 사업: 삼성전자 GPU 유지보수 ▼] ────── [알림] [프로필]
```

#### P4-2b: Backend — 사업카드 조회 내부 API

| ID | 작업 | 크기 | 상태 |
|---|---|---|---|
| `P4-2b` | `GET /{tenant}/businesses` — SA에서 사업카드 목록 가져오는 내부 proxy API | S | `[ DONE 2026-06-14 ]` |

- SA `GET /api/internal/businesses?tenant_id=` 호출 (X-Internal-Secret 인증)
- 결과 캐시: Redis 5분 TTL
- linked_business_id가 있는 계약과 join → ITSM에서 선택 가능한 사업만 필터

#### P4-2c: SA 효율성 탭 (3축 KPI)

| ID | 작업 | 크기 | 상태 |
|---|---|---|---|
| `P4-2c` | SA Workspace 사업카드 상세에 "ITSM 운영 효율성" 탭 추가 | M | `[ DONE 2026-06-14 ]` |

3축 표시 (단일 점수 없음):
```
수익성 축          품질 축              속도 축
──────────────     ──────────────       ──────────────
시간당 매출        SLA 준수율           평균 처리 시간
W/h = 계약금액÷   ██████░░ 87%         MTTR 18.3h
      총공수h
유상비율 72%       CSAT ★4.2/5         MTTA 2.1h
계약 만료 D-47     반복 장애 3건        미해결 티켓 5건
```

- recharts 사용 (SA Workspace 기존 차트 라이브러리)
- 데이터 출처: Business.itsm_kpi JSONB 캐시 (읽기 전용)
- synced_at이 90분+ 경과 시 "데이터가 오래됐습니다 — 새로고침" 배너
- "ITSM에서 열기 ↗" — crossapp SSO 이동 (기존 issue/redeem 패턴)

#### P4-2d: bridge_worker dirty-flag 보강

| ID | 작업 | 크기 | 상태 |
|---|---|---|---|
| `P4-2d` | 티켓/공수 변경 시 Redis dirty SET → bridge_worker 우선 처리 | S | `[ DONE 2026-06-14 ]` |

- 티켓 상태 변경, 공수 입력 시: `SETEX itsm:kpi:dirty:{business_id} 1 300`
- bridge_worker: 60분 sweep 전에 dirty set 먼저 처리
- 평균 stale 시간: 60분 → 약 5분으로 단축 (인프라 변경 없음)

**성공 기준**: SA 사업카드 ITSM 탭에서 3축 KPI 정상 표시, 데이터 5분 내 갱신

---

### P4-3: 고객 카드 360도 뷰 [ DONE 2026-06-14 ]

> 요구사항: 납품 HW/SW 이력, 장애 이력, 구조 정리 공간, 부서 계층

#### P4-3a: DB — 고객사 부서 계층

| ID | 작업 | 크기 | 상태 |
|---|---|---|---|
| `P4-3a` | **Migration 011** — `customers.parent_id` + `customers.kind` 추가 | S | `[ DONE 2026-06-14 ]` |

```sql
ALTER TABLE customers
  ADD COLUMN parent_id UUID NULL REFERENCES customers(id) ON DELETE SET NULL,
  ADD COLUMN kind      VARCHAR(20) NOT NULL DEFAULT 'account';
-- kind: 'account' (최상위 고객사) | 'division' (사업부/팀)
-- 기존 rows: parent_id=NULL, kind='account' (영향 없음)
-- 인덱스: (tenant_id, parent_id)
-- 애플리케이션: cycle 방지 + 깊이 5단계 제한
```

#### P4-3b: DB — 고객 메모 테이블

| ID | 작업 | 크기 | 상태 |
|---|---|---|---|
| `P4-3b` | **Migration 012** — `customer_notes` 테이블 신규 | S | `[ DONE 2026-06-14 ]` |

```sql
-- customer_notes: 고객 카드 전용 메모/문서 (KB와 별개)
id            UUID PK
tenant_id     UUID NOT NULL
customer_id   UUID FK → customers(id) ON DELETE CASCADE
title         VARCHAR(200)
content       TEXT  -- Markdown
author_id     UUID FK → users(id)
created_at    TIMESTAMPTZ DEFAULT now()
updated_at    TIMESTAMPTZ
-- 인덱스: (tenant_id, customer_id)
```

#### P4-3c: Backend — 고객사 계층 API

| ID | 작업 | 크기 | 상태 |
|---|---|---|---|
| `P4-3c` | customers 라우터 확장 — 트리 조회 + 부서 CRUD | M | `[ DONE 2026-06-14 ]` |

엔드포인트:
- `GET /{tenant}/customers/{id}/tree` — 하위 부서 포함 트리 (recursive CTE)
- `POST /{tenant}/customers/{id}/divisions` — 하위 부서 등록
- `GET /{tenant}/customers/{id}/rollup` — 상위 고객사 기준 집계 (티켓/공수/자산 합산)
- `GET /{tenant}/customers/{id}/notes` — 메모 목록
- `POST /{tenant}/customers/{id}/notes` — 메모 작성
- `PATCH /{tenant}/customers/{id}/notes/{note_id}` — 메모 수정

#### P4-3d: Frontend — 고객 카드 360도 UI

| ID | 작업 | 크기 | 상태 |
|---|---|---|---|
| `P4-3d` | customers/[id] 페이지 전면 재설계 — 좌측 부서 트리 + 우측 6탭 | L | `[ DONE 2026-06-14 ]` |

레이아웃:
```
[고객사명] [등급 배지] [SA 사업카드 열기↗]
KPI 스트립: 활성티켓 N | 이번달 공수 Nh | 계약 만료 D-N | 자산 N대
──────────────────────────────────────────────────────────────
[부서 트리]          | [① Overview] [② 자산] [③ 구조] [④ 티켓] [⑤ 계약] [⑥ 공수·수익]
 전사                |
  ├─ DS 사업부  ●   |  (탭 내용 — 선택된 부서 기준 필터)
  └─ MX 사업부      |
```

탭별 내용:

**① Overview**
- 기본 정보 카드 (회사명, 상위 고객사 링크, 담당 엔지니어, 등록일)
- 부서별 KPI 카드 그리드 (각 부서: 활성 티켓 N · 이번달 공수 Nh · SA 링크↗)
- 최근 활동 타임라인 (티켓 생성/완료, 계약 변경, 자산 추가 통합)

**② 자산 (HW/SW)**
- 서브탭: HW | SW | 만료 임박 (30일)
- 칼럼: 장비명/모델, 시리얼, 부서, 설치일, warranty/license 만료, 연결 티켓 수
- 행 클릭 → 우측 드로어: 자산 상세 + 해당 자산의 티켓 이력

**③ 구조 (CMDB 다이어그램)**
- ConfigurationItem + CIRelationship을 force-directed 그래프로 시각화
  - 노드 색상: criticality (critical=red, high=orange, medium=yellow, low=green)
  - 노드 모양: ci_type (server=원, network=마름모, software=사각)
  - 엣지 라벨: rel_type (depends_on, hosted_on, connected_to)
- 하단: CI 리스트 테이블 (다이어그램과 양방향 highlight)
- **메모 영역**: Markdown 자유 메모 (네트워크 구성, 인수인계 사항 등)
- → "구조 정리 공간" 요구사항 충족

**④ 티켓 이력**
- 타임라인 뷰 (월별 그룹) + 심각도/유형 색상
- 필터: status, priority, 부서, 계약, 기간
- 반복 장애 패턴: 동일 자산 다회 장애 하이라이트

**⑤ 계약 + SA 사업카드 패널**
```
계약 목록 테이블 (name | type | SLA등급 | 부서 | 기간 | 금액 | SA링크)
────────────────────────────────────────
[계약 행 클릭 시 하단 분리 패널]
  계약 상세 (좌)          │  SA 사업카드 패널 (우, 읽기 전용)
  SLA 등급                │  사업명 · 유형 · 담당자
  기간/금액               │  총공수h / 유상비율
  지원 시간               │  SLA 준수율 / CSAT
  연결 자산 N대           │  계약 만료 D-N
                          │  [ITSM에서 열기↗ crossapp SSO]
```
- SA 데이터: Business.itsm_kpi JSONB 캐시 (읽기 전용 embed)
- synced_at 표기 ("5분 전 동기화")

**⑥ 공수·수익성** (역할 제한: team_lead, admin, c_level, sales만)
- 부서별 투입 공수 vs 계약 금액 비교 표
- 유상/무상 breakdown
- 시간당 매출 (계약금액 ÷ 총공수)
- 적자 부서 ALERT (투입 비용 > 계약 금액)

역할별 기본 진입 탭:
- 엔지니어: ④ 티켓 이력
- 팀장: ⑥ 공수·수익성
- 영업(sales): ⑤ 계약 (만료 임박 사전 필터)
- C-level: ① Overview

**성공 기준**: 다부서 고객 등록 → 부서별 티켓/자산 분리 조회 가능, CMDB 다이어그램 렌더링

---

### P4-4: 티켓 구조 보강 [ DONE 2026-06-14 ]

> 요구사항 정의서 4.1절 핵심 필드 구현
> 현재 ticket 모델에 source, request_type, ticket_number, parent_id 없음

#### P4-4a: DB 마이그레이션 (013)

| ID | 작업 | 크기 | 상태 |
|---|---|---|---|
| `P4-4a` | **Migration 013** — tickets 테이블 필드 4종 추가 | S | `[ DONE 2026-06-14 ]` |

```sql
ALTER TABLE tickets
  -- 생성 주체
  ADD COLUMN source VARCHAR(30) NULL,
  -- 값: customer_direct | customer_relay | engineer_found | monitoring
  -- (기존 channel과 다름: channel=입력 경로, source=발견 주체)

  -- 요청 유형 (워크플로우 분기 핵심)
  ADD COLUMN request_type VARCHAR(30) NULL,
  -- 값: incident | service_request | installation
  --    | upgrade | technical_inquiry | maintenance

  -- 서브티켓 지원
  ADD COLUMN parent_ticket_id UUID NULL REFERENCES tickets(id) ON DELETE SET NULL,

  -- 티켓 번호 (고객 참조용, UUID와 공존)
  ADD COLUMN ticket_number VARCHAR(25) NULL;
  -- 형식: TKT-20260614-0001 (tenant별 daily 시퀀스)
  -- 기존 rows: NULL → 별도 UPDATE 배치로 백필

-- 인덱스
CREATE UNIQUE INDEX ON tickets(tenant_id, ticket_number) WHERE ticket_number IS NOT NULL;
CREATE INDEX ON tickets(tenant_id, parent_ticket_id) WHERE parent_ticket_id IS NOT NULL;
```

#### P4-4b: DB 마이그레이션 (014) — 분류 체계

| ID | 작업 | 크기 | 상태 |
|---|---|---|---|
| `P4-4b` | **Migration 014** — `symptom_categories` + `cause_categories` 테이블 신규 | S | `[ DONE 2026-06-14 ]` |

```sql
-- 증상 분류 (대분류/중분류 2단계)
symptom_categories (id, tenant_id, name, parent_id self-FK, display_order)
-- 초기 시드: 하드웨어/소프트웨어/성능/연결·접근/데이터/기타 대분류
-- + 각 중분류 (요구사항 5.5절 기준)

-- 원인 분류 (대분류/중분류, 복수 선택 지원)
cause_categories (id, tenant_id, name, parent_id self-FK, display_order)
-- 초기 시드: HW결함/SW버그/설정오류/환경문제/사용자오류/용량한계/미확인

-- 티켓-원인 다대다 (완료 시 복수 원인)
ticket_causes (ticket_id FK, cause_category_id FK, action_taken TEXT, created_at)
```

#### P4-4c: ticket_number 백필 및 자동 생성

| ID | 작업 | 크기 | 상태 |
|---|---|---|---|
| `P4-4c` | ticket_number 시퀀스 생성 로직 + 기존 rows 백필 | M | `[ DONE 2026-06-14 ]` |

- 신규 티켓: 생성 시 `TKT-{YYYYMMDD}-{tenant별 daily 4자리}` 자동 부여
- 기존 rows: `UPDATE tickets SET ticket_number = ...` 배치 (created_at 기준 순서)
- 구현 위치: tickets 라우터 create 함수 + Alembic data migration

#### P4-4d: Backend API 확장

| ID | 작업 | 크기 | 상태 |
|---|---|---|---|
| `P4-4d` | tickets 라우터 — request_type별 워크플로우, 서브티켓 CRUD, 분류 API | M | `[ DONE 2026-06-14 ]` |

엔드포인트 추가:
- `POST /{tenant}/tickets/{id}/sub-tickets` — 서브티켓 생성
- `GET /{tenant}/tickets/{id}/sub-tickets` — 서브티켓 목록
- `PATCH /{tenant}/tickets/{id}/complete` — 완료 처리 (원인 분류 필수 입력 강제)
- `GET /{tenant}/symptom-categories` — 증상 분류 트리
- `GET /{tenant}/cause-categories` — 원인 분류 트리
- `POST /{tenant}/tickets/{id}/causes` — 원인 확정 등록 (복수)

request_type별 워크플로우:
- `incident`: 증상 분류 → 처리 → 원인 확정 + KB 연결 강제
- `installation`: 사전조사 → 설치실행 → 검증 → 고객인수 (4단계 상태 머신)
- `maintenance`: 점검 체크리스트 → 완료 (설치 워크플로우 경량판)
- `service_request`, `technical_inquiry`, `upgrade`: 단순 처리

#### P4-4e: Frontend — 티켓 생성 개선

| ID | 작업 | 크기 | 상태 |
|---|---|---|---|
| `P4-4e` | 티켓 생성 폼 — 6가지 요청 유형 카드 선택 + 유형별 폼 분기 | M | `[ DONE 2026-06-14 ]` |

요청 유형 선택 화면 (첫 단계):
```
[ 장애 지원  ]  [ 설치/구축  ]  [ 추가 설치  ]
[ 업그레이드 ]  [ 기술 문의  ]  [ 정기 유지보수 ]
```
각 카드 선택 시 해당 유형에 맞는 폼으로 분기.

장애 지원 폼:
- 증상 분류: 대분류 드롭다운 → 중분류 연동 드롭다운
- 영향 범위: 단일/클러스터일부/전체 라디오
- 재현 여부: 항상/간헐적/재현불가
- 연관 자산: 다중 선택

완료 시 원인 확정 폼 (incident):
```
원인 1: [HW 결함 ▼] › [GPU 칩 불량 ▼]   조치: _______________
원인 2: [SW 오류 ▼] › [드라이버 충돌 ▼]  조치: _______________
[+ 원인 추가]
KB 등록: ○ 신규 등록  ○ 기존 KB 연결  ○ 해당 없음
```

**성공 기준**: 티켓에 ticket_number 표시, 장애 티켓 완료 시 원인 분류 필수 입력 강제

---

### P4-5: 역할별 뷰 분기 [ DONE 2026-06-14 ]

> 현재 Sidebar.tsx: 모든 역할에 동일 메뉴 노출. 대시보드도 역할 무관 단일 화면.

#### P4-5a: DB — 역할 추가

| ID | 작업 | 크기 | 상태 |
|---|---|---|---|
| `P4-5a` | **Migration 015** — UserRole enum에 `sales`, `c_level` 추가 | S | `[ DONE 2026-06-14 ]` |

```sql
ALTER TYPE userrole ADD VALUE 'sales';
ALTER TYPE userrole ADD VALUE 'c_level';
```

#### P4-5b: Frontend — 역할별 사이드바

| ID | 작업 | 크기 | 상태 |
|---|---|---|---|
| `P4-5b` | Sidebar.tsx — user.role 기반 NAV_ITEMS 조건부 렌더링 | M | `[ DONE 2026-06-14 ]` |

엔지니어 사이드바 (6개):
- 내 대시보드 / 공유 큐 (미배정 배지) / My Queue / 캘린더 / 고객·자산 (조회) / 지식베이스

팀장·관리자 사이드바 (전체):
- 팀 대시보드 / 공유 큐 관리 / 전체 티켓 / 팀 캘린더 / 고객·자산 (편집) / 계약 관리 / KPI 분석 / 보고서 / 사용자 관리 / 설정

영업(sales) 사이드바:
- 고객 목록 / 계약 파이프라인 / KPI 분석 (수익성만)

C-level 사이드바 (3개):
- 경영 대시보드 / KPI 분석 / 보고서

역할 배지: 사이드바 하단 유저 영역에 현재 역할 표시

#### P4-5c: Frontend — 역할별 대시보드 분기

| ID | 작업 | 크기 | 상태 |
|---|---|---|---|
| `P4-5c` | `/[tenant]/home` 페이지 — role에 따라 다른 대시보드 컴포넌트 렌더링 | L | `[ DONE 2026-06-14 ]` |

**엔지니어 대시보드 (개인 워크스페이스)**:
- My Queue 요약 (담당 티켓 수, SLA 임박 N개)
- 오늘 일정 (캘린더 당일 이벤트)
- 내 KPI: 이번달 처리 건수, 평균 처리 시간, CSAT 평균
- 공유 큐 미배정 알림 배너

**팀장 대시보드 (팀 관리)**:
- 팀 KPI 5종 카드: 전체 활성 티켓 / SLA 위험 / 미배정 큐 / 이번달 처리 / 평균 MTTR
- 엔지니어별 현황 테이블 (담당 티켓 수, 이번달 공수h, CSAT)
- SLA 위험 티켓 목록 (빨간 강조)
- 고객별 수익성 요약 상위 5개

**C-level 대시보드 (경영 현황)**:
- MTTA/MTTR 트렌드 차트 (90일)
- SLA 준수율 (전체 / 등급별)
- 엔지니어 가동률 (공수 기반)
- 고객별 수익성 테이블 (적자 고객 ALERT)
- 계약 만료 파이프라인 (D-180/90/30)

**성공 기준**: 엔지니어 로그인 시 개인 워크스페이스, 팀장 로그인 시 팀 대시보드 표시

---

### P4-6: 공유 큐 (Shared Queue) [ DONE 2026-06-14 ]

> 요구사항 4.16절 — 미배정 티켓 팀 공개 + Optimistic Locking

#### P4-6a: Backend — 공유 큐 API

| ID | 작업 | 크기 | 상태 |
|---|---|---|---|
| `P4-6a` | `shared_queue` 라우터 신규 | M | `[ DONE 2026-06-14 ]` |

엔드포인트:
- `GET /{tenant}/queue` — 미배정 티켓 목록 (상태별 잠금 표시 포함)
- `POST /{tenant}/queue/{ticket_id}/claim` — [접수하기] (SELECT FOR UPDATE SKIP LOCKED)
- `POST /{tenant}/queue/{ticket_id}/assign` — [배정하기] (팀장/admin 전용)
- `POST /{tenant}/queue/{ticket_id}/release` — [반납] (담당자 → 미배정 복귀)

Optimistic Locking 구현:
```python
# claim 엔드포인트
async with db.begin():
    ticket = await db.scalar(
        select(Ticket)
        .where(Ticket.id == ticket_id, Ticket.assigned_to.is_(None))
        .with_for_update(skip_locked=True)
    )
    if ticket is None:
        raise HTTPException(409, "이미 다른 담당자가 접수했습니다")
    ticket.assigned_to = current_user.id
    ticket.claimed_at = datetime.utcnow()
```

미배정 30분 초과 알림: bridge_worker 또는 sla_worker에 큐 감시 추가

#### P4-6b: Frontend — 공유 큐 페이지

| ID | 작업 | 크기 | 상태 |
|---|---|---|---|
| `P4-6b` | `/[tenant]/queue` 페이지 신규 | M | `[ DONE 2026-06-14 ]` |

UI 구성:
- 미배정 티켓: `[접수하기]` 버튼 (클릭 시 낙관적 업데이트 → 실패 시 toast "이미 [김철수]님이 14:05에 접수")
- 접수중 티켓: 담당자명 + 접수 시각 표시, 버튼 비활성
- 팀장 뷰: `[접수하기]` + `[배정하기]` (엔지니어 선택 드롭다운) 둘 다 표시
- 미배정 카운트 배지: 사이드바 "공유 큐" 메뉴에 실시간 표시 (30초 polling or SSE)
- 하단: "선착순 접수 방식 — 먼저 클릭한 1인만 성공합니다" 안내 배너

**성공 기준**: 두 사용자가 동시에 [접수하기] 클릭 → 1인만 성공, 나머지 toast 알림

---

## Phase 4 작업 순서 및 의존 관계

```
P4-0 (버그 수정)        즉시 — 독립
    │
P4-1 (공수 추적)        P4-0 이후 — DB 신규라 위험 낮음
    │
    ├─── P4-2 (SA 연동)  P4-1 완료 후 (공수 데이터 필요)
    │
P4-3a/b (DB)            P4-1과 병렬 가능
    │
P4-3c/d (고객 카드)     P4-3a/b 완료 후
    │
P4-4a/b (DB)            P4-3와 병렬 가능
    │
P4-4c~e (티켓 구조)     P4-4a/b 완료 후
    │
P4-5a (DB)              독립
    │
P4-5b/c (역할별 뷰)     P4-5a 완료 후
    │
P4-6 (공유 큐)          P4-5 완료 후 (역할별 접수 로직 필요)
```

---

## Phase 4 마이그레이션 위험도 요약

| 마이그레이션 | 기존 데이터 영향 | 위험도 |
|---|---|---|
| 010 ticket_work_logs (신규) | 없음 | 낮음 |
| 011 customers.parent_id/kind | NULL/DEFAULT 백필 | 낮음 |
| 012 customer_notes (신규) | 없음 | 낮음 |
| 013 tickets 필드 4종 | NULL 허용 — 영향 없음 | 낮음 |
| 013 ticket_number 백필 | UPDATE 전체 rows — 행 수 측정 후 배치 처리 | **중간** |
| 014 분류 체계 + ticket_causes (신규) | 없음 | 낮음 |
| 015 UserRole enum 추가 | PostgreSQL enum ADD VALUE — 롤백 불가 주의 | 낮음 (ADD는 안전) |

---

## Phase 4 완료 기준 (Definition of Done)

| 항목 | 기준 |
|---|---|
| 공수 추적 | 티켓에 공수 입력 → SA 사업카드에 total_hours 표시 (60분 이내) |
| SA 연동 | SA 사업카드 ITSM 탭에서 3축 KPI 정상 표시 |
| 고객 카드 | 다부서 고객 등록 + 부서별 티켓/자산 필터 + CMDB 다이어그램 렌더링 |
| 티켓 구조 | TKT-YYYYMMDD-NNNN 번호 표시, 장애 완료 시 원인 분류 강제 |
| 역할별 뷰 | 엔지니어/팀장/C-level 로그인 시 각기 다른 대시보드 표시 |
| 공유 큐 | 동시 접수 충돌 방지 (1인만 성공, 나머지 toast) |

---

## 다음 Phase (예고)

| Phase | 주요 내용 |
|---|---|
| Phase 6 | KB 시맨틱 검색 (pgvector), 보고서 승인 워크플로우, 다중 연락처 |

---

## Phase 5 — 심화 워크플로우 & 인텔리전스

> 마이그레이션 헤드: `019_known_issues` — Phase 5 전체 완료 2026-06-14

### 작업 목록

| ID | 이름 | 크기 | 상태 |
|---|---|---|---|
| P5-1 | 설치 4단계 워크플로우 | M | [ DONE 2026-06-14 ] |
| P5-2 | 답변 템플릿 | M | [ DONE 2026-06-14 ] |
| P5-3 | 반복 장애 감지 | M | [ DONE 2026-06-14 ] |
| P5-4 | 알려진 이슈 연결 | M | [ DONE 2026-06-14 ] |

---

### P5-1: 설치 4단계 워크플로우

**목적**: `request_type = 'installation'` 티켓에 전용 단계별 진행 추적 제공.
단방향 상태 머신: `survey → executing → verification → acceptance` (되돌리기 없음).
`acceptance` 완료 시 티켓 `status` 자동 → `resolved`.

#### Migration 016

```sql
-- tickets 테이블에 컬럼 추가
ALTER TABLE tickets
  ADD COLUMN installation_step VARCHAR(30),
  ADD COLUMN installation_history JSONB NOT NULL DEFAULT '[]';

-- installation_step: 'survey' | 'executing' | 'verification' | 'acceptance' | NULL
-- installation_history: [{step, actor_id, note, ts}]
```

#### Backend

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/{tenant}/tickets/{id}/installation` | 현재 단계 + 이력 조회 |
| POST | `/{tenant}/tickets/{id}/installation/advance` | 다음 단계로 이동 (`note` 선택) |

`advance` 규칙:
- 단계 순서 강제: survey → executing → verification → acceptance
- 현재 단계 없으면 `survey`로 초기화
- `acceptance` 도달 시 `ticket.status = 'resolved'`, `ticket.resolved_at = now()`
- 이력에 `{step, actor_id, note, ts}` append

#### Frontend

- `InstallationStepPanel.tsx`: 4단계 진행 표시 (Stepper) + "다음 단계" 버튼 + 메모 입력
- `TicketSlider.tsx`에 "설치 진행" 탭 추가 (request_type === 'installation'일 때만)

---

### P5-2: 답변 템플릿

**목적**: 자주 사용하는 답변 문구를 템플릿으로 저장, 대화 탭에서 1클릭 삽입.

#### Migration 017

```sql
CREATE TABLE reply_templates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        VARCHAR(100) NOT NULL,
  body        TEXT NOT NULL,
  category    VARCHAR(50),               -- 'incident' | 'installation' | 'general' 등
  is_shared   BOOLEAN NOT NULL DEFAULT TRUE,
  author_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  use_count   INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ix_reply_templates_tenant ON reply_templates(tenant_id);
```

시드: 테넌트당 기본 템플릿 3개 (일반 접수 확인, 처리 지연 안내, 완료 안내).

#### Backend

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/{tenant}/reply-templates` | 목록 (category 필터, is_shared=true 또는 본인 작성) |
| POST | `/{tenant}/reply-templates` | 생성 |
| PUT | `/{tenant}/reply-templates/{id}` | 수정 (본인 or team_lead+) |
| DELETE | `/{tenant}/reply-templates/{id}` | 삭제 (본인 or team_lead+) |
| POST | `/{tenant}/reply-templates/{id}/use` | use_count +1 (삽입 시 호출) |

#### Frontend

- `ReplyTemplatePicker.tsx`: Popover 컴포넌트, 카테고리 탭 + 검색 + 클릭 시 textarea에 삽입
- `TicketSlider.tsx` 대화 탭 textarea 우측에 "템플릿" 버튼 추가

---

### P5-3: 반복 장애 감지

**목적**: 같은 고객에서 동일 증상이 30일 내 3회+ 발생 시 자동 감지 → 엔지니어 알림.

#### Migration 018

```sql
-- tickets에 컬럼 추가
ALTER TABLE tickets
  ADD COLUMN is_recurring_flag BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN recurring_detected_at TIMESTAMPTZ;

-- 반복 알림 테이블
CREATE TABLE recurring_alerts (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id          UUID REFERENCES customers(id) ON DELETE SET NULL,
  symptom_category_id  UUID REFERENCES symptom_categories(id) ON DELETE SET NULL,
  trigger_ticket_ids   UUID[] NOT NULL,
  occurrence_count     INTEGER NOT NULL,
  detected_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  acknowledged_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  acknowledged_at      TIMESTAMPTZ,
  is_acknowledged      BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX ix_recurring_alerts_tenant ON recurring_alerts(tenant_id, detected_at DESC);
```

#### Backend

- `workers/recurring_worker.py`: 10분 주기 cron, Redis lock `itsm:recurring_worker:lock`
  - 감지 쿼리: `GROUP BY tenant_id, customer_id, symptom_category_id` → 30일 내 장애 3건+
  - 미인지 알림 없을 때만 신규 생성 (중복 방지)

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/{tenant}/recurring-alerts` | 미인지 반복 알림 목록 |
| POST | `/{tenant}/recurring-alerts/{id}/acknowledge` | 인지 처리 |

#### Frontend

- 티켓 목록/슬라이더: `is_recurring_flag=true`일 때 "반복" 주황 배지
- `app/[tenantSlug]/(app)/recurring-alerts/page.tsx`: 반복 알림 대시보드

---

### P5-4: 알려진 이슈 연결

**목적**: KB 아티클을 "알려진 이슈"로 지정, 장애 티켓 생성 시 증상 분류 기반으로 관련 이슈 자동 제안.

#### Migration 019

```sql
-- kb_articles에 컬럼 추가
ALTER TABLE kb_articles
  ADD COLUMN is_known_issue    BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN ki_severity       VARCHAR(20),   -- 'critical' | 'high' | 'medium' | 'low'
  ADD COLUMN ki_symptom_category_id UUID REFERENCES symptom_categories(id) ON DELETE SET NULL,
  ADD COLUMN ki_status         VARCHAR(20) DEFAULT 'open';  -- 'open' | 'investigating' | 'resolved'

-- 티켓-알려진이슈 M2M
CREATE TABLE ticket_known_issues (
  ticket_id   UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  article_id  UUID NOT NULL REFERENCES kb_articles(id) ON DELETE CASCADE,
  linked_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  linked_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (ticket_id, article_id)
);
```

#### Backend

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/{tenant}/kb/known-issues` | 알려진 이슈 목록 (ki_status 필터) |
| GET | `/{tenant}/kb/known-issues/suggest` | symptom_category_id로 관련 이슈 제안 |
| POST | `/{tenant}/tickets/{id}/known-issues` | 티켓-이슈 연결 |
| DELETE | `/{tenant}/tickets/{id}/known-issues/{article_id}` | 연결 해제 |

#### Frontend

- `CreateTicketModal.tsx` (incident + 증상 선택 후): 관련 알려진 이슈 배너 표시
- KB 아티클 편집 화면: "알려진 이슈로 지정" 토글 + severity/status 설정

---

### Phase 5 마이그레이션 리스크

| 마이그레이션 | 변경 | 리스크 |
|---|---|---|
| 016 tickets 컬럼 추가 | NULL 허용 — 영향 없음 | 낮음 |
| 017 reply_templates 신규 | 없음 | 낮음 |
| 018 tickets 컬럼 + recurring_alerts 신규 | BOOLEAN DEFAULT FALSE — 영향 없음 | 낮음 |
| 019 kb_articles 컬럼 + ticket_known_issues 신규 | NULL 허용 — 영향 없음 | 낮음 |

### Phase 5 완료 기준 (Definition of Done)

| 항목 | 기준 |
|---|---|
| 설치 워크플로우 | 4단계 stepper 정상 표시, acceptance → status=resolved 자동 전환 |
| 답변 템플릿 | 대화 탭에서 템플릿 선택 → textarea 삽입, use_count 증가 |
| 반복 장애 | 워커 실행 후 3건+ 감지 시 recurring_alerts 생성, 배지 표시 |
| 알려진 이슈 | 장애 티켓 생성 중 증상 선택 시 관련 이슈 배너 노출 |
