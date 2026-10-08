"""
Compare frozen daily signal plans with submitted native R-1 brackets.

This report reads native Catalog and order facts; it creates no fills or PnL.

"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
from collections import Counter
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path
from statistics import median

from audit_daily_signal_counts import DAY_NS
from audit_daily_signal_counts import _daily_bars
from run import _ns

from vibe_trading.persistence import ParquetDataCatalog


@dataclass(frozen=True)
class PlannedBracket:
    armed_ns: int
    expires_ns: int
    side: int
    entry: Decimal
    stop: Decimal
    target: Decimal


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _plans(days, instrument, trade_start: int):  # noqa: C901 - frozen rule stays literal.
    """
    Recompute the frozen pivot/body signal and native planned order prices.
    """
    opened = [day.open for day in days]
    high = [day.high for day in days]
    low = [day.low for day in days]
    close = [day.close for day in days]
    pivot_highs: list[tuple[float, float]] = []
    pivot_lows: list[tuple[float, float]] = []
    trend = 0
    atr = 0.0
    planned = []
    for i, day in enumerate(days):
        prior_close = close[i - 1] if i else close[i]
        true_range = max(
            high[i] - low[i],
            abs(high[i] - prior_close),
            abs(low[i] - prior_close),
        )
        atr = true_range if i == 0 else (atr * 13 + true_range) / 14
        if i < 27:
            continue
        j = i - 3
        if high[j] == max(high[j - 3 : j + 4]):
            pivot_highs.append((high[j], max(opened[j], close[j])))
        if low[j] == min(low[j - 3 : j + 4]):
            pivot_lows.append((low[j], min(opened[j], close[j])))
        prior_median = median(abs(close[k] - opened[k]) for k in range(i - 20, i))
        big = abs(close[i] - opened[i]) >= 1.5 * prior_median
        big2 = abs(close[i] - opened[i - 1]) >= 3 * prior_median
        strong_up = (close[i] > opened[i] and big) or (close[i] > opened[i - 1] and big2)
        strong_down = (close[i] < opened[i] and big) or (close[i] < opened[i - 1] and big2)
        crossed_highs = (
            [pivot for pivot in pivot_highs if close[i - 1] <= pivot[0] < close[i]]
            if strong_up
            else []
        )
        crossed_lows = (
            [pivot for pivot in pivot_lows if close[i] < pivot[0] <= close[i - 1]]
            if strong_down
            else []
        )
        if pivot_highs and strong_up and close[i] > pivot_highs[-1][0] and trend != 1:
            trend = 1
        elif pivot_lows and strong_down and close[i] < pivot_lows[-1][0] and trend != -1:
            trend = -1
        if day.available_ns < trade_start:
            continue
        for side, pivots in ((1, crossed_highs), (-1, crossed_lows)):
            if trend != side:
                continue
            for level, edge in pivots:
                zone = max(edge, level - atr) if side == 1 else min(edge, level + atr)
                stop = zone - side * 0.25 * atr
                if (level - stop) * side <= 0:
                    continue
                target = level + side * 2 * abs(level - stop)
                planned.append(
                    PlannedBracket(
                        day.available_ns,
                        day.available_ns + 10 * DAY_NS,
                        side,
                        Decimal(str(instrument.make_price(level))),
                        Decimal(str(instrument.make_price(stop))),
                        Decimal(str(instrument.make_price(target))),
                    ),
                )
    return planned


def _native_order_lists(path: Path):
    by_list: dict[str, dict[str, dict[str, str]]] = {}
    with path.open(newline="") as stream:
        for order in csv.DictReader(stream):
            if order["tags"] not in ("['ENTRY']", "['STOP_LOSS']", "['TAKE_PROFIT']"):
                continue
            roles = by_list.setdefault(order["order_list_id"], {})
            role = order["tags"].strip("[]'")
            if role in roles:
                raise RuntimeError(f"duplicate native {role} in {order['order_list_id']}")
            roles[role] = order
    if any(set(roles) != {"ENTRY", "STOP_LOSS", "TAKE_PROFIT"} for roles in by_list.values()):
        raise RuntimeError("incomplete native bracket order list")
    return by_list


def main() -> None:  # noqa: C901 - one read-only native report lifecycle.
    parser = argparse.ArgumentParser()
    parser.add_argument("--catalog-root", type=Path, required=True)
    parser.add_argument("--daily-root", type=Path, required=True)
    parser.add_argument("--run-summary", type=Path, required=True)
    parser.add_argument("--run-orders", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    summary = json.loads(args.run_summary.read_text())
    if summary["signal_variant"] != "daily-pivot":
        raise RuntimeError("native R-1u summary required")
    start = _ns(summary["input_start_utc"])
    trade_start = _ns(summary["period_start_utc"])
    end = _ns(summary["period_end_utc"])
    plans_by_instrument = {}
    candidate_counts = {}
    for row in summary["per_coin"]:
        coin, instrument_id = row["coin"], row["instrument"]
        daily, _, _ = _daily_bars(
            args.daily_root,
            args.catalog_root,
            coin,
            instrument_id,
            start,
            end,
        )
        catalog = ParquetDataCatalog(str(args.catalog_root / coin / "minute"))
        instruments = catalog.instruments(instrument_ids=[instrument_id])
        if len(instruments) != 1:
            raise RuntimeError(f"{coin}: native instrument identity missing")
        plans = _plans(daily, instruments[0], trade_start)
        candidate_counts[coin] = len(plans)
        if len(plans) != row["signals"]:
            raise RuntimeError(f"{coin}: planned/native signal count differs")
        lookup = {}
        for plan in plans:
            lookup.setdefault((plan.armed_ns, plan.side, plan.entry), []).append(plan)
        plans_by_instrument[instrument_id] = lookup

    counts = Counter(
        {
            "native_brackets": 0,
            "matched_brackets": 0,
            "unmatched_entry_plan": 0,
            "stop_or_target_price_mismatch": 0,
            "invalid_submission_time": 0,
            "ambiguous_matching_plans": 0,
            "filled_entries": 0,
            "price_improved_fills": 0,
            "adverse_limit_fills": 0,
            "actual_fill_r_more_than_0_01_from_2": 0,
        },
    )
    unmatched = []
    price_mismatches = []
    ambiguous = []
    invalid_times = []
    fill_r_ratios = []
    fill_improvements = []
    for list_id, roles in _native_order_lists(args.run_orders).items():
        entry, stop, target = (roles[role] for role in ("ENTRY", "STOP_LOSS", "TAKE_PROFIT"))
        counts["native_brackets"] += 1
        instrument_id = entry["instrument_id"]
        side = 1 if entry["side"] == "BUY" else -1
        expires_ns = int(Decimal(entry["expire_time_ns"]))
        armed_ns = expires_ns - 10 * DAY_NS
        entry_price = Decimal(entry["price"])
        key = (armed_ns, side, entry_price)
        candidates = plans_by_instrument[instrument_id].get(key, [])
        if not candidates:
            counts["unmatched_entry_plan"] += 1
            if len(unmatched) < 10:
                unmatched.append(
                    {"order_list_id": list_id, "instrument": instrument_id, "key": str(key)},
                )
            continue
        submitted_ns = int(entry["ts_init"])
        if not armed_ns <= submitted_ns < expires_ns:
            counts["invalid_submission_time"] += 1
            if len(invalid_times) < 10:
                invalid_times.append(
                    {
                        "order_list_id": list_id,
                        "armed_ns": armed_ns,
                        "submitted_ns": submitted_ns,
                        "expires_ns": expires_ns,
                    },
                )
        stop_price = Decimal(stop["trigger_price"])
        target_price = Decimal(target["price"])
        matches = [
            plan for plan in candidates if plan.stop == stop_price and plan.target == target_price
        ]
        if not matches:
            counts["stop_or_target_price_mismatch"] += 1
            if len(price_mismatches) < 10:
                price_mismatches.append(
                    {
                        "order_list_id": list_id,
                        "entry": str(entry_price),
                        "actual_stop": str(stop_price),
                        "actual_target": str(target_price),
                        "expected": [
                            {"stop": str(plan.stop), "target": str(plan.target)}
                            for plan in candidates
                        ],
                    },
                )
            continue
        counts["matched_brackets"] += 1
        if len(matches) > 1:
            counts["ambiguous_matching_plans"] += 1
            if len(ambiguous) < 10:
                ambiguous.append({"order_list_id": list_id, "candidate_count": len(matches)})
        if entry["status"] == "FILLED":
            counts["filled_entries"] += 1
            fill = Decimal(entry["avg_px"])
            risk = Decimal(side) * (fill - stop_price)
            reward = Decimal(side) * (target_price - fill)
            if risk <= 0:
                raise RuntimeError(f"{list_id}: non-positive native fill-to-stop risk")
            fill_r_ratios.append(float(reward / risk))
            improvement = Decimal(side) * (entry_price - fill)
            fill_improvements.append(float(improvement))
            if improvement > 0:
                counts["price_improved_fills"] += 1
            elif improvement < 0:
                counts["adverse_limit_fills"] += 1
            if abs(reward / risk - Decimal(2)) > Decimal("0.01"):
                counts["actual_fill_r_more_than_0_01_from_2"] += 1

    report = {
        "native_summary": str(args.run_summary),
        "native_summary_sha256": _sha256(args.run_summary),
        "native_orders": str(args.run_orders),
        "native_orders_sha256": _sha256(args.run_orders),
        "daily_count_audit_source_sha256": _sha256(Path(_daily_bars.__code__.co_filename)),
        "diagnostic_source_sha256": _sha256(Path(__file__)),
        "planned_signals_per_coin": candidate_counts,
        "planned_signals_total": sum(candidate_counts.values()),
        "counts": dict(sorted(counts.items())),
        "unmatched_entry_plan_examples": unmatched,
        "stop_or_target_price_mismatch_examples": price_mismatches,
        "ambiguous_matching_plan_examples": ambiguous,
        "invalid_submission_time_examples": invalid_times,
        "actual_fill_reward_risk_min": min(fill_r_ratios) if fill_r_ratios else None,
        "actual_fill_reward_risk_max": max(fill_r_ratios) if fill_r_ratios else None,
        "actual_fill_reward_risk_mean": sum(fill_r_ratios) / len(fill_r_ratios)
        if fill_r_ratios
        else None,
        "actual_fill_price_improvement_min": min(fill_improvements) if fill_improvements else None,
        "actual_fill_price_improvement_max": max(fill_improvements) if fill_improvements else None,
        "method": "Read-only match of every native bracket to a frozen-rule daily signal plan. Order prices are native Instrument-rounded. Actual fill reward/risk is price geometry of native order reports before fees, funding or PnL; no alternate fill or backtest is generated.",
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report["counts"], indent=2))


if __name__ == "__main__":
    main()
