# ADR-043: 고객 데이터 모델 전면 재설계 (Company / Site / Contact 3정규화)

- **상태**: 승인
- **결정일**: 2026-07-03
- **결정자**: 제품팀 + 아키텍처팀

---

## 컨텍스트

현행 `customers` 테이블은 "회사"(kind=account)와 "부서·지점"(kind=division)을 단일 테이블로 겸용한다.
추가로 `customer_contacts`가 별도 테이블로 추가(P6-3)되었으나, `customers.email/phone`과 정본이 중복된다.
이 설계는 B2B/MSP ITSM의 실제 운영 요구(다지점 관리, 현장 방문, 지점별 SLA, 지점별 자산 귀속)를
수용하지 못한다.

### 진단된 구체적 문제점

| 위치 | 문제 |
|---|---|
| `customers.kind` (account/division) | 조직(법인)과 하위 단위를 동일 테이블에 혼재 — 쿼리마다 `WHERE kind=` 필터 필수 |
| `customers.company` (String(200)) | 회사명을 FK가 아닌 자유 텍스트로 저장 — 조인 불가, 오탈자 이슈 |
| `customers.email/phone` vs `customer_contacts.email/phone` | 정본이 두 곳에 존재 — 동기화 책임 불명확 |
| `tickets.customer_id` 단독 | 요청자 개인(`contact`) 링크 없음 — "누가 요청했는가"를 사람 단위로 추적 불가 |
| `assets.location` (JSONB) | 지점(Site) 개념 없이 비정형 JSON — 지점별 자산 집계 불가 |
| `configuration_items.customer_id` | CI가 회사에 귀속되나 지점 단위 귀속 불가 |
| `contracts.customer_id` | 지점(지사)별 계약 분리 불가 |

### 참조 표준

B2B ITSM 업계 표준 관계 모델은 **Account(Company) ↔ Location(Site) ↔ Contact** 3계층을 사용한다.

- **ServiceNow**: `cmn_company` → `cmn_location` → `sys_user` / `customer_contact`
  https://developer.servicenow.com/dev.do#!/reference/api/washington/server/no-namespace/c_TableAPI
- **BMC Helix ITSM**: Company → Site → People 3티어 (BMC Helix Data Management Guide 22.x, §Customer Data Model)
  https://docs.bmc.com/docs/helixitsm/2201/configuring-the-company-site-and-people-structure-1001569046.html
- **ConnectWise PSA**: Company → Site → Contact (MSP 표준 모델)
  https://developer.connectwise.com/Products/ConnectWise_PSA/REST#tag/CompanySites

---

## 결정

### 1. 목표 스키마 — 3정규화 ERD

```
tenants
  │
  ├─► companies (NEW — 법인/고객사)
  │     id UUID PK
  │     tenant_id UUID FK→tenants NOT NULL
  │     name VARCHAR(200) NOT NULL
  │     industry VARCHAR(100)
  │     contract_grade VARCHAR(50)          -- 구 customers.contract_grade 승계
  │     linked_business_id UUID             -- ERP 연동 키 (구 customers.linked_business_id)
  │     website VARCHAR(500)
  │     memo TEXT
  │     created_at TIMESTAMPTZ NOT NULL
  │     updated_at TIMESTAMPTZ NOT NULL
  │     INDEX (tenant_id, name)
  │     INDEX (tenant_id, contract_grade)
  │
  ├─► sites (NEW — 지점/사무소/현장)
  │     id UUID PK
  │     tenant_id UUID FK→tenants NOT NULL
  │     company_id UUID FK→companies NOT NULL   -- 반드시 특정 회사에 귀속
  │     name VARCHAR(200) NOT NULL              -- 지점명 (예: "판교 본사", "부산 지사")
  │     address JSONB                           -- {line1, line2, city, state, country, postal_code}
  │     phone VARCHAR(50)
  │     timezone VARCHAR(100)                   -- 'Asia/Seoul'
  │     is_headquarters BOOLEAN DEFAULT false
  │     created_at TIMESTAMPTZ NOT NULL
  │     updated_at TIMESTAMPTZ NOT NULL
  │     INDEX (tenant_id, company_id)
  │
  └─► contacts (NEW — 담당자/연락처 개인)
        id UUID PK
        tenant_id UUID FK→tenants NOT NULL
        company_id UUID FK→companies NOT NULL
        site_id UUID FK→sites NULLABLE         -- 주로 상주하는 지점 (선택)
        name VARCHAR(200) NOT NULL
        role VARCHAR(100)                      -- 직책 (예: "IT 팀장", "구매 담당")
        email VARCHAR(255)
        phone VARCHAR(50)
        is_primary BOOLEAN DEFAULT false       -- 회사 대표 연락처 여부
        memo TEXT
        created_at TIMESTAMPTZ NOT NULL
        updated_at TIMESTAMPTZ NOT NULL
        INDEX (tenant_id, company_id)
        INDEX (tenant_id, email)
```

#### 기존 테이블 흡수/승격 매핑

| 구 테이블/컬럼 | 신 테이블/컬럼 | 비고 |
|---|---|---|
| `customers WHERE kind='account'` | `companies` | name, contract_grade, linked_business_id 직접 이관 |
| `customers WHERE kind='division'` | `sites` | name→name, parent_id→company_id (부모가 account인 row 기준) |
| `customers.email` (kind=account) | `contacts.email` (is_primary=true) | 회사에 email이 있으면 primary contact 자동 생성 |
| `customers.phone` (kind=account) | `contacts.phone` (is_primary=true) | 동일 |
| `customers.company` (String) | 폐기 | 구 설계 잔재 — 회사명은 `companies.name`이 정본 |
| `customer_contacts` 전체 행 | `contacts` | customer_id→company_id, 기존 PK는 contacts.id로 유지 |
| `customer_notes` | `company_notes` (이름 변경) | customer_id→company_id FK 재배선, 테이블 rename |

### 2. 관계 재배선

#### tickets 변경

```sql
-- 추가 (모두 NULLABLE — 하위호환 유지)
tickets.company_id          UUID FK→companies  ON DELETE SET NULL
tickets.site_id             UUID FK→sites      ON DELETE SET NULL
tickets.requester_contact_id UUID FK→contacts  ON DELETE SET NULL

-- 유지 (하위호환 — 이중쓰기 기간 동안 병행)
tickets.customer_id         UUID FK→customers  ON DELETE SET NULL  (기존 유지)
```

**requester_contact_id 도입 목적**: 티켓을 "어느 회사에서 왔는가"(company_id) + "누가 요청했는가"(requester_contact_id) 두 차원으로 분리. 현재 customer_id 하나로는 회사 단위 집계만 가능하고 개인 요청자 추적이 불가능하다.

#### assets 변경

```sql
assets.company_id   UUID FK→companies  ON DELETE CASCADE  (신규, NULLABLE 추가 후 NOT NULL 전환)
assets.site_id      UUID FK→sites      ON DELETE SET NULL  (신규, NULLABLE)
-- assets.customer_id 는 이중쓰기 기간 후 DROP
-- assets.location JSONB 는 유지 (site와 병행 — 상세 좌표/건물층 등 보완 용도)
```

#### contracts 변경

```sql
contracts.company_id  UUID FK→companies  ON DELETE CASCADE  (신규, NULLABLE 추가 후 NOT NULL 전환)
-- contracts.customer_id 는 이중쓰기 기간 후 DROP
```

#### configuration_items 변경

```sql
configuration_items.company_id  UUID FK→companies  ON DELETE SET NULL  (신규)
configuration_items.site_id     UUID FK→sites      ON DELETE SET NULL  (신규)
-- configuration_items.customer_id 는 이중쓰기 기간 후 DROP
```

### 3. 마이그레이션 전략 — 무중단 6단계 백필

> 각 단계는 별도 Alembic revision. 단계 간 검증 쿼리 통과 후 다음 단계 진행.
> 현재 head: migration 056. 신규 revision: 057~062.

#### Phase 1 — 신 테이블 생성 (Rev 057)

```
신 테이블 CREATE TABLE: companies, sites, contacts
이전 테이블·FK 변경 없음 — 순수 추가, 롤백=DROP TABLE 3개
```

**롤백 스크립트**:
```sql
DROP TABLE IF EXISTS contacts;
DROP TABLE IF EXISTS sites;
DROP TABLE IF EXISTS companies;
```
**롤백 기준**: 생성 중 오류 발생 시 즉시. 영향 범위 없음.

#### Phase 2 — 데이터 백필 (Rev 058)

```sql
-- 1) customers.kind='account' → companies
INSERT INTO companies (id, tenant_id, name, industry, contract_grade, linked_business_id, created_at, updated_at)
SELECT id, tenant_id, name, NULL, contract_grade, linked_business_id, created_at, updated_at
FROM customers WHERE kind = 'account';

-- 2) customers.kind='division' → sites (parent가 account인 row만)
INSERT INTO sites (id, tenant_id, company_id, name, created_at, updated_at)
SELECT c.id, c.tenant_id, c.parent_id, c.name, c.created_at, c.updated_at
FROM customers c
WHERE c.kind = 'division' AND c.parent_id IN (SELECT id FROM companies);

-- 3) customer_contacts → contacts
INSERT INTO contacts (id, tenant_id, company_id, site_id, name, role, email, phone, is_primary, memo, created_at, updated_at)
SELECT cc.id, cc.tenant_id, cc.customer_id, NULL, cc.name, cc.role, cc.email, cc.phone, cc.is_primary, cc.memo, cc.created_at, cc.updated_at
FROM customer_contacts cc;

-- 4) customers.kind='account' 중 email이 있으면서 is_primary contact 없는 경우 → primary contact 자동 생성
INSERT INTO contacts (id, tenant_id, company_id, name, email, phone, is_primary, created_at, updated_at)
SELECT gen_random_uuid(), c.tenant_id, c.id, c.name, c.email, c.phone, true, now(), now()
FROM customers c
WHERE c.kind = 'account'
  AND (c.email IS NOT NULL OR c.phone IS NOT NULL)
  AND NOT EXISTS (
    SELECT 1 FROM contacts ct WHERE ct.company_id = c.id AND ct.is_primary = true
  );
```

**검증 쿼리** (백필 직후 실행 — 0건이어야 통과):
```sql
-- 회사 수 불일치 검증
SELECT COUNT(*) FROM customers WHERE kind='account'
MINUS
SELECT COUNT(*) FROM companies;  -- 0이어야 함

-- 지점 수 불일치 검증
SELECT COUNT(*) FROM customers WHERE kind='division' AND parent_id IN (SELECT id FROM companies)
MINUS
SELECT COUNT(*) FROM sites;  -- 0이어야 함

-- 연락처 누락 검증
SELECT COUNT(*) FROM customer_contacts cc
WHERE NOT EXISTS (SELECT 1 FROM contacts ct WHERE ct.id = cc.id);  -- 0이어야 함
```

**롤백 스크립트**:
```sql
TRUNCATE TABLE contacts, sites, companies CASCADE;
```
**롤백 기준**: 검증 쿼리 비통과 시. 데이터 손실 없음(원본 테이블 유지).

#### Phase 3 — 기존 테이블에 신규 FK 컬럼 추가 (Rev 059)

```sql
-- 모두 NULLABLE — 앱이 아직 읽지 않으므로 무중단
ALTER TABLE tickets
  ADD COLUMN company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
  ADD COLUMN site_id UUID REFERENCES sites(id) ON DELETE SET NULL,
  ADD COLUMN requester_contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL;

ALTER TABLE assets
  ADD COLUMN company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  ADD COLUMN site_id UUID REFERENCES sites(id) ON DELETE SET NULL;

ALTER TABLE contracts
  ADD COLUMN company_id UUID REFERENCES companies(id) ON DELETE CASCADE;

ALTER TABLE configuration_items
  ADD COLUMN company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
  ADD COLUMN site_id UUID REFERENCES sites(id) ON DELETE SET NULL;
```

**롤백 스크립트**: 각 테이블에서 해당 컬럼 DROP. FK 제약만 있고 데이터 없음 — 무손실.

#### Phase 4 — FK 컬럼 백필 (Rev 060)

```sql
-- tickets: customer_id → company_id 매핑 (customer가 account 타입인 경우)
UPDATE tickets t
SET company_id = c.id
FROM customers c
WHERE t.customer_id = c.id AND c.kind = 'account';

-- tickets: customer_id가 division인 경우 → 부모 company로 매핑
UPDATE tickets t
SET company_id = c.parent_id
FROM customers c
WHERE t.customer_id = c.id AND c.kind = 'division' AND c.parent_id IS NOT NULL;

-- assets: customer_id → company_id
UPDATE assets a
SET company_id = c.id
FROM customers c
WHERE a.customer_id = c.id AND c.kind = 'account';

-- contracts: customer_id → company_id
UPDATE contracts ct
SET company_id = c.id
FROM customers c
WHERE ct.customer_id = c.id AND c.kind = 'account';

-- configuration_items: customer_id → company_id
UPDATE configuration_items ci
SET company_id = c.id
FROM customers c
WHERE ci.customer_id = c.id AND c.kind = 'account';
```

**검증 쿼리** (0건이어야 통과):
```sql
-- 매핑 누락: tickets에 customer_id는 있으나 company_id가 NULL인 케이스
SELECT COUNT(*) FROM tickets
WHERE customer_id IS NOT NULL AND company_id IS NULL;  -- 0이어야 함

-- assets 동일
SELECT COUNT(*) FROM assets
WHERE customer_id IS NOT NULL AND company_id IS NULL;  -- 0이어야 함

-- contracts 동일
SELECT COUNT(*) FROM contracts
WHERE customer_id IS NOT NULL AND company_id IS NULL;  -- 0이어야 함
```

#### Phase 5 — 호환성 뷰 + 인덱스 (Rev 061)

```sql
-- 기존 customers 라우터가 READ 시 참조 가능하도록 호환 뷰 생성
CREATE VIEW customers_compat AS
SELECT
  id, tenant_id, name,
  NULL::VARCHAR AS email,   -- 정본은 contacts 테이블
  NULL::VARCHAR AS phone,
  NULL::VARCHAR AS company,
  contract_grade,
  linked_business_id,
  NULL::UUID AS parent_id,
  'account'::VARCHAR AS kind,
  created_at, updated_at
FROM companies

UNION ALL

SELECT
  id, tenant_id, name,
  NULL, NULL, NULL, NULL, NULL,
  company_id AS parent_id,
  'division'::VARCHAR AS kind,
  created_at, updated_at
FROM sites;

-- 성능 인덱스 (Phase 3~4 이후)
CREATE INDEX ix_tickets_company ON tickets(tenant_id, company_id);
CREATE INDEX ix_tickets_requester_contact ON tickets(tenant_id, requester_contact_id);
CREATE INDEX ix_assets_company ON assets(tenant_id, company_id);
CREATE INDEX ix_assets_site ON assets(tenant_id, site_id);
CREATE INDEX ix_contracts_company ON contracts(tenant_id, company_id);
CREATE INDEX ix_ci_company ON configuration_items(tenant_id, company_id);
```

#### Phase 6 — 구 컬럼 폐기 (Rev 062, 별도 배포 — 앱 이중쓰기 완료 확인 후)

```sql
-- 선행 조건: 앱이 company_id/site_id/requester_contact_id를 완전히 사용하고
--           customer_id 참조 코드가 0건임을 코드 grep으로 확인 후 실행

ALTER TABLE tickets DROP COLUMN customer_id;
ALTER TABLE assets DROP COLUMN customer_id;
ALTER TABLE contracts DROP COLUMN customer_id;
ALTER TABLE configuration_items DROP COLUMN customer_id;
DROP VIEW IF EXISTS customers_compat;
ALTER TABLE customer_notes RENAME TO company_notes;
ALTER TABLE company_notes RENAME COLUMN customer_id TO company_id;
-- customers, customer_contacts 테이블은 아카이브 후 DROP (별도 배치)
```

**롤백 스크립트**: Rev 062는 파괴적 변경이므로 실행 전 전체 DB 스냅샷 필수.
**롤백 기준**: Rev 062 실행 전 스테이징에서 3일 이상 이중쓰기 검증 완료된 경우에만 프로덕션 적용.

---

### 4. 하위호환 계획

#### 앱 이중쓰기 기간 (Phase 3~5 배포 후 ~ Phase 6 이전)

| 레이어 | 전략 |
|---|---|
| 백엔드 라우터 `/customers` | 기존 그대로 유지. 내부에서 `companies` 조회 후 구 포맷으로 직렬화하여 응답 |
| 백엔드 라우터 `/customer_contacts` | 기존 유지. 내부적으로 `contacts` 테이블 참조 |
| 티켓 생성 API | `customer_id` 수신 시 → company_id 자동 매핑 후 두 컬럼 동시 쓰기 |
| 자산/계약 API | 동일 이중쓰기 |
| 프론트엔드 | Phase 6 전까지 코드 변경 불필요 — 기존 API 포맷 유지 |

#### 호환 라우트 유지 기간

Rev 062 배포 후 최소 4주간 `/customers` deprecated 헤더 응답. 이후 `410 Gone` 전환.

---

### 5. 리스크 및 완화

#### 리스크 Top 3

**R1 — 데이터 불일치: `customers.kind='division'`의 parent_id가 NULL인 고아 레코드**

- 현상: `customers WHERE kind='division' AND parent_id IS NULL` 행은 `sites` 백필 대상에서 제외됨 — 해당 티켓/자산의 company_id가 NULL로 남음
- 완화: Phase 2 이전 진단 쿼리 실행 → 고아 레코드 수동 검토 및 처리
- 진단: `SELECT COUNT(*) FROM customers WHERE kind='division' AND parent_id IS NULL;`
- 대응: 스테이징에서 발견 시 임시 "Unknown Company" 레코드 생성 후 귀속

**R2 — 55개 누적 마이그레이션 위 대형 변환 — Alembic autogenerate 충돌**

- 현상: Rev 057~062 실행 중 autogenerate가 기존 constraints를 잘못 감지하여 DROP 시도 가능
- 완화: 각 revision을 `--autogenerate` 없이 수동 작성. `alembic check`로 drift 사전 검증. 스테이징에서 full migration 리허설 후 diff 0 확인
- 진단: `docker exec itsm_backend alembic check` (변경 없이 실행 시 "No new upgrade operations detected" 기대)

**R3 — 장기 이중쓰기 기간 중 데이터 동기화 누락**

- 현상: 일부 API 엔드포인트가 이중쓰기 누락 → company_id NULL이 늘어남
- 완화: Prometheus alert 추가 — `company_id IS NULL AND customer_id IS NOT NULL` 비율 1% 초과 시 알림
- 검증 쿼리 (일배치 실행):
  ```sql
  SELECT 'tickets' as tbl, COUNT(*) as unsynced
  FROM tickets WHERE customer_id IS NOT NULL AND company_id IS NULL
  UNION ALL
  SELECT 'assets', COUNT(*) FROM assets WHERE customer_id IS NOT NULL AND company_id IS NULL
  UNION ALL
  SELECT 'contracts', COUNT(*) FROM contracts WHERE customer_id IS NOT NULL AND company_id IS NULL;
  ```

#### 스테이징 리허설 체크리스트

- [ ] 스테이징 DB에 프로덕션 anonymized 데이터 복제
- [ ] Rev 057~061 순차 실행 후 각 검증 쿼리 통과 확인
- [ ] 기존 API `/customers`, `/tickets`, `/assets`, `/contracts` 전체 E2E 테스트 통과
- [ ] `alembic downgrade -1` 각 단계별 롤백 성공 확인
- [ ] `companies / sites / contacts` 카운트 = 구 테이블 기대값과 일치
- [ ] 고아 레코드(division without parent) 수 = 0 (또는 처리 계획 완료)
- [ ] Rev 062 실행 직전 DB 전체 스냅샷 검증

---

### 6. 대안 비교

#### (a) 전면 3분리 — companies / sites / contacts [채택]

모든 관계 테이블(tickets, assets, contracts, CI)을 신 FK로 전환. 6단계 무중단 마이그레이션.

장점:
- 스키마 명확성 — kind/division 혼용 완전 제거
- 지점별 SLA, 지점별 자산 집계 즉시 가능
- ServiceNow/ConnectWise 호환 관계 모델 → 향후 연동 용이
- `requester_contact_id` 도입으로 사람 단위 요청자 추적 가능

단점:
- 마이그레이션 복잡도 높음 (6 revision, 이중쓰기 기간 필요)
- 앱 전 계층(라우터, 서비스, 프론트) 동시 수정 필요

#### (b) 점진 — Company만 분리, Site 후순위 [기각]

`customers.kind='account'`만 `companies`로 이관하고 division/site는 현행 유지. contacts는 `customer_contacts` 그대로.

장점: 마이그레이션 1~2단계로 축소, 즉시 실행 가능.

기각 이유:
- division 개념이 여전히 customers 테이블에 잔류 → 근본 문제 미해결
- 지점별 자산 귀속이 불가 — 6개월 내 동일 작업 재수행 필요
- contacts가 두 곳(customers + customer_contacts)에 분산 지속 → 정본 불명확 문제 그대로
- 점진 방식이 이중쓰기 복잡도를 오히려 2배로 만듦 (구→반구→신 3단계 전환)

#### 채택 이유 요약

전면 3분리는 1회성 고난도 마이그레이션이지만, 이후 모든 B2B 운영 패턴(다지점, 담당자 트래킹, CI 귀속)이
추가 스키마 변경 없이 수용된다. 점진 방식은 단기 안전하지만 6개월 내 재작업이 확실하다.

---

## 결과

- Migration 057: `companies`, `sites`, `contacts` 테이블 생성
- Migration 058: 기존 `customers` / `customer_contacts` 데이터 백필
- Migration 059: `tickets`, `assets`, `contracts`, `configuration_items`에 신규 FK 컬럼 추가 (NULLABLE)
- Migration 060: 신규 FK 컬럼 백필 (`customer_id` → `company_id` 매핑)
- Migration 061: `customers_compat` 호환 뷰 생성 + 성능 인덱스
- Migration 062: (이중쓰기 검증 완료 후) 구 컬럼 폐기, `customer_notes` → `company_notes` rename
- 앱 이중쓰기 기간: Rev 061 배포 후 최소 2주
- 프론트엔드 영향: Phase 6 이전까지 기존 API 포맷 유지로 변경 불필요
- 신규 API: `GET /companies`, `GET /companies/{id}/sites`, `GET /companies/{id}/contacts`
- `Ticket.requester_contact_id` 도입으로 요청자 개인 단위 KPI 집계 가능
