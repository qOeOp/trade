"""D98: read one preregistered pre-fill local-support event from native H26a Positions."""

from __future__ import annotations

import argparse
import ast
import csv
import json
from bisect import bisect_left
from bisect import bisect_right
from collections import Counter, defaultdict
from decimal import Decimal
from pathlib import Path

from audit_d80_brooks_breakout_context import native_bars
from diagnose_d96_tier_support_close import AUDIT, CLOCK, IDENTITY, KNOWN, MANIFEST, PARITY, SUMMARY
from diagnose_d96_tier_support_close import amount, digest, replay
from readback_h26a_flow import read


REGISTRATION = "a3566ea70"
SOURCE = "https://www.youtube.com/watch?v=wDlDZ2iNxik"
PIVOT_ORDER = 8
ANCHOR_LOOKBACK = 180


def frozen_support(bars: list[dict], last_closed_i: int, stop: Decimal, first_px: Decimal) -> tuple[int, Decimal] | None:
    """Select only a fully confirmed, still unbroken pivot known by first fill."""
    if last_closed_i < 2 * PIVOT_ORDER:
        return None
    start = max(PIVOT_ORDER, last_closed_i - ANCHOR_LOOKBACK + 1 + PIVOT_ORDER)
    for j in range(last_closed_i - PIVOT_ORDER, start - 1, -1):
        low = Decimal(str(bars[j]["low"]))
        if not stop < low < first_px:
            continue
        if low != min(Decimal(str(item["low"])) for item in bars[j - PIVOT_ORDER : j + PIVOT_ORDER + 1]):
            continue
        if any(Decimal(str(item["close"])) <= low for item in bars[j + 1 : last_closed_i + 1]):
            continue
        return j, low
    return None


def inspect(position: dict, parents: list[dict], orders: dict, instrument, bars: list[dict]) -> dict:
    if len(parents) != 2:
        raise RuntimeError("expected two native tier parents")
    fills = ast.literal_eval(position["events"])
    adjustments = ast.literal_eval(position["adjustments"])
    if not fills or any(event["type"] != "OrderFilled" for event in fills):
        raise RuntimeError("native Position has invalid fills")
    if any(event["type"] != "PositionAdjusted" for event in adjustments):
        raise RuntimeError("native Position has invalid funding adjustments")
    buys = [event for event in fills if event["order_side"] == "BUY"]
    sells = [event for event in fills if event["order_side"] == "SELL"]
    parent_ids = {parent["client_order_id"] for parent in parents}
    if not buys or buys[0]["client_order_id"] != position["opening_order_id"]:
        raise RuntimeError("opening native fill is not the Position opener")
    if any(event["client_order_id"] not in parent_ids for event in buys):
        raise RuntimeError("native BUY fill is outside the source tier bundle")
    first_ns = int(buys[0]["ts_event"])
    first_px = Decimal(buys[0]["last_px"])
    first_parent = orders[buys[0]["client_order_id"]]
    stops = [
        order for order in orders.values()
        if order["order_list_id"] == first_parent["order_list_id"]
        and order["tags"] == "['STOP_LOSS']"
    ]
    if len(stops) != 1:
        raise RuntimeError("first native entry lacks one OTO stop")
    stop = Decimal(stops[0]["trigger_price"])
    risk = first_px - stop
    if risk <= 0:
        raise RuntimeError("invalid first-fill initial R")
    final = replay(instrument, fills, adjustments, None)
    final_pnl = amount(final.realized_pnl)
    if abs(final_pnl - amount(position["realized_pnl"])) > Decimal("0.000001"):
        raise RuntimeError("native Position PnL reconstruction differs")
    closed = bool(position["ts_closed"])
    if closed != (not final.is_open) or closed != bool(sells):
        raise RuntimeError("native Position close state differs")
    close_ns = max((int(event["ts_event"]) for event in sells), default=None)
    closing_order = orders[position["closing_order_id"]] if closed else None
    cause = {"STOP_MARKET": "stop", "LIMIT": "target", "MARKET": "time_market"}.get(
        closing_order["type"]
    ) if closing_order else "open"
    if cause is None:
        raise RuntimeError("unclassified native exit")
    ends = [bar["end_ns"] for bar in bars]
    fill_index = bisect_left(ends, first_ns)
    if fill_index >= len(bars):
        raise RuntimeError("native fill outside verified LAST Catalog")
    last_closed_i = bisect_right(ends, first_ns) - 1
    support = frozen_support(bars, last_closed_i, stop, first_px)
    event_index = None
    if support is not None:
        for index in range(fill_index + 1, len(bars)):
            end = bars[index]["end_ns"]
            if close_ns is not None and close_ns <= end:
                break
            if Decimal(str(bars[index]["close"])) < support[1]:
                event_index = index
                break
    result = {
        "position_id": position["position_id"],
        "first_fill_ns": first_ns,
        "first_fill_price": str(first_px),
        "initial_stop": str(stop),
        "support": {"pivot_end_ns": bars[support[0]]["end_ns"], "pivot_low": str(support[1])} if support else None,
        "support_selection_last_closed_ns": bars[last_closed_i]["end_ns"] if last_closed_i >= 0 else None,
        "native_final_exit": cause,
        "native_closed_realized_pnl_usdt": str(final_pnl) if closed else None,
        "native_positive_close": final_pnl > 0 if closed else None,
        "event": None,
    }
    if event_index is None:
        return result
    bar = bars[event_index]
    snapshot = replay(instrument, fills, adjustments, bar["end_ns"])
    if not snapshot.is_open:
        raise RuntimeError("event was observed after native Position closed")
    close = Decimal(str(bar["close"]))
    mark_pnl = amount(snapshot.total_pnl(instrument.make_price(close)))
    fee = close * amount(snapshot.quantity) * amount(instrument.multiplier) * amount(instrument.taker_fee)
    indicative = mark_pnl - fee
    path = bars[fill_index + 1 : event_index + 1]
    result["event"] = {
        "completed_close_ns": bar["end_ns"],
        "post_fill_complete_bars": len(path),
        "close_r": float((close - first_px) / risk),
        "close_minus_support_r": float((close - support[1]) / risk),
        "mfe_r": float((Decimal(str(max(item["high"] for item in path))) - first_px) / risk),
        "mae_r": float((Decimal(str(min(item["low"] for item in path))) - first_px) / risk),
        "distinct_native_buy_parents_at_event": len({
            event["client_order_id"] for event in buys
            if int(event["ts_event"]) <= bar["end_ns"]
        }),
        "later_native_buy_fill": any(int(event["ts_event"]) > bar["end_ns"] for event in buys),
        "native_open_quantity": str(snapshot.quantity),
        "native_mark_pnl_usdt": str(mark_pnl),
        "indicative_taker_exit_fee_usdt": str(fee),
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
    for path, expected in KNOWN.items():
        if digest(path) != expected:
            raise RuntimeError(f"frozen native input digest changed: {path}")
    manifest = json.loads(MANIFEST.read_text())
    for path in (SUMMARY, AUDIT, PARITY):
        if manifest["artifact_sha256"][path.name] != digest(path):
            raise RuntimeError(f"frozen H26a control is not bound by manifest: {path}")
    for path in (AUDIT, CLOCK):
        if not json.loads(path.read_text())["passed"]:
            raise RuntimeError(f"native prerequisite failed: {path}")
    if not json.loads(PARITY.read_text())["parity_passed"]:
        raise RuntimeError("same-code H26a control parity failed")
    data = read(args.run)
    if data["summary"]["signal_variant"] != "support-broad-any-prior-a-support-4h":
        raise RuntimeError("wrong native H26a control Strategy")
    if digest(args.run / "summary.json") != digest(SUMMARY):
        raise RuntimeError("native H26a control report identity changed")
    identity = json.loads(IDENTITY.read_text())
    catalogs = {row["coin"]: row["minute_catalog"]["sha256"] for row in identity["coins"]}
    if len(catalogs) != 37:
        raise RuntimeError("registered 37-coin input changed")
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
            raise RuntimeError(f"{coin}: verified native LAST bar count changed")
        for position, parents in by_coin[coin]:
            row = inspect(position, parents, orders, instrument, bars)
            row["coin"] = coin
            details.append(row)
    closed = [row for row in details if row["native_final_exit"] != "open"]
    events = [row for row in details if row["event"] is not None]
    closed_events = [row for row in events if row["native_final_exit"] != "open"]
    if len(details) != 179 or len(closed) != 170 or sum(row["native_positive_close"] for row in closed) != 85:
        raise RuntimeError("native H26a Position population changed")
    improvement = sum(
        (-Decimal(row["event"]["native_continuation_minus_indicative_usdt"]) for row in closed_events),
        Decimal(0),
    )
    result = {
        "method": "one preregistered read-only D98 native Position/Catalog path; indicative exit is not a fill or account result",
        "registration_commit": REGISTRATION,
        "source": SOURCE,
        "exposed_input_window_utc": ["2025-10-07T00:00:00Z", "2026-10-07T08:30:00Z"],
        "input_sha256": {
            "manifest": digest(MANIFEST),
            "identity": digest(IDENTITY),
            "native_reports": data["sha256"],
            "native_audit": digest(AUDIT),
            "decision_clock": digest(CLOCK),
            "same_code_parity": digest(PARITY),
        },
        "catalogs_verified": len(catalogs),
        "native_positions": len(details),
        "native_closed": len(closed),
        "native_positive_closed": sum(row["native_positive_close"] for row in closed),
        "native_open_censored": len(details) - len(closed),
        "eligible_pre_fill_support_positions": sum(row["support"] is not None for row in details),
        "no_eligible_pre_fill_support_positions": sum(row["support"] is None for row in details),
        "event_positions": len(events),
        "event_closed": len(closed_events),
        "event_open_censored": len(events) - len(closed_events),
        "event_final_exits": dict(Counter(row["native_final_exit"] for row in events)),
        "event_eventual_positive_closed": sum(row["native_positive_close"] for row in closed_events),
        "event_target_winners": sum(row["native_final_exit"] == "target" and row["native_positive_close"] for row in closed_events),
        "event_later_native_buy_fill": sum(row["event"]["later_native_buy_fill"] for row in events),
        "event_one_tier_at_decision": sum(row["event"]["distinct_native_buy_parents_at_event"] == 1 for row in events),
        "non_event_final_exits": dict(Counter(row["native_final_exit"] for row in details if row["event"] is None)),
        "indicative_exit_minus_native_continuation_closed_sum_usdt": str(improvement),
        "registered_capacity_gate": len(closed_events) >= 30 and improvement > Decimal("6000"),
        "caution": "Observed survivor paths and a descriptive LAST-close/taker exit are not a causal shared-account result. The annual data are exposed development evidence.",
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    args.detail.write_text(json.dumps(details, indent=2) + "\n")


if __name__ == "__main__":
    main()
