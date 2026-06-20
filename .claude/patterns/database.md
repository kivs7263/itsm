# ITSM — database 패턴 (프로젝트 전용)

> 전역 `~/.claude/patterns/database.md`에서 분리한 ITSM 고유 스키마 패턴. 범용 아님.

| 패턴 | 요약 | 발동 | 효과 | 검증# | 태그 |
|---|---|---|---|---|---|
| ITSM tickets — category 없음, request_type 사용 | tickets 테이블에 category 컬럼 없음. 유형 분류는 request_type(varchar). ticket_work_logs: logged_at만 있음(worked_date/created_at/updated_at 없음). sla_events: fired_at(created_at 없음). csat_surveys: survey_token + expires_at NOT NULL. | □ | +버그방지 | 0 | itsm-schema |
