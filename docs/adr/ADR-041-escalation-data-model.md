# ADR-041: 에스컬레이션 데이터 모델

- **상태**: 승인
- **결정일**: 2026-06-16
- **결정자**: 제품팀 + 아키텍처팀

---

## 컨텍스트

현재 `tickets.assigned_to` 단일 FK만 존재해 1차→2차 인수인계 이력을 전혀 추적할 수 없다. 담당자가 바뀌면 이전 담당자, 이관 사유, 인수인계 내용이 소멸된다. 2차 대응팀 개념 자체가 스키마에 없어 팀 단위 배정도 불가능하다.

**요구사항**:
1. 1차→2차→3차 인수인계 이력 전체 보존 (감사 추적)
2. 이관 사유·인수인계 메모·고객 공유 요약 분리 저장
3. 지원팀(support_teams) 단위 배정 — 개인 직배정이 아닌 팀으로 인계 후 팀 내 담당자 지정
4. 2차 담당자의 인지(acknowledge) 시각 기록

## 결정

### 스키마 구조

**`support_teams`** — 지원팀 마스터

```
id, tenant_id, name, level(1=1차/2=2차/3=3차), description, is_active, created_at
```

**`support_team_members`** — 팀-유저 매핑 (M:N)

```
team_id FK, user_id FK (복합 PK)
```

**`ticket_escalations`** — 에스컬레이션 이력

```
id, tenant_id, ticket_id,
from_level, to_level,
from_assigned(FK users), to_team_id(FK support_teams), to_assigned(FK users, nullable),
reason(enum), handover_memo(TEXT, 필수), customer_summary(TEXT, nullable),
triggered_by(FK users, NULL=자동), acknowledged_at,
created_at
```

**`tickets` 컬럼 추가**:

```
escalation_level(default 1), escalation_count(default 0),
last_escalated_at, sla_breach_notified_at
```

### 핵심 설계 결정

| 결정 | 이유 |
|---|---|
| 이력 별도 테이블 (`ticket_escalations`) | tickets 컬럼만으로는 N차 이력 불가, 감사 추적 요구 |
| `to_team_id` 필수 + `to_assigned` 선택 | 팀으로 인계 후 팀 내에서 담당자 배정 — 인계 순간 특정인 미정이어도 허용 |
| `handover_memo` 최소 20자 강제 | 맥락 없는 인계 방지, 2차 팀이 즉시 대응 가능하게 |
| `customer_summary` 분리 | 내부 메모(기술 상세)와 고객 공개 내용을 같은 필드에 섞지 않음 |
| `triggered_by = NULL` = 자동 에스컬레이션 | SLA 위반 자동 트리거와 수동 구분 |
| `tickets.escalation_level` 비정규화 | 조회마다 escalations 집계 불필요 — 현재 레벨을 tickets에서 직접 읽음 |

## 대안

| 대안 | 기각 이유 |
|---|---|
| `tickets`에 `escalation_to`, `escalation_memo` 컬럼만 추가 | 이력 소멸, N차 에스컬레이션 불가 |
| `comments` 테이블 활용 (이관 메모를 코멘트로) | 인수인계 구조 데이터(팀ID, 사유 enum) 저장 불가, 조회 복잡 |
| 담당자 직배정 (`to_user_id` 필수) | 이관 즉시 팀 내 담당자 미정인 경우 처리 불가 |

## 결과

- Migration 025: `support_teams` + `support_team_members` + `ticket_escalations` + `escalation_reason_enum`
- Migration 026: `tickets` 컬럼 4개 추가
- `GET /tickets/{id}/escalations` 이력 전체 조회 가능
- 활동 타임라인에 에스컬레이션 카드 표시 (customer_summary 또는 내부 메모 선택 노출)
