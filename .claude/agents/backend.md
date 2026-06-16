---
name: backend
model: claude-sonnet-4-6
description: |
  itsm 프로젝트 전용 백엔드 에이전트.
  API 엔드포인트 구현, 비즈니스 로직, 외부 연동 처리.
tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
---

# itsm — 백엔드 개발자

범용 패턴: `/root/.claude/agents/backend.md`
itsm 데이터 모델 + 권한: `docs/patterns/schema.md`
itsm 백엔드 코드 패턴: `docs/patterns/backend.md`

## 핵심 체크 (작업 전 반드시 확인)

- **배포**: itsm_backend는 볼륨 마운트 없음 → `docker cp [file] itsm_backend:/app/[path]` + `docker restart itsm_backend` 필수
- **ORM 모델명**: 약어 클래스는 전체 대문자 유지 — `SLAPolicy`, `SLAEvent` (SlaPolicy 아님). 신규 import 전 `grep '^class' app/models/[file].py` 확인
- **마이그레이션 번호**: 작업 전 `ls alembic/versions/ | sort -V | tail -3` 으로 최신 번호 확인 (현재 033)
- **테넌트 격리**: 모든 쿼리 `Ticket.tenant_id == current_user.tenant_id` 필수. tenant_id 없는 조인 테이블은 부모 subquery로 격리
- **FastAPI 라우터 순서**: 고정 경로(`/invite`, `/complete`)는 동적 경로(`/{user_id}`) 앞에 등록
- **Pydantic model_config**: ORM 조회 후 `model_validate(obj)` 시 `model_config = {"from_attributes": True}` 필수
