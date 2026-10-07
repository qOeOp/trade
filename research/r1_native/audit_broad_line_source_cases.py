"""
Check D25's frozen causal broad-line selector at three source dates.
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
from audit_prior_line_anchors import LOOKBACK_BARS
from audit_prior_line_anchors import _confirmed_pivots
from audit_trendline_signal_parity import INPUT_SHA256
from strategy import STOP_BUFFER_ATR
from trendline_strategy import MIN_ANCHOR_SPAN
from trendline_strategy import PIVOT_ORDER

from vibe_trading.indicators import WilderMovingAverage


DECISIONS = {
    "BTC": "2026-07-23T00:00:00+00:00",
    "LINK": "2026-07-24T00:00:00+00:00",
    "ETH": "2026-07-24T00:00:00+00:00",
}
INSPECT_END = "2026-07-24T08:00:00+00:00"


def _iso(bar) -> str:
    return datetime.fromtimestamp(bar.ts_event / 1e9, UTC).isoformat()


def _line(candles, first: int, second: int, at: int) -> float:
    low1, low2 = float(candles[first].low), float(candles[second].low)
    return low2 + (low2 - low1) * (at - second) / (second - first)


def _select(candles, decision_i: int) -> tuple[int, int] | None:
    pivots = _confirmed_pivots(candles, decision_i)
    eligible = [i for i in pivots if i >= decision_i - LOOKBACK_BARS]
    if not eligible:
        return None
    first = min(eligible, key=lambda i: (float(candles[i].low), i))
    for second in eligible:
        if second - first < MIN_ANCHOR_SPAN:
            continue
        if float(candles[second].low) <= float(candles[first].low):
            continue
        if all(
            float(candles[i].close) > _line(candles, first, second, i)
            for i in range(second + 1, decision_i + 1)
        ):
            return first, second
    return None


def _prior_atrs(candles) -> list[float | None]:
    atr = WilderMovingAverage(14)
    values = []
    for i, bar in enumerate(candles):
        values.append(atr.value if atr.initialized else None)
        previous_close = float(candles[i - 1].close) if i else float(bar.close)
        atr.update_raw(
            max(
                float(bar.high) - float(bar.low),
                abs(float(bar.high) - previous_close),
                abs(float(bar.low) - previous_close),
            ),
        )
    return values


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
    identities = {row["coin"]: row for row in identity["coins"]}
    parities = {row["coin"]: row for row in parity["coins"]}
    output = {
        "scope": "D25 read-only causal source geometry; no orders, fills, or PnL",
        "registration_commit": "8e2618d9e",
        "input_identity_sha256": INPUT_SHA256,
        "corrected_h06_parity_sha256": PARITY_SHA256,
        "selector": {
            "pivot_order": PIVOT_ORDER,
            "first_anchor_lookback_bars": LOOKBACK_BARS,
            "minimum_anchor_span_bars": MIN_ANCHOR_SPAN,
            "touch_band_atr_fraction": STOP_BUFFER_ATR,
        },
        "cases": [],
    }
    for coin, decision_utc in DECISIONS.items():
        instrument, candles = _read_candles(
            args.catalog_root,
            identities[coin],
            parities[coin],
            _ns(parity["start_utc"]),
            _ns(parity["end_utc"]),
        )
        by_time = {bar.ts_event: i for i, bar in enumerate(candles)}
        decision_i = by_time.get(_ns(decision_utc))
        end_i = by_time.get(_ns(INSPECT_END))
        if decision_i is None or end_i is None or end_i < decision_i:
            raise RuntimeError(f"{coin}: incomplete source window")
        pair = _select(candles, decision_i)
        case = {
            "coin": coin,
            "instrument_id": instrument,
            "decision_utc": decision_utc,
            "selected_pair": None,
            "source_window_bars": [],
        }
        if pair is None:
            case["no_line_reason"] = (
                "no confirmed rising pair from lowest window pivot remained intact"
            )
            output["cases"].append(case)
            continue
        first, second = pair
        case["selected_pair"] = {
            "first_utc": _iso(candles[first]),
            "first_low": float(candles[first].low),
            "second_utc": _iso(candles[second]),
            "second_low": float(candles[second].low),
            "confirmed_by_decision": second + PIVOT_ORDER <= decision_i,
        }
        prior_atrs = _prior_atrs(candles)
        invalidated = False
        for i in range(decision_i, end_i + 1):
            bar = candles[i]
            projected = _line(candles, first, second, i)
            atr = prior_atrs[i]
            invalidated = invalidated or float(bar.close) <= projected
            distance = float(bar.low) - projected
            case["source_window_bars"].append(
                {
                    "utc": _iso(bar),
                    "low": float(bar.low),
                    "close": float(bar.close),
                    "line": projected,
                    "prior_atr": atr,
                    "low_minus_line_in_prior_atr": distance / atr if atr else None,
                    "near_touch": bool(atr and abs(distance) <= STOP_BUFFER_ATR * atr),
                    "line_invalidated_by_close": invalidated,
                },
            )
        output["cases"].append(case)
    args.output.write_text(json.dumps(output, indent=2) + "\n")


if __name__ == "__main__":
    main()
