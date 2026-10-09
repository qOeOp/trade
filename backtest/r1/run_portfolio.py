"""Replay prepared R1 instruments in one native Nautilus BacktestNode account."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
from datetime import UTC
from datetime import datetime
from datetime import timedelta
from decimal import Decimal
from pathlib import Path

from nautilus_trader.analysis import MaxDrawdown
from nautilus_trader.analysis import SharpeRatio
from nautilus_trader.model import ClientOrderId
from nautilus_trader.model import Venue
from backtest.r1.native_node import ACCOUNT_CONTRACT, run_native_node
from backtest.r1.replay_util import _json_safe, _ns, _snapshot_equity_usdt
from backtest.r1.replay_inputs import read_instruments as _read_instruments
from backtest.r1.strategy_loader import RUNTIME_CONTRACT, LoadedStrategy, load_strategy, _read_regular_file


REPLAY_SUBMIT_RATE = ACCOUNT_CONTRACT["max_order_submit_rate"]


RUNTIME_SOURCE_PATHS = {
    "runner_source_sha256": "backtest/r1/run_portfolio.py",
    "native_node_source_sha256": "backtest/r1/native_node.py",
    "node_strategy_source_sha256": "backtest/r1/node_strategy.py",
    "replay_inputs_source_sha256": "backtest/r1/replay_inputs.py",
    "replay_util_source_sha256": "backtest/r1/replay_util.py",
    "strategy_loader_source_sha256": "backtest/r1/strategy_loader.py",
}


def runtime_source_metadata() -> dict:
    """Inspect runtime bytes independently of an external strategy revision."""
    root = Path(__file__).resolve().parents[2]
    return {
        **{
            field: hashlib.sha256((root / path).read_bytes()).hexdigest()
            for field, path in RUNTIME_SOURCE_PATHS.items()
        },
        "source_file_paths": RUNTIME_SOURCE_PATHS.copy(),
    }


def _source_metadata(strategy: LoadedStrategy) -> dict:
    """Bind executed strategy bytes and current runtime code independently."""
    return {**strategy.metadata(), **runtime_source_metadata()}


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


def build_parser() -> argparse.ArgumentParser:
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
    parser.add_argument("--strategy-file", type=Path, required=True)
    parser.add_argument("--strategy-class", required=True)
    parser.add_argument("--strategy-sha256", required=True)
    parser.add_argument("--strategy-binding", type=Path)
    parser.add_argument("--execution-binding", type=Path)
    parser.add_argument("--signal-variant", required=True)
    parser.add_argument("--exit-variant", required=True)
    parser.add_argument("--risk-budget-bps", type=float)
    parser.add_argument("--coin-notional-cap-pct", type=float, default=5.0)
    parser.add_argument("--daily-warmup", action="store_true")
    return parser


def parse_configuration(argv: list[str] | None = None):
    """Resolve runner defaults without executing source or opening research data."""
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.risk_budget_bps is not None and (
        not math.isfinite(args.risk_budget_bps) or not 0 < args.risk_budget_bps < 10_000
    ):
        parser.error("risk budget must be finite and between 0 and 10000 bps")
    if not math.isfinite(args.coin_notional_cap_pct) or not 0 < args.coin_notional_cap_pct <= 100:
        parser.error("coin notional cap must be finite and between 0 and 100 percent")
    return args


def effective_configuration(args) -> dict:
    """Canonical experiment configuration, including native execution defaults."""
    return {
        "runtime_contract": RUNTIME_CONTRACT,
        "catalog_root": str(args.catalog_root),
        "daily_root": str(args.daily_root),
        "quantity_csv": str(args.quantity_csv),
        "mark_root": str(args.mark_root) if args.mark_root is not None else None,
        "coins": args.coins,
        "start": args.start,
        "end": args.end,
        "trade_start": args.trade_start if args.trade_start is not None else args.start,
        "signal_variant": args.signal_variant,
        "exit_variant": args.exit_variant,
        "risk_budget_bps": args.risk_budget_bps,
        "coin_notional_cap_pct": args.coin_notional_cap_pct,
        "daily_warmup": args.daily_warmup,
        "native_account": ACCOUNT_CONTRACT.copy(),
    }


def validate_strategy_configuration(strategy: LoadedStrategy, args) -> None:
    """Let the complete source own its selected rules and sizing contract."""
    cls = strategy.strategy_class
    for name in ("validate_replay_configuration", "replay_diagnostics", "replay_integrity_findings"):
        if not callable(getattr(cls, name, None)):
            raise ValueError(f"{RUNTIME_CONTRACT} strategy requires {name}")
    cls.validate_replay_configuration(effective_configuration(args))


def _diagnostics(strategy) -> dict:
    value = strategy.replay_diagnostics()
    reserved = {"coin", "instrument", "quantity", "counts", "positions"}
    if not isinstance(value, dict) or reserved.intersection(value):
        raise ValueError("strategy diagnostics must not replace native report facts")
    return value


def _execution_metadata(args) -> dict:
    if args.execution_binding is None:
        return {}
    try:
        binding = json.loads(_read_regular_file(args.execution_binding))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError("execution binding is not valid JSON") from error
    if not isinstance(binding, dict) or set(binding) != {
        "runtime_identity", "effective_config", "effective_config_sha256",
    }:
        raise ValueError("execution binding must contain runtime and effective configuration")
    effective = effective_configuration(args)
    encoded = json.dumps(effective, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode()
    digest = hashlib.sha256(encoded).hexdigest()
    if binding["effective_config"] != effective or binding["effective_config_sha256"] != digest:
        raise ValueError("execution binding differs from actual resolved runner configuration")
    identity = binding["runtime_identity"]
    if not isinstance(identity, dict) or identity.get("runtime_contract") != RUNTIME_CONTRACT:
        raise ValueError("execution binding runtime contract is unsupported")
    return {"runtime_identity": identity, "effective_config_sha256": digest}


def main() -> None:  # noqa: C901 - CLI coordinates one shared-account replay lifecycle.
    args = parse_configuration()
    execution_metadata = _execution_metadata(args)
    strategy = load_strategy(
        args.strategy_file, args.strategy_class, args.strategy_sha256, args.strategy_binding,
    )
    validate_strategy_configuration(strategy, args)
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
    engine, strategies = run_native_node(
        rows,
        args,
        start_dt,
        end_dt,
        trade_start,
        strategy,
    )
    for row in rows:
        if row["counts"] != row["completion"].get("counts"):
            raise RuntimeError(
                f"{row['coin']}: streamed totals do not match download receipt",
            )
    integrity_findings = []
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
    denied_or_rejected = bool(orders["status"].isin(("DENIED", "REJECTED")).any())
    for native_strategy in strategies.values():
        findings = native_strategy.replay_integrity_findings(denied_or_rejected)
        if not isinstance(findings, list) or any(not isinstance(item, str) or not item for item in findings):
            raise ValueError("strategy integrity findings must be nonempty strings")
        for finding in findings:
            if finding not in integrity_findings:
                integrity_findings.append(finding)
    if denied_or_rejected and not integrity_findings:
        integrity_findings.append("native orders were denied or rejected")
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
        **_source_metadata(strategy),
        **execution_metadata,
        "strategy": strategy.binding["strategy_id"] if strategy.binding else strategy.entry_class,
        "signal_variant": args.signal_variant,
        "exit_variant": args.exit_variant,
        "integrity_findings": integrity_findings,
        "integrity_passed": not integrity_findings,
        "account_model": f"one native BacktestNode margin account, 100000 USDT, {len(rows)} strategies sharing portfolio capital",
        "starting_balance_usdt": ACCOUNT_CONTRACT["starting_balance_usdt"],
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
                **_diagnostics(strategies[row["coin"]]),
                "positions": sum(positions["instrument_id"] == str(row["instrument_id"])),
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
