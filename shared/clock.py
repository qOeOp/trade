"""UTC days, months and times as integers: days and months in milliseconds (the market's unit) or nanoseconds
(Nautilus's), and ISO-8601 UTC text. A naive datetime means UTC."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
import re

MS_NS = 1_000_000
EPOCH = datetime(1970, 1, 1, tzinfo=UTC)
_NANOSECONDS = re.compile(r"(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]00:?00)?\Z")


def day_ms(day: date) -> int:
    """The first UTC millisecond of `day`."""
    return int(datetime(day.year, day.month, day.day, tzinfo=UTC).timestamp() * 1000)


def ms_day(ms: int) -> date:
    """The UTC day holding millisecond `ms`."""
    return datetime.fromtimestamp(ms / 1000, UTC).date()


def day_ns(day: date) -> int:
    """The first UTC nanosecond of `day`."""
    return day_ms(day) * MS_NS


def next_month(month: date) -> date:
    """The first day of the month after the one holding `month`."""
    return (month.replace(day=28) + timedelta(days=4)).replace(day=1)


def months(first: date, last: date) -> list[date]:
    """The first days of the months from `first` through `last` (both first days of a month)."""
    found = []
    while first <= last:
        found.append(first)
        first = next_month(first)
    return found


def month_names(start_ms: int, end_ms: int) -> list[str]:
    """Each month (YYYY-MM) that [start_ms, end_ms) touches."""
    first, last = ms_day(start_ms).replace(day=1), ms_day(end_ms - 1).replace(day=1)
    return [month.strftime("%Y-%m") for month in months(first, last)]


def month_end(ms: int) -> int:
    """The first millisecond of the UTC month after the one holding `ms`."""
    return day_ms(next_month(ms_day(ms)))


def utc(text: str) -> datetime:
    """An ISO-8601 time with a zero UTC offset ('Z' allowed); ValueError for other text or another zone."""
    try:
        moment = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except (AttributeError, ValueError) as exc:
        raise ValueError(f"{text!r} is not an ISO-8601 time") from exc
    if moment.utcoffset() != timedelta(0):
        raise ValueError(f"{text!r} is not a UTC time")
    return moment


def moment_ns(moment: datetime) -> int:
    """UTC nanoseconds of a datetime (naive means UTC)."""
    moment = moment.replace(tzinfo=UTC) if moment.tzinfo is None else moment
    return int(moment.timestamp()) * 10**9 + moment.microsecond * 1000


def utc_ns(text) -> int:
    """UTC nanoseconds of a native time: an integer, or ISO-8601 UTC with up to nine fraction digits."""
    text = str(text).strip()
    if text.isdigit():
        return int(text)
    found = _NANOSECONDS.fullmatch(text)
    if found is None:
        return (utc(text) - EPOCH) // timedelta(microseconds=1) * 1000
    day, hour, minute, second, fraction, _ = found.groups()
    base = datetime.fromisoformat(f"{day}T{hour}:{minute}:{second}+00:00")
    return int((base - EPOCH).total_seconds()) * 10**9 + int((fraction or "").ljust(9, "0"))
