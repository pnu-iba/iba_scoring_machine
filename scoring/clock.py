"""'하루'의 기준과 대회 일정. 한국 시간(KST) 자정에 제출 횟수가 초기화된다(스펙 21번).

대회 기간과 하루 제출 횟수는 DB의 contest_settings에 두고 관리자 페이지에서 바꾼다.
시작일 0시 전은 준비, 마지막 날 다음 날 0시부터는 결과 공개(제출 마감, 최종 순위)다.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone

KST = timezone(timedelta(hours=9), name="KST")

READY, OPEN, FINAL = "ready", "open", "final"


@dataclass(frozen=True)
class ContestSettings:
    start_date: date  # 첫날(KST)
    end_date: date  # 마지막 날(KST). 다음 날 0시에 마감
    daily_limit: int


# 설정 행이 아직 없을 때 쓰는 첫 기수 일정
DEFAULT_SETTINGS = ContestSettings(date(2026, 9, 22), date(2026, 10, 5), 3)


def start_at(s: ContestSettings) -> datetime:
    return datetime.combine(s.start_date, time(0, 0), tzinfo=KST)


def final_at(s: ContestSettings) -> datetime:
    return datetime.combine(s.end_date + timedelta(days=1), time(0, 0), tzinfo=KST)


def is_final(now: datetime, s: ContestSettings) -> bool:
    return now >= final_at(s)


def status(now: datetime, s: ContestSettings) -> str:
    if now < start_at(s):
        return READY
    return FINAL if is_final(now, s) else OPEN


def day_window(now: datetime) -> tuple[datetime, datetime]:
    """now가 속한 KST 하루의 [시작, 끝) 을 UTC aware datetime으로 돌려준다."""
    if now.tzinfo is None:
        raise ValueError("now는 시간대가 있는 datetime이어야 합니다.")
    local = now.astimezone(KST)
    start_local = local.replace(hour=0, minute=0, second=0, microsecond=0)
    end_local = start_local + timedelta(days=1)
    return start_local.astimezone(timezone.utc), end_local.astimezone(timezone.utc)


def resets_at(now: datetime) -> datetime:
    """다음 KST 자정을 KST 표기로 돌려준다(응답에 그대로 쓴다)."""
    _, end_utc = day_window(now)
    return end_utc.astimezone(KST)
