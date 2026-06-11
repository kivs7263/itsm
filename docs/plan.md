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

## Pre-Phase + Phase 1 + Phase 2 — [ ALL DONE 2026-06-10 ]

> 14개 항목 전체 완료. 상세 내역: [docs/plan_archive/phases_recent.md](plan_archive/phases_recent.md)
>
> 주요 산출물: backend(14 routers, 3 workers, 5 migrations) · frontend(28 files, App Router) · docker(15 services, itsm_ prefix)

---

## Phase 3: 엔터프라이즈 확장 [ IN PROGRESS ]

### P3-1: Core API 완성 + CMDB심화 [ DONE 2026-06-11 ]

> Phase 1+2에서 설계만 된 핵심 라우터 구현 + CMDB 신규 기능

| ID | 작업 | 크기 | 상태 |
|---|---|---|---|
| `P3-1a` | Migration 006 — configuration_items + ci_relationships + ci_change_log 3개 테이블 | S | `[ DONE 2026-06-11 ]` |
| `P3-1b` | Backend 핵심 라우터 8종 — auth / tickets / customers / assets / contracts / sla / crossapp_auth / cmdb | L | `[ DONE 2026-06-11 ]` |
| `P3-1c` | Frontend — CMDB 페이지 (CI 목록·상세·관계·이력) + nav 페이지 완성 (customers/assets/contracts/sla/reports) | L | `[ DONE 2026-06-11 ]` |

### P3-2: Change Management (GW 결재 연동) [ DONE 2026-06-11 ]

| ID | 작업 | 크기 | 상태 |
|---|---|---|---|
| `P3-2a` | Migration 007 — change_requests + cr_ci_links 2개 테이블, ENUM 4종 | S | `[ DONE 2026-06-11 ]` |
| `P3-2b` | Backend — gw_approval_service (KC Bearer + GW bridge) + change_management router (15 endpoints) | L | `[ DONE 2026-06-11 ]` |
| `P3-2c` | Frontend — 변경 관리 목록/상세 페이지 + 생성 모달 + 사이드바 | M | `[ DONE 2026-06-11 ]` |
| `P3-2d` | GW service_auth — itsm-svc AZP 추가 | S | `[ DONE 2026-06-11 ]` |
### P3-3: 고객 포털 CSAT 설문 [ DONE 2026-06-11 ]

| ID | 작업 | 크기 | 상태 |
|---|---|---|---|
| `P3-3a` | Migration 008 — csat_surveys (ENUM csat_status_enum, UNIQUE 2종) | S | `[ DONE 2026-06-11 ]` |
| `P3-3b` | Backend — csat_service + csat router (포털/내부) + tickets.py resolve 훅 | M | `[ DONE 2026-06-11 ]` |
| `P3-3c` | Frontend — 포털 설문 페이지 (별점, 5상태) + 리포트 CSAT 섹션 | M | `[ DONE 2026-06-11 ]` |
### P3-4: SLA 리포트 PDF 생성 [ PENDING ]
### P3-5: 멀티 채널 (카카오 알림톡, SMS) [ PENDING ]
