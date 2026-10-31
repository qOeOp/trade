"""Write one finished replay's native reports, order events and summary with its statistics
(engine.write_native_reports, engine.write_order_events, engine.summary_statistics); the capital
observer streams the exposure table through ExposureWriter."""

from __future__ import annotations

import csv
import gzip
import io
import json
import math
from collections.abc import Iterable, Mapping
from decimal import Decimal
from pathlib import Path

from nautilus_trader.analysis import SharpeRatio
from nautilus_trader.model import ClientOrderId
from nautilus_trader.model import Venue

from engine.config import EXECUTION_BAR_MINUTES, AccountContract, Refusal, Window, utc_text
from engine.load import diagnostics


DAY_NS = 86_400 * 10**9
EXPOSURE_COLUMNS = ("ts_event_ns", "position_id", "notional_value", "unrealized_pnl", "realized_pnl")
EXPOSURES = "exposures.csv.gz"
ORDER_EVENTS = "order_events.jsonl.gz"
FILL_VOLUMES = "fill_volumes.csv"
FILL_VOLUME_COLUMNS = ("event_id", "instrument_id", "ts_event_ns", "bar_ts_open_ns", "bar_volume")
MINUTE_NS = 60 * 10**9
LIFECYCLE_COUNTS = ("instrument_close", "instrument_status")


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
        raise Refusal("EQUITY_SNAPSHOT_UNAVAILABLE", "native portfolio equity snapshot is missing or stale")
    equity = snapshot.base_currency_equity
    if equity is None or equity.currency.code != "USDT":
        raise Refusal("EQUITY_SNAPSHOT_UNAVAILABLE", "native portfolio snapshot lacks USDT base equity")
    return equity.as_decimal()


def orders_with_native_deadlines(cache, report):
    """Export optional GTD nanoseconds from native Orders without float coercion."""
    result = report.copy()
    deadlines = []
    for order_id in report.index:
        order = cache.order(ClientOrderId.from_str(str(order_id)))
        if order is None:
            raise Refusal("GTD_DEADLINE_MISSING", f"native order {order_id} missing during GTD deadline export")
        deadline = getattr(order, "expire_time", None)
        if str(order.time_in_force) == "GTD" and deadline is None:
            raise Refusal("GTD_DEADLINE_MISSING", f"native GTD order {order_id} has no deadline")
        deadlines.append(str(deadline) if deadline is not None else "")
    result["expire_time_ns"] = deadlines
    return result


def readable_empty_report(report, columns):
    """Give a zero-row native report the headers its consumers already use."""
    if not report.empty:
        return report
    return report.reindex(columns=list(dict.fromkeys([*report.columns, *columns])))


class ExposureWriter:
    """The exposure table as gzip CSV with a fixed header time, written row by row as the observer values."""

    def __init__(self, path: Path):
        self._raw = path.open("wb")
        self._packed = gzip.GzipFile(filename="", mode="wb", fileobj=self._raw, mtime=0)
        self._text = io.TextIOWrapper(self._packed, encoding="utf-8", newline="")
        self._writer = csv.writer(self._text)
        self._writer.writerow(EXPOSURE_COLUMNS)

    def write(self, row) -> None:
        self._writer.writerow(row)

    def close(self) -> None:
        if not self._raw.closed:
            self._text.close()
            self._packed.close()
            self._raw.close()


def write_order_events(orders: Iterable, path: Path) -> None:
    """engine.write_order_events: every cached order's unchanged native events as gzip JSON lines,
    grouped by order ID.

    Only the order of one order's events is causal; the order across orders is a deterministic
    grouping, not the engine's processing order.
    """
    with path.open("wb") as raw, gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0) as packed, \
            io.TextIOWrapper(packed, encoding="utf-8", newline="\n") as text:
        for order in sorted(orders, key=lambda value: str(value.client_order_id)):
            events = order.events()
            if not events:
                raise Refusal("ORDER_WITHOUT_EVENTS", f"native order {order.client_order_id} has no event")
            for event in events:
                try:
                    line = json.dumps(event.to_dict(), ensure_ascii=False, sort_keys=True, separators=(",", ":"),
                                      allow_nan=False)
                except ValueError as exc:
                    raise Refusal("NON_FINITE_EVENT_FIELD", f"an event of native order {order.client_order_id} "
                                                            f"holds NaN or infinity: {exc}") from exc
                text.write(line + "\n")


def write_fill_volumes(orders: Iterable, instruments: list[dict], path: Path) -> None:
    """engine.write_fill_volumes: every native fill with the LAST volume of the one-minute execution bar of
    its minute (its time floored to the minute; the bar is keyed by that open, stamped at its close), read
    from the exported Catalogs; a minute without a bar has an empty volume. The ledger seals the fills'
    share of their minute's volume from it."""
    import pyarrow as pa
    import pyarrow.compute as compute
    import pyarrow.parquet as parquet
    fills = sorted(((event.ts_event, str(order.client_order_id), index, event) for order in orders
                    for index, event in enumerate(order.events()) if type(event).__name__ == "OrderFilled"),
                   key=lambda item: item[:3])
    wanted: dict[str, set[int]] = {}
    for ts, _, _, event in fills:
        wanted.setdefault(str(event.instrument_id), set()).add(ts - ts % MINUTE_NS)
    volumes: dict[tuple[str, int], str] = {}
    for row in instruments:
        instrument = str(row["instrument_id"])
        minutes = wanted.get(instrument)
        if not minutes:
            continue
        closes = pa.array([opened - 1_000_000 + EXECUTION_BAR_MINUTES * MINUTE_NS for opened in minutes], pa.int64())
        root = Path(row["catalog_path"]) / "data" / "bars" / f"{instrument}-{EXECUTION_BAR_MINUTES}-MINUTE-LAST-EXTERNAL"
        for file in sorted(root.glob("*.parquet")):
            table = parquet.read_table(file, columns=["ts_event", "volume"])
            stamps = table["ts_event"].cast(pa.int64())
            held = table.filter(compute.is_in(stamps, value_set=closes))
            for close, volume in zip(held["ts_event"].cast(pa.int64()).to_pylist(), held["volume"].to_pylist(),
                                     strict=True):
                opened = close + 1_000_000 - EXECUTION_BAR_MINUTES * MINUTE_NS
                volumes[instrument, opened] = format(volume.normalize(), "f")
    with path.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.writer(stream)
        writer.writerow(FILL_VOLUME_COLUMNS)
        for ts, _, _, event in fills:
            instrument, opened = str(event.instrument_id), ts - ts % MINUTE_NS
            writer.writerow((str(event.event_id), instrument, ts, opened, volumes.get((instrument, opened), "")))


def summary_statistics(returns_series: dict[int, float], trade_start_ns: int, end_ns: int,
                       starting_balance: Decimal, final_equity: Decimal) -> dict:
    """engine.summary_statistics: the trading window's return and annual return (final equity over the
    starting balance, annualized over the window's exact length in days) and the native 365-day Sharpe
    ratio of its daily returns, the warm-up left out. Drawdown and win rate are the ledger's, from the
    native reports; a figure that cannot be computed is null with its reason in statistics_notes."""
    if end_ns <= trade_start_ns:
        raise Refusal("TRADING_WINDOW_EMPTY", f"the trading window [{trade_start_ns}, {end_ns}) is empty")
    if starting_balance <= 0:
        raise Refusal("STARTING_BALANCE_NOT_POSITIVE", f"the starting balance is {starting_balance}")
    window_days = Decimal(end_ns - trade_start_ns) / Decimal(DAY_NS)
    trading = {ts: value for ts, value in returns_series.items() if trade_start_ns <= ts < end_ns}
    notes = []
    period_return = annual_return = None
    if final_equity > 0:
        ratio = final_equity / starting_balance
        period_return = str(ratio - 1)
        annual_return = str(ratio ** (Decimal(365) / window_days) - 1)
    else:
        notes.append(f"period_return and annual_return: the final equity {final_equity} USDT is not positive")
    sharpe = SharpeRatio(365).calculate_from_returns(trading)
    if not isinstance(sharpe, (int, float)) or not math.isfinite(sharpe):
        notes.append(f"sharpe_365: the native SharpeRatio of {len(trading)} daily returns is {sharpe!r}")
        sharpe = None
    return {
        "period_start_utc": utc_text(trade_start_ns),
        "period_end_utc": utc_text(end_ns),
        "trading_window_days": str(window_days),
        "trading_day_count": len(trading),
        "starting_balance_usdt": str(starting_balance),
        "final_equity_usdt": str(final_equity),
        "net_change_usdt": str(final_equity - starting_balance),
        "period_return": period_return,
        "annual_return": annual_return,
        "sharpe_365": float(sharpe) if sharpe is not None else None,
        "statistics_notes": notes,
    }


def fixed_limitations(account: Mapping) -> list[str]:
    """engine.fixed_limitations: the environment's standing limitations by execution mode (the account contract
    names the mode and, for quotes, the margin rates)."""
    if account["execution"] == "quotes":
        initial, maintenance = account["initial_margin_rate"], account["maintenance_margin_rate"]
        execution = ("Quotes drive matching: an order fills whole at the best bid or ask in force, one QuoteTick per "
                     "stored quote state and no depth, so a fill never moves the price; the quotes are inferred from "
                     "aggTrades by the import rule, a declared approximation of the exchange's book, not its record")
        liquidation = (f"Liquidation follows the venue's model: positions are valued at the quotes, the maintenance "
                       f"margin is the declared rate ({maintenance}; initial {initial}) on the entry notional and is "
                       f"not re-marked, and a liquidation closes the whole position at the quote in force with no "
                       f"latency; the rates are declared values, not Binance's tiers")
    else:
        execution = ("One-minute execution bars cannot resolve every intrabar order sequence; a resting limit fills "
                     "only when a bar trades through its price, the bar extreme nearer the open is visited first, and "
                     "stops trigger on the bar's traded prices")
        liquidation = "Liquidation is not modelled"
    return [
        execution,
        "Current contract terms approximate historical metadata; fees and margins are assumed values",
        "Contracts are the ones passed in; universe membership is an input the strategy applies, not a runner rule",
        "Open-position valuation is sampled after each one-minute bar close; intrabar exposure and drawdown are "
        "not observed",
        liquidation,
    ]


def write_native_reports(output: Path, replay, strategies: dict, instruments: list[dict], identity: dict,
                         window: Window, account: AccountContract, limitations: list[str],
                         expected_timestamps: int) -> tuple[dict, list[str]]:
    """engine.write_native_reports: write the native reports, order events and summary; return the summary
    and its integrity findings.

    ``replay`` exposes the engine's reports, cache, portfolio, result and capital observer (which
    already wrote the exposure table); ``strategies`` holds each contract's instance by coin (None for a
    contract whose lifecycle misses the window); ``instruments`` are engine.read_market's rows;
    ``identity`` is the strategy and runtime identity the summary carries.
    """
    from engine.run import capital_findings  # engine.run imports this module
    starting_balance = Decimal(account["starting_balance_usdt"])
    integrity_findings = []
    native_account = replay.portfolio.account(venue=Venue(account["venue"]))
    if native_account is None:
        raise Refusal("NATIVE_ACCOUNT_MISSING", "native portfolio account missing")
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
        if native_strategy is None:
            continue
        findings = native_strategy.replay_integrity_findings(denied_or_rejected)
        if not isinstance(findings, list) or any(not isinstance(item, str) or not item for item in findings):
            raise Refusal("SELF_CHECK_FINDINGS_INVALID", "strategy integrity findings must be nonempty strings")
        for finding in findings:
            coded = f"SELF_CHECK_FINDING: {finding}"
            if coded not in integrity_findings:
                integrity_findings.append(coded)
    if denied_or_rejected:
        integrity_findings.insert(0, "ORDERS_DENIED_OR_REJECTED: the orders report holds DENIED or REJECTED orders")
    write_order_events(replay.cache.orders(), output / ORDER_EVENTS)
    write_fill_volumes(replay.cache.orders(), instruments, output / FILL_VOLUMES)
    for finding in capital_findings(replay.observer, expected_timestamps):
        if finding not in integrity_findings:
            integrity_findings.append(finding)
    closed = positions[positions["ts_closed"].notna()]
    pnl = (
        closed["realized_pnl"].astype(str).str.extract(r"(-?[0-9.]+)")[0].astype(float)
    )
    wins = int((pnl > 0).sum())
    statistics = summary_statistics(result.returns_series, window.trade_start_ns, window.end_ns, starting_balance,
                                    final_equity)
    summary = {
        **identity,
        "integrity_findings": integrity_findings,
        "integrity_passed": not integrity_findings,
        "account_model": f"one native BacktestEngine margin account, 100000 USDT, {len(instruments)} strategies sharing portfolio capital",
        "execution": account["execution"],  # bars | quotes, the environment of the effective configuration
        "native_risk_submit_rate": account["max_order_submit_rate"],
        "sizing": {"mode": "strategy_source"},
        **statistics,
        "closed_trades": len(closed),
        "winning_trades": wins,
        "denied_orders": int((orders["status"] == "DENIED").sum()),
        "rejected_orders": int((orders["status"] == "REJECTED").sum()),
        "data_interval_minutes": EXECUTION_BAR_MINUTES,  # the execution bar, under the name the ledger reads
        "input_start_utc": window.start,
        "trade_start_by_strategy": replay.trade_start_by_strategy,
        "per_coin": [
            {
                "coin": row["coin"],
                "instrument": str(row["instrument_id"]),
                "counts": {**{key: value for key, value in row["counts"].items() if key not in LIFECYCLE_COUNTS},
                           **replay.observer.lifecycle.get(str(row["instrument_id"]), {})},
                **(diagnostics(strategies[row["coin"]]) if strategies[row["coin"]] is not None else {}),
                "positions": sum(positions["instrument_id"] == str(row["instrument_id"])),
            }
            for row in instruments
        ],
        "limitations": [
            *fixed_limitations(account),
            *(["Trade ticks are signal input only: one TradeTick per stored aggregate trade, delivered as custom "
               "data the venue never sees, so it never matches an order or moves the book; a millisecond's trades "
               "follow its quotes, so their order within it is approximate"]
              if any("trade" in row["counts"] for row in instruments) else []),
            *(["Metrics are signal input only: one row of Binance open interest and long/short ratios per five "
               "minutes, delivered as custom data 8 minutes after the archive's create_time and describing the "
               "instant 5 minutes after it; a ratio the archive left empty is None"]
              if any("metrics" in row["counts"] for row in instruments) else []),
            *([f"Positions on a contract without a MARK at a bar were valued at its latest MARK, at most 60 "
               f"minutes old ({len(replay.observer.carried)} intervals in mark_carry)"]
              if getattr(replay.observer, "carried", None) else []),
            *dict.fromkeys(limitations),
        ],
        "mark_carry": list(getattr(replay.observer, "carried", None) or []),
    }
    payload = json.dumps(json_safe(summary), indent=2, allow_nan=False)
    (output / "summary.json").write_text(payload + "\n")  # not echoed to stdout: the capture keeps it once
    return summary, integrity_findings
