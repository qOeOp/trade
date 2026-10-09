"""D92: read-only native path attribution for H26a-only support bundles."""

from __future__ import annotations

import argparse
import ast
import gzip
import hashlib
import json
from bisect import bisect_left
from collections import Counter
from collections import defaultdict
from datetime import UTC
from datetime import datetime
from decimal import Decimal
from pathlib import Path
from statistics import median

from audit_d80_brooks_breakout_context import FOUR_HOUR_NS
from audit_d80_brooks_breakout_context import MILLISECOND_NS
from audit_d80_brooks_breakout_context import native_bars
from audit_d90_brooks_structural_range import atr_before
from audit_d90_brooks_structural_range import pivots
from readback_h26a_flow import read


ROOT = Path(__file__).resolve().parent
RESULTS = ROOT / "results"
IDENTITY = RESULTS / "2026-10-07-input-identity.json"
EXPECTED = {
    IDENTITY: "ce9963ca68c66d34af74dbdbfff484f320a622fa73afe64844518aed354ec9fc",
    RESULTS / "2026-10-09-h26a-37-summary.json": "cc8f4df0199cb6c1b16146af95b880461b11da8e8ca2dd0775ff59ef59b9912a",
    RESULTS / "2026-10-09-h26a-37-native-audit.json": "164f41a06fbb3f401511142ebf759c84634dde6b4853fd12c36939a4371a98df",
    RESULTS / "2026-10-09-h26a-37-support-clock.json": "91edf5383a81758a17010b9e24efcdfd78b547ea94ab9f56230331c108121d5e",
    RESULTS / "2026-10-09-h26a-vs-h25a-flow.json": "068073fd694adbfa520d109afca61d2ba348a0888e00f58a8cddaa373c8077cc",
}
LANDMARKS = (1, 3, 5, 10)


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def iso_month(ns: int) -> str:
    return datetime.fromtimestamp(ns / 1e9, tz=UTC).strftime("%Y-%m")


def path_readout(position: dict, orders: dict, bars: list[dict]) -> dict:
    events = ast.literal_eval(position["events"])
    buys = [event for event in events if event["type"] == "OrderFilled" and event["order_side"] == "BUY"]
    sells = [event for event in events if event["type"] == "OrderFilled" and event["order_side"] == "SELL"]
    if not buys or buys[0]["client_order_id"] != position["opening_order_id"]:
        raise RuntimeError("native Position lacks its first opening fill")
    opened_ns = int(buys[0]["ts_event"])
    closed_ns = int(sells[-1]["ts_event"]) if sells else None
    if bool(closed_ns) != bool(position["ts_closed"]):
        raise RuntimeError("native Position closure disagrees with fill events")
    first_entry = orders[buys[0]["client_order_id"]]
    siblings = {
        order["tags"]: order
        for order in orders.values()
        if order["order_list_id"] == first_entry["order_list_id"]
    }
    stop = float(siblings["['STOP_LOSS']"]["trigger_price"])
    target = float(siblings["['TAKE_PROFIT']"]["price"])
    entry = float(buys[0]["last_px"])
    risk, room = entry - stop, target - entry
    if risk <= 0 or room <= 0:
        raise RuntimeError("native first fill lacks positive stop risk or B room")
    ends = [bar["end_ns"] for bar in bars]
    entry_i = bisect_left(ends, opened_ns)
    if entry_i >= len(bars):
        raise RuntimeError("native entry after last complete four-hour bar")
    exit_i = bisect_left(ends, closed_ns) if closed_ns is not None else len(bars)
    interior = bars[entry_i + 1 : exit_i]
    maximum = max((bar["high"] for bar in interior), default=None)
    minimum = min((bar["low"] for bar in interior), default=None)
    sell_tags = [orders[event["client_order_id"]]["tags"] for event in sells]
    final_tag = orders[position["closing_order_id"]]["tags"] if sells else None
    if sells and sells[-1]["client_order_id"] != position["closing_order_id"]:
        raise RuntimeError("native final sell differs from closing order")
    landmarks = {}
    for n in LANDMARKS:
        i = entry_i + n
        if i >= len(bars):
            landmarks[str(n)] = {"state": "end_censored"}
        elif closed_ns is not None and bars[i]["end_ns"] >= closed_ns:
            landmarks[str(n)] = {"state": "native_closed_before_observation"}
        else:
            seen = bars[entry_i + 1 : i + 1]
            landmarks[str(n)] = {
                "state": "open_after_completed_bar",
                "close_progress_r": (bars[i]["close"] - entry) / risk,
                "mfe_r": max(0.0, max(bar["high"] for bar in seen) - entry) / risk,
                "mae_r": max(0.0, entry - min(bar["low"] for bar in seen)) / risk,
                "close_below_first_fill": bars[i]["close"] <= entry,
            }
    return {
        "opening_order_id": position["opening_order_id"],
        "first_fill_ns": opened_ns,
        "closed_ns": closed_ns,
        "first_fill_price": entry,
        "native_stop": stop,
        "native_b_target": target,
        "first_fill_to_stop_risk": risk,
        "first_fill_to_b_room_r": room / risk,
        "native_buy_fill_count": len(buys),
        "native_filled_entry_tiers": len({event["client_order_id"] for event in buys}),
        "native_sell_fill_count": len(sells),
        "native_final_exit_tag": final_tag,
        "all_native_sell_tags": sell_tags,
        "native_closed_realized_pnl_usdt": position["realized_pnl"] if closed_ns is not None else None,
        "positive_native_close": float(position["realized_pnl"].removesuffix(" USDT")) > 0 if closed_ns is not None else None,
        "strict_interior_complete_bars": len(interior),
        "strict_interior_mfe_r": max(0.0, maximum - entry) / risk if maximum is not None else None,
        "strict_interior_mae_r": max(0.0, entry - minimum) / risk if minimum is not None else None,
        "strict_interior_fraction_to_b": max(0.0, maximum - entry) / room if maximum is not None else None,
        "landmarks": landmarks,
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
            raise RuntimeError(f"frozen D92 input changed: {path}")
    for name in ("2026-10-09-h26a-37-native-audit.json", "2026-10-09-h26a-37-support-clock.json"):
        if not json.loads((RESULTS / name).read_text())["passed"]:
            raise RuntimeError(f"required native audit failed: {name}")
    identity = json.loads(IDENTITY.read_text())
    source_by_coin = {item["coin"]: item for item in identity["coins"]}
    candidate, baseline = read(args.candidate), read(args.baseline)
    if candidate["sha256"]["summary.json"] != EXPECTED[RESULTS / "2026-10-09-h26a-37-summary.json"]:
        raise RuntimeError("native candidate summary changed")
    flow = json.loads((RESULTS / "2026-10-09-h26a-vs-h25a-flow.json").read_text())
    if candidate["sha256"] != flow["candidate_sha256"] or baseline["sha256"] != flow["baseline_sha256"]:
        raise RuntimeError("native source-key flow report identity changed")
    candidate_only = set(candidate["bundles"]) - set(baseline["bundles"])
    if len(candidate_only) != flow["candidate_only_source_keys"]:
        raise RuntimeError("native candidate-only bundle population changed")
    import csv
    with (args.candidate / "orders.csv").open(newline="") as source:
        orders = {row["client_order_id"]: row for row in csv.DictReader(source)}
    decisions = {
        row["coin"]: {
            (item["rounded_stop"], item["rounded_b"], item["signal_end_ns"]): item
            for item in row["structural_support"]["decisions"] if item["accepted"]
        }
        for row in candidate["summary"]["per_coin"]
    }
    details = []
    per_coin = defaultdict(list)
    for key in sorted(candidate_only):
        per_coin[key[0]].append(key)
    for coin, keys in sorted(per_coin.items()):
        _, bars, count = native_bars(Path(identity["minute_catalog_root"]), coin, source_by_coin[coin]["minute_catalog"]["sha256"])
        ends = {bar["end_ns"]: i for i, bar in enumerate(bars)}
        atrs = atr_before(bars)
        for key in keys:
            _, stop, b, signal_ns = key
            decision = decisions[coin][(stop, b, signal_ns)]
            signal_i = ends[signal_ns - MILLISECOND_NS]
            b_i = ends[decision["b_end_ns"] - MILLISECOND_NS]
            atr = atrs[signal_i]
            if atr is None or abs(atr - decision["prior_14bar_wilder_atr"]) > 1e-7:
                raise RuntimeError(f"prior ATR mismatch: {key}")
            prior = [j for j in pivots(bars, signal_i, b_i, "high") if abs(bars[j]["high"] - float(b)) <= atr]
            if len(prior) != decision["prior_confirmed_resistance_test_count"] or not prior:
                raise RuntimeError(f"H26a-only source lacks confirmed prior B test: {key}")
            nearest = min(prior, key=lambda j: (abs(bars[j]["high"] - float(b)), j))
            positions = [path_readout(p, orders, bars) for p in candidate["outcomes"].get(key, [])]
            details.append({
                "source_key": [coin, stop, b, signal_ns],
                "source_key_coin": coin,
                "source_month_utc": iso_month(signal_ns),
                "source_a_end_ns": decision["a_end_ns"],
                "source_b_end_ns": decision["b_end_ns"],
                "prior_confirmed_b_tests": len(prior),
                "nearest_prior_b_high": bars[nearest]["high"],
                "nearest_prior_b_end_ns": bars[nearest]["end_ns"],
                "nearest_prior_b_distance_atr": abs(bars[nearest]["high"] - float(b)) / atr,
                "native_submitted_entry_ids": [p["client_order_id"] for p in candidate["bundles"][key]],
                "native_positions": positions,
            })
        print(f"D92 verified {coin}: {len(keys)} added bundles, {count} native LAST bars", flush=True)
    positions = [p for row in details for p in row["native_positions"]]
    if len(positions) != flow["candidate_only_positions"]["positions"]:
        raise RuntimeError("native added Position count changed")
    closed = [p for p in positions if p["closed_ns"] is not None]
    losers = [p for p in closed if not p["positive_native_close"]]
    winners = [p for p in closed if p["positive_native_close"]]
    def metric(values: list[float]) -> dict:
        return {"count": len(values), "median": median(values) if values else None}
    def grouped(rows: list[dict], field: str) -> dict:
        cohorts = defaultdict(list)
        for row in rows:
            cohorts[row[field]].append(row)
        result = {}
        for label, source_rows in sorted(cohorts.items()):
            native = [p for row in source_rows for p in row["native_positions"]]
            completed = [p for p in native if p["closed_ns"] is not None]
            result[label] = {
                "submitted_bundles": len(source_rows),
                "native_positions": len(native),
                "native_closed": len(completed),
                "native_positive_closed": sum(p["positive_native_close"] for p in completed),
                "native_closed_realized_pnl_usdt": str(sum((Decimal(p["native_closed_realized_pnl_usdt"].removesuffix(" USDT")) for p in completed), Decimal(0))),
            }
        return result
    checkpoints = {}
    for n in LANDMARKS:
        states = Counter(p["landmarks"][str(n)]["state"] for p in positions)
        slow_winners = sum(
            p["positive_native_close"] and p["landmarks"][str(n)].get("close_below_first_fill", False)
            for p in positions
        )
        checkpoints[str(n)] = {"states": dict(states), "eventual_positive_native_closes_with_close_at_or_below_first_fill": slow_winners}
    result = {
        "schema": "r1-native-d92-h26a-b-obstacle/v1",
        "registration_commit": "cd77b7c8bbb4d9790f5776fbec16bf3f2c2ba708",
        "bound_sha256": {str(path.relative_to(ROOT)): digest for path, digest in EXPECTED.items()},
        "candidate_run_sha256": candidate["sha256"],
        "baseline_run_sha256": baseline["sha256"],
        "added_native_bundles": len(details),
        "added_bundles_without_position": sum(not row["native_positions"] for row in details),
        "native_positions": len(positions),
        "native_closed": len(closed),
        "native_positive_closed": len(winners),
        "native_open_censored": len(positions) - len(closed),
        "native_final_exit_tags": dict(Counter(p["native_final_exit_tag"] for p in closed)),
        "native_all_sell_tags": dict(Counter(tag for p in closed for tag in p["all_native_sell_tags"])),
        "two_or_more_native_buy_fills": sum(p["native_buy_fill_count"] >= 2 for p in positions),
        "distinct_native_filled_entry_tiers": dict(Counter(p["native_filled_entry_tiers"] for p in positions)),
        "native_exit_tags_by_filled_entry_tiers": {
            str(tiers): dict(Counter(p["native_final_exit_tag"] for p in closed if p["native_filled_entry_tiers"] == tiers))
            for tiers in sorted({p["native_filled_entry_tiers"] for p in positions})
        },
        "nearest_prior_b_distance_atr": metric([row["nearest_prior_b_distance_atr"] for row in details]),
        "first_fill_b_room_r": metric([p["first_fill_to_b_room_r"] for p in positions]),
        "strict_interior_mfe_r": {"winners": metric([p["strict_interior_mfe_r"] for p in winners if p["strict_interior_mfe_r"] is not None]), "nonpositive": metric([p["strict_interior_mfe_r"] for p in losers if p["strict_interior_mfe_r"] is not None])},
        "strict_interior_fraction_to_b": {"winners": metric([p["strict_interior_fraction_to_b"] for p in winners if p["strict_interior_fraction_to_b"] is not None]), "nonpositive": metric([p["strict_interior_fraction_to_b"] for p in losers if p["strict_interior_fraction_to_b"] is not None])},
        "nonpositive_strict_interior_half_b_room": {
            "at_or_above_half": sum(p["strict_interior_fraction_to_b"] is not None and p["strict_interior_fraction_to_b"] >= 0.5 for p in losers),
            "below_half": sum(p["strict_interior_fraction_to_b"] is not None and p["strict_interior_fraction_to_b"] < 0.5 for p in losers),
            "no_whole_interior_bar": sum(p["strict_interior_fraction_to_b"] is None for p in losers),
        },
        "landmarks": checkpoints,
        "source_coin_bundle_counts": dict(sorted(Counter(row["source_key"][0] for row in details).items())),
        "source_month_bundle_counts": dict(sorted(Counter(row["source_month_utc"] for row in details).items())),
        "descriptive_cohorts_by_coin": grouped(details, "source_key_coin"),
        "descriptive_cohorts_by_source_month": grouped(details, "source_month_utc"),
        "limitations": [
            "Strict interior completed four-hour bars omit entry and exit bars; MFE/MAE are observed lower bounds, not full intrabar extremes.",
            "Native realized outcomes include historical native fees/funding, while R-normalized price paths do not subtract those cashflows.",
            "Only H26a actual fills are observed; comparing selected cohorts does not prove prior B resistance caused a reversal.",
            "The year and source-key cohort were already exposed; this is read-only mechanism research, not independent validation.",
        ],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.detail.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    with gzip.open(args.detail, "wt", encoding="utf-8") as stream:
        json.dump(details, stream, separators=(",", ":"))


if __name__ == "__main__":
    main()
