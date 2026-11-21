"""Readings of a Paper or Live run's journal (the runner's events.jsonl): its lines, the positions it held at each
funding settlement and that settlement's cash flow, its equity path, the audit of its native reports and the seal
readings (seal.json) a Paper run is sealed with (`capture`), and the verdict a seal's reasons give. Pure readings: the
Paper database's records are ledger.paper's; Binance's published rates and MARKs are read through market.sources.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Mapping
from datetime import date
from decimal import ROUND_HALF_EVEN, Decimal, InvalidOperation
import gzip
import json
from pathlib import Path
import shutil
import tempfile

from engine.config import ACCOUNT_CONTRACT, instrument_id, symbol_of
from engine.kline_events import received
from ledger import metrics
from shared import clock


LOG_TAIL_BYTES = 1024 * 1024
# How a run may end without a reason recorded: the user's stop, the engineering duration, a signal, and the end of a
# held run once its positions are closed (engine.paper, HELD_FLAT).
CLEAN_STOPS = frozenset({"STOP_FILE", "SIGTERM", "SIGINT", "DURATION", "HELD_FLAT"})
# The stop reason of a runner killed from outside (a Docker or host restart that did not wait for its stop).
KILLED = "KILLED"
KILLED_EXIT = 137  # 128 + SIGKILL
# The exit status of a runner whose journal could not be written (engine.paper.JOURNAL_FAILED_EXIT; a test keeps them
# equal): with a full disk the summary is as likely missing as the journal's last lines, and this is what the seal has.
JOURNAL_FAILED_EXIT = 3


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


def _decimal(value) -> Decimal | None:
    """A Nautilus money or quantity string ('99999.59855800 USDT', '0.01') as a Decimal."""
    if value is None:
        return None
    try:
        return Decimal(str(value).split(" ", 1)[0])
    except InvalidOperation:
        return None


MINUTE_NS = 60 * 10**9


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


MARK_LOOKBACK_MS = 10 * 60_000  # how far before a settlement its MARK minute is looked for
SIDES = {"LONG": 1, "SHORT": -1, "FLAT": 0}  # a position side's sign


def _money(value: Decimal) -> Decimal:
    return value.quantize(metrics.MONEY, ROUND_HALF_EVEN)


def signed_quantity(event: dict) -> Decimal:
    """A position event's signed quantity: its exact quantity by its side (the native signed_qty is a float)."""
    if event.get("quantity") is not None and event.get("side") in SIDES:
        return (_decimal(event["quantity"]) or Decimal(0)) * SIDES[event["side"]]
    return _decimal(event.get("signed_qty")) or Decimal(0)


def held_at(lines: list[dict], due: dict[str, list[int]]) -> dict[tuple[str, int], dict[str, Decimal]]:
    """The positions (position ID -> signed quantity) each contract held at each settlement in `due` (contract ->
    settlement times). A replay settles once the bars closing before a settlement and every fill they caused are
    applied, and before the bar closing after it; so are the position events journaled before that contract's first
    bar stamped after the settlement."""
    pending = {iid: sorted(times) for iid, times in due.items()}
    open_: dict[str, dict[str, Decimal]] = {iid: {} for iid in pending}
    found: dict[tuple[str, int], dict[str, Decimal]] = {}
    for line in lines:
        iid = line.get("instrument_id")
        if iid not in pending:
            continue
        if line["kind"] == "bar":
            while pending[iid] and pending[iid][0] < (line.get("ts_event") or 0):
                found[(iid, pending[iid].pop(0))] = dict(open_[iid])
        elif line["kind"] == "position" and line.get("position_id"):
            quantity = signed_quantity(line)
            if line.get("type") == "PositionClosed" or not quantity:
                open_[iid].pop(line["position_id"], None)
            else:
                open_[iid][line["position_id"]] = quantity
    for iid, times in pending.items():
        for at in times:
            found[(iid, at)] = dict(open_[iid])
    return found


def settle(positions: dict[str, Decimal], rate: Decimal, mark: Decimal) -> Decimal:
    """The account's funding cash flow of one settlement, as Nautilus's simulated exchange settles it: each position's
    notional at the MARK, rounded to USDT's precision, times the rate, a long paying a positive rate (rc7
    crates/backtest/src/exchange.rs settle_funding_rate)."""
    return sum((_money(-(_money(abs(quantity) * mark)) * rate * (1 if quantity > 0 else -1))
                for quantity in positions.values()), Decimal(0))


def settlements(lines: list[dict],
                published: dict[str, list[tuple[int, Decimal | None, Decimal | None]]] | None = None) -> list[dict]:
    """Each settlement's funding by time: {instrument_id, settlement_ns, rate, mark, positions, funding}, funding None
    when positions were held and the rate or MARK is unknown. Sandbox
    settles none (it takes no funding or MARK data, rc7 crates/adapters/sandbox), so these are the settlements a replay
    of the same journal would make. `published` gives each contract's settlements as the exchange published them
    (published_settlements: the rate, and the MARK a replay settles at), which a seal uses; without it they are the
    journal's estimate of a running run: the rate and latest MARK the stream gave right after each settlement."""
    if published is None:
        published = {}
        for line in lines:
            if line["kind"] == "funding_settlement" and line.get("settlement_ns"):
                published.setdefault(line["instrument_id"], []).append(
                    (line["settlement_ns"], _decimal(line.get("stream_rate")), _decimal(line.get("mark"))))
    held = held_at(lines, {iid: [at for at, _, _ in rows] for iid, rows in published.items()})
    found = []
    for iid, rows in published.items():
        for at, rate, mark in rows:
            positions = held[(iid, at)]
            # A position held without a published rate or MARK: its funding is unknown (None), not zero.
            funding = (Decimal(0) if not positions else settle(positions, rate, mark)
                       if rate is not None and mark is not None else None)
            found.append({"instrument_id": iid, "settlement_ns": at, "rate": rate, "mark": mark,
                          "positions": positions, "funding": funding})
    return sorted(found, key=lambda item: (item["settlement_ns"], item["instrument_id"]))


def published_settlements(lines: list[dict], stopped_ns: int | None,
                          ) -> dict[str, list[tuple[int, Decimal | None, Decimal | None]]]:
    """The settlements Binance published for each contract the run held a position on, from its input start to its
    stop: (settlement_ns, rate, mark), the mark the close of the last MARK minute ending at or before the settlement,
    the one a replay settles at (market.write_marks stamps a minute at its close). The rates are those the market
    imports (market.rest_funding); a mark is read only where a position was held. A source that does not answer
    refuses the seal, which the next round retries."""
    from market import sources
    started = next((line for line in lines if line["kind"] == "started"), None)
    held = {line["instrument_id"] for line in lines if line["kind"] == "position" and line.get("instrument_id")}
    if not held or started is None or not isinstance(started.get("input_start_ns"), int) or not stopped_ns:
        return {}
    start_ms, end_ms = started["input_start_ns"] // 10**6, stopped_ns // 10**6 + 1
    rates = {iid: [(at * 10**6, Decimal(rate)) for at, rate in sources.rest_funding(symbol_of(iid), start_ms, end_ms)]
             for iid in sorted(held)}
    positions = held_at(lines, {iid: [at for at, _ in rows] for iid, rows in rates.items()})
    found: dict[str, list[tuple[int, Decimal | None, Decimal | None]]] = {}
    for iid, rows in rates.items():
        for at, rate in rows:
            mark = None
            if positions[(iid, at)]:
                minute = (at // 10**6 - 59_999) // 60_000 * 60_000  # the last minute closing at or before it
                closes = [(int(row[0]) + 59_999, Decimal(row[4])) for row in sources.rest_klines(
                    "MARK", symbol_of(iid), "1m", minute - MARK_LOOKBACK_MS, minute + 60_000)]
                mark = next((close for closed, close in reversed(closes) if closed * 10**6 <= at), None)
            found.setdefault(iid, []).append((at, rate, mark))
    return found


def equity_path(lines: list[dict], settled: list[dict] | None = None,
                ) -> tuple[list[tuple[int, Decimal]], list[tuple[int, Decimal | None]]]:
    """The account's equity at each journalled minute (balance, open profit and the funding Sandbox does not
    settle: `settled`, settlements(lines) when not given) and each settlement's funding cash flow, by time."""
    points = []
    for line in sorted((line for line in lines if line["kind"] == "snapshot"), key=lambda line: line.get("minute_ns") or 0):
        balance, unrealized = _decimal(line.get("balance_total")), _decimal(line.get("unrealized_pnl"))
        if balance is not None and unrealized is not None:
            points.append((line.get("minute_ns") or 0, balance + unrealized))
    return with_funding(points, settlements(lines) if settled is None else settled)


def with_funding(points: list[tuple[int, Decimal]], settled: list[dict],
                 ) -> tuple[list[tuple[int, Decimal]], list[tuple[int, Decimal | None]]]:
    """Each (minute, equity without funding) point, in time order, plus the funding settled by its minute's end (a
    Paper snapshot or Live minute result is taken as its minute ends), and each settlement's funding by time (None
    when unknown, which the equity leaves out)."""
    funding_by_ns = sorted(((item["settlement_ns"], item["funding"]) for item in settled), key=lambda item: item[0])
    path: list[tuple[int, Decimal]] = []
    applied, funding = 0, Decimal(0)
    for minute, value in points:
        while applied < len(funding_by_ns) and funding_by_ns[applied][0] <= minute + MINUTE_NS:
            funding += funding_by_ns[applied][1] or Decimal(0)
            applied += 1
        path.append((minute, value + funding))
    return path, funding_by_ns


def _ceil_minute(ns: int) -> int:
    return -(-ns // MINUTE_NS) * MINUTE_NS


def audit_inputs(row: dict, inputs: Path, lines: list[dict], summary: dict) -> tuple[dict, dict]:
    """(summary.json, input-coverage.json) for engine.audit over a run's native reports, in a replay's shape. The
    window runs from the input start (a recovery keeps its run's, so the first started line holds it) to the minute
    after the last stop was asked (the stop's own cancels are no gap), every instance trading from it. Entry membership
    is the declaration's (inputs/universe.json, from the input start to that month's end) and each later month the
    journal says the runner read with the contract a member (engine.membership.Membership); each contract's data ends at
    the last bar the journal took (stamped at its close, as the export's last_bar_ns); the fees are the declared
    ones; the clock is live (Sandbox stamps a fill's account update after the fill). The counts the audit holds the reports to come from the journal and the runner's summary, not from the
    reports (both from the one native event stream)."""
    from engine.config import utc_text
    from engine.load import COVERAGE_FORMAT, strategy_id
    started = next(line for line in lines if line["kind"] == "started")
    start = started["input_start_ns"]
    asked = max((line["wall_ns"] for line in lines if line["kind"] == "stop_requested"), default=None)
    end = max(_ceil_minute(asked or summary["stopped_ns"]), start + MINUTE_NS)
    universe = json.loads((inputs / "universe.json").read_bytes())["membership"]
    first_month_end = clock.month_end(start // clock.MS_NS) * clock.MS_NS
    membership = {symbol: [[max(low, start), min(high, first_month_end)] for low, high in universe.get(symbol, [])
                           if high > start and low < first_month_end] for symbol in row["symbols"]}
    for line in lines:
        if line["kind"] == "membership" and line.get("member") is True and line.get("symbol") in membership:
            month = date.fromisoformat(line["month"] + "-01")
            span = [clock.day_ns(month), clock.day_ns(clock.next_month(month))]
            if span not in membership[line["symbol"]]:
                membership[line["symbol"]].append(span)
    closed = [line for line in lines if line["kind"] == "position" and line.get("type") == "PositionClosed"]
    ended = {line.get("client_order_id"): line.get("type") for line in lines if line["kind"] == "order"
             and line.get("type") in ("OrderDenied", "OrderRejected")}
    instances = (summary.get("instances") or {}).values()
    window = {"start": utc_text(start), "trade_start": utc_text(start), "end": utc_text(end)}
    audited = {
        "input_start_utc": window["start"], "period_start_utc": window["trade_start"], "period_end_utc": window["end"],
        "market_day": row["market_day"], "per_coin": [], "clock": "live",
        "trade_start_by_strategy": {item["strategy_id"]: item["input_start_ns"] for item in instances},
        "integrity_passed": not summary.get("orders_denied_or_rejected")
                            and not any(item.get("integrity_findings") for item in instances),
        "denied_orders": sum(kind == "OrderDenied" for kind in ended.values()),
        "rejected_orders": sum(kind == "OrderRejected" for kind in ended.values()),
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
                "export_receipts": {symbol: {"pieces": [{"instrument_id": instrument_id(symbol),
                                                         "strategy_id": strategy_id(symbol),
                                                         "last_bar_ns": last_bar.get(instrument_id(symbol))}],
                                             "assumed": {"maker_fee": fees.get("maker"), "taker_fee": fees.get("taker")}}
                                    for symbol in row["symbols"]}}
    return audited, coverage


def audit(row: dict, output: Path, lines: list[dict], summary: dict | None) -> dict | None:
    """engine.audit over the native reports the runner left in ``<output>/reports/`` (engine.paper.write_native_reports),
    the replay's audit, with its inputs from audit_inputs (on a live clock: engine.live_fill_changes):
    {passed, findings, scope, fill_account_lag_ns_max, the longest a fill's account update followed it, venue_cancels
    and venue_cancel_lead_ns_max, how many reduce-only cancels the venue made before the strategy's request and the
    longest lead (engine.audit.venue_cancel_lead)}; passed is None
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
    return {**{key: result[key] for key in ("passed", "findings", "scope")},
            "fill_account_lag_ns_max": (result.get("native_economics") or {}).get("fill_account_lag_ns_max"),
            "venue_cancels": result.get("venue_cancels"), "venue_cancel_lead_ns_max": result.get("venue_cancel_lead_ns_max")}


def killed(lines: list[dict], summary: dict | None, exit_code: int | None, oom_killed: bool) -> bool:
    """Whether the runner was killed from outside: SIGKILL, not at its memory limit, before it wrote its summary,
    and not after `paper stop` asked it through the STOP file (that kill is the stop's own fallback for a runner
    that did not stop)."""
    asked = any(line["kind"] == "stop_requested" and line.get("reason") == "STOP_FILE" for line in lines)
    return exit_code == KILLED_EXIT and summary is None and not oom_killed and not asked


def late_bars(lines: list[dict]) -> int:
    """The bars the run received more than engine.kline_events.LATE_NS after Binance sent them (its kline_event)."""
    found = received([line for line in lines if line["kind"] == "bar"],
                     [line for line in lines if line["kind"] == "kline_event"])
    return sum(len(item["late"]) for item in found.values())


def readings(row: dict, lines: list[dict], unreadable: int, summary: dict | None, exit_code: int | None,
             egress: bytes | None, start_failed: bool = False, oom_killed: bool = False, failures: int = 0,
             path_and_funding: tuple[list[tuple[int, Decimal]], list[tuple[int, Decimal | None]]] | None = None,
             audited: dict | None = None) -> dict:
    """seal.json: the run's status with its reasons, and the readings computed once at sealing. A runner killed
    from outside (killed()) ends the run as a stop does: what it journaled stands, its stop reason is KILLED.
    `failures` counts the records of the run's runtime_failures.jsonl; `path_and_funding` is equity_path(lines, ...)
    with the settlements to account (a seal's are the published ones), else the journal's estimate; `audited` is
    audit()'s result: findings add AUDIT_FINDINGS, reports it could not audit AUDIT_NOT_RUN."""
    reasons: list[str] = ["START_FAILED"] if start_failed else []
    ended_by_kill = killed(lines, summary, exit_code, oom_killed)
    if not lines:
        reasons.append("JOURNAL_MISSING")
    if summary is None and not ended_by_kill:
        reasons.append("SUMMARY_MISSING")
    if not ended_by_kill and (exit_code not in (0, None) or (exit_code is None and summary is None)):
        reasons.append("RUNNER_EXIT_NONZERO" if exit_code is not None else "RUNNER_EXIT_UNKNOWN")
    if exit_code == JOURNAL_FAILED_EXIT:
        reasons.append("PAPER_JOURNAL_WRITE_FAILED")
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

    starting = _decimal(((summary or {}).get("account") or {}).get("starting_balance_usdt")) or Decimal(
        ACCOUNT_CONTRACT["starting_balance_usdt"])
    path, funding_by_ns = equity_path(lines) if path_and_funding is None else path_and_funding
    funding_total = sum((flow for _, flow in funding_by_ns if flow is not None), Decimal(0))
    unknown = sum(flow is None for _, flow in funding_by_ns)
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
        daily[metrics.utc_day(minute)] = equity
    if final is not None and summary is not None and summary.get("stopped_ns"):
        daily[metrics.utc_day(summary["stopped_ns"])] = final
    returns, previous = [], starting
    for day, equity in sorted(daily.items()):
        returns.append([day, float(equity / previous - 1)])
        previous = equity
    orders = Counter(line.get("type") for line in lines if line["kind"] == "order")
    return {
        "paper_id": row["paper_id"],
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
        "bars": kinds.get("bar", 0),
        "missing_bars": sum(int(line.get("missing_bars") or 0) for line in lines if line["kind"] == "data_gap"),
        "late_bars": late_bars(lines), "protection_gaps": kinds.get("protection_gap", 0),
        "socket_events": kinds.get("socket", 0), "egress_denied": denied, "unreadable_journal_lines": unreadable,
        "audit": audited,
        "limitations": ["Sandbox settles no funding: equity adds each settlement Binance published, at its rate and "
                        "the MARK a replay settles at, for the positions the journal held then",
                        *([f"{unknown} funding settlement{'s' if unknown > 1 else ''} with a position open "
                           f"{'have' if unknown > 1 else 'has'} no published rate or MARK: "
                           f"{'their' if unknown > 1 else 'its'} funding is unknown and left out of the equity"]
                          if unknown else []),
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
    timestamp, so the same journal always gives the same bytes), the summary, the logs and seal.json, whose funding
    is the settlements Binance published (published_settlements)."""
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
            days.setdefault(metrics.utc_day(line["wall_ns"]), []).append(json.dumps(line, sort_keys=True).encode())
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
    stopped = (summary or {}).get("stopped_ns") or (lines[-1]["wall_ns"] if lines else None)
    path_and_funding = equity_path(lines, settlements(lines, published_settlements(lines, stopped)))
    seal = readings(row, lines, unreadable, summary, exit_code, egress, start_failed, oom_killed,
                    len((failures or b"").splitlines()), path_and_funding, audited=audit(row, output, lines, summary))
    files["seal.json"] = json.dumps(seal, indent=2, sort_keys=True).encode()
    return files
