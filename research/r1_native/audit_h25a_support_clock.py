"""Audit H25a's native completed-bar prior swing state against sealed LAST Catalogs."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
from collections import defaultdict
from pathlib import Path

from audit_d80_brooks_breakout_context import MILLISECOND_NS
from audit_d80_brooks_breakout_context import FOUR_HOUR_NS
from audit_d80_brooks_breakout_context import native_bars
from audit_d90_brooks_structural_range import atr_before
from audit_d90_brooks_structural_range import pivots


ROOT = Path(__file__).resolve().parent
IDENTITY = ROOT / "results/2026-10-07-input-identity.json"


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def audit(run: Path) -> dict:
    summary = json.loads((run / "summary.json").read_text())
    if summary["signal_variant"] not in (
        "support-broad-prior-a-support-4h",
        "support-broad-any-prior-a-support-4h",
        "support-broad-any-prior-a-outside-stop-4h",
    ):
        raise ValueError("structural support native summary required")
    outside_a_stop = summary["signal_variant"] == "support-broad-any-prior-a-outside-stop-4h"
    any_prior_a = summary["signal_variant"] in (
        "support-broad-any-prior-a-support-4h", "support-broad-any-prior-a-outside-stop-4h"
    )
    identity = json.loads(IDENTITY.read_text())
    input_by_coin = {row["coin"]: row for row in identity["coins"]}
    orders = list(csv.DictReader((run / "orders.csv").open(newline="")))
    entries = [order for order in orders if order["tags"] == "['ENTRY']"]
    by_list = defaultdict(dict)
    for order in orders:
        if order["order_list_id"]:
            by_list[order["order_list_id"]][order["tags"]] = order
    bundles = defaultdict(list)
    for entry in entries:
        bundles[(entry["strategy_id"].removeprefix("R1-"), int(entry["ts_init"]))].append(entry)
    findings = []
    decisions_checked = 0
    source_plan_matches = 0
    submitted_bundle_checks = 0
    d90 = ROOT / "results/2026-10-08-d90-brooks-structural-range-bundles.json.gz"
    import gzip
    with gzip.open(d90, "rt") as stream:
        frozen = json.load(stream)
    old_plans = {
        (row["coin"], row["native_submission_ns"], row["a_end_ns"] + MILLISECOND_NS, row["b_end_ns"] + MILLISECOND_NS): row
        for row in frozen
    }
    for coin_summary in summary["per_coin"]:
        coin = coin_summary["coin"]
        source = input_by_coin[coin]
        instrument, bars, _ = native_bars(
            Path(identity["minute_catalog_root"]),
            coin, source["minute_catalog"]["sha256"],
        )
        by_end = {bar["end_ns"]: i for i, bar in enumerate(bars)}
        atrs = atr_before(bars)
        records = coin_summary["structural_support"]["decisions"]
        accepted = sum(record["accepted"] for record in records)
        if accepted != coin_summary["structural_support"]["accepted"] or len(records) - accepted != coin_summary["structural_support"]["rejected"]:
            findings.append(f"{coin}: Strategy decision counters disagree")
        for record in records:
            signal, a_ns, b_ns = (record[field] - MILLISECOND_NS for field in ("signal_end_ns", "a_end_ns", "b_end_ns"))
            try:
                si, ai, bi = by_end[signal], by_end[a_ns], by_end[b_ns]
            except KeyError:
                findings.append(f"{coin}: decision bar not in native Catalog")
                continue
            if not (ai < bi <= si and bars[si]["end_ns"] < record["signal_end_ns"]):
                findings.append(f"{coin}: noncausal decision clock")
                continue
            a = instrument.make_price(bars[ai]["low"]).as_double()
            b = instrument.make_price(bars[bi]["high"]).as_double()
            atr = atrs[si]
            if atr is None or abs(atr - record["prior_14bar_wilder_atr"]) > 1e-7:
                findings.append(f"{coin}: prior ATR changed at {record['signal_end_ns']}")
                continue
            support = [j for j in pivots(bars, si, ai, "low") if abs(bars[j]["low"] - a) <= atr]
            resistance = [j for j in pivots(bars, si, bi, "high") if abs(bars[j]["high"] - b) <= atr]
            new_stop = instrument.make_price(a - 0.25 * atr)
            a_raw, b_raw = bars[ai]["low"], bars[bi]["high"]
            deeper = instrument.make_price(b_raw - 0.618 * (b_raw - a_raw))
            old_stop = instrument.make_price(b_raw - 0.764 * (b_raw - a_raw) - 0.25 * atr)
            outside_geometry_valid = 0 < new_stop.as_double() < a < deeper.as_double() < b
            expected_accepted = (
                bool(support) and outside_geometry_valid if outside_a_stop
                else bool(support) if any_prior_a else bool(support and not resistance)
            )
            if (
                str(instrument.make_price(bars[ai]["low"])) != record["rounded_a"]
                or str(instrument.make_price(bars[bi]["high"])) != record["rounded_b"]
                or len(support) != record["prior_confirmed_support_test_count"]
                or len(resistance) != record["prior_confirmed_resistance_test_count"]
                or expected_accepted != record["accepted"]
                or (outside_a_stop and (
                    record["outside_a_geometry_valid"] != outside_geometry_valid
                    or record["original_rounded_stop"] != str(old_stop)
                    or (record["rounded_stop"] != str(new_stop) if expected_accepted else False)
                ))
            ):
                findings.append(f"{coin}: source state changed at {record['signal_end_ns']}")
            old = old_plans.get((coin, record["signal_end_ns"], record["a_end_ns"], record["b_end_ns"]))
            if old is not None:
                source_plan_matches += 1
                if (
                    old["prior_confirmed_support_test_count"] != len(support)
                    or old["prior_confirmed_resistance_test_count"] != len(resistance)
                ):
                    findings.append(f"{coin}: differs from frozen D90 plan {record['signal_end_ns']}")
            decisions_checked += 1
        for (bundle_coin, ts), group in bundles.items():
            if bundle_coin != coin:
                continue
            submitted_bundle_checks += 1
            if len(group) != 2:
                findings.append(f"{coin}: not two tiers at {ts}")
                continue
            stops = {
                by_list[entry["order_list_id"]]["['STOP_LOSS']"]["trigger_price"]
                for entry in group
            }
            targets = {
                by_list[entry["order_list_id"]]["['TAKE_PROFIT']"]["price"]
                for entry in group
            }
            candidates = [
                record for record in records
                if record["accepted"]
                and record["rounded_stop"] in stops
                and record["rounded_b"] in targets
                and record["signal_end_ns"] <= ts < record["signal_end_ns"] + 180 * FOUR_HOUR_NS
            ]
            if len(stops) != 1 or len(targets) != 1 or len(candidates) != 1:
                findings.append(f"{coin}: native bundle without accepted source state at {ts}")
    return {
        "schema": "r1-native-h25a-support-clock/v1",
        "run": str(run),
        "source_sha256": {name: sha(run / name) for name in ("summary.json", "orders.csv", "fills.csv", "positions.csv")},
        "catalog_identity_sha256": sha(IDENTITY),
        "decisions_checked": decisions_checked,
        "exact_frozen_d90_source_plan_matches": source_plan_matches,
        "submitted_native_bundle_checks": submitted_bundle_checks,
        "findings": findings,
        "passed": not findings,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = audit(args.run)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    if not result["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
