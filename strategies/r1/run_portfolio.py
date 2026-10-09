"""Replay prepared R1 instruments in one native Nautilus BacktestNode account."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
from datetime import UTC
from datetime import datetime
from datetime import timedelta
from decimal import Decimal
from pathlib import Path

from nautilus_trader.analysis import MaxDrawdown
from nautilus_trader.analysis import SharpeRatio
from nautilus_trader.model import ClientOrderId
from nautilus_trader.model import Venue
from brooks_confirmed_strategy import BrooksConfirmedStrategy
from gap_runner_strategy import GapRunnerStrategy
from native_node import run_native_node
from r1s_strategy import R1StagedStrategy
from replay_util import SOURCE_COMMIT
from replay_util import _json_safe
from replay_util import _ns
from replay_util import _snapshot_equity_usdt
from replay_inputs import read_instruments as _read_instruments
from retracement_strategy import RetracementStrategy
from strategy import R1Strategy
from structural_support_strategy import StructuralSupportStrategy
from tiered_retracement_strategy import TieredRetracementStrategy
from trendline_strategy import TrendlineBreakStrategy


LINE_VARIANTS = ("trendline-4h", "line-support-4h", "line-resting-4h")
RETRACEMENT_VARIANTS = (
    "support-confirmed-4h",
    "support-rejection-4h",
    "support-near50-4h",
)
TIERED_VARIANT = "support-three-tier-4h"
LINE_CANCEL_TIER_VARIANT = "support-three-tier-line-cancel-4h"
DEEP_TIER_VARIANT = "support-deep-two-tier-4h"
BROAD_TIER_VARIANT = "support-broad-two-tier-4h"
BROAD_LINE_CANCEL_VARIANT = "support-broad-two-tier-line-cancel-4h"
BROOKS_CONFIRMED_VARIANT = "support-brooks-confirmed-4h"
GAP_RUNNER_VARIANT = "support-broad-gap-runner-4h"
STRUCTURAL_SUPPORT_VARIANT = "support-broad-prior-a-support-4h"
ANY_PRIOR_A_SUPPORT_VARIANT = "support-broad-any-prior-a-support-4h"
OUTSIDE_A_STOP_VARIANT = "support-broad-any-prior-a-outside-stop-4h"
STRUCTURAL_SUPPORT_VARIANTS = (
    STRUCTURAL_SUPPORT_VARIANT,
    ANY_PRIOR_A_SUPPORT_VARIANT,
    OUTSIDE_A_STOP_VARIANT,
)
TIERED_VARIANTS = (
    TIERED_VARIANT,
    LINE_CANCEL_TIER_VARIANT,
    DEEP_TIER_VARIANT,
    BROAD_TIER_VARIANT,
    BROAD_LINE_CANCEL_VARIANT,
    BROOKS_CONFIRMED_VARIANT,
    GAP_RUNNER_VARIANT,
    *STRUCTURAL_SUPPORT_VARIANTS,
)
STAGED_EXITS = ("staged-r1s", "staged-edge-1r")
REPLAY_SUBMIT_RATE = "200/00:00:01"


def _orders_with_native_deadlines(engine, report):
    """
    Export optional GTD nanoseconds from native Orders without float coercion.
    """
    result = report.copy()
    deadlines = []
    for order_id in report.index:
        order = engine.cache.order(ClientOrderId.from_str(str(order_id)))
        if order is None:
            raise RuntimeError("native order missing during GTD deadline export")
        deadline = getattr(order, "expire_time", None)
        if str(order.time_in_force) == "GTD" and deadline is None:
            raise RuntimeError("native GTD order has no deadline")
        deadlines.append(str(deadline) if deadline is not None else "")
    result["expire_time_ns"] = deadlines
    return result


def main() -> None:  # noqa: C901 - CLI coordinates one shared-account replay lifecycle.
    parser = argparse.ArgumentParser()
    parser.add_argument("--catalog-root", type=Path, required=True)
    parser.add_argument("--daily-root", type=Path, required=True)
    parser.add_argument("--quantity-csv", type=Path, required=True)
    parser.add_argument("--mark-root", type=Path)
    parser.add_argument("--coins", nargs="+", required=True)
    parser.add_argument("--start", required=True)
    parser.add_argument("--end", required=True)
    parser.add_argument("--trade-start")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument(
        "--signal-variant",
        choices=(
            "daily-pivot",
            "daily-pivot-outer-4h",
            "box-4h",
            "box-edge-4h",
            "support-confirmed-4h",
            "support-rejection-4h",
            "support-near50-4h",
            *TIERED_VARIANTS,
            *LINE_VARIANTS,
        ),
        default="daily-pivot",
    )
    parser.add_argument(
        "--exit-variant",
        choices=("fixed-2r", "tier-target-b", *STAGED_EXITS),
        default="fixed-2r",
    )
    parser.add_argument("--risk-budget-bps", type=float)
    parser.add_argument("--coin-notional-cap-pct", type=float, default=5.0)
    args = parser.parse_args()
    if (args.exit_variant, args.signal_variant) not in (
        ("staged-r1s", "daily-pivot"),
        ("staged-edge-1r", "box-edge-4h"),
    ) and args.exit_variant in STAGED_EXITS:
        raise ValueError(
            "staged exit variant does not match its registered entry signal"
        )
    if (args.signal_variant in TIERED_VARIANTS) != (
        args.exit_variant == "tier-target-b"
    ):
        raise ValueError("budgeted tier signal requires its frozen target-B exit")
    if args.signal_variant in TIERED_VARIANTS and (
        args.risk_budget_bps != 25.0 or args.coin_notional_cap_pct != 5.0
    ):
        raise ValueError(
            "budgeted tiers require 25-bp total stop risk and 5% coin notional cap"
        )
    if args.risk_budget_bps is not None and not 0 < args.risk_budget_bps < 10_000:
        raise ValueError("risk budget bps must be between zero and 10000")
    if not 0 < args.coin_notional_cap_pct <= 100:
        raise ValueError("coin notional cap pct must be between zero and 100")
    start_dt = datetime.fromisoformat(args.start).astimezone(UTC)
    end_dt = datetime.fromisoformat(args.end).astimezone(UTC)
    trade_start_dt = (
        datetime.fromisoformat(args.trade_start).astimezone(UTC)
        if args.trade_start is not None
        else start_dt
    )
    if (
        not start_dt < end_dt
        or not start_dt <= trade_start_dt < end_dt
        or start_dt.minute % 5
        or end_dt.minute % 5
        or trade_start_dt.minute % 5
        or start_dt.second
        or end_dt.second
        or trade_start_dt.second
    ):
        raise ValueError("replay needs a positive five-minute-aligned interval")
    start, end = _ns(args.start), _ns(args.end)
    trade_start = _ns(trade_start_dt.isoformat())
    with args.quantity_csv.open(newline="") as stream:
        quantities = {row["coin"]: row["quantity"] for row in csv.DictReader(stream)}
    if len(args.coins) != len(set(args.coins)) or any(
        coin not in quantities for coin in args.coins
    ):
        raise ValueError("coins must be unique and have registered quantities")
    rows = _read_instruments(args.catalog_root, args.coins, quantities, start, end)
    strategy_class = (
        R1StagedStrategy
        if args.exit_variant in STAGED_EXITS
        else StructuralSupportStrategy
        if args.signal_variant in STRUCTURAL_SUPPORT_VARIANTS
        else GapRunnerStrategy
        if args.signal_variant == GAP_RUNNER_VARIANT
        else BrooksConfirmedStrategy
        if args.signal_variant == BROOKS_CONFIRMED_VARIANT
        else TieredRetracementStrategy
        if args.signal_variant in TIERED_VARIANTS
        else RetracementStrategy
        if args.signal_variant in RETRACEMENT_VARIANTS
        else TrendlineBreakStrategy
        if args.signal_variant in LINE_VARIANTS
        else R1Strategy
    )
    engine, strategies = run_native_node(
        rows,
        args,
        start_dt,
        end_dt,
        trade_start,
        strategy_class,
    )
    for row in rows:
        if row["counts"] != row["completion"].get("counts"):
            raise RuntimeError(
                f"{row['coin']}: streamed totals do not match download receipt",
            )
    integrity_findings = []
    if any(strategy.slot_violations for strategy in strategies.values()):
        integrity_findings.append("native entry fills violated a per-coin slot")
    if args.exit_variant in STAGED_EXITS and any(
        strategy.staged_protection_failures
        or strategy.staged_order_failures
        or strategy.staged_invalid_actual_target_closes
        for strategy in strategies.values()
    ):
        integrity_findings.append("native staged order integrity failed")
    account = engine.portfolio.account(venue=Venue("BINANCE"))
    if account is None:
        raise RuntimeError("native portfolio account missing")
    final_equity = _snapshot_equity_usdt(
        engine.portfolio.build_snapshot(account.id),
    )
    result = engine.get_result()
    args.output.mkdir(parents=True, exist_ok=True)
    reports = {
        "orders.csv": _orders_with_native_deadlines(
            engine, engine.generate_orders_report()
        ),
        "fills.csv": engine.generate_fills_report(),
        "positions.csv": engine.generate_positions_report(),
        "account.csv": engine.generate_account_report(venue=Venue("BINANCE")),
    }
    for name, report in reports.items():
        report.to_csv(
            args.output / name,
            index=True,
            index_label="ts_event" if name == "account.csv" else None,
        )
    with (args.output / "returns_series.csv").open("w", newline="") as stream:
        writer = csv.writer(stream)
        writer.writerow(("ts_event_ns", "native_return"))
        writer.writerows(sorted(result.returns_series.items()))
    positions = reports["positions.csv"]
    orders = reports["orders.csv"]
    if args.exit_variant in STAGED_EXITS and (
        (orders["status"] == "DENIED").any() or (orders["status"] == "REJECTED").any()
    ):
        integrity_findings.append("native staged orders were denied or rejected")
    if args.signal_variant in LINE_VARIANTS and (
        (orders["status"] == "DENIED").any() or (orders["status"] == "REJECTED").any()
    ):
        integrity_findings.append("native line orders were denied or rejected")
    if args.signal_variant == "box-edge-4h" and (
        (orders["status"] == "DENIED").any() or (orders["status"] == "REJECTED").any()
    ):
        integrity_findings.append("native range-edge orders were denied or rejected")
    if args.signal_variant in RETRACEMENT_VARIANTS and (
        (orders["status"] == "DENIED").any() or (orders["status"] == "REJECTED").any()
    ):
        integrity_findings.append(
            "native support-pullback orders were denied or rejected"
        )
    if args.signal_variant in TIERED_VARIANTS and (
        (orders["status"] == "DENIED").any()
        or (orders["status"] == "REJECTED").any()
        or any(strategy.bundle_order_failures for strategy in strategies.values())
    ):
        integrity_findings.append("native budgeted-tier orders were denied or rejected")
    if args.signal_variant == "support-rejection-4h" and any(
        strategy.retracement_actual_price_violations for strategy in strategies.values()
    ):
        integrity_findings.append(
            "market fill broke frozen stop/target protection relation"
        )
    closed = positions[positions["ts_closed"].notna()]
    pnl = (
        closed["realized_pnl"].astype(str).str.extract(r"(-?[0-9.]+)")[0].astype(float)
    )
    wins = int((pnl > 0).sum())
    duration_days = Decimal(str((end_dt - trade_start_dt) / timedelta(days=1)))
    eligible_returns = {
        ts: value for ts, value in result.returns_series.items() if ts >= trade_start
    }
    summary = {
        "source_commit": SOURCE_COMMIT,
        "strategy_source_sha256": hashlib.sha256(
            Path(__file__).with_name("strategy.py").read_bytes(),
        ).hexdigest(),
        "staged_strategy_source_sha256": (
            hashlib.sha256(
                Path(__file__).with_name("r1s_strategy.py").read_bytes()
            ).hexdigest()
            if args.exit_variant in STAGED_EXITS
            else None
        ),
        "trendline_strategy_source_sha256": (
            hashlib.sha256(
                Path(__file__).with_name("trendline_strategy.py").read_bytes(),
            ).hexdigest()
            if args.signal_variant in LINE_VARIANTS
            else None
        ),
        "retracement_strategy_source_sha256": (
            hashlib.sha256(
                Path(__file__).with_name("retracement_strategy.py").read_bytes(),
            ).hexdigest()
            if args.signal_variant in (*RETRACEMENT_VARIANTS, *TIERED_VARIANTS)
            else None
        ),
        "tiered_strategy_source_sha256": (
            hashlib.sha256(
                Path(__file__).with_name("tiered_retracement_strategy.py").read_bytes(),
            ).hexdigest()
            if args.signal_variant in TIERED_VARIANTS
            else None
        ),
        "brooks_confirmed_strategy_source_sha256": (
            hashlib.sha256(Path(__file__).with_name("brooks_confirmed_strategy.py").read_bytes()).hexdigest()
            if args.signal_variant == BROOKS_CONFIRMED_VARIANT else None
        ),
        "gap_runner_strategy_source_sha256": (
            hashlib.sha256(Path(__file__).with_name("gap_runner_strategy.py").read_bytes()).hexdigest()
            if args.signal_variant == GAP_RUNNER_VARIANT else None
        ),
        "structural_support_strategy_source_sha256": (
            hashlib.sha256(Path(__file__).with_name("structural_support_strategy.py").read_bytes()).hexdigest()
            if args.signal_variant in STRUCTURAL_SUPPORT_VARIANTS else None
        ),
        "broad_swing_signal_source_sha256": (
            hashlib.sha256(
                Path(__file__).with_name("broad_swing_signal.py").read_bytes(),
            ).hexdigest()
            if args.signal_variant in (
                BROAD_TIER_VARIANT, BROAD_LINE_CANCEL_VARIANT,
                BROOKS_CONFIRMED_VARIANT, GAP_RUNNER_VARIANT,
                *STRUCTURAL_SUPPORT_VARIANTS,
            )
            else None
        ),
        "runner_source_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        "strategy": (
            "H11-box-edge-staged-1r"
            if args.exit_variant == "staged-edge-1r"
            else "R-1s"
            if args.exit_variant == "staged-r1s"
            else "R-1u"
            if args.signal_variant == "daily-pivot"
            else "H12-daily-pivot-outer-4h"
            if args.signal_variant == "daily-pivot-outer-4h"
            else "H03-box-4h"
            if args.signal_variant == "box-4h"
            else "H10-box-edge-4h"
            if args.signal_variant == "box-edge-4h"
            else "H13c-support-confirmed-4h"
            if args.signal_variant == "support-confirmed-4h"
            else "H13f-support-rejection-4h"
            if args.signal_variant == "support-rejection-4h"
            else "H14a-support-near50-4h"
            if args.signal_variant == "support-near50-4h"
            else "H15a-support-three-tier-4h"
            if args.signal_variant == TIERED_VARIANT
            else "H18a-support-three-tier-line-cancel-4h"
            if args.signal_variant == LINE_CANCEL_TIER_VARIANT
            else "H16a-support-deep-two-tier-4h"
            if args.signal_variant == DEEP_TIER_VARIANT
            else "H19a-support-broad-two-tier-4h"
            if args.signal_variant == BROAD_TIER_VARIANT
            else "F01-11-support-broad-two-tier-line-cancel-4h"
            if args.signal_variant == BROAD_LINE_CANCEL_VARIANT
            else "H23a-support-brooks-confirmed-4h"
            if args.signal_variant == BROOKS_CONFIRMED_VARIANT
            else "H24a-support-broad-gap-runner-4h"
            if args.signal_variant == GAP_RUNNER_VARIANT
            else "H25a-support-broad-prior-a-support-4h"
            if args.signal_variant == STRUCTURAL_SUPPORT_VARIANT
            else "H26a-support-broad-any-prior-a-support-4h"
            if args.signal_variant == ANY_PRIOR_A_SUPPORT_VARIANT
            else "H27a-support-broad-any-prior-a-outside-stop-4h"
            if args.signal_variant == OUTSIDE_A_STOP_VARIANT
            else "H06-trendline-4h"
            if args.signal_variant == "trendline-4h"
            else "H08b-line-resting-4h"
            if args.signal_variant == "line-resting-4h"
            else "H08-line-support-4h"
        ),
        "signal_variant": args.signal_variant,
        "exit_variant": args.exit_variant,
        "integrity_findings": integrity_findings,
        "integrity_passed": not integrity_findings,
        "account_model": f"one native BacktestNode margin account, 100000 USDT, {len(rows)} strategies sharing portfolio capital",
        "starting_balance_usdt": "100000",
        "native_risk_submit_rate": REPLAY_SUBMIT_RATE,
        "sizing": (
            {
                "mode": "native_equity_stop_risk_with_notional_cap",
                "risk_budget_bps": args.risk_budget_bps,
                "coin_notional_cap_pct": args.coin_notional_cap_pct,
            }
            if args.risk_budget_bps is not None
            else {"mode": "fixed_registered_quantity"}
        ),
        "final_equity_usdt": str(final_equity),
        "net_change_usdt": str(final_equity - Decimal(100_000)),
        "period_return_pct": float((final_equity / Decimal(100_000) - 1) * 100),
        "annualized_return_pct": float(
            ((final_equity / Decimal(100_000)) ** (Decimal(365) / duration_days) - 1)
            * 100,
        ),
        "closed_trades": len(closed),
        "winning_trades": wins,
        "closed_trade_win_rate": wins / len(closed) if len(closed) else None,
        "win_rate_definition": "positive native closed-position realized_pnl including fill commissions and position funding adjustments",
        "denied_orders": int((orders["status"] == "DENIED").sum()),
        "rejected_orders": int((orders["status"] == "REJECTED").sum()),
        "native_sharpe_252": SharpeRatio(252).calculate_from_returns(
            eligible_returns,
        ),
        "native_sharpe_365": SharpeRatio(365).calculate_from_returns(
            eligible_returns,
        ),
        "native_max_drawdown_daily_close": MaxDrawdown().calculate_from_returns(
            eligible_returns,
        ),
        "stats_returns": result.stats_returns,
        "stats_pnls": result.stats_pnls,
        "stats_general": result.stats_general,
        "data_interval_minutes": 5,
        "input_start_utc": args.start,
        "period_start_utc": trade_start_dt.isoformat(),
        "period_end_utc": args.end,
        "per_coin": [
            {
                "coin": row["coin"],
                "instrument": str(row["instrument_id"]),
                "quantity": row["quantity"],
                "counts": row["counts"],
                "signals": strategies[row["coin"]].signals,
                "box_breaks": strategies[row["coin"]].box_breaks,
                "outer_context": (
                    {
                        "admitted": strategies[row["coin"]].outer_context_admitted,
                        "rejected": strategies[row["coin"]].outer_context_rejected,
                        "missing": strategies[row["coin"]].outer_context_missing,
                    }
                    if args.signal_variant == "daily-pivot-outer-4h"
                    else None
                ),
                "box_edge": (
                    {
                        "plans": strategies[row["coin"]].box_edge_plans,
                        "submitted_brackets": strategies[row["coin"]].waiting_released,
                        "invalid_price_skips": strategies[
                            row["coin"]
                        ].box_edge_invalid_price_skips,
                        "time_exits": strategies[row["coin"]].box_edge_time_exits,
                    }
                    if args.signal_variant == "box-edge-4h"
                    else None
                ),
                "support_pullback": (
                    {
                        "source_plans": strategies[row["coin"]].support_state.plans,
                        "submitted_brackets": strategies[row["coin"]].waiting_released,
                        "supersessions": strategies[
                            row["coin"]
                        ].retracement_supersessions,
                        "cancel_race_fills": strategies[
                            row["coin"]
                        ].retracement_cancel_race_fills,
                        "invalid_price_skips": strategies[
                            row["coin"]
                        ].retracement_invalid_price_skips,
                        "first_touch_reasons": strategies[
                            row["coin"]
                        ].first_touch_counts,
                        "actual_fill_protection_violations": strategies[
                            row["coin"]
                        ].retracement_actual_price_violations,
                    }
                    if args.signal_variant in RETRACEMENT_VARIANTS
                    else None
                ),
                "tiered_pullback": (
                    {
                        "source_plans": (
                            len(strategies[row["coin"]].broad_planned_pairs)
                            if args.signal_variant
                            in (
                                BROAD_TIER_VARIANT, BROAD_LINE_CANCEL_VARIANT,
                                BROOKS_CONFIRMED_VARIANT, GAP_RUNNER_VARIANT,
                                *STRUCTURAL_SUPPORT_VARIANTS,
                            )
                            else strategies[row["coin"]].support_state.plans
                        ),
                        "submitted_bundles": strategies[row["coin"]].bundle_submissions,
                        "retired_bundles": strategies[row["coin"]].bundle_retirements,
                        "supersessions": strategies[row["coin"]].bundle_supersessions,
                        "cancel_race_fills": strategies[
                            row["coin"]
                        ].bundle_cancel_race_fills,
                        "invalid_price_skips": strategies[
                            row["coin"]
                        ].bundle_invalid_price_skips,
                        "minimum_skips": strategies[row["coin"]].bundle_minimum_skips,
                        "order_failures": strategies[row["coin"]].bundle_order_failures,
                        "untouched_plan_voids": strategies[row["coin"]].waiting_voided,
                    }
                    if args.signal_variant in TIERED_VARIANTS
                    else None
                ),
                "entry_line_cancel": (
                    {
                        "frozen_valid_lines": strategies[row["coin"]].line_snapshots,
                        "line_break_events": strategies[row["coin"]].line_break_events,
                        "entry_cancel_requests": strategies[
                            row["coin"]
                        ].line_cancel_requests,
                        "fills_during_cancel": strategies[
                            row["coin"]
                        ].line_cancel_race_fills,
                    }
                    if args.signal_variant
                    in (LINE_CANCEL_TIER_VARIANT, BROAD_LINE_CANCEL_VARIANT)
                    else None
                ),
                "brooks_confirmation": (
                    {
                        "touched_watches": strategies[row["coin"]].watch_touches,
                        "invalidated_watches": strategies[row["coin"]].watch_invalidations,
                        "expired_watches": strategies[row["coin"]].watch_expiries,
                        "high2_signals": strategies[row["coin"]].high2_signals,
                        "strong_signals": strategies[row["coin"]].strong_signals,
                        "high2_brackets": strategies[row["coin"]].high2_submissions,
                        "strong_brackets": strategies[row["coin"]].strong_submissions,
                    }
                    if args.signal_variant == BROOKS_CONFIRMED_VARIANT else None
                ),
                "gap_runner": (
                    {
                        "b_target_fills": strategies[row["coin"]].b_target_fills,
                        "persistent_gap_decisions": strategies[row["coin"]].gap_persistent_decisions,
                        "no_gap_decisions": strategies[row["coin"]].no_gap_decisions,
                        "no_gap_market_exits": strategies[row["coin"]].no_gap_market_exits,
                        "early_runner_targets": strategies[row["coin"]].runner_targets_before_decision,
                        "minimum_share_skips": strategies[row["coin"]].runner_minimum_skips,
                        "max_submitted_stop_risk_fraction": strategies[row["coin"]].max_submitted_stop_risk_fraction,
                        "max_submitted_notional_fraction": strategies[row["coin"]].max_submitted_notional_fraction,
                    }
                    if args.signal_variant == GAP_RUNNER_VARIANT else None
                ),
                "structural_support": (
                    {
                        "accepted": strategies[row["coin"]].structural_accepted,
                        "rejected": strategies[row["coin"]].structural_rejected,
                        "decisions": strategies[row["coin"]].structural_state_decisions,
                    }
                    if args.signal_variant in STRUCTURAL_SUPPORT_VARIANTS else None
                ),
                "line_breaks": (
                    {
                        "first_crosses": strategies[
                            row["coin"]
                        ].line_state.first_crosses,
                        "weak_crosses": strategies[row["coin"]].line_state.weak_crosses,
                        "invalid_price_skips": strategies[
                            row["coin"]
                        ].line_invalid_price_skips,
                        "time_exits": strategies[row["coin"]].line_time_exits,
                    }
                    if args.signal_variant == "trendline-4h"
                    else None
                ),
                "line_support": (
                    {
                        "broken_pairs": strategies[row["coin"]].line_state.broken_pairs,
                        "touches": strategies[row["coin"]].line_state.touches,
                        "rejections": strategies[row["coin"]].line_state.rejections,
                        "room_skips": strategies[row["coin"]].line_state.room_skips,
                        "invalid_price_skips": strategies[
                            row["coin"]
                        ].line_invalid_price_skips,
                        "time_exits": strategies[row["coin"]].line_time_exits,
                    }
                    if args.signal_variant == "line-support-4h"
                    else None
                ),
                "line_resting": (
                    {
                        "broken_pairs": strategies[row["coin"]].line_state.broken_pairs,
                        "room_skips": strategies[row["coin"]].line_state.room_skips,
                        "invalid_price_skips": strategies[
                            row["coin"]
                        ].line_invalid_price_skips,
                        "time_exits": strategies[row["coin"]].line_time_exits,
                        "submitted_brackets": strategies[row["coin"]].waiting_released,
                    }
                    if args.signal_variant == "line-resting-4h"
                    else None
                ),
                "risk_size_skips": strategies[row["coin"]].risk_size_skips,
                "staged_execution": (
                    {
                        "missing_impulse": strategies[
                            row["coin"]
                        ].staged_missing_impulse,
                        "split_skips": strategies[row["coin"]].staged_split_skips,
                        "invalid_price_skips": strategies[
                            row["coin"]
                        ].staged_invalid_price_skips,
                        "invalid_notional_skips": strategies[
                            row["coin"]
                        ].staged_invalid_notional_skips,
                        "invalid_actual_target_closes": strategies[
                            row["coin"]
                        ].staged_invalid_actual_target_closes,
                        "unallocatable_closes": strategies[
                            row["coin"]
                        ].staged_unallocatable_closes,
                        "protection_failures": strategies[
                            row["coin"]
                        ].staged_protection_failures,
                        "order_failures": strategies[row["coin"]].staged_order_failures,
                        "same_bar_first_stop": strategies[
                            row["coin"]
                        ].staged_same_bar_first_stop,
                        "breakeven_unavailable": strategies[
                            row["coin"]
                        ].staged_breakeven_unavailable,
                        "stop_cancel_emergencies": strategies[
                            row["coin"]
                        ].staged_stop_cancel_emergencies,
                        "emergency_closes": strategies[
                            row["coin"]
                        ].staged_emergency_closes,
                    }
                    if args.exit_variant in STAGED_EXITS
                    else None
                ),
                "positions": sum(
                    positions["instrument_id"] == str(row["instrument_id"]),
                ),
            }
            for row in rows
        ],
        "limitations": [
            "Five-minute execution bars cannot resolve every intrabar order sequence",
            "Current contract terms approximate historical metadata",
            "Fixed 2026 coin universe is backcast into 2025",
            "Minute-sampled portfolio drawdown is not yet reported",
        ],
    }
    payload = json.dumps(_json_safe(summary), indent=2, allow_nan=False)
    (args.output / "summary.json").write_text(payload + "\n")
    print(payload)
    if integrity_findings:
        raise RuntimeError("; ".join(integrity_findings))


if __name__ == "__main__":
    main()
