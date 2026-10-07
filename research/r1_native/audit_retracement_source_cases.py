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
D29_SHA256 = "af99c02990294d60daa64f89ed8b0605e337a251f2bba2f5630f5f7885b4aede"
S27_SHA256 = "284b15c1f4ac5476e8d4f548ffa46891c40a163965fe69b4c09e07fcdfe15d1c"
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
S27_BANDS = {
    "high_anchor": (72_500, 73_000),
    "low_anchor": (67_500, 68_000),
    "0.5": (70_150, 70_550),
    "0.618": (69_450, 69_850),
    "0.764": (68_700, 69_200),
}
S27_CUTOFFS = ("2026-04-09T00:00:00+00:00", "2026-04-09T04:00:00+00:00")


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


def _anchor_space(candles, cutoff: str, bands: dict, d29_cutoff: dict) -> dict:
    by_time = {bar.ts_event: i for i, bar in enumerate(candles)}
    decision_i = by_time.get(_ns(cutoff))
    if decision_i is None or decision_i < LOOKBACK_BARS:
        raise RuntimeError(f"incomplete four-hour history at {cutoff}")
    known = candles[: decision_i + 1]
    first_b = decision_i - BOX_BARS + 1
    b = max(range(first_b, decision_i + 1), key=lambda j: (float(known[j].high), -j))
    frozen_impulse = d29_cutoff["impulse"]
    if frozen_impulse is None or (
        frozen_impulse["high_anchor_utc"] != _utc(known[b].ts_event)
        or frozen_impulse["high"] != float(known[b].high)
    ):
        raise RuntimeError(f"D30 high anchor differs from D29 at {cutoff}")
    candidates = []
    for a in _confirmed_pivots(known, decision_i):
        if not (decision_i - LOOKBACK_BARS <= a < b and b - a >= MIN_ANCHOR_SPAN):
            continue
        low, high = float(known[a].low), float(known[b].high)
        valid = low < high and float(known[-1].close) < high
        levels = {}
        for ratio, (lower, upper) in bands.items():
            value = high - float(ratio) * (high - low)
            levels[ratio] = {
                "price": value,
                "source_chart_band": [lower, upper],
                "signed_difference_from_band": _source_band_difference(value, lower, upper),
            }
        candidates.append(
            {
                "low_anchor_utc": _utc(known[a].ts_event),
                "low_confirmed_utc": _utc(known[a + PIVOT_ORDER].ts_event),
                "low": low,
                "anchor_span_four_hour_bars": b - a,
                "valid_impulse": valid,
                "levels": levels,
                "all_levels_in_source_bands": valid
                and all(level["signed_difference_from_band"] == 0 for level in levels.values()),
            },
        )
    return {
        "decision_utc": cutoff,
        "selected_high_utc": _utc(known[b].ts_event),
        "selected_high": float(known[b].high),
        "candidate_count": len(candidates),
        "source_band_match_count": sum(row["all_levels_in_source_bands"] for row in candidates),
        "candidates": candidates,
    }


def _major_low_cutoff(candles, cutoff: str) -> dict:
    by_time = {bar.ts_event: i for i, bar in enumerate(candles)}
    decision_i = by_time.get(_ns(cutoff))
    if decision_i is None or decision_i < LOOKBACK_BARS:
        raise RuntimeError(f"incomplete four-hour history at {cutoff}")
    known = candles[: decision_i + 1]
    first = decision_i - BOX_BARS + 1
    b = max(range(first, decision_i + 1), key=lambda j: (float(known[j].high), -j))
    eligible = [
        j
        for j in _confirmed_pivots(known, decision_i)
        if first <= j < b and b - j >= MIN_ANCHOR_SPAN
    ]
    row = {
        "decision_utc": cutoff,
        "last_completed_four_hour_utc": _utc(known[-1].ts_event),
        "last_completed_close": float(known[-1].close),
        "eligible_confirmed_low_count": len(eligible),
        "impulse": None,
        "no_impulse_reason": None,
        "source_band_differences": None,
        "all_anchor_and_tier_bands_match": False,
    }
    if not eligible:
        row["no_impulse_reason"] = "no confirmed low in the same prior 60-bar window before B"
        return row
    a = min(eligible, key=lambda j: (float(known[j].low), j))
    low, high = float(known[a].low), float(known[b].high)
    if high <= low:
        row["no_impulse_reason"] = "selected high does not exceed selected low"
        return row
    if float(known[-1].close) >= high:
        row["no_impulse_reason"] = "current completed close is not below selected high"
        return row
    levels = {ratio: high - float(ratio) * (high - low) for ratio in ("0.5", "0.618", "0.764")}
    row["impulse"] = {
        "low_anchor_utc": _utc(known[a].ts_event),
        "low_confirmed_utc": _utc(known[a + PIVOT_ORDER].ts_event),
        "low": low,
        "high_anchor_utc": _utc(known[b].ts_event),
        "high": high,
        "high_age_four_hour_bars": decision_i - b,
        "anchor_span_four_hour_bars": b - a,
        "levels": levels,
    }
    values = {"low_anchor": low, "high_anchor": high, **levels}
    row["source_band_differences"] = {
        name: _source_band_difference(value, *S27_BANDS[name]) for name, value in values.items()
    }
    row["all_anchor_and_tier_bands_match"] = all(
        difference == 0 for difference in row["source_band_differences"].values()
    )
    return row


def _run_major_low(args, parity: dict, identities: dict, parities: dict) -> None:
    if args.s27 is None or hashlib.sha256(args.s27.read_bytes()).hexdigest() != S27_SHA256:
        raise RuntimeError("D31 requires the exact retained S27 source receipt")
    source = json.loads(args.s27.read_text())
    if source["source_metadata"]["video_id"] != "wDlDZ2iNxik":
        raise RuntimeError("S27 source identity mismatch")
    row = identities["BTC"]
    instrument, candles = _read_candles(
        args.catalog_root,
        row,
        parities["BTC"],
        _ns(parity["start_utc"]),
        _ns(parity["end_utc"]),
    )
    output = {
        "scope": "D31 H09b BTC source-date geometry only; no orders, fills or PnL",
        "registration_commit": "ef7e14902",
        "input_identity_sha256": INPUT_SHA256,
        "corrected_h06_parity_sha256": PARITY_SHA256,
        "s27_source_receipt_sha256": S27_SHA256,
        "coin": "BTC",
        "instrument_id": instrument,
        "minute_catalog_sha256": row["minute_catalog"]["sha256"],
        "selector": {
            "recent_high_bars": BOX_BARS,
            "confirmed_low_order": PIVOT_ORDER,
            "low_lookback_bars": BOX_BARS,
            "minimum_anchor_span_bars": MIN_ANCHOR_SPAN,
            "low_choice": "lowest eligible; earlier pivot on equal price",
        },
        "source_bands": S27_BANDS,
        "cutoffs": [_major_low_cutoff(candles, cutoff) for cutoff in S27_CUTOFFS],
        "primary_cutoff_utc": S27_CUTOFFS[1],
    }
    args.output.write_text(json.dumps(output, indent=2) + "\n")
    print("BTC: H09b source-date geometry read", flush=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-identity", type=Path, required=True)
    parser.add_argument("--catalog-root", type=Path, required=True)
    parser.add_argument("--parity", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--anchor-space", action="store_true")
    parser.add_argument("--d29", type=Path)
    parser.add_argument("--major-low", action="store_true")
    parser.add_argument("--s27", type=Path)
    args = parser.parse_args()
    if args.anchor_space and args.major_low:
        raise RuntimeError("choose one diagnostic mode")
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
    d29_cases = None
    if args.anchor_space:
        if args.d29 is None or hashlib.sha256(args.d29.read_bytes()).hexdigest() != D29_SHA256:
            raise RuntimeError("D30 requires the exact retained D29 result")
        d29_cases = {row["coin"]: row for row in json.loads(args.d29.read_text())["cases"]}
    if args.major_low:
        _run_major_low(args, parity, identities, parities)
        return
    output = {
        "scope": (
            "D30 complete causal low-anchor space; no selection, orders, fills or PnL"
            if args.anchor_space
            else "D29 source-date four-hour anchor geometry only; no orders, fills, PnL or selected cutoff"
        ),
        "registration_commit": "38f539fad" if args.anchor_space else REGISTRATION_COMMIT,
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
    if args.anchor_space:
        output["d29_result_sha256"] = D29_SHA256
    for coin, spec in CASES.items():
        instrument, candles = _read_candles(
            args.catalog_root,
            identities[coin],
            parities[coin],
            _ns(parity["start_utc"]),
            _ns(parity["end_utc"]),
        )
        d29_cutoffs = (
            {row["decision_utc"]: row for row in d29_cases[coin]["cutoffs"]}
            if d29_cases is not None
            else None
        )
        cutoffs = [
            _anchor_space(candles, cutoff, spec["bands"], d29_cutoffs[cutoff])
            if d29_cutoffs is not None
            else _one_cutoff(candles, cutoff, spec["bands"])
            for cutoff in spec["cutoffs"]
        ]
        output["cases"].append(
            {
                "coin": coin,
                "source_case": spec["source_case"],
                "instrument_id": instrument,
                "minute_catalog_sha256": identities[coin]["minute_catalog"]["sha256"],
                "cutoffs": cutoffs,
            },
        )
        print(f"{coin}: registered source-date cutoffs read", flush=True)
    args.output.write_text(json.dumps(output, indent=2) + "\n")


if __name__ == "__main__":
    main()
