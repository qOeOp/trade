"""Product readings of a sealed native run, and typed report rows for descriptive analysis.

This module keeps only what an Agent should not grade for itself: it splits closed-position PnL
into fill price PnL, commissions and funding and accepts that split only when it reconciles to the
audited native economics; it reads the plan-level net win rate under the plan contract; and it
reads the native MARK equity drawdown on the trade window. `readings` runs once, when a sealed run
is stored, and its values become real columns of the run row. Descriptive statistics are left to
the Agent (the nautilus-report-analysis skill); `tables` hands it the stored, parsed reports so it
never re-parses native formats. A value that cannot be derived is null with its reason in
``limitations``.
"""

from __future__ import annotations

import ast
import bisect
import csv
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal
import gzip
import io
import json
import sys
import math
from pathlib import Path

from research.records.common import RecordError


TOLERANCE = Decimal("0.000001")
EPOCH = datetime(1970, 1, 1, tzinfo=UTC)
# One Nautilus order tag with this prefix names the order's trade plan (research-round strategy-authoring).
PLAN_TAG = "plan:"
_TERMINAL_ORDERS = frozenset({"FILLED", "CANCELED", "EXPIRED", "DENIED", "REJECTED"})
_ECONOMICS = ("closed", "closed_by_year", "closed_trades", "open_positions", "unrealized_residual_usdt")
# Native report cells by column name. Python reprs, "<decimal> <currency>" money and string flags;
# columns not named here stay strings.
_LISTS = frozenset({"events", "adjustments", "commissions", "tags", "linked_order_ids", "venue_order_ids",
                    "trade_ids", "margins"})
_MONEY = frozenset({"realized_pnl", "unrealized_pnl", "commission", "notional_value"})
_DECIMALS = frozenset({"quantity", "filled_qty", "display_qty", "price", "trigger_price", "avg_px", "slippage",
                       "last_qty", "last_px", "peak_qty", "buy_qty", "sell_qty", "multiplier", "avg_px_open",
                       "avg_px_close", "realized_return", "total", "locked", "free"})
_INTEGERS = frozenset({"expire_time_ns", "duration_ns", "ts_event_ns"})
EXPOSURES = "exposures.csv.gz"
ORDER_EVENTS = "order_events.jsonl.gz"
REPORTS = ("summary.json", "orders.csv", "fills.csv", "positions.csv", "account.csv", "returns_series.csv")
_NANOSECONDS = frozenset({"ts_init", "ts_last"})  # integers in orders and positions, datetimes in fills
_FLAGS = frozenset({"is_snapshot", "is_inverse", "is_reduce_only", "is_post_only", "is_quote_quantity",
                    "reconciliation", "reported"})


class _Unreconciled(Exception):
    """Native facts outside the supported linear-USDT scope or failing a reconciliation."""


@dataclass
class Reports:
    """One run's native reports: report rows as the native CSV strings, the exposure report as gzip bytes."""
    summary: dict | None
    audit: dict | None
    orders: list[dict]
    fills: list[dict]
    positions: list[dict]
    account: list[dict]
    returns: list[tuple[int, float]]
    exposures: bytes | None
    order_events: list[dict] | None
    lifecycle_events: tuple[dict, ...] = ()


def load_dir(directory: Path) -> Reports:
    """Parse a replay's report directory (before it is stored)."""
    directory = Path(directory)

    def text(name):
        path = directory / name
        return path.read_bytes() if path.is_file() else None

    def rows(name):
        data = text(name)
        return _rows(data) if data is not None else []

    summary, audit = text("summary.json"), text("audit.json")
    parsed_summary = json.loads(summary) if summary else None
    coverage_path = directory.parent / 'input-coverage.json'
    from research.records.lifecycle import events as lifecycle_events
    events = text(ORDER_EVENTS)
    return Reports(
        summary=parsed_summary, audit=json.loads(audit) if audit else None,
        orders=rows("orders.csv"), fills=rows("fills.csv"), positions=rows("positions.csv"),
        account=rows("account.csv"),
        returns=[(int(row["ts_event_ns"]), float(row["native_return"])) for row in rows("returns_series.csv")],
        exposures=text(EXPOSURES),
        order_events=None if events is None else [json.loads(line) for line in gzip.decompress(events).splitlines()
                                                  if line.strip()],
        lifecycle_events=lifecycle_events(json.loads(coverage_path.read_bytes()), parsed_summary)
                         if coverage_path.is_file() and parsed_summary is not None else ())


def load_run(conn, run_id: int, *, account: bool = True, exposures: bool = True) -> Reports:
    """Rebuild one stored run's reports from the ledger, row for row."""
    from research.records import db
    run = db.one(conn, "SELECT status, summary, audit, trial_id, input_identity" + (", exposures" if exposures else "")
                 + " FROM run WHERE run_id = %s", (run_id,))
    if run is None:
        raise RecordError(f"unknown run {run_id}", code="UNKNOWN_RUN", write_status="not_written")

    def raw(table):
        return [json.loads(value) for (value,) in db.rows(conn, f"SELECT raw FROM {table} WHERE run_id = %s "
                                                                "ORDER BY seq", (run_id,))]

    from research.records.lifecycle import original_events
    summary = json.loads(run['summary']) if run['summary'] else None
    return Reports(
        summary=summary,
        audit=json.loads(run["audit"]) if run["audit"] else None,
        orders=raw("run_order"), fills=raw("run_fill"), positions=raw("run_position"),
        account=raw("run_account") if account else [],
        returns=[(ts, value) for ts, value in db.rows(conn, "SELECT ts_event_ns, native_return FROM run_return "
                                                            "WHERE run_id = %s ORDER BY ts_event_ns", (run_id,))],
        exposures=run.get("exposures"), order_events=raw("run_order_event") or None,
        lifecycle_events=original_events(conn, run['trial_id'], json.loads(run['input_identity']), summary)
                         if run['status'] == 'passed' else ())


def readings(reports: Reports) -> dict:
    """The product readings of one passed run: economics, plans and MARK drawdown, with limitations."""
    summary, audit = reports.summary, reports.audit
    limitations = _unique(list((summary or {}).get("limitations", [])) + list((audit or {}).get("coverage_limits", [])))
    output = {"economics": None, "plans": None, "max_drawdown": None, "limitations": limitations}
    if summary is None:
        limitations.append("The run has no native summary; no readings.")
        return output
    native = (audit or {}).get("native_economics")
    if native is None:
        limitations.append("native_economics is absent from the audit; unrealized_residual_usdt is null "
                           "and the decomposition is checked only against the run's own reports.")
    _returns(reports.returns, summary, limitations)
    try:
        cycles = _cycles(reports.positions, reports.fills)
        output["economics"] = _economics(cycles, reports.fills, summary, native, limitations)
    except _Unreconciled as exc:
        limitations.append(f"Economic readings are null: {exc}")
        return output
    output["economics"]["closed_by_year"] = closed_by_year(cycles, limitations)
    try:
        output['plans'] = _plans(reports.orders, reports.fills, reports.positions, cycles,
                                  reports.order_events, reports.lifecycle_events)
    except _Unreconciled as exc:
        limitations.append(f"plans is null: {exc}")
    if reports.exposures is None:
        limitations.append("max_drawdown is null: the run has no exposure report.")
    else:
        try:
            typed = _typed_positions(reports.positions, cycles)
            rows = _exposures(reports.exposures, typed, summary, output["economics"]["unrealized_residual_usdt"])
            output["max_drawdown"] = _mark_drawdown(summary, reports.account, rows)
        except (RecordError, _Unreconciled) as exc:
            limitations.append(f"max_drawdown is null: {exc}")
    return output


def explored(run_dir: Path, status: str) -> dict:
    """The same readings for an exploration's unverified temporary reports, for direction only.

    Nothing here is checked against a stored copy, so no decision may cite these readings. When the
    replay did not pass or its reports are incomplete, every reading is null with the reason.
    """
    directory = Path(run_dir) / "reports"
    nulls = {**dict.fromkeys(FLAT_KEYS), "closed_by_year": None}
    missing = [name for name in REPORTS if not (directory / name).is_file()]
    if missing:
        return {**nulls, "reading_limitations": [
            f"Readings are null: the exploration's reports are incomplete (missing {', '.join(missing)})"]}
    if status != "passed":
        return {**nulls, "reading_limitations": ["Readings are null: the exploration did not pass its checks."]}
    try:
        reports = load_dir(directory)
        from research.records.availability import directory_view, mask
        return mask(flat(reports.summary, readings(reports)), directory_view(reports))
    except (KeyError, TypeError, ValueError, SyntaxError, ArithmeticError, IndexError, csv.Error, RecordError) as exc:
        return {**nulls, "reading_limitations": [
            f"Readings are null: the exploration's reports are incomplete ({type(exc).__name__}: {exc})"]}


FLAT_KEYS = ("final_equity_usdt", "annual_return", "max_drawdown", "return_drawdown", "plans_closed", "plans_won",
             "plans_open", "plan_win_rate", "closed_positions", "open_positions", "realized_pnl_usdt",
             "commissions_usdt", "funding_usdt", "price_pnl_usdt", "unrealized_usdt")


def flat(summary: dict, values: dict) -> dict:
    """Readings named like the run row's columns, plus ``closed_by_year``, for reports that are not stored."""
    economics, plans = values.get("economics") or {}, values.get("plans") or {}
    closed = economics.get("closed") or {}
    annual = summary.get("annualized_return_pct")
    annual = None if annual is None else annual / 100
    counted = (plans.get("closed") or 0) + (plans.get("open") or 0)
    drawdown = values.get("max_drawdown")
    return {"final_equity_usdt": summary.get("final_equity_usdt"), "annual_return": annual, "max_drawdown": drawdown,
            "return_drawdown": annual / drawdown if annual is not None and drawdown else None,
            "plans_closed": plans.get("closed"), "plans_won": plans.get("wins"), "plans_open": plans.get("open"),
            "plan_win_rate": plans.get("wins") / counted if plans and counted else None,
            "closed_positions": economics.get("closed_trades"), "open_positions": economics.get("open_positions"),
            "realized_pnl_usdt": closed.get("reported_realized_pnl_usdt"),
            "commissions_usdt": closed.get("fill_commissions_usdt"), "funding_usdt": closed.get("reported_funding_usdt"),
            "price_pnl_usdt": closed.get("price_pnl_usdt"), "unrealized_usdt": economics.get("unrealized_residual_usdt"),
            "closed_by_year": economics.get("closed_by_year"), "reading_limitations": values.get("limitations", [])}


def closed_by_year(cycles: list[dict], limitations: list[str]) -> dict | None:
    """Closed-position fill price PnL, commissions and funding by the UTC year each cycle closed in.

    A whole cycle, funding included, belongs to the year of its last event (``ts_last``), so the
    years add up to the ``closed`` totals; a cycle open across a year end counts only in the year it
    closed, and positions still open are left out as in ``closed``. The first and last years of a
    window are partial. No closed cycle gives ``{}``; a closed row without an integer ``ts_last``
    makes only this reading null.
    """
    years: dict[str, dict] = {}
    for cycle in cycles:
        if not cycle["closed"]:
            continue
        try:
            year = str((EPOCH + timedelta(microseconds=int(cycle["ts_last"]) // 1000)).year)
        except (TypeError, ValueError):
            limitations.append("closed_by_year is null: a closed position row has no integer ts_last")
            return None
        item = years.setdefault(year, {"closed_trades": 0, "price": Decimal(0), "commissions": Decimal(0),
                                       "funding": Decimal(0)})
        item["closed_trades"] += 1
        for key in ("price", "commissions", "funding"):
            item[key] += cycle[key]
    return {year: {"closed_trades": item["closed_trades"], "price_pnl_usdt": _money(item["price"]),
                   "fill_commissions_usdt": _money(item["commissions"]),
                   "reported_funding_usdt": _money(item["funding"])}
            for year, item in sorted(years.items())}


def stored_closed_by_year(conn, run_id: int) -> tuple[dict | None, list[str]]:
    """``closed_by_year`` of a stored run, derived from its stored position and fill rows."""
    reports = load_run(conn, run_id, account=False, exposures=False)
    limitations: list[str] = []
    try:
        return closed_by_year(_cycles(reports.positions, reports.fills), limitations), limitations
    except _Unreconciled as exc:
        return None, [f"closed_by_year is null: {exc}"]


def _mark_drawdown(summary: dict, account: list[dict], exposures: list[dict]) -> float:
    """Largest fall of native MARK equity from its running peak on the trade window, as a fraction.

    Equity at bar label T is the account `total` of the latest account state before the next bar
    label plus the unrealized PnL of the exposure rows labelled T (none: flat). The peak starts at
    the starting balance.
    """
    step = int(summary["data_interval_minutes"]) * 60_000_000_000
    start, end = _utc_ns(summary["period_start_utc"]), _utc_ns(summary["period_end_utc"])
    unrealized = defaultdict(Decimal)
    for row in exposures:
        unrealized[row["ts_event_ns"]] += row["unrealized_pnl"]
    offset = min(unrealized) % step if unrealized else step - 1_000_000
    states = sorted((_utc_ns(row["ts_event"]), Decimal(row["total"])) for row in account)
    times = [ts for ts, _ in states]
    starting = Decimal(summary["starting_balance_usdt"])
    peak, worst = starting, Decimal(0)
    label = start - start % step + offset
    if label < start:
        label += step
    while label < end:
        index = bisect.bisect_left(times, label + step) - 1
        equity = (states[index][1] if index >= 0 else starting) + unrealized.get(label, Decimal(0))
        peak = max(peak, equity)
        worst = max(worst, (peak - equity) / peak)
        label += step
    return float(worst)


def _typed_positions(positions: list[dict], cycles: list[dict]) -> list[dict]:
    return [{**_typed(row), "closed": cycle["closed"]} for row, cycle in zip(positions, cycles, strict=True)]


def tables(run_id: int, *, ledger: str | None = None, at: str | None = None, account: bool = False,
           exposures: bool = False) -> dict:
    """Parsed native reports of one stored, passed run whose closed-position split reconciles.

    Reads the ledger (the active round unless `at` names a branch or closing tag) and computes no
    statistics. Top-level money cells become ``Decimal`` in the run's single currency (nested event
    and adjustment dicts keep their raw strings), list cells become lists, flags become booleans and
    empty cells ``None``. Each position row also carries ``funding`` and, when closed, its
    reconciled fill price PnL (``price_pnl``), its exact close time (``ts_closed_ns``, from
    ``ts_last``; the native ``ts_closed`` passes through float64) and the tags of the order that
    closed it (``closing_order_tags``, empty for an untagged order, ``None`` if that order is
    absent); all three are ``None`` while open. Each fill carries the ``cycle_position_id`` of the
    position row whose events contain it. ``daily_returns`` is ``None`` with a limitation when the
    trade-window returns do not compound to final equity. ``account`` adds the account rows and
    ``exposures`` the exposure rows; both can be large. Exposure rows hold each open position's
    native notional value and unrealized PnL between input bar timestamps, tied to its
    ``cycle_position_id``. ``order_events`` is the native order event history when the run has it.
    """
    from research.records import db, ledger as ledgers
    profile = ledgers.profile(ledger)
    with db.reading(profile, at) as conn:
        status = db.one(conn, "SELECT status FROM run WHERE run_id = %s", (run_id,))
        if status is None or status["status"] != "passed":
            raise RecordError(f"run {run_id}: tables need a stored run that passed its audit",
                              code="RUN_NOT_PASSED", write_status="not_written")
        from research.records.availability import require
        from research.records.records import _run_with_trial
        availability = require(conn, _run_with_trial(conn, run_id))
        reports = load_run(conn, run_id, account=account, exposures=exposures)
        (commit,), = db.rows(conn, "SELECT DOLT_HASHOF('HEAD')")
    return {**build_tables(reports, run_id=run_id, ledger_commit=commit, account=account, exposures=exposures), "availability":availability}


def build_tables(reports: Reports, *, run_id, ledger_commit: str | None, account: bool, exposures: bool) -> dict:
    """The `tables` result from already loaded reports (see `tables`)."""
    limitations = list((reports.summary or {}).get("limitations", []))
    returns = _returns(reports.returns, reports.summary, limitations)
    try:
        cycles = _cycles(reports.positions, reports.fills)
        economics = _economics(cycles, reports.fills, reports.summary, (reports.audit or {}).get("native_economics"),
                               limitations)
    except _Unreconciled as exc:
        raise RecordError(f"run {run_id}: tables need native reports that reconcile ({exc})",
                          code="RUN_UNRECONCILED", write_status="not_written",
                          next_actions=["Read `artifacts report`; do not analyze this run."]) from exc
    orders = [_typed(row) for row in reports.orders]
    tags_of = {order.get("client_order_id"): order.get("tags") or [] for order in orders}
    positions = []
    for row, cycle in zip(reports.positions, cycles, strict=True):
        typed, closed = _typed(row), cycle["closed"]
        positions.append({**typed, "closed": closed, "funding": cycle["funding"],
                          "price_pnl": cycle["price"] if closed else None,
                          "ts_closed_ns": typed.get("ts_last") if closed else None,
                          "closing_order_tags": tags_of.get(typed.get("closing_order_id")) if closed else None})
    cycle_of = {event_id: row["position_id"] for row, cycle in zip(reports.positions, cycles, strict=True)
                for event_id in cycle["event_ids"]}
    exposure_rows = None
    if exposures:
        if reports.exposures is None:
            limitations.append("No exposure report: open-position valuation over time was not recorded for this run.")
        else:
            exposure_rows = _exposures(reports.exposures, positions, reports.summary,
                                       economics["unrealized_residual_usdt"])
    return {
        "run_id": run_id,
        "ledger_commit": ledger_commit,
        "currency": "USDT",
        "summary": reports.summary,
        "audit": reports.audit,
        "reconciled": {"native_economics": (reports.audit or {}).get("native_economics"), **economics},
        "limitations": limitations,
        "orders": orders,
        "fills": [{**_typed(row), "cycle_position_id": cycle_of[row["event_id"]]} for row in reports.fills],
        "positions": positions,
        "account": [_typed(row) for row in reports.account] if account else None,
        "daily_returns": None if returns is None else [{"ts_event_ns": ts, "native_return": value}
                                                       for ts, value in returns],
        "exposures": exposure_rows,
        "order_events": reports.order_events,
    }


def _exposures(data: bytes, positions: list[dict], summary: dict, residual: str | None) -> list[dict]:
    """Exposure rows on the input bar grid, each tied to the one cycle held then; refuse gaps or extras.

    A row labelled T holds a cycle open after every event before the next bar
    timestamp: opened before T + step and not closed until T + step or later.
    """
    def refuse(message):
        raise RecordError(message, path=f"/{EXPOSURES}", write_status="not_written",
                          next_actions=["Do not analyze capital use from this run; report the exposure defect."])

    step = int(summary["data_interval_minutes"]) * 60_000_000_000
    first = _utc_ns(summary["input_start_utc"]) + step - 1_000_000  # bars are stamped 1 ms before each boundary
    last = _utc_ns(summary["period_end_utc"]) - 1_000_000

    def before(ns):  # grid timestamps strictly before ns
        return min(max(0, -(-(ns - first) // step)), (last - first) // step + 1)

    spans = defaultdict(list)
    last_fill = None
    for position in positions:
        events = position.get("events") or []
        if not events:
            continue
        opened = int(events[0]["ts_event"])
        last_fill = max(last_fill or 0, max(int(event["ts_event"]) for event in events))
        ended = position["ts_last"] if position["closed"] else last + 2 * step
        pid = position["position_id"]
        spans[pid[:-37] if position.get("is_snapshot") else pid].append((opened, ended, pid))
    rows, counts = [], Counter()
    for row in _rows(gzip.decompress(data)):
        typed = _typed(row)
        ts = typed["ts_event_ns"]
        if not first <= ts <= last or (ts - first) % step:
            refuse(f"exposure row at {ts} is off the input bar grid")
        owners = [pid for opened, ended, pid in spans.get(typed["position_id"], []) if opened < ts + step <= ended]
        if len(owners) != 1:
            refuse(f"exposure row at {ts} for {typed['position_id']} matches {len(owners)} position cycles")
        counts[owners[0]] += 1
        rows.append({**typed, "cycle_position_id": owners[0]})
    for cycles in spans.values():
        for opened, ended, pid in cycles:
            expected = before(ended - step + 1) - before(opened - step + 1)
            if counts[pid] != expected:
                refuse(f"exposure rows cover {counts[pid]} of {expected} timestamps of {pid}")
    if residual is not None and (last_fill is None or last_fill <= last):
        total = sum((row["unrealized_pnl"] for row in rows if row["ts_event_ns"] == last), Decimal(0))
        if abs(total - Decimal(residual)) > TOLERANCE:
            refuse(f"final exposure unrealized PnL {total} differs from the audited residual {residual}")
    return rows


def _utc_ns(text: str) -> int:
    return (datetime.fromisoformat(text.replace("Z", "+00:00")) - EPOCH) // timedelta(microseconds=1) * 1000


def _typed(row: dict) -> dict:
    result = {}
    for column, value in row.items():
        try:
            if not value:
                result[column] = None
            elif column in _LISTS:
                items = _list(value)
                result[column] = [_usdt(item) for item in items] if column == "commissions" else items
            elif column in _MONEY:
                result[column] = _usdt(value)
            elif column in _DECIMALS:
                result[column] = Decimal(value)
            elif column in _INTEGERS or (column in _NANOSECONDS and value.isdigit()):
                result[column] = int(value)
            elif column in _FLAGS:
                result[column] = {"True": True, "False": False}[value]
            else:
                result[column] = value
        except (_Unreconciled, ArithmeticError, KeyError, SyntaxError, ValueError) as exc:
            raise RecordError(f"native report cell {column}={value[:80]!r} has an unexpected format: {exc}",
                              path=f"/{column}",
                              next_actions=["Report this as a reader defect; read the raw CSV following the "
                                            "nautilus-report-analysis skill meanwhile."],
                              write_status="not_written") from exc
    return result


def _rows(data: bytes) -> list[dict]:
    csv.field_size_limit(2**31 - 1)  # positions.events holds every fill of a cycle in one cell
    csv.field_size_limit(sys.maxsize)
    return list(csv.DictReader(io.StringIO(data.decode("utf-8"), newline="")))


def _list(value: str) -> list:
    # Native reports write Python reprs (single quotes, None), not JSON.
    return ast.literal_eval(value) if value else []


def _usdt(value: str) -> Decimal:
    amount, _, currency = value.partition(" ")
    if currency != "USDT":
        raise _Unreconciled(f"non-USDT money {value!r} is outside the supported linear USDT scope")
    return Decimal(amount)


def _money(value: Decimal | None) -> str | None:
    return None if value is None else format(value.quantize(Decimal("0.00000001")), "f")


def _unique(items: list[str]) -> list[str]:
    return list(dict.fromkeys(items))


def _returns(returns: list[tuple[int, float]], summary: dict, limitations: list[str]) -> list[tuple[int, float]] | None:
    """Trade-window daily returns, accepted only when they compound to the native final equity."""
    start = datetime.fromisoformat(summary["period_start_utc"])
    start_ns = (start - EPOCH) // timedelta(microseconds=1) * 1000
    returns = [(ts, value) for ts, value in returns if ts >= start_ns]
    if not returns or any(value <= -1 for _, value in returns):
        limitations.append("The trade-window native daily return series is empty or invalid.")
        return None
    growth = Decimal(repr(math.prod(1 + value for _, value in returns)))
    if abs(Decimal(summary["starting_balance_usdt"]) * growth - Decimal(summary["final_equity_usdt"])) > TOLERANCE:
        limitations.append("Trade-window native daily returns do not compound to final_equity_usdt.")
        return None
    return returns


def _cycles(positions: list[dict], fills: list[dict]) -> list[dict]:
    """Each position row's fill cash flow, commissions and funding; every fill belongs to exactly one row."""
    cycles, events = [], Counter()
    for row in positions:
        if row.get("is_inverse") != "False" or not row.get("multiplier"):
            raise _Unreconciled("only linear instruments with a recorded multiplier are supported")
        multiplier = Decimal(row["multiplier"])
        funding = Decimal(0)
        for adjustment in _list(row["adjustments"]):
            if adjustment["adjustment_type"] != "FUNDING" or adjustment.get("quantity_change") is not None:
                raise _Unreconciled(f"unsupported position adjustment {adjustment['adjustment_type']}")
            funding += _usdt(adjustment["pnl_change"])
        price, event_ids = Decimal(0), []
        for event in _list(row["events"]):
            events[event["event_id"]] += 1
            event_ids.append(event["event_id"])
            notional = Decimal(event["last_qty"]) * Decimal(event["last_px"]) * multiplier
            price += notional if event["order_side"] == "SELL" else -notional
        cycles.append({"closed": bool(row["ts_closed"]), "realized": _usdt(row["realized_pnl"]), "funding": funding,
                       "price": price, "event_ids": event_ids, "ts_last": row.get("ts_last"),
                       "commissions": sum((_usdt(item) for item in _list(row["commissions"])), Decimal(0))})
    if events != Counter(row["event_id"] for row in fills if "event_id" in row) or any(n != 1 for n in events.values()):
        raise _Unreconciled("position events do not cover each native fill exactly once")
    return cycles


def _plans(orders: list[dict], fills: list[dict], positions: list[dict], cycles: list[dict],
           order_events=None, lifecycle_events=()) -> dict:
    """Net win rate per trade plan, read only when the reports honour the plan contract.

    Every source order carries exactly one ``plan:`` tag; an exactly linked native expiration
    closing fill can inherit that cycle's unique source plan without changing any native row.
    A plan's fills form at most one position
    cycle and each cycle holds one plan's fills; on one instrument no plan starts (its first
    ``ts_init``) before every earlier plan has ended (its last order event or cycle close; an
    order still working or a cycle still open at the end lasts to the end of the run). A plan
    wins when its cycle closed with realized PnL, which includes commissions and funding, above
    zero; a breakeven plan and a plan still open at the end are not wins.
    """
    try:
        return _plan_reading(orders, fills, positions, cycles, order_events, lifecycle_events)
    except (KeyError, TypeError, ValueError) as exc:
        raise _Unreconciled(f"a native report lacks a value the plan reading needs ({type(exc).__name__}: {exc})") from exc


def _expiry_plan_owners(orders, fills, positions, cycles, plan_of, order_events, lifecycle_events):
    """Pinned rc3's single-fill expiration close, inferred only from mutually linked native facts.

    This does not authenticate the event producer: exact-source review must exclude imitation.
    It never edits a row or exempts a canceled/no-fill/ambiguous/ordinary untagged order.
    """
    result = {}
    if not order_events or not lifecycle_events:
        return result
    for order in orders:
        oid = order['client_order_id']
        if oid in plan_of:
            continue
        if (not oid.startswith('EXPIRATION-BINANCE-') or _list(order.get('tags', '')) != ['EXPIRATION_BINANCE_CLOSE']
                or order.get('type') != 'MARKET' or order.get('is_reduce_only') != 'True'
                or order.get('status') != 'FILLED'):
            continue
        history = [e for e in order_events if e.get('client_order_id') == oid]
        closing = [f for f in fills if f.get('client_order_id') == oid]
        supplied = [e for e in lifecycle_events if e['instrument_id'] == order['instrument_id']
                    and e['ts_event'] == int(order['ts_init']) and e['close_type'] == 'CONTRACT_EXPIRED']
        if (len(closing) != 1 or len(supplied) != 1
                or [e.get('type') for e in history] != ['OrderInitialized', 'OrderAccepted', 'OrderFilled']):
            continue
        init, accepted, native_fill = history
        fill, close = closing[0], supplied[0]
        ts = close['ts_event']
        owners = [(p, c) for p, c in zip(positions, cycles, strict=True) if fill['event_id'] in c['event_ids']]
        if len(owners) != 1:
            continue
        position, cycle = owners[0]
        position_events = _list(position['events'])
        if (not cycle['closed'] or position.get('closing_order_id') != oid or not position_events
                or position_events[-1] != native_fill or init.get('event_id') != order.get('init_id')
                or init.get('tags') != ['EXPIRATION_BINANCE_CLOSE'] or init.get('reduce_only') is not True
                or init.get('order_type') != 'MARKET' or init.get('order_side') != order['side']
                or accepted.get('venue_order_id') != order.get('venue_order_id')
                or int(order['ts_last']) != ts or _utc_ns(position['ts_closed']) != ts
                or Decimal(order['quantity']) != Decimal(order['filled_qty'])
                or Decimal(fill['last_qty']) != Decimal(order['quantity'])
                or Decimal(init['quantity']) != Decimal(order['quantity'])
                or Decimal(fill['last_px']) != Decimal(close['close_price'])
                or native_fill.get('order_side') != order['side'] or native_fill.get('order_type') != order['type']
                or Decimal(position['quantity']) != 0 or position.get('side') != 'FLAT'):
            continue
        if any(e.get('ts_event') != ts or e.get('ts_init') != ts for e in history):
            continue
        identity_keys = ('instrument_id', 'trader_id', 'strategy_id')
        if any(any(e.get(k) != order.get(k) for k in identity_keys) for e in history):
            continue
        if any(fill.get(k) != order.get(k) or position.get(k) != order.get(k)
               for k in (*identity_keys, 'account_id', 'position_id')):
            continue
        if any(e.get('account_id') != order.get('account_id') for e in (accepted, native_fill)):
            continue
        if any(native_fill.get(k) != fill.get(k) for k in ('event_id', 'client_order_id', 'venue_order_id',
                                                          'trade_id', 'commission', 'currency', 'order_side',
                                                          'order_type', 'liquidity_side', 'last_px', 'last_qty')):
            continue
        if any(_utc_ns(fill[k]) != ts for k in ('ts_event', 'ts_init')) or native_fill.get('position_id') != position['position_id']:
            continue
        signed = sum((Decimal(e['last_qty']) * (1 if e['order_side'] == 'BUY' else -1)
                      for e in position_events[:-1]), Decimal(0))
        if (signed == 0 or (signed > 0) != (order['side'] == 'SELL')
                or abs(signed) != Decimal(fill['last_qty'])
                or any(e['ts_event'] >= ts for e in position_events[:-1])):
            continue
        prior_orders = {f['client_order_id'] for f in fills if f['event_id'] in cycle['event_ids'] and f['client_order_id'] != oid}
        if not prior_orders or any(key not in plan_of for key in prior_orders):
            continue
        orders_by_id = {o['client_order_id']: o for o in orders}
        if len(orders_by_id) != len(orders):
            continue
        prior_valid = True
        for event in position_events[:-1]:
            native = [e for e in order_events if e.get('event_id') == event['event_id']]
            csv = [f for f in fills if f['event_id'] == event['event_id']]
            if len(native) != 1 or native[0] != event or len(csv) != 1:
                prior_valid = False
                break
            source_order = orders_by_id.get(event['client_order_id'], {})
            if (any(event.get(k) != position.get(k) or csv[0].get(k) != position.get(k)
                    or source_order.get(k) != position.get(k) for k in (*identity_keys, 'account_id', 'position_id'))
                    or event.get('order_side') != source_order.get('side')
                    or event.get('order_type') != source_order.get('type')):
                prior_valid = False
                break
            if any(event.get(k) != csv[0].get(k) for k in ('client_order_id', 'venue_order_id', 'trade_id',
                                                          'commission', 'currency', 'order_side', 'order_type',
                                                          'liquidity_side', 'last_px', 'last_qty')):
                prior_valid = False
                break
            if any(_utc_ns(csv[0][k]) != event[k] for k in ('ts_event', 'ts_init')):
                prior_valid = False
                break
        if not prior_valid:
            continue
        plans = {plan_of[key] for key in prior_orders}
        if len(plans) == 1:
            result[oid] = next(iter(plans))
    return result


def _plan_reading(orders: list[dict], fills: list[dict], positions: list[dict], cycles: list[dict],
                  order_events=None, lifecycle_events=()) -> dict:
    def sample(items):
        items = sorted(items)
        return ", ".join(items[:5]) + (f" and {len(items) - 5} more" if len(items) > 5 else "")

    plan_of, untagged, doubled = {}, [], []
    for order in orders:
        try:
            tags = [tag for tag in _list(order.get("tags", "")) if str(tag).startswith(PLAN_TAG)]
        except (SyntaxError, ValueError) as exc:
            raise _Unreconciled(f"order {order.get('client_order_id')} has unreadable tags") from exc
        if len(tags) == 1 and len(tags[0]) > len(PLAN_TAG):
            plan_of[order["client_order_id"]] = tags[0][len(PLAN_TAG):]
        else:
            (doubled if tags else untagged).append(order["client_order_id"])
    inherited = _expiry_plan_owners(orders, fills, positions, cycles, plan_of, order_events, lifecycle_events)
    plan_of.update(inherited)
    untagged = [oid for oid in untagged if oid not in inherited]
    if untagged:
        raise _Unreconciled(f"{len(untagged)} orders carry no plan tag ({sample(untagged)})")
    if doubled:
        raise _Unreconciled(f"{len(doubled)} orders carry more than one plan tag ({sample(doubled)})")
    instrument, span = {}, {}
    for order in orders:
        plan = plan_of[order["client_order_id"]]
        if instrument.setdefault(plan, order["instrument_id"]) != order["instrument_id"]:
            raise _Unreconciled(f"plan {plan} has orders on {instrument[plan]} and {order['instrument_id']}")
        start, end = span.get(plan, (int(order["ts_init"]), 0))
        last = int(order["ts_last"]) if order["status"] in _TERMINAL_ORDERS else None
        span[plan] = (min(start, int(order["ts_init"])), None if end is None or last is None else max(end, last))
    order_of_event = {fill["event_id"]: fill.get("client_order_id") for fill in fills}
    result = {}
    for row, cycle in zip(positions, cycles, strict=True):
        try:
            owners = {plan_of[order_of_event[event_id]] for event_id in cycle["event_ids"]}
        except KeyError as exc:
            raise _Unreconciled(f"a fill of position cycle {row['position_id']} has no order in orders.csv") from exc
        if not owners:
            raise _Unreconciled(f"position cycle {row['position_id']} holds no fills")
        if len(owners) != 1:
            raise _Unreconciled(f"position cycle {row['position_id']} holds fills of plans {sample(owners)}")
        plan, = owners
        if plan in result:
            raise _Unreconciled(f"plan {plan} has fills in more than one position cycle")
        result[plan] = cycle
        start, end = span[plan]
        span[plan] = (start, max(end, int(row["ts_last"])) if cycle["closed"] and end is not None else None)
    by_instrument = {}
    for plan, (start, end) in span.items():
        if end is not None and end <= start:
            continue  # every order ended the moment it began: the plan never held anything
        by_instrument.setdefault(instrument[plan], []).append((start, math.inf if end is None else end, plan))
    for name, spans in by_instrument.items():
        spans.sort()
        latest = None  # (end, plan) of the latest-ending earlier plan
        for start, end, plan in spans:
            if latest is not None and start < latest[0]:
                ends = "the end of the run" if latest[0] == math.inf else latest[0]
                raise _Unreconciled(f"plans {latest[1]} and {plan} on {name} overlap: {plan} starts at {start}, "
                                    f"before {latest[1]} ends at {ends}")
            if latest is None or end > latest[0]:
                latest = (end, plan)
    closed = [cycle for cycle in result.values() if cycle["closed"]]
    wins = sum(cycle["realized"] > 0 for cycle in closed)
    counted = len(result)
    return {"closed": len(closed), "wins": wins, "win_rate": wins / counted if counted else None,
            "open": counted - len(closed)}


def _economics(cycles: list[dict], fills: list[dict], summary: dict, economics: dict | None,
               limitations: list[str]) -> dict:
    closed = [cycle for cycle in cycles if cycle["closed"]]
    opened = [cycle for cycle in cycles if not cycle["closed"]]

    def total(items, key):
        return sum((item[key] for item in items), Decimal(0))

    if abs(total(cycles, "commissions") - sum((_usdt(row["commission"]) for row in fills), Decimal(0))) > TOLERANCE:
        raise _Unreconciled("position commissions differ from fill commissions")
    if any(abs(c["price"] - c["commissions"] + c["funding"] - c["realized"]) > TOLERANCE for c in closed):
        raise _Unreconciled("a closed position's fill cash flow, commissions and funding do not equal its realized PnL")
    if len(closed) != summary["closed_trades"]:
        raise _Unreconciled("closed position rows differ from summary closed_trades")
    residual = None
    if economics is not None:
        expected = {"realized": economics["reported_realized_pnl_usdt"], "commissions": economics["fill_commissions_usdt"],
                    "funding": economics["reported_funding_usdt"]}
        if any(abs(total(cycles, key) - Decimal(value)) > TOLERANCE for key, value in expected.items()):
            raise _Unreconciled("position totals differ from the audited native_economics")
        residual = Decimal(summary["final_equity_usdt"]) - Decimal(economics["final_balance_usdt"])
        if not opened and residual != 0:
            limitations.append("unrealized_residual_usdt is nonzero although no position remains open.")
    if any(abs(c["realized"] - (c["funding"] - c["commissions"])) > TOLERANCE for c in opened):
        limitations.append("Open-position realized PnL includes partial-close price PnL, not only entry commissions and funding.")
    if not closed:
        limitations.append("No position closed: closed-position readings are null.")
    return {
        "closed": {
            key: _money(total(closed, field)) if closed else None
            for key, field in (("reported_realized_pnl_usdt", "realized"), ("fill_commissions_usdt", "commissions"),
                               ("reported_funding_usdt", "funding"), ("price_pnl_usdt", "price"))
        },
        "closed_trades": len(closed),
        "open_positions": len(opened),
        "unrealized_residual_usdt": _money(residual),
    }
