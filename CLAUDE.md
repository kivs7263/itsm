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

> ⚠️ **`docker compose build`/`up`/`recreate` 금지** (total/CLAUDE.md 권위 규칙, 사고 기반). itsm_backend는 **docker-cp 오버레이 서비스**(backend-core 코드가 이미지에 없음) → recreate 시 코드 소실 + fastapi 의존성 드리프트로 전 라우트 500. itsm_frontend는 **`@total/ui-shell` 워크스페이스 의존이 `./frontend` 빌드 컨텍스트 밖** → `compose build`가 npm `extraneous` 오류로 깨짐(2026-06-21 빌드 3회 실패). **반드시 아래 docker-cp / 로컬빌드 방식 사용.**

| 수정 파일 | 자동 실행 명령 |
|---|---|
| `backend/app/**/*.py` (migration 제외) | `docker cp [file] itsm_backend:/app/[path] && docker restart itsm_backend` |
| `frontend/**` | `cd /teamwork/itsm/frontend && NODE_ENV=production node_modules/.bin/next build && docker cp .next/. itsm_frontend:/app/.next/ && docker exec -u root itsm_frontend chown -R node:node /app/.next 2>/dev/null; docker restart itsm_frontend` (NEXT_PUBLIC cross-app URL은 `frontend/.env.production`) |
| `nginx/nginx.conf` | `docker compose restart itsm_nginx` |

**예외 — 절대 자동 실행 금지**: `alembic/versions/*.py` migration은 감지만, 실행 없음.
**중요**: migration 파일은 `docker cp [file] itsm_backend:/app/app/alembic/versions/ && docker exec itsm_backend alembic upgrade head` (이미지 rebuild 아님 — 오버레이 서비스라 compose build 금지. docker-cp로 파일 주입 후 upgrade).

---

## 환경 명령어

```bash
# 전체 기동
docker compose up -d

# 재배포 (⚠️ compose build/up 금지 — 위 자동 빌드 규칙 참조)
# backend: 오버레이 서비스 → docker cp + restart
docker cp backend/app/routers/[file].py itsm_backend:/app/app/routers/[file].py && docker restart itsm_backend
# frontend: @total/ui-shell 워크스페이스 의존 → 로컬 next build + docker cp
cd frontend && NODE_ENV=production node_modules/.bin/next build && docker cp .next/. itsm_frontend:/app/.next/ && docker exec -u root itsm_frontend chown -R node:node /app/.next 2>/dev/null; docker restart itsm_frontend
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
