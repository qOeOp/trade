"""
Audit D34 visible BTC trend-line anchors against a verified Nautilus Catalog.

The report describes causal source geometry. It creates no orders, fills, or PnL.

"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from audit_prior_break_retest import S30_CUTOFFS
from audit_prior_break_retest import S30_LINE_BAND
from audit_prior_break_retest import S30_SHA256
from audit_prior_break_retest import S31_CUTOFFS
from audit_prior_break_retest import S31_LINE_BAND
from audit_prior_break_retest import S31_SHA256
from audit_prior_break_retest import SOURCE_VISIBLE_START
from audit_prior_break_retest import TOUCH_BAND_FRACTION
from audit_prior_break_retest import _high_pivots
from audit_prior_break_retest import _ns
from audit_prior_break_retest import _utc
from audit_source_daily_context import _tree_digest
from audit_trendline_signal_parity import INPUT_SHA256
from audit_trendline_signal_parity import _closed_four_hour
from trendline_strategy import MIN_ANCHOR_SPAN
from trendline_strategy import PIVOT_ORDER

from vibe_trading.model import BarType
from vibe_trading.persistence import ParquetDataCatalog


D33_SHA256 = "60c6988287f66aa6afea8e1265bbd81b243c7a834f47be034396cb3d6f99c480"
FIRST_WINDOW = ("2025-10-26T00:00:00+00:00", "2025-10-30T23:59:59+00:00")
FIRST_PRICE = (114_000, 118_000)
SECOND_WINDOW = ("2025-11-08T00:00:00+00:00", "2025-11-12T23:59:59+00:00")
SECOND_PRICE = (104_000, 109_000)
RECENT_BREAK_START = "2025-12-02T00:00:00+00:00"


def _digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _inside_anchor(bar, window: tuple[str, str], prices: tuple[int, int]) -> bool:
    return _ns(window[0]) <= bar.ts_event <= _ns(window[1]) and prices[0] <= bar.high <= prices[1]


def _in_band(value: float, band: tuple[int, int]) -> bool:
    return band[0] <= value <= band[1]


def _describe_pair(candles, j1: int, j2: int, s31_i: int, s30_i: int) -> dict:
    first, second = candles[j1].high, candles[j2].high
    if j2 - j1 < MIN_ANCHOR_SPAN or second >= first:
        raise ValueError("not an eligible descending pivot pair")
    slope = (second - first) / (j2 - j1)

    def line(i: int) -> float:
        return second + slope * (i - j2)

    transitions = []
    first_above_i = None
    prev_above = candles[j2].close > line(j2)
    for i in range(j2 + 1, s30_i + 1):
        above = candles[i].close > line(i)
        if above and first_above_i is None:
            first_above_i = i
        if above != prev_above:
            transitions.append(
                {
                    "closed_utc": _utc(candles[i].ts_event),
                    "direction": "below_to_above" if above else "above_to_below",
                    "close": candles[i].close,
                    "line": line(i),
                },
            )
        prev_above = above
    touches = [
        {
            "closed_utc": _utc(candles[i].ts_event),
            "low": candles[i].low,
            "close": candles[i].close,
            "line": line(i),
        }
        for i in range(s31_i + 1, s30_i + 1)
        if candles[i].low <= line(i) * (1 + TOUCH_BAND_FRACTION) and candles[i].close > line(i)
    ]
    projections_match = _in_band(line(s31_i), S31_LINE_BAND) and _in_band(
        line(s30_i),
        S30_LINE_BAND,
    )
    confirmed_before_break = first_above_i is not None and j2 + PIVOT_ORDER < first_above_i
    recent_break = (
        first_above_i is not None
        and _ns(RECENT_BREAK_START) <= candles[first_above_i].ts_event <= candles[s31_i].ts_event
    )
    return {
        "first_high_utc": _utc(candles[j1].ts_event),
        "first_high": first,
        "second_high_utc": _utc(candles[j2].ts_event),
        "second_high": second,
        "second_high_confirmed_utc": _utc(candles[j2 + PIVOT_ORDER].ts_event),
        "source_anchor_windows_match": _inside_anchor(candles[j1], FIRST_WINDOW, FIRST_PRICE)
        and _inside_anchor(candles[j2], SECOND_WINDOW, SECOND_PRICE),
        "projected_line_s31": line(s31_i),
        "projected_line_s30": line(s30_i),
        "source_projection_bands_match": projections_match,
        "first_close_above_utc": _utc(candles[first_above_i].ts_event)
        if first_above_i is not None
        else None,
        "second_pivot_confirmed_before_first_cross": confirmed_before_break,
        "recent_initial_break": recent_break,
        "s31_close_above_line": candles[s31_i].close > line(s31_i),
        "all_close_side_transitions": transitions,
        "later_touch_and_close_above_bars": touches,
        "full_source_proxy_match": projections_match
        and confirmed_before_break
        and recent_break
        and candles[s31_i].close > line(s31_i)
        and bool(touches),
    }


def _at_cutoffs(candles, s31: str, s30: str, d33: dict) -> dict:
    by_time = {bar.ts_event: i for i, bar in enumerate(candles)}
    s31_i, s30_i = by_time[_ns(s31)], by_time[_ns(s30)]
    pivots = _high_pivots(candles, s31_i)
    first = [i for i in pivots if _inside_anchor(candles[i], FIRST_WINDOW, FIRST_PRICE)]
    second = [i for i in pivots if _inside_anchor(candles[i], SECOND_WINDOW, SECOND_PRICE)]
    rows = [
        _describe_pair(candles, j1, j2, s31_i, s30_i)
        for j1 in first
        for j2 in second
        if j2 - j1 >= MIN_ANCHOR_SPAN and candles[j2].high < candles[j1].high
    ]
    d33_matches = [row for row in d33["all_causal_pairs"] if row["matches_both_bands_and_touch"]]
    prior_matches = []
    for row in d33_matches:
        j1 = by_time[_ns(row["first_high_utc"])]
        j2 = by_time[_ns(row["second_high_utc"])]
        prior_matches.append(_describe_pair(candles, j1, j2, s31_i, s30_i))
    latest = pivots[-2:]
    latest_pair = (
        _describe_pair(candles, latest[0], latest[1], s31_i, s30_i)
        if len(latest) == 2 and candles[latest[1]].high < candles[latest[0]].high
        else None
    )
    return {
        "s31_cutoff_utc": s31,
        "s30_cutoff_utc": s30,
        "all_confirmed_order8_high_pivots": len(pivots),
        "first_window_confirmed_pivots": [
            {"closed_utc": _utc(candles[i].ts_event), "high": candles[i].high} for i in first
        ],
        "second_window_confirmed_pivots": [
            {"closed_utc": _utc(candles[i].ts_event), "high": candles[i].high} for i in second
        ],
        "all_source_window_descending_pairs": rows,
        "full_source_proxy_match_count": sum(row["full_source_proxy_match"] for row in rows),
        "d33_band_matches_with_full_chronology": prior_matches,
        "h06_latest_pair": latest_pair,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-identity", type=Path, required=True)
    parser.add_argument("--catalog-root", type=Path, required=True)
    parser.add_argument("--d33", type=Path, required=True)
    parser.add_argument("--s30-source", type=Path, required=True)
    parser.add_argument("--s31-source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    expected = (
        (args.input_identity, INPUT_SHA256),
        (args.d33, D33_SHA256),
        (args.s30_source, S30_SHA256),
        (args.s31_source, S31_SHA256),
    )
    for path, digest in expected:
        if _digest(path) != digest:
            raise RuntimeError(f"registered input bytes changed: {path}")
    identity = json.loads(args.input_identity.read_text())
    d33 = json.loads(args.d33.read_text())
    btc = next(row for row in identity["coins"] if row["coin"] == "BTC")
    root = args.catalog_root / "BTC" / "minute"
    if _tree_digest(root) != btc["minute_catalog"]["sha256"]:
        raise RuntimeError("BTC minute Catalog differs from registered identity")
    completion = json.loads((root / "r1-download-complete.json").read_text())
    instrument = completion["instrument"]
    if instrument != d33["instrument"] or completion["bar_minutes"] != 5:
        raise RuntimeError("BTC instrument or bar interval differs from D33")
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
    if partial or len(bars) != d33["five_minute_last_bars"]:
        raise RuntimeError("D34 input coverage differs from D33")
    prior = {row["s31_decision_utc"]: row for row in d33["cutoff_pairs"]}
    report = {
        "scope": "D34 read-only S31/S30 visible-anchor chronology; no selected Strategy line or PnL",
        "registration_commit": "69152072f",
        "input_identity_sha256": INPUT_SHA256,
        "d33_sha256": D33_SHA256,
        "s30_source_sha256": S30_SHA256,
        "s31_source_sha256": S31_SHA256,
        "btc_minute_catalog_sha256": btc["minute_catalog"]["sha256"],
        "instrument": instrument,
        "five_minute_last_bars": len(bars),
        "complete_four_hour_bars": len(candles),
        "first_anchor_date_window": FIRST_WINDOW,
        "first_anchor_price_band": FIRST_PRICE,
        "second_anchor_date_window": SECOND_WINDOW,
        "second_anchor_price_band": SECOND_PRICE,
        "recent_initial_break_start_utc": RECENT_BREAK_START,
        "s31_line_band": S31_LINE_BAND,
        "s30_line_band": S30_LINE_BAND,
        "later_touch_fraction_above_line": TOUCH_BAND_FRACTION,
        "cutoff_pairs": [
            _at_cutoffs(candles, s31, s30, prior[s31])
            for s31, s30 in zip(S31_CUTOFFS, S30_CUTOFFS, strict=True)
        ],
    }
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")


if __name__ == "__main__":
    main()
