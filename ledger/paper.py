"""Paper run records (`ledger.open_paper_run`, `ledger.seal_paper_run`, `ledger.paper_runs`).

A paper run is declared once, before its container starts (`paper_run`): the source, the runtime image,
the contracts, the market commit its membership was read at and the effective configuration. It is
sealed once, after it ends, into the product bundle ``paper-<paper_id>-capture``: the runner's journal
split by UTC day, its summary, the egress and runner logs, and ``seal.json``, the readings computed
here once (docs/plans/paper-run-storage-decision.zh.md). Paper runs are not trials: they add no trial
count and no exposure. A run that crashed or lost its files still seals, as ``invalid`` with reasons,
so every declared run has an outcome.
"""

from __future__ import annotations

from collections import Counter
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
import gzip
import json
from pathlib import Path

from ledger import db, evidence
from ledger.refusals import refuse


TABLE = "paper_run"
READINGS = "paper-readings@2026-10-25"
DAY_NS = 86_400 * 10**9
LOG_TAIL_BYTES = 1024 * 1024
# How a run may end and still be complete: the user's stop, the engineering duration.
CLEAN_STOPS = frozenset({"STOP_FILE", "SIGTERM", "SIGINT", "DURATION"})


def bundle_name(paper_id: int) -> str:
    return f"paper-{paper_id}-capture"


def held(conn: db.LedgerConnection) -> bool:
    """Whether the version this connection reads has the paper run table."""
    return bool(conn.rows("SHOW TABLES LIKE %s", (TABLE,)))


def _require(conn: db.LedgerConnection) -> None:
    if not held(conn):
        raise refuse("LEDGER_UPGRADE_REQUIRED", f"the ledger has no {TABLE} table", missing=(TABLE,))


def _row(row: dict) -> dict:
    return {**row, "symbols": json.loads(row["symbols"]) if isinstance(row["symbols"], str) else row["symbols"],
            "config": json.loads(row["config"]) if isinstance(row["config"], str) else row["config"]}


def open_paper_run(conn: db.LedgerConnection, source_sha256: str, image_ref: str, symbols: list[str],
                   market_commit: str, config: dict, op_id: str) -> dict:
    """Declare one paper run of a published candidate's source; `op_id` names this start (a retry with the
    same ID returns the same run)."""
    _require(conn)
    if not conn.rows("SELECT 1 FROM candidate WHERE source_sha256 = %s", (source_sha256,)):
        raise refuse("UNKNOWN_CANDIDATE", f"no candidate has source {source_sha256}", missing=(source_sha256,))
    payload = {"source_sha256": source_sha256, "image_ref": image_ref, "symbols": list(symbols),
               "market_commit": market_commit, "config": config}

    def insert(c, op):
        c.rows(f"INSERT INTO {TABLE} (source_sha256, image_ref, symbols, market_commit, config, op_id, created_at) "
               "VALUES (%s, %s, %s, %s, %s, %s, UTC_TIMESTAMP(6))",
               (source_sha256, image_ref, json.dumps(list(symbols)), market_commit,
                json.dumps(config, sort_keys=True), op))
        return c.one(f"SELECT * FROM {TABLE} WHERE op_id = %s", (op,))

    written = db.write(conn, "paper_start", payload, TABLE, insert, op_id=op_id)
    return {**_row(written["record"]), "ledger_commit": written["commit"], "write_status": written["write_status"]}


def read_paper_run(conn: db.LedgerConnection, paper_id: int) -> dict:
    _require(conn)
    row = conn.one(f"SELECT * FROM {TABLE} WHERE paper_id = %s", (paper_id,))
    if row is None:
        raise refuse("PAPER_RUN_UNKNOWN", f"no paper run {paper_id}", missing=(str(paper_id),))
    return _row(row)


def seal_of(conn: db.LedgerConnection, paper_id: int) -> dict | None:
    """The stored seal.json of a run, or None while it is unsealed."""
    found = conn.one(f"SELECT c.content FROM {evidence.files_from()} WHERE e.bundle = %s AND e.path = 'seal.json'",
                     (bundle_name(paper_id),))
    return json.loads(bytes(found["content"])) if found else None


def paper_runs(conn: db.LedgerConnection) -> list[dict]:
    """Every declared run, oldest first, with its seal readings once sealed."""
    if not held(conn):
        return []
    rows = [_row(row) for row in conn.dicts(f"SELECT * FROM {TABLE} ORDER BY paper_id")]
    return [{**row, "seal": seal_of(conn, row["paper_id"])} for row in rows]


def last_research_symbols(conn: db.LedgerConnection, source_sha256: str) -> dict | None:
    """The contracts of the source's latest research replay that ran ({trial_id, symbols}), or None: what a
    paper run of the version's last configuration trades."""
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


def _day(ns: int) -> str:
    return datetime.fromtimestamp(ns // 10**9, UTC).date().isoformat()


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


def readings(row: dict, lines: list[dict], unreadable: int, summary: dict | None, exit_code: int | None,
             egress: bytes | None, start_failed: bool = False) -> dict:
    """seal.json: the run's status with its reasons, and the readings computed once at sealing."""
    reasons: list[str] = ["START_FAILED"] if start_failed else []
    if not lines:
        reasons.append("JOURNAL_MISSING")
    if summary is None:
        reasons.append("SUMMARY_MISSING")
    if exit_code not in (0, None) or (exit_code is None and summary is None):
        reasons.append("RUNNER_EXIT_NONZERO" if exit_code is not None else "RUNNER_EXIT_UNKNOWN")
    kinds = Counter(line["kind"] for line in lines)
    for line in lines:
        if line["kind"] == "refusal":
            reasons.append(f"REFUSED:{line.get('code')}")
        elif line["kind"] == "stopped_before_start":
            reasons.append("STOPPED_BEFORE_START")
    started = next((line for line in lines if line["kind"] == "started"), None)
    if started is not None and started.get("source_sha256") != row["source_sha256"]:
        reasons.append("SOURCE_MISMATCH")
    stop_reason = None
    if summary is not None:
        stop_reason = summary.get("stop_reason")
        if (summary.get("identity") or {}).get("source_sha256") != row["source_sha256"]:
            reasons.append("SOURCE_MISMATCH")
        if summary.get("runtime_failures"):
            reasons.append("RUNTIME_FAILURES")
        if stop_reason not in CLEAN_STOPS:
            reasons.append(f"STOPPED:{stop_reason}")
    denied = sum(1 for line in (egress or b"").decode("utf-8", "replace").splitlines() if " DENY " in line)
    if denied:
        reasons.append("EGRESS_DENIED")

    starting = _decimal(((summary or {}).get("account") or {}).get("starting_balance_usdt")) or Decimal(100000)
    path, funding_by_ns = equity_path(lines)
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
        "status": "invalid" if reasons else "complete", "reasons": sorted(set(reasons)),
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
        "limitations": ["Sandbox settles no funding: equity adds each settlement's funding at the stream rate and "
                        "the latest MARK, from the positions the journal records",
                        *((summary or {}).get("limitations") or [])],
    }


def _read(path: Path) -> bytes | None:
    return path.read_bytes() if path.is_file() and not path.is_symlink() else None


def _tail(data: bytes | None) -> bytes | None:
    if not data:
        return None
    return data[-LOG_TAIL_BYTES:]


def capture(row: dict, output: Path, egress_log: Path, runner_log: bytes | None, exit_code: int | None,
            start_failed: bool = False) -> dict[str, bytes]:
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
    seal = readings(row, lines, unreadable, summary, exit_code, egress, start_failed)
    files["seal.json"] = json.dumps(seal, indent=2, sort_keys=True).encode()
    return files


def seal_paper_run(conn: db.LedgerConnection, paper_id: int, files: dict[str, bytes]) -> dict:
    """Write a run's capture bundle; sealing the same capture again writes nothing."""
    read_paper_run(conn, paper_id)
    bundle = bundle_name(paper_id)
    hashes = evidence.digests(files)

    def insert(c, op):
        return evidence.write_files(c, bundle, files, op)

    written = db.write(conn, "paper_seal", {"bundle": bundle, "files": hashes}, "evidence_bundle", insert)
    return {"bundle": bundle, "files": hashes, "seal": json.loads(files["seal.json"]),
            "ledger_commit": written["commit"], "write_status": written["write_status"]}
