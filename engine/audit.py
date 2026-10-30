"""Audit native report integrity and reconcile reported economics for every native run.

Besides reconciling the reports, the audit replays the native order event history and refuses a
run in which a position stays larger than its working reduce-only stop orders for more than one
one-minute execution bar, unless the strategy declares ``USES_STOP_LOSS = False``, and checks that
every contract terminated without a settlement price was flat with no working order before its
termination. Outside receipt-derived entry membership, only native reduce-only orders may operate;
old entries must have no unfilled remainder. Strategy geometry belongs in ``replay_integrity_findings``.
Every finding starts with a code of FINDINGS.
"""

from __future__ import annotations

import argparse
import ast
from collections import Counter, defaultdict
import gzip
import hashlib
import json
import sys
from decimal import Decimal
from itertools import pairwise
from pathlib import Path
from typing import TypedDict

import pandas as pd

from engine.native_csv import dict_reader


REPORTS = ("summary.json", "orders.csv", "fills.csv", "positions.csv", "account.csv", "returns_series.csv",
           "order_events.jsonl.gz")
COVERAGE = "input-coverage.json"  # the coverage receipt, in the report directory's parent
LIFECYCLE_COUNTS = ("instrument_status", "instrument_close")
TERMINAL = {"FILLED", "CANCELED", "EXPIRED", "DENIED", "REJECTED"}
OPEN = {"ACCEPTED", "PARTIALLY_FILLED", "SUBMITTED", "PENDING_UPDATE"}
ORDER_EVENTS = "order_events.jsonl.gz"
BAR_NS = 60_000_000_000  # one execution bar (engine.config.EXECUTION_BAR_MINUTES)
STOP_TYPES = {"STOP_MARKET", "STOP_LIMIT", "TRAILING_STOP_MARKET", "TRAILING_STOP_LIMIT"}
ENDING_EVENTS = {"OrderCanceled": "CANCELED", "OrderExpired": "EXPIRED",
                 "OrderDenied": "DENIED", "OrderRejected": "REJECTED"}
PASSIVE_EVENTS = {"OrderSubmitted", "OrderEmulated", "OrderReleased", "OrderTriggered", "OrderPendingUpdate",
                  "OrderPendingCancel", "OrderModifyRejected", "OrderCancelRejected"}


FINDINGS: dict[str, str] = {
    "REPORT_FIELDS_MISSING": "A report lacks a required column or scope field.",
    "ORDER_STATUS_UNKNOWN": "An order status is neither a known terminal nor an in-flight status.",
    "IDENTITY_MISSING_OR_DUPLICATED": "A client order, fill event or position ID is empty or repeats.",
    "ORDER_LINK_INVALID": "A contingent link names a missing order, the order itself or another scope.",
    "INTEGRITY_REPORTED_FAILED": "The summary reports an integrity failure, or orders were denied or rejected.",
    "DENIED_REJECTED_COUNT_MISMATCH": "The denied or rejected order counts differ from the summary.",
    "LIFECYCLE_COVERAGE_MISSING": "The summary counts lifecycle events but the coverage receipt is missing.",
    "ORDER_FILL_MISMATCH": "A fill has no unique order of its scope, quantities or commissions differ, a FILLED order "
                           "is not complete, or a quantity, price or side is invalid.",
    "POSITION_FILL_COVERAGE_MISMATCH": "Position events do not cover every fill exactly once, or quantities, links "
                                       "or commissions differ from the fills.",
    "FUNDING_BALANCE_MISMATCH": "An adjustment is not FUNDING, or funding differs from the account balance change.",
    "ACCOUNT_REPORT_INCONSISTENT": "total != locked + free, another currency or account, time disorder or no rows.",
    "SUMMARY_TOTALS_MISMATCH": "Starting balance, realized PnL, flat final equity or closed counts differ from the "
                               "summary.",
    "REPORT_PAYLOAD_INVALID": "A report field has a wrong type, reading or arithmetic failed, or the order event "
                              "history cannot be replayed (EVENT_PAYLOAD_INVALID).",
    "ORDER_EVENT_HISTORY_MISSING": "The report directory has no order event history.",
    "TRADE_START_INVALID": "Runner-owned per-strategy trading starts are missing, invalid or inconsistent with inputs.",
    "ORDER_BEFORE_TRADE_START": "An order was submitted or emulated before its strategy instance's trading start.",
    "ENTRY_SCOPE_INVALID": "The trusted membership/lifecycle scope or a native reduce-only flag is missing or invalid.",
    "ENTRY_ORDER_OUTSIDE_MEMBERSHIP": "A non-reduce-only order was submitted, filled or left working outside its entry intervals.",
    "EVENT_ORDER_SET_MISMATCH": "The event history and the orders report hold different orders.",
    "EVENT_NOT_INITIALIZED": "An order's events do not start with exactly one initialization.",
    "EVENT_OUT_OF_ORDER": "An order's events go back in time.",
    "EVENT_SCOPE_CHANGED": "An order's events change strategy, instrument or account.",
    "EVENT_ORDER_STATE_MISMATCH": "The event history's status, quantity, filled quantity, side or type differs from "
                                  "the orders report.",
    "EVENT_FILL_MISMATCH": "The event history's fills differ from the fills report.",
    "STOP_LOSS_DECLARATION_INVALID": "The summary's strategy_uses_stop_loss is not a boolean.",
    "UNPROTECTED_POSITION": "A position exceeded its working reduce-only stops for longer than one execution bar.",
    "LIFECYCLE_NATIVE_COUNT_INVALID": "A native lifecycle count is not a nonnegative integer, or an instance repeats.",
    "LIFECYCLE_BUNDLE_MISSING": "Native lifecycle events exist but the inputs name no lifecycle bundle.",
    "LIFECYCLE_COVERAGE_MISMATCH": "The coverage receipt's format, window or market commit differs from the summary.",
    "LIFECYCLE_COUNT_MISMATCH": "Receipt, episode and native lifecycle counts disagree.",
    "LIFECYCLE_EVENT_INVALID": "A lifecycle event is not native, has inconsistent clocks or an invalid close.",
    "LIFECYCLE_DUPLICATE_EVENT": "A termination of one type, instance and time appears twice.",
    "LIFECYCLE_EVIDENCE_INCONSISTENT": "Positions do not cover a terminated contract's fills exactly once, or its "
                                       "event fills differ from the fills report.",
    "POSITION_OPEN_AT_TERMINATION": "A native position was not flat before an unpriced termination.",
    "ORDER_OPEN_AT_TERMINATION": "An order was not filled or ended, or had an update in flight, before an unpriced "
                                 "termination.",
    "DATA_ENDS_WITHOUT_TERMINATION": "A contract's bars end more than the MARK carry limit before the window's end "
                                     "and before its lifecycle termination (or it has none).",
    "LATE_ORDER_EVENT": "An order of a terminated contract was created at or after its termination, or (without "
                        "a settlement price) has events at or after it.",
}


# The auditor's own outcomes (engine.audit_main): exit 2 without a result, or exit 1 with findings.
AUDIT_REFUSALS: dict[str, str] = {
    "REPORTS_INCOMPLETE": "A required report or the order event history is missing or empty; nothing is audited.",
    "SUMMARY_UNREADABLE": "summary.json is missing, unreadable or not a JSON object; nothing is audited.",
    "AUDIT_FINDINGS": "The audit result holds findings; it was written.",
}


def outcome(code: str, detail: str) -> str:
    AUDIT_REFUSALS[code]
    return f"{code}: {detail}"


def finding(code: str, detail: str) -> str:
    """One finding: a catalogued code and its locating detail."""
    FINDINGS[code]  # an uncatalogued code is a KeyError
    return f"{code}: {detail}"


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _decimal(value) -> Decimal:
    return Decimal(str(value))


def _rows(run: Path, name: str) -> list[dict]:
    with (run / f"{name}.csv").open(newline="") as stream:
        return list(dict_reader(stream))


def _list(value: str) -> list:
    result = ast.literal_eval(value) if value else []
    if not isinstance(result, list):
        raise ValueError("native report list field is not a list")
    return result


def _money(value: str) -> Decimal:
    amount, currency = value.split()
    if currency != "USDT":
        raise ValueError("native R1 report money must use USDT")
    result = _decimal(amount)
    if not result.is_finite():
        raise ValueError("native report money is not finite")
    return result


def _quantity(value: str) -> Decimal:
    result = _decimal(value)
    if not result.is_finite() or result < 0:
        raise ValueError("native report quantity is negative or not finite")
    return result


def _scope(row: dict) -> tuple:
    return tuple(row[name] for name in ("strategy_id", "instrument_id", "account_id"))


def _order_scope_matches(left: dict, right: dict) -> bool:
    # Dormant OTO children have no account_id until Nautilus activates them.
    return (all(left[name] == right[name] for name in ("strategy_id", "instrument_id"))
            and (not left["account_id"] or not right["account_id"]
                 or left["account_id"] == right["account_id"]))


def _ns_utc(value: int) -> str:
    return pd.Timestamp(value, tz="UTC").isoformat()


def read_order_events(path: Path) -> list[dict]:
    with gzip.open(path, "rt", encoding="utf-8") as stream:
        return [json.loads(line) for line in stream]


def submission_findings(events: list[dict], summary: dict, coverage: dict | None = None) -> list[str]:
    """engine.submission_findings: native submissions obey their submitting instance's runner-owned start.

    Initialization is preparation, not submission. OrderEmulated is the native acknowledgement of
    submission to the emulator, which need not produce OrderSubmitted until much later (or ever).
    """
    from engine.config import Refusal, parse_window
    from engine.load import strategy_id
    starts = summary.get("trade_start_by_strategy")
    try:
        window = parse_window(summary["input_start_utc"], summary["period_start_utc"], summary["period_end_utc"])
        if not isinstance(starts, dict) or not starts:
            raise ValueError("summary has no runner-owned trade_start_by_strategy")
        if any(not isinstance(key, str) or not key or type(value) is not int
               or not window.trade_start_ns <= value < window.end_ns for key, value in starts.items()):
            raise ValueError("instance starts must be integer nanoseconds inside the trading window")
        if coverage is not None:
            config = coverage["effective_config"]
            trusted = parse_window(config["start"], config["trade_start"], config["end"])
            if trusted != window:
                raise ValueError("summary window differs from the input coverage receipt")
            expected = {}
            for symbol, receipt in coverage["export_receipts"].items():
                for piece in receipt["pieces"]:
                    key = strategy_id(symbol, piece.get("index"))
                    if key in expected:
                        raise ValueError(f"duplicate exported strategy instance {key}")
                    expected[key] = max(window.trade_start_ns, (piece.get("episode") or {}).get("start_ns") or 0)
            if any(key not in expected or value < expected[key] for key, value in starts.items()):
                raise ValueError("instance start has no exported identity or precedes its listing")
    except (Refusal, KeyError, TypeError, ValueError, AttributeError) as exc:
        return [finding("TRADE_START_INVALID", str(exc))]
    findings, seen = [], set()
    for event in events:
        if event["type"] not in {"OrderSubmitted", "OrderEmulated"}:
            continue
        strategy, order = event["strategy_id"], event["client_order_id"]
        if order in seen:
            continue
        start = starts.get(strategy)
        if start is None:
            findings.append(finding("TRADE_START_INVALID", f"{order} submitted by unplanned instance {strategy}"))
            seen.add(order)
        elif int(event["ts_event"]) < start:
            findings.append(finding("ORDER_BEFORE_TRADE_START", f"{order} ({strategy}, {event['instrument_id']}) "
                                    f"{event['type']} at {_ns_utc(int(event['ts_event']))}, "
                                    f"before {_ns_utc(start)}"))
            seen.add(order)
    return findings


def event_report_findings(events: list[dict], orders: list[dict], fills: list[dict]) -> list[str]:
    """engine.event_report_findings: the event history holds exactly the reported orders and fills."""
    findings, history = [], defaultdict(list)
    for event in events:
        history[event["client_order_id"]].append(event)
    reported = {row["client_order_id"]: row for row in orders}
    for identity in sorted(set(history) ^ set(reported)):
        findings.append(finding("EVENT_ORDER_SET_MISMATCH", f"{identity} is in only one of the event history and "
                                                            "the orders report"))
    for identity, order_events in history.items():
        first, row = order_events[0], reported.get(identity)
        if first["type"] != "OrderInitialized" or any(
                event["type"] == "OrderInitialized" for event in order_events[1:]):
            findings.append(finding("EVENT_NOT_INITIALIZED", f"{identity} does not start with one initialization"))
            continue
        if any(int(left["ts_event"]) > int(right["ts_event"]) for left, right in pairwise(order_events)):
            findings.append(finding("EVENT_OUT_OF_ORDER", f"{identity} events go back in time"))
        accounts = {event.get("account_id") for event in order_events if event.get("account_id")}
        if any((event["strategy_id"], event["instrument_id"]) != (first["strategy_id"], first["instrument_id"])
               for event in order_events) or len(accounts) > 1:
            findings.append(finding("EVENT_SCOPE_CHANGED", f"{identity} events change scope"))
        if row is None:
            continue
        quantity = _quantity(first["quantity"])
        for event in order_events:
            if event["type"] == "OrderUpdated" and event.get("quantity") is not None:
                quantity = _quantity(event["quantity"])
        filled = sum((_quantity(event["last_qty"]) for event in order_events if event["type"] == "OrderFilled"),
                     Decimal(0))
        ended = [ENDING_EVENTS[event["type"]] for event in order_events if event["type"] in ENDING_EVENTS]
        status = row["status"]
        if (quantity != _quantity(row["quantity"]) or filled != _quantity(row["filled_qty"])
                or (first["strategy_id"], first["instrument_id"]) != (row["strategy_id"], row["instrument_id"])
                or first["order_side"] != row["side"] or first["order_type"] != row["type"]
                or ("is_reduce_only" in row and row["is_reduce_only"] != str(first.get("reduce_only")))
                or (status in ENDING_EVENTS.values()) != bool(ended)
                or (ended and ended[-1] != status)):
            findings.append(finding("EVENT_ORDER_STATE_MISMATCH", f"{identity} event history differs from the "
                                                                  "orders report"))
    event_fills = {event["event_id"]: event for event in events if event["type"] == "OrderFilled"}
    reported_fills = {row["event_id"]: row for row in fills}
    for event_id in sorted(set(event_fills) ^ set(reported_fills)):
        found = event_fills.get(event_id) or reported_fills[event_id]  # in exactly one of the two
        findings.append(finding("EVENT_FILL_MISMATCH", f"fill {event_id} (order {found['client_order_id']}, trade "
                                                       f"{found['trade_id']}) is in only one of the event history "
                                                       "and the fills report"))
    for event_id, event in event_fills.items():
        row = reported_fills.get(event_id)
        if row is not None and ((event["client_order_id"], event["trade_id"], _quantity(event["last_qty"]),
                                 int(event["ts_event"])) != (row["client_order_id"], row["trade_id"],
                                                             _quantity(row["last_qty"]),
                                                             pd.Timestamp(row["ts_event"]).value)):
            findings.append(finding("EVENT_FILL_MISMATCH", f"fill {event_id} (order {event['client_order_id']}, "
                                                           f"trade {event['trade_id']}) differs from the fills report"))
    return findings


class EventPayloadInvalid(ValueError):
    """EVENT_PAYLOAD_INVALID: the order event history cannot be replayed (an unknown event type, a
    non-positive quantity, an invalid side or an order without its initialization); engine.protection
    records it as REPORT_PAYLOAD_INVALID."""

    def __init__(self, detail: str):
        super().__init__(f"EVENT_PAYLOAD_INVALID: {detail}")


def _positive(value: str, what: str) -> Decimal:
    quantity = _quantity(value)
    if quantity <= 0:
        raise EventPayloadInvalid(f"{what} {value} is not positive")
    return quantity


def uncovered_intervals(events: list[dict], end_ns: int) -> list[dict]:
    """engine.uncovered_intervals: intervals longer than one bar in which a position exceeds its working
    reduce-only stops.

    Events are applied one timestamp at a time and the state is read after each timestamp, so
    nothing depends on the order of different orders' events within one nanosecond. A stop covers
    its unfilled quantity from its acceptance until it is canceled, expired, rejected or filled.
    """
    position: defaultdict[tuple[str, str], Decimal]
    position_orders: defaultdict[tuple[str, str], list[str]]
    previous_stops: defaultdict[tuple[str, str], set[str]]
    uncovered: dict[tuple[str, str], dict]
    orders, position, position_orders, position_ids = {}, defaultdict(Decimal), defaultdict(list), {}
    previous_stops, uncovered, intervals = defaultdict(set), {}, []

    def close(scope, end, open_at_end=False):
        value = uncovered.pop(scope)
        if end - value["start_ns"] > BAR_NS:
            intervals.append({**value, "end_ns": end, "open_at_end": open_at_end})

    timeline = defaultdict(list)
    for event in events:
        timeline[int(event["ts_event"])].append(event)
    for timestamp in sorted(timeline):
        touched = set()
        for event in timeline[timestamp]:
            kind, identity = event["type"], event["client_order_id"]
            if kind == "OrderInitialized":
                if event["order_side"] not in ("BUY", "SELL"):
                    raise EventPayloadInvalid(f"{identity} has side {event['order_side']!r}")
                orders[identity] = {"scope": (event["strategy_id"], event["instrument_id"]),
                                    "side": event["order_side"], "type": event["order_type"],
                                    "reduce_only": event["reduce_only"] is True,
                                    "quantity": _positive(event["quantity"], f"{identity} quantity"),
                                    "filled": Decimal(0), "accepted": False, "ended": False}
            if identity not in orders:
                raise EventPayloadInvalid(f"{identity} has a {kind} before its initialization")
            order = orders[identity]
            scope = order["scope"]
            touched.add(scope)
            if kind == "OrderAccepted":
                order["accepted"] = True
            elif kind == "OrderUpdated":
                if event.get("quantity") is not None:
                    order["quantity"] = _positive(event["quantity"], f"{identity} quantity")
            elif kind == "OrderFilled":
                if event["order_side"] not in ("BUY", "SELL"):
                    raise EventPayloadInvalid(f"a fill of {identity} has side {event['order_side']!r}")
                if position[scope] == 0:
                    position_orders[scope] = []
                if identity not in position_orders[scope]:
                    position_orders[scope].append(identity)
                position_ids[scope] = event.get("position_id") or ""
                quantity = _positive(event["last_qty"], f"a fill of {identity}")
                order["filled"] += quantity
                position[scope] += quantity if event["order_side"] == "BUY" else -quantity
            elif kind in ENDING_EVENTS:
                order["ended"] = True
            elif kind not in PASSIVE_EVENTS | {"OrderInitialized"}:
                raise EventPayloadInvalid(f"unknown native order event type {kind}")
        for scope in sorted(touched):
            held = position[scope]
            closing = "SELL" if held > 0 else "BUY"
            stops = {identity: order["quantity"] - order["filled"] for identity, order in orders.items()
                     if order["scope"] == scope and order["accepted"] and not order["ended"]
                     and order["reduce_only"] and order["type"] in STOP_TYPES and order["side"] == closing
                     and order["filled"] < order["quantity"]} if held else {}
            covered = sum(stops.values(), Decimal(0))
            if held and covered < abs(held):
                if scope not in uncovered:
                    uncovered[scope] = {
                        "strategy_id": scope[0], "instrument_id": scope[1],
                        "position_id": position_ids.get(scope, ""), "start_ns": timestamp,
                        "position_quantity": str(abs(held)), "stop_quantity": str(covered),
                        "position_order_ids": list(position_orders[scope]),
                        "ended_stop_order_ids": sorted(previous_stops[scope] - set(stops))}
                elif abs(held) > Decimal(uncovered[scope]["position_quantity"]):
                    uncovered[scope]["position_quantity"] = str(abs(held))
            elif scope in uncovered:
                close(scope, timestamp)
            previous_stops[scope] = set(stops)
    for scope in sorted(uncovered):
        close(scope, end_ns, open_at_end=True)
    return sorted(intervals, key=lambda value: (value["instrument_id"], value["strategy_id"], value["start_ns"]))


def protection(run_dir: Path, orders: list[dict], fills: list[dict], summary: dict) -> tuple[list[str], dict]:
    """engine.protection: reconcile the order event history and refuse unprotected positions unless the
    source declares no stop loss."""
    path = run_dir / ORDER_EVENTS
    if not path.is_file():
        return [finding("ORDER_EVENT_HISTORY_MISSING", f"{ORDER_EVENTS} is missing")], {}
    events = read_order_events(path)
    findings = event_report_findings(events, orders, fills)
    uses_stop_loss = summary.get("strategy_uses_stop_loss", True)
    if type(uses_stop_loss) is not bool:
        findings.append(finding("STOP_LOSS_DECLARATION_INVALID", f"strategy_uses_stop_loss is {uses_stop_loss!r}"))
    try:
        intervals = uncovered_intervals(events, pd.Timestamp(summary["period_end_utc"]).value)
    except (KeyError, TypeError, ValueError, ArithmeticError) as exc:
        # REPORT_PAYLOAD_INVALID, as generic_audit records it, but here: the reconciliation findings above
        # and the audit's remaining checks stay.
        findings.append(finding("REPORT_PAYLOAD_INVALID", f"the event history cannot be replayed: "
                                                          f"{type(exc).__name__}: {exc}"))
        intervals = []
    if uses_stop_loss is not False:
        for value in intervals:
            findings.append(finding(
                "UNPROTECTED_POSITION",
                f"{value['instrument_id']} ({value['strategy_id']}): "
                f"{value['position_quantity']} held with {value['stop_quantity']} reduce-only stop from "
                f"{_ns_utc(value['start_ns'])} to {'replay end' if value['open_at_end'] else _ns_utc(value['end_ns'])}; "
                f"position orders {value['position_order_ids']}, ended stops {value['ended_stop_order_ids']}"))
    return findings, {"strategy_uses_stop_loss": uses_stop_loss, "native_order_events": len(events),
                      "uncovered_intervals": intervals}


EXPIRATION_PREFIX = "EXPIRATION-"  # the engine's own closing orders at a settlement (rc7 matching_engine/settlement.rs)


def entry_findings(events: list[dict], summary: dict, coverage: dict | None) -> list[str]:
    """engine.entry_findings: only native reduce-only orders may operate outside entry membership.

    Track only submitted order quantity, native fills and terminal events, never simulate execution
    or reconstruct net positions. Cancellation/expiry at the cutoff is allowed, a fill there is not.
    """
    from engine.config import parse_window
    from engine.load import entry_windows
    try:
        if coverage is None:
            raise ValueError("input-coverage.json is missing")
        windows = entry_windows(coverage, summary)
        config = coverage["effective_config"]
        window = parse_window(config["start"], config["trade_start"], config["end"])
    except (KeyError, TypeError, ValueError, AttributeError) as exc:
        return [finding("ENTRY_SCOPE_INVALID", str(exc))]
    history = defaultdict(list)
    for event in events:
        history[event["client_order_id"]].append(event)
    findings = []
    for identity, order_events in history.items():
        first, detail = order_events[0], None
        instrument = first["instrument_id"]
        if instrument not in windows or type(first.get("reduce_only")) is not bool:
            findings.append(finding("ENTRY_SCOPE_INVALID", f"{identity}: unknown instrument or no native boolean reduce_only"))
            continue
        if first["reduce_only"]:
            continue
        intervals = windows[instrument]

        def forbidden(low, high, intervals=intervals):
            """The first excluded nanosecond in [low, high), clipped to the replay input window."""
            low, high = max(low, window.start_ns), min(high, window.end_ns)
            for start, end in intervals:
                if end <= low:
                    continue
                if start > low:
                    break
                low = end
            return low if low < high else None

        quantity, filled, active, previous = _quantity(first["quantity"]), Decimal(0), False, int(first["ts_event"])
        timeline = defaultdict(list)
        for event in order_events:
            timeline[int(event["ts_event"])].append(event)
        for at, batch in sorted(timeline.items()):
            outside = forbidden(previous, at) if active and quantity > filled else None
            if outside is not None:
                detail = f"{quantity - filled} unfilled at {_ns_utc(outside)}"
                break
            if forbidden(at, at + 1) is not None and any(event["type"] in {
                    "OrderSubmitted", "OrderEmulated", "OrderReleased", "OrderUpdated", "OrderFilled"} for event in batch):
                detail = (f"non-reduce-only submission, update, release or fill at {_ns_utc(at)}; "
                          f"{quantity - filled} unfilled before event")
                break
            for event in batch:
                kind = event["type"]
                if kind in {"OrderSubmitted", "OrderEmulated", "OrderReleased", "OrderAccepted"}:
                    active = True
                elif kind == "OrderUpdated" and event.get("quantity") is not None:
                    quantity = _quantity(event["quantity"])
                elif kind == "OrderFilled":
                    filled += _quantity(event["last_qty"])
                elif kind in ENDING_EVENTS:
                    active = False
            previous = at
        if detail is None and active and quantity > filled:
            outside = forbidden(previous, window.end_ns)
            if outside is not None:
                detail = f"{quantity - filled} unfilled at {_ns_utc(outside)}"
        if detail:
            findings.append(finding("ENTRY_ORDER_OUTSIDE_MEMBERSHIP", f"{identity} ({first['strategy_id']}, "
                                    f"{instrument}): {detail}"))
    return findings


class _OrderState(TypedDict):
    """An order's state before a termination, from its events (engine.lifecycle_findings)."""
    quantity: Decimal | None
    filled: Decimal
    ended: bool
    pending: bool


def lifecycle_findings(lifecycle, fills: list[dict], positions: list[dict], events: list[dict],
                       coverage: dict) -> list[str]:
    """engine.lifecycle_findings: no order is created at or after a contract's termination (the engine's
    own EXPIRATION orders at a settlement excepted); before a termination without a settlement price
    every native position of the contract is flat and every order filled or ended, and no order has
    events at or after it. A settlement price is the engine's own settlement and reconciles like any
    fill. One finding per order. A contract whose bars stop before the window's end (from the coverage
    receipt) without a termination there is DATA_ENDS_WITHOUT_TERMINATION: the replay would hold it
    unvalued and untradeable without saying why."""
    from engine.config import parse_window
    config = coverage["effective_config"] if isinstance(coverage.get("effective_config"), dict) else {}
    # Unvalidated JSON: a value that is not a string fails parse_window, which generic_audit records.
    window = parse_window(config.get("start"), None, config.get("end"))  # type: ignore[arg-type]
    found = []
    for symbol, receipt in sorted((coverage.get("export_receipts") or {}).items()):
        pieces = receipt.get("pieces") if isinstance(receipt, dict) else None
        for piece in pieces if isinstance(pieces, list) and pieces else [{}]:
            episode = piece.get("episode") if isinstance(piece, dict) else None
            if episode is not None and (episode.get("start_ns") or 0) >= window.end_ns:
                continue  # listed after the window
            ends = [int(event["ts_event"]) for event in (episode or {}).get("events") or ()
                    if event.get("type") == "InstrumentClose" or event.get("action") == "CLOSE"]
            until = min([window.end_ns, *ends])
            last = piece.get("last_bar_ns") if isinstance(piece, dict) else None
            name = piece.get("instrument_id") or symbol if isinstance(piece, dict) else symbol
            if last is None or int(last) + 1_000_000 < until - DATA_END_TOLERANCE_NS:
                found.append(finding("DATA_ENDS_WITHOUT_TERMINATION",
                                     f"{name}: its last bar closes at {_ns_utc(int(last)) if last else 'no bar'}, "
                                     f"{'the termination' if ends and until < window.end_ns else 'the window end'} "
                                     f"is {_ns_utc(until)}"))


    priced = {(item["instrument_id"], item["ts_event"]) for item in lifecycle if item["type"] == "InstrumentClose"}
    ended_at: dict[str, int] = {}
    for item in lifecycle:
        ended_at[item["instrument_id"]] = min(item["ts_event"], ended_at.get(item["instrument_id"], item["ts_event"]))
    if not ended_at:
        return found
    findings = []
    reported = {row["event_id"]: row for row in fills}
    for instrument in sorted(ended_at):
        own = {row["event_id"] for row in fills if row["instrument_id"] == instrument}
        covered = Counter(event["event_id"] for position in positions if position["instrument_id"] == instrument
                          for event in _list(position["events"]))
        history = {event["event_id"]: event for event in events
                   if event["type"] == "OrderFilled" and event["instrument_id"] == instrument}
        if (covered != Counter({identity: 1 for identity in own}) or set(history) != own
                or any((history[identity]["trade_id"], _quantity(history[identity]["last_qty"]))
                       != (reported[identity]["trade_id"], _quantity(reported[identity]["last_qty"]))
                       for identity in own)):
            findings.append(finding("LIFECYCLE_EVIDENCE_INCONSISTENT", f"{instrument}: positions, event history "
                                                                       "and fills report disagree"))
    if findings:
        return found + findings
    by_order = defaultdict(list)
    for event in events:
        by_order[event["client_order_id"]].append(event)
    for instrument, termination in sorted(ended_at.items()):
        settled = (instrument, termination) in priced
        when = _ns_utc(termination)
        held: defaultdict[tuple, Decimal] = defaultdict(Decimal)
        for identity, order_events in sorted(by_order.items()):
            if order_events[0]["instrument_id"] != instrument:
                continue
            created = int(order_events[0]["ts_event"])
            if created >= termination:
                if not (settled and created == termination and identity.startswith(EXPIRATION_PREFIX)):
                    findings.append(finding("LATE_ORDER_EVENT", f"{instrument} order {identity} created at "
                                                                f"{_ns_utc(created)}, termination {when}"))
                continue
            if settled:
                continue  # the engine cancels and closes at the settlement itself
            state: _OrderState = {"quantity": None, "filled": Decimal(0), "ended": False, "pending": False}
            late = []
            for event in order_events:
                kind, at = event["type"], int(event["ts_event"])
                if at >= termination:
                    late.append(kind)
                    continue
                if kind == "OrderInitialized":
                    state["quantity"] = _quantity(event["quantity"])
                elif kind == "OrderUpdated":
                    state["pending"] = False
                    if event.get("quantity") is not None:
                        state["quantity"] = _quantity(event["quantity"])
                elif kind in ("OrderPendingUpdate", "OrderPendingCancel"):
                    state["pending"] = True
                elif kind in ("OrderModifyRejected", "OrderCancelRejected"):
                    state["pending"] = False
                elif kind == "OrderFilled":
                    quantity = _quantity(event["last_qty"])
                    if quantity <= 0 or event["order_side"] not in ("BUY", "SELL"):
                        return found + [finding("LIFECYCLE_EVIDENCE_INCONSISTENT", f"{instrument}: fill of "
                                                                                   f"{identity} is invalid")]
                    state["filled"] += quantity
                    scope = (event["strategy_id"], event.get("account_id"), event.get("position_id"))
                    held[scope] += quantity if event["order_side"] == "BUY" else -quantity
                elif kind in ENDING_EVENTS:
                    state["ended"] = True
                elif kind != "OrderAccepted" and kind not in PASSIVE_EVENTS:
                    return found + [finding("LIFECYCLE_EVIDENCE_INCONSISTENT", f"{instrument}: unknown event "
                                                                               f"type {kind} of {identity}")]
            complete = state["quantity"] is not None and state["filled"] >= state["quantity"]
            tail = f" ({len(late)} events at or after it: {', '.join(sorted(set(late)))})" if late else ""
            if state["pending"] or not (complete or state["ended"]):
                findings.append(finding("ORDER_OPEN_AT_TERMINATION", f"{instrument} order {identity} is not "
                                                                     f"filled or ended before {when}{tail}"))
            elif late:
                findings.append(finding("LATE_ORDER_EVENT", f"{instrument} order {identity}{tail}, termination "
                                                            f"{when}"))
        for (strategy, account, position), quantity in sorted(held.items(), key=str):
            if quantity:
                findings.append(finding("POSITION_OPEN_AT_TERMINATION", f"{instrument} position {position} "
                                                                        f"({strategy}, {account}) holds {quantity} "
                                                                        f"before {when}"))
    return found + findings


DATA_END_TOLERANCE_NS = 60 * 60 * 10**9  # engine.run.MARK_CARRY_MAX_MINUTES: a shorter trailing hole is a hole


def generic_result(run_dir: Path, orders: list[dict], fills: list[dict], positions: list[dict], findings: list[str],
                   economics: dict, protection: dict | None) -> dict:
    """engine.generic_result: what the audit checks and leaves out, the reports' hashes and counts, and
    the findings; it adds no finding."""
    names = ("summary.json", "orders.csv", "fills.csv", "positions.csv", "account.csv", "returns_series.csv",
             ORDER_EVENTS)
    return {"run": str(run_dir),
            "scope": "native report identity, links, submission timing, entry membership, protection history and reported economics",
            "file_sha256": {name: _sha(run_dir / name) for name in names if (run_dir / name).is_file()},
            "native_orders": len(orders), "native_fills": len(fills), "native_positions": len(positions),
            "native_economics": economics, **(protection or {}),
            "coverage_limits": ["No strategy signal or target geometry reconstruction",
                                "Entry membership uses trusted input receipts and native reduce-only flags, not net-position inference",
                                "Protection is the unfilled quantity of accepted reduce-only stop orders on the "
                                "closing side; stop prices are not checked",
                                "Events of one nanosecond are applied together; an uncovered interval of at most "
                                "one one-minute execution bar is allowed",
                                "Funding uses native reported adjustments; no rate-based settlement recalculation",
                                "Per-timestamp funding reconciliation excludes timestamps with concurrent fills",
                                "Final equity is reconciled to balance only when no position remains open"],
            "findings": findings, "passed": not findings}


def generic_audit(run_dir: Path, summary: dict) -> dict:  # noqa: C901
    """engine.generic_audit: reconcile native report facts; never calculate fills or market PnL."""
    orders, fills, positions, accounts = (_rows(run_dir, name) for name in
                                         ("orders", "fills", "positions", "account"))
    findings = []
    scope_fields = {"strategy_id", "instrument_id", "account_id"}
    required = (
        ("orders", orders, scope_fields | {"client_order_id", "status", "side", "type", "quantity", "filled_qty",
                                         "linked_order_ids", "parent_order_id", "ts_init", "commissions"}),
        ("fills", fills, scope_fields | {"client_order_id", "event_id", "trade_id", "order_side", "order_type",
                                       "last_qty", "last_px", "commission", "ts_event"}),
        ("positions", positions, scope_fields | {"position_id", "events", "adjustments", "commissions", "side", "quantity",
                                               "buy_qty", "sell_qty", "ts_closed", "realized_pnl", "opening_order_id", "closing_order_id"}),
        ("account", accounts, {"account_id", "currency", "base_currency", "total", "locked", "free", "ts_event"}),
    )
    for name, rows, fields in required:
        if any(not fields <= row.keys() for row in rows):
            findings.append(finding("REPORT_FIELDS_MISSING", f"the {name} report lacks a required field"))
    if findings:
        return generic_result(run_dir, orders, fills, positions, findings, {}, None)
    by_id = {row["client_order_id"]: row for row in orders}
    if "" in by_id or len(by_id) != len(orders):
        findings.append(finding("IDENTITY_MISSING_OR_DUPLICATED", "a client order ID is empty or repeats"))
    if any(row["status"] not in TERMINAL | OPEN for row in orders):
        findings.append(finding("ORDER_STATUS_UNKNOWN", "an order status is unknown: " + ", ".join(sorted({row["status"] for row in orders} - TERMINAL - OPEN))))
    position_ids = [row["position_id"] for row in positions]
    if "" in position_ids or len(set(position_ids)) != len(position_ids):
        findings.append(finding("IDENTITY_MISSING_OR_DUPLICATED", "a position ID is empty or repeats"))
    denied = sum(row["status"] == "DENIED" for row in orders)
    rejected = sum(row["status"] == "REJECTED" for row in orders)
    if not summary["integrity_passed"] or denied or rejected:
        findings.append(finding("INTEGRITY_REPORTED_FAILED", f"integrity_passed {summary['integrity_passed']}, {denied} denied, {rejected} rejected"))
    if denied != summary["denied_orders"] or rejected != summary["rejected_orders"]:
        findings.append(finding("DENIED_REJECTED_COUNT_MISMATCH", f"{denied} denied and {rejected} rejected orders, the summary says {summary['denied_orders']} and {summary['rejected_orders']}"))
    protection_info: dict
    economics, protection_info = {}, {}
    try:
        protection_findings, protection_info = protection(run_dir, orders, fills, summary)
        findings.extend(protection_findings)
        events = read_order_events(run_dir / ORDER_EVENTS) if (run_dir / ORDER_EVENTS).is_file() else []
        coverage = None
        # Lifecycle: rebuilt from the coverage receipt beside the reports (engine.lifecycle_events), then
        # checked against the reports (engine.lifecycle_findings).
        counted = [str(coin.get("instrument")) for coin in summary.get("per_coin") or []
                   if any((coin.get("counts") or {}).get(name) for name in LIFECYCLE_COUNTS)]
        coverage_path = run_dir.parent / COVERAGE
        if not coverage_path.is_file():
            if counted:
                findings.append(finding("LIFECYCLE_COVERAGE_MISSING", f"the summary counts lifecycle events for "
                                                                      f"{counted} but no coverage receipt {COVERAGE} "
                                                                      "is beside the reports"))
        else:
            from engine.config import Refusal
            from engine.load import lifecycle_events
            try:
                coverage = json.loads(coverage_path.read_text(encoding="utf-8"))
                lifecycle = lifecycle_events(coverage, summary)
            except Refusal as exc:
                findings.append(finding(exc.code, str(exc).split(": ", 1)[1]))
            except (OSError, UnicodeDecodeError, ValueError) as exc:
                findings.append(finding("LIFECYCLE_COVERAGE_MISMATCH", f"{COVERAGE} is unreadable: {exc}"))
            else:
                findings.extend(lifecycle_findings(lifecycle, fills, positions, events, coverage))
        findings.extend(submission_findings(events, summary, coverage))
        findings.extend(entry_findings(events, summary, coverage))
        for row in orders:
            original, filled = _quantity(row["quantity"]), _quantity(row["filled_qty"])
            if original <= 0 or filled > original or row["side"] not in {"BUY", "SELL"}:
                findings.append(finding("ORDER_FILL_MISMATCH", f"invalid order quantity or side: {row['client_order_id']}"))
            if row["status"] == "FILLED" and filled != original:
                findings.append(finding("ORDER_FILL_MISMATCH", f"FILLED order is not fully filled: {row['client_order_id']}"))
            links = _list(row["linked_order_ids"])
            if row["parent_order_id"]:
                links.append(row["parent_order_id"])
            for identity in links:
                target = by_id.get(identity)
                if target is None or identity == row["client_order_id"] or not _order_scope_matches(target, row):
                    findings.append(finding("ORDER_LINK_INVALID", f"invalid contingent link: {row['client_order_id']}"))
        quantities: defaultdict[str, Decimal]
        commissions: defaultdict[str, Decimal]
        quantities, commissions = defaultdict(Decimal), defaultdict(Decimal)
        native_fills, fill_times = {}, set()
        for fill in fills:
            identity, event_id = fill["client_order_id"], fill["event_id"]
            order = by_id.get(identity)
            if not event_id or event_id in native_fills:
                findings.append(finding("IDENTITY_MISSING_OR_DUPLICATED", f"a fill event ID is empty or repeats: {event_id}"))
            native_fills[event_id] = fill
            fill_ns = pd.Timestamp(fill["ts_event"]).value
            fill_times.add(fill_ns)
            if (order is None or _scope(fill) != _scope(order)
                    or fill["order_side"] != order["side"] or fill["order_type"] != order["type"]):
                findings.append(finding("ORDER_FILL_MISMATCH", f"fill {event_id} has no matching order of its scope: {identity}"))
            elif fill_ns < int(order["ts_init"]):
                findings.append(finding("ORDER_FILL_MISMATCH", f"fill {event_id} precedes the order's initialization: {identity}"))
            qty, price = _quantity(fill["last_qty"]), _quantity(fill["last_px"])
            if qty <= 0 or price <= 0:
                findings.append(finding("ORDER_FILL_MISMATCH", f"fill {event_id} has an invalid quantity or price: {identity}"))
            quantities[identity] += qty
            commissions[identity] += _money(fill["commission"])
        for identity, order in by_id.items():
            if quantities[identity] != _quantity(order["filled_qty"]):
                findings.append(finding("ORDER_FILL_MISMATCH", f"filled quantity differs from the fills: {identity}"))
            order_fees = sum((_money(value) for value in _list(order["commissions"])), Decimal(0))
            if commissions[identity] != order_fees:
                findings.append(finding("ORDER_FILL_MISMATCH", f"order commission differs from the fills: {identity}"))
        seen_events: Counter[str]
        seen_events, seen_adjustments = Counter(), set()
        position_fees, realized, funding = Decimal(0), Decimal(0), Decimal(0)
        funding_by_time: defaultdict[int, Decimal] = defaultdict(Decimal)
        live, closed_pnl = [], []
        for position in positions:
            events = _list(position["events"])
            if not events or events[0]["client_order_id"] != position["opening_order_id"]:
                findings.append(finding("POSITION_FILL_COVERAGE_MISMATCH", f"opening order differs from the first position fill: {position['position_id']}"))
            if position["ts_closed"] and (
                not events or events[-1]["client_order_id"] != position["closing_order_id"]
            ):
                findings.append(finding("POSITION_FILL_COVERAGE_MISMATCH", f"closing order differs from the last position fill: {position['position_id']}"))
            if any(int(left["ts_event"]) > int(right["ts_event"]) for left, right in pairwise(events)):
                findings.append(finding("POSITION_FILL_COVERAGE_MISMATCH", f"position fill events are out of time order: {position['position_id']}"))
            bought, sold, event_fees = Decimal(0), Decimal(0), Decimal(0)
            for event in events:
                event_id = event["event_id"]
                seen_events[event_id] += 1
                reported_fill = native_fills.get(event_id)
                fill_fields = ("client_order_id", "strategy_id", "instrument_id", "account_id",
                               "order_side", "order_type", "last_qty", "last_px", "commission", "trade_id")
                if (event.get("type") != "OrderFilled" or reported_fill is None
                        or _scope(event) != _scope(position)
                        or any(str(event[field]) != reported_fill[field] for field in fill_fields)
                        or int(event["ts_event"]) != pd.Timestamp(reported_fill["ts_event"]).value):
                    findings.append(finding("POSITION_FILL_COVERAGE_MISMATCH", f"position event {event_id} differs from its fill: {position['position_id']}"))
                qty = _quantity(event["last_qty"])
                if event["order_side"] == "BUY":
                    bought += qty
                elif event["order_side"] == "SELL":
                    sold += qty
                else:
                    findings.append(finding("POSITION_FILL_COVERAGE_MISMATCH", f"unknown position fill side: {position['position_id']}"))
                event_fees += _money(event["commission"])
            for field in ("opening_order_id", "closing_order_id"):
                identity = position[field]
                order = by_id.get(identity) if identity else None
                if (not identity and (field == "opening_order_id" or position["ts_closed"])) or (
                    identity and (order is None or _scope(order) != _scope(position)
                                  or quantities[identity] <= 0
                                  or identity not in {event["client_order_id"] for event in events})
                ):
                    findings.append(finding("POSITION_FILL_COVERAGE_MISMATCH", f"invalid position {field}: {position['position_id']}"))
            signed = _quantity(position["quantity"]) * (-1 if position["side"] == "SHORT" else 1)
            if (bought != _quantity(position["buy_qty"]) or sold != _quantity(position["sell_qty"])
                    or bought - sold != signed
                    or position["side"] not in {"LONG", "SHORT", "FLAT"}
                    or bool(position["ts_closed"]) != (signed == 0)):
                findings.append(finding("POSITION_FILL_COVERAGE_MISMATCH", f"position quantity differs from its fills: {position['position_id']}"))
            fees = sum((_money(value) for value in _list(position["commissions"])), Decimal(0))
            if fees != event_fees:
                findings.append(finding("POSITION_FILL_COVERAGE_MISMATCH", f"position commission differs from its fills: {position['position_id']}"))
            position_fees += fees
            pnl = _money(position["realized_pnl"])
            realized += pnl
            if position["ts_closed"]:
                closed_pnl.append(pnl)
            else:
                live.append(position)
            for adjustment in _list(position["adjustments"]):
                event_id = adjustment["event_id"]
                if (not event_id or event_id in seen_adjustments
                        or _scope(adjustment) != _scope(position)
                        or adjustment["adjustment_type"] != "FUNDING"
                        or adjustment.get("quantity_change") is not None):
                    findings.append(finding("FUNDING_BALANCE_MISMATCH", f"adjustment {event_id} is not a FUNDING adjustment of the position's scope: {position['position_id']}"))
                seen_adjustments.add(event_id)
                amount = _money(adjustment["pnl_change"])
                funding += amount
                funding_by_time[int(adjustment["ts_event"])] += amount
        if seen_events != Counter({identity: 1 for identity in native_fills}):
            findings.append(finding("POSITION_FILL_COVERAGE_MISMATCH", "position events do not cover every fill exactly once"))
        if position_fees != sum(commissions.values(), Decimal(0)):
            findings.append(finding("POSITION_FILL_COVERAGE_MISMATCH", "position and fill commission totals differ"))
        if (summary["closed_trades"] != len(closed_pnl)
                or summary["winning_trades"] != sum(value > 0 for value in closed_pnl)):
            findings.append(finding("SUMMARY_TOTALS_MISMATCH", "closed and winning position counts differ from the summary"))
        if not accounts:
            findings.append(finding("ACCOUNT_REPORT_INCONSISTENT", "the account report is empty"))
        else:
            for account in accounts:
                balances = [_decimal(account[name]) for name in ("total", "locked", "free")]
                if (account["currency"] != "USDT" or account["base_currency"] != "USDT"
                        or not all(value.is_finite() for value in balances)
                        or balances[0] != balances[1] + balances[2]):
                    findings.append(finding("ACCOUNT_REPORT_INCONSISTENT", f"total, locked, free or currency disagree at {account['ts_event']}"))
            if any(pd.Timestamp(left["ts_event"]).value > pd.Timestamp(right["ts_event"]).value
                   for left, right in pairwise(accounts)):
                findings.append(finding("ACCOUNT_REPORT_INCONSISTENT", "the account report is out of time order"))
            balance_changes: defaultdict[int, Decimal] = defaultdict(Decimal)
            for left, right in pairwise(accounts):
                balance_changes[pd.Timestamp(right["ts_event"]).value] += (
                    _decimal(right["total"]) - _decimal(left["total"]))
            for timestamp in set(balance_changes) | set(funding_by_time):
                if timestamp not in fill_times and (
                    timestamp not in balance_changes
                    or abs(balance_changes[timestamp] - funding_by_time[timestamp]) > Decimal("0.00000001")
                ):
                    findings.append(finding("FUNDING_BALANCE_MISMATCH", f"funding differs from the account balance change at {_ns_utc(timestamp)}"))
            starting, final_balance = _decimal(accounts[0]["total"]), _decimal(accounts[-1]["total"])
            if starting != _decimal(summary["starting_balance_usdt"]):
                findings.append(finding("SUMMARY_TOTALS_MISMATCH", "the starting balance differs from the summary"))
            if abs(final_balance - starting - realized) > Decimal("0.00000001"):
                findings.append(finding("SUMMARY_TOTALS_MISMATCH", "the account balance change differs from the realized PnL"))
            if not live and abs(final_balance - _decimal(summary["final_equity_usdt"])) > Decimal("0.00000001"):
                findings.append(finding("SUMMARY_TOTALS_MISMATCH", "the flat account balance differs from the final equity"))
            if any(row["account_id"] != accounts[0]["account_id"] for row in [*orders, *fills, *positions, *accounts]
                   if row["account_id"]):
                findings.append(finding("ACCOUNT_REPORT_INCONSISTENT", "the reports span different accounts"))
            economics = {"starting_balance_usdt": str(starting), "final_balance_usdt": str(final_balance),
                         "reported_realized_pnl_usdt": str(realized),
                         "fill_commissions_usdt": str(sum(commissions.values(), Decimal(0))),
                         "funding_adjustments": len(seen_adjustments),
                         "reported_funding_usdt": str(funding),
                         "funding_timestamps_with_concurrent_fills": len(set(funding_by_time) & fill_times)}
    except (KeyError, TypeError, ValueError, ArithmeticError, OSError, EOFError) as error:
        findings.append(finding("REPORT_PAYLOAD_INVALID", f"{type(error).__name__}: {error}"))
    return generic_result(run_dir, orders, fills, positions, findings, economics, protection_info)


class AuditNotRun(Exception):
    """The reports cannot be audited; the auditor exits 2 and writes no result."""


def audit(run_dir: Path) -> dict:
    """engine.audit: reconcile one run's native reports; the result names every finding."""
    try:
        summary = json.loads((run_dir / "summary.json").read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, ValueError) as exc:
        raise AuditNotRun(outcome("SUMMARY_UNREADABLE", f"{run_dir / 'summary.json'}: {exc}")) from exc
    if not isinstance(summary, dict):
        raise AuditNotRun(outcome("SUMMARY_UNREADABLE", f"{run_dir / 'summary.json'} is not a JSON object"))
    return generic_audit(run_dir, summary)


def audit_main(run_dir: Path, output_path: Path) -> None:
    """engine.audit_main: audit a complete report set into `output_path`. It returns when the run passed
    and exits 1 with findings (the result written) or 2 without auditing (no result written)."""
    missing = [name for name in REPORTS if not (run_dir / name).is_file() or not (run_dir / name).stat().st_size]
    if missing:
        print(outcome("REPORTS_INCOMPLETE", f"{run_dir} lacks {missing}"), file=sys.stderr)
        raise SystemExit(2)
    try:
        result = audit(run_dir)
    except AuditNotRun as exc:
        print(exc, file=sys.stderr)
        raise SystemExit(2) from exc
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(result, indent=2) + "\n")
    if not result["passed"]:
        print(outcome("AUDIT_FINDINGS", f"{len(result['findings'])} findings in {output_path}"), file=sys.stderr)
        raise SystemExit(1)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument("--run", type=Path, required=True,
                        help=f"the report directory (read only); its parent may hold {COVERAGE}")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    audit_main(args.run, args.output)
