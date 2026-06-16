"""
ITSM E2E 시드 스크립트 (itsm_backend 컨테이너에서 실행)
순서:
  1. 기존 ITSM 테스트 데이터 전체 삭제
  2. 고객 생성 (삼성전자 계층 + LG전자)
  3. 계약 생성 (SA 사업카드 ID 연결)
  4. 티켓 생성 (고객 + 계약 연결)
  5. 공수 기록 생성
  6. Bridge 실행 → SA KPI push
  7. 최종 결과 요약
"""
import asyncio
import uuid
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker

DB_URL = "postgresql+asyncpg://itsm_user:itsm_dev_pw_2026@itsm_postgres_ha:5000/itsm"
engine = create_async_engine(DB_URL, echo=False)
SM = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

# ── 고정값 ────────────────────────────────────────────────────────────────────
ITSM_TENANT = uuid.UUID("0492befc-e76e-433d-a672-bc2760caadc2")
ADMIN_USER  = uuid.UUID("4b85865c-245b-4d9a-abaa-a8816accf3dc")  # kivs7263@gmail.com
ENG_USER    = uuid.UUID("448232a0-58c7-4a24-9a5a-25c339756c7a")  # hj.song@xiilab.com

# SA 사업카드 UUID (create_sa_bizcard.py 와 동일)
BIZ_DS_SERVER   = uuid.UUID("a1b2c3d4-1111-4111-8111-111111111111")
BIZ_MX_SECURITY = uuid.UUID("a1b2c3d4-2222-4222-8222-222222222222")
BIZ_LG_FACTORY  = uuid.UUID("a1b2c3d4-3333-4333-8333-333333333333")

# ITSM 신규 데이터 UUID
CUST_SAMSUNG = uuid.uuid4()   # 삼성전자 (account)
CUST_DS      = uuid.uuid4()   # DS사업부 (division)
CUST_MX      = uuid.uuid4()   # MX사업부 (division)
CUST_LG      = uuid.uuid4()   # LG전자 (account)

CONTRACT_DS_SERVER   = uuid.uuid4()
CONTRACT_MX_SECURITY = uuid.uuid4()
CONTRACT_LG_FACTORY  = uuid.uuid4()

T = [uuid.uuid4() for _ in range(7)]

NOW = datetime.now(timezone.utc)


def sep(title):
    print(f"\n{'─'*55}")
    print(f"  {title}")
    print('─'*55)


# ─────────────────────────────────────────────────────────────────────────────
async def step0_cleanup():
    sep("STEP 0: 기존 ITSM 데이터 삭제")
    async with SM() as s:
        tables_to_clear = [
            "external_notification_logs",
            "portal_sessions",
            "csat_surveys",
            "ticket_escalations",
            "ticket_work_logs",
            "ticket_comments",
            "sla_events",
            "ticket_known_issues",
            "recurring_alerts",
            "ticket_attachments",
            "ticket_causes",
            "itsm_calendar_events",
            "tickets",
            "contracts",
            "customer_contacts",
            "customer_notes",
            "customers",
        ]
        for tbl in tables_to_clear:
            r = await s.execute(text(f"DELETE FROM {tbl}"))
            if r.rowcount > 0:
                print(f"  🗑  {tbl}: {r.rowcount}건 삭제")
        await s.commit()
        print("  ✅ 완료")


# ─────────────────────────────────────────────────────────────────────────────
async def step1_customers():
    sep("STEP 1: 고객 생성")
    async with SM() as s:
        customers = [
            (CUST_SAMSUNG, "삼성전자",   None,        "account", "Samsung Electronics Co., Ltd."),
            (CUST_DS,      "DS사업부",   CUST_SAMSUNG, "division", None),
            (CUST_MX,      "MX사업부",   CUST_SAMSUNG, "division", None),
            (CUST_LG,      "LG전자",     None,        "account", "LG Electronics Inc."),
        ]
        for cid, name, pid, kind, company in customers:
            await s.execute(text("""
                INSERT INTO customers
                  (id, tenant_id, name, parent_id, kind, company, created_at, updated_at)
                VALUES (:id, :tid, :name, :pid, :kind, :co, NOW(), NOW())
            """), {"id": cid, "tid": ITSM_TENANT, "name": name,
                   "pid": pid, "kind": kind, "co": company})
            indent = "    └─ " if pid else "  "
            print(f"  {indent}✅ {name} [{kind}]")
        await s.commit()


# ─────────────────────────────────────────────────────────────────────────────
async def step2_contracts():
    sep("STEP 2: 계약 생성 (SA 사업카드 연결)")
    async with SM() as s:
        today = date.today()
        end   = today + timedelta(days=365)
        contracts = [
            # (id, customer_id, name, type, sla_grade, amount, biz_id)
            (CONTRACT_DS_SERVER,   CUST_DS, "DS사업부 서버 유지보수 연간 계약",
             "maintenance", "gold",     60_000_000, BIZ_DS_SERVER),
            (CONTRACT_MX_SECURITY, CUST_MX, "MX사업부 보안 점검 계약 2026-Q2",
             "paid",        "silver",   24_000_000, BIZ_MX_SECURITY),
            (CONTRACT_LG_FACTORY,  CUST_LG, "LG전자 제조라인 긴급대응 연간 계약",
             "maintenance", "platinum", 90_000_000, BIZ_LG_FACTORY),
        ]
        for cid, cust_id, name, ctype, sla, amount, biz_id in contracts:
            await s.execute(text("""
                INSERT INTO contracts
                  (id, tenant_id, customer_id, name, type, sla_grade,
                   start_date, end_date, amount, linked_business_id, created_at, updated_at)
                VALUES
                  (:id, :tid, :cust, :name, CAST(:type AS contract_type_enum), :sla,
                   :sd, :ed, :amount, :biz, NOW(), NOW())
            """), {
                "id": cid, "tid": ITSM_TENANT, "cust": cust_id,
                "name": name, "type": ctype, "sla": sla,
                "sd": today, "ed": end, "amount": amount, "biz": biz_id,
            })
            print(f"  ✅ {name}")
            print(f"       SLA={sla}  금액={amount:,}원  → SA [{biz_id}]")
        await s.commit()


# ─────────────────────────────────────────────────────────────────────────────
async def step3_tickets():
    sep("STEP 3: 티켓 생성")
    tickets = [
        # DS 서버 유지보수 계약 (3건)
        (T[0], CUST_DS, CONTRACT_DS_SERVER,   "DS서버 NAS 스토리지 RAID 장애",
         "incident",        "high",     "resolved", ADMIN_USER),
        (T[1], CUST_DS, CONTRACT_DS_SERVER,   "운영 DB 백업 스케줄 설정 요청",
         "service_request", "medium",   "closed",   ADMIN_USER),
        (T[2], CUST_DS, CONTRACT_DS_SERVER,   "신규 서버 랙 설치 및 네트워크 구성",
         "installation",    "high",     "in_progress", ENG_USER),
        # MX 보안 점검 계약 (2건)
        (T[3], CUST_MX, CONTRACT_MX_SECURITY, "방화벽 정책 검토 및 취약점 스캔",
         "technical_inquiry","medium",  "resolved", ENG_USER),
        (T[4], CUST_MX, CONTRACT_MX_SECURITY, "SSL 인증서 만료 대응",
         "service_request", "low",      "closed",   ENG_USER),
        # LG 제조라인 계약 (2건)
        (T[5], CUST_LG, CONTRACT_LG_FACTORY,  "제조라인 PLC 컨트롤러 통신 오류",
         "incident",        "critical", "resolved", ADMIN_USER),
        (T[6], CUST_LG, CONTRACT_LG_FACTORY,  "MES 시스템 정기 점검 및 최적화",
         "maintenance",     "medium",   "in_progress", ENG_USER),
    ]

    async with SM() as s:
        for i, (tid, cust, cont, title, rtype, prio, status, user) in enumerate(tickets):
            num = f"TKT-{NOW.strftime('%Y%m%d')}-{i+1:04d}"
            offset_h = (i + 1) * 8
            resolved_at = (NOW - timedelta(hours=2)) if status in ("resolved", "closed") else None
            closed_at   = (NOW - timedelta(hours=1)) if status == "closed" else None
            await s.execute(text("""
                INSERT INTO tickets
                  (id, tenant_id, customer_id, contract_id, assigned_to,
                   title, status, priority, channel, request_type,
                   ticket_number, created_at, updated_at, resolved_at, closed_at)
                VALUES
                  (:id, :tid, :cust, :cont, :usr,
                   :title, CAST(:status AS ticket_status_enum), CAST(:prio AS ticket_priority_enum),
                   CAST('internal' AS ticket_channel_enum), :rtype,
                   :num, NOW() - :offset * interval '1 hour', NOW(), :res, :cls)
            """), {
                "id": tid, "tid": ITSM_TENANT, "cust": cust, "cont": cont, "usr": user,
                "title": title, "status": status, "prio": prio, "rtype": rtype,
                "num": num, "offset": offset_h, "res": resolved_at, "cls": closed_at,
            })
            label = {"resolved": "✅", "closed": "🔒", "in_progress": "🔄"}.get(status, "📋")
            print(f"  {label} [{num}] {title[:40]}  ({prio}/{status})")
        await s.commit()


# ─────────────────────────────────────────────────────────────────────────────
async def step4_work_logs():
    sep("STEP 4: 공수 기록 생성 (ticket_work_logs)")
    logs = [
        # T[0]: DS NAS 장애
        (T[0], ADMIN_USER, "onsite",  4.0, True,  "현장 NAS 디스크 교체 및 RAID 재구성"),
        (T[0], ENG_USER,   "remote",  1.5, True,  "원격 모니터링 및 백업 무결성 확인"),
        # T[1]: DB 백업 설정
        (T[1], ADMIN_USER, "remote",  2.0, True,  "PostgreSQL 백업 cron 스케줄 설정"),
        # T[2]: 서버 랙 설치
        (T[2], ADMIN_USER, "onsite",  6.0, True,  "서버 랙 물리 설치 및 전원 구성"),
        (T[2], ENG_USER,   "onsite",  4.0, True,  "네트워크 케이블링 및 VLAN 설정"),
        (T[2], ENG_USER,   "internal",1.0, False, "네트워크 구성도 작성 (내부)"),
        # T[3]: 방화벽 취약점
        (T[3], ENG_USER,   "remote",  3.0, True,  "방화벽 룰 분석 및 취약점 리포트 작성"),
        # T[4]: SSL 갱신
        (T[4], ENG_USER,   "remote",  1.5, True,  "SSL 인증서 갱신 및 서비스 검증"),
        # T[5]: PLC 장애
        (T[5], ADMIN_USER, "onsite",  5.0, True,  "현장 PLC 진단 및 통신 파라미터 재설정"),
        (T[5], ENG_USER,   "phone",   1.0, True,  "현장 엔지니어 전화 가이드"),
        # T[6]: MES 점검
        (T[6], ADMIN_USER, "onsite",  3.5, True,  "MES 시스템 성능 측정 및 파라미터 튜닝"),
        (T[6], ENG_USER,   "remote",  2.0, False, "점검 결과 보고서 작성 (무상)"),
    ]

    async with SM() as s:
        total_h = billable_h = 0.0
        for tid, uid, wtype, hours, billable, memo in logs:
            await s.execute(text("""
                INSERT INTO ticket_work_logs
                  (id, tenant_id, ticket_id, user_id, work_type, hours, billable, memo, logged_at)
                VALUES
                  (:id, :tid, :tkt, :uid, CAST(:wtype AS work_type_enum), :hours, :bill, :memo, NOW())
            """), {
                "id": uuid.uuid4(), "tid": ITSM_TENANT,
                "tkt": tid, "uid": uid,
                "wtype": wtype, "hours": hours, "bill": billable, "memo": memo,
            })
            total_h += hours
            if billable:
                billable_h += hours
            b = "유상" if billable else "무상"
            print(f"  {'✅' if billable else '  '} {hours:4.1f}h [{b}] {wtype:8s} — {memo[:42]}")
        await s.commit()
    print(f"\n  총 공수: {total_h}h  유상: {billable_h}h  비율: {billable_h/total_h:.0%}")


# ─────────────────────────────────────────────────────────────────────────────
async def step5_bridge():
    sep("STEP 5: Bridge Worker 실행 → SA KPI Push")

    from app.services.bridge_service import compute_kpi, push_to_sa

    biz_list = [
        (str(BIZ_DS_SERVER),   "삼성전자 DS사업부 서버 유지보수 2026"),
        (str(BIZ_MX_SECURITY), "삼성전자 MX사업부 보안 점검 2026-Q2"),
        (str(BIZ_LG_FACTORY),  "LG전자 제조라인 긴급대응 계약"),
    ]
    tenant_id = str(ITSM_TENANT)

    for biz_id, biz_name in biz_list:
        print(f"\n  [{biz_name}]")
        kpi = await compute_kpi(tenant_id, biz_id)
        if not kpi:
            print("    ⚠  KPI 계산 결과 없음")
            continue

        print(f"    total_tickets:    {kpi.total_tickets}")
        print(f"    open_tickets:     {kpi.open_tickets}")
        print(f"    sla_compliance:   {kpi.sla_compliance_rate:.0%}")
        print(f"    total_hours:      {kpi.total_hours}h")
        print(f"    billable_hours:   {kpi.billable_hours}h")
        if kpi.actual_cost:
            print(f"    actual_cost:      {kpi.actual_cost:,.0f}원")
        if kpi.contract_value:
            print(f"    contract_value:   {kpi.contract_value:,.0f}원")
        print(f"    risk_band:        {kpi.risk_band}")

        ok = await push_to_sa(biz_id, kpi)
        print(f"    → SA push:        {'✅ 성공' if ok else '⚠  SA 연결 없음 (KPI 계산은 정상)'}")


# ─────────────────────────────────────────────────────────────────────────────
async def step6_summary():
    sep("STEP 6: 최종 데이터 요약")
    async with SM() as s:
        for tbl, label in [
            ("customers",        "고객"),
            ("contracts",        "계약"),
            ("tickets",          "티켓"),
            ("ticket_work_logs", "공수 기록"),
        ]:
            r = await s.execute(text(f"SELECT COUNT(*) FROM {tbl}"))
            print(f"  ITSM {label:8s}: {r.scalar():3d}건")

        # 계약별 티켓 수
        r = await s.execute(text("""
            SELECT c.name, COUNT(t.id) as cnt,
                   SUM(wl.hours) as total_h,
                   SUM(CASE WHEN wl.billable THEN wl.hours ELSE 0 END) as bill_h
            FROM contracts c
            LEFT JOIN tickets t ON t.contract_id = c.id
            LEFT JOIN ticket_work_logs wl ON wl.ticket_id = t.id
            GROUP BY c.id, c.name
            ORDER BY c.name
        """))
        print()
        for row in r.fetchall():
            th = float(row.total_h or 0)
            bh = float(row.bill_h or 0)
            print(f"  📋 {row.name}")
            print(f"     티켓 {row.cnt}건  공수 {th}h (유상 {bh}h)")

    print(f"\n  연결 구조:")
    print("  SA 사업카드 ← ITSM 계약 ← ITSM 티켓 ← 공수 기록 → SA KPI")


# ─────────────────────────────────────────────────────────────────────────────
async def main():
    print("\n🚀 ITSM E2E 시드 시작")
    await step0_cleanup()
    await step1_customers()
    await step2_contracts()
    await step3_tickets()
    await step4_work_logs()
    await step5_bridge()
    await step6_summary()
    await engine.dispose()
    print("\n✅ E2E 시드 완료\n")


if __name__ == "__main__":
    asyncio.run(main())
