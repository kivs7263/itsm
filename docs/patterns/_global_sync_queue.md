# 전역 → 프로젝트 sync 권고 큐 (itsm)

_생성: 자동 (sync_patterns_bidirectional.sh). 검토 후 docs/patterns/[domain].md에 추가 또는 의도적 제외 표시._


## backend

| 패턴 | 규칙 | 스택 | 검증# | 사유 |
|---|---|---|---|---|
| fire-and-forget DB 세션 | asyncio.create_task 내 별도 AsyncSessionLocal 생성 필수 | fastapi | 3 | 보안 |
| Outbox at-least-once | 외부 서비스 push: fire-and-forget 대신 outbox INSERT(메인 트랜잭션) + pol | fastapi+pg | 2 | 검증#=2 |
| M:N ORM 활성화 순서 | migration → ORM 모델 → relationship → include_router 순서 | fastapi+pg | 2 | 검증#=2 |
| FORCE RLS 스케줄러 컨텍스트 | `AsyncSessionLocal()` 직접 열 때 테넌트 세션 시작 시 `set_config('app.te | fastapi+pg | 1 | 보안 |
| models/__init__.py 전수 임포트 | TYPE_CHECKING lazy import 모델도 명시 필수 — 누락 시 relationship 문자열  | fastapi | 2 | 검증#=2 |
| Python enum 전 레이어 동기화 | migration ADD VALUE 후 Python enum + ORM + Pydantic + 서비스 전 레 | python | 2 | 검증#=2 |
| 감사 로그 격리 | flush만, commit은 호출자. 세션 종료 후 별도 AsyncSessionLocal | fastapi | 2 | 보안 |
| datetime timezone=True 누락 | 신규 모델 datetime 컬럼 전체에 `DateTime(timezone=True)` 명시 | pg | 4 | 검증#=4 |
| Alembic enum 재사용 raw DDL | `create_type=False` 조합 금지 → `op.execute()` raw DDL | pg | 2 | 검증#=2 |
| 상위 권한 위임 조회 | `view_user_id: UUID | fastapi | 2 | 검증#=2 |
| bcrypt + passlib 버전 핀 | bcrypt 4.x + passlib 비호환 ("password cannot be longer than 72 | python | 1 | 보안 |
| RLS fail-CLOSE NULLIF 단독 | RLS USING 절을 `tenant_id = NULLIF(current_setting('app.tenant | fastapi+pg | 1 | 보안 |
| asyncpg CAST(:param AS type) — :param::t | SQLAlchemy text()에서 named param 바로 뒤 `::type`(`:p::jsonb`, ` | python | 3 | 검증#=3 |
| asyncpg SET LOCAL — UUID 검증 후 f-string | `SET LOCAL app.tenant_id = :tid` 은 asyncpg parameter binding | python | 2 | 보안 |
| HMAC signed token + user_id 이중 검증 | 비동기 ZIP 다운로드 등에서 `hmac.new(secret, f"{job_id}:{user_id}".enc | python | 1 | 보안 |
| Python logging extra 예약키 충돌 | `logger.info("...", extra={"module": x})` 사용 시 `KeyError: At | python | 1 | 보안 |
| 위성 서비스 FK 제거 패턴 | 도메인 서비스 분리 시 외부 테이블(users, tenants, tasks, approval_document | fastapi+pg | 1 | 보안 |
| outbox worker 독립 세션 패턴 | outbox PROCESSING 전환 후 `process_one`에 동일 세션 전달 금지. `expired_ | fastapi+pg | 1 | 보안 |
| 위성 서비스 external 라우터 인증 교체 | GW proxy에서 user Bearer 토큰을 그대로 포워딩하면 external 엔드포인트 서비스 인증 실 | fastapi | 1 | 보안 |
| sync 블로킹 토큰 갱신 async 우회 | `google.auth.transport.requests.Request`(동기 requests 기반) 를 a | python | 1 | 보안 |
| python-jose unverified decode verify_aud | `jwt.decode(token, options={"verify_signature": False})` 는 여 | python | 1 | 보안 |
| 신규 FastAPI 서비스 RLS — get_tenant_db 헬퍼 | 신규 마이크로서비스에서 SQLAlchemy async 세션 + PostgreSQL RLS 조합 시: `get | fastapi+pg | 1 | 보안 |
| WS JWT URL query param 노출 — 헤더로 이동 | WS handshake `?token=<JWT>` query param은 nginx/access.log에 기 | fastapi | 1 | 보안 |
| Scheduler 함수 시그니처 변경 후 호출부 동기화 | `process_outbox_item(db, outbox_id)` → `(db, outbox_id, sour | python | 1 | 보안 |
| 멀티 서비스 proxy 패턴 통일 — request 객체 직접 전달 | `auth_header` 파라미터 방식 대신 `request: Request` 객체를 proxy 헬퍼에 직접 | fastapi | 1 | 보안 |
| bridge_service business_id 필터 | compute_kpi()에서 tenant_id 단독 집계 금지 — tickets→contracts→linke | fastapi+pg | 1 | 보안 |
| FastAPI 라우터 prefix 파라미터 중복 금지 | `prefix="/{tenant_slug}/tickets/{ticket_id}/..."` 라우터에서 엔드포인 | fastapi | 0 | 보안 |
