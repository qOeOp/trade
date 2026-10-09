"""Reconstruct original-stop commitments from frozen native H19a orders and Positions."""

from __future__ import annotations

import argparse
import ast
import csv
import gzip
import hashlib
import json
from collections import defaultdict
from decimal import Decimal
from pathlib import Path

import numpy as np
import pandas as pd
from nautilus_trader.persistence import ParquetDataCatalog


EXPECTED_SHA256 = {
    "summary.json": "d6fd06da5cb743acf568a0c80dfb6b3d45342c816977b5e5c77d0b1625a153cb",
    "orders.csv": "81c5feddd9cb44f50f6c83df921bc945b84a089bcee622fb291a7cfb1a1b8e96",
    "fills.csv": "1f338d5dcc81cfda13fa89ee164f56e6fdcfe2409f22303b53f8ae5b8fa4487f",
    "positions.csv": "498551ad70c41701778f9b004aaa77ec2d602de72846acfd0fa3efe2cfbde218",
}
TERMINAL = {"FILLED", "CANCELED", "EXPIRED"}
OPEN = {"ACCEPTED", "SUBMITTED", "PARTIALLY_FILLED", "PENDING_CANCEL"}
ZERO = Decimal(0)


def _read_csv(path: Path) -> list[dict]:
    with path.open(newline="") as stream:
        return list(csv.DictReader(stream))


def _instruments(root: Path, summary: dict) -> dict[str, Decimal]:
    multipliers = {}
    for row in summary["per_coin"]:
        catalog = ParquetDataCatalog(str(root / row["coin"] / "minute"))
        instruments = catalog.instruments(instrument_ids=[row["instrument"]])
        if len(instruments) != 1:
            raise RuntimeError(f"missing native Instrument {row['instrument']}")
        multipliers[row["instrument"]] = instruments[0].multiplier.as_decimal()
    if len(multipliers) != 37:
        raise RuntimeError("expected 37 unique native Instruments")
    return multipliers


def _add(deltas: dict[int, dict[str, Decimal]], ns: int, kind: str, amount: Decimal) -> None:
    deltas[ns][kind] += amount


def _orders(
    rows: list[dict], multipliers: dict[str, Decimal], deltas: dict[int, dict[str, Decimal]], end_ns: int
) -> tuple[dict[str, dict], dict[str, Decimal]]:
    by_id = {row["client_order_id"]: row for row in rows}
    if len(by_id) != len(rows):
        raise RuntimeError("duplicate native order ID")
    stops = defaultdict(list)
    for row in rows:
        if row["side"] == "SELL" and row["type"] == "STOP_MARKET":
            stops[row["parent_order_id"]].append(row)
    entries = {}
    unit_risk = {}
    for row in rows:
        if not (row["side"] == "BUY" and row["type"] == "LIMIT" and not row["parent_order_id"]):
            continue
        identity = row["client_order_id"]
        if len(stops[identity]) != 1 or row["instrument_id"] not in multipliers:
            raise RuntimeError(f"invalid native entry/stop topology {identity}")
        limit = Decimal(row["price"])
        stop = Decimal(stops[identity][0]["trigger_price"])
        qty = Decimal(row["quantity"])
        if not 0 < stop < limit or qty <= 0:
            raise RuntimeError(f"nonpositive planned stop risk {identity}")
        per_unit = (limit - stop) * multipliers[row["instrument_id"]]
        init_ns = int(row["ts_init"])
        if row["status"] in TERMINAL:
            terminal_ns = int(row["ts_last"])
        elif row["status"] in OPEN:
            terminal_ns = end_ns
        else:
            raise RuntimeError(f"unknown native entry status {identity}: {row['status']}")
        if terminal_ns < init_ns or terminal_ns > end_ns:
            raise RuntimeError(f"invalid entry lifetime {identity}")
        entries[identity] = row
        unit_risk[identity] = per_unit
        _add(deltas, init_ns, "pending", qty * per_unit)
    if len(entries) != 5878:
        raise RuntimeError(f"expected 5878 native entry parents, got {len(entries)}")
    return entries, unit_risk


def _positions(
    rows: list[dict], entries: dict[str, dict], unit_risk: dict[str, Decimal],
    multipliers: dict[str, Decimal], deltas: dict[int, dict[str, Decimal]],
    csv_fills: list[dict], end_ns: int,
) -> dict:
    by_trade = {row["trade_id"]: row for row in csv_fills}
    if len(by_trade) != len(csv_fills):
        raise RuntimeError("duplicate native fill trade ID")
    observed_trades = set()
    entry_filled_qty = defaultdict(lambda: ZERO)
    closed = 0
    opened = 0
    buy_events = 0
    for position in rows:
        multiplier = Decimal(position["multiplier"])
        instrument = position["instrument_id"]
        if multiplier != multipliers[instrument]:
            raise RuntimeError(f"native multiplier differs for {instrument}")
        quantity = ZERO
        risk = ZERO
        last_ns = 0
        events = ast.literal_eval(position["events"])
        for event in events:
            trade = event["trade_id"]
            if event["type"] != "OrderFilled" or trade in observed_trades or trade not in by_trade:
                raise RuntimeError(f"unmatched native Position fill {trade}")
            observed_trades.add(trade)
            raw = by_trade[trade]
            ns = int(event["ts_event"])
            qty = Decimal(event["last_qty"])
            px = Decimal(event["last_px"])
            if (ns < last_ns or ns > end_ns or qty <= 0
                or event["instrument_id"] != instrument or raw["instrument_id"] != instrument
                or raw["order_side"] != event["order_side"]
                or Decimal(raw["last_qty"]) != qty or Decimal(raw["last_px"]) != px
                or pd.Timestamp(raw["ts_event"]).value != ns):
                raise RuntimeError(f"native Position/fill mismatch {trade}")
            last_ns = ns
            if event["order_side"] == "BUY":
                identity = event["client_order_id"]
                parent = entries.get(identity)
                if parent is None or parent["instrument_id"] != instrument:
                    raise RuntimeError(f"unmatched native entry parent {identity}")
                planned_unit = unit_risk[identity]
                stop = Decimal(parent["price"]) - planned_unit / multiplier
                if px <= stop:
                    raise RuntimeError(f"actual BUY fill is below linked stop {trade}")
                entry_filled_qty[identity] += qty
                actual = qty * (px - stop) * multiplier
                _add(deltas, ns, "pending", -qty * planned_unit)
                _add(deltas, ns, "open", actual)
                quantity += qty
                risk += actual
                buy_events += 1
            elif event["order_side"] == "SELL":
                if quantity < qty or risk <= 0:
                    raise RuntimeError(f"SELL exceeds native open Position {trade}")
                removed = risk * qty / quantity
                _add(deltas, ns, "open", -removed)
                risk -= removed
                quantity -= qty
            else:
                raise RuntimeError(f"unexpected native Position side {trade}")
        is_closed = bool(position["ts_closed"])
        if is_closed:
            closed += 1
            if quantity != 0 or abs(risk) > Decimal("0.00000001"):
                raise RuntimeError(f"closed Position retains original-stop risk {position['position_id']}")
        else:
            opened += 1
            if quantity <= 0 or risk <= 0 or quantity != Decimal(position["quantity"]):
                raise RuntimeError(f"open Position risk mismatch {position['position_id']}")
    if len(observed_trades) != len(csv_fills):
        raise RuntimeError("native fill CSV contains events missing from Position histories")
    if (len(rows), closed, opened, buy_events, len(entry_filled_qty)) != (507, 496, 11, 881, 881):
        raise RuntimeError("native Position or positively filled parent counts changed")
    for identity, row in entries.items():
        filled = entry_filled_qty.get(identity, ZERO)
        original = Decimal(row["quantity"])
        if filled != Decimal(row["filled_qty"]) or filled > original:
            raise RuntimeError(f"native entry quantity does not reconcile {identity}")
        if row["status"] in TERMINAL:
            terminal_ns = int(row["ts_last"])
            _add(deltas, terminal_ns, "pending", -(original - filled) * unit_risk[identity])
        elif filled >= original:
            raise RuntimeError(f"nonterminal parent has no remaining quantity {identity}")
    return {
        "native_orders": len(entries) * 3 + 31,
        "native_entry_parents": len(entries),
        "positive_filled_entry_parents": len(entry_filled_qty),
        "native_positions": len(rows),
        "closed_positions": closed,
        "open_right_censored_positions": opened,
        "native_fill_events": len(observed_trades),
        "native_buy_fill_events": buy_events,
    }


def _weighted_quantile(values: np.ndarray, weights: np.ndarray, fraction: float) -> float:
    indices = np.argsort(values, kind="stable")
    cumulative = np.cumsum(weights[indices])
    return float(values[indices[np.searchsorted(cumulative, fraction * cumulative[-1], side="left")]])


def _path(deltas: dict[int, dict[str, Decimal]], start_ns: int, end_ns: int) -> tuple[list[dict], dict]:
    if any(ns < start_ns or ns > end_ns for ns in deltas):
        raise RuntimeError("native risk event outside eligibility window")
    times = sorted(set(deltas) | {start_ns, end_ns})
    pending = ZERO
    open_risk = ZERO
    path = []
    for i, ns in enumerate(times[:-1]):
        pending += deltas[ns]["pending"]
        open_risk += deltas[ns]["open"]
        if pending < Decimal("-0.000001") or open_risk < Decimal("-0.000001"):
            raise RuntimeError(f"negative native original-stop risk at {ns}")
        if abs(pending) < Decimal("0.000001"):
            pending = ZERO
        if abs(open_risk) < Decimal("0.000001"):
            open_risk = ZERO
        duration = times[i + 1] - ns
        if duration <= 0:
            raise RuntimeError("nonpositive native risk interval")
        path.append({
            "start_ns": ns,
            "duration_ns": duration,
            "pending_usdt": str(pending),
            "open_usdt": str(open_risk),
            "combined_usdt": str(pending + open_risk),
        })
    if sum(item["duration_ns"] for item in path) != end_ns - start_ns:
        raise RuntimeError("native risk path does not cover eligible window")
    weights = np.array([row["duration_ns"] for row in path], dtype=np.float64)
    start_balance = 100_000.0
    metrics = {}
    for key in ("pending", "open", "combined"):
        values = np.array([float(row[f"{key}_usdt"]) for row in path])
        peak_i = int(values.argmax())
        metrics[key] = {
            "time_weighted_mean_usdt": float(np.average(values, weights=weights)),
            "time_weighted_median_usdt": _weighted_quantile(values, weights, 0.5),
            "time_weighted_p95_usdt": _weighted_quantile(values, weights, 0.95),
            "peak_usdt": float(values[peak_i]),
            "peak_start_utc": pd.Timestamp(path[peak_i]["start_ns"], tz="UTC").isoformat(),
            "mean_bps_of_initial_100k": float(np.average(values, weights=weights) / start_balance * 10_000),
            "peak_bps_of_initial_100k": float(values[peak_i] / start_balance * 10_000),
        }
    metrics["pending_share_of_time_weighted_combined_mean"] = (
        metrics["pending"]["time_weighted_mean_usdt"] / metrics["combined"]["time_weighted_mean_usdt"]
    )
    metrics["terminal_right_censored_pending_usdt"] = str(pending)
    metrics["terminal_right_censored_open_usdt"] = str(open_risk)
    metrics["intervals"] = len(path)
    return path, metrics


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", type=Path, required=True)
    parser.add_argument("--catalog-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    actual = {name: hashlib.sha256((args.run / name).read_bytes()).hexdigest() for name in EXPECTED_SHA256}
    if actual != EXPECTED_SHA256:
        raise RuntimeError(f"frozen native report identity mismatch: {actual}")
    summary = json.loads((args.run / "summary.json").read_text())
    if (not summary["integrity_passed"] or summary["denied_orders"] or summary["rejected_orders"]
        or summary["signal_variant"] != "support-broad-two-tier-4h"
        or Decimal(str(summary["starting_balance_usdt"])) != 100000):
        raise RuntimeError("unexpected H19a native shared-account summary")
    start_ns = pd.Timestamp(summary["period_start_utc"]).value
    end_ns = pd.Timestamp(summary["period_end_utc"]).value
    multipliers = _instruments(args.catalog_root, summary)
    orders = _read_csv(args.run / "orders.csv")
    positions = _read_csv(args.run / "positions.csv")
    fills = _read_csv(args.run / "fills.csv")
    deltas = defaultdict(lambda: {"pending": ZERO, "open": ZERO})
    entries, unit_risk = _orders(orders, multipliers, deltas, end_ns)
    counts = _positions(positions, entries, unit_risk, multipliers, deltas, fills, end_ns)
    if counts["native_orders"] != len(orders):
        raise RuntimeError("native order count differs from OTO plus market exits")
    path, metrics = _path(deltas, start_ns, end_ns)
    output = {
        "schema": "r1-native-d69-combined-original-stop-risk/v1",
        "preregistration_commit": "75c1f40c3",
        "input_sha256": EXPECTED_SHA256,
        "run": str(args.run),
        "catalog_root": str(args.catalog_root),
        "period_start_utc": summary["period_start_utc"],
        "period_end_utc": summary["period_end_utc"],
        "counts": counts,
        "metrics": metrics,
        "path": path,
        "limitations": [
            "Original-stop risk is a submitted-order commitment proxy, not a gap/slippage-adjusted maximum loss or mark-to-market forecast.",
            "Bps use the original 100000 USDT balance, not changing native Portfolio equity.",
            "The path is read-only from actual native orders/fills/Positions; no alternative order, sizing or account path is simulated.",
        ],
    }
    data = (json.dumps(output, separators=(",", ":"), allow_nan=False) + "\n").encode()
    with args.output.open("wb") as stream:
        with gzip.GzipFile(filename="", mode="wb", fileobj=stream, mtime=0) as zipped:
            zipped.write(data)


if __name__ == "__main__":
    main()
