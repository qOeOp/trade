"""Paper run records in the Paper database (`ledger.open_paper_run`, `ledger.seal_paper_run`, `ledger.paper_runs`).

Paper runs are execution records, not research: they live in their own database (ledger/paper.sql, a
profile that holds "paper"), never in the research ledger, and add no trial count and no exposure.
A run's source is copied from the research ledger when it starts (`copy_source`). A paper run is
declared once, before its container starts (`paper_run`): the source, the runtime image, the
contracts, the market day its membership was read at and the effective configuration. It is sealed
once, after it ends (`paper_seal` with its `paper_file` rows): the runner's journal split by UTC day,
its summary, the egress and runner logs, and ``seal.json``, the readings computed here once
(docs/plans/paper-run-storage-decision.zh.md). A run that crashed or lost its files still seals, as
``invalid`` with reasons, so every declared run has an outcome.

The user may delete a sealed run (`ledger.delete_paper_run`, user decision 2026-10-29): the Paper
database's writer removes its declaration, seal and files in one commit.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Mapping
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
import gzip
import hashlib
import json
from pathlib import Path
import shutil
import tempfile

from ledger import db, strategies
from shared.refusals import refuse


READINGS = "paper-readings@2026-11-11"
LOG_TAIL_BYTES = 1024 * 1024
# How a run may end without a reason recorded: the user's stop, the engineering duration.
CLEAN_STOPS = frozenset({"STOP_FILE", "SIGTERM", "SIGINT", "DURATION"})
# The stop reason of a runner killed from outside (a Docker or host restart that did not wait for its stop).
KILLED = "KILLED"
KILLED_EXIT = 137  # 128 + SIGKILL


# The reasons that leave a run's evidence untrusted (user 2026-11-01): it ran other code than declared, or
# reached for a host beyond the allowed ones, or a runner that ran left no journal. Every other reason says
# how the run ended (it crashed, never started, ran out of memory, was refused, raised) and leaves what it
# journaled standing.
UNTRUSTED = frozenset({"SOURCE_MISMATCH", "LEVERAGE_MISMATCH", "EGRESS_DENIED"})


def verdict(reasons) -> str:
    """A sealed run's status from its reasons: invalid only when its evidence cannot be trusted (UNTRUSTED,
    or no journal from a runner that started), else complete, however it ended."""
    found = set(reasons or ())
    return "invalid" if found & UNTRUSTED or ("JOURNAL_MISSING" in found and "START_FAILED" not in found) else "complete"


def _row(row: dict) -> dict:
    return {**row, "symbols": json.loads(row["symbols"]) if isinstance(row["symbols"], str) else row["symbols"],
            "config": json.loads(row["config"]) if isinstance(row["config"], str) else row["config"]}


def copy_source(profile: db.LedgerProfile, research: db.LedgerConnection, candidate: str) -> dict:
    """The research candidate `candidate` (read on `research`), its source copied into the Paper database
    `profile` once; a later copy of the same source writes nothing."""
    found = strategies.read_candidate(research, candidate)
    strategies.check_source(found["source"], found["entry_class"])

    def same(conn, prior):
        if prior["entry_class"] != found["entry_class"]:
            raise refuse("OP_ID_CONFLICT", f"the Paper database holds source {found['source_sha256']} with another "
                                           "entry class")
        return prior

    def insert(conn, op):
        prior = conn.one("SELECT * FROM paper_source WHERE source_sha256 = %s", (found["source_sha256"],))
        if prior is not None:
            return same(conn, prior)
        conn.rows("INSERT INTO paper_source (source, entry_class, op_id, created_at) "
                  "VALUES (%s, %s, %s, UTC_TIMESTAMP(6))", (found["source"], found["entry_class"], op))
        return conn.one("SELECT * FROM paper_source WHERE op_id = %s", (op,))

    with db.connect(profile, "writer") as conn:
        db.write(conn, "paper_source", {"source_sha256": found["source_sha256"]}, "paper_source", insert, same,
                 op_id=f"paper-source:{found['source_sha256']}", attempts=db.WRITE_ATTEMPTS)
    return found


def read_source(conn: db.LedgerConnection, source_sha256: str) -> dict:
    """A copied source: {source_sha256, source, entry_class}."""
    found = conn.one("SELECT source_sha256, source, entry_class FROM paper_source WHERE source_sha256 = %s",
                     (source_sha256,))
    if found is None:
        raise refuse("UNKNOWN_CANDIDATE", f"the Paper database holds no source {source_sha256}",
                     missing=(source_sha256,))
    return {**found, "source": bytes(found["source"])}


def open_paper_run(conn: db.LedgerConnection, source_sha256: str, image_ref: str, symbols: list[str],
                   market_day: str, config: dict, op_id: str) -> dict:
    """Declare one paper run of a copied source; `op_id` names this start (a retry with the same ID returns
    the same run)."""
    read_source(conn, source_sha256)
    payload = {"source_sha256": source_sha256, "image_ref": image_ref, "symbols": list(symbols),
               "market_day": market_day, "config": config}

    def insert(c, op):
        c.rows("INSERT INTO paper_run (source_sha256, image_ref, symbols, market_day, config, op_id, created_at) "
               "VALUES (%s, %s, %s, %s, %s, %s, UTC_TIMESTAMP(6))",
               (source_sha256, image_ref, json.dumps(list(symbols)), market_day,
                json.dumps(config, sort_keys=True), op))
        return c.one("SELECT * FROM paper_run WHERE op_id = %s", (op,))

    written = db.write(conn, "paper_start", payload, "paper_run", insert, op_id=op_id)
    return {**_row(written["record"]), "ledger_commit": written["commit"], "write_status": written["write_status"]}


def read_paper_run(conn: db.LedgerConnection, paper_id: int) -> dict:
    row = conn.one("SELECT * FROM paper_run WHERE paper_id = %s", (paper_id,))
    if row is None:
        raise refuse("PAPER_RUN_UNKNOWN", f"no paper run {paper_id}", missing=(str(paper_id),))
    return _row(row)


def paper_start_of(conn: db.LedgerConnection, op_id: str) -> dict | None:
    """The original declaration for a start operation, even if that run has since ended."""
    row = conn.one("SELECT * FROM paper_run WHERE op_id = %s", (op_id,))
    return _row(row) if row is not None else None


def paper_files(conn: db.LedgerConnection, paper_id: int, *wanted: str) -> dict[str, bytes]:
    """A sealed run's files by path; none while it is unsealed. `wanted` names the paths to read, a name ending in
    "/" every path under it, so a reader takes only the bytes it uses (CF-24: never the whole capture with its
    recovery dump for one log); no name reads every file."""
    exact = [name for name in wanted if not name.endswith("/")]
    under = [name.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
             for name in wanted if name.endswith("/")]
    clauses = ([f"path IN ({', '.join(['%s'] * len(exact))})"] if exact else []) + ["path LIKE %s"] * len(under)
    where = f" AND ({' OR '.join(clauses)})" if clauses else ""
    return {row["path"]: bytes(row["content"]) for row in conn.dicts(
        f"SELECT path, content FROM paper_file WHERE paper_id = %s{where} ORDER BY path", (paper_id, *exact, *under))}


def seal_of(conn: db.LedgerConnection, paper_id: int) -> dict | None:
    """The stored seal.json of a run, or None while it is unsealed."""
    found = conn.one("SELECT content FROM paper_file WHERE paper_id = %s AND path = 'seal.json'", (paper_id,))
    return json.loads(bytes(found["content"])) if found else None


def paper_runs(conn: db.LedgerConnection) -> list[dict]:
    """Every declared run, oldest first, with its seal readings once sealed."""
    rows = [_row(row) for row in conn.dicts("SELECT * FROM paper_run ORDER BY paper_id")]
    return [{**row, "seal": seal_of(conn, row["paper_id"])} for row in rows]


def last_research_symbols(conn: db.LedgerConnection, source_sha256: str) -> dict | None:
    """The contracts of the source's latest research replay that ran ({trial_id, symbols}), read on the research
    ledger, or None: what a paper run of the version's last configuration trades."""
    found = conn.one("SELECT t.trial_id, t.instruments FROM trial t JOIN run r ON r.trial_id = t.trial_id "
                     "WHERE t.source_sha256 = %s AND t.purpose = 'research' ORDER BY t.trial_id DESC LIMIT 1",
                     (source_sha256,))
    if found is None:
        return None
    symbols = json.loads(found["instruments"]) if isinstance(found["instruments"], str) else found["instruments"]
    return {"trial_id": found["trial_id"], "symbols": symbols}


# Readings

def _decimal(value) -> Decimal | None:
    """A Nautilus money or quantity string ('99999.59855800 USDT', '0.01') as a Decimal."""
    if value is None:
        return None
    try:
        return Decimal(str(value).split(" ", 1)[0])
    except InvalidOperation:
        return None


MINUTE_NS = 60 * 10**9


def _month_end(ns: int) -> int:
    moment = datetime.fromtimestamp(ns // 10**9, UTC)
    return int(datetime(moment.year + moment.month // 12, moment.month % 12 + 1, 1, tzinfo=UTC).timestamp()) * 10**9


def _day(ns: int) -> str:
    return datetime.fromtimestamp(ns // 10**9, UTC).date().isoformat()


def sealed_journal(files: Mapping[str, bytes]) -> list[dict]:
    """A sealed run's journal from its files (paper_files with "events/"): each day's gzip file in path order,
    parsed by journal_lines. The one decoder of the sealed stream and the reconciliation (CF-24)."""
    lines: list[dict] = []
    for name in sorted(name for name in files if name.startswith("events/")):
        lines += journal_lines(gzip.decompress(files[name]))[0]
    return lines


def journal_lines(data: bytes) -> tuple[list[dict], int]:
    """The parsed journal lines and the count of unreadable ones (a crash can cut the last line)."""
    lines, unreadable = [], 0
    for raw in data.splitlines():
        try:
            value = json.loads(raw)
        except ValueError:
            unreadable += 1
            continue
        if isinstance(value, dict) and isinstance(value.get("wall_ns"), int) and isinstance(value.get("kind"), str):
            lines.append(value)
        else:
            unreadable += 1
    return lines, unreadable


def _funding(settlement: dict) -> Decimal:
    """The account's funding cash flow of one settlement: a positive rate moves money from longs to shorts."""
    rate, mark = _decimal(settlement.get("stream_rate")), _decimal(settlement.get("mark"))
    if rate is None or mark is None:
        return Decimal(0)
    held_qty = sum((_decimal(item.get("signed_qty")) or Decimal(0) for item in settlement.get("positions") or ()),
                   Decimal(0))
    return -held_qty * mark * rate


def equity_path(lines: list[dict]) -> tuple[list[tuple[int, Decimal]], list[tuple[int, Decimal]]]:
    """The account's equity at each journalled minute (balance, open profit and the funding Sandbox does not
    settle) and each settlement's funding cash flow, by time."""
    settlements = sorted((line for line in lines if line["kind"] == "funding_settlement"),
                         key=lambda line: line.get("settlement_ns") or 0)
    funding_by_ns = [(line.get("settlement_ns") or 0, _funding(line)) for line in settlements]
    path: list[tuple[int, Decimal]] = []
    applied, funding = 0, Decimal(0)
    for line in sorted((line for line in lines if line["kind"] == "snapshot"), key=lambda line: line.get("minute_ns") or 0):
        balance, unrealized = _decimal(line.get("balance_total")), _decimal(line.get("unrealized_pnl"))
        if balance is None or unrealized is None:
            continue
        minute = line.get("minute_ns") or 0
        # A snapshot is taken as its minute ends: it carries every settlement up to that moment.
        while applied < len(funding_by_ns) and funding_by_ns[applied][0] <= minute + 60 * 10**9:
            funding += funding_by_ns[applied][1]
            applied += 1
        path.append((minute, balance + unrealized + funding))
    return path, funding_by_ns


def _ceil_minute(ns: int) -> int:
    return -(-ns // MINUTE_NS) * MINUTE_NS


def audit_inputs(row: dict, inputs: Path, lines: list[dict], summary: dict) -> tuple[dict, dict]:
    """(summary.json, input-coverage.json) for engine.audit over a run's native reports, in a replay's shape. The
    window runs from the input start (a recovery keeps its run's, so the first started line holds it) to the minute
    after the last stop was asked (the stop's own cancels are no gap), every instance trading from it. Entry membership
    is the declaration's (inputs/universe.json, from the input start to that month's end) and each later month the
    journal says the runner read with the contract a member (engine.paper.Membership); each contract's data ends at
    the last bar the journal took (stamped at its close, as the export's last_bar_ns); the fees are the declared
    ones. The counts the audit holds the reports to come from the journal and the runner's summary, not from the
    reports (both from the one native event stream)."""
    from engine.config import utc_text
    from engine.load import COVERAGE_FORMAT, strategy_id
    started = next(line for line in lines if line["kind"] == "started")
    start = started["input_start_ns"]
    asked = max((line["wall_ns"] for line in lines if line["kind"] == "stop_requested"), default=None)
    end = max(_ceil_minute(asked or summary["stopped_ns"]), start + MINUTE_NS)
    universe = json.loads((inputs / "universe.json").read_bytes())["membership"]
    first_month_end = _month_end(start)
    membership = {symbol: [[max(low, start), min(high, first_month_end)] for low, high in universe.get(symbol, [])
                           if high > start and low < first_month_end] for symbol in row["symbols"]}
    for line in lines:
        if line["kind"] == "membership" and line.get("member") is True and line.get("symbol") in membership:
            month = int(datetime.strptime(line["month"], "%Y-%m").replace(tzinfo=UTC).timestamp()) * 10**9
            if [month, _month_end(month)] not in membership[line["symbol"]]:
                membership[line["symbol"]].append([month, _month_end(month)])
    closed = [line for line in lines if line["kind"] == "position" and line.get("type") == "PositionClosed"]
    ended = {line.get("client_order_id"): line.get("type") for line in lines if line["kind"] == "order"
             and line.get("type") in ("OrderDenied", "OrderRejected")}
    instances = (summary.get("instances") or {}).values()
    window = {"start": utc_text(start), "trade_start": utc_text(start), "end": utc_text(end)}
    audited = {
        "input_start_utc": window["start"], "period_start_utc": window["trade_start"], "period_end_utc": window["end"],
        "market_day": row["market_day"], "per_coin": [],
        "trade_start_by_strategy": {item["strategy_id"]: item["input_start_ns"] for item in instances},
        "integrity_passed": not summary.get("orders_denied_or_rejected")
                            and not any(item.get("integrity_findings") for item in instances),
        "denied_orders": sum(kind == "OrderDenied" for kind in ended.values()),
        "rejected_orders": sum(kind == "OrderRejected" for kind in ended.values()),
        "strategy_uses_stop_loss": started.get("strategy_uses_stop_loss"),
        "closed_trades": len(closed), "winning_trades": sum((_decimal(line.get("realized_pnl")) or 0) > 0 for line in closed),
        "starting_balance_usdt": (summary.get("account") or {}).get("starting_balance_usdt"),
        "final_equity_usdt": str(_decimal(summary.get("balance_total"))),
    }
    fees = row["config"].get("fees") or {}
    last_bar: dict[str, int] = {}
    for line in lines:
        if line["kind"] == "bar" and isinstance(line.get("ts_event"), int):
            last_bar[line["instrument_id"]] = max(line["ts_event"], last_bar.get(line["instrument_id"], 0))
    coverage = {"format": COVERAGE_FORMAT, "effective_config": window, "input_identity": {"market_day": row["market_day"]},
                "membership": {"market_day": row["market_day"], "membership": membership},
                "export_receipts": {symbol: {"pieces": [{"instrument_id": f"{symbol}-PERP.BINANCE",
                                                         "strategy_id": strategy_id(symbol),
                                                         "last_bar_ns": last_bar.get(f"{symbol}-PERP.BINANCE")}],
                                             "assumed": {"maker_fee": fees.get("maker"), "taker_fee": fees.get("taker")}}
                                    for symbol in row["symbols"]}}
    return audited, coverage


def audit(row: dict, output: Path, lines: list[dict], summary: dict | None) -> dict | None:
    """engine.audit over the native reports the runner left in ``<output>/reports/`` (engine.paper.write_native_reports),
    the replay's audit, with its inputs from audit_inputs: {passed, findings, scope}; passed is None
    when a runner that wrote its summary left no reports to audit. None without a summary (a runner killed or never
    started, which its other reasons say)."""
    from engine import audit as native
    reports = output / "reports"
    if summary is None:
        return None
    if not (reports / "orders.csv").is_file() or \
            not any(line["kind"] == "started" and isinstance(line.get("input_start_ns"), int) for line in lines):
        return {"passed": None, "findings": [], "scope": "the runner left no native reports or no input start"}
    audited, coverage = audit_inputs(row, output.parent / "inputs", lines, summary)
    with tempfile.TemporaryDirectory(prefix="paper-audit-") as name:
        run = Path(name) / "reports"
        shutil.copytree(reports, run)
        (run / "summary.json").write_text(json.dumps(audited), encoding="utf-8")
        (Path(name) / native.COVERAGE).write_text(json.dumps(coverage), encoding="utf-8")
        result = native.audit(run)
    return {key: result[key] for key in ("passed", "findings", "scope")}


def killed(lines: list[dict], summary: dict | None, exit_code: int | None, oom_killed: bool) -> bool:
    """Whether the runner was killed from outside: SIGKILL, not at its memory limit, before it wrote its summary,
    and not after `paper stop` asked it through the STOP file (that kill is the stop's own fallback for a runner
    that did not stop)."""
    asked = any(line["kind"] == "stop_requested" and line.get("reason") == "STOP_FILE" for line in lines)
    return exit_code == KILLED_EXIT and summary is None and not oom_killed and not asked


def readings(row: dict, lines: list[dict], unreadable: int, summary: dict | None, exit_code: int | None,
             egress: bytes | None, start_failed: bool = False, oom_killed: bool = False, failures: int = 0,
             path_and_funding: tuple[list[tuple[int, Decimal]], list[tuple[int, Decimal]]] | None = None,
             audited: dict | None = None) -> dict:
    """seal.json: the run's status with its reasons, and the readings computed once at sealing. A runner killed
    from outside (killed()) ends the run as a stop does: what it journaled stands, its stop reason is KILLED.
    `failures` counts the records of the run's runtime_failures.jsonl; `path_and_funding` is equity_path(lines)
    when the caller already has it; `audited` is audit()'s result: findings add AUDIT_FINDINGS, reports
    it could not audit AUDIT_NOT_RUN."""
    reasons: list[str] = ["START_FAILED"] if start_failed else []
    ended_by_kill = killed(lines, summary, exit_code, oom_killed)
    if not lines:
        reasons.append("JOURNAL_MISSING")
    if summary is None and not ended_by_kill:
        reasons.append("SUMMARY_MISSING")
    if not ended_by_kill and (exit_code not in (0, None) or (exit_code is None and summary is None)):
        reasons.append("RUNNER_EXIT_NONZERO" if exit_code is not None else "RUNNER_EXIT_UNKNOWN")
    if oom_killed:
        reasons.append("OUT_OF_MEMORY")
    if ended_by_kill and not any(line["kind"] == "bar" for line in lines):
        reasons.append("STOPPED_BEFORE_START")
    if failures:
        reasons.append("RUNTIME_FAILURES")
    if audited is not None and audited["passed"] is False:
        reasons.append("AUDIT_FINDINGS")
    elif audited is not None and audited["passed"] is None:
        reasons.append("AUDIT_NOT_RUN")
    kinds = Counter(line["kind"] for line in lines)
    for line in lines:
        if line["kind"] == "refusal":
            reasons.append(f"REFUSED:{line.get('code')}")
        elif line["kind"] == "stopped_before_start":
            reasons.append("STOPPED_BEFORE_START")
    started = next((line for line in lines if line["kind"] == "started"), None)
    if started is not None and started.get("source_sha256") != row["source_sha256"]:
        reasons.append("SOURCE_MISMATCH")
    stop_reason = KILLED if ended_by_kill else None
    if summary is not None:
        stop_reason = summary.get("stop_reason")
        if (summary.get("identity") or {}).get("source_sha256") != row["source_sha256"]:
            reasons.append("SOURCE_MISMATCH")
        if (summary.get("account") or {}).get("default_leverage") != row["config"].get("leverage"):
            reasons.append("LEVERAGE_MISMATCH")  # the runner's account is not the declared one
        if summary.get("runtime_failures"):
            reasons.append("RUNTIME_FAILURES")
        if stop_reason not in CLEAN_STOPS:
            reasons.append(f"STOPPED:{stop_reason}")
    denied = sum(1 for line in (egress or b"").decode("utf-8", "replace").splitlines() if " DENY " in line)
    if denied:
        reasons.append("EGRESS_DENIED")

    starting = _decimal(((summary or {}).get("account") or {}).get("starting_balance_usdt")) or Decimal(100000)
    path, funding_by_ns = equity_path(lines) if path_and_funding is None else path_and_funding
    funding_total = sum((flow for _, flow in funding_by_ns), Decimal(0))
    final = None
    if summary is not None and _decimal(summary.get("balance_total")) is not None:
        balance = _decimal(summary["balance_total"])
        open_pnl = [_decimal(item.get("unrealized_pnl")) for item in summary.get("positions_at_stop") or ()]
        if balance is not None and all(value is not None for value in open_pnl):
            final = balance + sum((value for value in open_pnl if value is not None), Decimal(0)) + funding_total
    if final is None and path:
        final = path[-1][1]
    peak, drawdown = starting, Decimal(0)
    for _, equity in path + ([(0, final)] if final is not None else []):
        peak = max(peak, equity)
        drawdown = max(drawdown, (peak - equity) / peak)
    daily: dict[str, Decimal] = {}
    for minute, equity in path:
        daily[_day(minute)] = equity
    if final is not None and summary is not None and summary.get("stopped_ns"):
        daily[_day(summary["stopped_ns"])] = final
    returns, previous = [], starting
    for day, equity in sorted(daily.items()):
        returns.append([day, float(equity / previous - 1)])
        previous = equity
    orders = Counter(line.get("type") for line in lines if line["kind"] == "order")
    return {
        "readings": READINGS, "paper_id": row["paper_id"],
        "status": verdict(reasons), "reasons": sorted(set(reasons)),
        "started_ns": (summary or {}).get("started_ns") or (lines[0]["wall_ns"] if lines else None),
        "stopped_ns": (summary or {}).get("stopped_ns") or (lines[-1]["wall_ns"] if lines else None),
        "stop_reason": stop_reason, "runner_exit_code": exit_code,
        "starting_balance_usdt": str(starting), "final_equity_usdt": str(final) if final is not None else None,
        "total_return": float(final / starting - 1) if final is not None else None,
        "max_drawdown": float(drawdown), "funding_usdt": str(funding_total), "funding_settlements": len(funding_by_ns),
        "daily_returns": returns, "fills": orders.get("OrderFilled", 0),
        "orders_submitted": orders.get("OrderSubmitted", 0),
        "orders_rejected_or_denied": orders.get("OrderRejected", 0) + orders.get("OrderDenied", 0),
        "positions_closed": sum(1 for line in lines if line["kind"] == "position" and line.get("type") == "PositionClosed"),
        "positions_open_at_stop": len((summary or {}).get("positions_at_stop") or ()),
        "bars": kinds.get("bar", 0),
        "missing_bars": sum(int(line.get("missing_bars") or 0) for line in lines if line["kind"] == "data_gap"),
        "late_bars": kinds.get("late_bar", 0), "protection_gaps": kinds.get("protection_gap", 0),
        "socket_events": kinds.get("socket", 0), "egress_denied": denied, "unreadable_journal_lines": unreadable,
        "audit": audited,
        "limitations": ["Sandbox settles no funding: equity adds each settlement's funding at the stream rate and "
                        "the latest MARK, from the positions the journal records",
                        *((summary or {}).get("limitations") or []),
                        *(["Killed from outside: no summary; the equity at the stop is the journal's last, and "
                           "runtime failures are those the runner wrote up to a second before the kill"]
                          if ended_by_kill else [])],
    }


def _read(path: Path) -> bytes | None:
    return path.read_bytes() if path.is_file() and not path.is_symlink() else None


def _tail(data: bytes | None) -> bytes | None:
    if not data:
        return None
    return data[-LOG_TAIL_BYTES:]


def capture(row: dict, output: Path, egress_log: Path, runner_log: bytes | None, exit_code: int | None,
            start_failed: bool = False, oom_killed: bool = False) -> dict[str, bytes]:
    """The capture bundle's files from a run's directories: the journal by UTC day (gzip without a
    timestamp, so the same journal always gives the same bytes), the summary, the logs and seal.json."""
    raw = _read(output / "events.jsonl") or b""
    lines, unreadable = journal_lines(raw)
    summary_bytes = _read(output / "summary.json")
    try:
        summary = json.loads(summary_bytes) if summary_bytes else None
    except ValueError:
        summary = None
    egress = _read(egress_log)
    files: dict[str, bytes] = {}
    if (output / "recovery").is_dir():
        # A recovery manifest binds an exact byte cut, including any interrupted tail.
        # Keep this original instead of a second, re-encoded per-day journal copy.
        files["events/native.jsonl.gz"] = gzip.compress(raw, mtime=0)
    else:
        days: dict[str, list[bytes]] = {}
        for line in lines:
            days.setdefault(_day(line["wall_ns"]), []).append(json.dumps(line, sort_keys=True).encode())
        for day, found in sorted(days.items()):
            files[f"events/{day}.jsonl.gz"] = gzip.compress(b"\n".join(found) + b"\n", mtime=0)
    if summary_bytes:
        files["summary.json"] = summary_bytes
    failures = _read(output / "runtime_failures.jsonl")
    if failures:
        files["runtime_failures.jsonl"] = _tail(failures)  # type: ignore[assignment]
    if egress:
        files["egress.log"] = _tail(egress)  # type: ignore[assignment]
    if runner_log:
        files["runner.log"] = _tail(runner_log)  # type: ignore[assignment]
    launches = _read(output / "launches.jsonl")
    if launches:
        files["launches.jsonl"] = launches
    recovery = output / "recovery"
    if recovery.is_dir() and not recovery.is_symlink():
        originals = [*recovery.glob("*.rdb"), recovery / "current.json", recovery / "dirty",
                     *recovery.glob("used/*/cache.rdb"), *recovery.glob("used/*/manifest.json"),
                     *recovery.glob("attempts/*.json"), *recovery.glob("attempts/*.jsonl")]
        for path in originals:
            if path.is_file() and not path.is_symlink():
                files[f"recovery/{path.relative_to(recovery).as_posix()}"] = path.read_bytes()
    reports = output / "reports"
    if reports.is_dir() and not reports.is_symlink():
        for path in sorted(reports.iterdir()):
            if path.is_file() and not path.is_symlink():
                files[f"reports/{path.name}"] = path.read_bytes()
    seal = readings(row, lines, unreadable, summary, exit_code, egress, start_failed, oom_killed,
                    len((failures or b"").splitlines()), audited=audit(row, output, lines, summary))
    files["seal.json"] = json.dumps(seal, indent=2, sort_keys=True).encode()
    return files


def seal_paper_run(conn: db.LedgerConnection, paper_id: int, files: dict[str, bytes]) -> dict:
    """Write a run's seal and files, seal.json among them; sealing the same capture again writes nothing."""
    if "seal.json" not in files:
        raise ValueError("a paper seal is written with its seal.json")
    read_paper_run(conn, paper_id)
    hashes = {path: hashlib.sha256(content).hexdigest() for path, content in sorted(files.items())}

    def insert(c, op):
        if c.one("SELECT 1 FROM paper_seal WHERE paper_id = %s", (paper_id,)) is not None:
            raise refuse("OP_ID_CONFLICT", f"paper run {paper_id} is sealed with another capture")
        c.rows("INSERT INTO paper_seal (paper_id, op_id, created_at) VALUES (%s, %s, UTC_TIMESTAMP(6))",
               (paper_id, op))
        for path, content in sorted(files.items()):
            c.rows("INSERT INTO paper_file (paper_id, path, content) VALUES (%s, %s, %s)", (paper_id, path, content))
        return c.one("SELECT * FROM paper_seal WHERE op_id = %s", (op,))

    written = db.write(conn, "paper_seal", {"paper_id": paper_id, "files": hashes}, "paper_seal", insert)
    return {"paper_id": paper_id, "files": hashes, "seal": json.loads(files["seal.json"]),
            "ledger_commit": written["commit"], "write_status": written["write_status"]}


def delete_paper_run(profile: db.LedgerProfile, paper_id: int) -> dict:
    """paper delete: remove a sealed run's declaration, seal and files in one commit ``paper_delete:<paper_id>``."""
    def insert(c, op):
        read_paper_run(c, paper_id)
        if c.one("SELECT 1 FROM paper_seal WHERE paper_id = %s", (paper_id,)) is None:
            raise refuse("PAPER_RUN_ACTIVE", f"paper run {paper_id} is not sealed; stop or seal it first",
                         missing=(str(paper_id),))
        (count,), = c.rows("SELECT COUNT(*) FROM paper_file WHERE paper_id = %s", (paper_id,))
        for table in ("paper_file", "paper_seal", "paper_run"):
            c.rows(f"DELETE FROM {table} WHERE paper_id = %s", (paper_id,))
        return {"files_deleted": count}

    with db.connect(profile, "writer") as conn:
        written = db.write(conn, "paper_delete", {"paper_id": paper_id}, "paper_run", insert,
                           op_id=f"paper_delete:{paper_id}")
    return {"paper_id": paper_id, **written["record"], "ledger_commit": written["commit"],
            "write_status": written["write_status"]}
