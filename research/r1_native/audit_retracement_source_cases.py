"""
Audit D29 causal four-hour retracement anchors against retained source charts.

This reads the registered Nautilus LAST Catalog and creates no orders or PnL.

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
from strategy import BOX_BARS
from trendline_strategy import MIN_ANCHOR_SPAN
from trendline_strategy import PIVOT_ORDER


REGISTRATION_COMMIT = "272b341d2"
CASES = {
    "BTC": {
        "source_case": "C18",
        "cutoffs": ("2026-01-08T00:00:00+00:00", "2026-01-08T04:00:00+00:00"),
        "bands": {
            "0.5": (90_800, 91_300),
            "0.618": (89_700, 90_400),
            "0.764": (88_500, 89_300),
        },
    },
    "ETH": {
        "source_case": "C19",
        "cutoffs": ("2026-04-13T00:00:00+00:00", "2026-04-13T04:00:00+00:00"),
        "bands": {
            "0.5": (2_170, 2_210),
            "0.618": (2_135, 2_175),
            "0.764": (2_100, 2_145),
        },
    },
}


def _utc(ns: int) -> str:
    return datetime.fromtimestamp(ns / 1e9, UTC).isoformat()


def _source_band_difference(value: float, lower: float, upper: float) -> float:
    if value < lower:
        return value - lower
    if value > upper:
        return value - upper
    return 0.0


def _one_cutoff(candles, cutoff: str, bands: dict) -> dict:
    by_time = {bar.ts_event: i for i, bar in enumerate(candles)}
    decision_i = by_time.get(_ns(cutoff))
    if decision_i is None or decision_i < LOOKBACK_BARS:
        raise RuntimeError(f"incomplete four-hour history at {cutoff}")
    known = candles[: decision_i + 1]
    row = {
        "decision_utc": cutoff,
        "last_completed_four_hour_utc": _utc(known[-1].ts_event),
        "last_completed_close": float(known[-1].close),
        "impulse": None,
        "no_impulse_reason": None,
        "levels": None,
        "all_levels_in_source_bands": False,
    }
    first_b = decision_i - BOX_BARS + 1
    b = max(range(first_b, decision_i + 1), key=lambda j: (float(known[j].high), -j))
    lows = [
        j
        for j in _confirmed_pivots(known, decision_i)
        if decision_i - LOOKBACK_BARS <= j < b and b - j >= MIN_ANCHOR_SPAN
    ]
    if not lows:
        row["no_impulse_reason"] = "no eligible confirmed low before the selected 60-bar high"
        return row
    a = lows[-1]
    low, high = float(known[a].low), float(known[b].high)
    if high <= low:
        row["no_impulse_reason"] = "selected high does not exceed selected low"
        return row
    if float(known[-1].close) >= high:
        row["no_impulse_reason"] = "current completed close is not below selected high"
        return row
    row["impulse"] = {
        "low_anchor_utc": _utc(known[a].ts_event),
        "low_confirmed_utc": _utc(known[a + PIVOT_ORDER].ts_event),
        "low": low,
        "high_anchor_utc": _utc(known[b].ts_event),
        "high": high,
        "high_age_four_hour_bars": decision_i - b,
        "anchor_span_four_hour_bars": b - a,
        "confirmed_low_candidates_before_high": len(lows),
    }
    span = high - low
    levels = {}
    for ratio, (lower, upper) in bands.items():
        value = high - float(ratio) * span
        levels[ratio] = {
            "price": value,
            "source_chart_band": [lower, upper],
            "signed_difference_from_band": _source_band_difference(value, lower, upper),
            "inside_observed_impulse": low < value < high,
        }
    row["levels"] = levels
    row["levels_ordered"] = (
        levels["0.5"]["price"] > levels["0.618"]["price"] > levels["0.764"]["price"]
    )
    row["all_levels_in_source_bands"] = row["levels_ordered"] and all(
        level["signed_difference_from_band"] == 0.0 and level["inside_observed_impulse"]
        for level in levels.values()
    )
    return row


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
        raise RuntimeError("corrected 37-coin signal parity is required")
    identities = {row["coin"]: row for row in identity["coins"]}
    parities = {row["coin"]: row for row in parity["coins"]}
    output = {
        "scope": "D29 source-date four-hour anchor geometry only; no orders, fills, PnL or selected cutoff",
        "registration_commit": REGISTRATION_COMMIT,
        "input_identity_sha256": INPUT_SHA256,
        "corrected_h06_parity_sha256": PARITY_SHA256,
        "selector": {
            "recent_high_bars": BOX_BARS,
            "confirmed_low_order": PIVOT_ORDER,
            "low_lookback_bars": LOOKBACK_BARS,
            "minimum_anchor_span_bars": MIN_ANCHOR_SPAN,
            "equal_high_tie": "earliest",
            "low_choice": "latest eligible",
        },
        "cases": [],
    }
    for coin, spec in CASES.items():
        instrument, candles = _read_candles(
            args.catalog_root,
            identities[coin],
            parities[coin],
            _ns(parity["start_utc"]),
            _ns(parity["end_utc"]),
        )
        output["cases"].append(
            {
                "coin": coin,
                "source_case": spec["source_case"],
                "instrument_id": instrument,
                "minute_catalog_sha256": identities[coin]["minute_catalog"]["sha256"],
                "cutoffs": [
                    _one_cutoff(candles, cutoff, spec["bands"]) for cutoff in spec["cutoffs"]
                ],
            },
        )
        print(f"{coin}: registered source-date cutoffs read", flush=True)
    args.output.write_text(json.dumps(output, indent=2) + "\n")


if __name__ == "__main__":
    main()
