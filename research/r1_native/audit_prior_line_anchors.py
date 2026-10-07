"""
Enumerate causal BTC pivot-low lines at S17 without orders or PnL.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from datetime import UTC
from datetime import datetime
from pathlib import Path

from audit_line_box_context import PARITY_SHA256
from audit_line_box_context import _ns
from audit_line_box_context import _read_candles
from audit_trendline_signal_parity import INPUT_SHA256
from trendline_strategy import MIN_ANCHOR_SPAN
from trendline_strategy import PIVOT_ORDER


DECISION_UTC = "2026-07-23T00:00:00+00:00"
PROJECTION_UTC = "2026-07-24T00:00:00+00:00"
LOOKBACK_BARS = 180


def _confirmed_pivots(candles, decision_i: int) -> list[int]:
    pivots = []
    for i in range(2 * PIVOT_ORDER, decision_i + 1):
        j = i - PIVOT_ORDER
        window = candles[j - PIVOT_ORDER : j + PIVOT_ORDER + 1]
        if float(candles[j].low) == min(float(bar.low) for bar in window):
            pivots.append(j)
    return pivots


def _line_row(candles, j1: int, j2: int, decision_i: int, projection_i: int):
    p1, p2 = float(candles[j1].low), float(candles[j2].low)
    slope = (p2 - p1) / (j2 - j1)

    def projected(i: int):
        return p2 + slope * (i - j2)

    if any(float(candles[i].close) <= projected(i) for i in range(j2 + 1, decision_i + 1)):
        return None
    later_breaks = [
        i
        for i in range(decision_i + 1, projection_i + 1)
        if float(candles[i].close) <= projected(i)
    ]
    return {
        "first_index": j1,
        "first_utc": datetime.fromtimestamp(candles[j1].ts_event / 1e9, UTC).isoformat(),
        "first_low": p1,
        "second_index": j2,
        "second_utc": datetime.fromtimestamp(candles[j2].ts_event / 1e9, UTC).isoformat(),
        "second_low": p2,
        "second_confirmed_by_decision": j2 + PIVOT_ORDER <= decision_i,
        "slope_per_four_hour_bar": slope,
        "projected_at_decision": projected(decision_i),
        "projected_at_following_day": projected(projection_i),
        "later_first_close_break_utc": (
            datetime.fromtimestamp(candles[later_breaks[0]].ts_event / 1e9, UTC).isoformat()
            if later_breaks
            else None
        ),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-identity", type=Path, required=True)
    parser.add_argument("--catalog-root", type=Path, required=True)
    parser.add_argument("--parity", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if hashlib.sha256(args.input_identity.read_bytes()).hexdigest() != INPUT_SHA256:
        raise RuntimeError("registered input identity bytes changed")
    if hashlib.sha256(args.parity.read_bytes()).hexdigest() != PARITY_SHA256:
        raise RuntimeError("corrected full-coverage parity bytes changed")
    identity = json.loads(args.input_identity.read_text())
    parity = json.loads(args.parity.read_text())
    if not parity["all_exact"] or len(parity["coins"]) != 37:
        raise RuntimeError("corrected full-coverage parity is required")
    btc = next(row for row in identity["coins"] if row["coin"] == "BTC")
    btc_parity = next(row for row in parity["coins"] if row["coin"] == "BTC")
    instrument, candles = _read_candles(
        args.catalog_root,
        btc,
        btc_parity,
        _ns(parity["start_utc"]),
        _ns(parity["end_utc"]),
    )
    by_time = {bar.ts_event: i for i, bar in enumerate(candles)}
    decision_i = by_time.get(_ns(DECISION_UTC))
    projection_i = by_time.get(_ns(PROJECTION_UTC))
    if decision_i is None or projection_i is None or projection_i - decision_i != 6:
        raise RuntimeError("source dates lack exactly six completed four-hour bars")
    pivots = _confirmed_pivots(candles, decision_i)
    selected = [j for j in pivots if j >= decision_i - LOOKBACK_BARS]
    pairs = []
    for pos, j1 in enumerate(selected):
        for j2 in selected[pos + 1 :]:
            if j2 - j1 < MIN_ANCHOR_SPAN or float(candles[j2].low) <= float(candles[j1].low):
                continue
            row = _line_row(candles, j1, j2, decision_i, projection_i)
            if row is not None:
                pairs.append(row)
    latest_pair = pivots[-2:]
    latest_row = (
        _line_row(candles, latest_pair[0], latest_pair[1], decision_i, projection_i)
        if len(latest_pair) == 2
        else None
    )
    output = {
        "scope": "read-only S17 BTC prior-day causal pivot-pair enumeration; no selected strategy, orders, fills or PnL",
        "input_identity_sha256": INPUT_SHA256,
        "corrected_h06_parity_sha256": PARITY_SHA256,
        "instrument": instrument,
        "decision_utc": DECISION_UTC,
        "projection_utc": PROJECTION_UTC,
        "pivot_order": PIVOT_ORDER,
        "minimum_anchor_span_bars": MIN_ANCHOR_SPAN,
        "first_anchor_lookback_bars": LOOKBACK_BARS,
        "complete_four_hour_bars": len(candles),
        "confirmed_low_pivots_before_decision": len(pivots),
        "selected_window_low_pivots": len(selected),
        "causal_intact_rising_pairs": len(pairs),
        "pairs_projecting_64000_to_65000": sum(
            64_000 <= row["projected_at_following_day"] <= 65_000 for row in pairs
        ),
        "latest_two_confirmed_low_indices": latest_pair,
        "latest_two_pair_intact_at_decision": latest_row is not None,
        "latest_two_pair_if_intact": latest_row,
        "all_intact_pairs": pairs,
    }
    args.output.write_text(json.dumps(output, indent=2) + "\n")


if __name__ == "__main__":
    main()
