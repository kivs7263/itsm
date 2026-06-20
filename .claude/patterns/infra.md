# ITSM — infra 패턴 (프로젝트 전용)

> 전역 `~/.claude/patterns/infra.md`에서 분리한 ITSM 고유 배포 패턴. 범용 아님.

| 패턴명 | 설명 | 마커 | 효과 | 검증# | 태그 |
|---|---|---|---|---|---|
| ITSM env 주입 recreate 회피 | ITSM은 compose up/recreate 금지(docker-cp overlay 소실+fastapi 드리프트). config가 env_file='.env'(pydantic-settings)이면 신규 env는 /app/.env에 docker cp + docker restart로 주입(컨테이너·overlay 보존). 단 .env는 컨테이너 FS 한정 → recreate 시 소실(fail-safe). durable은 compose env 별도 등록 | □ | +버그방지 | 0 | docker |
