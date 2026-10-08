"""
Audit D33 causal BTC four-hour line regions before a later retest.

This reads the verified Nautilus LAST Catalog without orders, fills, or PnL.

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
from audit_trendline_signal_parity import _closed_four_hour
from trendline_strategy import MIN_ANCHOR_SPAN
from trendline_strategy import PIVOT_ORDER

from vibe_trading.model import BarType
from vibe_trading.persistence import ParquetDataCatalog


SOURCE_CHART_START = "2025-10-06T00:00:00+00:00"
SOURCE_VISIBLE_START = "2025-10-07T00:00:00+00:00"
S31_CUTOFFS = ("2025-12-04T00:00:00+00:00", "2025-12-04T04:00:00+00:00")
S30_CUTOFFS = ("2025-12-05T00:00:00+00:00", "2025-12-05T04:00:00+00:00")
S31_LINE_BAND = (91_000, 93_000)
S30_LINE_BAND = (89_500, 92_500)
TOUCH_BAND_FRACTION = 0.01
S30_SHA256 = "45e3c605fde623bf368d263df6ab36f6f1f64c318d34301b995a11ae5dd56ea6"
S31_SHA256 = "41f950287ae7f8bff4294d4ca3567f500aafa06b7705e8aa32a98ef27e688ea1"


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


def _high_pivots(candles, decision_i: int) -> list[int]:
    pivots = []
    for i in range(2 * PIVOT_ORDER, decision_i + 1):
        j = i - PIVOT_ORDER
        window = candles[j - PIVOT_ORDER : j + PIVOT_ORDER + 1]
        if candles[j].high == max(bar.high for bar in window):
            pivots.append(j)
    return pivots


def _pair(candles, j1: int, j2: int, s31_i: int, s30_i: int) -> dict | None:
    first, second = candles[j1].high, candles[j2].high
    if j2 - j1 < MIN_ANCHOR_SPAN or second >= first:
        return None
    slope = (second - first) / (j2 - j1)

    def line(i: int) -> float:
        return second + slope * (i - j2)

    crosses = [i for i in range(j2 + 1, s31_i + 1) if candles[i].close > line(i)]
    if not crosses or crosses[0] < j2 + PIVOT_ORDER or candles[s31_i].close <= line(s31_i):
        return None
    touches = [
        {
            "closed_utc": _utc(candles[i].ts_event),
            "low": candles[i].low,
            "close": candles[i].close,
            "projected_line": line(i),
        }
        for i in range(s31_i + 1, s30_i + 1)
        if candles[i].low <= line(i) * (1 + TOUCH_BAND_FRACTION) and candles[i].close > line(i)
    ]
    before, after = line(s31_i), line(s30_i)
    differences = {
        "s31": _difference(before, S31_LINE_BAND),
        "s30": _difference(after, S30_LINE_BAND),
    }
    return {
        "first_high_utc": _utc(candles[j1].ts_event),
        "first_high": first,
        "second_high_utc": _utc(candles[j2].ts_event),
        "second_high": second,
        "second_high_confirmed_utc": _utc(candles[j2 + PIVOT_ORDER].ts_event),
        "first_close_cross_utc": _utc(candles[crosses[0]].ts_event),
        "projected_line_s31": before,
        "projected_line_s30": after,
        "s31_age_four_hour_bars": s31_i - j2,
        "source_band_differences": differences,
        "later_retest_bars": touches,
        "matches_both_bands_and_touch": all(value == 0 for value in differences.values())
        and bool(touches),
    }


def _one_pair(candles, s31: str, s30: str) -> dict:
    by_time = {bar.ts_event: i for i, bar in enumerate(candles)}
    s31_i, s30_i = by_time[_ns(s31)], by_time[_ns(s30)]
    if s30_i - s31_i != 6:
        raise RuntimeError("source dates do not span exactly six four-hour bars")
    pivots = _high_pivots(candles, s31_i)
    rows = []
    for position, j1 in enumerate(pivots):
        for j2 in pivots[position + 1 :]:
            row = _pair(candles, j1, j2, s31_i, s30_i)
            if row is not None:
                rows.append(row)
    latest = pivots[-2:]
    latest_pair = _pair(candles, latest[0], latest[1], s31_i, s30_i) if len(latest) == 2 else None
    return {
        "s31_decision_utc": s31,
        "s30_decision_utc": s30,
        "s31_last_completed_close": candles[s31_i].close,
        "s30_last_completed_close": candles[s30_i].close,
        "confirmed_high_pivots_at_s31": len(pivots),
        "eligible_descending_first_cross_pairs": len(rows),
        "both_bands_and_later_touch_count": sum(
            row["matches_both_bands_and_touch"] for row in rows
        ),
        "latest_two_confirmed_high_pair": latest_pair,
        "all_causal_pairs": rows,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-identity", type=Path, required=True)
    parser.add_argument("--catalog-root", type=Path, required=True)
    parser.add_argument("--parity", type=Path, required=True)
    parser.add_argument("--s30-source", type=Path, required=True)
    parser.add_argument("--s31-source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if _digest(args.input_identity) != INPUT_SHA256 or _digest(args.parity) != PARITY_SHA256:
        raise RuntimeError("registered input or corrected parity bytes changed")
    if _digest(args.s30_source) != S30_SHA256 or _digest(args.s31_source) != S31_SHA256:
        raise RuntimeError("source receipt bytes changed")
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
        raise RuntimeError("BTC InstrumentId or bar interval differs from corrected parity")
    start_ns, end_ns = _ns(SOURCE_VISIBLE_START), _ns(S30_CUTOFFS[-1])
    catalog = ParquetDataCatalog(str(root))
    bar_type = BarType.from_str(f"{instrument}-5-MINUTE-LAST-EXTERNAL")
    bars = sorted(
        (
            bar
            for bar in catalog.query_bars([instrument], start=start_ns, end=end_ns)
            if bar.bar_type == bar_type and start_ns < bar.ts_event + 1_000_000 <= end_ns
        ),
        key=lambda bar: bar.ts_event,
    )
    candles, partial = _closed_four_hour(bars, start_ns, end_ns)
    if partial or candles[-1].ts_event != end_ns:
        raise RuntimeError("D33 four-hour source input is incomplete")
    report = {
        "scope": "D33 read-only H06a prior-line/source-date geometry; no pair chosen for orders or PnL",
        "registration_commit": "51e1c47a0",
        "input_identity_sha256": INPUT_SHA256,
        "corrected_full_parity_sha256": PARITY_SHA256,
        "s30_source_sha256": S30_SHA256,
        "s31_source_sha256": S31_SHA256,
        "instrument": instrument,
        "btc_minute_catalog_sha256": btc["minute_catalog"]["sha256"],
        "source_chart_start_utc": SOURCE_CHART_START,
        "source_visible_start_utc": SOURCE_VISIBLE_START,
        "missing_left_context_hours": 24,
        "five_minute_last_bars": len(bars),
        "complete_four_hour_bars": len(candles),
        "pivot_order": PIVOT_ORDER,
        "minimum_anchor_span_four_hour_bars": MIN_ANCHOR_SPAN,
        "s31_source_line_band": S31_LINE_BAND,
        "s30_source_line_band": S30_LINE_BAND,
        "later_touch_fraction_above_line": TOUCH_BAND_FRACTION,
        "cutoff_pairs": [
            _one_pair(candles, s31, s30) for s31, s30 in zip(S31_CUTOFFS, S30_CUTOFFS, strict=True)
        ],
        "primary_cutoff_pair": [S31_CUTOFFS[-1], S30_CUTOFFS[-1]],
    }
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")


if __name__ == "__main__":
    main()
