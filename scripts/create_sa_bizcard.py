"""
SA 사업카드 생성 스크립트 (sa_backend 컨테이너에서 실행)
  - 기존 테스트 사업카드 삭제
  - 새 사업카드 3개 생성 (고정 UUID — e2e_itsm_seed.py 와 공유)
"""
import asyncio
import uuid

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy import text

DB_URL = "postgresql+asyncpg://sauser:sapassword@postgres-ha:5432/saworkspace"
SA_TENANT = uuid.UUID("22d0abf3-906b-45dd-937e-36089677d1cb")

# ITSM seed 스크립트와 공유하는 고정 UUID
BIZ_DS_SERVER   = uuid.UUID("a1b2c3d4-1111-4111-8111-111111111111")
BIZ_MX_SECURITY = uuid.UUID("a1b2c3d4-2222-4222-8222-222222222222")
BIZ_LG_FACTORY  = uuid.UUID("a1b2c3d4-3333-4333-8333-333333333333")

engine = create_async_engine(DB_URL, echo=False)
SM = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def main():
    print("\n🏢 SA 사업카드 셋업 시작")

    async with SM() as s:
        # 1. 기존 테스트 사업카드 삭제
        result = await s.execute(text("""
            DELETE FROM businesses
            WHERE tenant_id = :tid
              AND (name LIKE 'Biz-%'
                   OR name LIKE '[TEST]%'
                   OR name IN ('한국정밀제조 FA 원격 유지보수', '동방물류 WMS 운영 지원'))
            RETURNING name
        """), {"tid": SA_TENANT})
        deleted = [row[0] for row in result.fetchall()]
        for d in deleted:
            print(f"  🗑  삭제: {d}")
        await s.commit()

        # 2. 새 사업카드 3개 생성
        bizs = [
            (BIZ_DS_SERVER,   "삼성전자 DS사업부 서버 유지보수 2026", "maintenance"),
            (BIZ_MX_SECURITY, "삼성전자 MX사업부 보안 점검 2026-Q2", "active"),
            (BIZ_LG_FACTORY,  "LG전자 제조라인 긴급대응 계약",        "maintenance"),
        ]
        for bid, name, btype in bizs:
            await s.execute(text("""
                INSERT INTO businesses
                  (id, tenant_id, name, type, tags, created_at, updated_at)
                VALUES
                  (:id, :tid, :name, CAST(:btype AS businesstype), '{}', NOW(), NOW())
                ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, type = CAST(EXCLUDED.type AS businesstype)
            """), {"id": bid, "tid": SA_TENANT, "name": name, "btype": btype})
            print(f"  ✅ 생성: [{btype}] {name}")
            print(f"          ID: {bid}")
        await s.commit()

        # 3. 확인
        r = await s.execute(text("""
            SELECT name, type, itsm_kpi IS NOT NULL as has_kpi
            FROM businesses
            WHERE tenant_id = :tid
            ORDER BY created_at
        """), {"tid": SA_TENANT})
        rows = r.fetchall()
        print(f"\n  현재 SA 사업카드 총 {len(rows)}개:")
        for row in rows:
            print(f"    - {row[1]:12s}  {row[0]}  (kpi={'있음' if row[2] else '없음'})")

    await engine.dispose()
    print("\n✅ SA 사업카드 셋업 완료\n")


if __name__ == "__main__":
    asyncio.run(main())
