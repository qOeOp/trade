"""
Check frozen H15a tier-bundle geometry on the previously verified source cases.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from decimal import Decimal
from pathlib import Path

from vibe_trading.model import InstrumentId
from vibe_trading.persistence import ParquetDataCatalog


H14A_SHA256 = "99a7280b6fd5f187fc626dedf1c96092bfb18da206f0b9b7c213c5c9630f8084"
D45_SHA256 = "fbd1fa189f62014569debbb0efb69f4fd3a4ebe778de92b48f3c4317837a2482"
RATIOS = (Decimal("0.5"), Decimal("0.618"), Decimal("0.764"))


def _verified(path: Path, expected: str) -> dict:
    if hashlib.sha256(path.read_bytes()).hexdigest() != expected:
        raise RuntimeError(f"frozen source audit identity differs: {path}")
    return json.loads(path.read_text())


def _bundle(row: dict, instrument) -> dict:
    plan = row["active_untouched_plan"]
    if plan is None:
        raise RuntimeError("S27 has no previously armed untouched H14a plan")
    a = Decimal(str(plan["a_low"]))
    b = Decimal(str(plan["b_high"]))
    old_stop = Decimal(str(plan["stop"]))
    level_764 = Decimal(str(plan["level_764"]))
    buffer = level_764 - old_stop
    if not a < b or buffer <= 0:
        raise RuntimeError("invalid frozen source impulse or ATR buffer")
    stop = instrument.make_price(float(a - buffer)).as_double()
    target = instrument.make_price(float(b)).as_double()
    tiers = []
    for ratio in RATIOS:
        raw = b - ratio * (b - a)
        entry = instrument.make_price(float(raw)).as_double()
        if not 0 < stop < entry < float(row["last_completed_close"]) < target:
            raise RuntimeError("bundle price ordering or source decision close failed")
        tiers.append(
            {
                "retracement_ratio": str(ratio),
                "native_limit_price": entry,
                "native_target_r": (target - entry) / (entry - stop),
            },
        )
    if (
        not tiers[0]["native_limit_price"]
        > tiers[1]["native_limit_price"]
        > tiers[2]["native_limit_price"]
    ):
        raise RuntimeError("source tier ordering failed")
    return {
        "cutoff_utc": row["cutoff_utc"],
        "selected_a_b": [str(a), str(b)],
        "source_plan_armed_utc": plan["armed_utc"],
        "all_tiers_untouched_since_b": True,
        "common_stop_below_a": stop < float(a),
        "native_common_stop": stop,
        "native_first_target": target,
        "prior_atr_quarter_buffer_from_frozen_h14a_plan": str(buffer),
        "tiers": tiers,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--h14a", type=Path, required=True)
    parser.add_argument("--d45", type=Path, required=True)
    parser.add_argument("--catalog-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    h14a = _verified(args.h14a, H14A_SHA256)
    d45 = _verified(args.d45, D45_SHA256)
    if not h14a["passed"] or d45["sui_d41_source_band_match_counts"] != [4] * 4:
        raise RuntimeError("prior source gate or SUI ambiguity differs")
    instrument_id = InstrumentId.from_str(h14a["coins"]["BTC"]["instrument"])
    catalog = ParquetDataCatalog(str(args.catalog_root / "BTC" / "minute"))
    instruments = catalog.instruments(instrument_ids=[str(instrument_id)])
    if len(instruments) != 1:
        raise RuntimeError("one frozen BTC native Instrument is required")
    cutoffs = h14a["coins"]["BTC"]["source_audits"]["s27_primary"]["cutoffs"]
    bundles = [_bundle(row, instruments[0]) for row in cutoffs]
    if len(bundles) != 2 or not all(row["common_stop_below_a"] for row in bundles):
        raise RuntimeError("registered S27 common-stop source case failed")
    s24 = h14a["coins"]["BTC"]["source_audits"]["s24_sensitivity"]["cutoffs"]
    result = {
        "method": "read-only H15a source geometry from frozen H14a case states and native Instrument; no new orders, fills or PnL",
        "h14a_source_gate_sha256": H14A_SHA256,
        "d45_source_geometry_sha256": D45_SHA256,
        "instrument": str(instrument_id),
        "s27_bundles": bundles,
        "s24_new_three_tier_order_claim": False,
        "s24_decision_reasons": [row["current_decision_reason"] for row in s24],
        "c19_wrong_anchor_false_source_match": h14a["c19_wrong_anchor_false_source_match"],
        "sui_four_hour_selector_disagreement": h14a[
            "sui_registered_four_hour_selector_disagreement"
        ],
        "passed_scoped_s27_source_gate": True,
        "economic_data_read": False,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n")


if __name__ == "__main__":
    main()
