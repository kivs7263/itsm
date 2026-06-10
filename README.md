# ITSM — 통합 기술지원 및 자산 관리 시스템

SA Workspace + Groupware(GW) 에코시스템의 세 번째 서비스.
장애·요청 티켓 관리, 고객/자산/계약 관리, SLA 추적이 핵심.

## 기술 스택

| 레이어 | 기술 |
|---|---|
| Backend | FastAPI + Python 3.11 + SQLAlchemy 2.0 async + Alembic |
| Frontend | Next.js 14 + TypeScript + Tailwind CSS + shadcn/ui |
| DB | PostgreSQL 16 (pgvector) |
| 캐시 | Redis 7 |
| 검색 | Meilisearch 1.10 |
| 인프라 | Docker Compose + nginx (포트 8890) |

## 연동

- SA Workspace: CrossApp SSO + KPI 브릿지 (운영지표 → SA 사업카드)
- Groupware: CrossApp SSO + 보고서 결재 연동
- Calendar Service: 현장방문·일정 push (source="itsm")
- Notification Service: 티켓·SLA·CSAT 알림

## 작업 계획서

`docs/plan.md` 참조
