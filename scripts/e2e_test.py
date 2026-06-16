"""
ITSM ↔ SA End-to-End 테스트 스크립트
- SA 사업카드 생성 → ITSM 고객/계약/티켓/공수 생성 → bridge 실행 → SA KPI 검증
"""
import asyncio
import uuid
from datetime import date, datetime, timedelta, UTC

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker

# ── DB 연결 ───────────────────────────────────────────────────────────────────
ITSM_DB = "postgresql+asyncpg://itsm_user:itsm_dev_pw_2026@itsm_postgres_ha:5000/itsm"
SA_DB   = "postgresql+asyncpg://sauser:sapassword@postgres-ha:5432/sawo"

itsm_engine = create_async_engine(ITSM_DB, echo=False)
sa_engine   = create_async_engine(SA_DB, echo=False)
ISM = async_sessionmaker(itsm_engine, class_=AsyncSession, expire_on_commit=False)
SAM = async_sessionmaker(sa_engine,   class_=AsyncSession, expire_on_commit=False)

# ── 고정 ID ──────────────────────────────────────────────────────────────────
ITSM_TENANT = uuid.UUID("0492befc-e76e-433d-a672-bc2760caadc2")  # xiilab
SA_TENANT   = uuid.UUID("22d0abf3-906b-45dd-937e-36089677d1cb")  # xiilab
ADMIN_USER  = uuid.UUID("4b85865c-245b-4d9a-abaa-a8816accf3dc")  # kivs7263@gmail.com
ENG_USER    = uuid.UUID("ee22c147-4432-4e64-a594-2d7e25dc7e9c")  # hj.song engineer

# ── 새로 생성할 ID ────────────────────────────────────────────────────────────
# SA 사업카드
BIZ_DS_SERVER = uuid.uuid4()
BIZ_DS_SECURITY = uuid.uuid4()
BIZ_LG_FACTORY = uuid.uuid4()

# ITSM 고객
CUST_SAMSUNG    = uuid.uuid4()  # 삼성전자 (account)
CUST_DS         = uuid.uuid4()  # DS사업부 (division)
CUST_MX         = uuid.uuid4()  # MX사업부 (division)
CUST_LG         = uuid.uuid4()  # LG전자 (account)

# 계약
CONTRACT_DS_SERVER   = uuid.uuid4()
CONTRACT_DS_SEC      = uuid.uuid4()
CONTRACT_LG_FACTORY  = uuid.uuid4()

# 티켓 (7개)
T = [uuid.uuid4() for _ in range(7)]

def sep(title):
    print(f"\n{'='*60}")
    print(f"  {title}")
    print('='*60)


# ─────────────────────────────────────────────────────────────────────────────
# STEP 0: 기존 테스트 데이터 삭제
# ─────────────────────────────────────────────────────────────────────────────
async def cleanup():
    sep("STEP 0: 기존 데이터 삭제")

    async with ISM() as s:
        await s.execute(text("DELETE FROM external_notification_logs"))
        await s.execute(text("DELETE FROM portal_sessions"))
        await s.execute(text("DELETE FROM csat_surveys"))
        await s.execute(text("DELETE FROM ticket_escalations"))
        await s.execute(text("DELETE FROM ticket_work_logs"))
        await s.execute(text("DELETE FROM ticket_comments"))
        await s.execute(text("DELETE FROM sla_events"))
        await s.execute(text("DELETE FROM ticket_known_issue_links"))
        await s.execute(text("DELETE FROM recurring_alerts"))
        await s.execute(text("DELETE FROM installation_checklists"))
        await s.execute(text("DELETE FROM tickets"))
        await s.execute(text("DELETE FROM contracts"))
        await s.execute(text("DELETE FROM customer_contacts"))
        await s.execute(text("DELETE FROM customer_notes"))
        await s.execute(text("DELETE FROM customers"))
        await s.commit()
        r = await s.execute(text("SELECT COUNT(*) FROM tickets"))
        print(f"  ITSM tickets: {r.scalar()} (should be 0)")

    async with SAM() as s:
        # 테스트 사업카드 삭제 (Biz-xxx 랜덤명 및 [TEST] prefix)
        await s.execute(text("""
            DELETE FROM businesses
            WHERE tenant_id = :tid
              AND (name LIKE 'Biz-%' OR name LIKE '[TEST]%'
                   OR name IN ('한국정밀제조 FA 원격 유지보수','동방물류 WMS 운영 지원'))
        """), {"tid": SA_TENANT})
        await s.commit()
        r = await s.execute(text("SELECT COUNT(*) FROM businesses WHERE tenant_id=:tid"), {"tid": SA_TENANT})
        print(f"  SA businesses after cleanup: {r.scalar()}")

    print("  ✓ 기존 데이터 삭제 완료")


# ─────────────────────────────────────────────────────────────────────────────
# STEP 1: SA 사업카드 3개 생성
# ─────────────────────────────────────────────────────────────────────────────
async def create_sa_businesses():
    sep("STEP 1: SA 사업카드 생성")

    async with SAM() as s:
        bizs = [
            (BIZ_DS_SERVER,   "삼성전자 DS 서버 유지보수 2026",  "maintenance"),
            (BIZ_DS_SECURITY, "삼성전자 MX 보안 점검 Q2-2026",   "active"),
            (BIZ_LG_FACTORY,  "LG전자 제조라인 긴급대응 계약",   "maintenance"),
        ]
        for bid, name, btype in bizs:
            await s.execute(text("""
                INSERT INTO businesses (id, tenant_id, name, type, tags, created_at, updated_at)
                VALUES (:id, :tid, :name, :type::businesstype, '{}', NOW(), NOW())
                ON CONFLICT (id) DO NOTHING
            """), {"id": bid, "tid": SA_TENANT, "name": name, "type": btype})
            print(f"  ✓ SA 사업카드: {name}  [{bid}]")
        await s.commit()


# ─────────────────────────────────────────────────────────────────────────────
# STEP 2: ITSM 고객 생성
# ─────────────────────────────────────────────────────────────────────────────
async def create_customers():
    sep("STEP 2: ITSM 고객 생성")

    async with ISM() as s:
        custs = [
            (CUST_SAMSUNG, "삼성전자",  None,         "account", "Samsung Electronics"),
            (CUST_DS,      "DS사업부",  CUST_SAMSUNG, "division", None),
            (CUST_MX,      "MX사업부",  CUST_SAMSUNG, "division", None),
            (CUST_LG,      "LG전자",    None,         "account", "LG Electronics"),
        ]
        for cid, name, pid, kind, company in custs:
            await s.execute(text("""
                INSERT INTO customers (id, tenant_id, name, parent_id, kind, company, created_at, updated_at)
                VALUES (:id, :tid, :name, :pid, :kind, :co, NOW(), NOW())
            """), {"id": cid, "tid": ITSM_TENANT, "name": name, "pid": pid, "kind": kind, "co": company})
            parent = f" (하위: {pid})" if pid else ""
            print(f"  ✓ 고객: {name} [{kind}]{parent}")
        await s.commit()


# ─────────────────────────────────────────────────────────────────────────────
# STEP 3: ITSM 계약 생성 (SA 사업카드 연결)
# ─────────────────────────────────────────────────────────────────────────────
async def create_contracts():
    sep("STEP 3: ITSM 계약 생성 (SA 사업카드 연결)")

    async with ISM() as s:
        contracts = [
            (CONTRACT_DS_SERVER,  CUST_DS, "DS 서버 유지보수 연간 계약",   "maintenance", "gold",     BIZ_DS_SERVER,   50_000_000),
            (CONTRACT_DS_SEC,     CUST_MX, "MX 보안 점검 계약 2026-Q2",    "support",     "silver",   BIZ_DS_SECURITY, 20_000_000),
            (CONTRACT_LG_FACTORY, CUST_LG, "LG 제조라인 긴급대응 계약",    "maintenance", "platinum", BIZ_LG_FACTORY,  80_000_000),
        ]
        today = date.today()
        end   = today + timedelta(days=365)
        for cid, cust_id, name, ctype, sla, biz_id, amount in contracts:
            await s.execute(text("""
                INSERT INTO contracts
                  (id, tenant_id, customer_id, name, type, sla_grade,
                   start_date, end_date, amount, linked_business_id, created_at, updated_at)
                VALUES
                  (:id, :tid, :cust, :name, :type::contracttype, :sla,
                   :sd, :ed, :amount, :biz, NOW(), NOW())
            """), {
                "id": cid, "tid": ITSM_TENANT, "cust": cust_id,
                "name": name, "type": ctype, "sla": sla,
                "sd": today, "ed": end, "amount": amount, "biz": biz_id,
            })
            print(f"  ✓ 계약: {name}")
            print(f"       SLA={sla}, 금액={amount:,}원 → SA [{biz_id}]")
        await s.commit()


# ─────────────────────────────────────────────────────────────────────────────
# STEP 4: ITSM 티켓 생성
# ─────────────────────────────────────────────────────────────────────────────
async def create_tickets():
    sep("STEP 4: ITSM 티켓 생성")

    tickets = [
        # DS 서버 유지보수 계약 (3건)
        (T[0], CUST_DS, CONTRACT_DS_SERVER, "DS서버 NAS 스토리지 장애",      "incident",     "high",   "resolved"),
        (T[1], CUST_DS, CONTRACT_DS_SERVER, "운영 DB 백업 스케줄 설정 요청", "service_request","medium", "closed"),
        (T[2], CUST_DS, CONTRACT_DS_SERVER, "신규 서버 랙 설치 및 네트워크 구성", "installation","high", "in_progress"),
        # DS MX 보안 점검 계약 (2건)
        (T[3], CUST_MX, CONTRACT_DS_SEC,    "방화벽 정책 검토 및 취약점 스캔","technical_inquiry","medium","resolved"),
        (T[4], CUST_MX, CONTRACT_DS_SEC,    "SSL 인증서 갱신 대응",          "service_request","low",   "closed"),
        # LG 제조라인 계약 (2건)
        (T[5], CUST_LG, CONTRACT_LG_FACTORY,"PLC 컨트롤러 통신 오류 장애",   "incident",     "critical","resolved"),
        (T[6], CUST_LG, CONTRACT_LG_FACTORY,"제조라인 MES 시스템 점검",       "maintenance",  "medium", "in_progress"),
    ]

    async with ISM() as s:
        now = datetime.now(UTC)
        for i, (tid, cust, cont, title, rtype, prio, status) in enumerate(tickets):
            num  = f"TKT-{now.strftime('%Y%m%d')}-{i+1:04d}"
            resolved_at = (now - timedelta(hours=3)) if status in ("resolved","closed") else None
            closed_at   = (now - timedelta(hours=1)) if status == "closed" else None
            await s.execute(text("""
                INSERT INTO tickets
                  (id, tenant_id, customer_id, contract_id, assigned_to,
                   title, status, priority, channel, request_type,
                   ticket_number, created_at, updated_at, resolved_at, closed_at)
                VALUES
                  (:id, :tid, :cust, :cont, :usr,
                   :title, :status::ticketstatus, :prio::ticketpriority, 'internal'::ticketchannel, :rtype,
                   :num, NOW() - :offset * interval '1 hour', NOW(), :res, :cls)
            """), {
                "id": tid, "tid": ITSM_TENANT, "cust": cust, "cont": cont,
                "usr": ADMIN_USER if i < 3 else ENG_USER,
                "title": title, "status": status, "prio": prio, "rtype": rtype,
                "num": num, "offset": (i + 1) * 6,
                "res": resolved_at, "cls": closed_at,
            })
            print(f"  ✓ [{num}] {title}  ({status})")
        await s.commit()


# ─────────────────────────────────────────────────────────────────────────────
# STEP 5: 공수 기록 (ticket_work_logs)
# ─────────────────────────────────────────────────────────────────────────────
async def create_work_logs():
    sep("STEP 5: 공수 기록 (Work Logs)")

    logs = [
        # DS 서버 유지보수 계약
        (T[0], ADMIN_USER, "onsite",   4.0, True,  "현장 NAS 점검 및 디스크 교체"),
        (T[0], ENG_USER,   "remote",   1.5, True,  "원격 모니터링 및 백업 확인"),
        (T[1], ADMIN_USER, "remote",   2.0, True,  "백업 스케줄 cron 설정"),
        (T[2], ADMIN_USER, "onsite",   6.0, True,  "서버 랙 물리 설치"),
        (T[2], ENG_USER,   "onsite",   4.0, True,  "네트워크 케이블링 및 VLAN 구성"),
        (T[2], ENG_USER,   "internal", 1.0, False, "내부 구성도 작성"),
        # MX 보안 점검
        (T[3], ENG_USER,   "remote",   3.0, True,  "방화벽 룰 검토 및 취약점 리포트 작성"),
        (T[4], ENG_USER,   "remote",   1.5, True,  "SSL 갱신 및 검증"),
        # LG 제조라인
        (T[5], ADMIN_USER, "onsite",   5.0, True,  "현장 PLC 통신 진단 및 재설정"),
        (T[5], ENG_USER,   "phone",    1.0, True,  "현장 엔지니어 원격 가이드"),
        (T[6], ADMIN_USER, "onsite",   3.5, True,  "MES 시스템 점검 및 성능 측정"),
        (T[6], ENG_USER,   "remote",   2.0, False, "점검 보고서 작성 (무상)"),
    ]

    async with ISM() as s:
        total_h = 0
        for tid, uid, wtype, hours, billable, memo in logs:
            await s.execute(text("""
                INSERT INTO ticket_work_logs
                  (id, tenant_id, ticket_id, user_id, work_type, hours, billable, memo, logged_at)
                VALUES
                  (:id, :tid, :tkt, :uid, :wtype::worktype, :hours, :bill, :memo, NOW())
            """), {
                "id": uuid.uuid4(), "tid": ITSM_TENANT,
                "tkt": tid, "uid": uid,
                "wtype": wtype, "hours": hours, "bill": billable, "memo": memo,
            })
            total_h += hours
            b = "유상" if billable else "무상"
            print(f"  ✓ {hours}h [{b}] {wtype:8s} — {memo[:40]}")
        await s.commit()
    print(f"\n  총 공수: {total_h}h")


# ─────────────────────────────────────────────────────────────────────────────
# STEP 6: Bridge Worker 실행 (SA로 KPI push)
# ─────────────────────────────────────────────────────────────────────────────
async def run_bridge():
    sep("STEP 6: Bridge Worker → SA KPI Push")

    from app.services.bridge_service import compute_kpi, push_kpi

    biz_list = [
        (str(BIZ_DS_SERVER),   "삼성전자 DS 서버 유지보수 2026"),
        (str(BIZ_DS_SECURITY), "삼성전자 MX 보안 점검 Q2-2026"),
        (str(BIZ_LG_FACTORY),  "LG전자 제조라인 긴급대응 계약"),
    ]
    tenant_id = str(ITSM_TENANT)

    for biz_id, biz_name in biz_list:
        kpi = await compute_kpi(tenant_id, biz_id)
        if kpi:
            result = await push_kpi(biz_id, kpi)
            status = "✓ push 성공" if result else "⚠ push 실패 (SA 연결 없음, DB 직접 확인)"
            print(f"\n  [{biz_name}]")
            print(f"    total_tickets:     {kpi.total_tickets}")
            print(f"    open_tickets:      {kpi.open_tickets}")
            print(f"    sla_compliance:    {kpi.sla_compliance_rate:.1%}")
            print(f"    total_hours:       {kpi.total_hours}h")
            print(f"    billable_hours:    {kpi.billable_hours}h")
            print(f"    billable_ratio:    {f'{kpi.billable_ratio:.1%}' if kpi.billable_ratio else 'N/A'}")
            print(f"    actual_cost:       {f'{kpi.actual_cost:,.0f}원' if kpi.actual_cost else 'N/A'}")
            print(f"    contract_value:    {f'{kpi.contract_value:,.0f}원' if kpi.contract_value else 'N/A'}")
            print(f"    risk_band:         {kpi.risk_band}")
            print(f"    → SA: {status}")
        else:
            print(f"  ✗ [{biz_name}] KPI 계산 실패")


# ─────────────────────────────────────────────────────────────────────────────
# STEP 7: SA 사업카드 itsm_kpi 최종 확인
# ─────────────────────────────────────────────────────────────────────────────
async def verify_sa():
    sep("STEP 7: SA 사업카드 itsm_kpi 최종 확인")

    async with SAM() as s:
        biz_ids = [BIZ_DS_SERVER, BIZ_DS_SECURITY, BIZ_LG_FACTORY]
        r = await s.execute(
            text("SELECT name, itsm_kpi FROM businesses WHERE id = ANY(:ids)"),
            {"ids": biz_ids}
        )
        for row in r.fetchall():
            kpi = row.itsm_kpi
            if kpi:
                print(f"\n  ✓ [{row.name}]")
                print(f"    total_tickets:  {kpi.get('total_tickets')}")
                print(f"    total_hours:    {kpi.get('total_hours')}h")
                print(f"    billable_hours: {kpi.get('billable_hours')}h")
                print(f"    risk_band:      {kpi.get('risk_band')}")
                print(f"    synced_at:      {kpi.get('synced_at')}")
            else:
                print(f"\n  ⚠ [{row.name}] itsm_kpi 없음 — SA_BACKEND_URL 미연결 시 정상")


# ─────────────────────────────────────────────────────────────────────────────
# STEP 8: 요약
# ─────────────────────────────────────────────────────────────────────────────
async def summary():
    sep("STEP 8: 최종 데이터 요약")

    async with ISM() as s:
        for tbl, label in [
            ("customers", "고객"),
            ("contracts", "계약"),
            ("tickets",   "티켓"),
            ("ticket_work_logs", "공수 기록"),
        ]:
            r = await s.execute(text(f"SELECT COUNT(*) FROM {tbl}"))
            print(f"  ITSM {label}: {r.scalar()}건")

    async with SAM() as s:
        r = await s.execute(
            text("SELECT COUNT(*) FROM businesses WHERE id = ANY(:ids)"),
            {"ids": [BIZ_DS_SERVER, BIZ_DS_SECURITY, BIZ_LG_FACTORY]}
        )
        print(f"  SA  사업카드: {r.scalar()}건")
        r = await s.execute(
            text("SELECT COUNT(*) FROM businesses WHERE itsm_kpi IS NOT NULL AND id = ANY(:ids)"),
            {"ids": [BIZ_DS_SERVER, BIZ_DS_SECURITY, BIZ_LG_FACTORY]}
        )
        print(f"  SA  KPI 연동: {r.scalar()}건")

    print("\n  ─────────────────────────────────────────────────")
    print("  연결 구조 확인:")
    print("  SA 사업카드 → ITSM 계약 → ITSM 티켓 → 공수 → SA KPI")
    print("  ─────────────────────────────────────────────────")


# ─────────────────────────────────────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────────────────────────────────────
async def main():
    print("\n🚀 ITSM ↔ SA E2E 테스트 시작")
    await cleanup()
    await create_sa_businesses()
    await create_customers()
    await create_contracts()
    await create_tickets()
    await create_work_logs()
    await run_bridge()
    await verify_sa()
    await summary()
    print("\n✅ E2E 테스트 완료\n")

    await itsm_engine.dispose()
    await sa_engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
