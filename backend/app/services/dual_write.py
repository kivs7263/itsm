"""dual_write.py — Phase RX-2 이중쓰기 헬퍼 (ADR-043 §4).

규칙 (백필 기준, 마이그레이션 058):
  companies.id == account customer.id
  sites.id    == division customer.id  |  sites.company_id == division.parent_id
  contacts.id == customer_contact.id

resolve_company_site():
  customer_id → (company_id, site_id)
  - kind='account'  → (customer_id, None)
  - kind='division' → (parent_id, customer_id)  — parent_id IS NULL이면 (None, None)
  - row 없음        → (None, None)
"""
from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.customer import Customer


async def resolve_company_site(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    customer_id: uuid.UUID | None,
) -> tuple[uuid.UUID | None, uuid.UUID | None]:
    """customer_id → (company_id, site_id).

    kind='account'  → (customer_id, None)
    kind='division' → (parent_id, customer_id)
    customer_id is None 또는 row 미존재 또는 고아 division → (None, None)
    """
    if customer_id is None:
        return None, None

    row = await db.scalar(
        select(Customer).where(
            Customer.id == customer_id,
            Customer.tenant_id == tenant_id,
        )
    )
    if row is None:
        return None, None

    if row.kind == "account":
        return customer_id, None

    if row.kind == "division":
        if row.parent_id is None:
            # 고아 division — Unknown Company 연계 없이 이중쓰기 스킵
            return None, None
        return row.parent_id, customer_id

    return None, None
