"""
Read immediate H13b plans at frozen source dates without order or PnL data.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from audit_h13_source_gate import _source_case
from audit_line_box_context import PARITY_SHA256
from audit_line_box_context import _ns
from audit_line_box_context import _read_candles
from audit_retracement_source_cases import CASES
from audit_retracement_source_cases import S27_BANDS
from audit_retracement_source_cases import S27_CUTOFFS
from audit_trendline_signal_parity import INPUT_SHA256


S27 = {"source_case": "S27", "cutoffs": S27_CUTOFFS, "bands": S27_BANDS}


def _plan_matches_s27(plan: dict) -> bool:
    return (
        plan["all_tiers_in_source_bands"]
        and S27_BANDS["low_anchor"][0] <= plan["a_low"] <= S27_BANDS["low_anchor"][1]
        and S27_BANDS["high_anchor"][0] <= plan["b_high"] <= S27_BANDS["high_anchor"][1]
    )


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
    candles = {}
    instruments = {}
    for coin in ("BTC", "ETH"):
        input_row = next(row for row in identity["coins"] if row["coin"] == coin)
        parity_row = next(row for row in parity["coins"] if row["coin"] == coin)
        instruments[coin], candles[coin] = _read_candles(
            args.catalog_root,
            input_row,
            parity_row,
            _ns(parity["start_utc"]),
            _ns(parity["end_utc"]),
        )
    s27 = _source_case(candles["BTC"], S27, timing="immediate", expiry_bars=30)
    s24 = _source_case(candles["BTC"], CASES["BTC"], timing="immediate", expiry_bars=30)
    c19 = _source_case(candles["ETH"], CASES["ETH"], timing="immediate", expiry_bars=30)
    positive = any(
        _plan_matches_s27(plan) for row in s27["cutoffs"] for plan in row["active_untouched_plans"]
    )
    false_match = any(
        not plan["all_tiers_in_source_bands"]
        for row in c19["cutoffs"]
        for plan in row["active_untouched_plans"]
    )
    result = {
        "method": "registered H13b immediate-plan source-date audit on verified native LAST catalogs; no orders, fills, PnL or account replay",
        "registration_commit": "1683fdbec",
        "input_identity_sha256": INPUT_SHA256,
        "corrected_parity_sha256": PARITY_SHA256,
        "s27_source_sha256": hashlib.sha256(
            Path(__file__)
            .with_name("results")
            .joinpath("2026-10-08-s27-btc-pullback-source.json")
            .read_bytes(),
        ).hexdigest(),
        "s24_source_sha256": hashlib.sha256(
            Path(__file__)
            .with_name("results")
            .joinpath("2026-10-08-s24-btc-prior-plan-source.json")
            .read_bytes(),
        ).hexdigest(),
        "instruments": instruments,
        "s27_primary": s27,
        "s24_exposed_sensitivity": s24,
        "c19_negative": c19,
        "s27_positive_source_gate": positive,
        "c19_wrong_anchor_false_match": false_match,
        "passed": positive and not false_match,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    if not result["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
