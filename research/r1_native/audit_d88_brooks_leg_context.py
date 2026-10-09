"""Read-only pre-submission A-to-B leg context on frozen H19a native plans."""

from __future__ import annotations

import ast
import csv
import gzip
import hashlib
import io
import json
from collections import Counter
from collections import defaultdict
from decimal import Decimal
from pathlib import Path

import pandas as pd

from audit_d80_brooks_breakout_context import FOUR_HOUR_NS
from audit_d80_brooks_breakout_context import native_bars
from audit_d80_brooks_breakout_context import planned_keys


ROOT = Path(__file__).resolve().parent
RESULTS = ROOT / "results"
RUN = Path("/tmp/r1-h24a-paired-h19a-37")
IDENTITY = RESULTS / "2026-10-07-input-identity.json"
D77 = RESULTS / "2026-10-08-d77-native-entry-geometry-bundles.json.gz"
D80 = RESULTS / "2026-10-08-d80-brooks-breakout-context-bundles.json.gz"
OUT = RESULTS / "2026-10-08-d88-brooks-leg-context.json"
DETAIL = RESULTS / "2026-10-08-d88-brooks-leg-context-bundles.json.gz"
EXPECTED = {
    IDENTITY: "ce9963ca68c66d34af74dbdbfff484f320a622fa73afe64844518aed354ec9fc",
    D77: "ed66b59b9f8db091572aaec1fb65146c629686cc94954fa3cb6fc991034c56b0",
    D80: "ac941cfa197cee805c38d7447c296e05aa5819344312cd755e5d574dcac192c4",
    RUN / "summary.json": "5459cc311e8f59dd1fa2a63ba4cee4b6c65a430f49c8f95aa0e56e565bfd234a",
    RUN / "orders.csv": "ea5ef92e52e10df0182321d21cf72c49bcfc8e8c355114d8ddbd6a03c633b479",
    RUN / "positions.csv": "be362ce190ca02fca57a144c534334b30a34a8996c1628e6a8c97b351c55d245",
}


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def third(value: float | None) -> str:
    if value is None:
        return "undefined"
    if value < 1 / 3:
        return "lower"
    if value < 2 / 3:
        return "middle"
    return "upper"


def summarize(rows: list[dict]) -> dict:
    positions = [p for row in rows for p in row["native_positions"]]
    closed = [p for p in positions if p["closed"]]
    positive = [p for p in closed if Decimal(p["native_final_realized_pnl_usdt"]) > 0]
    nonpositive = [p for p in closed if Decimal(p["native_final_realized_pnl_usdt"]) <= 0]
    win_sum = sum((Decimal(p["native_final_realized_pnl_usdt"]) for p in positive), Decimal(0))
    loss_sum = sum((Decimal(p["native_final_realized_pnl_usdt"]) for p in nonpositive), Decimal(0))
    causes = Counter(p["close_cause"] for p in closed)
    return {
        "submitted_bundles": len(rows),
        "filled_bundles": sum(row["any_positive_buy_fill"] for row in rows),
        "native_positions": len(positions),
        "native_closed": len(closed),
        "native_open_censored": len(positions) - len(closed),
        "native_wins": len(positive),
        "native_closed_win_pct": 100 * len(positive) / len(closed) if closed else None,
        "native_b_target_closes": causes["target"],
        "native_pre_b_stop_closes": causes["stop"],
        "native_other_close_causes": dict(sorted((k, v) for k, v in causes.items() if k not in {"target", "stop"})),
        "native_closed_realized_pnl_usdt": str(win_sum + loss_sum),
        "native_realized_payoff": float((win_sum / len(positive)) / (-loss_sum / len(nonpositive))) if positive and nonpositive and loss_sum < 0 else None,
    }


def stability(rows: list[dict], field: str, split: str) -> dict:
    by_group = defaultdict(lambda: defaultdict(list))
    for row in rows:
        by_group[row[split]][row[field]].extend(
            p for p in row["native_positions"] if p["closed"]
        )
    comparable = []
    for label, groups in by_group.items():
        lower = groups["lower"]
        upper = groups["upper"]
        if len(lower) < 3 or len(upper) < 3:
            continue
        lw = sum(Decimal(p["native_final_realized_pnl_usdt"]) > 0 for p in lower)
        uw = sum(Decimal(p["native_final_realized_pnl_usdt"]) > 0 for p in upper)
        comparable.append({"group": label, "lower_closed": len(lower), "lower_wins": lw, "upper_closed": len(upper), "upper_wins": uw, "upper_win_rate_higher": uw / len(upper) > lw / len(lower)})
    return {
        "comparable_groups_with_at_least_3_closed_each": len(comparable),
        "upper_win_rate_higher": sum(row["upper_win_rate_higher"] for row in comparable),
        "all_comparable": sorted(comparable, key=lambda row: row["group"]),
    }


def main() -> None:
    for path, expected in EXPECTED.items():
        if sha(path) != expected:
            raise RuntimeError(f"frozen input changed: {path}")
    identity = json.loads(IDENTITY.read_text())
    with gzip.open(D77, "rt") as stream:
        original = json.load(stream)
    with gzip.open(D80, "rt") as stream:
        prior = json.load(stream)
    if len(original) != 2939 or len(prior) != 2939:
        raise RuntimeError("native submitted population changed")
    source_by_id = {row["bundle_id"]: row for row in original}
    prior_by_coin = defaultdict(list)
    for row in prior:
        prior_by_coin[row["coin"]].append(row)
    with (RUN / "orders.csv").open(newline="") as stream:
        orders = {row["client_order_id"]: row for row in csv.DictReader(stream)}
    with (RUN / "positions.csv").open(newline="") as stream:
        native_positions = list(csv.DictReader(stream))
    if len(native_positions) != 507:
        raise RuntimeError("same-code H19a Position count changed")
    occupied_by_coin = defaultdict(list)
    for position in native_positions:
        occupied_by_coin[position["strategy_id"].removeprefix("R1-")].append(
            (
                pd.Timestamp(position["ts_opened"]).value,
                pd.Timestamp(position["ts_closed"]).value if position["ts_closed"] else None,
            )
        )
    stop_after_b_count = 0
    for position in native_positions:
        if not position["ts_closed"] or orders[position["closing_order_id"]]["type"] != "STOP_MARKET":
            continue
        sell_ids = [
            event["client_order_id"] for event in ast.literal_eval(position["events"])
            if event["type"] == "OrderFilled" and event["order_side"] == "SELL"
        ]
        stop_after_b_count += any(orders[order_id]["tags"] == "['TAKE_PROFIT']" for order_id in sell_ids)
    if stop_after_b_count:
        raise RuntimeError("stop-closed H19a Position had a prior B target fill")
    output = []
    for coin_identity in identity["coins"]:
        coin = coin_identity["coin"]
        instrument, bars, _ = native_bars(
            Path(identity["minute_catalog_root"]),
            coin,
            coin_identity["minute_catalog"]["sha256"],
        )
        plans = planned_keys(instrument, bars)
        for row in prior_by_coin[coin]:
            source = source_by_id[row["bundle_id"]]
            geometry = source["tier_geometry"]
            key = (
                geometry["first"]["entry"], geometry["deeper"]["entry"],
                geometry["first"]["stop"], geometry["first"]["target"],
            )
            parent = orders[geometry["first"]["parent_order_id"]]
            submit_ns = int(parent["ts_init"])
            candidates = [
                plan for plan in plans.get(key, [])
                if bars[plan["signal_i"]]["end_ns"] < submit_ns
                and submit_ns - bars[plan["signal_i"]]["end_ns"] <= 180 * FOUR_HOUR_NS
            ]
            if not candidates:
                raise RuntimeError(f"{row['bundle_id']}: no causal native source plan")
            if len({plan["b_i"] for plan in candidates}) != 1:
                raise RuntimeError(f"{row['bundle_id']}: ambiguous B bar")
            plan = max(candidates, key=lambda p: p["signal_i"])
            a_i, b_i = plan["a_i"], plan["b_i"]
            if not (0 <= a_i < b_i < len(bars)) or bars[plan["signal_i"]]["end_ns"] != row["signal_end_ns"] or bars[b_i]["end_ns"] != row["b_end_ns"]:
                raise RuntimeError(f"{row['bundle_id']}: causal A/B clock mismatch")
            leg = bars[a_i : b_i + 1]
            path = sum(abs(later["close"] - earlier["close"]) for earlier, later in zip(leg, leg[1:], strict=False))
            efficiency = abs(leg[-1]["close"] - leg[0]["close"]) / path if path > 0 else None
            overlap = sum(
                min(earlier["high"], later["high"]) > max(earlier["low"], later["low"])
                for earlier, later in zip(leg, leg[1:], strict=False)
            ) / (len(leg) - 1)
            if efficiency is not None and not (0 <= efficiency <= 1 + 1e-10):
                raise RuntimeError(f"{row['bundle_id']}: efficiency outside logical scale")
            output.append({
                "bundle_id": row["bundle_id"], "coin": coin,
                "submission_month_utc": row["submission_month_utc"],
                "native_submission_ns": submit_ns,
                "a_end_ns": bars[a_i]["end_ns"], "b_end_ns": bars[b_i]["end_ns"],
                "leg_bars": b_i - a_i + 1,
                "same_coin_position_already_open_at_submission": any(
                    start <= submit_ns and (end is None or submit_ns < end)
                    for start, end in occupied_by_coin[coin]
                ),
                "directional_efficiency": efficiency,
                "directional_efficiency_third": third(efficiency),
                "strict_adjacent_range_overlap_frequency": overlap,
                "strict_adjacent_range_overlap_third": third(overlap),
                "b_close_breaks_prior_60_high": row["b_close_breaks_prior_60_high"],
                "any_positive_buy_fill": row["any_positive_buy_fill"],
                "native_positions": row["native_positions"],
            })
    if len(output) != 2939 or len({row["bundle_id"] for row in output}) != 2939:
        raise RuntimeError("native submitted population incomplete")
    output.sort(key=lambda row: (row["native_submission_ns"], row["bundle_id"]))
    result = {
        "schema": "r1-native-d88-brooks-leg-context/v1",
        "source_sha256": {str(path): expected for path, expected in EXPECTED.items()},
        "native_stop_closes_after_any_b_target_fill": stop_after_b_count,
        "causal_leg_coverage": {
            "missing_or_ambiguous_source_plans": 0,
            "min_completed_leg_bars": min(row["leg_bars"] for row in output),
            "under_3_completed_leg_bars": sum(row["leg_bars"] < 3 for row in output),
            "same_coin_position_already_open_at_submission": sum(row["same_coin_position_already_open_at_submission"] for row in output),
        },
        "all": summarize(output),
        "by_efficiency_third": {label: summarize([r for r in output if r["directional_efficiency_third"] == label]) for label in ("lower", "middle", "upper", "undefined")},
        "by_overlap_third": {label: summarize([r for r in output if r["strict_adjacent_range_overlap_third"] == label]) for label in ("lower", "middle", "upper")},
        "by_b_close_breakout": {str(label).lower(): summarize([r for r in output if r["b_close_breaks_prior_60_high"] is label]) for label in (False, True)},
        "efficiency_coin_stability": stability(output, "directional_efficiency_third", "coin"),
        "efficiency_month_stability": stability(output, "directional_efficiency_third", "submission_month_utc"),
        "overlap_coin_stability": stability(output, "strict_adjacent_range_overlap_third", "coin"),
        "overlap_month_stability": stability(output, "strict_adjacent_range_overlap_third", "submission_month_utc"),
        "low_efficiency_native_winners": [r["bundle_id"] for r in output if r["directional_efficiency_third"] == "lower" and any(p["closed"] and Decimal(p["native_final_realized_pnl_usdt"]) > 0 for p in r["native_positions"])],
        "high_efficiency_native_nonwinners": [r["bundle_id"] for r in output if r["directional_efficiency_third"] == "upper" and any(p["closed"] and Decimal(p["native_final_realized_pnl_usdt"]) <= 0 for p in r["native_positions"])],
        "limitations": ["All features use completed A-to-B bars before native order submission; group outcomes are original native Positions including fees/funding, not filtered shared-account backtests.", "Fixed thirds are descriptive bins on a logical 0–1 scale, not an optimized trading threshold.", "The source is Brooks E-mini context; applicability to continuous Binance perpetuals remains unverified."],
    }
    if (result["all"]["native_positions"], result["all"]["native_closed"], result["all"]["native_wins"]) != (507, 496, 212):
        raise RuntimeError("frozen H19a native Position population changed")
    OUT.write_text(json.dumps(result, indent=2) + "\n")
    with DETAIL.open("wb") as raw, gzip.GzipFile(fileobj=raw, mode="wb", filename="", mtime=0) as compressed, io.TextIOWrapper(compressed, encoding="utf-8") as stream:
        json.dump(output, stream)


if __name__ == "__main__":
    main()
