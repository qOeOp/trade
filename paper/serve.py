"""The paper daemon (`paper serve`): one ledger's paper runs over HTTP, for the trade IDE's Paper panel.

It listens on loopback only; the IDE service in front proxies ``/api/paper/`` to it and adds the page's
token (services/ide/research_graph/serve.py). Reads happen here: the runs with their live readings, a
run's journal as it grows, a version's last research replay. Every write (start, stop, seal) is the
command line ``python -m cli.main paper …`` run with an allowlisted environment, so the ledger is written
and published only through it. A run that ended on its own (its duration, a crash) is sealed when found.

A reconciliation (`paper reconcile`) runs the command line in the background into the temporary
directory and is read back from there; it writes nothing to the ledger.

A request's Host must be an allowed one; a browser request from another origin is refused, and a POST
carries JSON, which a page elsewhere cannot send without a preflight this server never answers.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import threading
import time
from urllib.parse import parse_qs, urlsplit

from ledger import db, paper as records, strategies
from ledger.errors import Refusal
from ledger.refusals import refuse
from paper import runs


PREFIX = "/api/paper"
BODY_LIMIT = 64 * 1024
LIST_SECONDS = 2.0  # how long a runs listing is reused
SEAL_SECONDS = 15.0  # between looks for runs that ended on their own
ORPHAN_SECONDS = 600  # a declared run with no containers this long after its start is sealed
STREAM_SECONDS = 1.0
READINGS_SECONDS = 5.0
HEARTBEAT_SECONDS = 15.0
CLI_SECONDS = 900
RECONCILE_SECONDS = 3600  # an uncalibrated example value: a reconciliation's replay is stopped after this long
# What a command line child gets of this process's environment: the docker client's and the product's own.
CHILD_ENV = (*runs.DOCKER_ENV, "TRADE_LEDGER_HOME", "RESEARCH_DOLT_BINARY", "DOLT_ROOT_PATH")
SYMBOL = re.compile(r"[A-Z0-9]{2,30}\Z")
FAILURES = "runtime_failures.jsonl"
STREAM = re.compile(rf"{PREFIX}/runs/(\d+)/(stream|stop|reconcile)\Z")


class Failure(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status, self.body = status, {"code": code, "message": message}


def _instrument(symbol: str) -> str:
    return f"{symbol}-PERP.BINANCE"


def read_lines(path: Path, offset: int) -> tuple[int, list[dict], int]:
    """The complete journal lines appended after `offset`: the new offset, the lines, the unreadable count.
    A line still being written is read next time."""
    try:
        with path.open("rb") as stream:
            stream.seek(offset)
            data = stream.read()
    except FileNotFoundError:
        return offset, [], 0
    end = data.rfind(b"\n") + 1
    lines, unreadable = records.journal_lines(data[:end])
    return offset + end, lines, unreadable


@dataclass
class Journal:
    """A run's journal read so far: its lines except bars (kept as a count)."""
    offset: int = 0
    lines: list[dict] = field(default_factory=list)
    bars: int = 0
    last_bar_ns: int | None = None
    unreadable: int = 0

    def read(self, path: Path) -> None:
        self.offset, lines, unreadable = read_lines(path, self.offset)
        self.unreadable += unreadable
        for line in lines:
            if line["kind"] == "bar":
                self.bars += 1
                self.last_bar_ns = max(self.last_bar_ns or 0, line.get("ts_event") or 0)
            else:
                self.lines.append(line)


def live_readings(row: dict, journal: Journal) -> dict:
    """The readings a seal would compute from the journal so far, with the equity path behind them."""
    found = records.readings(row, journal.lines, journal.unreadable, None, None, None)
    path, _ = records.equity_path(journal.lines)
    return {key: found[key] for key in ("total_return", "max_drawdown", "final_equity_usdt", "funding_usdt",
                                        "fills", "orders_submitted", "positions_closed", "missing_bars",
                                        "late_bars", "protection_gaps", "started_ns")} | {
        "bars": journal.bars, "last_bar_ns": journal.last_bar_ns,
        "starting_balance_usdt": found["starting_balance_usdt"],
        "equity": [[minute, float(equity)] for minute, equity in path]}


def failure_records(data: bytes | None) -> list[dict]:
    """The records of a runtime_failures.jsonl (engine/run.py: one per distinct exception, with its count
    and first traceback). A line cut by the capture's tail or by a write in progress is left out."""
    found = []
    for raw in (data or b"").splitlines():
        try:
            value = json.loads(raw)
        except ValueError:
            continue
        if isinstance(value, dict) and isinstance(value.get("count"), int):
            found.append(value)
    return found


def _read_bytes(path: Path) -> bytes | None:
    try:
        return path.read_bytes()
    except FileNotFoundError:
        return None


def _changed(live: dict) -> tuple:
    return len(live["equity"]), live["last_bar_ns"], live["fills"], live["orders_submitted"], live["exceptions"]


PRECISION = 1 << 10  # ns: what a page's timestamp may be off by (a double holds one to 256 ns), with room


@dataclass(frozen=True)
class Resume:
    """What the page already holds of a run's journal: its first `lines` lines but bars, the last of them
    written at `last` (wall ns), and the bars (with no contract, every contract's closes) up to `bars`
    (ns); both times only to a double's precision, as the page reads JSON numbers."""
    lines: int
    last: int
    bars: int


def resume_of(query: dict[str, str]) -> Resume | None:
    """The stream's `lines`, `last` and `bars` parameters, all or none."""
    if not {"lines", "last", "bars"} & query.keys():
        return None
    try:
        found = Resume(int(query["lines"]), int(query["last"]), int(query["bars"]))
    except (KeyError, ValueError):
        raise Failure(400, "USAGE_ERROR", "a resumed stream names lines, last and bars, each an integer") from None
    if found.lines < 0:
        raise Failure(400, "USAGE_ERROR", "lines counts the journal lines the page holds")
    return found


def resumed(lines: list[dict], resume: Resume) -> list[dict] | None:
    """`lines` (the journal from its start) less what `resume` says the page holds: the lines but bars after
    its first `resume.lines`, and the bars after `resume.bars`, in journal order; None when the page's
    journal is not this one (it holds more lines, or its last was written at another time)."""
    start = 0
    if resume.lines:
        seen = [at for at, line in enumerate(lines) if line["kind"] != "bar"]
        if len(seen) < resume.lines or abs(int(lines[seen[resume.lines - 1]].get("wall_ns") or 0) - resume.last) > PRECISION:
            return None
        start = seen[resume.lines - 1] + 1
    return [line for at, line in enumerate(lines)
            if (int(line.get("ts_event") or 0) > resume.bars + PRECISION if line["kind"] == "bar" else at >= start)]


def _wanted(line: dict, instrument: str | None) -> bool:
    return line["kind"] != "bar" or line.get("instrument_id") == instrument


def closes(lines: list[dict]) -> dict[str, list[list]]:
    """Every contract's bar closes among `lines`, by symbol: [bar time (ns), close] pairs in journal order."""
    found: dict[str, list[list]] = {}
    for line in lines:
        if line["kind"] == "bar" and line.get("instrument_id") and line.get("close") is not None:
            found.setdefault(str(line["instrument_id"]).split("-")[0], []).append([line.get("ts_event") or 0, float(line["close"])])
    return found


class Daemon:
    def __init__(self, ledger: str | None, market: str | None, product: Path, runtime: str | None = None):
        from cli.main import ledger_profile
        self.ledger, self.market, self.product, self.runtime = ledger, market, product, runtime
        self.profile = ledger_profile(ledger)
        self.lock = threading.Lock()
        self.reading = threading.Lock()
        self.starting: set[str] = set()
        self.stopping: set[int] = set()
        self.journals: dict[int, Journal] = {}
        self.listed: tuple[float, dict] | None = None
        self.reconciling: dict[int, dict] = {}

    # Writes: the command line

    def cli(self, *argv: str, timeout: float = CLI_SECONDS) -> dict:
        command = [sys.executable, "-m", "cli.main", "paper", *argv, *(["--ledger", self.ledger] if self.ledger else [])]
        env = {name: os.environ[name] for name in CHILD_ENV if name in os.environ}
        done = subprocess.run(command, cwd=self.product, capture_output=True, text=True, timeout=timeout,
                              check=False, env=env)
        try:
            found = json.loads(done.stdout if done.returncode == 0 else done.stderr)
        except ValueError:
            raise Failure(500, "PAPER_FAILED", (done.stderr or done.stdout).strip()[-2000:]) from None
        if done.returncode:
            raise Failure(409, found.get("code", "PAPER_FAILED"), found.get("message", ""))
        self.listed = None
        return found

    def start(self, body: dict) -> dict:
        candidate, symbols, universe = body.get("candidate"), body.get("symbols"), body.get("universe")
        if not isinstance(candidate, str) or not candidate:
            raise Failure(400, "USAGE_ERROR", "the body names a candidate")
        if universe not in (None, "pool") or (symbols is not None and (
                not isinstance(symbols, list) or not symbols or not all(isinstance(s, str) and SYMBOL.fullmatch(s)
                                                                       for s in symbols))):
            raise Failure(400, "USAGE_ERROR", "symbols are Binance symbols such as BTCUSDT, or universe is pool")
        if symbols is None and universe is None:
            last = self.last_config(candidate)
            if last is None:
                raise Failure(409, "NO_LAST_REPLAY", f"{candidate} has no research replay to take contracts from")
            symbols = last["symbols"]
        with self.lock:
            if candidate in self.starting:
                raise Failure(409, "PAPER_RUN_ACTIVE", f"{candidate} is already starting")
            self.starting.add(candidate)
        try:
            scope = ["--universe", "pool"] if universe else ["--symbols", *(symbols or [])]
            market = ["--market", self.market] if self.market else []
            runtime = ["--runtime", self.runtime] if self.runtime else []
            return self.cli("start", "--candidate", candidate, *scope, *market, *runtime)
        finally:
            with self.lock:
                self.starting.discard(candidate)

    def stop(self, paper_id: int) -> dict:
        with self.lock:
            if paper_id in self.stopping:
                return {"paper_id": paper_id, "state": "stopping"}
            self.stopping.add(paper_id)

        def run() -> None:
            try:
                self.cli("stop", "--paper-id", str(paper_id))
            except Failure as exc:
                print(f"paper stop {paper_id}: {exc.body}", file=sys.stderr, flush=True)
            finally:
                with self.lock:
                    self.stopping.discard(paper_id)
                self.listed = None

        threading.Thread(target=run, daemon=True).start()
        return {"paper_id": paper_id, "state": "stopping"}

    def reconcile_root(self) -> Path:
        return Path(tempfile.gettempdir()) / f"trade-paper-reconcile-{runs.ledger_key(self.profile)}"

    def reconcile(self, paper_id: int) -> dict:
        """Start `paper reconcile` of a sealed run in the background; its result is read with reconciliation()."""
        with db.connect(self.profile, "reader") as conn:
            records.read_paper_run(conn, paper_id)
            if records.seal_of(conn, paper_id) is None:
                raise Failure(409, "PAPER_RUN_ACTIVE", f"paper run {paper_id} is not sealed")
        with self.lock:
            if (self.reconciling.get(paper_id) or {}).get("state") == "reconciling":
                return {"paper_id": paper_id, "state": "reconciling"}
            self.reconciling[paper_id] = {"state": "reconciling", "started": time.time()}
        root = self.reconcile_root()
        root.mkdir(mode=0o700, exist_ok=True)
        output = root / f"{paper_id}-{time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())}"

        def run() -> None:
            try:
                market = ["--market", self.market] if self.market else []
                self.cli("reconcile", "--paper-id", str(paper_id), "--output", str(output), *market,
                         "--timeout-seconds", str(RECONCILE_SECONDS - 60), timeout=RECONCILE_SECONDS)
                found: dict[str, object] = {"state": "done"}
            except Failure as exc:
                found = {"state": "failed", "error": exc.body}
            except subprocess.TimeoutExpired:
                found = {"state": "failed", "error": {"code": "PAPER_FAILED", "message": "the reconciliation timed out"}}
            with self.lock:
                self.reconciling[paper_id] = found

        threading.Thread(target=run, daemon=True).start()
        return {"paper_id": paper_id, "state": "reconciling"}

    def reconciliation(self, paper_id: int) -> dict:
        """A run's latest reconciliation: {state: none, reconciling, failed (with error) or done (with result)}."""
        with self.lock:
            found = dict(self.reconciling.get(paper_id) or {})
        if found.get("state") in ("reconciling", "failed"):
            return {"paper_id": paper_id, **found}
        done = sorted(self.reconcile_root().glob(f"{paper_id}-*/reconcile.json"))
        if not done:
            return {"paper_id": paper_id, "state": "none"}
        return {"paper_id": paper_id, "state": "done", "result": json.loads(done[-1].read_text(encoding="utf-8"))}

    def seal_ended(self) -> None:
        """Seals the runs whose runner exited on its own, and those left with no containers."""
        while True:
            time.sleep(SEAL_SECONDS)
            try:
                found = self.runs()
            except Refusal as exc:
                print(f"paper listing: {exc}", file=sys.stderr, flush=True)
                continue
            now = time.time()
            for run in found["runs"]:
                orphan = run["state"] == "unsealed" and now - _epoch(run["created_at"]) > ORPHAN_SECONDS
                if (run["state"] == "ended" or orphan) and run["paper_id"] not in self.stopping:
                    try:
                        self.cli("seal", "--paper-id", str(run["paper_id"]))
                    except Failure as exc:
                        print(f"paper seal {run['paper_id']}: {exc.body}", file=sys.stderr, flush=True)

    # Reads

    def last_config(self, candidate: str) -> dict | None:
        with db.connect(self.profile, "reader") as conn:
            found = strategies.read_candidate(conn, candidate)
            return records.last_research_symbols(conn, found["source_sha256"])

    def journal(self, paper_id: int) -> Journal:
        journal = self.journals.setdefault(paper_id, Journal())
        journal.read(runs.run_dir(self.profile, paper_id) / "out" / "events.jsonl")
        return journal

    def runs(self) -> dict:
        with self.reading:  # one reader at a time moves the journals' offsets
            if self.listed and time.monotonic() - self.listed[0] < LIST_SECONDS:
                return self.listed[1]
            return self._runs()

    def _runs(self) -> dict:
        found = runs.listing(self.profile)
        with db.connect(self.profile, "reader") as conn:
            rows = {row["paper_id"]: row for row in records.paper_runs(conn)}
        for run in found["runs"]:
            if run["paper_id"] in self.stopping and run["state"] in ("running", "ended"):
                run["state"] = "stopping"
            if run["state"] == "sealed":
                run["seal"] = rows[run["paper_id"]]["seal"]
                self.journals.pop(run["paper_id"], None)
            else:
                run["live"] = live_readings(rows[run["paper_id"]], self.journal(run["paper_id"]))
                failures = _read_bytes(runs.run_dir(self.profile, run["paper_id"]) / "out" / FAILURES)
                # How often the strategy raised so far; the runner rewrites the file at each power of two.
                run["live"]["exceptions"] = sum(item["count"] for item in failure_records(failures))
        found["starting"] = sorted(self.starting)
        self.listed = (time.monotonic(), found)
        return found

    def bundle(self, paper_id: int) -> dict[str, bytes]:
        with db.connect(self.profile, "reader") as conn:
            return records.evidence.load_bundle(conn, records.bundle_name(paper_id))["files"]

    def sealed_lines(self, paper_id: int, files: dict[str, bytes] | None = None) -> list[dict]:
        """The sealed run's whole journal, every contract's bars included."""
        import gzip
        files = self.bundle(paper_id) if files is None else files
        lines: list[dict] = []
        for name in sorted(name for name in files if name.startswith("events/")):
            lines += records.journal_lines(gzip.decompress(files[name]))[0]
        return lines


def _epoch(value) -> float:
    return value.timestamp() if hasattr(value, "timestamp") else 0.0


class Server(ThreadingHTTPServer):
    """The paper daemon's HTTP server: a client that goes away mid-request (a closed page or reset connection) is
    not an error, so it prints no traceback."""

    daemon_threads = True

    def handle_error(self, request, client_address) -> None:
        if not isinstance(sys.exc_info()[1], ConnectionError):
            super().handle_error(request, client_address)


def handler(daemon: Daemon, hosts: frozenset[str]) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def json(self, status: int, value) -> None:
            body = json.dumps(value, default=str, ensure_ascii=False).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(body)

        def refuse(self, failure: Failure) -> None:
            self.close_connection = True
            self.json(failure.status, failure.body)

        def admitted(self) -> bool:
            if self.headers.get("Host") not in hosts or self.headers.get("Sec-Fetch-Site") in ("cross-site", "same-site"):
                self.refuse(Failure(403, "FORBIDDEN", "requests come from the trade IDE's own page"))
                return False
            return True

        def do_GET(self) -> None:  # noqa: N802 (http.server's name)
            if not self.admitted():
                return
            url = urlsplit(self.path)
            query = {name: values[0] for name, values in parse_qs(url.query).items() if values}
            try:
                if url.path == f"{PREFIX}/health":
                    self.json(200, {"ledger": daemon.profile.database, "limit": runs.MAX_RUNNING})
                elif url.path == f"{PREFIX}/runs":
                    self.json(200, daemon.runs())
                elif url.path == f"{PREFIX}/defaults":
                    self.json(200, {"last": daemon.last_config(query.get("candidate", ""))})
                elif (found := STREAM.fullmatch(url.path)) and found[2] == "stream":
                    symbol = query.get("symbol")
                    if symbol is not None and not SYMBOL.fullmatch(symbol):
                        raise Failure(400, "USAGE_ERROR", "symbol is a Binance symbol such as BTCUSDT")
                    self.stream(int(found[1]), _instrument(symbol) if symbol else None, resume_of(query))
                elif found and found[2] == "reconcile":
                    self.json(200, daemon.reconciliation(int(found[1])))
                else:
                    raise Failure(404, "NOT_FOUND", url.path)
            except Failure as exc:
                self.refuse(exc)
            except Refusal as exc:
                self.refuse(Failure(409, exc.code, str(exc)))

        def do_POST(self) -> None:  # noqa: N802 (http.server's name)
            if not self.admitted():
                return
            try:
                length = int(self.headers.get("Content-Length") or 0)
                if not (self.headers.get("Content-Type") or "").startswith("application/json") or length > BODY_LIMIT:
                    raise Failure(415, "USAGE_ERROR", "a POST carries a JSON body of at most 64 KiB")
                body = json.loads(self.rfile.read(length) or b"{}")
                found = STREAM.fullmatch(urlsplit(self.path).path)
                if self.path == f"{PREFIX}/runs" and isinstance(body, dict):
                    self.json(200, daemon.start(body))
                elif found and found[2] == "stop":
                    self.json(202, daemon.stop(int(found[1])))
                elif found and found[2] == "reconcile":
                    self.json(202, daemon.reconcile(int(found[1])))
                else:
                    raise Failure(404, "NOT_FOUND", self.path)
            except ValueError:
                self.refuse(Failure(400, "USAGE_ERROR", "the body is not JSON"))
            except Failure as exc:
                self.refuse(exc)
            except Refusal as exc:
                self.refuse(Failure(409, exc.code, str(exc)))

        def send_event(self, kind: str, value) -> None:
            self.wfile.write(f"event: {kind}\ndata: {json.dumps(value, default=str)}\n\n".encode())
            self.wfile.flush()

        def resume(self, lines: list[dict], resume: Resume | None) -> list[dict]:
            """The first batch for a page holding what `resume` says: less that, announced, when the journal
            is the page's, else all of `lines`."""
            if resume is None or (rest := resumed(lines, resume)) is None:
                return lines
            self.send_event("resumed", {"lines": resume.lines, "bars": resume.bars})
            return rest

        def stream(self, paper_id: int, instrument: str | None, resume: Resume | None = None) -> None:
            """Server-sent events: `lines` (the journal so far, then what is appended: every line but the bars
            of other contracts), `closes` (for a stream of no contract, the Account view's: every contract's
            bar closes (closes()), all of them and then what is appended), `state` (state.json as it is
            replaced), `failures` (the strategy's runtime failure records as the runner rewrites them, or the
            sealed capture's), `readings` (live_readings, as they change) and `end` (the seal) once the run
            is sealed. With `resume` the first `lines` and `closes` leave out what the page holds (resumed()),
            announced by `resumed` (the resume's `lines` and `bars`); a journal the page's does not match
            streams whole, unannounced."""
            with db.connect(daemon.profile, "reader") as conn:
                row = records.read_paper_run(conn, paper_id)
                sealed = records.seal_of(conn, paper_id)
            files = daemon.bundle(paper_id) if sealed else {}
            whole = daemon.sealed_lines(paper_id, files) if sealed else []
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            try:
                if sealed is not None:
                    journal = Journal(lines=[line for line in whole if line["kind"] != "bar"])
                    rest = self.resume(whole, resume)
                    self.send_event("lines", [line for line in rest if _wanted(line, instrument)])
                    if instrument is None:
                        self.send_event("closes", closes(rest))
                    failures = failure_records(files.get(FAILURES))
                    self.send_event("failures", failures)
                    self.send_event("readings", live_readings(row, journal) | {
                        "exceptions": sum(item["count"] for item in failures)})
                    self.send_event("end", sealed)
                    return
                directory = runs.run_dir(daemon.profile, row["paper_id"]) / "out"
                offset, state_seen, failures_seen, beat, first, shown = 0, 0.0, 0.0, time.monotonic(), True, None
                while True:
                    offset, lines, _ = read_lines(directory / "events.jsonl", offset)
                    if first:
                        lines = self.resume(lines, resume)
                    kept = [line for line in lines if _wanted(line, instrument)]
                    found = closes(lines) if instrument is None else {}
                    if kept or first:
                        self.send_event("lines", kept)
                    if instrument is None and (found or first):
                        self.send_event("closes", found)
                    if kept or found or first:
                        beat, first = time.monotonic(), False
                    try:
                        modified = (directory / "state.json").stat().st_mtime
                        if modified != state_seen:
                            state_seen = modified
                            self.send_event("state", json.loads((directory / "state.json").read_text()))
                    except (FileNotFoundError, ValueError):
                        pass
                    try:
                        modified = (directory / FAILURES).stat().st_mtime
                        if modified != failures_seen:
                            failures_seen = modified
                            self.send_event("failures", failure_records(_read_bytes(directory / FAILURES)))
                    except FileNotFoundError:
                        pass
                    if time.monotonic() - beat > HEARTBEAT_SECONDS:
                        self.wfile.write(b": heartbeat\n\n")
                        self.wfile.flush()
                        beat = time.monotonic()
                    listed = next((run for run in daemon.runs()["runs"] if run["paper_id"] == paper_id), None)
                    if listed is not None and listed["state"] == "sealed":
                        self.send_event("end", listed["seal"])
                        return
                    live = (listed or {}).get("live")
                    if live is not None and _changed(live) != shown:  # a new minute, bar or fill
                        shown = _changed(live)
                        self.send_event("readings", live)
                    time.sleep(STREAM_SECONDS)
            except OSError:
                pass  # the page went away
            except Refusal:
                # The ledger refused a read once the stream had begun: the stream ends rather than carry a
                # second response, and the page's reconnect hears why (its 409, above).
                pass
            finally:
                self.close_connection = True

        def log_message(self, format: str, *args) -> None:  # noqa: A002 (http.server's name)
            sys.stderr.write(f"{self.log_date_time_string()} {format % args}\n")

    return Handler


def serve(ledger: str | None, market: str | None, host: str, port: int, hosts: list[str], product: Path,
          runtime: str | None = None) -> None:
    if host not in ("127.0.0.1", "::1", "localhost"):
        raise refuse("USAGE_ERROR", "the paper daemon listens on loopback only")
    daemon = Daemon(ledger, market, product, runtime)
    allowed = frozenset(hosts or [f"127.0.0.1:{port}", f"localhost:{port}", f"host.docker.internal:{port}"])
    server = Server((host, port), handler(daemon, allowed))
    threading.Thread(target=daemon.seal_ended, daemon=True).start()
    print(f"paper runs of {daemon.profile.database} at http://{host}:{port}{PREFIX}/", file=sys.stderr, flush=True)
    server.serve_forever()
