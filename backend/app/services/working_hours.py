"""업무시간 기반 SLA deadline 계산 서비스 (CA-P1-6).

공개 API:
    compute_working_deadline(base_utc, minutes, business_hours, tz_name, holidays) -> datetime
        순수함수 — DB 의존 없음, 단위테스트 용이.

    _load_business_calendar(db, tenant_id) -> dict | None
        테넌트 캘린더 로드. 없으면 None(벽시계 fallback 신호).
"""
from __future__ import annotations

import logging
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

# ISO weekday (Mon=0 … Sun=6) → business_hours_json 키
_WEEKDAY_MAP: dict[int, str] = {
    0: "mon",
    1: "tue",
    2: "wed",
    3: "thu",
    4: "fri",
    5: "sat",
    6: "sun",
}

# 무한루프 가드: base 날짜로부터 이 일수를 초과하면 벽시계 fallback
_MAX_SEARCH_DAYS = 14


# ---------------------------------------------------------------------------
# 순수함수 — 업무시간 누적 deadline 계산
# ---------------------------------------------------------------------------


def compute_working_deadline(
    base_utc: datetime,
    minutes: int,
    business_hours: dict[str, list[list[str]]],
    tz_name: str,
    holidays: list[str],
) -> datetime:
    """업무시간(working-seconds 누적) 기반 SLA deadline 계산.

    Args:
        base_utc:       기준 시각 (UTC, timezone-aware).
        minutes:        소모할 업무시간 (분). 0이면 현재 업무중이면 base 반환,
                        업무외면 다음 업무 개시 시각 반환.
        business_hours: 요일별 영업 구간. 키: mon/tue/wed/thu/fri/sat/sun,
                        값: [["HH:MM","HH:MM"], ...] (빈 리스트=휴무).
        tz_name:        IANA timezone 이름 (예: "Asia/Seoul").
        holidays:       공휴일 목록 ["YYYY-MM-DD", ...] (해당일 종일 휴무).

    Returns:
        deadline datetime (UTC, timezone-aware).

    알고리즘:
        1. base_utc → tz_name 로컬 변환. remaining = minutes.
        2. cursor 날짜가 공휴일/업무외 날이면 다음 날 00:00으로 전진.
        3. 해당 날의 영업 구간을 순서대로 순회:
           - cursor가 구간 이전이면 구간 시작으로 전진.
           - cursor가 구간 내에 있으면 remaining을 소비:
             - remaining ≤ 구간 잔여분 → cursor += remaining → 반환.
             - remaining > 구간 잔여분 → remaining -= 잔여분, cursor = 구간 끝.
        4. 오늘 구간을 모두 소진하면 다음 날 00:00으로 전진, 반복.
        5. 무한루프 가드: base 날짜 기준 14일 초과 탐색 시 벽시계 fallback
           (설정 오류·전 요일 휴무 등 병적 케이스 대비).

    DST:
        구간 경계는 로컬 벽시계 기준. zoneinfo가 UTC offset 변환을 처리.
    """
    from zoneinfo import ZoneInfo

    tz = ZoneInfo(tz_name)
    base_local = base_utc.astimezone(tz)
    cursor = base_local
    holiday_set: set[str] = set(holidays)
    remaining: int = minutes
    base_date: date = base_local.date()

    def _intervals(d: date) -> list[tuple[datetime, datetime]]:
        """해당 날짜의 영업 구간 리스트 (start, end) — 공휴일이면 빈 리스트."""
        if d.isoformat() in holiday_set:
            return []
        key = _WEEKDAY_MAP[d.weekday()]
        raw: list[list[str]] = business_hours.get(key, [])
        result: list[tuple[datetime, datetime]] = []
        for iv in raw:
            h1, m1 = int(iv[0][:2]), int(iv[0][3:])
            h2, m2 = int(iv[1][:2]), int(iv[1][3:])
            start = datetime(d.year, d.month, d.day, h1, m1, 0, tzinfo=tz)
            end = datetime(d.year, d.month, d.day, h2, m2, 0, tzinfo=tz)
            if start < end:
                result.append((start, end))
        return result

    def _next_day(c: datetime) -> datetime:
        """로컬 다음 날 00:00."""
        nd = c.date() + timedelta(days=1)
        return datetime(nd.year, nd.month, nd.day, 0, 0, 0, tzinfo=tz)

    # ---- 메인 루프 ----
    while True:
        # 무한루프 가드
        if (cursor.date() - base_date).days > _MAX_SEARCH_DAYS:
            logger.warning(
                "SLA business calendar: %d일 이상 업무시간 미발견 (설정 오류 의심). "
                "벽시계 fallback. base_utc=%s minutes=%d tz=%s",
                _MAX_SEARCH_DAYS,
                base_utc.isoformat(),
                minutes,
                tz_name,
            )
            return (base_utc + timedelta(minutes=minutes)).astimezone(timezone.utc)

        intervals = _intervals(cursor.date())

        if not intervals:
            # 휴무일 / 공휴일 → 다음 날
            cursor = _next_day(cursor)
            continue

        # 오늘 구간 순회
        for start, end in intervals:
            if cursor >= end:
                # 이미 이 구간을 지남
                continue
            if cursor < start:
                # 구간 시작 전 → 구간 시작으로 전진
                cursor = start

            # cursor ∈ [start, end)
            if remaining == 0:
                return cursor.astimezone(timezone.utc)

            available: int = int((end - cursor).total_seconds() // 60)
            if remaining <= available:
                return (cursor + timedelta(minutes=remaining)).astimezone(timezone.utc)
            remaining -= available
            cursor = end  # 이 구간 소진, 다음 구간으로

        # 루프 이후 도달 = (a) 오늘 모든 구간이 이미 지남(cursor past all ends),
        # 또는 (b) 오늘 구간 소진(remaining>0). 두 경우 모두 다음 날로 전진.
        # ※ remaining==0이 for-loop 안에서 반환되므로 여기에 도달하는
        #   remaining==0은 반드시 (a) cursor가 모든 구간을 지난 경우:
        #   minutes=0으로 진입했으나 오늘 업무 마감됐을 때 다음 영업 개시로 가야 함.
        cursor = _next_day(cursor)


# ---------------------------------------------------------------------------
# 공통 헬퍼 — 테넌트 캘린더 DB 조회 (tickets.py, portal_customer.py 양쪽 재사용)
# ---------------------------------------------------------------------------


async def _load_business_calendar(
    db: AsyncSession,
    tenant_id: uuid.UUID,
) -> dict[str, Any] | None:
    """테넌트의 sla_business_calendar 로드.

    Returns:
        {"business_hours": dict, "timezone": str, "holidays": list[str]}
        또는 캘린더 미설정 시 None (→ 호출자가 벽시계 fallback 사용).

    파싱 예외:
        DB 행 존재하더라도 JSON 파싱 실패 시 None 반환 + 경고로그
        (청구 분쟁보다 무중단 우선).
    """
    from app.models.sla import SLABusinessCalendar  # 순환 import 회피

    try:
        row = await db.scalar(
            select(SLABusinessCalendar).where(
                SLABusinessCalendar.tenant_id == tenant_id
            )
        )
    except Exception as exc:
        logger.warning(
            "sla_business_calendar 조회 실패 (벽시계 fallback): tenant=%s err=%s",
            tenant_id,
            exc,
        )
        return None

    if row is None:
        return None

    try:
        return {
            "business_hours": row.business_hours_json,
            "timezone": row.timezone,
            "holidays": row.holidays_json or [],
        }
    except Exception as exc:
        logger.warning(
            "sla_business_calendar 파싱 실패 (벽시계 fallback): tenant=%s err=%s",
            tenant_id,
            exc,
        )
        return None
