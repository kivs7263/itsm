# ITSM — backend 패턴 (프로젝트 전용)

> 전역 `~/.claude/patterns/backend.md`에서 이동한 ITSM 고유 패턴 (2026-07-03 증류). 범용 아님.

| 패턴 | 요약 | 발동 | 효과 | 스택 | 검증# | 태그 |
|---|---|---|---|---|---|---|
| bridge_service business_id 필터 | compute_kpi()에서 tenant_id 단독 집계 금지 — tickets→contracts→linked_business_id JOIN으로 business 격리. user_hours/risk_band/retention_risk_score BIZCARD-A에서 추가 | ★★ | +버그방지 | fastapi+pg | 1 | bizcard |
| Meili add_documents PK 추론 실패 — id·tenant_id 다중 후보 | Meilisearch add_documents가 primary_key 미지정 시 'id'·'tenant_id' 등 id로 끝나는 필드 2개+ 있으면 'index_primary_key_multiple_candidates_found'로 인덱싱 태스크 실패(비동기라 앱은 모름)→검색 전면 무효(인덱스 0docs). init_indexes의 create_index(primaryKey)도 인덱스가 PK없이 자동선생성(add_documents/update_settings)되면 index_already_exists로 삼켜짐. 근본수정=add_documents(docs, primary_key='id') 명시(빈 인덱스면 PK설정됨). 기존 PK-None 인덱스는 삭제후 재색인. 증상: 티켓 생성돼도 검색 0건 | □ | +버그방지 | - | 0 | search |
| 대량 import 행단위 savepoint + audit run 별도세션 | CSV/JSON 대량 upsert: 각 행 'async with db.begin_nested()'+flush로 격리(오류행만 롤백·부분성공)·메인 commit 후 import_run을 별도 AsyncSessionLocal 독립커밋(이력기록 실패가 upsert 커밋 안 깸·graceful). dedup 우선순위(hostname>ip>name) is None 게이트 체이닝·enum O(1) set 검증·MAX_ROWS 가드(DoS)·utf-8-sig→cp949 strict(손상 식별자 차단). CIChangeLog enum 비교는 .value 정규화 후 _val_to_str. (ITSM CA-P2-5 cmdb_import) | □ | +버그방지 | - | 0 | orm |
