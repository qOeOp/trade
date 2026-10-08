"""
Screen native H15a tier reach and planned risk without deriving tier PnL.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
from collections import Counter
from collections import defaultdict
from decimal import Decimal
from pathlib import Path


SUMMARY_SHA256 = "adbd663fb6880d4781e013f0c603121d5ec9b43c204b7911438c64207a056a99"
ORDERS_SHA256 = "b49a9b860da1326f90997cabdbfa5ed6ea2e0071569efb5b1f1010e93ef2db5e"
AUDIT_SHA256 = "606d54b072c5f522781ba9ee581583289d0220cb0a70dc9452a574e3fcc76095"
RANKS = ("50pct", "61_8pct", "76_4pct")


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _percentile(values: list[Decimal], percentile: Decimal) -> str:
    ordered = sorted(values)
    index = percentile * (len(ordered) - 1)
    low = int(index)
    weight = index - low
    high = min(low + 1, len(ordered) - 1)
    return str(ordered[low] * (1 - weight) + ordered[high] * weight)


def _load_frozen_bundles(
    run: Path,
    summary_path: Path,
    audit_path: Path,
) -> tuple[dict, dict, dict]:
    hashes = {
        "summary.json": _sha(summary_path),
        "orders.csv": _sha(run / "orders.csv"),
        "native_audit.json": _sha(audit_path),
    }
    if hashes != {
        "summary.json": SUMMARY_SHA256,
        "orders.csv": ORDERS_SHA256,
        "native_audit.json": AUDIT_SHA256,
    }:
        raise RuntimeError("D47 frozen native report identity differs")
    summary = json.loads(summary_path.read_text())
    audit = json.loads(audit_path.read_text())
    if not summary["integrity_passed"] or not audit["passed"]:
        raise RuntimeError("D47 requires accepted native integrity")
    with (run / "orders.csv").open(newline="") as stream:
        orders = list(csv.DictReader(stream))
    by_list: dict[str, list[dict]] = defaultdict(list)
    for row in orders:
        if row["order_list_id"]:
            by_list[row["order_list_id"]].append(row)
    bundles: dict[tuple[str, str], list[tuple[dict, dict, dict]]] = defaultdict(list)
    for list_id, rows in by_list.items():
        if len(rows) != 3 or {row["tags"] for row in rows} != {
            "['ENTRY']",
            "['STOP_LOSS']",
            "['TAKE_PROFIT']",
        }:
            raise RuntimeError(f"incomplete native OTO list {list_id}")
        tagged = {row["tags"]: row for row in rows}
        entry, stop, target = (
            tagged["['ENTRY']"],
            tagged["['STOP_LOSS']"],
            tagged["['TAKE_PROFIT']"],
        )
        if (
            stop["parent_order_id"] != entry["client_order_id"]
            or target["parent_order_id"] != entry["client_order_id"]
            or Decimal(stop["quantity"]) != Decimal(entry["quantity"])
            or Decimal(target["quantity"]) != Decimal(entry["quantity"])
        ):
            raise RuntimeError(f"native OTO parent/quantity differs {list_id}")
        bundles[(entry["strategy_id"], entry["ts_init"])].append((entry, stop, target))
    if len(by_list) != audit["native_brackets"] or len(bundles) != audit["native_bundles"]:
        raise RuntimeError("native bundle/list count differs from accepted audit")
    return hashes, audit, bundles


def _screen_bundles(hashes: dict, audit: dict, bundles: dict) -> dict:
    planned_risk_bp = []
    filled_per_bundle = Counter()
    cap_bound_tiers = 0
    by_rank = {
        name: {"submitted": 0, "filled": 0, "cap_bound": 0, "risk_bp": [], "target_r": []}
        for name in RANKS
    }
    for key, lists in bundles.items():
        if len(lists) != 3:
            raise RuntimeError(f"not three native entry tiers: {key}")
        lists.sort(key=lambda item: Decimal(item[0]["price"]), reverse=True)
        risk_sum = Decimal(0)
        filled = 0
        for rank, (entry, stop, target) in enumerate(lists):
            price = Decimal(entry["price"])
            stop_price = Decimal(stop["trigger_price"])
            target_price = Decimal(target["price"])
            if not 0 < stop_price < price < target_price:
                raise RuntimeError(f"invalid native tier geometry: {key}")
            distance = price - stop_price
            cap_bound = distance / price < Decimal("0.05")
            tier_risk_bp = min(
                Decimal(25) / 3,
                Decimal(500) / 3 * distance / price,
            )
            risk_sum += tier_risk_bp
            stats = by_rank[RANKS[rank]]
            stats["submitted"] += 1
            stats["risk_bp"].append(tier_risk_bp)
            stats["target_r"].append((target_price - price) / distance)
            if cap_bound:
                cap_bound_tiers += 1
                stats["cap_bound"] += 1
            if entry["status"] == "FILLED":
                filled += 1
                stats["filled"] += 1
            elif Decimal(entry["filled_qty"]) > 0:
                raise RuntimeError(f"partially filled entry outside frozen count: {key}")
        filled_per_bundle[filled] += 1
        planned_risk_bp.append(risk_sum)
    total_filled = sum(stats["filled"] for stats in by_rank.values())
    if total_filled != audit["filled_entries"]:
        raise RuntimeError("filled native entries differ from accepted audit")
    n_bundles = len(bundles)
    n_tiers = n_bundles * 3
    median_risk = Decimal(_percentile(planned_risk_bp, Decimal("0.5")))
    cap_fraction = Decimal(cap_bound_tiers) / n_tiers
    deep_fraction = Decimal(by_rank["76_4pct"]["filled"]) / n_bundles
    return {
        "method": "read-only native OTO order geometry/status capacity screen; no tier PnL or alternate fill ledger",
        "frozen_report_sha256": hashes,
        "native_bundles": n_bundles,
        "native_brackets": n_tiers,
        "native_filled_entries": total_filled,
        "filled_entries_per_bundle": {str(k): filled_per_bundle[k] for k in range(4)},
        "cap_bound_tier_fraction": str(cap_fraction),
        "planned_total_stop_risk_bp_of_equity_upper_bound": {
            "p10": _percentile(planned_risk_bp, Decimal("0.1")),
            "p50": str(median_risk),
            "p90": _percentile(planned_risk_bp, Decimal("0.9")),
        },
        "tiers": {
            name: {
                "submitted": stats["submitted"],
                "filled": stats["filled"],
                "filled_fraction_of_submitted_bundles": str(
                    Decimal(stats["filled"]) / n_bundles,
                ),
                "cap_bound": stats["cap_bound"],
                "planned_stop_risk_bp_p50": _percentile(stats["risk_bp"], Decimal("0.5")),
                "target_room_r_p50": _percentile(stats["target_r"], Decimal("0.5")),
            }
            for name, stats in by_rank.items()
        },
        "precommitted_cap_material_screen": median_risk < 15 and cap_fraction > Decimal("0.75"),
        "precommitted_deep_tier_reach_screen": deep_fraction >= Decimal("0.10"),
        "limitations": [
            "Pre-rounding stop-risk formula upper-bounds actual submitted risk after quantity rounding",
            "Tier fills are not independent positions or additive PnL in the native netting account",
            "The reused development year cannot qualify a risk or allocation change",
        ],
    }


def diagnose(run: Path, summary_path: Path, audit_path: Path) -> dict:
    return _screen_bundles(*_load_frozen_bundles(run, summary_path, audit_path))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", type=Path, required=True)
    parser.add_argument("--summary", type=Path, required=True)
    parser.add_argument("--audit", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = diagnose(args.run, args.summary, args.audit)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n")


if __name__ == "__main__":
    main()
