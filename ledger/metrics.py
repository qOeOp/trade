"""Native run metrics (`ledger.metrics` and its parts, `ledger.load_run`, `ledger.metrics_revision`).

A sealed run keeps in the ledger only what its native reports cannot give back once they are
gone: the sealed single-run report (`metrics`), the daily series and one row per position cycle.
Everything here reads native report rows as the runner wrote them (strings, never converted in
place) and computes with Decimal; a native fact outside the supported scope or a failed
reconciliation is a named reason (`unreconciled`) that empties only the metric it belongs to and
is listed among the metric limitations, never a verdict on the run.
"""

from __future__ import annotations

import ast
import bisect
from collections import Counter, defaultdict
from collections.abc import Iterable, Mapping
import csv
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal
import gzip
import hashlib
import io
import json
import math
from pathlib import Path
import re
import subprocess
from typing import Any

from engine.native_csv import dict_reader
from ledger import db
from ledger.refusals import refuse


CATALOGUE = "measures@2026-10-22"
TOLERANCE = Decimal("0.000001")
EQUITY_TOLERANCE = Decimal("0.01")  # compounding to final equity; an uncalibrated example value
MONEY = Decimal("0.00000001")  # DECIMAL(24,8), the ledger's money scale
PLAN_TAG = "plan:"
PLAN_TAG_LIMIT = 160  # run_cycle.plan_tag VARCHAR(160)
# A closed cycle's price PnL (fill cash flow) as Nautilus' realized PnL + commissions - funding; read,
# not stored.
PRICE_PNL = "realized_pnl + commissions - funding AS price_pnl"
CYCLE_COLUMNS = ("trial_id, seq, instrument_id, side, ts_opened_ns, ts_closed_ns, realized_pnl, commissions, funding, "
                 f"{PRICE_PNL}, open_unrealized, plan_tag, closing_order_type, closing_order_tag")
TERMINAL_ORDERS = frozenset({"FILLED", "CANCELED", "EXPIRED", "DENIED", "REJECTED"})
EPOCH = datetime(1970, 1, 1, tzinfo=UTC)
DAY_NS = 86_400 * 10**9
REPORT_FILES = {"orders": "orders.csv", "fills": "fills.csv", "positions": "positions.csv", "account": "account.csv",
                "returns": "returns_series.csv", "exposures": "exposures.csv.gz",
                "order_events": "order_events.jsonl.gz"}
# Written since engine.write_fill_volumes: a run on an older runtime image has none and seals no participation.
OPTIONAL_REPORT_FILES = {"fill_volumes": "fill_volumes.csv"}
ENGINE_ORDERS = ("EXPIRATION-", "LIQUIDATION-")  # the engine's own settlement and liquidation orders
SUMMARY = "summary.json"
SUMMARY_KEYS = ("starting_balance_usdt", "final_equity_usdt", "closed_trades", "data_interval_minutes",
                "period_start_utc", "period_end_utc")
AUDIT = "audit/audit.json"
COVERAGE = "input-coverage.json"
_NANOSECONDS = re.compile(r"(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]00:?00)?\Z")


class Unreconciled(Exception):
    """A named reason (code and detail) why one metric cannot be given; `str()` is "CODE: detail"."""

    def __init__(self, code: str, detail: str):
        super().__init__(f"{code}: {detail}")
        self.code, self.detail = code, detail


def unreconciled(code: str, detail: str) -> Unreconciled:
    return Unreconciled(code, detail)


def _sample(items: Iterable) -> str:
    items = sorted(str(item) for item in items)
    return ", ".join(items[:5]) + (f" and {len(items) - 5} more" if len(items) > 5 else "")


# Native values

def utc_ns(text: str) -> int:
    """UTC nanoseconds of a native time: an integer, or ISO-8601 with up to nine fraction digits."""
    text = str(text).strip()
    if text.isdigit():
        return int(text)
    found = _NANOSECONDS.fullmatch(text)
    if found is None:
        moment = datetime.fromisoformat(text.replace("Z", "+00:00"))
        if moment.utcoffset() != timedelta(0):
            raise ValueError(f"{text!r} is not a UTC time")
        return (moment - EPOCH) // timedelta(microseconds=1) * 1000
    day, hour, minute, second, fraction, _ = found.groups()
    base = datetime.fromisoformat(f"{day}T{hour}:{minute}:{second}+00:00")
    return int((base - EPOCH).total_seconds()) * 10**9 + int((fraction or "").ljust(9, "0"))


def iso_minute(ns: int | None) -> str | None:
    return None if ns is None else (EPOCH + timedelta(microseconds=ns // 1000)).isoformat()[:16]


def _list(value: str) -> list:
    # Native reports write Python reprs (single quotes, None), not JSON.
    return ast.literal_eval(value) if value else []


def _usdt(value: str) -> Decimal:
    amount, _, currency = str(value).partition(" ")
    if currency != "USDT":
        raise unreconciled("NON_USDT_MONEY", f"money {value!r} is not USDT")
    return Decimal(amount)


def money(value: Decimal | None) -> str | None:
    return None if value is None else format(value.quantize(MONEY), "f")


# Reports

@dataclass
class Reports:
    """One run's native reports as the runner wrote them; rows keep their native string values."""

    summary: dict | None
    audit: dict | None
    orders: list[dict]
    fills: list[dict]
    positions: list[dict]
    account: list[dict]
    returns: list[tuple[int, float]]
    exposures: Iterable[dict] | None  # ExposureRows from a file, or rows
    order_events: list[dict] | None
    lifecycle_events: tuple[dict, ...] = ()
    coverage: dict | None = None
    present: frozenset = frozenset()
    fill_volumes: list[dict] | None = None


def _csv(data: bytes) -> list[dict]:
    return list(dict_reader(io.StringIO(data.decode("utf-8"), newline="")))


class ExposureRows:
    """The exposure report's rows, streamed from its gzip bytes each time they are iterated: a long
    multi-contract one-minute table is never held as rows."""

    def __init__(self, data: bytes):
        self.data = data
        for _ in self:  # read once at load: a file that does not parse is unreadable, not a missing metric
            pass

    def __iter__(self):
        with gzip.GzipFile(fileobj=io.BytesIO(self.data)) as packed:
            yield from dict_reader(io.TextIOWrapper(packed, encoding="utf-8", newline=""))


def _unreadable(name: str, exc: Exception):
    return refuse("REPORT_UNREADABLE", f"{name} is not a readable native report ({type(exc).__name__})",
                  missing=(name,))


def _report_root(directory: Path) -> tuple[Path, Path]:
    """(replay working directory, report directory) of a working directory or a report directory."""
    directory = Path(directory)
    if (directory / "reports").is_dir():
        return directory, directory / "reports"
    return directory.parent, directory


def _regular(path: Path) -> bytes | None:
    """The bytes of a regular file, never through a link; None when there is none."""
    try:
        return path.read_bytes() if path.is_file() and not path.is_symlink() else None
    except OSError:
        return None


REPORTS_DIR = "reports"
WORKDIR_FILES = (f"{REPORTS_DIR}/{SUMMARY}", *(f"{REPORTS_DIR}/{name}" for name in REPORT_FILES.values()),
                 *(f"{REPORTS_DIR}/{name}" for name in OPTIONAL_REPORT_FILES.values()), AUDIT, COVERAGE)


def load_directory(directory: Path, account: bool = True, exposures: bool = True) -> Reports:
    """The native reports of a replay working directory (or its reports/), parsed but not converted.

    Only regular files count (a link is missing); the audit result is audit/audit.json beside
    reports/ and nothing else.
    """
    root, base = _report_root(directory)
    files = {}
    for name in WORKDIR_FILES:
        path = base / name.removeprefix(f"{REPORTS_DIR}/") if name.startswith(f"{REPORTS_DIR}/") else root / name
        data = _regular(path)
        if data is not None:
            files[name] = data
    return load_files(files, account, exposures)


def load_files(files, account: bool = True, exposures: bool = True) -> Reports:
    """The native reports from their bytes by working-directory path (reports/<name>, audit/audit.json,
    input-coverage.json).

    A missing file is empty (None for the summary, audit, exposures, order events and fill volumes); `present`
    names the report files that exist. A file that exists but does not parse is REPORT_UNREADABLE.
    """
    present = set()

    def read(name: str) -> bytes | None:
        data = files.get(f"{REPORTS_DIR}/{name}")
        if data is not None:
            present.add(name)
        return data

    def parsed(name: str, parse):
        data = read(name)
        if data is None:
            return None
        try:
            return parse(data)
        except (UnicodeDecodeError, ValueError, KeyError, csv.Error, OSError, EOFError) as exc:
            raise _unreadable(name, exc) from exc

    def json_file(data: bytes | None, name: str):
        if data is None:
            return None
        try:
            value = json.loads(data.decode("utf-8"))
        except (UnicodeDecodeError, ValueError) as exc:
            raise _unreadable(name, exc) from exc
        return value if isinstance(value, dict) else None

    summary = json_file(read(SUMMARY), SUMMARY)
    audit = json_file(files.get(AUDIT), AUDIT)
    rows = {name: parsed(REPORT_FILES[name], _csv) or [] for name in ("orders", "fills", "positions")}
    account_rows = parsed(REPORT_FILES["account"], _csv) if account else None
    returns = parsed(REPORT_FILES["returns"], lambda data: [(int(row["ts_event_ns"]), float(row["native_return"]))
                                                            for row in _csv(data)])
    exposure_rows = parsed(REPORT_FILES["exposures"], ExposureRows) if exposures else None
    events = parsed(REPORT_FILES["order_events"], lambda data: [json.loads(line) for line in
                                                                 gzip.decompress(data).splitlines() if line.strip()])
    return Reports(summary=summary, audit=audit, orders=rows["orders"], fills=rows["fills"],
                   positions=rows["positions"], account=account_rows or [], returns=returns or [],
                   exposures=exposure_rows, order_events=events, coverage=json_file(files.get(COVERAGE), COVERAGE),
                   present=frozenset(present), fill_volumes=parsed(OPTIONAL_REPORT_FILES["fill_volumes"], _csv))


def load_run(conn: db.LedgerConnection | None = None, trial_id: int | None = None, directory: Path | None = None,
             account: bool = True, exposures: bool = True):
    """One run: a sealed run by `trial_id` on `conn`, or an unsealed replay directory.

    A sealed run gives {run, trial, sealed (by metrics revision), returns, cycles, capture, evidence};
    its native reports are not in the ledger (replay.reproduce gives them back). A passed run whose
    original capture is missing is named in `evidence.unavailable` (the qualification view marks it
    unusable); a coverage receipt naming other inputs than the stored
    input identity refuses. A directory gives its parsed native `Reports`.
    """
    if conn is None:
        if directory is None:
            raise ValueError("load_run needs a connection and trial_id, or a directory")
        return load_directory(directory, account, exposures)
    from ledger import execution
    run = conn.one("SELECT trial_id, status, failure_reasons, audit, fingerprints, created_at FROM run "
                   "WHERE trial_id = %s", (trial_id,))
    if run is None:
        raise refuse("UNKNOWN_RUN", f"no run {trial_id!r} on this ledger version", missing=(str(trial_id),))
    for key in ("failure_reasons", "audit", "fingerprints"):
        run[key] = json.loads(run[key]) if isinstance(run[key], (str, bytes)) else run[key]
    trial = conn.one(f"SELECT trial_id, purpose, source_sha256, image_ref, {db.IMAGE_DIGEST}, instruments, input_start, "
                     "trade_start, trade_end FROM trial WHERE trial_id = %s", (run["trial_id"],))
    capture = execution.read_capture(conn, run["trial_id"])
    stored_identity = capture["start"].get("input_identity")
    receipts = [capture.get("input_coverage")]
    started = capture.get("input_coverage_bytes")
    if capture["status"] == "captured" and (started is None or execution.listed_sha256(capture, COVERAGE)
                                            != hashlib.sha256(started).hexdigest()):
        receipts.append(None)  # the receipt the container read is not the start receipt's
    if any(not isinstance(item, dict) or item.get("input_identity") != stored_identity for item in receipts):
        raise refuse("EXECUTION_IDENTITY", f"the coverage receipts of run {trial_id} name other inputs than its stored "
                                           "input identity", missing=(COVERAGE,))
    unavailable = []
    if run["status"] == "passed" and capture["status"] != "captured":
        unavailable.append(f"CAPTURE_MISSING: {capture.get('reason')}")
    sealed = {revision: json.loads(report) if isinstance(report, (str, bytes)) else report
              for revision, report in conn.rows("SELECT metrics_revision, report FROM run_sealed WHERE trial_id = %s "
                                                "ORDER BY metrics_revision", (trial_id,))}
    returns = [(ts, value, mean) for ts, value, mean in conn.rows(
        "SELECT ts_event_ns, native_return, mean_gross_notional FROM run_return WHERE trial_id = %s ORDER BY ts_event_ns",
        (trial_id,))]
    cycles = conn.dicts(f"SELECT {CYCLE_COLUMNS} FROM run_cycle WHERE trial_id = %s ORDER BY seq", (trial_id,))
    return {"run": run, "trial": trial, "sealed": sealed, "returns": returns, "cycles": cycles, "capture": capture,
            "evidence": {"capture": capture["status"],
                         "fingerprints": "missing" if run["fingerprints"] is None else "recorded",
                         "unavailable": unavailable}}


def latest_sealed(conn: db.LedgerConnection, trial_id: int, sealed: dict) -> dict | None:
    """The run's latest sealed result (by sealing time) among `sealed` (load_run's, by metrics revision),
    with the metrics revision of its row."""
    found = conn.rows("SELECT metrics_revision FROM run_sealed WHERE trial_id = %s ORDER BY created_at DESC, "
                      "metrics_revision DESC LIMIT 1", (trial_id,))
    report = sealed.get(found[0][0]) if found else None
    return None if report is None else {**report, "metrics_revision": found[0][0]}


# Position cycles and economics

def cycles(positions: list[dict], fills: list[dict]) -> list[dict]:
    """Each position row's fill cash flow, commissions and funding; every fill belongs to exactly one row."""
    found: list[dict] = []
    events: Counter[str] = Counter()
    for row in positions:
        try:
            if row.get("is_inverse") != "False" or not row.get("multiplier"):
                raise unreconciled("UNSUPPORTED_INSTRUMENT", f"position {row.get('position_id')} is inverse or has no "
                                                             "recorded multiplier")
            multiplier = Decimal(row["multiplier"])
            funding = Decimal(0)
            for adjustment in _list(row.get("adjustments", "")):
                if adjustment.get("adjustment_type") != "FUNDING" or adjustment.get("quantity_change") is not None:
                    raise unreconciled("UNSUPPORTED_ADJUSTMENT", f"position {row.get('position_id')} has a "
                                                                 f"{adjustment.get('adjustment_type')} adjustment")
                funding += _usdt(adjustment["pnl_change"])
            price, event_ids, times = Decimal(0), [], []
            for event in _list(row.get("events", "")):
                events[event["event_id"]] += 1
                event_ids.append(event["event_id"])
                times.append(int(event["ts_event"]))
                notional = Decimal(event["last_qty"]) * Decimal(event["last_px"]) * multiplier
                price += notional if event["order_side"] == "SELL" else -notional
            closed = bool(row.get("ts_closed"))
            found.append({"closed": closed, "realized": _usdt(row["realized_pnl"]), "price": price,
                          "commissions": sum((_usdt(item) for item in _list(row.get("commissions", ""))), Decimal(0)),
                          "funding": funding, "event_ids": event_ids, "ts_last": int(row["ts_last"]),
                          "ts_opened": min(times) if times else utc_ns(row["ts_opened"])})
        except Unreconciled:
            raise
        except (KeyError, TypeError, ValueError, SyntaxError, ArithmeticError) as exc:
            raise unreconciled("NATIVE_VALUE_UNREADABLE", f"position {row.get('position_id')}: "
                                                          f"{type(exc).__name__}") from exc
    if events != Counter(row.get("event_id") for row in fills) or any(count != 1 for count in events.values()):
        raise unreconciled("FILL_COVERAGE_MISMATCH", "position events do not cover each native fill exactly once")
    return found


def closed_by_year(found: list[dict]) -> dict:
    """Closed cycles' price PnL, commissions and funding by the UTC year of their last event."""
    years: dict[str, dict] = {}
    for cycle in found:
        if not cycle["closed"]:
            continue
        year = str((EPOCH + timedelta(microseconds=cycle["ts_last"] // 1000)).year)
        item = years.setdefault(year, {"closed_trades": 0, "price": Decimal(0), "commissions": Decimal(0),
                                       "funding": Decimal(0)})
        item["closed_trades"] += 1
        for key in ("price", "commissions", "funding"):
            item[key] += cycle[key]
    return {year: {"closed_trades": item["closed_trades"], "price_pnl_usdt": money(item["price"]),
                   "fill_commissions_usdt": money(item["commissions"]),
                   "reported_funding_usdt": money(item["funding"])} for year, item in sorted(years.items())}


def economics(found: list[dict], fills: list[dict], summary: dict, audited_economics: dict | None,
              limitations: list[str]) -> dict:
    """Reconcile every cycle (price - commissions + funding = realized) and the totals with the audit."""
    closed = [cycle for cycle in found if cycle["closed"]]
    opened = [cycle for cycle in found if not cycle["closed"]]

    def total(items, key):
        return sum((item[key] for item in items), Decimal(0))

    try:
        fill_commissions = sum((_usdt(row["commission"]) for row in fills), Decimal(0))
    except (KeyError, ArithmeticError) as exc:
        raise unreconciled("NATIVE_VALUE_UNREADABLE", "a fill has no readable commission") from exc
    if abs(total(found, "commissions") - fill_commissions) > TOLERANCE:
        raise unreconciled("COMMISSION_MISMATCH", "position commissions differ from fill commissions")
    failed = [index for index, c in enumerate(found) if c["closed"]
              and abs(c["price"] - c["commissions"] + c["funding"] - c["realized"]) > TOLERANCE]
    if failed:
        raise unreconciled("CYCLE_IDENTITY_FAILED", f"closed cycles {_sample(failed)} do not reconcile")
    if len(closed) != summary.get("closed_trades"):
        raise unreconciled("CLOSED_COUNT_MISMATCH", f"{len(closed)} closed cycles, the summary has "
                                                    f"{summary.get('closed_trades')}")
    residual, account = None, None
    if audited_economics is None:
        limitations.append("AUDIT_ECONOMICS_ABSENT: the cycles are reconciled only with the run's own reports")
    else:
        expected: dict[str, Any] = {"realized": audited_economics.get("reported_realized_pnl_usdt"),
                                    "commissions": audited_economics.get("fill_commissions_usdt"),
                                    "funding": audited_economics.get("reported_funding_usdt")}
        try:
            differs = [key for key, value in expected.items() if abs(total(found, key) - Decimal(value)) > TOLERANCE]
            residual = Decimal(summary["final_equity_usdt"]) - Decimal(audited_economics["final_balance_usdt"])
        except (TypeError, KeyError, ArithmeticError) as exc:
            raise unreconciled("AUDIT_ECONOMICS_MISMATCH", "the audited account economics are incomplete") from exc
        if differs:
            raise unreconciled("AUDIT_ECONOMICS_MISMATCH", "cycle totals differ from the audit in " + ", ".join(differs))
        account = {"fill_commissions_usdt": money(Decimal(expected["commissions"])),
                   "reported_funding_usdt": money(Decimal(expected["funding"]))}
        if not opened and residual != 0:
            limitations.append("UNREALIZED_RESIDUAL: final equity differs from the audited balance with no open "
                               "position")
    if any(abs(c["realized"] - (c["funding"] - c["commissions"])) > TOLERANCE for c in opened):
        limitations.append("OPEN_PARTIAL_CLOSE: an open cycle's realized PnL includes partial-close price PnL")
    if not closed:
        limitations.append("NO_CLOSED_CYCLE: the closed-position split is empty")
    return {"closed": None if not closed else {
                "reported_realized_pnl_usdt": money(total(closed, "realized")),
                "fill_commissions_usdt": money(total(closed, "commissions")),
                "reported_funding_usdt": money(total(closed, "funding")),
                "price_pnl_usdt": money(total(closed, "price"))},
            "closed_trades": len(closed), "open_positions": len(opened), "closed_by_year": closed_by_year(found),
            "account": account, "unrealized_residual_usdt": money(residual)}


# Plans

def _plan_tags(order: dict) -> list[str]:
    try:
        return [tag for tag in _list(order.get("tags", "")) if str(tag).startswith(PLAN_TAG)]
    except (SyntaxError, ValueError) as exc:
        raise unreconciled("NATIVE_VALUE_UNREADABLE", f"order {order.get('client_order_id')} has unreadable "
                                                      "tags") from exc


def expiry_plan_owners(orders: list[dict], fills: list[dict], positions: list[dict], found: list[dict],
                       plan_of: dict[str | None, str], order_events: list[dict] | None,
                       lifecycle_events: tuple[dict, ...]) -> dict[str | None, str]:
    """Untagged engine settlement closes owned read-only by the one closed cycle's plan they end.

    Every condition must hold (one fill, events initialized/accepted/filled at the InstrumentClose
    of its instrument at the close price, the cycle's last order, earlier fills all one plan);
    anything ambiguous is skipped and left to plan_metrics as untagged.
    """
    closes = defaultdict(list)
    for event in lifecycle_events or ():
        if event.get("type") == "InstrumentClose":
            closes[event.get("instrument_id")].append(event)
    if not order_events or not closes:
        return {}
    events_of = defaultdict(list)
    for event in order_events:
        events_of[event.get("client_order_id")].append(event)
    fills_of = defaultdict(list)
    for fill in fills:
        fills_of[fill.get("client_order_id")].append(fill)
    cycle_of_event = {event_id: index for index, cycle in enumerate(found) for event_id in cycle["event_ids"]}
    owners: dict[str | None, str] = {}
    for order in orders:
        order_id = order.get("client_order_id")
        if (order_id in plan_of or order.get("is_reduce_only") != "True" or order.get("type") != "MARKET"
                or order.get("status") != "FILLED" or "EXPIRY" not in str(order.get("tags", "")).upper()):
            continue
        settlement = closes.get(order.get("instrument_id"), [])
        mine, sequence = fills_of.get(order_id, []), [event.get("type") for event in events_of.get(order_id, [])]
        if len(settlement) != 1 or len(mine) != 1 or sequence != ["OrderInitialized", "OrderAccepted", "OrderFilled"]:
            continue
        close, fill = settlement[0], mine[0]
        try:
            at, price = int(close["ts_event"]), Decimal(str(close["close_price"]))
            same_time = utc_ns(fill["ts_event"]) == at and all(int(event["ts_event"]) == at
                                                               for event in events_of[order_id])
            same_price = Decimal(fill["last_px"]) == price
        except (KeyError, TypeError, ValueError, ArithmeticError):
            continue
        index = cycle_of_event.get(fill.get("event_id"))
        if not same_time or not same_price or index is None or not found[index]["closed"]:
            continue
        if positions[index].get("closing_order_id") != order_id:
            continue
        earlier = [event_id for event_id in found[index]["event_ids"] if event_id != fill.get("event_id")]
        order_of = {item.get("event_id"): item.get("client_order_id") for item in fills}
        plans = {plan_of.get(order_of.get(event_id)) for event_id in earlier}
        plan = plans.pop() if len(plans) == 1 else None
        if earlier and plan is not None:
            owners[order_id] = plan
    return owners


def plan_metrics(orders: list[dict], fills: list[dict], positions: list[dict], found: list[dict],
                 order_events: list[dict] | None, lifecycle_events: tuple[dict, ...]) -> dict:
    """Plans read from order tags, matched one to one with position cycles; the plan win rate."""
    plan_of: dict[str | None, str] = {}
    untagged: list[str | None] = []
    doubled: list[str | None] = []
    for order in orders:
        tags = _plan_tags(order)
        if len(tags) == 1 and len(tags[0]) > len(PLAN_TAG):
            plan_of[order["client_order_id"]] = tags[0]
        else:
            (doubled if tags else untagged).append(order.get("client_order_id"))
    if doubled:
        raise unreconciled("PLAN_TAG_MULTIPLE", f"orders {_sample(doubled)} carry more than one plan tag")
    long = [order_id for order_id, tag in plan_of.items() if len(tag) > PLAN_TAG_LIMIT]
    if long:
        raise unreconciled("PLAN_TAG_TOO_LONG", f"orders {_sample(long)} carry a plan tag longer than "
                                                f"{PLAN_TAG_LIMIT} characters")
    plan_of.update(expiry_plan_owners(orders, fills, positions, found, plan_of, order_events, lifecycle_events))
    untagged = [order_id for order_id in untagged if order_id not in plan_of]
    if untagged:
        raise unreconciled("PLAN_TAG_MISSING", f"orders {_sample(untagged)} carry no plan tag")
    instrument: dict[str, str] = {}
    span: dict[str, tuple[int, int | None]] = {}
    try:
        for order in orders:
            plan = plan_of[order["client_order_id"]]
            if instrument.setdefault(plan, order["instrument_id"]) != order["instrument_id"]:
                raise unreconciled("PLAN_MULTI_INSTRUMENT", f"plan {plan} has orders on {instrument[plan]} and "
                                                            f"{order['instrument_id']}")
            start, end = span.get(plan, (int(order["ts_init"]), 0))
            last = int(order["ts_last"]) if order["status"] in TERMINAL_ORDERS else None
            span[plan] = (min(start, int(order["ts_init"])), None if end is None or last is None else max(end, last))
    except (KeyError, TypeError, ValueError) as exc:
        raise unreconciled("NATIVE_VALUE_UNREADABLE", f"an order lacks a field plans need ({exc})") from exc
    order_of_event = {fill.get("event_id"): fill.get("client_order_id") for fill in fills}
    result = {}
    for row, cycle in zip(positions, found, strict=True):
        try:
            owners = {plan_of[order_of_event[event_id]] for event_id in cycle["event_ids"]}
        except KeyError as exc:
            raise unreconciled("PLAN_FILL_UNMATCHED", f"a fill of cycle {row.get('position_id')} has no "
                                                      "order") from exc
        if len(owners) != 1:
            raise unreconciled("CYCLE_MULTI_PLAN", f"cycle {row.get('position_id')} holds fills of "
                                                   f"{len(owners)} plans ({_sample(owners)})")
        plan, = owners
        if plan in result:
            raise unreconciled("PLAN_MULTI_CYCLE", f"plan {plan} has fills in more than one cycle")
        result[plan] = cycle
        start, end = span[plan]
        span[plan] = (start, max(end, cycle["ts_last"]) if cycle["closed"] and end is not None else None)
    by_instrument: defaultdict[str, list[tuple[int, float, str]]] = defaultdict(list)
    for plan, (start, end) in span.items():
        if end is not None and end <= start:
            continue  # every order ended the moment it began: the plan never held anything
        by_instrument[instrument[plan]].append((start, math.inf if end is None else end, plan))
    for name, spans in by_instrument.items():
        latest = None
        for start, until, plan in sorted(spans):
            if latest is not None and start < latest[0]:
                raise unreconciled("PLAN_OVERLAP", f"plan {plan} on {name} starts at {start}, before plan "
                                                   f"{latest[1]} ends")
            if latest is None or until > latest[0]:
                latest = (until, plan)
    closed = [cycle for cycle in result.values() if cycle["closed"]]
    wins = sum(cycle["realized"] > 0 for cycle in closed)
    counted = len(result)
    return {"closed": len(closed), "wins": wins, "open": counted - len(closed),
            "win_rate": wins / counted if counted else None}


# Daily returns, the mark-equity path and drawdown

def daily_returns(returns: list[tuple[int, float]], summary: dict, limitations: list[str]):
    """Trade-window UTC daily returns that compound to final equity; None with a named limitation otherwise."""
    start, end = utc_ns(summary["period_start_utc"]), utc_ns(summary["period_end_utc"])
    window = [(ts, value) for ts, value in returns if ts >= start]
    if not window or any(value <= -1 for _, value in window):
        limitations.append("RETURN_SERIES_INVALID: the trade-window daily returns are empty or hold a value <= -1")
        return None
    times = [ts for ts, _ in window]
    first_day = start - start % DAY_NS
    expected = list(range(first_day if first_day == start else first_day + DAY_NS, end, DAY_NS))
    if times != expected:
        limitations.append("RETURN_CLOCK_GAP: the daily returns miss, repeat or misplace a UTC day")
        return None
    growth = Decimal(repr(math.prod(1 + value for _, value in window)))
    if abs(Decimal(summary["starting_balance_usdt"]) * growth - Decimal(summary["final_equity_usdt"])) > EQUITY_TOLERANCE:
        limitations.append("RETURN_COMPOUNDING_MISMATCH: the daily returns do not compound to final equity")
        return None
    return window


def _optional_realized(value) -> Decimal | None:
    try:
        found = value if isinstance(value, Decimal) else _usdt(value)
        return found if found.is_finite() else None
    except (ValueError, TypeError, ArithmeticError, AttributeError, Unreconciled):
        return None


class ExposureTable:
    """The typed exposure rows aggregated per bar label in one pass (open rows, unrealized PnL, gross
    notional); the rows of one label are read again from the source when asked."""

    def __init__(self, source: Iterable[dict]):
        self._source = source
        self.by_label: dict[int, list] = {}
        for row in self.rows():
            found = self.by_label.setdefault(row["ts_event_ns"], [0, Decimal(0), Decimal(0)])
            found[0] += 1
            found[1] += row["unrealized_pnl"]
            found[2] += abs(row["notional_value"])

    @staticmethod
    def _typed(row: dict) -> dict:
        value = (lambda item: item if isinstance(item, Decimal) else _usdt(item))
        return {"ts_event_ns": int(row["ts_event_ns"]), "position_id": row["position_id"],
                "notional_value": value(row["notional_value"]), "unrealized_pnl": value(row["unrealized_pnl"]),
                "realized_pnl": _optional_realized(row.get("realized_pnl"))}

    def rows(self):
        for row in self._source:
            yield self._typed(row)

    def rows_at(self, label: int) -> list[dict]:
        return [row for row in self.rows() if row["ts_event_ns"] == label]

    def __bool__(self) -> bool:
        return bool(self.by_label)


def _typed_exposures(rows) -> ExposureTable | None:
    if rows is None:
        return None
    if isinstance(rows, ExposureTable):
        return rows
    try:
        return ExposureTable(rows)
    except (KeyError, ValueError, ArithmeticError, TypeError, OSError, EOFError, csv.Error) as exc:
        raise unreconciled("EXPOSURE_REPORT_MISSING", "the exposure report is unreadable") from exc


def _labels(summary: dict, exposures: ExposureTable) -> tuple[int, list[int]]:
    """(bar step, bar labels of the trade window), the label offset taken from the exposure rows."""
    step = int(summary["data_interval_minutes"]) * 60 * 10**9
    start, end = utc_ns(summary["period_start_utc"]), utc_ns(summary["period_end_utc"])
    offset = min(exposures.by_label) % step if exposures else step - 1_000_000
    first = start - start % step + offset
    if first < start:
        first += step
    labels = list(range(first, end, step))
    grid = set(labels)
    off = sorted(label for label in exposures.by_label if label not in grid)
    if off:
        raise unreconciled("EXPOSURE_GRID_MISMATCH", f"exposure labels {_sample(off)} are off the trade-window bar grid")
    return step, labels


def _account_states(account: list[dict], *fields: str) -> list[tuple]:
    """(UTC ns, Decimal fields...) per account row, ordered by time only: rows tied on a timestamp keep
    report order."""
    return sorted(((utc_ns(row["ts_event"]), *(Decimal(row[field]) for field in fields)) for row in account),
                  key=lambda state: state[0])


def equity_path(summary: dict, account: list[dict], exposures) -> list[dict]:
    """Per bar label T: mark equity (the last account total at or before T, never a later row, plus
    the unrealized PnL of the exposure rows labelled T), gross notional and the number of open rows."""
    if exposures is None:
        raise unreconciled("EXPOSURE_REPORT_MISSING", "the run has no exposure report")
    if not account:
        raise unreconciled("ACCOUNT_STATE_MISSING", "the account report has no rows")
    exposures = _typed_exposures(exposures)
    _, labels = _labels(summary, exposures)
    try:
        states = _account_states(account, "total")
    except (KeyError, ValueError, ArithmeticError) as exc:
        raise unreconciled("NATIVE_VALUE_UNREADABLE", "an account row has no readable time or total") from exc
    times = [ts for ts, _ in states]
    starting = Decimal(summary["starting_balance_usdt"])
    path = []
    for label in labels:
        index = bisect.bisect_right(times, label) - 1
        rows, unrealized, gross = exposures.by_label.get(label, (0, Decimal(0), Decimal(0)))
        path.append({"label": label, "rows": rows,
                     "equity": (states[index][1] if index >= 0 else starting) + unrealized, "gross": gross})
    return path


def mark_drawdown(summary: dict, account: list[dict], exposures: Iterable[dict] | ExposureTable | None,
                  path: list[dict] | None = None) -> dict:
    """Largest fall of bar-close mark equity from its running peak (from the starting balance)."""
    path = equity_path(summary, account, exposures) if path is None else path
    peak = Decimal(summary["starting_balance_usdt"])
    peak_at, worst, worst_peak_at, worst_at = None, Decimal(0), None, None
    for point in path:
        if point["equity"] > peak:
            peak, peak_at = point["equity"], point["label"]
        fall = (peak - point["equity"]) / peak
        if fall > worst:
            worst, worst_peak_at, worst_at = fall, peak_at, point["label"]
    return {"max_drawdown": float(worst), "price_source": "mark", "sampling": "bar_close", "bars": len(path),
            "peak_ns": worst_peak_at, "trough_ns": worst_at,
            "limitations": ["Equity inside a bar is not observed; the drawdown is sampled at bar closes"]}


def daily_notional(path: list[dict]) -> dict[int, Decimal]:
    """Mean gross notional over each UTC day's bar labels of the trade window (flat labels count zero)."""
    sums: defaultdict[int, Decimal] = defaultdict(Decimal)
    counts: Counter[int] = Counter()
    for point in path:
        day = point["label"] - point["label"] % DAY_NS
        sums[day] += point["gross"]
        counts[day] += 1
    return {day: (sums[day] / counts[day]).quantize(MONEY) for day in counts}


# The sealed single-run report

def metrics_revision(checkout: Path | None = None) -> str:
    """The HEAD commit of the product checkout holding this metrics code (default: this repository),
    recorded as it is: uncommitted or untracked files in the work tree do not change it. The product
    runs from its Git checkout; outside one `git rev-parse` fails (CalledProcessError)."""
    root = Path(checkout) if checkout is not None else db.REPOSITORY
    return subprocess.run(["git", "rev-parse", "HEAD"], cwd=root, capture_output=True, text=True, check=True,
                          timeout=30).stdout.strip()


def runner_limitations(summary) -> list[str]:
    """The limitations the runner listed in its native summary (engine.write_native_reports: a list)."""
    found = summary.get("limitations") if isinstance(summary, dict) else None
    return [str(item) for item in found] if isinstance(found, list) else []


def _measure(value, population: str) -> dict:
    return {"value": value, "population": population}


def _fact(passed: bool, code: str | None, **counts) -> dict:
    return {"passed": passed, "code": None if passed else code, **counts}


def metrics(reports: Reports) -> dict:
    """The sealed single-run report: only what the stored cycles and daily series cannot give back.

    The metrics revision that computed it is not part of it: a sealed run's row records it."""
    summary, audit = reports.summary or {}, reports.audit or {}
    absent = [key for key in SUMMARY_KEYS if summary.get(key) is None]
    if absent:
        raise refuse("REPORT_UNREADABLE", "the native summary lacks " + ", ".join(absent), missing=tuple(absent))
    limitations = runner_limitations(summary)  # what the runner did not model or approximated
    fills, orders = reports.fills, reports.orders
    order_ids = {order.get("client_order_id") for order in orders}
    fill_orders = {fill.get("client_order_id") for fill in fills}
    filled = {order.get("client_order_id") for order in orders if _positive(order.get("filled_qty"))}
    activity = {"real_fills@1": _fact(bool(fills), "NO_FILLS", count=len(fills)),
                "fills_match_orders@1": _fact(fill_orders <= order_ids and filled <= fill_orders, "FILL_ORDER_UNMATCHED",
                                              count=len(fill_orders))}
    found = None
    try:
        found = cycles(reports.positions, fills)
        activity["cycles_cover_fills@1"] = _fact(True, None, count=len(found))
    except Unreconciled as exc:
        activity["cycles_cover_fills@1"] = _fact(False, exc.code, count=len(reports.positions))
        limitations.append(str(exc))
    series = daily_returns(reports.returns, summary, limitations)
    final = summary.get("final_equity_usdt")
    compounded = None if series is None else Decimal(summary["starting_balance_usdt"]) * Decimal(
        repr(math.prod(1 + value for _, value in series)))
    activity["returns_compound_to_equity@1"] = _fact(
        series is not None, "RETURN_SERIES_UNUSABLE",
        compounded=None if compounded is None else format(compounded.quantize(Decimal("0.01")), "f"),
        final_equity=final)
    native = audit.get("native_economics")
    try:
        states = _account_states(reports.account, "total", "locked")
    except (KeyError, ValueError, ArithmeticError) as exc:
        states = []
        limitations.append(f"NATIVE_VALUE_UNREADABLE: an account row is unreadable ({type(exc).__name__})")
    endpoints = bool(states) and states[0][1] == Decimal(summary.get("starting_balance_usdt", "NaN")) and (
        native is None or states[-1][1] == Decimal(str(native.get("final_balance_usdt"))))
    activity["account_endpoints_match@2"] = _fact(endpoints, "ACCOUNT_ENDPOINTS_MISMATCH", rows=len(states))
    if found is not None:
        try:
            economics(found, fills, summary, native, limitations)
            activity["cycles_reconcile_audit@1"] = _fact(native is not None, "AUDIT_ECONOMICS_ABSENT")
        except Unreconciled as exc:
            activity["cycles_reconcile_audit@1"] = _fact(False, exc.code)
            limitations.append(str(exc))

    drawdown, capital, path = None, None, None
    try:
        exposures = _typed_exposures(reports.exposures)
        path = equity_path(summary, reports.account, exposures)
        assert exposures is not None  # equity_path refused a run without an exposure report
        drawn = mark_drawdown(summary, reports.account, exposures, path)
        drawdown = _drawdown_section(drawn, path, found, reports.positions, exposures,
                                     Decimal(summary["starting_balance_usdt"]))
        active = sum(1 for point in path if point["rows"])
        busiest = max(path, key=lambda point: point["gross"], default=None)
        capital = {"peak_gross_notional@1": _measure(money(busiest["gross"]) if busiest else None, "bars"),
                   "peak_utc@1": _measure(iso_minute(busiest["label"]) if busiest and busiest["gross"] else None,
                                          "bars"),
                   "time_in_market@1": _measure(active / len(path) if path else None, "bars"),
                   "peak_locked_margin@1": _measure(money(max((locked for _, _, locked in states), default=None))
                                                    if states else None, "account")}
    except Unreconciled as exc:
        limitations.append(str(exc))
    if capital is not None:
        try:
            reading = None if reports.fill_volumes is None else participation(
                fills, reports.fill_volumes, _multipliers(reports.positions), summary.get("execution"))
        except Unreconciled as exc:
            reading = None
            limitations.append(str(exc))
        except (KeyError, ValueError, ArithmeticError, SyntaxError, TypeError):
            reading = None
            limitations.append("NATIVE_VALUE_UNREADABLE: a fill or its minute's volume is unreadable")
        capital["participation@1"] = _measure(reading, "fills")

    fees: defaultdict[str, dict[str, Any]] = defaultdict(lambda: {"commissions": Decimal(0), "notional": Decimal(0),
                                                                   "fills": 0})
    try:
        multiplier = _multipliers(reports.positions)
        for fill in fills:
            side = fees[fill.get("liquidity_side") or "NO_LIQUIDITY_SIDE"]
            side["commissions"] += _usdt(fill["commission"])
            side["notional"] += Decimal(fill["last_qty"]) * Decimal(fill["last_px"]) * multiplier[fill["event_id"]]
            side["fills"] += 1
        fee_section = {side: {"commissions": money(item["commissions"]), "notional": money(item["notional"]),
                              "fills": item["fills"]} for side, item in sorted(fees.items())}
    except (Unreconciled, KeyError, ValueError, ArithmeticError, SyntaxError, TypeError) as exc:
        fee_section = None
        limitations.append(str(exc) if isinstance(exc, Unreconciled) else
                           "NATIVE_VALUE_UNREADABLE: a fill has no readable commission, quantity, price or position "
                           "multiplier")
    entries = [order for order in orders if not order.get("parent_order_id") and order.get("is_reduce_only") != "True"]
    untagged = sum(1 for order in orders if not any(str(tag).startswith(PLAN_TAG)
                                                    for tag in _safe_tags(order)))
    plans = {"passed": False, "code": "CYCLES_UNAVAILABLE", "untagged_orders": untagged}
    if found is not None:
        try:
            plan_metrics(orders, fills, reports.positions, found, reports.order_events, reports.lifecycle_events)
            plans = {"passed": True, "code": None, "untagged_orders": untagged}
        except Unreconciled as exc:
            plans = {"passed": False, "code": exc.code, "untagged_orders": untagged}
            limitations.append(str(exc))
    return {"catalogue": CATALOGUE,
            "populations": {"fills": len(fills), "cycles": len(found) if found is not None else None,
                            "bars": len(path) if path is not None else None,
                            "days": len(series) if series is not None else None},
            "activity": activity, "drawdown": drawdown, "capital": capital,
            "fees_by_liquidity_side@2": fee_section,
            "order_funnel@1": dict(sorted(Counter(order.get("status") for order in entries).items())),
            "plans_valid@1": plans, "limitations": list(dict.fromkeys(limitations))}


def participation(fills: list[dict], volumes: list[dict], multiplier: Mapping[str, Decimal],
                  execution: str | None) -> dict:
    """capital.participation@1: each market fill's quantity (times its contract multiplier) over the LAST
    volume of its minute's one-minute execution bar (engine.write_fill_volumes), every fill weighted
    equally: median, p95, p99 (nearest rank) and maximum; the largest summed quantity of one contract in
    one minute over that minute's volume; the fills without a bar, in a zero-volume minute and above
    their minute's volume. The engine's settlement and liquidation fills are counted apart. A capacity
    description of the run under its execution mode (a bars market order is not held to the volume, a
    quotes order fills whole), never a measure of fill quality."""
    by_event = {row["event_id"]: row for row in volumes}
    ratios: list[Decimal] = []
    minutes: defaultdict[tuple[str, str], Decimal] = defaultdict(Decimal)
    bars: dict[tuple[str, str], Decimal] = {}
    counts = {"no_bar": 0, "zero_volume": 0, "above_volume": 0, "engine_fills": 0}
    for fill in fills:
        if str(fill.get("client_order_id", "")).startswith(ENGINE_ORDERS):
            counts["engine_fills"] += 1
            continue
        row = by_event.get(fill["event_id"])
        if row is None:
            raise unreconciled("FILL_VOLUME_MISSING", f"fill {fill['event_id']} has no row in fill_volumes.csv")
        if not row["bar_volume"]:
            counts["no_bar"] += 1
            continue
        volume = Decimal(row["bar_volume"])
        if volume == 0:
            counts["zero_volume"] += 1
            continue
        quantity = Decimal(fill["last_qty"]) * multiplier[fill["event_id"]]
        ratios.append(quantity / volume)
        key = (row["instrument_id"], row["bar_ts_open_ns"])
        minutes[key] += quantity
        bars[key] = volume
    counts["above_volume"] = sum(1 for ratio in ratios if ratio > 1)
    ranked = sorted(ratios)

    def rank(share: float) -> float | None:
        return float(ranked[max(math.ceil(share * len(ranked)) - 1, 0)]) if ranked else None

    return {"execution": execution, "fills": len(ranked), "median": rank(0.5), "p95": rank(0.95),
            "p99": rank(0.99), "max": float(ranked[-1]) if ranked else None,
            "minute_max": float(max(total / bars[key] for key, total in minutes.items())) if minutes else None,
            **counts}


def _multipliers(positions: list[dict]) -> dict[str, Decimal]:
    """The contract multiplier of each fill, by event ID, from the position row holding it."""
    found = {}
    for row in positions:
        multiplier = Decimal(row["multiplier"])
        for event in _list(row.get("events", "")):
            found[event["event_id"]] = multiplier
    return found


def _positive(value) -> bool:
    try:
        return Decimal(value) > 0
    except (TypeError, ValueError, ArithmeticError):
        return False


def _safe_tags(order: dict) -> list:
    try:
        return _list(order.get("tags", ""))
    except (SyntaxError, ValueError):
        return []


def _drawdown_section(drawn: dict, path: list[dict], found: list[dict] | None, positions: list[dict],
                      exposures: ExposureTable, starting: Decimal | None = None) -> dict:
    peak, trough = drawn["peak_ns"], drawn["trough_ns"]
    share, top, reason = None, None, None
    if found is None or trough is None:
        reason = "DRAWDOWN_INTERVAL_MISSING"
    else:
        # Native exposure observations include all events before the next bar. Account @2
        # reads cash <= label; reconciliation below isolates any cutoff disagreement.
        owners: defaultdict[str, set[str]] = defaultdict(set)
        for row in positions:
            owners[row["position_id"]].add(row["instrument_id"])
            # NETTING snapshot IDs differ from the live ID; resolve via instrument ownership
            # only when the exposure ID has a direct, unambiguous native report match.
        def endpoint(label: int | None) -> defaultdict[str, Decimal]:
            values: defaultdict[str, Decimal] = defaultdict(Decimal)
            if label is None:
                return values
            for row, cycle in zip(positions, found, strict=True):
                if cycle["closed"] and cycle["ts_last"] < label + 60 * 10**9:
                    values[row["instrument_id"]] += cycle["realized"]
            for row in exposures.rows_at(label):
                names = owners.get(row["position_id"], set())
                if len(names) != 1 or row["realized_pnl"] is None:
                    raise ValueError("NATIVE_REALIZED_SNAPSHOT_MISSING")
                values[next(iter(names))] += row["realized_pnl"] + row["unrealized_pnl"]
            return values
        try:
            high, low = endpoint(peak), endpoint(trough)
            changes = {name: low.get(name, Decimal(0)) - high.get(name, Decimal(0)) for name in low.keys() | high.keys()}
            points = {point["label"]: point["equity"] for point in path}
            # The native replay starts flat; the declared initial account is the baseline.
            base = points[peak] if peak is not None else starting
            if base is None:
                raise ValueError("INITIAL_ACCOUNT_UNKNOWN")
            if abs(sum(changes.values(), Decimal(0)) - (points[trough] - base)) > EQUITY_TOLERANCE:
                reason = "DRAWDOWN_CONTRIBUTION_UNRECONCILED"
            else:
                negative = {name: -value for name, value in changes.items() if value < 0}
                if negative:
                    top, worst = max(negative.items(), key=lambda item: item[1])
                    share = float(worst / sum(negative.values()))
        except ValueError as exc:
            reason = str(exc)
    duration = None if peak is None or trough is None else (trough - peak) / DAY_NS
    return {"mark_max_drawdown@2": _measure(drawn["max_drawdown"], "bars"),
            "peak_utc@2": _measure(iso_minute(peak), "bars"), "trough_utc@2": _measure(iso_minute(trough), "bars"),
            "duration_days@2": _measure(duration, "bars"),
            "top_instrument_share_in_drawdown@3": {**_measure(share, "negative_contributing_instruments"),
                                                     "null_reason": reason},
            "top_instrument@3": {**_measure(top, "negative_contributing_instruments"), "null_reason": reason}}


def cycle_rows(reports: Reports, found: list[dict]) -> list[dict]:
    """The run_cycle rows: one per native position row, in report order."""
    orders = {order.get("client_order_id"): order for order in reports.orders}
    last_unrealized: dict[str | None, Decimal] = {}
    exposures = _typed_exposures(reports.exposures)
    if exposures:
        for row in exposures.rows_at(max(exposures.by_label)):
            last_unrealized[row["position_id"]] = last_unrealized.get(row["position_id"], Decimal(0)) + row[
                "unrealized_pnl"]
    rows = []
    for seq, (row, cycle) in enumerate(zip(reports.positions, found, strict=True), 1):
        opening = orders.get(row.get("opening_order_id"), {})
        closing = orders.get(row.get("closing_order_id"), {}) if cycle["closed"] else {}
        plan = _plan_tags(opening) if opening else []
        others = [str(tag) for tag in _safe_tags(closing) if not str(tag).startswith(PLAN_TAG)]
        rows.append({"seq": seq, "instrument_id": row["instrument_id"], "side": "long" if row["entry"] == "BUY" else "short",
                     "ts_opened_ns": cycle["ts_opened"], "ts_closed_ns": cycle["ts_last"] if cycle["closed"] else None,
                     "realized_pnl": cycle["realized"],
                     # not stored: the ledger reads it back as PRICE_PNL
                     "price_pnl": cycle["realized"] + cycle["commissions"] - cycle["funding"],
                     "commissions": cycle["commissions"], "funding": cycle["funding"],
                     "open_unrealized": None if cycle["closed"] else last_unrealized.get(row.get("position_id")),
                     "plan_tag": plan[0] if len(plan) == 1 and len(plan[0]) <= PLAN_TAG_LIMIT else None,
                     "closing_order_type": closing.get("type") or None,
                     "closing_order_tag": others[0][:160] if others else None})
    return rows


def daily_rows(reports: Reports) -> list[tuple[int, float, Decimal | None]]:
    """The run_return rows: trade-window native daily returns with the day's mean gross notional."""
    summary = reports.summary or {}
    start = utc_ns(summary["period_start_utc"])
    try:
        notional = daily_notional(equity_path(summary, reports.account, _typed_exposures(reports.exposures)))
    except Unreconciled:
        notional = {}
    return [(ts, value, notional.get(ts - ts % DAY_NS)) for ts, value in reports.returns if ts >= start]
