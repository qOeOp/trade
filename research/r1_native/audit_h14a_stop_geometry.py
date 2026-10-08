"""
Compare frozen H14a source-case stops with a common-stop tier boundary.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from decimal import Decimal
from pathlib import Path


EXPECTED_SHA256 = {
    "s27": "284b15c1f4ac5476e8d4f548ffa46891c40a163965fe69b4c09e07fcdfe15d1c",
    "s24": "4cac7ad01f5825513f615dad9d73abc946c43bbba93dd1417fb22c7e1bdfd577",
    "h14a": "99a7280b6fd5f187fc626dedf1c96092bfb18da206f0b9b7c213c5c9630f8084",
    "d41": "490a93b32fed4d816463d04774ed610f96327ffbaff948ef57c228ecc96e108f",
}
RATIOS = (Decimal("0.5"), Decimal("0.618"), Decimal("0.764"))


def _verified(path: Path, expected: str) -> dict:
    if hashlib.sha256(path.read_bytes()).hexdigest() != expected:
        raise RuntimeError(f"source-case identity differs: {path}")
    return json.loads(path.read_text())


def _cutoff(row: dict, case: str) -> dict:
    impulse = row["selected_impulse"]
    if impulse is None:
        return {
            "case": case,
            "cutoff_utc": row["cutoff_utc"],
            "selected_impulse": None,
            "active_untouched_plan": row["active_untouched_plan"] is not None,
            "decision_reason": row["current_decision_reason"],
        }
    a = Decimal(str(impulse["a_low"]))
    b = Decimal(str(impulse["b_high"]))
    entry = Decimal(str(impulse["entry"]))
    stop = Decimal(str(impulse["stop"]))
    if not 0 < a < stop < entry < b:
        raise RuntimeError(f"unexpected H14a price order: {case} {row['cutoff_utc']}")
    return {
        "case": case,
        "cutoff_utc": row["cutoff_utc"],
        "a_low": str(a),
        "b_high": str(b),
        "level_50": str(impulse["level_50"]),
        "level_618": str(impulse["level_618"]),
        "level_764": str(impulse["level_764"]),
        "h14a_entry": str(entry),
        "h14a_stop": str(stop),
        "stop_minus_a": str(stop - a),
        "h14a_target_r_to_b": str((b - entry) / (entry - stop)),
        "active_untouched_plan": row["active_untouched_plan"] is not None,
        "decision_reason": row["current_decision_reason"],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--s27", type=Path, required=True)
    parser.add_argument("--s24", type=Path, required=True)
    parser.add_argument("--h14a", type=Path, required=True)
    parser.add_argument("--d41", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    sources = {name: _verified(getattr(args, name), sha) for name, sha in EXPECTED_SHA256.items()}
    h14a = sources["h14a"]
    if not h14a["passed"] or sources["s27"]["case"] != "S27" or sources["s24"]["case"] != "S24":
        raise RuntimeError("frozen source-case gates differ")
    audits = h14a["coins"]["BTC"]["source_audits"]
    cutoffs = [
        _cutoff(row, case)
        for case, key in (("S27", "s27_primary"), ("S24", "s24_sensitivity"))
        for row in audits[key]["cutoffs"]
    ]
    if len(cutoffs) != 4:
        raise RuntimeError("expected both registered S27 and S24 cutoffs")
    sui = sources["d41"]["cutoffs"]
    result = {
        "method": "source-case and exact arithmetic only; no orders, fills, return or annual PnL read",
        "source_sha256": EXPECTED_SHA256,
        "btc_cutoffs": cutoffs,
        "target_at_b_r_ceiling_for_stop_at_a": {
            str(ratio): str(ratio / (1 - ratio)) for ratio in RATIOS
        },
        "below_a_stop_has_strictly_less_target_r_than_ceiling": True,
        "sui_d41_source_band_match_counts": [row["source_band_match_count"] for row in sui],
        "sui_anchor_selection_unresolved": True,
        "rising_line_price_not_digitized": True,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n")


if __name__ == "__main__":
    main()
