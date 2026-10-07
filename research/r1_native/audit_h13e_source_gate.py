"""
Read H13e prior-resistance breakout support at frozen source cutoffs.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from audit_h13_source_gate import _source_case
from audit_h13b_source_gate import S27
from audit_h13b_source_gate import _plan_matches_s27
from audit_line_box_context import PARITY_SHA256
from audit_line_box_context import _ns
from audit_line_box_context import _read_candles
from audit_retracement_source_cases import CASES
from audit_trendline_signal_parity import INPUT_SHA256
from retracement_strategy import MIN_ANCHOR_SPAN
from retracement_strategy import PIVOT_ORDER


def _causal_resistance_plan(plan: dict) -> bool:
    highs = plan["support_high_indices"]
    return (
        plan["support_kind"] == "old-resistance-highs"
        and len(highs) >= 2
        and highs[-1] - highs[0] >= MIN_ANCHOR_SPAN
        and all(index + PIVOT_ORDER < plan["b_index"] for index in highs)
        and not plan["support_low_indices"]
    )


def _positive(case: dict, *, s27: bool = False) -> bool:
    return any(
        len(row["active_untouched_plans"]) == 1
        and _causal_resistance_plan(row["active_untouched_plans"][0])
        and (
            _plan_matches_s27(row["active_untouched_plans"][0])
            if s27
            else row["active_untouched_plans"][0]["all_tiers_in_source_bands"]
        )
        for row in case["cutoffs"]
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
        raise RuntimeError("corrected native LAST parity bytes changed")
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
    cases = {
        "s27_primary": _source_case(
            candles["BTC"],
            S27,
            timing="confirmed-update",
            expiry_bars=30,
            support_mode="prior-highs",
        ),
        "s24_exposed_sensitivity": _source_case(
            candles["BTC"],
            CASES["BTC"],
            timing="confirmed-update",
            expiry_bars=30,
            support_mode="prior-highs",
        ),
        "c19_negative": _source_case(
            candles["ETH"],
            CASES["ETH"],
            timing="confirmed-update",
            expiry_bars=30,
            support_mode="prior-highs",
        ),
    }
    s27_pass = _positive(cases["s27_primary"], s27=True)
    s24_pass = _positive(cases["s24_exposed_sensitivity"])
    false_match = any(
        not plan["all_tiers_in_source_bands"]
        for row in cases["c19_negative"]["cutoffs"]
        for plan in row["active_untouched_plans"]
    )
    single = all(
        len(row["active_untouched_plans"]) <= 1
        for case in cases.values()
        for row in case["cutoffs"]
    )
    result = {
        "method": "registered H13e pre-B resistance-high-to-support source audit on native LAST Catalog; no orders, fills, PnL or account replay",
        "registration_commits": ["de6fbc86b", "c3b63c63e"],
        "input_identity_sha256": INPUT_SHA256,
        "corrected_parity_sha256": PARITY_SHA256,
        "instruments": instruments,
        **cases,
        "s27_positive_source_gate": s27_pass,
        "s24_exposed_sensitivity_gate": s24_pass,
        "c19_wrong_anchor_false_match": false_match,
        "single_unfilled_plan_at_cutoffs": single,
        "passed": s27_pass and s24_pass and not false_match and single,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    if not result["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
