"""업무시간 SLA deadline 계산 단위 테스트 (CA-P1-6).

순수함수 compute_working_deadline만 검증 — DB 의존 없음.

pytest -v tests/test_working_hours.py
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app.services.working_hours import compute_working_deadline

# ── 공통 픽스처 ─────────────────────────────────────────────────────────────

KST = timezone(timedelta(hours=9))  # UTC+9 (DST 없음)
TZ = "Asia/Seoul"

# 표준 영업시간: 월~금 09:00-18:00, 토·일 휴무
STD_BH: dict = {
    "mon": [["09:00", "18:00"]],
    "tue": [["09:00", "18:00"]],
    "wed": [["09:00", "18:00"]],
    "thu": [["09:00", "18:00"]],
    "fri": [["09:00", "18:00"]],
    "sat": [],
    "sun": [],
}

# 점심 제외 2구간: 월~금 09:00-12:00 / 13:00-18:00
LUNCH_BH: dict = {
    "mon": [["09:00", "12:00"], ["13:00", "18:00"]],
    "tue": [["09:00", "12:00"], ["13:00", "18:00"]],
    "wed": [["09:00", "12:00"], ["13:00", "18:00"]],
    "thu": [["09:00", "12:00"], ["13:00", "18:00"]],
    "fri": [["09:00", "12:00"], ["13:00", "18:00"]],
    "sat": [],
    "sun": [],
}

NO_HOLIDAYS: list[str] = []


def kst(year: int, month: int, day: int, hour: int, minute: int = 0) -> datetime:
    """KST aware datetime → UTC으로 변환해 반환."""
    return datetime(year, month, day, hour, minute, 0, tzinfo=KST).astimezone(timezone.utc)


# ── 테스트 케이스 ────────────────────────────────────────────────────────────


class TestComputeWorkingDeadline:

    # 1. 평일 영업중 base + 2h → 같은 날 +2h
    def test_weekday_in_hours_plus_2h(self):
        """월요일 10:00 + 120분 → 같은 날 12:00."""
        base = kst(2026, 1, 5, 10, 0)   # 2026-01-05 Mon 10:00 KST
        result = compute_working_deadline(base, 120, STD_BH, TZ, NO_HOLIDAYS)
        expected = kst(2026, 1, 5, 12, 0)
        assert result == expected, f"기대 {expected}, 실제 {result}"

    # 2. 금 17:00 + 4업무h → 월 12:00 (주말 skip)
    #    NOTE: 사양서에 "월 11:00"로 표기됐으나 수리 검증:
    #    금 17:00→18:00 = 60분, 잔여 180분, 월 09:00+180=12:00.
    #    11:00이 되려면 base가 16:00이어야 함 — 사양서 오기.
    def test_friday_eod_plus_4h_crosses_weekend(self):
        """금 17:00 + 240분 → 월 12:00 (토·일 skip)."""
        base = kst(2026, 1, 2, 17, 0)   # 2026-01-02 Fri 17:00 KST
        result = compute_working_deadline(base, 240, STD_BH, TZ, NO_HOLIDAYS)
        expected = kst(2026, 1, 5, 12, 0)  # 2026-01-05 Mon 12:00 KST
        assert result == expected, f"기대 {expected}, 실제 {result}"

    # 3. base 토요일 → 월 09:00부터 카운트
    def test_saturday_base_starts_on_monday(self):
        """토 10:00 + 120분 → 월 11:00 (토·일 skip, 월 09:00+2h)."""
        base = kst(2026, 1, 3, 10, 0)   # 2026-01-03 Sat 10:00 KST
        result = compute_working_deadline(base, 120, STD_BH, TZ, NO_HOLIDAYS)
        expected = kst(2026, 1, 5, 11, 0)  # 2026-01-05 Mon 11:00 KST
        assert result == expected, f"기대 {expected}, 실제 {result}"

    # 4. 공휴일 포함 구간 skip
    def test_holiday_skipped(self):
        """공휴일(월) base + 60분 → 화 10:00 (09:00+1h)."""
        holidays = ["2026-01-05"]        # 2026-01-05 Mon 공휴일
        base = kst(2026, 1, 5, 10, 0)   # Mon 10:00 KST (공휴일)
        result = compute_working_deadline(base, 60, STD_BH, TZ, holidays)
        expected = kst(2026, 1, 6, 10, 0)  # 2026-01-06 Tue 10:00 KST
        assert result == expected, f"기대 {expected}, 실제 {result}"

    # 5. base 영업 전(08:00) → 09:00부터 카운트
    def test_before_open_advances_to_open(self):
        """월 08:00 + 120분 → 월 11:00 (09:00부터 카운트)."""
        base = kst(2026, 1, 5, 8, 0)    # Mon 08:00 KST (영업 전)
        result = compute_working_deadline(base, 120, STD_BH, TZ, NO_HOLIDAYS)
        expected = kst(2026, 1, 5, 11, 0)  # Mon 11:00 KST
        assert result == expected, f"기대 {expected}, 실제 {result}"

    # 6. base 영업 후(20:00) → 다음날 09:00부터 카운트
    def test_after_close_advances_to_next_open(self):
        """월 20:00 + 60분 → 화 10:00 (다음날 09:00+1h)."""
        base = kst(2026, 1, 5, 20, 0)   # Mon 20:00 KST (영업 후)
        result = compute_working_deadline(base, 60, STD_BH, TZ, NO_HOLIDAYS)
        expected = kst(2026, 1, 6, 10, 0)  # Tue 10:00 KST
        assert result == expected, f"기대 {expected}, 실제 {result}"

    # 7. 점심 제외 2구간 캘린더: 11:00 + 2h → 14:00 (12-13 점심 skip)
    def test_lunch_break_two_intervals(self):
        """월 11:00 + 120분 (점심 제외 구간): 11:00→12:00(60분), 13:00→14:00(60분) → 14:00."""
        base = kst(2026, 1, 5, 11, 0)   # Mon 11:00 KST
        result = compute_working_deadline(base, 120, LUNCH_BH, TZ, NO_HOLIDAYS)
        expected = kst(2026, 1, 5, 14, 0)  # Mon 14:00 KST
        assert result == expected, f"기대 {expected}, 실제 {result}"

    # 8a. minutes=0 — 영업중이면 base 반환
    def test_zero_minutes_during_business(self):
        """minutes=0, 영업중(월 10:00) → base 그대로 반환."""
        base = kst(2026, 1, 5, 10, 0)   # Mon 10:00 KST
        result = compute_working_deadline(base, 0, STD_BH, TZ, NO_HOLIDAYS)
        expected = base
        assert result == expected, f"기대 {expected}, 실제 {result}"

    # 8b. minutes=0 — 영업외면 다음 영업 개시 반환
    def test_zero_minutes_outside_business(self):
        """minutes=0, 영업외(월 20:00) → 화 09:00 (다음 영업 개시)."""
        base = kst(2026, 1, 5, 20, 0)   # Mon 20:00 KST (영업 후)
        result = compute_working_deadline(base, 0, STD_BH, TZ, NO_HOLIDAYS)
        expected = kst(2026, 1, 6, 9, 0)  # Tue 09:00 KST
        assert result == expected, f"기대 {expected}, 실제 {result}"

    # 추가: 하루치 업무시간 전체를 넘기는 케이스 (9h 초과 → 다음날 이어짐)
    def test_spans_multiple_days(self):
        """월 09:00 + 10업무h(600분) → 화 11:00 (월 9h=540분 소진 + 화 60분)."""
        base = kst(2026, 1, 5, 9, 0)    # Mon 09:00 KST
        result = compute_working_deadline(base, 600, STD_BH, TZ, NO_HOLIDAYS)
        expected = kst(2026, 1, 6, 10, 0)  # Tue 10:00 KST (09:00 + 60min)
        assert result == expected, f"기대 {expected}, 실제 {result}"

    # 추가: 결과가 UTC aware datetime인지 확인
    def test_result_is_utc_aware(self):
        """반환 datetime은 UTC timezone-aware여야 한다."""
        base = kst(2026, 1, 5, 10, 0)
        result = compute_working_deadline(base, 60, STD_BH, TZ, NO_HOLIDAYS)
        assert result.tzinfo is not None
        assert result.utcoffset() == timedelta(0)
