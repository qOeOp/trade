"""
Screen a frozen pre-entry support line against native H15a position paths.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
from bisect import bisect_right
from collections import Counter
from collections import defaultdict
from decimal import Decimal
from pathlib import Path

from audit_line_box_context import _read_candles
from diagnose_h15a_entry_persistence import AUDIT_SHA256
from diagnose_h15a_entry_persistence import FOUR_HOUR_NS
from diagnose_h15a_entry_persistence import _amount
from diagnose_h15a_entry_persistence import _close_cause
from diagnose_h15a_entry_persistence import _event_rows
from diagnose_h15a_entry_persistence import _load_inputs
from diagnose_h15a_entry_persistence import _ns
from diagnose_h15a_entry_persistence import _replay
from trendline_strategy import MAX_LINE_EXTENSION
from trendline_strategy import MIN_ANCHOR_SPAN
from trendline_strategy import PIVOT_ORDER
from trendline_strategy import ConfirmedLineSupportTouches

from vibe_trading.persistence import ParquetDataCatalog


D53_READER_SHA256 = "e087df1aee7cced6fb5c0db45bfa79a2bb2bcf646da89c1ca429471e121c16f8"
D53_JSON_SHA256 = "a47d460b04f96dd907e33cf67f4aafaf229eb824091c03a04351b2c774e7b2ef"
D54_SOURCE_SHA256 = "302f115a90cbb06037956f590c3516b1192389b3b94d32e8f0f74938c670b3ba"
MIN_CLOSED_EVENTS = 30
MIN_INDICATIVE_GAIN_USDT = Decimal(5000)


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _verify_dependencies(d53_reader: Path, d53_full_gzip: Path, d54_source: Path) -> None:
    if _sha(d53_reader) != D53_READER_SHA256:
        raise RuntimeError("D53 native Position reader changed from preregistration")
    if hashlib.sha256(gzip.decompress(d53_full_gzip.read_bytes())).hexdigest() != D53_JSON_SHA256:
        raise RuntimeError("D53 full read changed from preregistration")
    if _sha(d54_source) != D54_SOURCE_SHA256:
        raise RuntimeError("D54 source evidence changed from preregistration")


def _line_state_at_closes(candles: list) -> list[dict]:
    state = ConfirmedLineSupportTouches()
    snapshots = []
    for i, candle in enumerate(candles):
        state.on_closed(candle, None)
        pair = state.low_pivots[-2:]
        if len(pair) < 2:
            snapshots.append({"reason": "fewer_than_two_confirmed_lows"})
            continue
        j1, j2 = pair
        p1, p2 = state.candles[j1].low, state.candles[j2].low
        if p2 <= p1:
            reason = "latest_pair_not_rising"
        elif j2 - j1 < MIN_ANCHOR_SPAN:
            reason = "anchor_span_too_short"
        elif i - j2 > MAX_LINE_EXTENSION:
            reason = "latest_pair_too_old"
        elif (j1, j2) in state.dead_pairs:
            reason = "latest_pair_already_broken"
        else:
            reason = None
        projected = state._latest_rising_line(i)
        if reason is not None or projected is None:
            snapshots.append({"reason": reason or "no_valid_projected_line"})
            continue
        selected, _, slope, line = projected
        if selected != (j1, j2) or j2 + PIVOT_ORDER > i:
            raise RuntimeError("H08 entry-time line pivot was not causally confirmed")
        snapshots.append(
            {
                "reason": None,
                "j1": j1,
                "j2": j2,
                "low1": str(p1),
                "low2": str(p2),
                "slope_per_four_hour_bar": str(slope),
                "line_at_entry_bar": str(line),
            },
        )
    return snapshots


def _first_stop(first_fill: dict, orders: dict[str, dict], stop_by_parent: dict) -> Decimal:
    order_id = first_fill["client_order_id"]
    if orders[order_id]["tags"] != "['ENTRY']":
        raise RuntimeError(f"native first fill was not an entry: {order_id}")
    stops = stop_by_parent[order_id]
    if len(stops) != 1:
        raise RuntimeError(f"native first fill lacks unique stop: {order_id}")
    stop = Decimal(stops[0]["trigger_price"])
    if stop >= Decimal(first_fill["last_px"]):
        raise RuntimeError(f"native first fill has nonpositive R: {order_id}")
    return stop


def _validated_native_position(row: dict, instrument):
    fills, adjustments = _event_rows(row)
    first = fills[0]
    if first["client_order_id"] != row["opening_order_id"] or first["order_side"] != "BUY":
        raise RuntimeError(f"native opening fill differs: {row['position_id']}")
    actual = _replay(instrument, fills, adjustments, None)
    final_pnl = _amount(actual.realized_pnl)
    if abs(final_pnl - _amount(row["realized_pnl"])) > Decimal("0.000001"):
        raise RuntimeError(f"native position PnL differs: {row['position_id']}")
    return fills, adjustments, first, final_pnl


def _event_row(
    row: dict,
    candles: list,
    snapshots: list[dict],
    instrument,
    orders: dict[str, dict],
    stop_by_parent: dict,
) -> dict:
    fills, adjustments, first, final_pnl = _validated_native_position(row, instrument)
    first_ns = first["ts_event"]
    close_times = [candle.ts_event for candle in candles]
    entry_i = bisect_right(close_times, first_ns) - 1
    cause = _close_cause(row, orders)
    base = {
        "position_id": row["position_id"],
        "instrument_id": row["instrument_id"],
        "first_fill_ns": first_ns,
        "first_entry_px": first["last_px"],
        "native_close_cause": cause,
        "native_final_realized_pnl_usdt": str(final_pnl),
    }
    if entry_i < 0:
        raise RuntimeError(f"no completed bar before first fill: {row['position_id']}")
    line = snapshots[entry_i]
    if line["reason"] is not None:
        return {**base, "state": "no_preentry_line", "no_line_reason": line["reason"]}
    j2 = line["j2"]
    p2 = Decimal(line["low2"])
    slope = Decimal(line["slope_per_four_hour_bar"])
    first_eligible_ns = first_ns + FOUR_HOUR_NS
    closed_ns = _ns(row["ts_closed"]) if row["ts_closed"] else None
    for i in range(entry_i + 1, len(candles)):
        candle = candles[i]
        if candle.ts_event < first_eligible_ns:
            continue
        if closed_ns is not None and closed_ns <= candle.ts_event:
            return {**base, "state": "closed_censored", "line": line}
        if i - j2 > MAX_LINE_EXTENSION:
            return {**base, "state": "line_expired", "line": line}
        projected = p2 + slope * (i - j2)
        if Decimal(str(candle.close)) >= projected:
            continue
        mark_position = _replay(instrument, fills, adjustments, candle.ts_event)
        if not mark_position.is_open:
            raise RuntimeError(
                f"line event found after native position close: {row['position_id']}",
            )
        mark_px = Decimal(str(candle.close))
        native_mark = _amount(mark_position.total_pnl(instrument.make_price(mark_px)))
        fee = (
            mark_px
            * _amount(mark_position.quantity)
            * _amount(instrument.multiplier)
            * _amount(instrument.taker_fee)
        )
        indicative_exit = native_mark - fee
        entry_px = Decimal(first["last_px"])
        stop = _first_stop(first, orders, stop_by_parent)
        return {
            **base,
            "state": "line_broken_while_open",
            "line": line,
            "event_four_hour_close_ns": candle.ts_event,
            "event_age_complete_bars": i - entry_i - 1,
            "event_projected_line": str(projected),
            "event_last_close": str(mark_px),
            "event_close_first_r": str((mark_px - entry_px) / (entry_px - stop)),
            "native_mark_pnl_usdt": str(native_mark),
            "indicative_taker_exit_fee_usdt": str(fee),
            "indicative_exit_pnl_usdt": str(indicative_exit),
            "actual_continuation_minus_indicative_usdt": (
                str(final_pnl - indicative_exit) if closed_ns is not None else None
            ),
            "later_entry_after_event": any(
                item["order_side"] == "BUY" and item["ts_event"] > candle.ts_event for item in fills
            ),
        }
    return {
        **base,
        "state": "closed_censored" if closed_ns is not None else "run_end_censored",
        "line": line,
    }


def _summarize(rows: list[dict]) -> dict:
    states = Counter(row["state"] for row in rows)
    events = [row for row in rows if row["state"] == "line_broken_while_open"]
    settled = [row for row in events if row["native_close_cause"] != "open_at_end"]
    delta = sum(
        (Decimal(row["actual_continuation_minus_indicative_usdt"]) for row in settled),
        Decimal(0),
    )
    if sum(states.values()) != 686:
        raise RuntimeError("H15a position state coverage incomplete")
    return {
        "states": dict(states),
        "no_preentry_line_reasons": dict(
            Counter(row["no_line_reason"] for row in rows if row["state"] == "no_preentry_line"),
        ),
        "native_line_break_events": len(events),
        "eventually_closed_events": len(settled),
        "eventual_winners": sum(
            Decimal(row["native_final_realized_pnl_usdt"]) > 0 for row in settled
        ),
        "eventual_target_exits": sum(row["native_close_cause"] == "target" for row in settled),
        "eventual_target_pnl_usdt": str(
            sum(
                (
                    Decimal(row["native_final_realized_pnl_usdt"])
                    for row in settled
                    if row["native_close_cause"] == "target"
                ),
                Decimal(0),
            ),
        ),
        "later_entry_after_event": sum(row["later_entry_after_event"] for row in events),
        "actual_continuation_minus_indicative_sum_usdt": str(delta),
        "indicative_exit_improvement_fixed_path_usdt": str(-delta),
        "capacity_screen_pass": len(settled) >= MIN_CLOSED_EVENTS
        and -delta >= MIN_INDICATIVE_GAIN_USDT,
    }


def diagnose(
    run: Path,
    input_identity_path: Path,
    parity_path: Path,
    catalog_root: Path,
    audit_path: Path,
    d53_reader: Path,
    d53_full_gzip: Path,
    d54_source: Path,
) -> dict:
    _verify_dependencies(d53_reader, d53_full_gzip, d54_source)
    report_sha, identity, parity, orders, positions = _load_inputs(
        run,
        input_identity_path,
        parity_path,
        audit_path,
    )
    by_instrument: dict[str, list[dict]] = defaultdict(list)
    for row in positions:
        by_instrument[row["instrument_id"]].append(row)
    stop_by_parent: dict[str, list[dict]] = defaultdict(list)
    for order in orders.values():
        if order["type"] == "STOP_MARKET" and order["parent_order_id"]:
            stop_by_parent[order["parent_order_id"]].append(order)
    parity_by_coin = {row["coin"]: row for row in parity["coins"]}
    start_ns, end_ns = _ns(parity["start_utc"]), _ns(parity["end_utc"])
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
        snapshots = _line_state_at_closes(candles)
        catalog = ParquetDataCatalog(str(catalog_root / coin / "minute"))
        instrument = catalog.instruments(instrument_ids=[instrument_id])[0]
        rows.extend(
            _event_row(row, candles, snapshots, instrument, orders, stop_by_parent)
            for row in by_instrument.pop(instrument_id, [])
        )
        print(f"{coin}: {len(rows)} native positions reconciled", flush=True)
    if by_instrument:
        raise RuntimeError(f"unmapped H15a positions: {sorted(by_instrument)}")
    closed = [row for row in rows if row["native_close_cause"] != "open_at_end"]
    if len(rows) != 686 or len(closed) != 676 or len(rows) - len(closed) != 10:
        raise RuntimeError("H15a native position count changed")
    if sum(Decimal(row["native_final_realized_pnl_usdt"]) > 0 for row in closed) != 382:
        raise RuntimeError("H15a native winner count changed")
    return {
        "method": "read-only H08 completed-four-hour entry-time rising line against native H15a positions; indicative exit is not an executable fill",
        "registration": "RD_EXPERIMENTS.md D55",
        "frozen_sha256": {
            **report_sha,
            "native_audit": AUDIT_SHA256,
            "d53_reader": D53_READER_SHA256,
            "d53_full_uncompressed_json": D53_JSON_SHA256,
            "d54_source": D54_SOURCE_SHA256,
        },
        "rule": {
            "pivot_order": PIVOT_ORDER,
            "minimum_anchor_span_bars": MIN_ANCHOR_SPAN,
            "max_line_extension_bars": MAX_LINE_EXTENSION,
            "event": "first fully post-fill completed four-hour LAST close strictly below frozen entry-time rising line while native position remains open",
        },
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
    parser.add_argument("--d53-reader", type=Path, required=True)
    parser.add_argument("--d53-full-gzip", type=Path, required=True)
    parser.add_argument("--d54-source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = diagnose(
        args.run,
        args.input_identity,
        args.parity,
        args.catalog_root,
        args.audit,
        args.d53_reader,
        args.d53_full_gzip,
        args.d54_source,
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n")


if __name__ == "__main__":
    main()
