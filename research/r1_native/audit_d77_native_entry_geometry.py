"""D77 read-only native H19a tier geometry by frozen prior volatility rank."""

from __future__ import annotations

import csv
import gzip
import hashlib
import json
from collections import Counter, defaultdict
from decimal import Decimal
from pathlib import Path

import numpy as np
import pandas as pd


ROOT = Path(__file__).resolve().parent
RUN = Path("/tmp/r1-h22a-paired-h19a-37")
D76 = ROOT / "results/2026-10-08-d76-native-opportunity-selection.json"
D76_DETAIL = ROOT / "results/2026-10-08-d76-native-bundles.json.gz"
OUT = ROOT / "results/2026-10-08-d77-native-entry-geometry.json"
DETAIL = ROOT / "results/2026-10-08-d77-native-entry-geometry-bundles.json.gz"
EXPECTED = {
    D76.name: "dafeea7357094a3573f1a04402eee4864f1fd576a0defe4c933cd75a69922689",
    D76_DETAIL.name: "3e363364e2d170b7d0e174c09063d96a3a14773971ab3dbd6a7eecc8824a7d3b",
    "orders.csv": "77cf20e8302d22d305f7fe9e0a4eec4fd9b4c38cda541d360f2c30440ba6fe7d",
    "fills.csv": "792aa68f2f12063770dbf00173c30c3d707b79d316a43864f05dba67eaed148e",
}
RANKS = ("low", "middle", "high")


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def csv_rows(path: Path) -> list[dict]:
    with path.open(newline="") as stream:
        return list(csv.DictReader(stream))


def distribution(rows: list[dict], field: str) -> dict:
    values = [row[field] for row in rows if row[field] is not None]
    if len(values) != len(rows):
        return {"count": len(values), "missing": len(rows) - len(values), "p10": None, "median": None, "p90": None}
    if not values:
        return {"count": 0, "missing": 0, "p10": None, "median": None, "p90": None}
    return {
        "count": len(values),
        "missing": 0,
        "p10": float(np.quantile(values, 0.1)),
        "median": float(np.median(values)),
        "p90": float(np.quantile(values, 0.9)),
    }


def main() -> None:
    inputs = {name: sha((ROOT / "results" if name.startswith("2026-") else RUN) / name) for name in EXPECTED}
    if inputs != EXPECTED:
        raise RuntimeError(f"D77 frozen input identity mismatch: {inputs}")
    d76 = json.loads(D76.read_text())
    with gzip.open(D76_DETAIL, "rt") as stream:
        prior_bundles = json.load(stream)
    prior = {row["bundle_id"]: row for row in prior_bundles}
    assert len(prior) == len(prior_bundles) == 2939
    orders = csv_rows(RUN / "orders.csv")
    by_id = {row["client_order_id"]: row for row in orders}
    assert len(by_id) == len(orders) == 17665
    parents = defaultdict(list)
    children = defaultdict(list)
    for row in orders:
        if row["side"] == "BUY" and row["type"] == "LIMIT" and not row["parent_order_id"]:
            parents[row["client_order_id"].rsplit("-", 1)[0]].append(row)
        elif row["parent_order_id"]:
            children[row["parent_order_id"]].append(row)
    assert len(parents) == 2939 and all(len(pair) == 2 for pair in parents.values())
    fills = defaultdict(list)
    for fill in csv_rows(RUN / "fills.csv"):
        if fill["order_side"] == "BUY":
            assert fill["client_order_id"] in by_id
            fills[fill["client_order_id"]].append(fill)

    detail = []
    errors = []
    for bundle_id, pair in parents.items():
        pair = sorted(pair, key=lambda row: Decimal(row["price"]), reverse=True)
        p = prior[bundle_id]
        if len(p["native_positions"]) not in (0, 1, 2):
            errors.append(f"{bundle_id}: unexpected native Position count")
            continue
        first, deeper = pair
        tier_geometry = {}
        for label, entry in (("first", first), ("deeper", deeper)):
            linked = children[entry["client_order_id"]]
            stops = [row for row in linked if row["side"] == "SELL" and row["type"] == "STOP_MARKET"]
            targets = [row for row in linked if row["side"] == "SELL" and row["type"] == "LIMIT"]
            if len(linked) != 2 or len(stops) != 1 or len(targets) != 1:
                errors.append(f"{bundle_id}/{label}: native child relation incomplete")
                continue
            stop, target = stops[0], targets[0]
            if not (entry["order_list_id"] == stop["order_list_id"] == target["order_list_id"]):
                errors.append(f"{bundle_id}/{label}: order list mismatch")
                continue
            entry_px = Decimal(entry["price"])
            stop_px = Decimal(stop["trigger_price"])
            target_px = Decimal(target["price"])
            if not 0 < stop_px < entry_px < target_px:
                errors.append(f"{bundle_id}/{label}: invalid native stop/entry/target order")
                continue
            tier_geometry[label] = {
                "parent_order_id": entry["client_order_id"],
                "order_list_id": entry["order_list_id"],
                "entry": str(entry_px),
                "stop": str(stop_px),
                "target": str(target_px),
                "planned_target_r": float((target_px - entry_px) / (entry_px - stop_px)),
                "planned_stop_distance_pct": float((entry_px - stop_px) / entry_px * 100),
                "planned_target_room_pct": float((target_px - entry_px) / entry_px * 100),
            }
        if len(tier_geometry) != 2:
            continue
        if (
            tier_geometry["first"]["stop"] != tier_geometry["deeper"]["stop"]
            or tier_geometry["first"]["target"] != tier_geometry["deeper"]["target"]
            or Decimal(tier_geometry["first"]["entry"]) <= Decimal(tier_geometry["deeper"]["entry"])
        ):
            errors.append(f"{bundle_id}: two-tier shared geometry mismatch")
            continue
        assert p["ts_init_ns"] == int(first["ts_init"]) == int(deeper["ts_init"])
        assert p["prior_volatility_rank"] in RANKS
        fill_events = []
        for label, entry in (("first", first), ("deeper", deeper)):
            for fill in fills[entry["client_order_id"]]:
                fill_events.append({
                    "tier": label,
                    "ts_event_ns": pd.Timestamp(fill["ts_event"]).value,
                    "last_px": fill["last_px"],
                    "trade_id": fill["trade_id"],
                })
        if bool(fill_events) != p["any_positive_buy_fill"]:
            errors.append(f"{bundle_id}: D76 native fill mismatch")
            continue
        first_event = None
        ambiguous = []
        if fill_events:
            min_ns = min(event["ts_event_ns"] for event in fill_events)
            earliest = [event for event in fill_events if event["ts_event_ns"] == min_ns]
            if len(earliest) == 1:
                first_event = earliest[0]
            else:
                ambiguous = earliest
        actual = None
        if first_event:
            native = tier_geometry[first_event["tier"]]
            fill_px = Decimal(first_event["last_px"])
            stop_px = Decimal(native["stop"])
            target_px = Decimal(native["target"])
            if not 0 < stop_px < fill_px < target_px:
                errors.append(f"{bundle_id}: invalid first native fill geometry")
            else:
                actual = {
                    "tier": first_event["tier"],
                    "ts_event_ns": first_event["ts_event_ns"],
                    "trade_id": first_event["trade_id"],
                    "fill_px": first_event["last_px"],
                    "fill_to_target_r": float((target_px - fill_px) / (fill_px - stop_px)),
                    "fill_to_stop_distance_pct": float((fill_px - stop_px) / fill_px * 100),
                }
        detail.append({
            "bundle_id": bundle_id,
            "coin": p["coin"],
            "submission_month_utc": p["submission_month_utc"],
            "prior_volatility_rank": p["prior_volatility_rank"],
            "any_positive_buy_fill": p["any_positive_buy_fill"],
            "native_position_ids": [row["position_id"] for row in p["native_positions"]],
            "tier_geometry": tier_geometry,
            "unique_first_native_buy_fill": actual,
            "ambiguous_earliest_native_buy_fills": ambiguous,
        })
    if errors or len(detail) != 2939:
        raise RuntimeError(f"D77 native geometry validation failed: {errors[:10]} (total={len(errors)}, details={len(detail)})")
    assert sum(bool(row["unique_first_native_buy_fill"] or row["ambiguous_earliest_native_buy_fills"]) for row in detail) == 500
    detail.sort(key=lambda row: row["bundle_id"])
    group = {}
    for rank in RANKS:
        rows = [row for row in detail if row["prior_volatility_rank"] == rank]
        filled = [row for row in rows if row["any_positive_buy_fill"]]
        assert len(rows) == d76["by_volatility_rank"][rank]["submitted_bundles"]
        assert len(filled) == d76["by_volatility_rank"][rank]["positive_fill_bundles"]
        cohorts = {}
        for label, cohort in (("all_submitted", rows), ("positively_filled", filled)):
            cohorts[label] = {tier: {
                measure: distribution([row["tier_geometry"][tier] for row in cohort], measure)
                for measure in ("planned_target_r", "planned_stop_distance_pct", "planned_target_room_pct")
            } for tier in ("first", "deeper")}
        unique = [row["unique_first_native_buy_fill"] for row in filled if row["unique_first_native_buy_fill"]]
        group[rank] = {
            "submitted_bundles": len(rows),
            "positively_filled_bundles": len(filled),
            "ambiguous_first_fill_bundles": sum(bool(row["ambiguous_earliest_native_buy_fills"]) for row in filled),
            "first_filled_tier_counts": dict(sorted(Counter(row["tier"] for row in unique).items())),
            "planned_geometry": cohorts,
            "actual_unique_first_fill_geometry": {
                measure: distribution(unique, measure)
                for measure in ("fill_to_target_r", "fill_to_stop_distance_pct")
            },
            "per_coin_counts": dict(sorted(Counter(row["coin"] for row in rows).items())),
            "per_submission_month_counts": dict(sorted(Counter(row["submission_month_utc"] for row in rows).items())),
        }
    DETAIL.write_bytes(gzip.compress(
        json.dumps(detail, ensure_ascii=False, separators=(",", ":")).encode(),
        mtime=0,
    ))
    result = {
        "schema": "r1-native-d77-entry-geometry/v1",
        "preregistration_commit": "52e92ab5f",
        "input_sha256": inputs,
        "native_run": str(RUN),
        "method": "Original parent-linked native bracket entry, stop and target prices at submission; first chronological native BUY fill only when unambiguous. D76 causal volatility rank at order submission, no PnL-derived threshold.",
        "by_prior_volatility_rank": group,
        "bundle_detail_file": DETAIL.name,
        "bundle_detail_sha256": sha(DETAIL),
        "limitations": [
            "The target is H19a's researcher-defined B high and may not represent Ronnie's nearer obstacle or wider context in a specific source case.",
            "A submitted or even filled plan R/R is not its realized net R, which depends on native path, tier fills, stop/target execution, fees, funding and shared account competition.",
            "This exposed-year descriptive read does not validate an asset filter or alter the fixed 37-coin account economics.",
        ],
    }
    OUT.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"summary": str(OUT), "sha256": sha(OUT), "detail_sha256": sha(DETAIL),
                      "by_rank": {rank: {"n": group[rank]["submitted_bundles"], "filled": group[rank]["positively_filled_bundles"],
                                         "ambiguous": group[rank]["ambiguous_first_fill_bundles"],
                                         "first_r_median": group[rank]["planned_geometry"]["all_submitted"]["first"]["planned_target_r"]["median"],
                                         "deep_r_median": group[rank]["planned_geometry"]["all_submitted"]["deeper"]["planned_target_r"]["median"],
                                         "filled_first_r_median": group[rank]["planned_geometry"]["positively_filled"]["first"]["planned_target_r"]["median"],
                                         "actual_first_fill_r_median": group[rank]["actual_unique_first_fill_geometry"]["fill_to_target_r"]["median"]}
                                  for rank in RANKS}}, ensure_ascii=False))


if __name__ == "__main__":
    main()
