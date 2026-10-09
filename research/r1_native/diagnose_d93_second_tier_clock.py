"""D93: read native second-tier fill clocks against completed four-hour bars."""

from __future__ import annotations

import argparse
import ast
import csv
import gzip
import hashlib
import json
from bisect import bisect_left
from collections import Counter
from collections import defaultdict
from decimal import Decimal
from pathlib import Path
from statistics import median

from audit_d80_brooks_breakout_context import native_bars
from readback_h26a_flow import read


ROOT = Path(__file__).resolve().parent
RESULTS = ROOT / "results"
IDENTITY = RESULTS / "2026-10-07-input-identity.json"
EXPECTED = {
    IDENTITY: "ce9963ca68c66d34af74dbdbfff484f320a622fa73afe64844518aed354ec9fc",
    RESULTS / "2026-10-09-h26a-37-summary.json": "cc8f4df0199cb6c1b16146af95b880461b11da8e8ca2dd0775ff59ef59b9912a",
    RESULTS / "2026-10-09-h26a-control-h25a-summary.json": "95250f1359bd82e4bec80e96bcce664ef89e588625ee251e179561d4facf07ad",
    RESULTS / "2026-10-09-h26a-37-native-audit.json": "164f41a06fbb3f401511142ebf759c84634dde6b4853fd12c36939a4371a98df",
    RESULTS / "2026-10-09-h26a-37-support-clock.json": "91edf5383a81758a17010b9e24efcdfd78b547ea94ab9f56230331c108121d5e",
    RESULTS / "2026-10-09-h26a-vs-h25a-flow.json": "068073fd694adbfa520d109afca61d2ba348a0888e00f58a8cddaa373c8077cc",
    RESULTS / "2026-10-09-d92-h26a-b-obstacle.json": "c49f090ec671f0799b4ef74d8fc34c520b82903238cfda470514b73770826937",
    RESULTS / "2026-10-09-d92-h26a-b-obstacle-bundles.json.gz": "46b929aefe317d1e16ab73eb7ea389c96684ba40f6fd880969c4e677d78c20ab",
}


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def records(run: Path) -> tuple[dict, dict]:
    with (run / "orders.csv").open(newline="") as source:
        orders = {row["client_order_id"]: row for row in csv.DictReader(source)}
    summary = json.loads((run / "summary.json").read_text())
    decisions = {
        row["coin"]: {
            (item["rounded_stop"], item["rounded_b"], item["signal_end_ns"]): item
            for item in row["structural_support"]["decisions"] if item["accepted"]
        }
        for row in summary["per_coin"]
    }
    return orders, decisions


def second_clock(position: dict, orders: dict, bars: list[dict], a: float) -> dict:
    events = ast.literal_eval(position["events"])
    buys = [event for event in events if event["type"] == "OrderFilled" and event["order_side"] == "BUY"]
    if not buys:
        raise RuntimeError("native Position has no BUY fill")
    parents = defaultdict(list)
    for event in buys:
        parents[event["client_order_id"]].append(event)
    if len(parents) not in (1, 2):
        raise RuntimeError("unexpected number of native entry parents")
    firsts = sorted(
        ((min(int(event["ts_event"]) for event in events), -float(orders[order_id]["price"]), order_id)
         for order_id, events in parents.items()),
    )
    first_ts, _, first_id = firsts[0]
    first_event = min(parents[first_id], key=lambda event: int(event["ts_event"]))
    first_price = float(first_event["last_px"])
    ends = [bar["end_ns"] for bar in bars]
    first_i = bisect_left(ends, first_ts)
    if first_i >= len(bars):
        raise RuntimeError("first native fill outside completed Catalog span")
    final_id = position["closing_order_id"]
    final_tag = orders[final_id]["tags"] if final_id else None
    if final_id and not final_tag:
        if orders[final_id]["type"] != "MARKET" or orders[final_id]["side"] != "SELL":
            raise RuntimeError("unexpected untagged native closing order")
        final_tag = "MARKET_TIME"
    pnl = Decimal(position["realized_pnl"].removesuffix(" USDT")) if final_id else None
    result = {
        "first_parent_id": first_id,
        "first_fill_ns": first_ts,
        "first_fill_price": first_price,
        "distinct_filled_entry_tiers": len(parents),
        "buy_fill_events": len(buys),
        "final_exit_tag": final_tag,
        "native_closed_realized_pnl_usdt": str(pnl) if pnl is not None else None,
        "positive_native_close": pnl > 0 if pnl is not None else None,
        "second_parent_id": None,
        "second_fill_ns": None,
        "second_fill_events": 0,
        "first_to_second_hours": None,
        "second_fill_clock_state": None,
        "completed_post_first_fill_bars_before_second": None,
        "last_completed_close_progress_r": None,
        "last_completed_close_below_first_fill": None,
        "last_completed_close_below_rounded_a": None,
    }
    if len(firsts) == 1:
        return result
    second_ts, _, second_id = firsts[1]
    if second_ts < first_ts:
        raise RuntimeError("native second parent preceded first parent")
    result["second_parent_id"] = second_id
    result["second_fill_ns"] = second_ts
    result["second_fill_events"] = len(parents[second_id])
    result["first_to_second_hours"] = (second_ts - first_ts) / 3_600_000_000_000
    if second_ts <= ends[first_i]:
        result["second_fill_clock_state"] = "same_incomplete_first_fill_bar"
    elif first_i + 1 >= len(bars) or second_ts <= ends[first_i + 1]:
        result["second_fill_clock_state"] = "before_first_full_post_fill_bar_close"
    else:
        result["second_fill_clock_state"] = "after_completed_post_fill_bar"
        last_i = bisect_left(ends, second_ts) - 1
        if last_i <= first_i:
            raise RuntimeError("second-tier completed-bar clock classification changed")
        last = bars[last_i]
        first_order = orders[first_id]
        stop = next(
            float(order["trigger_price"]) for order in orders.values()
            if order["order_list_id"] == first_order["order_list_id"]
            and order["tags"] == "['STOP_LOSS']"
        )
        risk = first_price - stop
        if risk <= 0:
            raise RuntimeError("initial native stop risk is nonpositive")
        result["completed_post_first_fill_bars_before_second"] = last_i - first_i
        result["last_completed_close_progress_r"] = (last["close"] - first_price) / risk
        result["last_completed_close_below_first_fill"] = last["close"] <= first_price
        result["last_completed_close_below_rounded_a"] = last["close"] < a
    return result


def summarize(rows: list[dict]) -> dict:
    with_two = [row for row in rows if row["distinct_filled_entry_tiers"] == 2]
    states = defaultdict(list)
    for row in with_two:
        states[row["second_fill_clock_state"]].append(row)
    return {
        "native_positions": len(rows),
        "native_closed": sum(row["final_exit_tag"] is not None for row in rows),
        "native_positive_closed": sum(row["positive_native_close"] is True for row in rows),
        "distinct_filled_entry_tiers": dict(Counter(row["distinct_filled_entry_tiers"] for row in rows)),
        "second_tier_states": {
            state: {
                "positions": len(items),
                "native_positive_closed": sum(item["positive_native_close"] is True for item in items),
                "final_exit_tags": dict(Counter(item["final_exit_tag"] for item in items)),
                "median_first_to_second_hours": median(item["first_to_second_hours"] for item in items),
                "median_completed_post_first_fill_bars_before_second": (
                    median(item["completed_post_first_fill_bars_before_second"] for item in items)
                    if state == "after_completed_post_fill_bar" else None
                ),
                "second_parent_with_multiple_native_fill_events": sum(item["second_fill_events"] > 1 for item in items),
                "last_completed_close_below_first_fill": sum(item["last_completed_close_below_first_fill"] is True for item in items),
                "eventual_positive_close_after_weak_completed_close": sum(item["positive_native_close"] is True and item["last_completed_close_below_first_fill"] is True for item in items),
                "last_completed_close_below_rounded_a": sum(item["last_completed_close_below_rounded_a"] is True for item in items),
            }
            for state, items in sorted(states.items())
        },
        "second_tier_without_completed_post_fill_decision": sum(
            row["second_fill_clock_state"] != "after_completed_post_fill_bar" for row in with_two
        ),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--candidate", type=Path, required=True)
    parser.add_argument("--baseline", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--detail", type=Path, required=True)
    args = parser.parse_args()
    for path, digest in EXPECTED.items():
        if sha(path) != digest:
            raise RuntimeError(f"frozen D93 input changed: {path}")
    for name in ("2026-10-09-h26a-37-native-audit.json", "2026-10-09-h26a-37-support-clock.json"):
        if not json.loads((RESULTS / name).read_text())["passed"]:
            raise RuntimeError(f"native integrity prerequisite failed: {name}")
    identity = json.loads(IDENTITY.read_text())
    source_by_coin = {item["coin"]: item for item in identity["coins"]}
    candidate, baseline = read(args.candidate), read(args.baseline)
    flow = json.loads((RESULTS / "2026-10-09-h26a-vs-h25a-flow.json").read_text())
    if candidate["sha256"] != flow["candidate_sha256"] or baseline["sha256"] != flow["baseline_sha256"]:
        raise RuntimeError("native report identity differs from frozen source flow")
    added_keys = set(candidate["bundles"]) - set(baseline["bundles"])
    common_keys = set(candidate["bundles"]) & set(baseline["bundles"])
    if len(added_keys) != 482 or len(common_keys) != 655:
        raise RuntimeError("registered source populations changed")
    candidate_orders, candidate_decisions = records(args.candidate)
    baseline_orders, baseline_decisions = records(args.baseline)
    by_coin = defaultdict(lambda: {"added": [], "baseline_common": []})
    for key in added_keys:
        by_coin[key[0]]["added"].extend((key, position) for position in candidate["outcomes"].get(key, []))
    for key in common_keys:
        by_coin[key[0]]["baseline_common"].extend((key, position) for position in baseline["outcomes"].get(key, []))
    detail = {"added": [], "baseline_common": []}
    for coin, cohorts in sorted(by_coin.items()):
        _, bars, _ = native_bars(Path(identity["minute_catalog_root"]), coin, source_by_coin[coin]["minute_catalog"]["sha256"])
        for cohort, items in cohorts.items():
            orders = candidate_orders if cohort == "added" else baseline_orders
            decisions = candidate_decisions if cohort == "added" else baseline_decisions
            for key, position in items:
                _, stop, b, signal_ns = key
                decision = decisions[coin][(stop, b, signal_ns)]
                row = second_clock(position, orders, bars, float(decision["rounded_a"]))
                row["source_key"] = [coin, stop, b, signal_ns]
                row["coin"] = coin
                detail[cohort].append(row)
        print(f"D93 verified {coin}: {len(cohorts['added'])} added, {len(cohorts['baseline_common'])} H25a common native Positions", flush=True)
    if len(detail["added"]) != 68 or len(detail["baseline_common"]) != 111:
        raise RuntimeError("registered native Position populations changed")
    result = {
        "schema": "r1-native-d93-second-tier-clock/v1",
        "registration_commit": "79443ae8085cc30bf1f2d327955c2042bfb88d86",
        "frozen_sha256": {str(path.relative_to(ROOT)): digest for path, digest in EXPECTED.items()},
        "candidate_run_sha256": candidate["sha256"],
        "baseline_run_sha256": baseline["sha256"],
        "added_h26a_only": summarize(detail["added"]),
        "h25a_common_source_reference": summarize(detail["baseline_common"]),
        "limitations": [
            "The second-tier fill is selected by a deeper adverse price path; conditional final outcomes do not prove that filling it caused a loss.",
            "A complete four-hour close at the exact same timestamp as a fill is excluded because event order cannot be inferred from OHLC.",
            "The H25a common-source reference runs under a different shared-account path and cannot identify counterfactual outcomes for H26a-only bundles.",
            "This already-viewed year is diagnostic; no alternative orders, fills, cashflows or account equity were simulated.",
        ],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.detail.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    with gzip.open(args.detail, "wt", encoding="utf-8") as stream:
        json.dump(detail, stream, separators=(",", ":"))


if __name__ == "__main__":
    main()
