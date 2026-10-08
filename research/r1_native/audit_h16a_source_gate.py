"""
Check the frozen two deeper source tiers against H15a's actual selector.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path


SELECTOR_SHA256 = "24ab9596221059ef5960c05db51abb207bf8b405bfd6fd7d1da2e58176490a3c"
SOURCE_GATE_SHA256 = "d5930ce2618265d299f397423a76a2ff2c2f975b90609943efad9dfa403fc7e3"


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def audit(selector_path: Path, source_path: Path) -> dict:
    if _sha(selector_path) != SELECTOR_SHA256 or _sha(source_path) != SOURCE_GATE_SHA256:
        raise RuntimeError("frozen H15a source identities differ")
    selector = json.loads(selector_path.read_text())
    source = json.loads(source_path.read_text())
    if not selector["s27_exact_selector_passed"] or not source["passed_scoped_s27_source_gate"]:
        raise RuntimeError("H15a source parent did not pass")
    rows = []
    for actual, bundle in zip(
        selector["rows"]["BTC"]["s27"],
        source["s27_bundles"],
        strict=True,
    ):
        plan = actual["active_untouched_plan"]
        tiers = bundle["tiers"]
        if (
            plan is None
            or actual["cutoff_utc"] != bundle["cutoff_utc"]
            or plan["a_low"] != 67_711
            or plan["b_high"] != 72_858.5
            or not bundle["all_tiers_untouched_since_b"]
            or not bundle["common_stop_below_a"]
            or [tier["retracement_ratio"] for tier in tiers] != ["0.5", "0.618", "0.764"]
        ):
            raise RuntimeError("S27 actual selector and source geometry differ")
        rows.append(
            {
                "cutoff_utc": actual["cutoff_utc"],
                "armed_utc": actual["active_armed_utc"],
                "selected_a_b": bundle["selected_a_b"],
                "two_limit_prices": [tier["native_limit_price"] for tier in tiers[1:]],
                "common_stop": bundle["native_common_stop"],
                "first_target": bundle["native_first_target"],
                "two_target_r": [tier["native_target_r"] for tier in tiers[1:]],
            },
        )
    s24_no_plan = all(
        row["active_untouched_plan"] is None for row in selector["rows"]["BTC"]["s24"]
    )
    c19_no_plan = all(
        row["active_untouched_plan"] is None for row in selector["rows"]["ETH"]["c19"]
    )
    passed = (
        len(rows) == 2
        and all(
            row["two_limit_prices"] == [69_677.3, 68_925.8]
            and row["common_stop"] == 67_441.1
            and row["first_target"] == 72_858.5
            for row in rows
        )
        and s24_no_plan
        and c19_no_plan
    )
    return {
        "method": "frozen H15a actual selector plus native Instrument-rounded S27 source geometry; no orders or PnL",
        "selector_sha256": SELECTOR_SHA256,
        "source_gate_sha256": SOURCE_GATE_SHA256,
        "s27_two_tier_rows": rows,
        "s24_post_50_touch_no_new_plan": s24_no_plan,
        "c19_wrong_anchor_no_new_plan": c19_no_plan,
        "sui_anchor_ambiguity_retained": True,
        "passed": passed,
        "economic_data_read": False,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--selector", type=Path, required=True)
    parser.add_argument("--source-gate", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = audit(args.selector, args.source_gate)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    if not result["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
