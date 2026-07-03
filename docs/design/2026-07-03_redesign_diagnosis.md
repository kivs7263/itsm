# ITSM 전면 개편 진단 보고서 (6-에이전트 병렬 진단)
# 생성: 2026-07-03 | 근거: product·uiux·architect·reviewer·analytics·backend 6에이전트 실사

> 사용자 요구: "ITSM 전면 개편 — 불필요한 것 정리, 필요한 것 제대로 동작, 고객관리 전면 개선(인프라 자원 등록·삭제 포함). 냉정·객관·외부리서치 기반."
> 방법: 6개 전문 에이전트 병렬 투입, 각 file:line 근거 + 외부 리서치(ITIL4/ServiceNow/Freshservice/HubSpot 등) 강제.
> 결정(사용자): ① 제품 정체성 = **하이브리드**(생태계 부속 + 독립판매 동시) ② 고객모델 = **전면 재설계** ③ 착수 = 계획서 우선.

---

## 종합 결론 — "전면 재작성"은 틀린 프레임

엔진(백엔드)은 대체로 건전하고 ITIL 4 핵심 practice를 갖춤. 문제는 **계기판·배선·차체**에 집중:
- 리포트 14개 지표 전부 실 DB 집계 (하드코딩 없음) — analytics
- SLA 워커 실동작 (Redis 분산락, 업무시간 캘린더 반영) — analytics
- CRUD 코드 품질 준수 (테넌트 격리·역할체크·에러포맷 일관) — reviewer
→ **타깃 개편(renovation)**이 정답. 재작성 아님.

## "동작 안 하는 것 같다"의 3대 근본원인

### ① 백엔드만 완성, 프론트 진입점 전무 (최대 원인)
최근 커밋 RA-C4/C5/C10이 백엔드 껍데기만 머지. DB 실측 확증:
| 기능 | 백엔드 | 프론트 | DB 실측 |
|---|---|---|---|
| 자동화 룰 엔진(8액션 1,863줄) | ✅ | ❌ UI 0 | `automation_rules` 0행 |
| 서비스카탈로그 다단결재(RA-C5) | ✅ | ❌ 관리자 페이지 없음 | 오퍼링 12개 전부 `{"required":false}` |
| CMDB SNMP 디스커버리(RA-C10) | ✅ 실 SNMP GET | ❌ 버튼 없음 | `discovery_runs` 0행 |

### ② 고객 데이터 모델 근본 약점 (사용자 지목 지점)
- `Customer` 테이블이 "회사"+"사람" 겸용, `company`가 관계 아닌 `String(200)` — `models/customer.py:28`
- Site/지점 개념 없음 → 지점별 자산·계약·SLA 분리 불가
- Ticket에 요청자(contact) 링크 없음 — `ticket.py` 전체에 `requester_contact_id`/`asset_id`/`ci_id` 없음
- 고객 상세 "인프라" 탭이 **읽기전용 껍데기** — 등록/삭제/연결/드릴다운 전무 — `customers/[customerId]/page.tsx:761-903`
  - (주의: plan.md P4-3d가 이 탭을 DONE으로 기록했으나 실구현은 조회 전용 = 계획-구현 불일치)
- SNMP 발견 CI가 `customer_id=None`으로 생성 → 고객 화면에 안 보임 — `cmdb.py:995`

### ③ 확인된 실제 버그 4건 (추정 아님)
| 버그 | 증상 | 근거 |
|---|---|---|
| Asset.status 컬럼 부재 | 모델에 없는데 롤업이 `status='active'` 참조 → active_assets KPI 항상 0/에러 | `models/asset.py:21-48` vs `customers.py:521-523` |
| SLA 준수율 공식 3중 불일치 | `kpi_service.py:90`은 SLA 아니라 "해결률"을 SA 스코어카드에 송출 | `reports.py:208`/`sla.py:337`/`kpi_service.py:90` |
| CSAT 응답률 100배 축소 | 50%가 화면에 0.5%로 표기 | `reports/page.tsx:1204` |
| GW 결재 영구 미작동 | `GW_BACKEND_URL` 미설정→전 티켓 `gw_not_configured`, "결재필요"가 아무것도 안 막음 | `gw_approval_service.py:97-104` |

## 필요 vs 불필요 판정

### 🟢 핵심 축 (집중): Tickets · Problems · Change · Inventory(자산+CMDB) + 뿌리 Customers
조연(유지): SLA · Work Logs · Service Catalog · KB · Portal · Escalations · Reply Templates

### 🔴 데드코드 (grep 0건 확인 — 삭제/정리)
- `AuditLog`·`SSOConfig` 모델 (유령, 참조 0) — `models/audit_log.py:11`, `sso_config.py:11`
- `calendar_events.py` (274줄, 사이드바·호출 0)
- `external_notifications.py` (103줄, UI 0)
- `kb_semantic` 검색 엔드포인트 (프론트 미호출) — embed helper는 kb.py로 이전
- `cmdb.py` L886~1105 SNMP 섹션 (UI 붙이거나 제거)
- `tickets.py` L1050~1156 subtickets/root_causes (프론트 호출 0)
- `bridge_worker` (main.py·compose 미등록, 미기동)

### 🟡 개념 중복 (통합/정리)
- **assets + cmdb**: DB는 `CI.asset_id` FK로 이미 연결. **6에이전트 합의 = 저장소 분리 유지, UI만 단일 "인프라" 페이지**(위험한 병합 마이그레이션 불필요). architect가 ITIL4/ServiceNow 근거로 병합 반대.
- **known_issues vs problems**: ⚠️ 의견 갈림 — product "중복 삭제" vs backend "중복 아님, 계층 다름(Problem=RCA, KI=KB화 해결책, `Problem.is_known_error`로 연결)". **판정: backend 승** (모델 실제로 다름). 코드 통합 X, UX 진입점만 정리.
- **recurring_alerts 별도 페이지**: Problems 필터탭으로 강등(감지 잡 유지).

### ⚪ 하이브리드 결정에 따라 유지 (graceful fallback)
`billing`(Stripe, BILLING-1~5 DONE·미설정시 501), `external_kpi`·`bridge`·`admin_bridge`·`businesses`·`internal_workflow` 유지.

## 외부 리서치 근거 (주요)
- ITIL 4 34 practices — itsm.tools/34-itil-4-management-practices
- Configuration vs Asset — atlassian.com/itsm/it-asset-management/configuration-vs-asset-management
- Known Error(KEDB) — wiki.en.it-processmaps.com/Problem_Management
- 고객 360 IA — HubSpot record layout / Freshservice asset relationships
- ITSM KPI 표준 — atlassian.com/itsm/kpis, thinkhdi.com

## 각 에이전트 원본 트랜스크립트
`/tmp/claude-0/-teamwork-itsm/dcee5cd1-b441-49d7-918f-e6755cd7b1ed/tasks/` (세션 한정)
