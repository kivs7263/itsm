# ADR-001: ITSM 서비스 도입 결정

- **상태**: 승인
- **결정일**: 2026-06-10
- **결정자**: 제품팀

---

## 컨텍스트

SA Workspace(전략) + Groupware(협업) 에코시스템에 운영 계층이 없었다. 고객/자산/계약 관리, 장애 티켓 추적, SLA 모니터링을 별도 서비스로 분리하거나 기존 앱에 통합하는 두 가지 옵션을 검토했다.

## 결정

**독립 서비스 ITSM**으로 분리한다.

- 기술 스택은 GW와 동일(FastAPI + Next.js 14 + PostgreSQL 16 + Redis + Meilisearch)하여 운영 비용 최소화
- 외부 포트 8890, 컨테이너 prefix `itsm_` 로 SA(8080)/GW(8888)와 충돌 방지
- SA ↔ GW의 CrossApp SSO HMAC 패턴을 3방향(SA, GW, ITSM)으로 확장

## 대안

| 대안 | 기각 이유 |
|---|---|
| GW 내 ITSM 모듈 통합 | GW 코드베이스 비대화, SLA 워커/Meilisearch 설정 분리 어려움 |
| 외부 SaaS(Freshdesk, Zendesk) | SA KPI 연계 불가, 멀티테넌트 제어권 없음 |

## 결과

- SA 사업카드에 ITSM 운영 KPI(장애 건수/SLA/MTTA/MTTR/CSAT) 브릿지
- GW 캘린더에 ITSM 현장방문 일정 통합
- 고객 셀프서비스 포털(`/portal/{slug}/...`) Phase 1 제공
