"""
Enumerate D26's causal LINK support pairs without choosing one.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from audit_broad_line_source_cases import _prior_atrs
from audit_line_box_context import PARITY_SHA256
from audit_line_box_context import _ns
from audit_line_box_context import _read_candles
from audit_prior_line_anchors import LOOKBACK_BARS
from audit_prior_line_anchors import _confirmed_pivots
from audit_prior_line_anchors import _line_row
from audit_trendline_signal_parity import INPUT_SHA256
from strategy import STOP_BUFFER_ATR
from trendline_strategy import MIN_ANCHOR_SPAN
from trendline_strategy import PIVOT_ORDER


DECISION_UTC = "2026-07-24T00:00:00+00:00"
TEST_UTC = "2026-07-24T04:00:00+00:00"


def _enumerate_pairs(candles, decision_i: int, test_i: int, atr: float):
    test_low = float(candles[test_i].low)
    pivots = _confirmed_pivots(candles, decision_i)
    eligible = [i for i in pivots if i >= decision_i - LOOKBACK_BARS]
    pairs = []
    for pos, first in enumerate(eligible):
        for second in eligible[pos + 1 :]:
            if second - first < MIN_ANCHOR_SPAN:
                continue
            if float(candles[second].low) <= float(candles[first].low):
                continue
            row = _line_row(candles, first, second, decision_i, test_i)
            if row is None:
                continue
            projected_at_test = row.pop("projected_at_following_day")
            row["projected_at_test"] = projected_at_test
            row["test_low_minus_line_in_prior_atr"] = (test_low - projected_at_test) / atr
            row["within_frozen_touch_band"] = (
                abs(test_low - projected_at_test) <= STOP_BUFFER_ATR * atr
            )
            pairs.append(row)
    return pivots, eligible, pairs


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
    link = next(row for row in identity["coins"] if row["coin"] == "LINK")
    link_parity = next(row for row in parity["coins"] if row["coin"] == "LINK")
    instrument, candles = _read_candles(
        args.catalog_root,
        link,
        link_parity,
        _ns(parity["start_utc"]),
        _ns(parity["end_utc"]),
    )
    by_time = {bar.ts_event: i for i, bar in enumerate(candles)}
    decision_i = by_time.get(_ns(DECISION_UTC))
    test_i = by_time.get(_ns(TEST_UTC))
    if decision_i is None or test_i != decision_i + 1:
        raise RuntimeError(
            "LINK source pair needs consecutive completed four-hour bars",
        )
    atr = _prior_atrs(candles)[test_i]
    if atr is None:
        raise RuntimeError("LINK source bar lacks prior ATR")
    test_low = float(candles[test_i].low)
    pivots, eligible, pairs = _enumerate_pairs(candles, decision_i, test_i, atr)
    output = {
        "scope": "D26 read-only LINK causal pair availability; no selected strategy, orders, fills, or PnL",
        "registration_commit": "653c3f80d",
        "input_identity_sha256": INPUT_SHA256,
        "corrected_h06_parity_sha256": PARITY_SHA256,
        "instrument": instrument,
        "decision_utc": DECISION_UTC,
        "test_utc": TEST_UTC,
        "test_low": test_low,
        "test_prior_atr": atr,
        "pivot_order": PIVOT_ORDER,
        "minimum_anchor_span_bars": MIN_ANCHOR_SPAN,
        "first_anchor_lookback_bars": LOOKBACK_BARS,
        "touch_band_atr_fraction": STOP_BUFFER_ATR,
        "confirmed_pivots_at_decision": len(pivots),
        "eligible_window_pivots": len(eligible),
        "intact_rising_pairs_at_decision": len(pairs),
        "pairs_within_frozen_touch_band": sum(row["within_frozen_touch_band"] for row in pairs),
        "all_intact_pairs": pairs,
    }
    args.output.write_text(json.dumps(output, indent=2) + "\n")


if __name__ == "__main__":
    main()
