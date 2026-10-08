"""
Audit the registered D32 BTC hourly line and retracement geometry.

This reads a verified Nautilus LAST Catalog and creates no signals, orders, or PnL.

"""

from __future__ import annotations

import argparse
import hashlib
import json
from datetime import UTC
from datetime import datetime
from pathlib import Path

from audit_line_box_context import PARITY_SHA256
from audit_source_daily_context import _tree_digest
from audit_trendline_signal_parity import INPUT_SHA256
from audit_trendline_signal_parity import INTERVAL_NS
from audit_trendline_signal_parity import MILLISECOND_NS
from strategy import BOX_BARS
from trendline_strategy import MIN_ANCHOR_SPAN
from trendline_strategy import PIVOT_ORDER
from trendline_strategy import LineCandle

from vibe_trading.model import BarType
from vibe_trading.persistence import ParquetDataCatalog


HOUR_NS = 3_600_000_000_000
SOURCE_VISIBLE_START = "2026-03-19T00:00:00+00:00"
S28_CLOCK_CHECK = "2026-04-08T07:00:00+00:00"
CUTOFFS = ("2026-04-09T00:00:00+00:00", "2026-04-09T04:00:00+00:00")
LOOKBACK_HOURS = BOX_BARS * 4
S27_BANDS = {
    "high_anchor": (72_500, 73_000),
    "low_anchor": (67_500, 68_000),
    "0.5": (70_150, 70_550),
    "0.618": (69_450, 69_850),
    "0.764": (68_700, 69_200),
}
S27_SHA256 = "284b15c1f4ac5476e8d4f548ffa46891c40a163965fe69b4c09e07fcdfe15d1c"
S28_SHA256 = "2612dabcf6bb4cff62205327fddeb6587ec46a70d269790d8bca05a8222e9103"


def _ns(value: str) -> int:
    return int(datetime.fromisoformat(value).timestamp() * 1e9)


def _utc(value: int) -> str:
    return datetime.fromtimestamp(value / 1e9, UTC).isoformat()


def _digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _difference(value: float, band: tuple[int, int]) -> float:
    if value < band[0]:
        return value - band[0]
    if value > band[1]:
        return value - band[1]
    return 0.0


def _hourly(bars, start_ns: int, end_ns: int) -> list[LineCandle]:
    expected = (end_ns - start_ns) // INTERVAL_NS
    if len(bars) != expected or expected <= 0 or expected % 12:
        raise RuntimeError("incomplete five-minute LAST source interval")
    if any(
        bar.ts_event != start_ns + (i + 1) * INTERVAL_NS - MILLISECOND_NS
        for i, bar in enumerate(bars)
    ):
        raise RuntimeError("five-minute LAST source interval is not contiguous")
    result = []
    for offset in range(0, expected, 12):
        chunk = bars[offset : offset + 12]
        result.append(
            LineCandle(
                start_ns + (offset // 12 + 1) * HOUR_NS,
                float(chunk[0].open),
                max(float(bar.high) for bar in chunk),
                min(float(bar.low) for bar in chunk),
                float(chunk[-1].close),
            ),
        )
    if result[-1].ts_event != end_ns:
        raise RuntimeError("hourly aggregation misses registered cutoff")
    return result


def _pivots(candles: list[LineCandle], cutoff_i: int, high: bool) -> list[int]:
    indices = []
    for i in range(2 * PIVOT_ORDER, cutoff_i + 1):
        j = i - PIVOT_ORDER
        window = candles[j - PIVOT_ORDER : j + PIVOT_ORDER + 1]
        value = candles[j].high if high else candles[j].low
        extreme = max(c.high for c in window) if high else min(c.low for c in window)
        if value == extreme:
            indices.append(j)
    return indices


def _event(candles: list[LineCandle], j1: int, j2: int, b: int) -> int | None:
    first, second = candles[j1].high, candles[j2].high
    if second >= first or j2 - j1 < MIN_ANCHOR_SPAN:
        return None
    slope = (second - first) / (j2 - j1)
    for i in range(j2 + 1, b):
        line = second + slope * (i - j2)
        if candles[i].close > line:
            return i if i >= j2 + PIVOT_ORDER else None
    return None


def _candidate(
    candles: list[LineCandle],
    j1: int,
    j2: int,
    event_i: int,
    b: int,
    lows: list[int],
) -> dict:
    eligible = [j for j in lows if event_i < j < b and b - j >= MIN_ANCHOR_SPAN]
    a = eligible[-1] if eligible else None
    row = {
        "line_high_1_utc": _utc(candles[j1].ts_event),
        "line_high_1": candles[j1].high,
        "line_high_2_utc": _utc(candles[j2].ts_event),
        "line_high_2": candles[j2].high,
        "line_high_2_confirmed_utc": _utc(candles[j2 + PIVOT_ORDER].ts_event),
        "first_cross_utc": _utc(candles[event_i].ts_event),
        "first_cross_close": candles[event_i].close,
        "eligible_post_cross_low_count": len(eligible),
        "low_anchor_utc": _utc(candles[a].ts_event) if a is not None else None,
        "low_confirmed_utc": (_utc(candles[a + PIVOT_ORDER].ts_event) if a is not None else None),
        "low": candles[a].low if a is not None else None,
        "levels": None,
        "band_differences": None,
        "all_bands_match": False,
        "event_index": event_i,
        "second_pivot_index": j2,
        "first_pivot_index": j1,
    }
    if a is None:
        return row
    high, low = candles[b].high, candles[a].low
    levels = {ratio: high - float(ratio) * (high - low) for ratio in ("0.5", "0.618", "0.764")}
    differences = {
        "high_anchor": _difference(high, S27_BANDS["high_anchor"]),
        "low_anchor": _difference(low, S27_BANDS["low_anchor"]),
    }
    differences.update(
        {ratio: _difference(value, S27_BANDS[ratio]) for ratio, value in levels.items()},
    )
    row["levels"] = levels
    row["band_differences"] = differences
    row["all_bands_match"] = all(value == 0.0 for value in differences.values())
    return row


def _one_cutoff(candles: list[LineCandle], cutoff: str) -> dict:
    by_time = {bar.ts_event: i for i, bar in enumerate(candles)}
    cutoff_i = by_time[_ns(cutoff)]
    if cutoff_i < LOOKBACK_HOURS:
        raise RuntimeError("insufficient hourly B-high history")
    b = max(
        range(cutoff_i - LOOKBACK_HOURS + 1, cutoff_i + 1),
        key=lambda j: (candles[j].high, -j),
    )
    highs, lows = _pivots(candles, cutoff_i, True), _pivots(candles, cutoff_i, False)
    candidates = []
    for position, j1 in enumerate(highs):
        for j2 in highs[position + 1 :]:
            if j2 + PIVOT_ORDER >= b:
                continue
            event_i = _event(candles, j1, j2, b)
            if event_i is not None:
                candidates.append(_candidate(candles, j1, j2, event_i, b, lows))
    candidates.sort(
        key=lambda row: (
            row["event_index"],
            row["second_pivot_index"],
            -row["first_pivot_index"],
        ),
    )
    selected = candidates[-1] if candidates else None
    return {
        "decision_utc": cutoff,
        "last_completed_close": candles[cutoff_i].close,
        "high_anchor_utc": _utc(candles[b].ts_event),
        "high_anchor": candles[b].high,
        "confirmed_high_pivot_count": len(highs),
        "confirmed_low_pivot_count": len(lows),
        "candidate_event_count": len(candidates),
        "candidate_with_low_count": sum(c["low"] is not None for c in candidates),
        "candidate_all_band_match_count": sum(c["all_bands_match"] for c in candidates),
        "distinct_candidate_low_anchor_utc": sorted(
            {c["low_anchor_utc"] for c in candidates if c["low_anchor_utc"] is not None},
        ),
        "selected": selected,
        "selected_passes_source_bands": bool(selected and selected["all_bands_match"]),
        "all_candidates": candidates,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-identity", type=Path, required=True)
    parser.add_argument("--catalog-root", type=Path, required=True)
    parser.add_argument("--parity", type=Path, required=True)
    parser.add_argument("--s27-source", type=Path, required=True)
    parser.add_argument("--s28-source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if _digest(args.input_identity) != INPUT_SHA256 or _digest(args.parity) != PARITY_SHA256:
        raise RuntimeError("registered input or full-coverage parity bytes changed")
    if _digest(args.s27_source) != S27_SHA256 or _digest(args.s28_source) != S28_SHA256:
        raise RuntimeError("registered source receipt bytes changed")
    identity, parity = (
        json.loads(args.input_identity.read_text()),
        json.loads(args.parity.read_text()),
    )
    if not parity["all_exact"] or len(parity["coins"]) != 37:
        raise RuntimeError("corrected 37-coin coverage is required")
    btc = next(row for row in identity["coins"] if row["coin"] == "BTC")
    btc_parity = next(row for row in parity["coins"] if row["coin"] == "BTC")
    root = args.catalog_root / "BTC" / "minute"
    if _tree_digest(root) != btc["minute_catalog"]["sha256"]:
        raise RuntimeError("BTC minute Catalog differs from registered identity")
    completion = json.loads((root / "r1-download-complete.json").read_text())
    instrument = completion["instrument"]
    if instrument != btc_parity["instrument"] or completion["bar_minutes"] != 5:
        raise RuntimeError("BTC InstrumentId or bar interval differs from full parity")
    start_ns, end_ns = _ns(SOURCE_VISIBLE_START), _ns(CUTOFFS[-1])
    catalog = ParquetDataCatalog(str(root))
    bar_type = BarType.from_str(f"{instrument}-5-MINUTE-LAST-EXTERNAL")
    bars = sorted(
        (
            bar
            for bar in catalog.query_bars([instrument], start=start_ns, end=end_ns)
            if bar.bar_type == bar_type and start_ns < bar.ts_event + MILLISECOND_NS <= end_ns
        ),
        key=lambda bar: bar.ts_event,
    )
    candles = _hourly(bars, start_ns, end_ns)
    by_time = {bar.ts_event: i for i, bar in enumerate(candles)}
    clock_i = by_time[_ns(S28_CLOCK_CHECK)]
    clock_high = max(
        (bar.high for bar in candles[clock_i - LOOKBACK_HOURS + 1 : clock_i + 1]),
    )
    report = {
        "scope": "D32 read-only H09c hourly source geometry; no orders, fills, PnL, or annual replay",
        "registration_commit": "11308baca",
        "input_identity_sha256": INPUT_SHA256,
        "corrected_full_parity_sha256": PARITY_SHA256,
        "s27_source_sha256": S27_SHA256,
        "s28_source_sha256": S28_SHA256,
        "instrument": instrument,
        "btc_minute_catalog_sha256": btc["minute_catalog"]["sha256"],
        "source_visible_start_utc": SOURCE_VISIBLE_START,
        "five_minute_last_bars": len(bars),
        "complete_hourly_bars": len(candles),
        "pivot_order": PIVOT_ORDER,
        "minimum_anchor_span_hours": MIN_ANCHOR_SPAN,
        "high_lookback_hours": LOOKBACK_HOURS,
        "source_bands": S27_BANDS,
        "s28_inferred_clock_check": {
            "last_completed_hour_utc": S28_CLOCK_CHECK,
            "prior_240_hour_high": clock_high,
            "source_high_band_already_possible": _difference(
                clock_high,
                S27_BANDS["high_anchor"],
            )
            == 0.0,
            "source_time_integrity_verified": False,
        },
        "cutoffs": [_one_cutoff(candles, cutoff) for cutoff in CUTOFFS],
        "primary_cutoff_utc": CUTOFFS[-1],
    }
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")


if __name__ == "__main__":
    main()
