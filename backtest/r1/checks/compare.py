"""
Check native order and economic parity while ignoring generated UUIDs.

The narrow tolerance is denominated in one USDT cent and each native instrument's
minimum price/size increment. Outcome and order lifecycle counts must still match
exactly.

"""

import argparse
import csv
import json
from decimal import Decimal
from pathlib import Path

from nautilus_trader.persistence import ParquetDataCatalog


def _read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(newline="") as stream:
        return list(csv.DictReader(stream))


def _money(value: str) -> Decimal:
    return Decimal(value.split()[0])


def _instruments(root: Path, coins: list[str]) -> dict[str, tuple[Decimal, Decimal]]:
    result = {}
    for coin in coins:
        catalog = ParquetDataCatalog(str(root / coin / "minute"))
        items = catalog.instruments()
        if len(items) != 1:
            raise ValueError(f"{coin}: expected one native instrument")
        instrument = items[0]
        result[str(instrument.id)] = (
            instrument.price_increment.as_decimal(),
            instrument.size_increment.as_decimal(),
        )
    return result


def compare(reference: Path, candidate: Path, catalog_root: Path) -> dict:  # noqa: C901 - one parity receipt
    left = json.loads((reference / "summary.json").read_text())
    right = json.loads((candidate / "summary.json").read_text())
    coins = [row["coin"] for row in left["per_coin"]]
    if coins != [row["coin"] for row in right["per_coin"]]:
        raise ValueError("coin universe/order changed")
    increments = _instruments(catalog_root, coins)

    a_orders = {row["client_order_id"]: row for row in _read_csv(reference / "orders.csv")}
    b_orders = {row["client_order_id"]: row for row in _read_csv(candidate / "orders.csv")}
    missing_order_ids = sorted(a_orders.keys() - b_orders.keys())
    extra_order_ids = sorted(b_orders.keys() - a_orders.keys())
    mismatched_orders = []
    order_identity_fields = (
        "trader_id",
        "strategy_id",
        "instrument_id",
        "side",
        "type",
        "status",
        "time_in_force",
        "expire_time_ns",
    )
    for order_id in a_orders.keys() & b_orders.keys():
        a, b = a_orders[order_id], b_orders[order_id]
        price_step, size_step = increments[a["instrument_id"]]
        differences = [field for field in order_identity_fields if a[field] != b[field]]
        differences.extend(
            f"{field} > size increment"
            for field in ("quantity", "filled_qty")
            if abs(Decimal(a[field]) - Decimal(b[field])) > size_step
        )
        for field in ("price", "trigger_price"):
            if a[field] and b[field]:
                if abs(Decimal(a[field]) - Decimal(b[field])) > price_step:
                    differences.append(f"{field} > price increment")
            elif a[field] != b[field]:
                differences.append(field)
        if differences:
            mismatched_orders.append({"id": order_id, "fields": differences})

    def fill_sort(row: dict[str, str]):
        return (row["client_order_id"], row["ts_event"], row["last_qty"], row["last_px"])

    a_fills = sorted(_read_csv(reference / "fills.csv"), key=fill_sort)
    b_fills = sorted(_read_csv(candidate / "fills.csv"), key=fill_sort)
    mismatched_fills = []
    increment_differences = []
    fill_identity_fields = (
        "client_order_id",
        "strategy_id",
        "instrument_id",
        "order_side",
        "order_type",
        "liquidity_side",
        "ts_event",
        "currency",
    )
    for index, (a, b) in enumerate(zip(a_fills, b_fills, strict=False)):
        fields = [field for field in fill_identity_fields if a[field] != b[field]]
        price_step, size_step = increments[a["instrument_id"]]
        price_gap = abs(Decimal(a["last_px"]) - Decimal(b["last_px"]))
        size_gap = abs(Decimal(a["last_qty"]) - Decimal(b["last_qty"]))
        if price_gap > price_step:
            fields.append("last_px > price increment")
        if size_gap > size_step:
            fields.append("last_qty > size increment")
        if fields:
            mismatched_fills.append({"index": index, "fields": fields})
        elif price_gap or size_gap:
            increment_differences.append(
                {
                    "client_order_id": a["client_order_id"],
                    "price_gap": str(price_gap),
                    "size_gap": str(size_gap),
                },
            )

    exact_metrics = (
        "starting_balance_usdt",
        "closed_trades",
        "winning_trades",
        "closed_trade_win_rate",
        "denied_orders",
        "rejected_orders",
        "per_coin",
    )
    metric_differences = [key for key in exact_metrics if left[key] != right[key]]
    equity_gap = abs(Decimal(left["final_equity_usdt"]) - Decimal(right["final_equity_usdt"]))
    commission_gap = abs(
        sum((_money(row["commission"]) for row in a_fills), Decimal(0))
        - sum((_money(row["commission"]) for row in b_fills), Decimal(0)),
    )
    sharpe_gap = abs(
        Decimal(str(left["native_sharpe_365"])) - Decimal(str(right["native_sharpe_365"])),
    )
    drawdown_gap = abs(
        Decimal(str(left["native_max_drawdown_daily_close"]))
        - Decimal(str(right["native_max_drawdown_daily_close"])),
    )
    result = {
        "reference": str(reference),
        "candidate": str(candidate),
        "reference_equity_usdt": left["final_equity_usdt"],
        "candidate_equity_usdt": right["final_equity_usdt"],
        "equity_gap_usdt": str(equity_gap),
        "commission_gap_usdt": str(commission_gap),
        "sharpe_gap": str(sharpe_gap),
        "drawdown_gap": str(drawdown_gap),
        "order_count": [len(a_orders), len(b_orders)],
        "fill_count": [len(a_fills), len(b_fills)],
        "position_count": [
            len(_read_csv(reference / "positions.csv")),
            len(_read_csv(candidate / "positions.csv")),
        ],
        "missing_order_ids": missing_order_ids[:5],
        "extra_order_ids": extra_order_ids[:5],
        "mismatched_orders": mismatched_orders[:5],
        "mismatched_fills": mismatched_fills[:5],
        "within_instrument_increment_fills": increment_differences,
        "metric_differences": metric_differences,
    }
    result["parity_passed"] = (
        left["integrity_passed"] is True
        and right["integrity_passed"] is True
        and not missing_order_ids
        and not extra_order_ids
        and not mismatched_orders
        and len(a_fills) == len(b_fills)
        and not mismatched_fills
        and result["position_count"][0] == result["position_count"][1]
        and not metric_differences
        and equity_gap <= Decimal("0.01")
        and commission_gap <= Decimal("0.01")
        and sharpe_gap <= Decimal("0.0001")
        and drawdown_gap <= Decimal("0.0001")
    )
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("reference", type=Path)
    parser.add_argument("candidate", type=Path)
    parser.add_argument("--catalog-root", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(compare(args.reference, args.candidate, args.catalog_root), indent=2))
