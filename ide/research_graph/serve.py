"""`ide.py serve`: one ledger's research graph as a page that follows the ledger (standard library only).

The page is the web renderer's built page without a view: it reads `/api/view` and follows
`/api/events` (Server-Sent Events). The product is reached only through its command line, `ledger
sql` for a head, `research graph` for a graph, `replay report --tables` for a trial's report (the Runs
page's backtest, `/api/trial`, at a full ledger commit) and `market bars --timeframe 1d` for a contract's
daily bars (its backtest candles, `/api/bars`, whole UTC days at a full market commit, on the market
profile given or the active one), so this module imports no product package. While
a page without `at` is open the head is read every `poll` seconds; when it moves, each open page's
graph is fetched once at the new head, the latest only. One fetch runs at a time. Up to 8 successful views stay in memory, keyed
by ledger, build, commit, line and `since`, retaining a scope's newest live completion before its
older duplicates. A named live page can show that completion while a newer head is still drawing;
up to 16 trials' reports and 16 contracts' daily bars stay in memory, keyed by what they were read for.
Nothing is written anywhere.

With an agent URL (the trade IDE's chat service, `ide/agent`), requests under `/api/agent/`
pass the same Host and cross-site checks and are then forwarded to it as they are, the answer
streamed back as it arrives; without one those paths do not exist and the page shows no agent.

With a paper URL (the paper daemon, `python -m cli.main paper serve`), requests under `/api/paper/` are
forwarded the same way, and the Runs page can start and stop paper runs. A POST there must also come
from the page itself (`Sec-Fetch-Site: same-origin`) and carry the token this service generated at start
and put in the page (`X-Trade-Paper-Token`), so a page on another port of this host cannot start a run.

With an overview URL (the Market page's data, `ide/overview`), GETs under `/api/overview/` are forwarded the
same way and every other method there is refused (405): the overview reads public market data and changes
nothing, so nothing but a read reaches it.

With a market-import status file (the one `market follow` writes, mounted read-only), `/api/market-import`
answers it as it is, read at each request, with whether it is stale by `market.follow.check()`'s rule.
"""
from __future__ import annotations

from collections import OrderedDict
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import re
import secrets
import subprocess
import sys
import threading
import time
from urllib.parse import parse_qs, urlsplit

from . import layout
from .pinned import Pinned
from .renderers.web import render

CACHED = 8
HEARTBEAT = 15.0
AGENT = "/api/agent/"
AGENT_BODY = 16 * 1024 * 1024  # a chat request carries the whole thread, tool outputs included
AGENT_HEADERS = ("Content-Type", "Accept", "Sec-Fetch-Site", "Sec-Fetch-Mode")
PAPER = "/api/paper/"
PAPER_BODY = 64 * 1024
PAPER_TOKEN = "X-Trade-Paper-Token"
OVERVIEW = "/api/overview/"
TRIALS = 16
BARS = 16
SYMBOL = re.compile(r"[A-Z0-9]{2,30}")  # a Binance symbol such as BTCUSDT
DAY = re.compile(r"\d{4}-\d{2}-\d{2}")  # a UTC day
COMMIT = re.compile(r"[0-9a-v]{32}")  # a Dolt commit hash in full
STALE = timedelta(hours=26)  # market.follow.STALE: a status older than this is a stuck command


class ProductError(Exception):
    """A product command that refused (its refusal JSON) or did not answer."""

    def __init__(self, body: dict):
        super().__init__(body.get("message"))
        self.body = body


def _failure(code: str, message: str) -> dict:
    return {"code": code, "message": message}


def _days(start: str, end: str) -> bool:
    """Whether `start` and `end` are UTC days, `start` the earlier."""
    try:
        return bool(DAY.fullmatch(start) and DAY.fullmatch(end)) and date.fromisoformat(start) < date.fromisoformat(end)
    except ValueError:
        return False


@dataclass
class Product:
    """The product's command line on one ledger profile and a market profile (None: the active one)."""

    root: Path
    ledger: str
    market: str | None = None

    def run(self, *arguments: str) -> dict:
        argv = ["uv", "run", "--frozen", "--project", str(self.root), "python", "-m", "cli.main", *arguments]
        try:
            done = subprocess.run(argv, cwd=self.root, capture_output=True, text=True, timeout=600, check=False)
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise ProductError(_failure("PRODUCT_UNAVAILABLE", f"{' '.join(arguments[:2])}: {exc}")) from exc
        try:
            value = json.loads(done.stderr if done.returncode else done.stdout)
        except ValueError:
            value = None
        if done.returncode or not isinstance(value, dict):
            text = (done.stderr or done.stdout).strip()[-500:]
            raise ProductError(value if isinstance(value, dict) and "code" in value
                               else _failure("PRODUCT_FAILED", f"{' '.join(arguments[:2])}: {text}"))
        return value

    def commit(self, ref: str | None = None) -> str:
        """The full commit hash of `ref` (default: the research head)."""
        at = [f"--at={ref}"] if ref else []
        return self.run("ledger", "sql", f"--ledger={self.ledger}", *at, "SELECT 1")["ledger_commit"]

    def lines(self, commit: str) -> dict:
        return self.run("line", "list", f"--ledger={self.ledger}", f"--at={commit}")

    def graph(self, commit: str, line: str | None, since: str | None) -> dict:
        options = [f"--line={line}"] if line else []
        options += [f"--since={since}"] if since else []
        return self.run("research", "graph", f"--ledger={self.ledger}", f"--at={commit}", *options)

    def trial(self, trial_id: int, commit: str) -> dict:
        """A sealed trial's report with its drill-down tables, as the product gives or refuses it."""
        return self.run("replay", "report", f"--ledger={self.ledger}", f"--trial-id={trial_id}", f"--at={commit}", "--tables")

    def bars(self, symbol: str, start: str, end: str, commit: str) -> dict:
        """A contract's daily LAST bars from UTC day `start` to `end` (left out) at a market commit, all inline."""
        days = (date.fromisoformat(end) - date.fromisoformat(start)).days
        market = [f"--market={self.market}"] if self.market else []
        return self.run("market", "bars", *market, f"--at={commit}", f"--symbol={symbol}", "--timeframe=1d", "--price-type=LAST",
                        f"--start={start}T00:00:00Z", f"--end={end}T00:00:00Z", f"--limit={days}")


@dataclass(eq=False)
class Client:
    """One open page: its line, `since` and `at` (full hashes) and the latest state not yet sent."""

    line: str | None
    since: str | None
    at: str | None
    pending: dict | None = None
    sent: dict | None = None
    ready: threading.Event = field(default_factory=threading.Event)

    def take(self, timeout: float) -> dict | None:
        self.ready.wait(timeout)
        self.ready.clear()
        message, self.pending = self.pending, None
        return message


@dataclass(frozen=True)
class CompletedView:
    view: dict
    live: bool  # historical `at` renders must not replace a line's newest completed live graph


class Hub:
    """Heads, fetches, cached views and the open pages' states."""

    def __init__(self, product: Product, build: str, poll: float = 5.0):
        self.product, self.build, self.poll = product, build, poll
        self.line_index = Pinned[str](product.lines)
        self.trials = Pinned[tuple[int, str]](lambda key: product.trial(*key), TRIALS)
        self.bars = Pinned[tuple[str, str, str, str]](lambda key: product.bars(*key), BARS)
        self.lock = threading.Condition()
        self.refreshing = threading.Lock()
        self.head: str | None = None
        self.checked = 0.0
        self.fault: dict | None = None  # the last failed head read; cleared by a good one
        self.views: OrderedDict[tuple, CompletedView] = OrderedDict()  # completion order, not access order
        self.failed: dict[tuple, dict] = {}
        self.wanted: list[tuple[tuple, bool]] = []  # (key, pinned to an `at`), oldest first
        self.running: tuple | None = None
        self.clients: list[Client] = []

    def key(self, commit: str, line: str | None, since: str | None) -> tuple:
        return (self.product.ledger, self.build, commit, line, since)

    # States

    def _client_key(self, client: Client) -> tuple | None:
        commit = client.at or self.head
        return None if commit is None else self.key(commit, client.line, client.since)

    @staticmethod
    def _scope(key: tuple) -> tuple:
        return key[:2] + key[3:]  # ledger, build, line and since; only the commit may differ

    def _available(self, key: tuple | None, live: bool) -> tuple | None:
        if key in self.views:
            return key
        # An unnamed default can resolve to another line at the new head. Explicit `at` is exact.
        if not live or key is None or key[3] is None:
            return None
        return next((old for old in reversed(self.views)
                     if self.views[old].live and self._scope(old) == self._scope(key)), None)

    def _remember(self, key: tuple, view: dict, pinned: bool) -> None:
        self.views[key] = CompletedView(view, live=not pinned)
        self.views.move_to_end(key)
        if len(self.views) > CACHED:
            newest = {self._scope(old): old for old, cached in self.views.items() if cached.live}
            protected = set(newest.values())
            victim = next((old for old in self.views if old != key and old not in protected), next(iter(self.views)))
            del self.views[victim]

    def state(self, key: tuple | None, live: bool = True) -> dict:
        message = self._progress(key, live)
        available = self._available(key, live)
        if available is not None and available != key:
            message["available_commit"] = available[2]
        return message

    def _progress(self, key: tuple | None, live: bool) -> dict:
        """A page's state. A live page (no `at`) is also told, over the view it holds, of a failed refresh."""
        fault = self.fault
        commit = key[2] if key else None
        if live and fault is not None:
            return {"state": "error", "ledger_commit": commit, "error": fault}
        if key in self.views:
            return {"state": "ready", "ledger_commit": commit}
        if key in self.failed:
            return {"state": "error", "ledger_commit": commit, "error": self.failed[key]}
        if key is not None and key == self.running:
            return {"state": "computing", "ledger_commit": commit}
        if key is not None and any(key == wanted for wanted, _ in self.wanted):
            return {"state": "queued", "ledger_commit": commit}
        if fault is not None:
            return {"state": "error", "ledger_commit": commit, "error": fault}
        return {"state": "fetching", "ledger_commit": commit}

    def _notify(self) -> None:
        for client in self.clients:
            message = self.state(self._client_key(client), client.at is None)
            if message != client.sent:
                client.sent = client.pending = message
                client.ready.set()
        self.lock.notify_all()

    def _want(self, key: tuple, pinned: bool) -> None:
        if key not in self.views and key != self.running and all(key != wanted for wanted, _ in self.wanted):
            self.failed.pop(key, None)
            self.wanted.append((key, pinned))

    # The head

    def refresh(self, wait: bool = False) -> None:
        """Read the head and, when it moved, fetch every open live page's graph at it."""
        if not self.refreshing.acquire(blocking=wait):
            return
        try:
            try:
                head = self.product.commit()
                if head != self.head:
                    try:
                        self.line_index.get(head)
                    except ProductError:
                        pass  # navigation metadata has its own error path; it must not block a valid graph
            except ProductError as exc:
                with self.lock:
                    self.fault, self.checked = exc.body, time.monotonic()
                    self._notify()
                return
            with self.lock:
                moved, self.head, self.fault = head != self.head, head, None
                self.checked = time.monotonic()
                if moved:
                    pending, self.wanted = self.wanted, []
                    for key, pinned in pending:
                        self._want(key if pinned else self.key(head, key[3], key[4]), pinned)
                    for client in self.clients:
                        if client.at is None:
                            self._want(self.key(head, client.line, client.since), False)
                self._notify()
        finally:
            self.refreshing.release()

    def watch(self) -> None:
        """Refresh every `poll` seconds while a live page is open (at once when the first one opens)."""
        while True:
            with self.lock:
                while not any(client.at is None for client in self.clients):
                    self.lock.wait()
                due = self.checked + self.poll - time.monotonic()
            if due > 0:
                time.sleep(min(due, self.poll))
                continue
            self.refresh()

    # Fetching

    def work(self) -> None:
        """Fetch the oldest wanted graph, one at a time."""
        while True:
            with self.lock:
                while not self.wanted:
                    self.lock.wait()
                key, pinned = self.wanted.pop(0)
                self.running = key
                self._notify()
            view = failure = None
            try:
                view = layout.build_view(self.product.graph(key[2], key[3], key[4]))
            except ProductError as exc:
                failure = exc.body
            except Exception as exc:  # a graph the layout cannot read
                failure = _failure("GRAPH_UNREADABLE", f"{type(exc).__name__}: {exc}")
            with self.lock:
                self.running = None
                if view is not None:
                    self._remember(key, view, pinned)
                else:
                    self.failed[key] = failure or _failure("GRAPH_UNREADABLE", "no view")
                self._notify()

    # Pages

    def resolve(self, line: str | None, since: str | None, at: str | None) -> tuple[str | None, str | None]:
        """Full hashes for `since` and `at` (a ProductError for an unknown reference)."""
        return (self.product.commit(since) if since else None, self.product.commit(at) if at else None)

    def view(self, line: str | None, since: str | None, at: str | None) -> tuple[int, dict]:
        """(200, view), (202, state) after asking for it, or (503, failure) when there is no head. Only the
        first head is waited for; a stale one is refreshed in the background, and the page hears of a new head
        through its events."""
        if at is None and self.head is None:
            self.refresh(wait=True)
        elif at is None and time.monotonic() - self.checked > self.poll:
            threading.Thread(target=self.refresh, daemon=True).start()
        with self.lock:
            commit = at or self.head
            if commit is None:
                return 503, self.fault or _failure("LEDGER_UNAVAILABLE", "the head could not be read")
            key = self.key(commit, line, since)
            self._want(key, at is not None)
            self._notify()
            available = self._available(key, at is None)
            if available is not None:
                return 200, self.views[available].view
            return 202, self.state(key, at is None)

    def join(self, client: Client) -> None:
        with self.lock:
            self.clients.append(client)
            key = self._client_key(client)
            if key is not None:
                self._want(key, client.at is not None)
            client.sent = client.pending = self.state(key, client.at is None)
            client.ready.set()
            self._notify()

    def leave(self, client: Client) -> None:
        with self.lock:
            self.clients.remove(client)


def market_import(path: Path, now: datetime) -> tuple[int, dict]:
    """The market-import service's status file as it is, with the time it was read and whether its round is
    older than STALE; 503 when there is no file or it is not a status."""
    try:
        status = json.loads(path.read_text(encoding="utf-8"))
    except OSError as exc:
        return 503, _failure("MARKET_IMPORT_UNAVAILABLE", f"no status at {path}: {exc.strerror or exc}")
    except ValueError as exc:
        return 503, _failure("MARKET_IMPORT_UNREADABLE", f"{path}: {exc}")
    try:
        stale = now - datetime.fromisoformat(status["at"]) > STALE
    except (KeyError, TypeError, ValueError) as exc:
        return 503, _failure("MARKET_IMPORT_UNREADABLE", f"{path}: no round time ({type(exc).__name__}: {exc})")
    return 200, {"read_at": now.isoformat(), "stale": stale, "status": status}


def _page() -> bytes:
    page = render.built_page()
    return page.replace(render.PLACEHOLDER, "null").encode()


class Server(ThreadingHTTPServer):
    """The research graph service's HTTP server: a client that goes away mid-request (a closed page or reset connection) is
    not an error, so it prints no traceback."""

    daemon_threads = True

    def handle_error(self, request, client_address) -> None:
        if not isinstance(sys.exc_info()[1], ConnectionError):
            super().handle_error(request, client_address)


def handler(hub: Hub, hosts: frozenset[str], agent: str | None = None, paper: str | None = None,
            status: Path | None = None, overview: str | None = None) -> type[BaseHTTPRequestHandler]:
    token = secrets.token_urlsafe(24)
    page = _page()
    if paper:
        page = page.replace(b"</head>", f'<meta name="trade-paper-token" content="{token}">'.encode() + b"</head>", 1)
    # Each forwarded prefix: its service, the largest body it takes and the code of its absence.
    targets = {prefix: (urlsplit(url), limit, code) for prefix, url, limit, code in (
        (AGENT, agent, AGENT_BODY, "AGENT_UNAVAILABLE"), (PAPER, paper, PAPER_BODY, "PAPER_UNAVAILABLE"),
        (OVERVIEW, overview, 0, "OVERVIEW_UNAVAILABLE")) if url}

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def send(self, status: int, body: bytes, kind: str) -> None:
            self.send_response(status)
            self.send_header("Content-Type", kind)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(body)

        def json(self, status: int, value: dict) -> None:
            self.send(status, json.dumps(value, ensure_ascii=False).encode(), "application/json; charset=utf-8")

        def admitted(self) -> bool:
            # Another site must not make this browser fetch graphs: only this host, never cross-site.
            if self.headers.get("Host") not in hosts or self.headers.get("Sec-Fetch-Site") == "cross-site":
                self.refuse(403, _failure("FORBIDDEN", "requests come from the page itself"))
                return False
            return True

        def refuse(self, status: int, failure: dict) -> None:
            # A refused request's body is never read, so the connection cannot carry another request.
            self.close_connection = True
            self.json(status, failure)

        def forward(self, prefix: str) -> None:
            """The request to the service under `prefix` as it is, its answer streamed back until it ends."""
            if prefix not in targets:
                self.refuse(404, _failure("NOT_FOUND", urlsplit(self.path).path))
                return
            target, limit, absent = targets[prefix]
            if prefix == PAPER and self.command != "GET" and (
                    self.headers.get("Sec-Fetch-Site") != "same-origin"
                    or not secrets.compare_digest(self.headers.get(PAPER_TOKEN, ""), token)):
                self.refuse(403, _failure("FORBIDDEN", "paper runs start and stop from the page itself"))
                return
            length = int(self.headers.get("Content-Length") or 0)
            if length > limit:
                self.refuse(413, _failure("TOO_LARGE", f"{length} bytes"))
                return
            body = self.rfile.read(length) if length else None
            headers = {name: value for name in AGENT_HEADERS if (value := self.headers.get(name))}
            headers["Host"] = target.netloc
            upstream = http.client.HTTPConnection(target.hostname or "127.0.0.1", target.port, timeout=900)
            try:
                upstream.request(self.command, self.path, body=body, headers=headers)
                response = upstream.getresponse()
            except OSError as exc:
                upstream.close()
                self.json(502, _failure(absent, f"{target.netloc} did not answer: {exc}"))
                return
            try:
                self.send_response(response.status)
                for name in ("Content-Type", "Cache-Control", "X-Content-Type-Options", "X-Vercel-AI-UI-Message-Stream"):
                    if value := response.getheader(name):
                        self.send_header(name, value)
                self.send_header("Connection", "close")  # the body ends when the connection does
                self.end_headers()
                while chunk := response.read1(65536):
                    self.wfile.write(chunk)
                    self.wfile.flush()
            except OSError:
                pass  # the page went away (a stopped answer): closing upstream stops the chat service too
            finally:
                upstream.close()
                self.close_connection = True

        def do_POST(self) -> None:  # noqa: N802 (http.server's name)
            if not self.admitted():
                return
            if self.path.startswith(OVERVIEW) and OVERVIEW in targets:
                self.refuse(405, _failure("METHOD_NOT_ALLOWED", "the overview only answers GET"))
            elif prefix := next((p for p in (AGENT, PAPER) if self.path.startswith(p)), None):
                self.forward(prefix)
            else:
                self.refuse(404, _failure("NOT_FOUND", self.path))

        do_PUT = do_PATCH = do_DELETE = do_POST  # noqa: N815 (http.server's names)

        def do_GET(self) -> None:  # noqa: N802 (http.server's name)
            if not self.admitted():
                return
            if prefix := next((p for p in (AGENT, PAPER, OVERVIEW) if self.path.startswith(p)), None):
                self.forward(prefix)
                return
            url = urlsplit(self.path)
            query = {name: values[0] for name, values in parse_qs(url.query).items() if values and values[0]}
            if url.path == "/":
                self.send(200, page, "text/html; charset=utf-8")
                return
            if url.path == "/api/trial":
                self.trial(query)
                return
            if url.path == "/api/bars":
                self.bars(query)
                return
            if url.path == "/api/market-import" and status is not None:
                self.json(*market_import(status, datetime.now(UTC)))
                return
            if url.path not in ("/api/view", "/api/events", "/api/lines"):
                self.json(404, _failure("NOT_FOUND", url.path))
                return
            line = query.get("line")
            try:
                since, at = hub.resolve(line, query.get("since"), query.get("at"))
                if url.path == "/api/lines":
                    with hub.lock:
                        commit = at or hub.head
                    self.json(200, hub.line_index.get(commit or hub.product.commit()))
                    return
            except ProductError as exc:
                self.json(400, exc.body)
                return
            if url.path == "/api/view":
                self.json(*hub.view(line, since, at))
                return
            self.events(Client(line, since, at))

        def trial(self, query: dict[str, str]) -> None:
            """A trial's report at a full ledger commit (immutable, so kept), or the product's refusal."""
            trial_id, at = query.get("trial_id", ""), query.get("at", "")
            if not trial_id.isdigit() or not COMMIT.fullmatch(at):
                self.json(400, _failure("BAD_REQUEST", "give trial_id and at, a full ledger commit"))
                return
            try:
                self.json(200, hub.trials.get((int(trial_id), at)))
            except ProductError as exc:
                self.json(400, exc.body)

        def bars(self, query: dict[str, str]) -> None:
            """A contract's daily bars over whole UTC days at a full market commit (kept), or the product's refusal."""
            symbol, start, end, at = (query.get(name, "") for name in ("symbol", "start", "end", "at"))
            if query.get("timeframe") != "1d" or not SYMBOL.fullmatch(symbol) or not COMMIT.fullmatch(at) or not _days(start, end):
                self.json(400, _failure("BAD_REQUEST", "give symbol, timeframe=1d, start and end (UTC days, start first) and at, a full market commit"))
                return
            try:
                self.json(200, hub.bars.get((symbol, start, end, at)))
            except ProductError as exc:
                self.json(400, exc.body)

        def events(self, client: Client) -> None:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            hub.join(client)
            try:
                while True:
                    message = client.take(HEARTBEAT)
                    data = f"data: {json.dumps(message)}\n\n" if message else ": heartbeat\n\n"
                    self.wfile.write(data.encode())
                    self.wfile.flush()
            except OSError:
                pass  # the page went away
            finally:
                hub.leave(client)
                self.close_connection = True

        def log_request(self, code="-", size="-") -> None:
            if int(code) >= 400:  # the page polls; only a failed request is news
                super().log_request(code, size)

        def log_message(self, format: str, *args) -> None:  # noqa: A002 (http.server's name)
            sys.stderr.write(f"{self.log_date_time_string()} {format % args}\n")

    return Handler


def serve(product: Product, build: str, host: str, port: int, hosts: list[str], poll: float,
          agent: str | None = None, paper: str | None = None, status: Path | None = None, overview: str | None = None) -> None:
    hub = Hub(product, build, poll)
    server = Server((host, port), handler(hub, frozenset(hosts or [f"127.0.0.1:{port}", f"localhost:{port}"]), agent, paper,
                                          status, overview))
    for target in (hub.watch, hub.work):
        threading.Thread(target=target, daemon=True).start()
    print(f"research graph of {product.ledger} at http://127.0.0.1:{port}/", file=sys.stderr, flush=True)
    server.serve_forever()
