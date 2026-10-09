"""Read native stop fills against the registered five-minute LAST/MARK bars."""

from __future__ import annotations

import argparse
import ast
import csv
import gzip
import json
from collections import defaultdict
from decimal import Decimal
from pathlib import Path

import numpy as np
import pandas as pd
from audit_d71_asset_regimes import sha
from audit_d71_asset_regimes import tree_digest
from nautilus_trader.model import BarType
from nautilus_trader.persistence import ParquetDataCatalog


START_NS = pd.Timestamp("2025-10-07T00:00:00Z").value
END_NS = pd.Timestamp("2026-10-07T08:30:00Z").value
FIVE_MINUTE_NS = 300_000_000_000
MILLISECOND_NS = 1_000_000
EXPECTED_BARS = (END_NS - START_NS) // FIVE_MINUTE_NS
RUNS = {"H19a": "support-broad-two-tier-4h", "H15a": "support-three-tier-4h"}
TERCILES = ("low", "middle", "high")


def _native_rows(run: Path, audit_path: Path, variant: str) -> tuple[list[dict], dict]:
    audit = json.loads(audit_path.read_text())
    summary = json.loads((run / "summary.json").read_text())
    if (
        not audit["passed"]
        or audit["run"] != str(run)
        or not summary["integrity_passed"]
        or summary["signal_variant"] != RUNS[variant]
        or len(summary["per_coin"]) != 37
    ):
        raise RuntimeError(f"{variant}: invalid native report or independent audit")
    for filename, expected in audit["file_sha256"].items():
        if sha(run / filename) != expected:
            raise RuntimeError(f"{variant}: native {filename} changed after audit")
    with (run / "orders.csv").open(newline="") as stream:
        orders = {row["client_order_id"]: row for row in csv.DictReader(stream)}
    with (run / "positions.csv").open(newline="") as stream:
        positions = list(csv.DictReader(stream))
    if len(positions) != summary["closed_trades"] + audit["open_positions"]:
        raise RuntimeError(f"{variant}: native Position count differs from summary")
    rows = []
    for position in positions:
        events = ast.literal_eval(position["events"])
        stop_fills = []
        for event in events:
            if event["type"] != "OrderFilled" or event["order_type"] != "STOP_MARKET":
                continue
            order = orders.get(event["client_order_id"])
            if (
                order is None
                or order["type"] != "STOP_MARKET"
                or order["side"] != "SELL"
                or order["instrument_id"] != position["instrument_id"]
            ):
                raise RuntimeError(f"{variant}: unmatched native protective stop")
            stop_fills.append(
                {
                    "fill_ns": int(event["ts_event"]),
                    "stop_trigger": Decimal(order["trigger_price"]),
                    "stop_order_id": event["client_order_id"],
                }
            )
        stop_fills.sort(key=lambda row: (row["fill_ns"], row["stop_order_id"]))
        if stop_fills and not position["ts_closed"]:
            raise RuntimeError(f"{variant}: stopped native Position is still open")
        rows.append(
            {
                "position_id": position["position_id"],
                "instrument_id": position["instrument_id"],
                "closed": bool(position["ts_closed"]),
                "stop_fill_count": len(stop_fills),
                "first_stop_fill": stop_fills[0] if stop_fills else None,
            }
        )
    return rows, {
        "run": str(run),
        "audit_sha256": sha(audit_path),
        "native_report_sha256": audit["file_sha256"],
    }


def _bar_pairs(root: Path, coin: str) -> dict[int, tuple[object, object]]:
    instrument = f"{coin}USDT-PERP.BINANCE"
    if coin in ("PEPE", "SHIB"):
        instrument = f"1000{coin}USDT-PERP.BINANCE"
    catalog = ParquetDataCatalog(str(root / coin / "minute"))
    last_type = BarType.from_str(f"{instrument}-5-MINUTE-LAST-EXTERNAL")
    mark_type = BarType.from_str(f"{instrument}-5-MINUTE-MARK-EXTERNAL")
    bars = catalog.query_bars([instrument], start=START_NS, end=END_NS)
    last = sorted(
        (bar for bar in bars if bar.bar_type == last_type), key=lambda bar: bar.ts_event
    )
    mark = sorted(
        (bar for bar in bars if bar.bar_type == mark_type), key=lambda bar: bar.ts_event
    )
    if len(last) != EXPECTED_BARS or len(mark) != EXPECTED_BARS:
        raise RuntimeError(
            f"{coin}: incomplete native LAST/MARK bars {len(last)}/{len(mark)}"
        )
    result = {}
    for i, (trade, reference) in enumerate(zip(last, mark, strict=True)):
        expected_ns = START_NS + (i + 1) * FIVE_MINUTE_NS - MILLISECOND_NS
        if trade.ts_event != expected_ns or reference.ts_event != expected_ns:
            raise RuntimeError(f"{coin}: LAST/MARK bar timestamp mismatch at index {i}")
        result[expected_ns] = (trade, reference)
    return result


def _group(rows: list[dict]) -> dict:
    closed = [row for row in rows if row["closed"]]
    stopped = [row for row in closed if row["stop_fill_count"]]
    deltas = np.array([row["mark_minus_last_low_bps"] for row in stopped], dtype=float)
    return {
        "closed_positions": len(closed),
        "open_right_censored_positions": sum(not row["closed"] for row in rows),
        "stop_associated_positions": len(stopped),
        "stop_fill_events": sum(row["stop_fill_count"] for row in stopped),
        "last_low_crossed_native_stop": sum(row["last_low_crossed"] for row in stopped),
        "mark_low_crossed_native_stop": sum(row["mark_low_crossed"] for row in stopped),
        "strict_last_only_positions": sum(row["strict_last_only"] for row in stopped),
        "same_bar_last_only_positions": sum(
            row["same_bar_last_only"] for row in stopped
        ),
        "strict_last_only_per_stop_associated": (
            sum(row["strict_last_only"] for row in stopped) / len(stopped)
            if stopped
            else None
        ),
        "strict_last_only_per_closed": (
            sum(row["strict_last_only"] for row in stopped) / len(closed)
            if closed
            else None
        ),
        "stop_associated_native_net_pnl_usdt": str(
            sum(
                (Decimal(row["native_realized_pnl_usdt"]) for row in stopped),
                Decimal(0),
            )
        ),
        "strict_last_only_native_net_pnl_usdt": str(
            sum(
                (
                    Decimal(row["native_realized_pnl_usdt"])
                    for row in stopped
                    if row["strict_last_only"]
                ),
                Decimal(0),
            )
        ),
        "mark_minus_last_low_bps_at_first_stop": (
            {
                "median": float(np.median(deltas)),
                "p90": float(np.quantile(deltas, 0.9)),
                "min": float(deltas.min()),
                "max": float(deltas.max()),
            }
            if len(deltas)
            else None
        ),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-identity", type=Path, required=True)
    parser.add_argument("--d71-detail", type=Path, required=True)
    parser.add_argument("--h19-run", type=Path, required=True)
    parser.add_argument("--h19-audit", type=Path, required=True)
    parser.add_argument("--h15-run", type=Path, required=True)
    parser.add_argument("--h15-audit", type=Path, required=True)
    parser.add_argument("--detail-output", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    identity = json.loads(args.input_identity.read_text())
    root = Path(identity["minute_catalog_root"])
    coins = [row["coin"] for row in identity["coins"]]
    if len(coins) != 37 or len(set(coins)) != 37 or EXPECTED_BARS != 105_222:
        raise RuntimeError("registered full-pool native bar interval differs")
    with gzip.open(args.d71_detail, "rt") as stream:
        d71 = json.load(stream)
    d71_lookup = {(row["variant"], row["position_id"]): row for row in d71}
    if len(d71_lookup) != len(d71):
        raise RuntimeError("D71 Position detail contains duplicate identities")
    native = {
        "H19a": _native_rows(args.h19_run, args.h19_audit, "H19a"),
        "H15a": _native_rows(args.h15_run, args.h15_audit, "H15a"),
    }
    by_coin = defaultdict(list)
    for variant, (positions, _) in native.items():
        for position in positions:
            detail = d71_lookup.get((variant, position["position_id"]))
            if detail is None or detail["closed"] != position["closed"]:
                raise RuntimeError(f"{variant}: D71 Position identity/closure mismatch")
            coin = detail["coin"]
            if coin not in coins or detail["wick_fraction_tercile"] not in TERCILES:
                raise RuntimeError(f"{variant}: invalid D71 causal asset state")
            by_coin[coin].append(
                {
                    **position,
                    "variant": variant,
                    "coin": coin,
                    "submission_month_utc": detail["entry_submission_month_utc"],
                    "prior_daily_wick_tercile": detail["wick_fraction_tercile"],
                    "native_realized_pnl_usdt": detail["native_realized_pnl_usdt"],
                }
            )
    for manifest in identity["coins"]:
        coin = manifest["coin"]
        if tree_digest(root / coin / "minute") != manifest["minute_catalog"]["sha256"]:
            raise RuntimeError(f"{coin}: registered minute Catalog tree digest changed")
        bars = _bar_pairs(root, coin)
        for row in by_coin[coin]:
            first = row["first_stop_fill"]
            if first is None:
                continue
            fill_ns = first["fill_ns"]
            if fill_ns not in bars or fill_ns - FIVE_MINUTE_NS not in bars:
                raise RuntimeError(
                    f"{row['position_id']}: stop fill lacks exact native bar or predecessor"
                )
            last, mark = bars[fill_ns]
            prior_last, prior_mark = bars[fill_ns - FIVE_MINUTE_NS]
            trigger = first["stop_trigger"]
            last_low = Decimal(str(last.low))
            mark_low = Decimal(str(mark.low))
            prior_last_close = Decimal(str(prior_last.close))
            prior_mark_close = Decimal(str(prior_mark.close))
            if trigger <= 0 or prior_last_close <= 0 or prior_mark_close <= 0:
                raise RuntimeError(
                    f"{row['position_id']}: nonpositive native bar/stop price"
                )
            crossing = last_low <= trigger < mark_low
            row["last_low_crossed"] = last_low <= trigger
            row["mark_low_crossed"] = mark_low <= trigger
            row["same_bar_last_only"] = crossing
            row["strict_last_only"] = (
                crossing and prior_last_close > trigger and prior_mark_close > trigger
            )
            row["mark_minus_last_low_bps"] = float(
                (mark_low - last_low) / prior_last_close * Decimal(10_000)
            )
            row["first_stop_fill_ns"] = fill_ns
            row["native_stop_trigger"] = str(trigger)
            row["last_low"] = str(last_low)
            row["mark_low"] = str(mark_low)
            row["prior_last_close"] = str(prior_last_close)
            row["prior_mark_close"] = str(prior_mark_close)
        del bars
    all_rows = [row for coin in coins for row in by_coin[coin]]
    args.detail_output.parent.mkdir(parents=True, exist_ok=True)
    args.detail_output.write_text(
        json.dumps(all_rows, indent=2, sort_keys=True, default=str) + "\n"
    )
    results = {}
    for variant in RUNS:
        rows = [row for row in all_rows if row["variant"] == variant]
        results[variant] = {
            "native_reports": native[variant][1],
            "all": _group(rows),
            "prior_daily_wick_tercile": {
                label: _group(
                    [row for row in rows if row["prior_daily_wick_tercile"] == label]
                )
                for label in TERCILES
            },
            "by_coin": {
                coin: _group(
                    [row for row in by_coin[coin] if row["variant"] == variant]
                )
                for coin in coins
            },
            "by_submission_month": {
                month: _group(
                    [row for row in rows if row["submission_month_utc"] == month]
                )
                for month in sorted({row["submission_month_utc"] for row in rows})
            },
        }
    output = {
        "schema": "r1-native-d72-stop-spikes-read-only/v1",
        "preregistration_commits": ["613d54558", "170ca0a27", "760268c53"],
        "input_identity_sha256": sha(args.input_identity),
        "d71_detail_sha256": sha(args.d71_detail),
        "position_detail_sha256": sha(args.detail_output),
        "full_five_minute_bars_per_coin_per_type": EXPECTED_BARS,
        "coins": coins,
        "runs": results,
        "limitations": [
            "A Position with any stop fill is stop-associated; its total native PnL can include separate target fills.",
            "OHLC does not reveal intrabar ordering, mark-trigger counterfactual execution, spread, or native exchange stop semantics beyond reported DEFAULT trigger.",
            "All asset groups and outcomes are descriptive on the repeatedly exposed annual development set; no asset filter or protective-order rule is validated.",
        ],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, indent=2, sort_keys=True) + "\n")


if __name__ == "__main__":
    main()
