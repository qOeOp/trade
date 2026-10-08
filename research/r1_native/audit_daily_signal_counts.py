"""
Compare frozen R-1 daily rule counts with native Strategy reports.

This diagnostic reads native Catalog bars and a native run summary. It does not simulate
orders, fills, exits, balances or returns.

"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
from dataclasses import dataclass
from datetime import datetime
from itertools import pairwise
from pathlib import Path
from statistics import median

from run import _ns

from vibe_trading.model import BarType
from vibe_trading.persistence import ParquetDataCatalog


SOURCE_REF = "0725a7b3f89902e27cd421a18b4b879a13268534:research/ronnie/loop/family_r.py"
DAY_NS = 86_400_000_000_000
INTERVAL_NS = 300_000_000_000
MILLISECOND_NS = 1_000_000


@dataclass(frozen=True)
class Daily:
    available_ns: int
    open: float
    high: float
    low: float
    close: float


def _digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _daily_bars(
    daily_root: Path,
    minute_root: Path,
    coin: str,
    instrument: str,
    start: int,
    end: int,
):
    daily_catalog = ParquetDataCatalog(str(daily_root / coin / "daily"))
    daily_type = BarType.from_str(f"{instrument}-1-DAY-LAST-EXTERNAL")
    warmup = sorted(
        (
            bar
            for bar in daily_catalog.query_bars([instrument])
            if bar.bar_type == daily_type and bar.ts_event < start
        ),
        key=lambda bar: bar.ts_event,
    )
    if len(warmup) < 200 or warmup[-1].ts_event != start - MILLISECOND_NS:
        raise RuntimeError(f"{coin}: invalid external daily warmup")
    if any(b.ts_event - a.ts_event != DAY_NS for a, b in pairwise(warmup)):
        raise RuntimeError(f"{coin}: non-contiguous external daily warmup")
    days = [
        Daily(
            bar.ts_event + MILLISECOND_NS,
            float(bar.open),
            float(bar.high),
            float(bar.low),
            float(bar.close),
        )
        for bar in warmup
    ]

    minute_catalog = ParquetDataCatalog(str(minute_root / coin / "minute"))
    last_type = BarType.from_str(f"{instrument}-5-MINUTE-LAST-EXTERNAL")
    bars = sorted(
        (
            bar
            for bar in minute_catalog.query_bars([instrument], start=start, end=end)
            if bar.bar_type == last_type
        ),
        key=lambda bar: bar.ts_event,
    )
    if len(bars) != (end - start) // INTERVAL_NS or any(
        bar.ts_event != start + (i + 1) * INTERVAL_NS - MILLISECOND_NS for i, bar in enumerate(bars)
    ):
        raise RuntimeError(f"{coin}: non-contiguous five-minute LAST bars")
    first = bars[0]
    day_end = (first.ts_event // DAY_NS + 1) * DAY_NS
    daily_count = 0
    day_high = float(first.high)
    day_low = float(first.low)
    for i, bar in enumerate(bars):
        boundary = (bar.ts_event // DAY_NS + 1) * DAY_NS
        if boundary != day_end:
            previous = bars[i - 1]
            if previous.ts_event != day_end - MILLISECOND_NS:
                raise RuntimeError(f"{coin}: incomplete daily aggregation")
            days.append(
                Daily(
                    day_end,
                    float(first.open),
                    day_high,
                    day_low,
                    float(previous.close),
                ),
            )
            daily_count += 1
            first = bar
            day_end = boundary
            day_high = float(bar.high)
            day_low = float(bar.low)
        else:
            day_high = max(day_high, float(bar.high))
            day_low = min(day_low, float(bar.low))
    # The terminal interval may end before its UTC day closes. Such a bar was
    # never delivered to the native daily Strategy.
    if bars[-1].ts_event == day_end - MILLISECOND_NS:
        days.append(
            Daily(day_end, float(first.open), day_high, day_low, float(bars[-1].close)),
        )
        daily_count += 1
    if any(b.available_ns - a.available_ns != DAY_NS for a, b in pairwise(days)):
        raise RuntimeError(f"{coin}: daily warmup and aggregation do not join")
    return days, len(warmup), daily_count


def _frozen_trend_aligned_breaks(days: list[Daily], trade_start: int) -> int:
    """
    Literal pivot/body/trend part of frozen family_r.state, without fills.
    """
    high = [day.high for day in days]
    low = [day.low for day in days]
    opened = [day.open for day in days]
    close = [day.close for day in days]
    pivot_highs: list[float] = []
    pivot_lows: list[float] = []
    trend = 0
    count = 0
    for i in range(27, len(days)):
        j = i - 3
        if high[j] == max(high[j - 3 : j + 4]):
            pivot_highs.append(high[j])
        if low[j] == min(low[j - 3 : j + 4]):
            pivot_lows.append(low[j])
        prior_median = median(abs(close[k] - opened[k]) for k in range(i - 20, i))
        big = abs(close[i] - opened[i]) >= 1.5 * prior_median
        big2 = abs(close[i] - opened[i - 1]) >= 3 * prior_median
        strong_up = (close[i] > opened[i] and big) or (close[i] > opened[i - 1] and big2)
        strong_down = (close[i] < opened[i] and big) or (close[i] < opened[i - 1] and big2)
        crossed_highs = (
            [level for level in pivot_highs if close[i - 1] <= level < close[i]]
            if strong_up
            else []
        )
        crossed_lows = (
            [level for level in pivot_lows if close[i] < level <= close[i - 1]]
            if strong_down
            else []
        )
        if pivot_highs and strong_up and close[i] > pivot_highs[-1] and trend != 1:
            trend = 1
        elif pivot_lows and strong_down and close[i] < pivot_lows[-1] and trend != -1:
            trend = -1
        if days[i].available_ns >= trade_start:
            count += (len(crossed_highs) if trend == 1 else 0) + (
                len(crossed_lows) if trend == -1 else 0
            )
    return count


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--catalog-root", type=Path, required=True)
    parser.add_argument("--daily-root", type=Path, required=True)
    parser.add_argument("--run-summary", type=Path, required=True)
    parser.add_argument("--start", required=True)
    parser.add_argument("--trade-start", required=True)
    parser.add_argument("--end", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    start, trade_start, end = (_ns(value) for value in (args.start, args.trade_start, args.end))
    if not start <= trade_start < end or any(
        datetime.fromisoformat(value).utcoffset().total_seconds() != 0
        for value in (args.start, args.trade_start, args.end)
    ):
        raise ValueError("UTC start, trade start and end are required")
    summary = json.loads(args.run_summary.read_text())
    if (
        summary["signal_variant"] != "daily-pivot"
        or _ns(summary["input_start_utc"]) != start
        or _ns(summary["period_start_utc"]) != trade_start
        or _ns(summary["period_end_utc"]) != end
    ):
        raise RuntimeError("native summary identity does not match diagnostic inputs")
    git_executable = shutil.which("git")
    if git_executable is None:
        raise RuntimeError("git executable is required for frozen-rule identity")
    source = subprocess.check_output([git_executable, "show", SOURCE_REF])
    result_rows = []
    for row in summary["per_coin"]:
        coin, instrument = row["coin"], row["instrument"]
        days, warmup_count, aggregated_count = _daily_bars(
            args.daily_root,
            args.catalog_root,
            coin,
            instrument,
            start,
            end,
        )
        frozen_count = _frozen_trend_aligned_breaks(days, trade_start)
        result_rows.append(
            {
                "coin": coin,
                "instrument": instrument,
                "warmup_daily_bars": warmup_count,
                "aggregated_full_daily_bars": aggregated_count,
                "frozen_trend_aligned_breaks": frozen_count,
                "native_strategy_signals": row["signals"],
                "matches": frozen_count == row["signals"],
            },
        )
    report = {
        "frozen_rule_source": SOURCE_REF,
        "frozen_rule_source_sha256": hashlib.sha256(source).hexdigest(),
        "diagnostic_source_sha256": _digest(Path(__file__)),
        "native_run_summary": str(args.run_summary),
        "native_run_summary_sha256": _digest(args.run_summary),
        "catalog_root": str(args.catalog_root),
        "daily_root": str(args.daily_root),
        "start_utc": args.start,
        "trade_start_utc": args.trade_start,
        "end_utc": args.end,
        "coins": result_rows,
        "mismatched_coins": [row["coin"] for row in result_rows if not row["matches"]],
        "method": "Read-only frozen daily pivot/body/trend signal-count recomputation over native Catalog LAST bars. No toy or native fill, exit, PnL or account replay is created. Counts do not prove order-price parity.",
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print(
        json.dumps(
            {"coins": len(result_rows), "mismatched_coins": report["mismatched_coins"]},
        ),
    )


if __name__ == "__main__":
    main()
