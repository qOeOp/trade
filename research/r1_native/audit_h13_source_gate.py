"""
Read H13 signal availability at frozen source cutoffs without fills or PnL.
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
from audit_retracement_source_cases import CASES
from audit_trendline_signal_parity import INPUT_SHA256
from retracement_strategy import ConfirmedSupportPullback
from strategy import BOX_RETEST_BARS
from strategy import FOUR_HOUR_NS
from strategy import FourHour

from vibe_trading.indicators import WilderMovingAverage


def _utc(ns: int) -> str:
    return datetime.fromtimestamp(ns / 1e9, UTC).isoformat()


def _inside_bands(plan: dict, bands: dict) -> bool:
    return all(
        bounds[0] <= plan[name] <= bounds[1]
        for name, bounds in (
            ("level_50", bands["0.5"]),
            ("entry", bands["0.618"]),
            ("level_764", bands["0.764"]),
        )
    )


def _source_case(candles, case: dict) -> dict:
    cutoffs = {_ns(value): value for value in case["cutoffs"]}
    state = ConfirmedSupportPullback()
    atr = WilderMovingAverage(14)
    active: list[dict] = []
    rows = []
    for bar in candles:
        candle = FourHour(bar.ts_event, float(bar.high), float(bar.low), float(bar.close))
        previous_close = state.candles[-1].close if state.candles else candle.close
        true_range = max(
            candle.high - candle.low,
            abs(candle.high - previous_close),
            abs(candle.low - previous_close),
        )
        active = [
            plan
            for plan in active
            if candle.ts_event < plan["ts_event"] + BOX_RETEST_BARS * FOUR_HOUR_NS
            and not (candle.ts_event > plan["ts_event"] and candle.low <= plan["entry"])
        ]
        plan = state.on_closed(candle, atr.value if atr.initialized else None)
        atr.update_raw(true_range)
        if plan is not None:
            active.append(plan.as_dict())
        if candle.ts_event in cutoffs:
            row = {
                "cutoff_utc": cutoffs[candle.ts_event],
                "last_close": candle.close,
                "last_low": candle.low,
                "current_readout": state.last_readout,
                "active_untouched_plans": [
                    {
                        **one,
                        "armed_utc": _utc(one["ts_event"]),
                        "all_tiers_in_source_bands": _inside_bands(one, case["bands"]),
                        "prior_support_times": [
                            _utc(state.candles[index].ts_event)
                            for index in one["support_low_indices"]
                        ],
                    }
                    for one in active
                ],
            }
            rows.append(row)
        if candle.ts_event >= max(cutoffs):
            break
    if len(rows) != len(cutoffs):
        raise RuntimeError("source cutoffs lack completed native four-hour bars")
    return {"source_case": case["source_case"], "cutoffs": rows}


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
        raise RuntimeError("corrected 37-coin source coverage is required")
    rows = {}
    for coin in ("BTC", "ETH"):
        input_row = next(row for row in identity["coins"] if row["coin"] == coin)
        parity_row = next(row for row in parity["coins"] if row["coin"] == coin)
        instrument, candles = _read_candles(
            args.catalog_root,
            input_row,
            parity_row,
            _ns(parity["start_utc"]),
            _ns(parity["end_utc"]),
        )
        rows[coin] = {"instrument": instrument, **_source_case(candles, CASES[coin])}
    positive = any(
        plan["all_tiers_in_source_bands"]
        for row in rows["BTC"]["cutoffs"]
        for plan in row["active_untouched_plans"]
    )
    false_match = any(
        not plan["all_tiers_in_source_bands"]
        for row in rows["ETH"]["cutoffs"]
        for plan in row["active_untouched_plans"]
    )
    result = {
        "method": "registered H13 source-date signal availability on verified native LAST catalogs; no orders, fills, PnL or account replay",
        "registration_commit": "c5e8fb341",
        "input_identity_sha256": INPUT_SHA256,
        "corrected_parity_sha256": PARITY_SHA256,
        "s24_source_sha256": hashlib.sha256(
            Path(__file__)
            .with_name("results")
            .joinpath("2026-10-08-s24-btc-prior-plan-source.json")
            .read_bytes(),
        ).hexdigest(),
        "d29_source_case_sha256": hashlib.sha256(
            Path(__file__)
            .with_name("results")
            .joinpath("2026-10-08-d29-retracement-source-cases.json")
            .read_bytes(),
        ).hexdigest(),
        "coins": rows,
        "btc_positive_source_gate": positive,
        "eth_wrong_anchor_false_match": false_match,
        "passed": positive and not false_match,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    if not result["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
