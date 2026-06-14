# itsm 프로젝트 컨텍스트
# 버전: v1.0 | 생성: 2026-06-10

---

## 기술 스택

| 레이어 | 기술 |
|---|---|
| Backend | Python 3.11 + FastAPI + SQLAlchemy 2.0 async + Alembic + Pydantic v2 |
| Frontend | Next.js 14 (App Router) + TypeScript + Tailwind CSS + shadcn/ui + Radix UI |
| DB | PostgreSQL 16 (`pgvector/pgvector:pg16`) + Redis 7 |
| 검색 | Meilisearch 1.10 (티켓·KB 전문 검색) |
| 파일 | MinIO (`itsm-files` 버킷) |
| 인프라 | Docker Compose (13서비스, `itsm_` prefix), nginx, 외부 포트 **8890** |
| 모니터링 | Prometheus + Promtail → 중앙 Loki (GW 패턴 동일) |

---

## 핵심 파일 위치

```
itsm/
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI 엔트리포인트
│   │   ├── core/                # config, database, security, redis, dependencies
│   │   ├── models/              # SQLAlchemy ORM 모델
│   │   ├── routers/             # API 라우터 (tickets, customers, assets, contracts,
│   │   │                        #   sla, crossapp_auth, portal_auth)
│   │   ├── services/            # 비즈니스 로직 (라우터와 1:1)
│   │   └── workers/             # sla_worker (Redis 분산 lock 기반 SLA 타이머)
│   └── alembic/versions/        # 마이그레이션 파일
├── frontend/
│   ├── app/
│   │   ├── (auth)/              # login, crossapp, portal 매직링크
│   │   ├── [tenantSlug]/(app)/  # tickets, customers, assets, contracts, sla, reports
│   │   └── portal/[tenantSlug]/ # 고객 셀프서비스 포털 (별도 layout/쿠키)
│   ├── components/layout/       # AppShell, Sidebar, WorkspaceSwitcher
│   └── lib/                     # api.ts, auth.ts, slug.ts
├── nginx/nginx.conf             # 리버스 프록시 (포털 별도 rate limit zone)
├── postgres/                    # init.sql, haproxy.cfg
├── docker-compose.yml           # 13서비스, itsm_ prefix
└── docs/plan.md                 # 작업 계획서 (단일 정본)
```

---

## 자동 빌드 규칙 (묻지 않고 실행)

| 수정 파일 | 자동 실행 명령 |
|---|---|
| `backend/app/**/*.py` (migration 제외) | `docker compose build itsm_backend && docker compose up -d itsm_backend` |
| `frontend/**` | `docker compose build itsm_frontend && docker compose up -d itsm_frontend` |
| `nginx/nginx.conf` | `docker compose restart itsm_nginx` |

**예외 — 절대 자동 실행 금지**: `alembic/versions/*.py` migration은 감지만, 실행 없음.
**중요**: migration 파일 신규 추가 시에도 `docker compose build itsm_backend` 필수 — 볼륨 마운트 없이 이미지에 베이크되므로 rebuild 없이 `alembic upgrade head` 하면 "Can't locate revision" 오류.

---

## 환경 명령어

```bash
# 전체 기동
docker compose up -d

# 재빌드
docker compose build itsm_backend && docker compose up -d itsm_backend
docker compose build itsm_frontend && docker compose up -d itsm_frontend
docker compose restart itsm_nginx

# 마이그레이션
docker compose run --rm --no-deps itsm_backend alembic upgrade head
docker compose run --rm --no-deps itsm_backend alembic current

# 헬스체크
curl http://localhost:8890/health

# 로그
docker compose logs -f itsm_backend
docker compose logs -f itsm_frontend
```

---

## 테스트

```bash
PG_PW=$(grep POSTGRES_PASSWORD .env | cut -d= -f2)
docker compose run --rm --no-deps \
  -e DATABASE_URL="postgresql+asyncpg://itsm_user:${PG_PW}@itsm_postgres_ha:5000/itsm" \
  itsm_backend python -m pytest tests/ -v
```

---

## 누적 패턴 문서

| 파일 | 내용 |
|---|---|
| [docs/patterns/schema.md](docs/patterns/schema.md) | 테이블 정의, 권한 구조, 마이그레이션 번호 |
| [docs/patterns/backend.md](docs/patterns/backend.md) | 백엔드 코드 패턴, 버그 이력 |
| [docs/patterns/database.md](docs/patterns/database.md) | 마이그레이션 이력, DB 운영 패턴 |
| [docs/patterns/analytics.md](docs/patterns/analytics.md) | KPI 정의, 집계 공식 |
| [docs/patterns/product.md](docs/patterns/product.md) | 제품 결정 이력, 기각 항목 |
| [docs/patterns/infra.md](docs/patterns/infra.md) | 인프라 구성, 환경변수 |
| [docs/patterns/testing.md](docs/patterns/testing.md) | 테스트 패턴, 커버리지 |


## 문서 업데이트 규칙

**작업 완료 시 반드시 수행**:
1. 변경된 기능과 관련된 `docs/` 파일 업데이트
2. `docs/plan.md` 해당 항목 DONE 처리
3. git 커밋 (코드 + 문서 함께)
