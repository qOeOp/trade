"""
Read native tier bundles for a completed pre-fill revisit of their B target.

This is a descriptive order-path audit. It does not simulate cancellation, fills, or
PnL.

"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
from bisect import bisect_left
from collections import defaultdict
from datetime import datetime
from decimal import Decimal
from itertools import pairwise
from pathlib import Path

from audit_source_daily_context import _tree_digest

from vibe_trading.model import BarType
from vibe_trading.persistence import ParquetDataCatalog


INPUT_SHA256 = "ce9963ca68c66d34af74dbdbfff484f320a622fa73afe64844518aed354ec9fc"
REPORT_SHA256 = {
    "h15a": {
        "orders.csv": "fd1960c9b2f87e05c61f8765c3cb46a5df509e84664db07c7bff3ece0cbc9edb",
        "fills.csv": "f3a760ce0648d502775edd0469812a0aeab5c75fe3b89eba68cce05924616b3f",
        "positions.csv": "bf415c887e7e6234790a8f9c204cce283cfdab45822f2538c878874a5a30e7cd",
        "summary.json": "889487354aecc95cf16977f1f85040df0f2150ab00ad0e29cad99f6579575feb",
    },
    "h16a": {
        "orders.csv": "63adc7d008534ad57978a037e8e736f65859f5c851e540d97504ef35c8cebfbd",
        "fills.csv": "f4f0372d854777bf187dbef265e96078437b2741653d67d6f5823cb1e61213ca",
        "positions.csv": "d08050707829a63f6d4d66a1c80ef4f0631cfa60c6c9fdaf3f25bf871c10172b",
        "summary.json": "bd1f4713db50a990ac0b927f3f5bd5c00c93c22f7120055a194a81dfa8822f48",
    },
}


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _csv(path: Path) -> list[dict[str, str]]:
    with path.open(newline="") as file:
        return list(csv.DictReader(file))


def _money(value: str) -> Decimal:
    return Decimal(value.split()[0])


def _timestamp_ns(value: str) -> int:
    instant = datetime.fromisoformat(value)
    if instant.tzinfo is None:
        raise RuntimeError("native fill timestamp lacks timezone")
    return int(instant.timestamp()) * 1_000_000_000 + instant.microsecond * 1_000


def _one_bundle(instrument, ts_init, tier_parents, children_by_parent, expected_tiers):
    if len(tier_parents) != expected_tiers:
        raise RuntimeError(f"ambiguous native bundle: {instrument} {ts_init}")
    targets, stops = set(), set()
    for parent in tier_parents:
        children = children_by_parent[parent["client_order_id"]]
        if len(children) != 2 or {child["type"] for child in children} != {
            "LIMIT",
            "STOP_MARKET",
        }:
            raise RuntimeError(f"bad OTO children: {parent['client_order_id']}")
        if any(child["order_list_id"] != parent["order_list_id"] for child in children):
            raise RuntimeError(f"wrong OTO order list: {parent['client_order_id']}")
        target = next(child for child in children if child["type"] == "LIMIT")
        stop = next(child for child in children if child["type"] == "STOP_MARKET")
        if any(child["side"] != "SELL" for child in children):
            raise RuntimeError("unexpected OTO child side")
        targets.add(Decimal(target["price"]))
        stops.add(Decimal(stop["trigger_price"]))
    if len(targets) != 1 or len(stops) != 1:
        raise RuntimeError("bundle has distinct stop or target")
    return {
        "instrument": instrument,
        "ts_init": int(ts_init),
        "entry_ids": {parent["client_order_id"] for parent in tier_parents},
        "highest_entry": max(Decimal(parent["price"]) for parent in tier_parents),
        "target": targets.pop(),
        "stop": stops.pop(),
    }


def _bundles(orders: list[dict[str, str]], expected_tiers: int):
    by_id = {row["client_order_id"]: row for row in orders}
    if len(by_id) != len(orders):
        raise RuntimeError("duplicate native order ID")
    children_by_parent = defaultdict(list)
    for row in orders:
        if row["parent_order_id"]:
            children_by_parent[row["parent_order_id"]].append(row)
    parents = [row for row in orders if row["tags"] == "['ENTRY']"]
    grouped = defaultdict(list)
    for parent in parents:
        if parent["type"] != "LIMIT" or parent["side"] != "BUY":
            raise RuntimeError("unexpected tier parent order")
        grouped[(parent["instrument_id"], parent["ts_init"])].append(parent)
    bundles = [
        _one_bundle(
            instrument,
            ts_init,
            tier_parents,
            children_by_parent,
            expected_tiers,
        )
        for (instrument, ts_init), tier_parents in grouped.items()
    ]
    if len(parents) != len(bundles) * expected_tiers:
        raise RuntimeError("unreconciled bundle parent count")
    return bundles, by_id


def _native_bars(catalog_root: Path, coin: str, identity_row: dict, instrument: str):
    root = catalog_root / coin / "minute"
    if _tree_digest(root) != identity_row["minute_catalog"]["sha256"]:
        raise RuntimeError(f"{coin}: registered native Catalog digest differs")
    completion = json.loads((root / "r1-download-complete.json").read_text())
    if completion["instrument"] != instrument or completion["bar_minutes"] != 5:
        raise RuntimeError(f"{coin}: native Instrument or bar interval differs")
    catalog = ParquetDataCatalog(str(root))
    bar_type = BarType.from_str(f"{instrument}-5-MINUTE-LAST-EXTERNAL")
    bars = sorted(
        (
            bar
            for bar in catalog.query_bars(
                [instrument],
                start=completion["start_ns"],
                end=completion["end_ns"],
            )
            if bar.bar_type == bar_type
        ),
        key=lambda bar: bar.ts_event,
    )
    if not bars or any(b.ts_event - a.ts_event != 300_000_000_000 for a, b in pairwise(bars)):
        raise RuntimeError(f"{coin}: native LAST bars missing or not contiguous")
    return bars


def _load_report(label: str, root: Path):
    for name, digest in REPORT_SHA256[label].items():
        if _sha(root / name) != digest:
            raise RuntimeError(f"{label}: frozen native report changed: {name}")
    summary = json.loads((root / "summary.json").read_text())
    orders = _csv(root / "orders.csv")
    fills = _csv(root / "fills.csv")
    positions = _csv(root / "positions.csv")
    tiers = 3 if label == "h15a" else 2
    bundles, orders_by_id = _bundles(orders, tiers)
    if len(bundles) != sum(
        row["tiered_pullback"]["submitted_bundles"] for row in summary["per_coin"]
    ):
        raise RuntimeError(
            f"{label}: native bundle count differs from Strategy counters",
        )
    entry_ids = {entry_id for bundle in bundles for entry_id in bundle["entry_ids"]}
    first_fill = {}
    for fill in fills:
        order_id = fill["client_order_id"]
        if order_id in entry_ids:
            first_fill[order_id] = min(
                first_fill.get(order_id, 2**63),
                _timestamp_ns(fill["ts_event"]),
            )
    if sum(Decimal(orders_by_id[order_id]["filled_qty"]) > 0 for order_id in entry_ids) != len(
        first_fill,
    ):
        raise RuntimeError(
            f"{label}: native entry fill count differs from order report",
        )
    closed = [row for row in positions if row["ts_closed"]]
    if (
        len(closed) != summary["closed_trades"]
        or sum(_money(row["realized_pnl"]) > 0 for row in closed) != summary["winning_trades"]
    ):
        raise RuntimeError(f"{label}: native closed-position count or wins differ")
    by_opening = defaultdict(list)
    for position in positions:
        by_opening[position["opening_order_id"]].append(position)
    return summary, bundles, orders_by_id, first_fill, closed, by_opening


def _position_rows(label, bundle, first_ts, by_opening, orders_by_id):
    native_positions = [
        row
        for order_id in bundle["entry_ids"]
        for row in by_opening[order_id]
        if int(row["ts_init"]) >= first_ts
    ]
    if not native_positions:
        raise RuntimeError(f"{label}: filled revisited bundle has no native position")
    position_rows = []
    for row in native_positions:
        closing = orders_by_id.get(row["closing_order_id"])
        if row["ts_closed"] and closing is None:
            raise RuntimeError(f"{label}: missing native closing order")
        position_rows.append(
            {
                "position_id": row["position_id"],
                "closed": bool(row["ts_closed"]),
                "realized_pnl_usdt": str(_money(row["realized_pnl"])),
                "closing_order_type": closing["type"] if closing else None,
                "closing_order_tag": closing["tags"] if closing else None,
            },
        )
    return position_rows


def _inspect_bundle(
    label,
    bundle,
    first_fill,
    bars,
    timestamps,
    by_opening,
    orders_by_id,
):
    filled = [first_fill[order_id] for order_id in bundle["entry_ids"] if order_id in first_fill]
    if not filled:
        return None
    first_ts = min(filled)
    lo = bisect_left(timestamps, bundle["ts_init"] + 1)
    hi = bisect_left(timestamps, first_ts)
    revisit = next(
        (
            bar
            for bar in bars[lo:hi]
            if Decimal(str(bar.high)) >= bundle["target"]
            and Decimal(str(bar.low)) > bundle["highest_entry"]
        ),
        None,
    )
    if revisit is None:
        return None
    return {
        "instrument": bundle["instrument"],
        "submitted_ns": bundle["ts_init"],
        "first_revisit_ns": revisit.ts_event,
        "first_entry_fill_ns": first_ts,
        "native_target": str(bundle["target"]),
        "highest_entry": str(bundle["highest_entry"]),
        "filled_tiers": len(filled),
        "positions": _position_rows(label, bundle, first_ts, by_opening, orders_by_id),
    }


def _scan_paths(
    label,
    bundles,
    first_fill,
    by_opening,
    orders_by_id,
    identity,
    catalog_root,
):
    by_instrument = defaultdict(list)
    for bundle in bundles:
        by_instrument[bundle["instrument"]].append(bundle)
    exposed = []
    scanned = 0
    for identity_row in identity["coins"]:
        coin = identity_row["coin"]
        completion = json.loads(
            (catalog_root / coin / "minute" / "r1-download-complete.json").read_text(),
        )
        instrument = completion["instrument"]
        coin_bundles = by_instrument.get(instrument, [])
        if not coin_bundles:
            continue
        scanned += len(coin_bundles)
        bars = _native_bars(catalog_root, coin, identity_row, instrument)
        timestamps = [bar.ts_event for bar in bars]
        for bundle in coin_bundles:
            path = _inspect_bundle(
                label,
                bundle,
                first_fill,
                bars,
                timestamps,
                by_opening,
                orders_by_id,
            )
            if path is not None:
                exposed.append(path)
    if scanned != len(bundles):
        raise RuntimeError(f"{label}: some native bundles were not scanned")
    return exposed


def _run(label: str, root: Path, identity: dict, catalog_root: Path) -> dict:
    summary, bundles, orders_by_id, first_fill, closed, by_opening = _load_report(
        label,
        root,
    )
    exposed = _scan_paths(
        label,
        bundles,
        first_fill,
        by_opening,
        orders_by_id,
        identity,
        catalog_root,
    )
    revisited_closed = [p for bundle in exposed for p in bundle["positions"] if p["closed"]]
    revisited_losses = [p for p in revisited_closed if Decimal(p["realized_pnl_usdt"]) <= 0]
    return {
        "native_report_sha256": REPORT_SHA256[label],
        "submitted_bundles": len(bundles),
        "bundles_with_first_entry_fill": sum(
            any(order_id in first_fill for order_id in bundle["entry_ids"]) for bundle in bundles
        ),
        "filled_entry_orders": len(first_fill),
        "native_closed_positions": len(closed),
        "native_winning_positions": summary["winning_trades"],
        "pre_fill_b_revisited_bundles_later_filled": len(exposed),
        "pre_fill_b_revisited_filled_entries": sum(row["filled_tiers"] for row in exposed),
        "revisited_closed_positions": len(revisited_closed),
        "revisited_nonpositive_positions": len(revisited_losses),
        "revisited_nonpositive_pnl_usdt": str(
            sum(
                (Decimal(row["realized_pnl_usdt"]) for row in revisited_losses),
                Decimal(0),
            ),
        ),
        "paths": exposed,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-identity", type=Path, required=True)
    parser.add_argument("--catalog-root", type=Path, required=True)
    parser.add_argument("--h15a", type=Path, required=True)
    parser.add_argument("--h16a", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if _sha(args.input_identity) != INPUT_SHA256:
        raise RuntimeError("frozen 37-coin input identity changed")
    identity = json.loads(args.input_identity.read_text())
    if Path(identity["minute_catalog_root"]) != args.catalog_root or len(identity["coins"]) != 37:
        raise RuntimeError("wrong native Catalog root or coin count")
    output = {
        "method": "native OTO parent/child/fill/position joins plus complete prior five-minute LAST bars; descriptive, no alternative fills or account returns",
        "reader_sha256": _sha(Path(__file__)),
        "input_identity_sha256": INPUT_SHA256,
        "same_bar_b_touch_excluded": True,
        "runs": {
            "h15a": _run("h15a", args.h15a, identity, args.catalog_root),
            "h16a": _run("h16a", args.h16a, identity, args.catalog_root),
        },
        "economic_replay": False,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, indent=2) + "\n")


if __name__ == "__main__":
    main()
