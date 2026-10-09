"""Read-only H24a native Position lifecycle and exact-plan overlap with H19a."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
from collections import Counter
from collections import defaultdict
from decimal import Decimal
from pathlib import Path

import pandas as pd

from audit_d80_brooks_breakout_context import FOUR_HOUR_NS
from audit_d80_brooks_breakout_context import START
from audit_d80_brooks_breakout_context import native_bars


IDENTITY = Path(__file__).resolve().parent / "results/2026-10-07-input-identity.json"
EXPECTED = {
    "h24": {
        "summary.json": "3090bd5c8ed9b39b56912a9ee842bac42252f54b30e2c4fb09c1c3c9beb97b95",
        "orders.csv": "2488495e73d0e576d26a42b9fb7c5a71d19c9735978a5fb7ef65a978d7b9f5dc",
        "fills.csv": "eb8a004da8966c67062cebfbbd9f66c8c48e95742dd6c109c2673e0a01c27d7b",
        "positions.csv": "89c9d9bef5ac7d33d61138f9528183f57e2ae185a89a8455b477395b75b1cb6f",
    },
    "h19": {
        "summary.json": "5459cc311e8f59dd1fa2a63ba4cee4b6c65a430f49c8f95aa0e56e565bfd234a",
        "orders.csv": "ea5ef92e52e10df0182321d21cf72c49bcfc8e8c355114d8ddbd6a03c633b479",
        "fills.csv": "d644340a1ea744e787fc9c1df702d2cfa01a48164cf6a6ba93b7fa155bc2c894",
        "positions.csv": "be362ce190ca02fca57a144c534334b30a34a8996c1628e6a8c97b351c55d245",
    },
}
AUDITS = {
    "2026-10-08-h24a-37-native-audit.json": "014c773acfd475b57f7bfacf413dab806aa442bac5fb81491e379c8333f07a99",
    "2026-10-08-h24a-37-gap-clock.json": "ae6ebd42eba5e42fc0f766f61b6b7f621d665fe86833cb0aebf6c9fcb35e195f",
    "2026-10-08-h24a-paired-h19a-parity.json": "7a40f33c982314883c2f760bd10f8061f9a7604c6f426708aaa721f6331b0459",
}


def rows(path: Path) -> list[dict]:
    with path.open(newline="") as stream:
        return list(csv.DictReader(stream))


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def usdt(value: str) -> Decimal:
    return Decimal(value.removesuffix(" USDT"))


def report(run: Path, name: str) -> dict:
    for filename, expected in EXPECTED[name].items():
        if sha(run / filename) != expected:
            raise ValueError(f"{name}/{filename}: frozen report SHA changed")
    return {
        "summary": json.loads((run / "summary.json").read_text()),
        "orders": rows(run / "orders.csv"),
        "fills": rows(run / "fills.csv"),
        "positions": rows(run / "positions.csv"),
    }


def plans(data: dict, brackets: int) -> tuple[dict, dict]:
    by_list = defaultdict(dict)
    parent_groups = defaultdict(list)
    for order in data["orders"]:
        if order["order_list_id"]:
            by_list[order["order_list_id"]][order["tags"]] = order
        if order["tags"] == "['ENTRY']":
            parent_groups[(order["strategy_id"], order["ts_init"])].append(order)
    by_entry = {}
    by_key = defaultdict(list)
    for group_id, parents in parent_groups.items():
        if len(parents) != brackets:
            raise ValueError(f"bad native bracket count: {group_id}")
        stops = {
            by_list[p["order_list_id"]]["['STOP_LOSS']"]["trigger_price"]
            for p in parents
        }
        targets = [
            by_list[p["order_list_id"]]["['TAKE_PROFIT']"] for p in parents
        ]
        if len(stops) != 1:
            raise ValueError(f"stop disagreement: {group_id}")
        b = min(Decimal(target["price"]) for target in targets)
        key = (group_id[0], next(iter(stops)), str(b), group_id[1])
        plan = {
            "key": key,
            "group": group_id,
            "b_target_ids": {
                target["client_order_id"]
                for target in targets
                if Decimal(target["price"]) == b
            },
            "runner_target_ids": {
                target["client_order_id"]
                for target in targets
                if Decimal(target["price"]) > b
            },
        }
        for parent in parents:
            by_entry[parent["client_order_id"]] = plan
        by_key[key].append(plan)
    return by_entry, by_key


def aggregate(cases: list[dict]) -> dict:
    closed = [case for case in cases if case["closed"]]
    wins = [case for case in closed if case["pnl"] > 0]
    losses = [case for case in closed if case["pnl"] <= 0]
    return {
        "positions": len(cases),
        "closed": len(closed),
        "open_censored": len(cases) - len(closed),
        "wins": len(wins),
        "native_closed_realized_pnl_usdt": str(sum((case["pnl"] for case in closed), Decimal(0))),
        "mean_win_usdt": str(sum((case["pnl"] for case in wins), Decimal(0)) / len(wins)) if wins else None,
        "mean_nonpositive_usdt": str(sum((case["pnl"] for case in losses), Decimal(0)) / len(losses)) if losses else None,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--h24", type=Path, required=True)
    parser.add_argument("--h19", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    new = report(args.h24, "h24")
    old = report(args.h19, "h19")
    for filename, expected in AUDITS.items():
        path = Path(__file__).resolve().parent / "results" / filename
        audited = json.loads(path.read_text())
        if sha(path) != expected or not audited.get("passed", audited.get("parity_passed", False)):
            raise ValueError(f"required native audit changed or failed: {filename}")
    new_entry, new_keys = plans(new, 4)
    old_entry, old_keys = plans(old, 2)
    orders = {order["client_order_id"]: order for order in new["orders"]}
    parent_by_list = {
        order["order_list_id"]: order
        for order in new["orders"]
        if order["tags"] == "['ENTRY']"
    }
    first_b = {}
    runner_fills = defaultdict(list)
    for fill in new["fills"]:
        order = orders[fill["client_order_id"]]
        if not order["order_list_id"]:
            continue
        parent = parent_by_list[order["order_list_id"]]
        plan = new_entry[parent["client_order_id"]]
        key = plan["key"]
        ns = pd.Timestamp(fill["ts_event"]).value
        if fill["client_order_id"] in plan["b_target_ids"]:
            first_b[key] = min(ns, first_b.get(key, ns))
        if fill["client_order_id"] in plan["runner_target_ids"]:
            runner_fills[key].append(ns)
    by_coin = defaultdict(list)
    cases = []
    for position in new["positions"]:
        plan = new_entry[position["opening_order_id"]]
        key = plan["key"]
        closing = orders.get(position["closing_order_id"])
        close_type = closing["type"] if closing else "OPEN"
        close_id = closing["client_order_id"] if closing else ""
        exit_kind = (
            "b_target" if close_id in plan["b_target_ids"]
            else "runner_target" if close_id in plan["runner_target_ids"]
            else "stop" if close_type == "STOP_MARKET"
            else "native_market" if close_type == "MARKET"
            else "open"
        )
        b_ns = first_b.get(key)
        decision_ns = (b_ns // FOUR_HOUR_NS + 2) * FOUR_HOUR_NS if b_ns else None
        closed_ns = pd.Timestamp(position["ts_closed"]).value if position["ts_closed"] else None
        case = {
            "key": key,
            "coin": position["strategy_id"].removeprefix("R1-"),
            "closed": bool(position["ts_closed"]),
            "pnl": usdt(position["realized_pnl"]),
            "exit_kind": exit_kind,
            "first_b_fill_ns": b_ns,
            "decision_ns": decision_ns,
            "reached_decision": bool(b_ns and (closed_ns is None or closed_ns >= decision_ns)),
            "early_runner_target": bool(b_ns and any(ts < decision_ns for ts in runner_fills[key])),
            "duration_ns": int(position["duration_ns"]) if position["duration_ns"] else None,
        }
        cases.append(case)
        if b_ns:
            by_coin[case["coin"]].append(case)
    identity = json.loads(IDENTITY.read_text())
    for coin_identity in identity["coins"]:
        coin = coin_identity["coin"]
        if not by_coin[coin]:
            continue
        _, bars, _ = native_bars(
            Path(identity["minute_catalog_root"]),
            coin,
            coin_identity["minute_catalog"]["sha256"],
        )
        for case in by_coin[coin]:
            i = (case["first_b_fill_ns"] - START) // FOUR_HOUR_NS
            if i < 1 or i + 1 >= len(bars):
                raise ValueError("B fill outside bound native Catalog")
            case["micro_gap"] = bars[i + 1]["low"] > bars[i - 1]["high"]
    groups = {
        "no_b_fill": [c for c in cases if c["first_b_fill_ns"] is None],
        "b_fill_before_decision_exit": [c for c in cases if c["first_b_fill_ns"] is not None and not c["reached_decision"]],
        "gap_persistent": [c for c in cases if c["reached_decision"] and c["micro_gap"]],
        "no_gap": [c for c in cases if c["reached_decision"] and not c["micro_gap"]],
    }
    exit_counts = Counter(c["exit_kind"] for c in cases)
    exact_new = {key for key, values in new_keys.items() if len(values) == 1}
    exact_old = {key for key, values in old_keys.items() if len(values) == 1}
    ambiguous = {
        key for key in new_keys.keys() | old_keys.keys()
        if len(new_keys.get(key, [])) > 1 or len(old_keys.get(key, [])) > 1
    }
    old_position_keys = {old_entry[p["opening_order_id"]]["key"] for p in old["positions"]}
    new_position_keys = {new_entry[p["opening_order_id"]]["key"] for p in new["positions"]}
    old_positions = defaultdict(list)
    new_positions = defaultdict(list)
    for position in old["positions"]:
        old_positions[old_entry[position["opening_order_id"]]["key"]].append(position)
    for case in cases:
        new_positions[case["key"]].append(case)
    paired_closed = [
        (key, new_positions[key], old_positions[key])
        for key in exact_new & exact_old & new_position_keys & old_position_keys
        if all(case["closed"] for case in new_positions[key])
        and all(position["ts_closed"] for position in old_positions[key])
    ]
    paired_by_lifecycle = {}
    for name, values in groups.items():
        group_keys = {case["key"] for case in values}
        pairs = [(n, o) for key, n, o in paired_closed if key in group_keys]
        paired_by_lifecycle[name] = {
            "matched_closed_bundles": len(pairs),
            "h24_native_positions": sum(len(n) for n, _ in pairs),
            "h19_native_positions": sum(len(o) for _, o in pairs),
            "h24_native_pnl_usdt": str(sum((c["pnl"] for n, _ in pairs for c in n), Decimal(0))),
            "h19_native_pnl_usdt": str(sum((usdt(p["realized_pnl"]) for _, o in pairs for p in o), Decimal(0))),
            "native_position_pnl_difference_usdt": str(
                sum((c["pnl"] for n, _ in pairs for c in n), Decimal(0))
                - sum((usdt(p["realized_pnl"]) for _, o in pairs for p in o), Decimal(0))
            ),
        }
    matched_keys = {key for key, _, _ in paired_closed}
    unmatched_new_closed = [c for c in cases if c["closed"] and c["key"] not in matched_keys]
    unmatched_old_closed = [
        p for key, positions in old_positions.items() for p in positions
        if p["ts_closed"] and key not in matched_keys
    ]
    market_cases = [c for c in cases if c["exit_kind"] == "native_market"]
    other_market_cases = [
        c for c in market_cases
        if not (c["reached_decision"] and not c["micro_gap"])
    ]
    result = {
        "schema": "r1-native-d87-h24a-lifecycle/v1",
        "source_sha256": {"h24": EXPECTED["h24"], "h19": EXPECTED["h19"], "audits": AUDITS, "catalog_identity": sha(IDENTITY)},
        "h24_account_final_equity_usdt": new["summary"]["final_equity_usdt"],
        "h19_account_final_equity_usdt": old["summary"]["final_equity_usdt"],
        "h24_native_positions": aggregate(cases),
        "exclusive_b_lifecycle": {name: aggregate(values) for name, values in groups.items()},
        "exit_kind_counts": dict(sorted(exit_counts.items())),
        "early_runner_target_positions": aggregate([c for c in cases if c["early_runner_target"]]),
        "h24_submission_guards": {
            "max_stop_risk_fraction": max(row["gap_runner"]["max_submitted_stop_risk_fraction"] for row in new["summary"]["per_coin"]),
            "max_notional_fraction": max(row["gap_runner"]["max_submitted_notional_fraction"] for row in new["summary"]["per_coin"]),
            "min_share_skips": sum(row["gap_runner"]["minimum_share_skips"] for row in new["summary"]["per_coin"]),
        },
        "paired_exact_native_closed_position_pnl": paired_by_lifecycle,
        "unmatched_native_closed_positions": {
            "h24_count": len(unmatched_new_closed),
            "h24_pnl_usdt": str(sum((c["pnl"] for c in unmatched_new_closed), Decimal(0))),
            "h19_count": len(unmatched_old_closed),
            "h19_pnl_usdt": str(sum((usdt(p["realized_pnl"]) for p in unmatched_old_closed), Decimal(0))),
        },
        "native_market_exits": {
            "total": len(market_cases),
            "no_gap_at_decision": sum(c["reached_decision"] and not c["micro_gap"] for c in market_cases),
            "other": sum(not (c["reached_decision"] and not c["micro_gap"]) for c in market_cases),
            "other_at_180bar_hold_limit": sum(
                c["duration_ns"] is not None
                and 180 * FOUR_HOUR_NS <= c["duration_ns"] < 181 * FOUR_HOUR_NS
                for c in other_market_cases
            ),
        },
        "exact_geometry_and_submit_time": {
            "h24_bundles": sum(map(len, new_keys.values())),
            "h19_bundles": sum(map(len, old_keys.values())),
            "unique_exact_keys": len(exact_new & exact_old),
            "new_only_keys": len(exact_new - old_keys.keys()),
            "old_only_keys": len(exact_old - new_keys.keys()),
            "ambiguous_keys": len(ambiguous),
            "new_position_keys_exactly_present_in_old": len(new_position_keys & exact_new & exact_old),
            "old_position_keys_exactly_present_in_new": len(old_position_keys & exact_new & exact_old),
            "new_bundles_with_multiple_native_positions": sum(len(positions) > 1 for positions in new_positions.values()),
            "old_bundles_with_multiple_native_positions": sum(len(positions) > 1 for positions in old_positions.values()),
        },
        "interpretation": "Position PnL is native reported realized PnL, not a reconstructed runner cash-flow ledger; exact matched positions are descriptive, not account-level causal effects, and unmatched orders have no counterfactual PnL.",
    }
    if sum(group["positions"] for group in result["exclusive_b_lifecycle"].values()) != len(cases):
        raise ValueError("nonexclusive lifecycle partition")
    if result["exclusive_b_lifecycle"]["gap_persistent"]["positions"] != 82 or result["exclusive_b_lifecycle"]["no_gap"]["positions"] != 76:
        raise ValueError("D87 gap count differs from passing D86/H24 clock")
    if result["native_market_exits"] != {"total": 121, "no_gap_at_decision": 76, "other": 45, "other_at_180bar_hold_limit": 45}:
        raise ValueError("unexpected native market exit lifecycle")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")


if __name__ == "__main__":
    main()
