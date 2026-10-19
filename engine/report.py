"""Write one finished replay's native reports, order events, exposures and summary."""

from __future__ import annotations

import csv
import gzip
import hashlib
import io
import json
import math
from datetime import timedelta
from decimal import Decimal
from pathlib import Path

from nautilus_trader.analysis import MaxDrawdown
from nautilus_trader.analysis import SharpeRatio
from nautilus_trader.model import ClientOrderId
from nautilus_trader.model import Venue


ROOT = Path(__file__).resolve().parents[1]
RUNTIME_SOURCE_PATHS = {
    "config_source_sha256": "engine/config.py",
    "runner_source_sha256": "engine/run.py",
    "load_source_sha256": "engine/load.py",
    "report_source_sha256": "engine/report.py",
    "fingerprint_source_sha256": "engine/compare.py",
}
AUDIT_PATH = "engine/audit.py"
EXPOSURE_COLUMNS = ("ts_event_ns", "position_id", "notional_value", "unrealized_pnl")
ORDER_EVENTS = "order_events.jsonl.gz"


def runtime_source_metadata() -> dict:
    """Inspect runtime bytes independently of an external strategy revision."""
    return {
        **{
            field: hashlib.sha256((ROOT / path).read_bytes()).hexdigest()
            for field, path in RUNTIME_SOURCE_PATHS.items()
        },
        "source_file_paths": RUNTIME_SOURCE_PATHS.copy(),
    }


def json_safe(value):
    if isinstance(value, dict):
        return {key: json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_safe(item) for item in value]
    if isinstance(value, float) and not math.isfinite(value):
        return None
    return value


def snapshot_equity_usdt(snapshot) -> Decimal:
    if snapshot is None or snapshot.is_stale or snapshot.unpriced_instruments:
        raise RuntimeError("native portfolio equity snapshot is missing or stale")
    equity = snapshot.base_currency_equity
    if equity is None or equity.currency.code != "USDT":
        raise RuntimeError("native portfolio snapshot lacks USDT base equity")
    return equity.as_decimal()


def orders_with_native_deadlines(cache, report):
    """Export optional GTD nanoseconds from native Orders without float coercion."""
    result = report.copy()
    deadlines = []
    for order_id in report.index:
        order = cache.order(ClientOrderId.from_str(str(order_id)))
        if order is None:
            raise RuntimeError("native order missing during GTD deadline export")
        deadline = getattr(order, "expire_time", None)
        if str(order.time_in_force) == "GTD" and deadline is None:
            raise RuntimeError("native GTD order has no deadline")
        deadlines.append(str(deadline) if deadline is not None else "")
    result["expire_time_ns"] = deadlines
    return result


def readable_empty_report(report, columns):
    """Give a zero-row native report the headers its consumers already use."""
    if not report.empty:
        return report
    return report.reindex(columns=list(dict.fromkeys([*report.columns, *columns])))


def write_exposures(rows, path: Path) -> None:
    """Write the observed open-position valuations as gzip CSV with a fixed header time."""
    with path.open("wb") as raw, gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0) as packed, \
            io.TextIOWrapper(packed, encoding="utf-8", newline="") as text:
        writer = csv.writer(text)
        writer.writerow(EXPOSURE_COLUMNS)
        writer.writerows(rows)


def write_order_events(orders, path: Path) -> None:
    """Write every cached order's unchanged native events as gzip JSON lines, grouped by order ID.

    Only the order of one order's events is causal; the order across orders is a deterministic
    grouping, not the engine's processing order.
    """
    with path.open("wb") as raw, gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0) as packed, \
            io.TextIOWrapper(packed, encoding="utf-8", newline="\n") as text:
        for order in sorted(orders, key=lambda value: str(value.client_order_id)):
            for event in order.events():
                text.write(json.dumps(event.to_dict(), ensure_ascii=False, sort_keys=True,
                                      separators=(",", ":"), allow_nan=False) + "\n")


def capital_findings(observer, expected_timestamps: int) -> list[str]:
    """The observation valued every input timestamp and every open position in it."""
    findings = list(dict.fromkeys(observer.findings))
    if observer.timestamps != expected_timestamps:
        findings.append(f"capital observation valued {observer.timestamps} of {expected_timestamps} input timestamps")
    return findings


def diagnostics(strategy) -> dict:
    value = strategy.replay_diagnostics()
    reserved = {"coin", "instrument", "quantity", "counts", "positions"}
    if not isinstance(value, dict) or reserved.intersection(value):
        raise ValueError("strategy diagnostics must not replace native report facts")
    return value


def write(output: Path, replay, strategies: dict, rows: list[dict], identity: dict, window: dict,
          account: dict, expected_timestamps: int) -> tuple[dict, list[str]]:
    """Write the native reports and summary; return the summary and its integrity findings.

    ``replay`` exposes the Node's reports, cache, portfolio, result and capital observer;
    ``identity`` is the strategy and runtime identity the summary carries.
    """
    trade_start_dt, end_dt = window["trade_start_dt"], window["end_dt"]
    trade_start = window["trade_start_ns"]
    starting_balance = Decimal(account["starting_balance_usdt"])
    integrity_findings = []
    native_account = replay.portfolio.account(venue=Venue(account["venue"]))
    if native_account is None:
        raise RuntimeError("native portfolio account missing")
    final_equity = snapshot_equity_usdt(replay.portfolio.build_snapshot(native_account.id))
    result = replay.result
    output.mkdir(parents=True, exist_ok=True)
    reports = {
        "orders.csv": orders_with_native_deadlines(
            replay.cache, readable_empty_report(replay.orders(), ("status",))
        ),
        "fills.csv": readable_empty_report(replay.fills(), ("client_order_id",)),
        "positions.csv": readable_empty_report(
            replay.positions(), ("ts_closed", "realized_pnl", "instrument_id")
        ),
        "account.csv": replay.account(Venue(account["venue"])),
    }
    for name, report in reports.items():
        report.to_csv(
            output / name,
            index=True,
            index_label="ts_event" if name == "account.csv" else None,
        )
    with (output / "returns_series.csv").open("w", newline="") as stream:
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
    write_exposures(replay.observer.rows, output / "exposures.csv.gz")
    write_order_events(replay.cache.orders(), output / ORDER_EVENTS)
    for finding in capital_findings(replay.observer, expected_timestamps):
        if finding not in integrity_findings:
            integrity_findings.append(finding)
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
        **identity,
        "integrity_findings": integrity_findings,
        "integrity_passed": not integrity_findings,
        "account_model": f"one native BacktestNode margin account, 100000 USDT, {len(rows)} strategies sharing portfolio capital",
        "starting_balance_usdt": account["starting_balance_usdt"],
        "native_risk_submit_rate": account["max_order_submit_rate"],
        "sizing": {"mode": "strategy_source"},
        "final_equity_usdt": str(final_equity),
        "net_change_usdt": str(final_equity - starting_balance),
        "period_return_pct": float((final_equity / starting_balance - 1) * 100),
        "annualized_return_pct": float(
            ((final_equity / starting_balance) ** (Decimal(365) / duration_days) - 1)
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
        "data_interval_minutes": 5,
        "input_start_utc": window["start"],
        "period_start_utc": trade_start_dt.isoformat(),
        "period_end_utc": window["end"],
        "per_coin": [
            {
                "coin": row["coin"],
                "instrument": str(row["instrument_id"]),
                "counts": row["counts"],
                **diagnostics(strategies[row["coin"]]),
                "positions": sum(positions["instrument_id"] == str(row["instrument_id"])),
            }
            for row in rows
        ],
        "limitations": [
            "Five-minute execution bars cannot resolve every intrabar order sequence",
            "Current contract terms approximate historical metadata",
            "Contracts are the ones passed in; pool membership is an input the strategy applies, not a runner rule",
            "Open-position valuation is sampled after each five-minute bar close; intrabar exposure and drawdown are not observed",
        ],
    }
    payload = json.dumps(json_safe(summary), indent=2, allow_nan=False)
    (output / "summary.json").write_text(payload + "\n")
    print(payload)
    return summary, integrity_findings
