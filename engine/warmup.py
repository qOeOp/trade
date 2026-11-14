"""The WARMUP declaration and its history (docs/plans/r1-runtime-contract-20261110.zh.md, 3 and 5).

A source declares ``WARMUP = {period: bars}``: the history it needs before its first decision, per Binance kline
period. Every period other than ``1-MINUTE`` is also one it may subscribe to as a native aggregation
(``{id}-{period}-LAST-INTERNAL@1-MINUTE-EXTERNAL``), with 0 bars when it needs no history. At its start T the
runner requests, per period P with n > 0 bars, ``{id}-{P}-LAST-EXTERNAL`` over [floor(T, P) - n P,
floor(T, P) - 1 ms]: n adjacent bars, each stamped 1 ms before its bucket ends, the last 1 ms before floor(T, P).

``WARMUP`` may also hold ``FUNDING: n``: the n funding settlements the source needs before its first decision, the
last n settled at or before T (a settlement stamped T is known at T, and a start at T sees no live update of it).
Each is the native update a replay streams at its settlement (`funding_update`): rate, and ts_event, ts_init and
next_funding_ns at the settlement time, so the history is the same in replay (the export's settlements) and in Paper
and Live (Binance's public funding-rate history, which holds the archive's times and rates).
"""
from __future__ import annotations

from bisect import bisect_right
from decimal import Decimal

from nautilus_trader.model import Bar, BarType, FundingRateUpdate, InstrumentId, Quantity

from engine.config import MINUTE_NS, Refusal

PERIODS = {"1-MINUTE": 1, "3-MINUTE": 3, "5-MINUTE": 5, "15-MINUTE": 15, "30-MINUTE": 30, "1-HOUR": 60,
           "2-HOUR": 120, "4-HOUR": 240, "6-HOUR": 360, "8-HOUR": 480, "12-HOUR": 720, "1-DAY": 1440}  # minutes
EXPORTED = frozenset({"1-MINUTE", "1-DAY"})  # the market export holds these; a replay derives the others
MILLISECOND_NS = 1_000_000
FUNDING = "FUNDING"  # WARMUP's key for the number of funding settlements


def _validated(strategy_class) -> dict:
    value = getattr(strategy_class, "WARMUP", {})
    if not isinstance(value, dict) or not all(
            isinstance(key, str) and (key in PERIODS or key == FUNDING) and type(count) is int and count >= 0
            for key, count in value.items()):
        raise Refusal("WARMUP_INVALID", f"WARMUP is {value!r}: a dict from Binance kline periods "
                                        f"({', '.join(PERIODS)}) to whole numbers of bars, and {FUNDING} to a whole "
                                        "number of funding settlements")
    return value


def declared(strategy_class) -> tuple[tuple[str, int], ...]:
    """The validated WARMUP declaration's kline periods as sorted (period, bars) pairs; WARMUP_INVALID otherwise."""
    value = _validated(strategy_class)
    return tuple(sorted(((key, count) for key, count in value.items() if key in PERIODS),
                        key=lambda item: PERIODS[item[0]]))


def declared_funding(strategy_class) -> int:
    """The number of funding settlements the validated WARMUP declares (0 without FUNDING)."""
    return _validated(strategy_class).get(FUNDING, 0)


def funding_update(instrument_id, settled_ns: int, rate) -> FundingRateUpdate:
    """The native update of one settlement as a replay streams it (market.write_funding): the rate as normalized
    decimal text, every stamp at the settlement."""
    exact = Decimal(format(Decimal(str(rate)).normalize(), "f"))
    return FundingRateUpdate(InstrumentId.from_str(str(instrument_id)), exact, settled_ns, settled_ns, None,
                             settled_ns)


def funding_history(updates, at_ns: int, count: int) -> list:
    """The last `count` of `updates` (ascending ts_event) settled at or before `at_ns`; fewer when fewer exist."""
    if count == 0:
        return []
    known = [update for update in updates if update.ts_event <= at_ns]
    return known[-count:]


def funding_start(stamps: list[int], count: int) -> int | None:
    """The first whole minute at or after which `count` of the settlements `stamps` (ascending ts_event) are known;
    None when fewer exist. Every later start holds them too."""
    if count == 0:
        return 0
    if len(stamps) < count:
        return None
    return -(-stamps[count - 1] // MINUTE_NS) * MINUTE_NS


def period_ns(period: str) -> int:
    return PERIODS[period] * MINUTE_NS


def bar_type(instrument_id, period: str) -> BarType:
    return BarType.from_str(f"{instrument_id}-{period}-LAST-EXTERNAL")


def aggregated_type(instrument_id, period: str) -> BarType:
    return BarType.from_str(f"{instrument_id}-{period}-LAST-INTERNAL@1-MINUTE-EXTERNAL")


def bucket_start(at_ns: int, period: str) -> int:
    """floor(at, P): the start of the bucket holding `at` (every period divides a UTC day)."""
    step = period_ns(period)
    return at_ns // step * step


def history_range(at_ns: int, period: str, count: int) -> tuple[int, int]:
    """[first, last] ts_event of the `count` bars of `period` a start at `at_ns` receives."""
    end = bucket_start(at_ns, period)
    return end - count * period_ns(period) + period_ns(period) - MILLISECOND_NS, end - MILLISECOND_NS


def adjacent(stamps: list[int], at_ns: int, period: str, count: int) -> bool:
    """True when the last `count` of `stamps` (ts_event, ascending) at or before floor(at, P) - 1 ms are adjacent
    and the last is exactly that instant."""
    first, last = history_range(at_ns, period, count)
    index = bisect_right(stamps, last)
    if count == 0:
        return True
    if index < count or stamps[index - 1] != last:
        return False
    return stamps[index - count] == first


def first_start(stamps: dict[str, list[int]], warmup: tuple[tuple[str, int], ...], earliest: int,
                end: int) -> int | None:
    """The first whole minute at or after `earliest` and before `end` at which every declared history is adjacent
    (`stamps`: each period's bar ts_event, ascending); None when there is none."""
    needed = [(period, count) for period, count in warmup if count > 0]
    first = -(-earliest // MINUTE_NS) * MINUTE_NS
    candidates = {first} | {stamp + MILLISECOND_NS for period, _ in needed for stamp in stamps[period]
                            if first <= stamp + MILLISECOND_NS < end}
    for moment in sorted(candidates):
        if moment < end and all(adjacent(stamps[period], moment, period, count) for period, count in needed):
            return moment
    return None


def derive(minutes: list[Bar], period: str, instrument_id, start_ns: int) -> list[Bar]:
    """The `period` bars of the complete buckets that open at or after `start_ns` among one-minute bars (ascending,
    each stamped 1 ms before its minute ends), by the market's daily rule (market.series.derive_bars): open is the
    first traded minute's open, high and low are over traded minutes (all minutes when none traded), close is the
    last minute's close, volume is the sum; a bucket without minutes has no bar. A bucket is complete once a later
    minute exists."""
    step, kind = period_ns(period), bar_type(instrument_id, period)
    groups: dict[int, list[Bar]] = {}
    for minute in minutes:
        bucket = (minute.ts_event + MILLISECOND_NS - MINUTE_NS) // step * step
        if bucket >= start_ns:
            groups.setdefault(bucket, []).append(minute)
    last = max(groups, default=None)
    found = []
    for opened, members in sorted(groups.items()):
        if opened == last:
            break  # not known to be complete
        traded = [bar for bar in members if bar.volume.as_decimal() > 0] or members
        volume = sum((bar.volume.as_decimal() for bar in members), Decimal(0))
        stamp = opened + step - MILLISECOND_NS
        high = max(traded, key=lambda bar: bar.high.as_decimal()).high
        low = min(traded, key=lambda bar: bar.low.as_decimal()).low
        size = Quantity.from_str(f"{volume:.{members[0].volume.precision}f}")
        found.append(Bar(kind, traded[0].open, high, low, members[-1].close, size, stamp, stamp))
    return found
