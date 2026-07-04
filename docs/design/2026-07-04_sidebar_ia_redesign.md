# 사이드바 IA 재구조화 — 진단·설계 정본

- 작성: 2026-07-04 · 리더 취합 (uiux + product 병렬 진단)
- 트리거: 사용자 피드백 — "사이드바만 봐도 사용자와 설정이 똑같다. 사이드바를 너무 남발한다. 잘못된 게 많으니 다시 제대로 분석해달라."
- 배경: 직전 RX-4b "8 도메인 허브" 재구조화가 평면 16항목을 억지로 6~8섹션에 그룹핑하며 부작용 발생.
- 상태: **구현 완료·배포 2026-07-04** (tsc 0·build 0·health 200). 사용자 결정: 구현 진행 / 고객·계약 유지 / 자동화·카탈로그 서비스관리 최하단 유지.

---

## 1. 진단 — 확정된 문제 (file:line 근거)

| ID | 문제 | 근거 | 사용자 지적 매핑 |
|---|---|---|---|
| **D1** | **딥링크를 nav 항목으로 승격 (설정↔사용자 "똑같다"의 근원)** — `설정`→`/settings?tab=general`, `사용자`→`/settings?tab=users`가 **같은 `/settings` 페이지**의 다른 탭. 설정 10탭 중 users만 자의적으로 승격. 아코디언 자동펼침이 쿼리 잘라 base만 비교(둘 다 `/settings`)라 하이라이트도 구분 불가 | `Sidebar.tsx:175-176`, `settings/page.tsx:82-95`, `Sidebar.tsx:204-207` | "사용자와 설정이 똑같다" |
| **D2** | **단일항목 섹션 남발** — 접이식 섹션 헤더가 리프 1개를 감싸 클릭 1회 추가 요구+노이즈. 전 역할 합산 **단일항목 섹션 10개** | engineer: infra/knowledge/admin(L94·100·107) / t_lead·admin: infra/knowledge / sales: 2섹션 2항목 / c_level: 1 | "사이드바 남발" |
| **D3** | **'관리(admin)' 섹션 성격 혼재** — reports(분석·읽기)+settings(설정·쓰기)+users(=설정탭)+notifications(인박스) 4개가 전부 다른 성격 | `Sidebar.tsx:168-181` | "잘못된 게 많다" |
| **D4** | **알림 이중 진입점(진짜 중복)** — 헤더 `NotificationBell`과 사이드바 항목이 **동시 노출+동일 목적지 `/notifications`**. 사이드바에 3회 반복(engineer/t_lead/admin) | 헤더 `layout.tsx:403` / 사이드바 `Sidebar.tsx:109·163·177` | "남발" |
| **D5** | **reports 위치 매몰** — sales/c_level의 로그인 후 주 화면인데 '관리' 섹션에 묻힘. 이들에게 '관리'는 오해 라벨 | `Sidebar.tsx:162·186·191` | "잘못된 게 많다" |
| **D6** | **CommandPalette 불일치** — 팔레트 NAV_ITEMS 8개뿐, 사이드바의 changeRequests·sla·contracts·inventory·automation·serviceCatalog 검색 불가(스스로 "사이드바 미러"라 선언했으나 파손) | `CommandPalette.tsx:50-59` | — |
| **P1** | **Sales에 contracts 누락(기능 결함)** — 계약 파이프라인 운영자에게 계약 화면이 없음 | `Sidebar.tsx:183-187` | — |

### 현재 노출 수 (실측)
| 역할 | 항목 | 제목섹션 | 단일항목섹션 |
|---|---|---|---|
| engineer | 11 | 6 | 3 |
| team_lead | 14 | 6 | 2 |
| admin | **16** | 6 | 2 |
| sales | 3 | 2 | 2 |
| c_level | 2 | 1 | 1 |

---

## 2. 외부 레퍼런스 — "일상 업무 nav vs 설정" 분리

세 제품 모두 **설정을 운영 사이드바에서 물리적으로 분리**하고, 설정은 전용 풀페이지+내부 좌측탭으로 처리한다(사이드바에 설정 세부를 뿌리지 않음).

- **Linear**: 운영 사이드바=업무 항목만. 설정은 워크스페이스명 클릭→전용 설정영역, 내부 Account/Features/Administration 좌측 탭.
- **Zendesk**: Agent Workspace(업무)와 Admin Center(설정)가 완전 별도 영역.
- **Freshservice**: 좌측 내비는 모듈 평면 나열(Tickets/Problems/Changes/Assets/Reports…), Admin은 단일 진입점 하나.

→ **우리 적용**: 설정·사용자를 사이드바에서 빼고 **단일 설정 진입점 1개**로. 세부는 `settings/page.tsx`의 기존 10탭이 담당(신규 개발 0).

---

## 3. 재구조화안 — 5역할 before → after

**공통 원칙**: ①홈·리포트는 무제목 리딩 그룹으로 평탄 노출 ②2개 미만 항목엔 섹션 헤더 금지 ③infra+knowledge 단일섹션 2개 → `자산·지식` 1섹션 병합 ④notifications 사이드바 제거(헤더 벨+모바일 시트가 도달 보장) ⑤설정은 하단 고정 기어(admin 전용) 단일화.

### 수치 요약 (before → after)
| 역할 | 제목섹션 | 단일항목섹션 | 항목 |
|---|---|---|---|
| engineer | 6 → **4** | 3 → **0** | 11 → **10** |
| team_lead | 6 → **4** | 2 → **0** | 14 → **13** |
| admin | 6 → **4** | 2 → **0** | 16 → **13** (+하단기어 1) |
| sales | 2 → **0** | 2 → **0** | 3 → **3**(+contracts, 평면) |
| c_level | 1 → **0** | 1 → **0** | 2 → **2**(평면) |
| **합계 단일항목섹션** | | **10 → 0** | |

### Admin (대표 예시)
```
BEFORE (6섹션/16항목)                        AFTER (4섹션/13 + 하단기어)
· 홈                                          · 홈 · 리포트          (무제목 리딩)
[작업] 티켓·작업시간                          [작업] 티켓·작업시간
[서비스관리] 변경요청·문제·SLA·자동화·카탈로그  [서비스관리] …5개
[고객] 고객·계약                              [고객] 고객·계약
[인프라] 인프라           ← 단일             [자산·지식] 인프라·지식베이스  ← 병합
[지식] 지식베이스         ← 단일             ─────────────
[관리] 리포트·설정·사용자·알림 ← D1·D3·D4·D5  (하단 고정) ⚙ 설정   ← 단일 진입점
                                             · 알림 → 헤더 벨
                                             · 사용자 → 설정 페이지 탭으로 환원
```
(engineer/team_lead/sales/c_level 트리는 §부록 참조 — 동일 원칙 적용)

---

## 4. 프론트 전달용 스펙 (구현 시)

- **S1 설정 분리(D1·D3)**: `Sidebar.tsx:175-176` settings·users nav 삭제, `NavKey`에서 제거. 하단 고정 `⚙ 설정` 행 신규(admin 게이트, `<nav>` 밖, → `/settings` 기본탭). 세부는 기존 10탭이 담당.
- **S2 단일섹션 평탄화(D2)**: `SectionKey`에서 infra·knowledge 제거→`assetsKnowledge`("자산·지식") 추가, {inventory,kb} 병합. sales/c_level 섹션 제거→무제목 그룹. ko/en `nav.sections` 동기화.
- **S3 알림 재배치(D4)**: 사이드바 notifications 전역 삭제. 도달성: 데스크톱=헤더 벨(`layout.tsx:403`)✅ 모바일=`MobileMoreSheet`(`layout.tsx:86`)✅ — 추가 작업 0.
- **S4 reports 승격(D5)**: team_lead/admin은 reports를 admin섹션→리딩 무제목 그룹으로. engineer 미노출 유지.
- **S5 CommandPalette 정합(D6)**: NAV_ITEMS를 최종 트리와 1:1 미러로 갱신.
- **P1 Sales contracts 추가**: `SALES_SECTIONS`에 contracts 포함.

### 구현 규모(잠정): frontend M (Sidebar.tsx + CommandPalette.tsx + messages ko/en + layout.tsx breadcrumb). 백엔드 변경 0. 라우트/페이지 삭제 0(사이드바 노출만 조정).

---

## 5. 사용자 결정 필요 (구현 착수 전)

| # | 결정 | 옵션 | 리더 권고 |
|---|---|---|---|
| **Q1** | engineer/team_lead의 **고객·계약**을 사이드바에서 강등(티켓 딥링크만)할지 | 유지 / 강등 | **유지** — 강등은 실사용 데이터 후 재판단 |
| **Q2** | **자동화·서비스카탈로그**(초기 셋업 성격) 위치 | 서비스관리 최하단 유지 / 설정 하위로 이동 | **서비스관리 최하단 유지** — 이동은 다음 웨이브 |
| **Q3** | 헤더 UserMenu의 설정 항목 존치 여부(하단 기어와 병존) | 존치 / 제거 | **존치** — 드롭다운이라 하드중복 아님 |

> Q1~Q3는 부차적. 핵심 개편(설정/사용자 중복 제거·알림 벨 이관·단일섹션 평탄화·reports 승격·sales contracts)은 두 진단이 일치해 **결정 불요, 바로 구현 가능**.

---

## 부록 — 나머지 역할 after 트리

- **Engineer**: 홈 / [작업]티켓·작업시간 / [서비스관리]변경요청·문제·SLA / [고객]고객·계약 / [자산·지식]인프라·지식베이스 (알림→벨)
- **Team Lead**: 홈·리포트 / [작업]티켓·작업시간 / [서비스관리]변경요청·문제·SLA·자동화·카탈로그 / [고객]고객·계약 / [자산·지식]인프라·지식베이스
- **Sales**: 홈·리포트·고객·계약 (무제목 1그룹)
- **C-Level**: 홈·리포트 (무제목 1그룹)

## 관련 파일
`frontend/components/layout/Sidebar.tsx` · `.../layout.tsx` · `.../settings/page.tsx` · `components/layout/CommandPalette.tsx` · `messages/ko.ts`(+`en.ts`) · `lib/auth.ts`(게이팅 유지)

## Sources
Linear(personalized sidebar/workspaces) · Zendesk(Admin Center/Agent Workspace) · Freshservice(navigation) — 상세 URL은 uiux 진단 원문.
