"""D96: read native H26a Positions at the first completed close below the lower tier."""

from __future__ import annotations

import argparse
import ast
import csv
import hashlib
import json
from bisect import bisect_left
from collections import Counter, defaultdict
from decimal import Decimal
from pathlib import Path

from nautilus_trader.model import OrderFilled, Position, PositionAdjusted

from audit_d80_brooks_breakout_context import native_bars
from readback_h26a_flow import read


ROOT = Path(__file__).resolve().parent
RESULTS = ROOT / "results"
IDENTITY = RESULTS / "2026-10-07-input-identity.json"
MANIFEST = RESULTS / "2026-10-09-h27a-manifest.json"
SUMMARY = RESULTS / "2026-10-09-h27a-control-h26a-summary.json"
AUDIT = RESULTS / "2026-10-09-h27a-control-h26a-native-audit.json"
CLOCK = RESULTS / "2026-10-09-h26a-37-support-clock.json"
PARITY = RESULTS / "2026-10-09-h27a-control-h26a-parity.json"
KNOWN = {
    IDENTITY: "ce9963ca68c66d34af74dbdbfff484f320a622fa73afe64844518aed354ec9fc",
    SUMMARY: "64e47b3653a049ea16fb92002d4e63f47f8b563be67856e4c59ff24fb2bbaf06",
}


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def amount(value: object) -> Decimal:
    return Decimal(str(value).split()[0])


def replay(instrument, fills: list[dict], adjustments: list[dict], through: int | None):
    sequence = [(int(row["ts_event"]), 0, row) for row in fills]
    sequence.extend((int(row["ts_event"]), 1, row) for row in adjustments)
    sequence.sort(key=lambda row: (row[0], row[1]))
    position = None
    for timestamp, kind, raw in sequence:
        if through is not None and timestamp > through:
            break
        if kind == 0:
            event = OrderFilled.from_dict(raw)
            if position is None:
                position = Position(instrument, event)
            else:
                position.apply(event)
        else:
            if position is None:
                raise RuntimeError("funding before native opening fill")
            position.apply_adjustment(PositionAdjusted.from_dict(raw))
    if position is None:
        raise RuntimeError("missing native opening fill")
    return position


def inspect(position: dict, parents: list[dict], orders: dict, instrument, bars: list[dict]) -> dict:
    if len(parents) != 2:
        raise RuntimeError("expected two native entry parents")
    parent_prices = sorted((Decimal(order["price"]) for order in parents), reverse=True)
    lower = parent_prices[1]
    if lower != Decimal(str(instrument.make_price(float(lower)))):
        raise RuntimeError("lower tier violates native Instrument tick")
    fills = ast.literal_eval(position["events"])
    adjustments = ast.literal_eval(position["adjustments"])
    if not fills or any(event["type"] != "OrderFilled" for event in fills):
        raise RuntimeError("invalid native fill event list")
    if any(event["type"] != "PositionAdjusted" for event in adjustments):
        raise RuntimeError("invalid native funding adjustment list")
    buys = [event for event in fills if event["order_side"] == "BUY"]
    if not buys or buys[0]["client_order_id"] != position["opening_order_id"]:
        raise RuntimeError("native opening fill does not match parent")
    if any(event["client_order_id"] not in {order["client_order_id"] for order in parents} for event in buys):
        raise RuntimeError("unexpected BUY parent outside source bundle")
    first_ns = int(buys[0]["ts_event"])
    first_px = Decimal(buys[0]["last_px"])
    first_parent = orders[buys[0]["client_order_id"]]
    native_stop = [order for order in orders.values() if order["order_list_id"] == first_parent["order_list_id"] and order["tags"] == "['STOP_LOSS']"]
    if len(native_stop) != 1:
        raise RuntimeError("native first parent lacks unique OTO stop")
    stop = Decimal(native_stop[0]["trigger_price"])
    risk = first_px - stop
    if not 0 < stop < first_px or risk <= 0:
        raise RuntimeError("invalid first-fill R")
    final = replay(instrument, fills, adjustments, None)
    final_pnl = amount(final.realized_pnl)
    if abs(final_pnl - amount(position["realized_pnl"])) > Decimal("0.000001"):
        raise RuntimeError("Nautilus Position final realized PnL mismatch")
    closed = bool(position["ts_closed"])
    if closed != (not final.is_open):
        raise RuntimeError("Nautilus Position close state mismatch")
    close_event_ns = max((int(event["ts_event"]) for event in fills if event["order_side"] == "SELL"), default=None)
    if closed and close_event_ns is None:
        raise RuntimeError("closed native Position lacks SELL fill")
    if not closed and close_event_ns is not None:
        raise RuntimeError("open native Position contains SELL fill")
    close_order = orders[position["closing_order_id"]] if closed else None
    cause = {"STOP_MARKET": "stop", "LIMIT": "target", "MARKET": "time_market"}.get(close_order["type"]) if close_order else "open"
    if cause is None:
        raise RuntimeError("unknown native closing order type")
    ends = [bar["end_ns"] for bar in bars]
    first_i = bisect_left(ends, first_ns)
    if first_i >= len(bars):
        raise RuntimeError("native fill outside verified Catalog")
    event_i = next((i for i in range(first_i + 1, len(bars)) if Decimal(str(bars[i]["close"])) < lower and (close_event_ns is None or close_event_ns > bars[i]["end_ns"])), None)
    # A close after the real exit is not a decision on this Position.
    if event_i is not None and close_event_ns is not None:
        if any(Decimal(str(bar["close"])) < lower for bar in bars[first_i + 1 : event_i] if bar["end_ns"] >= close_event_ns):
            raise RuntimeError("candidate event crosses native close")
    result = {
        "position_id": position["position_id"],
        "first_fill_ns": first_ns,
        "first_fill_price": str(first_px),
        "initial_stop": str(stop),
        "lower_planned_tier": str(lower),
        "native_final_exit": cause,
        "native_closed_realized_pnl_usdt": str(final_pnl) if closed else None,
        "native_positive_close": final_pnl > 0 if closed else None,
        "event": None,
    }
    if event_i is None:
        return result
    bar = bars[event_i]
    snapshot = replay(instrument, fills, adjustments, bar["end_ns"])
    if not snapshot.is_open:
        raise RuntimeError("event native Position is already flat")
    close = Decimal(str(bar["close"]))
    mark = amount(snapshot.total_pnl(instrument.make_price(close)))
    exit_fee = close * amount(snapshot.quantity) * amount(instrument.multiplier) * amount(instrument.taker_fee)
    indicative = mark - exit_fee
    path = bars[first_i + 1 : event_i + 1]
    result["event"] = {
        "completed_close_ns": bar["end_ns"],
        "post_fill_complete_bars": len(path),
        "close_r": float((close - first_px) / risk),
        "mfe_r": float((Decimal(str(max(item["high"] for item in path))) - first_px) / risk),
        "mae_r": float((Decimal(str(min(item["low"] for item in path))) - first_px) / risk),
        "distinct_native_buy_parents_at_event": len({item["client_order_id"] for item in buys if int(item["ts_event"]) <= bar["end_ns"]}),
        "later_native_buy_fill": any(int(item["ts_event"]) > bar["end_ns"] for item in buys),
        "native_open_quantity": str(snapshot.quantity),
        "native_mark_pnl_usdt": str(mark),
        "indicative_taker_exit_fee_usdt": str(exit_fee),
        "indicative_full_exit_pnl_usdt": str(indicative),
        "native_continuation_minus_indicative_usdt": str(final_pnl - indicative) if closed else None,
    }
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--detail", type=Path, required=True)
    args = parser.parse_args()
    for path, known in KNOWN.items():
        if digest(path) != known:
            raise RuntimeError(f"registered input digest changed: {path}")
    manifest = json.loads(MANIFEST.read_text())
    for path in (SUMMARY, AUDIT, PARITY):
        if manifest["artifact_sha256"][path.name] != digest(path):
            raise RuntimeError(f"frozen H27a manifest does not bind {path}")
    for path in (AUDIT, CLOCK):
        if not json.loads(path.read_text())["passed"]:
            raise RuntimeError(f"native prerequisite failed: {path}")
    if not json.loads(PARITY.read_text())["parity_passed"]:
        raise RuntimeError("same-code H26a control failed frozen native parity")
    data = read(args.run)
    if data["summary"]["signal_variant"] != "support-broad-any-prior-a-support-4h":
        raise RuntimeError("wrong native control Strategy")
    if digest(args.run / "summary.json") != digest(SUMMARY):
        raise RuntimeError("native control summary does not match frozen same-code report")
    identity = json.loads(IDENTITY.read_text())
    catalogs = {row["coin"]: row["minute_catalog"]["sha256"] for row in identity["coins"]}
    if len(catalogs) != 37:
        raise RuntimeError("registered 37-coin universe changed")
    with (args.run / "orders.csv").open(newline="") as stream:
        orders = {row["client_order_id"]: row for row in csv.DictReader(stream)}
    by_coin = defaultdict(list)
    for key, parents in data["bundles"].items():
        for position in data["outcomes"].get(key, []):
            by_coin[key[0]].append((position, parents))
    details = []
    for coin in sorted(catalogs):
        instrument, bars, count = native_bars(Path(identity["minute_catalog_root"]), coin, catalogs[coin])
        if count != 105222:
            raise RuntimeError(f"{coin}: native LAST bar count changed")
        for position, parents in by_coin[coin]:
            row = inspect(position, parents, orders, instrument, bars)
            row["coin"] = coin
            details.append(row)
    closed = [row for row in details if row["native_final_exit"] != "open"]
    events = [row for row in details if row["event"] is not None]
    closed_events = [row for row in events if row["native_final_exit"] != "open"]
    if len(details) != 179 or len(closed) != 170 or sum(row["native_positive_close"] for row in closed) != 85:
        raise RuntimeError("H26a native Position population changed")
    gain = sum((-Decimal(row["event"]["native_continuation_minus_indicative_usdt"]) for row in closed_events), Decimal(0))
    result = {
        "method": "one preregistered read-only D96 native Position/Catalog path; indicative exit is not a fill or account result",
        "registration_commit": "81d7b524c",
        "source_case": "C18/S24; exact lower-tier close is a researcher proxy, not an author exit rule",
        "exposed_input_window_utc": ["2025-10-07T00:00:00Z", "2026-10-07T08:30:00Z"],
        "input_sha256": {"manifest": digest(MANIFEST), "identity": digest(IDENTITY), "native_reports": data["sha256"], "native_audit": digest(AUDIT), "decision_clock": digest(CLOCK)},
        "catalogs_verified": len(catalogs),
        "native_positions": len(details),
        "native_closed": len(closed),
        "native_positive_closed": sum(row["native_positive_close"] for row in closed),
        "native_open_censored": len(details) - len(closed),
        "event_positions": len(events),
        "event_closed": len(closed_events),
        "event_open_censored": len(events) - len(closed_events),
        "event_final_exits": dict(Counter(row["native_final_exit"] for row in events)),
        "event_eventual_positive_closed": sum(row["native_positive_close"] for row in closed_events),
        "event_target_winners": sum(row["native_final_exit"] == "target" and row["native_positive_close"] for row in closed_events),
        "event_later_native_buy_fill": sum(row["event"]["later_native_buy_fill"] for row in events),
        "event_one_tier_at_decision": sum(row["event"]["distinct_native_buy_parents_at_event"] == 1 for row in events),
        "non_event_final_exits": dict(Counter(row["native_final_exit"] for row in details if row["event"] is None)),
        "indicative_exit_minus_native_continuation_closed_sum_usdt": str(gain),
        "registered_capacity_gate": len(closed_events) >= 30 and gain > Decimal("6000"),
        "caution": "Selected observed survivors and indicative LAST-close/taker exit cannot identify causal shared-account improvement; this exposed year is not independent validation.",
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    args.detail.write_text(json.dumps(details, indent=2) + "\n")


if __name__ == "__main__":
    main()
