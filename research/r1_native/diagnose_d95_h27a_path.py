"""D95: read-only native H27a/H26a source quantity, fill and exit attribution."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
from collections import Counter, defaultdict
from decimal import Decimal
from pathlib import Path
from statistics import median

from readback_h27a_flow import read


ROOT = Path(__file__).resolve().parent
RESULTS = ROOT / "results"
MANIFEST = RESULTS / "2026-10-09-h27a-manifest.json"
REQUIRED = (
    "2026-10-09-h27a-37-summary.json",
    "2026-10-09-h27a-37-native-audit.json",
    "2026-10-09-h27a-37-support-clock.json",
    "2026-10-09-h27a-control-h26a-summary.json",
    "2026-10-09-h27a-control-h26a-native-audit.json",
    "2026-10-09-h27a-control-h26a-parity.json",
)


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def rows(path: Path) -> list[dict]:
    with path.open(newline="") as stream:
        return list(csv.DictReader(stream))


def validate(run: Path, summary_name: str, audit_name: str) -> dict:
    summary = json.loads((run / "summary.json").read_text())
    audit = json.loads((RESULTS / audit_name).read_text())
    if sha(run / "summary.json") != sha(RESULTS / summary_name) or not audit["passed"]:
        raise RuntimeError(f"native summary or audit identity failed: {run}")
    for name, digest in audit["file_sha256"].items():
        if sha(run / name) != digest:
            raise RuntimeError(f"frozen native report changed: {run}/{name}")
    return summary


def quantiles(values: list[float]) -> dict:
    if not values:
        return {"count": 0}
    ordered = sorted(values)

    def q(fraction: float) -> float:
        place = (len(ordered) - 1) * fraction
        low, high = int(place), min(int(place) + 1, len(ordered) - 1)
        return ordered[low] + (ordered[high] - ordered[low]) * (place - low)

    return {"count": len(values), "p10": q(0.10), "median": median(values), "p90": q(0.90)}


def usdt(value: str) -> Decimal:
    return Decimal(value.removesuffix(" USDT"))


def exit_kind(position: dict, orders: dict) -> str:
    if not position["ts_closed"]:
        return "OPEN_CENSORED"
    closer = orders[position["closing_order_id"]]
    if closer["tags"] == "['STOP_LOSS']":
        return "STOP_LOSS"
    if closer["tags"] == "['TAKE_PROFIT']":
        return "TAKE_PROFIT"
    if closer["type"] == "MARKET":
        return "MARKET_TIME"
    raise RuntimeError(f"unknown native final close: {closer['client_order_id']}")


def native_path(run: Path, report: dict) -> dict:
    orders = {row["client_order_id"]: row for row in rows(run / "orders.csv")}
    fill_by_order = defaultdict(list)
    for fill in rows(run / "fills.csv"):
        fill_by_order[fill["client_order_id"]].append(fill)
    bundles = {}
    for key, parents in report["bundles"].items():
        if len(parents) != 2:
            raise RuntimeError(f"not a two-tier native source: {key}")
        ranked = sorted(parents, key=lambda parent: Decimal(parent["price"]), reverse=True)
        if ranked[0]["price"] == ranked[1]["price"]:
            raise RuntimeError(f"same first/deeper entry price: {key}")
        tiers = {}
        for name, parent in zip(("first", "deeper"), ranked, strict=True):
            native_fills = fill_by_order[parent["client_order_id"]]
            total = sum((Decimal(item["last_qty"]) for item in native_fills), Decimal(0))
            if total != Decimal(parent["filled_qty"]):
                raise RuntimeError(f"fill quantity mismatch: {parent['client_order_id']}")
            tiers[name] = {
                "planned_entry": parent["price"],
                "submitted_qty": Decimal(parent["quantity"]),
                "filled_qty": total,
                "first_fill_utc": min((item["ts_event"] for item in native_fills), default=None),
                "fill_events": len(native_fills),
            }
        bundles[key] = {"tiers": tiers, "positions": report["outcomes"].get(key, [])}
    return {"bundles": bundles, "orders": orders}


def cohort(path: dict, keys: set) -> dict:
    exits = Counter()
    realized = defaultdict(lambda: Decimal(0))
    filled = Counter()
    sources_without_position = 0
    for key in keys:
        bundle = path["bundles"][key]
        for tier, item in bundle["tiers"].items():
            if item["filled_qty"] > 0:
                filled[tier] += 1
        positions = bundle["positions"]
        sources_without_position += not positions
        for position in positions:
            kind = exit_kind(position, path["orders"])
            exits[kind] += 1
            if position["ts_closed"]:
                realized[kind] += usdt(position["realized_pnl"])
    return {
        "submitted_sources": len(keys),
        "sources_without_position": sources_without_position,
        "native_positions": sum(len(path["bundles"][key]["positions"]) for key in keys),
        "filled_parents_by_tier": dict(filled),
        "native_position_final_exits": dict(exits),
        "native_closed_realized_pnl_usdt_by_exit": {key: str(value) for key, value in realized.items()},
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--candidate", type=Path, required=True)
    parser.add_argument("--baseline", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    manifest = json.loads(MANIFEST.read_text())
    for name in REQUIRED:
        if sha(RESULTS / name) != manifest["artifact_sha256"][name]:
            raise RuntimeError(f"H27a evidence manifest mismatch: {name}")
    for name in ("2026-10-09-h27a-37-support-clock.json", "2026-10-09-h27a-control-h26a-parity.json"):
        result = json.loads((RESULTS / name).read_text())
        if not result.get("passed", result.get("parity_passed", False)):
            raise RuntimeError(f"required native audit/parity failed: {name}")
    newer_summary = validate(args.candidate, REQUIRED[0], REQUIRED[1])
    older_summary = validate(args.baseline, REQUIRED[3], REQUIRED[4])
    if (
        newer_summary["signal_variant"] != "support-broad-any-prior-a-outside-stop-4h"
        or older_summary["signal_variant"] != "support-broad-any-prior-a-support-4h"
        or newer_summary["runner_source_sha256"] != older_summary["runner_source_sha256"]
        or newer_summary["period_start_utc"] != older_summary["period_start_utc"]
        or newer_summary["period_end_utc"] != older_summary["period_end_utc"]
    ):
        raise RuntimeError("H27a/H26a native run identity mismatch")
    newer, older = read(args.candidate), read(args.baseline)
    candidate, baseline = native_path(args.candidate, newer), native_path(args.baseline, older)
    common = set(candidate["bundles"]) & set(baseline["bundles"])
    candidate_only = set(candidate["bundles"]) - common
    baseline_only = set(baseline["bundles"]) - common
    if (len(common), len(candidate_only), len(baseline_only)) != (1071, 2, 66):
        raise RuntimeError("frozen source-key partition changed")
    ratios = defaultdict(list)
    both_filled_ratios = defaultdict(list)
    entry_states = Counter()
    both_filled_clocks = Counter()
    outcome_pairs = Counter()
    matched_closed_pnl = defaultdict(lambda: {"candidate": Decimal(0), "baseline": Decimal(0), "sources": 0})
    position_multiplicity = Counter()
    for key in common:
        a, b = candidate["bundles"][key], baseline["bundles"][key]
        for tier in ("first", "deeper"):
            x, y = a["tiers"][tier], b["tiers"][tier]
            if x["planned_entry"] != y["planned_entry"]:
                raise RuntimeError(f"common source entry geometry changed: {key}/{tier}")
            ratios[tier].append(float(x["submitted_qty"] / y["submitted_qty"]))
            state = (x["filled_qty"] > 0, y["filled_qty"] > 0)
            label = {(False, False): "neither", (True, False): "h27a_only", (False, True): "h26a_only", (True, True): "both"}[state]
            entry_states[f"{tier}/{label}"] += 1
            if state == (True, True):
                both_filled_ratios[tier].append(float(x["filled_qty"] / y["filled_qty"]))
                both_filled_clocks[f"{tier}/same_first_fill_time"] += x["first_fill_utc"] == y["first_fill_utc"]
                both_filled_clocks[f"{tier}/different_first_fill_time"] += x["first_fill_utc"] != y["first_fill_utc"]
        x, y = a["positions"], b["positions"]
        position_multiplicity[f"{len(x)}/{len(y)}"] += 1
        x_kind = "+".join(sorted(exit_kind(position, candidate["orders"]) for position in x)) if x else "NO_POSITION"
        y_kind = "+".join(sorted(exit_kind(position, baseline["orders"]) for position in y)) if y else "NO_POSITION"
        outcome_pairs[f"{x_kind}/{y_kind}"] += 1
        if x and y and all(position["ts_closed"] for position in x + y):
            item = matched_closed_pnl[f"{x_kind}/{y_kind}"]
            item["candidate"] += sum((usdt(position["realized_pnl"]) for position in x), Decimal(0))
            item["baseline"] += sum((usdt(position["realized_pnl"]) for position in y), Decimal(0))
            item["sources"] += 1
    result = {
        "schema": "r1-native-d95-source-path/v1",
        "method": "frozen native report read only; no counterfactual fills, scaled PnL or account rerun",
        "preregistration_commit": "8661ef89f",
        "candidate_summary_sha256": sha(args.candidate / "summary.json"),
        "baseline_summary_sha256": sha(args.baseline / "summary.json"),
        "common_source_keys": len(common),
        "candidate_only_source_keys": len(candidate_only),
        "baseline_only_source_keys": len(baseline_only),
        "common_source_submitted_quantity_ratio_h27a_over_h26a": {tier: quantiles(ratios[tier]) for tier in ("first", "deeper")},
        "both_filled_parent_quantity_ratio_h27a_over_h26a": {tier: quantiles(both_filled_ratios[tier]) for tier in ("first", "deeper")},
        "common_source_entry_fill_states": dict(entry_states),
        "both_filled_parent_first_fill_clock": dict(both_filled_clocks),
        "common_source_native_position_multiplicity_candidate_over_baseline": dict(position_multiplicity),
        "common_source_native_position_exit_pairs": dict(outcome_pairs),
        "both_closed_source_native_pnl_usdt_by_exit_pair": {
            kind: {**item, "candidate": str(item["candidate"]), "baseline": str(item["baseline"])}
            for kind, item in matched_closed_pnl.items()
        },
        "candidate_common_native_cohort": cohort(candidate, common),
        "baseline_common_native_cohort": cohort(baseline, common),
        "candidate_only_native_cohort": cohort(candidate, candidate_only),
        "baseline_only_native_cohort": cohort(baseline, baseline_only),
        "year_end_open_positions_candidate": sum(position["ts_closed"] == "" for position in rows(args.candidate / "positions.csv")),
        "year_end_open_positions_baseline": sum(position["ts_closed"] == "" for position in rows(args.baseline / "positions.csv")),
        "caution": "Source-paired native outcomes remain path-dependent; these subsets do not add to portfolio equity and cannot identify the isolated stop effect.",
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")


if __name__ == "__main__":
    main()
