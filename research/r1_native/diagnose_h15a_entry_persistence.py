"""
Read fixed post-entry landmarks from the accepted native H15a report.
"""

from __future__ import annotations

import argparse
import ast
import csv
import hashlib
import json
from collections import Counter
from collections import defaultdict
from datetime import datetime
from decimal import Decimal
from pathlib import Path

from audit_line_box_context import PARITY_SHA256
from audit_line_box_context import _read_candles
from audit_trendline_signal_parity import INPUT_SHA256

from vibe_trading.model import OrderFilled
from vibe_trading.model import Position
from vibe_trading.model import PositionAdjusted
from vibe_trading.persistence import ParquetDataCatalog


SUMMARY_SHA256 = "adbd663fb6880d4781e013f0c603121d5ec9b43c204b7911438c64207a056a99"
ORDERS_SHA256 = "b49a9b860da1326f90997cabdbfa5ed6ea2e0071569efb5b1f1010e93ef2db5e"
FILLS_SHA256 = "be104d10b860e145e3c14ac8c930f7aea615449566497e4611390536389ea852"
POSITIONS_SHA256 = "5659583d7d21a7079cd28c7d9efafddf479cfa8f40809c4d4d35525fabd8735e"
AUDIT_SHA256 = "606d54b072c5f522781ba9ee581583289d0220cb0a70dc9452a574e3fcc76095"
LANDMARKS = (1, 3, 5, 10)
FOUR_HOUR_NS = 4 * 60 * 60 * 1_000_000_000


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _amount(value: object) -> Decimal:
    return Decimal(str(value).split()[0])


def _ns(value: str) -> int:
    return int(datetime.fromisoformat(value).timestamp() * 1e9)


def _event_rows(row: dict) -> tuple[list[dict], list[dict]]:
    fills = ast.literal_eval(row["events"])
    adjustments = ast.literal_eval(row["adjustments"])
    if not fills or any(item["type"] != "OrderFilled" for item in fills):
        raise RuntimeError(f"invalid native fills: {row['position_id']}")
    if any(item["type"] != "PositionAdjusted" for item in adjustments):
        raise RuntimeError(f"invalid native adjustments: {row['position_id']}")
    return fills, adjustments


def _replay(instrument, fills: list[dict], adjustments: list[dict], until_ns: int | None):
    events = [(item["ts_event"], 0, item) for item in fills]
    events.extend((item["ts_event"], 1, item) for item in adjustments)
    events.sort(key=lambda item: (item[0], item[1]))
    position = None
    for timestamp, kind, raw in events:
        if until_ns is not None and timestamp > until_ns:
            break
        if kind == 0:
            event = OrderFilled.from_dict(raw)
            if position is None:
                position = Position(instrument=instrument, fill=event)
            else:
                position.apply(event)
        else:
            if position is None:
                raise RuntimeError("funding before first native fill")
            position.apply_adjustment(PositionAdjusted.from_dict(raw))
    if position is None:
        raise RuntimeError("no native opening fill by landmark")
    return position


def _close_cause(row: dict, orders: dict[str, dict]) -> str:
    if not row["ts_closed"]:
        return "open_at_end"
    order = orders[row["closing_order_id"]]
    if order["type"] == "STOP_MARKET":
        return "stop"
    if order["type"] == "LIMIT":
        return "target"
    if order["type"] == "MARKET":
        return "time_market"
    raise RuntimeError(f"unknown native close: {order['type']}")


def _approx_origin(
    opening_order_id: str,
    orders: dict[str, dict],
    entries_by_bundle: dict[tuple[str, str], list[dict]],
    target_by_parent: dict[str, list[dict]],
) -> tuple[Decimal, Decimal]:
    first_order = orders[opening_order_id]
    key = (first_order["strategy_id"], first_order["ts_init"])
    entries = sorted(
        entries_by_bundle[key],
        key=lambda item: Decimal(item["price"]),
        reverse=True,
    )
    if len(entries) != 3 or first_order not in entries:
        raise RuntimeError(f"opening order has no three-tier bundle: {opening_order_id}")
    targets = target_by_parent[entries[0]["client_order_id"]]
    if len(targets) != 1:
        raise RuntimeError(f"50% entry has no unique B target: {opening_order_id}")
    upper_entry = Decimal(entries[0]["price"])
    target_b = Decimal(targets[0]["price"])
    approx_a = 2 * upper_entry - target_b
    if not 0 < approx_a < upper_entry < target_b:
        raise RuntimeError(f"invalid approximate A/B bundle: {opening_order_id}")
    return approx_a, target_b


def _inspect_position(
    row: dict,
    instrument,
    candles: list,
    orders: dict[str, dict],
    stop_by_parent: dict[str, list[dict]],
    target_by_parent: dict[str, list[dict]],
    entries_by_bundle: dict[tuple[str, str], list[dict]],
) -> dict:
    fills, adjustments = _event_rows(row)
    first = fills[0]
    if first["client_order_id"] != row["opening_order_id"] or first["order_side"] != "BUY":
        raise RuntimeError(f"unexpected opening native fill: {row['position_id']}")
    stops = stop_by_parent[first["client_order_id"]]
    if len(stops) != 1:
        raise RuntimeError(f"opening fill lacks one native OTO stop: {row['position_id']}")
    entry = Decimal(first["last_px"])
    stop = Decimal(stops[0]["trigger_price"])
    approx_a, target_b = _approx_origin(
        first["client_order_id"],
        orders,
        entries_by_bundle,
        target_by_parent,
    )
    risk = entry - stop
    if risk <= 0:
        raise RuntimeError(f"nonpositive first-exposure risk: {row['position_id']}")
    actual = _replay(instrument, fills, adjustments, None)
    final_pnl = _amount(actual.realized_pnl)
    if abs(final_pnl - _amount(row["realized_pnl"])) > Decimal("0.000001"):
        raise RuntimeError(f"native realized PnL mismatch: {row['position_id']}")
    cause = _close_cause(row, orders)
    if cause != "open_at_end" and (actual.is_open or _amount(actual.quantity) != 0):
        raise RuntimeError(f"native close quantity mismatch: {row['position_id']}")
    first_ns = first["ts_event"]
    closed_ns = _ns(row["ts_closed"]) if row["ts_closed"] else None
    eligible = [bar for bar in candles if bar.ts_event >= first_ns + FOUR_HOUR_NS]
    landmarks = {}
    for n in LANDMARKS:
        if len(eligible) < n:
            landmarks[str(n)] = (
                {"state": "closed_censored", "close_cause": cause}
                if closed_ns is not None
                else {"state": "end_censored"}
            )
            continue
        bar = eligible[n - 1]
        if closed_ns is not None and closed_ns <= bar.ts_event:
            landmarks[str(n)] = {"state": "closed_censored", "close_cause": cause}
            continue
        mark_position = _replay(instrument, fills, adjustments, bar.ts_event)
        if not mark_position.is_open:
            raise RuntimeError(f"landmark native position already closed: {row['position_id']}")
        path = eligible[:n]
        mfe_r = (Decimal(str(max(item.high for item in path))) - entry) / risk
        mae_r = (Decimal(str(min(item.low for item in path))) - entry) / risk
        origin_low_breached = any(Decimal(str(item.low)) < approx_a for item in path)
        origin_close_breached = any(Decimal(str(item.close)) < approx_a for item in path)
        close_price = Decimal(str(bar.close))
        mark_price = instrument.make_price(close_price)
        native_mark_pnl = _amount(mark_position.total_pnl(mark_price))
        indicative_exit_fee = (
            close_price
            * _amount(mark_position.quantity)
            * _amount(instrument.multiplier)
            * _amount(instrument.taker_fee)
        )
        indicative_exit_pnl = native_mark_pnl - indicative_exit_fee
        later_entry = any(
            item["order_side"] == "BUY" and item["ts_event"] > bar.ts_event for item in fills
        )
        landmarks[str(n)] = {
            "state": "observed",
            "bar_close_ns": bar.ts_event,
            "elapsed_hours": str(Decimal(bar.ts_event - first_ns) / Decimal(3_600_000_000_000)),
            "mfe_first_r": str(mfe_r),
            "mae_first_r": str(mae_r),
            "close_first_r": str((close_price - entry) / risk),
            "approx_origin_low_breached": origin_low_breached,
            "approx_origin_close_breached": origin_close_breached,
            "native_mark_pnl_usdt": str(native_mark_pnl),
            "indicative_taker_exit_fee_usdt": str(indicative_exit_fee),
            "indicative_exit_pnl_usdt": str(indicative_exit_pnl),
            "actual_final_realized_pnl_usdt": str(final_pnl) if closed_ns else None,
            "actual_continuation_minus_indicative_usdt": (
                str(final_pnl - indicative_exit_pnl) if closed_ns else None
            ),
            "later_entry_after_landmark": later_entry,
            "entry_fills_by_landmark": sum(
                item["order_side"] == "BUY" and item["ts_event"] <= bar.ts_event for item in fills
            ),
        }
    return {
        "position_id": row["position_id"],
        "instrument_id": row["instrument_id"],
        "first_fill_ns": first_ns,
        "first_entry_px": str(entry),
        "native_first_stop_px": str(stop),
        "approx_origin_a_px": str(approx_a),
        "native_bundle_target_b_px": str(target_b),
        "first_exposure_r_px": str(risk),
        "native_entry_fill_count": sum(item["order_side"] == "BUY" for item in fills),
        "close_cause": cause,
        "native_final_realized_pnl_usdt": str(final_pnl),
        "landmarks": landmarks,
    }


def _summarize(rows: list[dict]) -> dict:
    summary = {}
    for n in LANDMARKS:
        key = str(n)
        counts = Counter(row["landmarks"][key]["state"] for row in rows)
        observed = [row for row in rows if row["landmarks"][key]["state"] == "observed"]
        if sum(counts.values()) != len(rows):
            raise RuntimeError("landmark coverage incomplete")
        block = {"state_counts": dict(counts), "observed": len(observed)}
        conditional = defaultdict(list)
        for row in observed:
            item = row["landmarks"][key]
            label = (
                f"mfe_below_half_r={Decimal(item['mfe_first_r']) < Decimal('0.5')}"
                f";approx_a_low_breached={item['approx_origin_low_breached']}"
            )
            conditional[label].append(row)
        block["descriptive_conditionals"] = {}
        for label, cohort in sorted(conditional.items()):
            settled = [row for row in cohort if row["close_cause"] != "open_at_end"]
            total_delta = sum(
                (
                    Decimal(
                        row["landmarks"][key]["actual_continuation_minus_indicative_usdt"],
                    )
                    for row in settled
                ),
                Decimal(0),
            )
            block["descriptive_conditionals"][label] = {
                "observed": len(cohort),
                "closed": len(settled),
                "eventual_winners": sum(
                    Decimal(row["native_final_realized_pnl_usdt"]) > 0 for row in settled
                ),
                "eventual_target_exits": sum(row["close_cause"] == "target" for row in settled),
                "eventual_target_pnl_usdt": str(
                    sum(
                        (
                            Decimal(row["native_final_realized_pnl_usdt"])
                            for row in settled
                            if row["close_cause"] == "target"
                        ),
                        Decimal(0),
                    ),
                ),
                "actual_continuation_minus_indicative_sum_usdt": str(total_delta),
                "actual_continuation_minus_indicative_mean_usdt": (
                    str(total_delta / len(settled)) if settled else None
                ),
                "later_entry_count": sum(
                    row["landmarks"][key]["later_entry_after_landmark"] for row in cohort
                ),
            }
        if n == 3:
            slow = [
                row
                for row in observed
                if Decimal(row["landmarks"][key]["mfe_first_r"]) < Decimal("0.5")
            ]
            closed_slow = [row for row in slow if row["close_cause"] != "open_at_end"]
            block["primary_slow"] = {
                "observed_count": len(slow),
                "closed_count": len(closed_slow),
                "open_at_end_count": len(slow) - len(closed_slow),
                "eventual_winners": sum(
                    Decimal(row["native_final_realized_pnl_usdt"]) > 0 for row in closed_slow
                ),
                "eventual_target_exits": sum(row["close_cause"] == "target" for row in closed_slow),
                "eventual_target_pnl_usdt": str(
                    sum(
                        (
                            Decimal(row["native_final_realized_pnl_usdt"])
                            for row in closed_slow
                            if row["close_cause"] == "target"
                        ),
                        Decimal(0),
                    ),
                ),
                "actual_continuation_minus_indicative_sum_usdt": str(
                    sum(
                        (
                            Decimal(
                                row["landmarks"][key]["actual_continuation_minus_indicative_usdt"],
                            )
                            for row in closed_slow
                        ),
                        Decimal(0),
                    ),
                ),
                "later_entry_count": sum(
                    row["landmarks"][key]["later_entry_after_landmark"] for row in slow
                ),
                "entry_fill_count_by_landmark": dict(
                    Counter(row["landmarks"][key]["entry_fills_by_landmark"] for row in slow),
                ),
                "close_causes": dict(Counter(row["close_cause"] for row in closed_slow)),
            }
        summary[key] = block
    return summary


def _load_inputs(run: Path, input_identity_path: Path, parity_path: Path, audit_path: Path):
    expected = {
        "summary.json": SUMMARY_SHA256,
        "orders.csv": ORDERS_SHA256,
        "fills.csv": FILLS_SHA256,
        "positions.csv": POSITIONS_SHA256,
    }
    actual = {name: _sha(run / name) for name in expected}
    if actual != expected or _sha(audit_path) != AUDIT_SHA256:
        raise RuntimeError("accepted H15a native report differs from D53 registration")
    if _sha(input_identity_path) != INPUT_SHA256 or _sha(parity_path) != PARITY_SHA256:
        raise RuntimeError("registered input/parity differs")
    run_summary = json.loads((run / "summary.json").read_text())
    audit = json.loads(audit_path.read_text())
    if not run_summary["integrity_passed"] or not audit["passed"]:
        raise RuntimeError("accepted native report integrity required")
    identity = json.loads(input_identity_path.read_text())
    parity = json.loads(parity_path.read_text())
    if not parity["all_exact"] or len(identity["coins"]) != 37:
        raise RuntimeError("all 37 corrected LAST inputs required")
    with (run / "orders.csv").open(newline="") as stream:
        orders = {row["client_order_id"]: row for row in csv.DictReader(stream)}
    with (run / "positions.csv").open(newline="") as stream:
        positions = list(csv.DictReader(stream))
    if len(positions) != 686:
        raise RuntimeError("H15a native position count differs")
    return actual, identity, parity, orders, positions


def _index_orders(orders: dict[str, dict]):
    stop_by_parent: dict[str, list[dict]] = defaultdict(list)
    target_by_parent: dict[str, list[dict]] = defaultdict(list)
    entries_by_bundle: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for order in orders.values():
        if order["type"] == "STOP_MARKET" and order["parent_order_id"]:
            stop_by_parent[order["parent_order_id"]].append(order)
        if order["type"] == "LIMIT" and order["parent_order_id"]:
            target_by_parent[order["parent_order_id"]].append(order)
        if order["tags"] == "['ENTRY']":
            entries_by_bundle[(order["strategy_id"], order["ts_init"])].append(order)
    return stop_by_parent, target_by_parent, entries_by_bundle


def _read_all_positions(
    identity: dict,
    parity: dict,
    catalog_root: Path,
    positions: list[dict],
    orders: dict[str, dict],
) -> list[dict]:
    by_instrument: dict[str, list[dict]] = defaultdict(list)
    for row in positions:
        by_instrument[row["instrument_id"]].append(row)
    stop_by_parent, target_by_parent, entries_by_bundle = _index_orders(orders)
    parity_by_coin = {row["coin"]: row for row in parity["coins"]}
    start_ns = _ns(parity["start_utc"])
    end_ns = _ns(parity["end_utc"])
    rows = []
    for item in identity["coins"]:
        coin = item["coin"]
        instrument_id, candles = _read_candles(
            catalog_root,
            item,
            parity_by_coin[coin],
            start_ns,
            end_ns,
        )
        catalog = ParquetDataCatalog(str(catalog_root / coin / "minute"))
        instrument = catalog.instruments(instrument_ids=[instrument_id])[0]
        rows.extend(
            _inspect_position(
                row,
                instrument,
                candles,
                orders,
                stop_by_parent,
                target_by_parent,
                entries_by_bundle,
            )
            for row in by_instrument.pop(instrument_id, [])
        )
        print(
            f"{coin}: {len(candles)} native LAST bars, {len(rows)} positions reconciled",
            flush=True,
        )
    if by_instrument:
        raise RuntimeError(f"unmapped native positions: {sorted(by_instrument)}")
    return rows


def diagnose(
    run: Path,
    input_identity_path: Path,
    parity_path: Path,
    catalog_root: Path,
    audit_path: Path,
) -> dict:
    actual, identity, parity, orders, positions = _load_inputs(
        run,
        input_identity_path,
        parity_path,
        audit_path,
    )
    rows = _read_all_positions(identity, parity, catalog_root, positions, orders)
    closed = [row for row in rows if row["close_cause"] != "open_at_end"]
    if len(closed) != 676 or len(rows) - len(closed) != 10:
        raise RuntimeError("native final position count differs")
    if sum(Decimal(row["native_final_realized_pnl_usdt"]) > 0 for row in closed) != 382:
        raise RuntimeError("native closed winner count differs")
    return {
        "method": "read-only native Position replay at preregistered complete LAST landmarks; indicative exit values are not executable fills or alternate account PnL",
        "registration": "RD_EXPERIMENTS.md D53",
        "frozen_sha256": {
            **actual,
            "native_audit": AUDIT_SHA256,
            "input_identity": INPUT_SHA256,
            "h06_complete_four_hour_parity": PARITY_SHA256,
        },
        "native_positions": len(rows),
        "native_closed_positions": len(closed),
        "native_winning_closed_positions": 382,
        "landmarks_complete_four_hour_bars": list(LANDMARKS),
        "summary": _summarize(rows),
        "positions": rows,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", type=Path, required=True)
    parser.add_argument("--input-identity", type=Path, required=True)
    parser.add_argument("--parity", type=Path, required=True)
    parser.add_argument("--catalog-root", type=Path, required=True)
    parser.add_argument("--audit", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = diagnose(args.run, args.input_identity, args.parity, args.catalog_root, args.audit)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n")


if __name__ == "__main__":
    main()
