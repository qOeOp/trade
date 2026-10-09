"""Read native H23a parent stop clocks against completed Catalog LAST bars."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
from collections import defaultdict
from decimal import Decimal
from pathlib import Path

from nautilus_trader.model import BarType
from nautilus_trader.persistence import ParquetDataCatalog


FOUR_HOUR_NS = 14_400_000_000_000
MILLISECOND_NS = 1_000_000


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def audit(run: Path, catalog_root: Path) -> dict:
    summary = json.loads((run / "summary.json").read_text())
    if summary["signal_variant"] != "support-brooks-confirmed-4h":
        raise ValueError("H23a native report required")
    with (run / "orders.csv").open(newline="") as stream:
        parents = [row for row in csv.DictReader(stream) if row["tags"] == "['ENTRY']"]
    by_coin = defaultdict(list)
    instrument_coins = {row["instrument"]: row["coin"] for row in summary["per_coin"]}
    for parent in parents:
        by_coin[instrument_coins[parent["instrument_id"]]].append(parent)
    findings = []
    completed_groups = 0
    for coin, rows in sorted(by_coin.items()):
        catalog = ParquetDataCatalog(str(catalog_root / coin / "minute"))
        instrument_id = rows[0]["instrument_id"]
        instrument = catalog.instruments(instrument_ids=[instrument_id])[0]
        last_type = BarType.from_str(f"{instrument_id}-5-MINUTE-LAST-EXTERNAL")
        start = min(int(row["ts_init"]) for row in rows) - FOUR_HOUR_NS
        end = max(int(row["ts_init"]) for row in rows)
        groups = defaultdict(list)
        for bar in catalog.query_bars([instrument_id], start=start, end=end):
            if bar.bar_type != last_type:
                continue
            close_ns = (
                (bar.ts_event + MILLISECOND_NS + FOUR_HOUR_NS - 1) // FOUR_HOUR_NS
            ) * FOUR_HOUR_NS
            groups[close_ns].append(bar)
        for parent in rows:
            order_id = parent["client_order_id"]
            ts = int(parent["ts_init"])
            prior = groups.get(ts, ())
            if len(prior) != 48:
                findings.append(
                    f"{order_id}: preceding native 4h bar has {len(prior)} 5m bars"
                )
                continue
            completed_groups += 1
            high = max(Decimal(str(bar.high)) for bar in prior)
            tick = instrument.price_increment.as_decimal()
            expected = instrument.make_price(float(high + tick)).as_decimal()
            trigger = Decimal(parent["trigger_price"])
            if (
                ts % FOUR_HOUR_NS
                or parent["type"] != "STOP_MARKET"
                or trigger != expected
                or trigger <= high
            ):
                findings.append(
                    f"{order_id}: stop trigger is not one tick above completed 4h high"
                )
            if int(parent["expire_time_ns"]) != ts + FOUR_HOUR_NS:
                findings.append(f"{order_id}: deadline is not next 4h close")
            if (
                Decimal(parent["filled_qty"]) > 0
                and int(parent["ts_last"]) > ts + FOUR_HOUR_NS
            ):
                findings.append(f"{order_id}: parent filled after its one-bar deadline")
    return {
        "schema": "r1-native-h23a-order-clock/v1",
        "run": str(run),
        "summary_sha256": sha(run / "summary.json"),
        "orders_sha256": sha(run / "orders.csv"),
        "coins_with_parent_orders": len(by_coin),
        "native_parent_orders": len(parents),
        "completed_catalog_bars_checked": completed_groups,
        "findings": findings[:50],
        "passed": not findings,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", type=Path, required=True)
    parser.add_argument("--catalog-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = audit(args.run, args.catalog_root)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    if not result["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
