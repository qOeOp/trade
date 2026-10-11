"""Synthetic native reports that reconcile, with one tagged trade plan per position cycle.

Daily bars; every plan opens at 01:00 and closes at 02:00 UTC on its own day, so no position is
open at a bar label and the exposure report is empty. Plans alternate between two instruments.
"""

from __future__ import annotations

import csv
from datetime import UTC, datetime, timedelta
from decimal import Decimal
import gzip
import io
import json
from pathlib import Path


INSTRUMENTS = ("AAAUSDT-PERP.BINANCE", "BBBUSDT-PERP.BINANCE")
START = datetime(2026, 1, 1, tzinfo=UTC)


def _ns(moment: datetime) -> int:
    return int((moment - datetime(1970, 1, 1, tzinfo=UTC)).total_seconds()) * 1_000_000_000


def _csv(columns, rows) -> str:
    stream = io.StringIO()
    writer = csv.writer(stream, lineterminator="\n")
    writer.writerow(columns)
    writer.writerows(rows)
    return stream.getvalue()


def write(directory: Path, *, plans: int = 120, wins: int = 90, win_pnl: str = "30", loss_pnl: str = "-20",
          start: datetime = START, trade_days: int | None = None) -> dict:
    """Write report files into `directory`; returns the window and the expected readings."""
    directory.mkdir(parents=True, exist_ok=True)
    days = trade_days or plans + 2
    trade_start, end = start + timedelta(days=1), start + timedelta(days=1 + days)
    orders, fills, positions, account = [], [], [], [["ts_event", "total"]]
    balance = Decimal(100000)
    account.append([start.strftime("%Y-%m-%d %H:%M:%S+00:00"), str(balance)])
    for index in range(plans):
        day = trade_start + timedelta(days=index)
        opened, closed = day + timedelta(hours=1), day + timedelta(hours=2)
        instrument, plan = INSTRUMENTS[index % 2], f"P{index}"
        pnl = Decimal(win_pnl if index < wins else loss_pnl)
        entry, exit_ = f"O-{index}-E", f"O-{index}-X"
        exit_px = Decimal(100) + pnl
        for client, side, price, moment in ((entry, "BUY", Decimal(100), opened), (exit_, "SELL", exit_px, closed)):
            orders.append([client, instrument, side, "MARKET", "FILLED", "1", "1", repr([f"plan:{plan}"]),
                           _ns(moment), _ns(moment)])
            fills.append([f"F-{client}", client, instrument, side, "1", str(price), "0 USDT", "TAKER",
                          moment.strftime("%Y-%m-%d %H:%M:%S.%f+00:00"), f"{instrument}-{plan}"])
        events = [{"event_id": f"F-{entry}", "order_side": "BUY", "last_qty": "1", "last_px": "100",
                   "commission": "0 USDT", "ts_event": _ns(opened)},
                  {"event_id": f"F-{exit_}", "order_side": "SELL", "last_qty": "1", "last_px": str(exit_px),
                   "commission": "0 USDT", "ts_event": _ns(closed)}]
        positions.append([f"{instrument}-{plan}", instrument, "1", "False", closed.isoformat(), f"{pnl} USDT",
                          repr(["0 USDT", "0 USDT"]), "[]", repr(events), _ns(closed), exit_, "False"])
        balance += pnl
        account.append([closed.strftime("%Y-%m-%d %H:%M:%S+00:00"), str(balance)])
    duration = Decimal((end - trade_start) / timedelta(days=1))
    growth = balance / Decimal(100000)
    annual = float((growth ** (Decimal(365) / duration) - 1) * 100)
    (directory / "orders.csv").write_text(_csv(
        ["client_order_id", "instrument_id", "side", "type", "status", "quantity", "filled_qty", "tags", "ts_init",
         "ts_last"], orders))
    (directory / "fills.csv").write_text(_csv(
        ["event_id", "client_order_id", "instrument_id", "order_side", "last_qty", "last_px", "commission",
         "liquidity_side", "ts_event", "position_id"], fills))
    (directory / "positions.csv").write_text(_csv(
        ["position_id", "instrument_id", "multiplier", "is_inverse", "ts_closed", "realized_pnl", "commissions",
         "adjustments", "events", "ts_last", "closing_order_id", "is_snapshot"], positions))
    (directory / "account.csv").write_text(_csv(account[0], account[1:]))
    (directory / "returns_series.csv").write_text(_csv(["ts_event_ns", "native_return"],
                                                       [[_ns(end - timedelta(days=1)), repr(float(growth - 1))]]))
    (directory / "exposures.csv.gz").write_bytes(gzip.compress(
        b"ts_event_ns,position_id,notional_value,unrealized_pnl\n", mtime=0))
    realized = balance - Decimal(100000)
    summary = {"input_start_utc": start.isoformat(), "period_start_utc": trade_start.isoformat(),
               "period_end_utc": end.isoformat(), "data_interval_minutes": 1440, "starting_balance_usdt": "100000",
               "final_equity_usdt": str(balance), "annualized_return_pct": annual, "closed_trades": plans,
               "integrity_passed": True, "limitations": ["synthetic fixture"]}
    audit = {"passed": True, "findings": [], "coverage_limits": [],
             "native_economics": {"starting_balance_usdt": "100000", "final_balance_usdt": str(balance),
                                  "reported_realized_pnl_usdt": str(realized), "fill_commissions_usdt": "0",
                                  "funding_adjustments": 0, "reported_funding_usdt": "0"}}
    (directory / "summary.json").write_text(json.dumps(summary))
    (directory / "audit.json").write_text(json.dumps(audit))
    return {"start": start.isoformat().replace("+00:00", "Z"), "trade_start": trade_start.isoformat().replace("+00:00", "Z"),
            "end": end.isoformat().replace("+00:00", "Z"), "plans": plans, "wins": wins, "annual_return": annual / 100}
