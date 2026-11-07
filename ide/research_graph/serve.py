"""`ide.py serve`: one ledger's research graph as a page that follows the ledger (standard library only).

The page is the web renderer's built page: it reads `/api/view` and follows
`/api/events` (Server-Sent Events). The product is reached only through its command line, `ledger
sql` for a head, `research graph` for a graph without its comparisons, `research comparison` for the one a page
opens (`/api/comparison`, at a full ledger commit), `replay report --tables` for a trial's report (the Runs
page's backtest, `/api/trial`, at a full ledger commit) and `market bars --timeframe 1d` for a contract's
daily bars (its backtest candles, `/api/bars`, whole UTC days at a full market commit, on the market
profile given or the active one), so this module imports no product package. While
a page without `at` is open the head is read every `poll` seconds; when it moves, each open page's
graph is fetched once at the new head, the latest only. One fetch runs at a time. Up to 8 successful views stay in memory, keyed
by ledger, build, commit, line and `since`, retaining a scope's newest live completion before its
older duplicates. A named live page can show that completion while a newer head is still drawing,
and when `research unchanged` says the new head gives that line the same graph, it is kept under the new commit
instead of being drawn. A page may also name the graph its browser kept (`have`, with the `build` that drew it), and
is then told `unchanged` instead of having one drawn; every other answer goes the same way as without it.
Up to 16 trials' reports, 64 versions' comparisons and 16 contracts' daily bars stay in memory, keyed by what they were read for.
Nothing is written anywhere.

With an agent URL (the trade IDE's chat service, `ide/agent`), requests under `/api/agent/`
pass the same Host and cross-site checks and are then forwarded to it as they are, the answer
streamed back as it arrives; without one those paths do not exist and the page shows no agent.

With a paper URL (the paper daemon, `python -m cli.main paper serve`), requests under `/api/paper/` are
forwarded the same way, and the Runs page can start and stop paper runs. A POST there must also come
from the page itself (`Sec-Fetch-Site: same-origin`) and carry the token this service generated at start
and put in the page (`X-Trade-Paper-Token`), so a page on another port of this host cannot start a run.

With a setup URL (`ledger service run --setup`, open only until the deployment's first start is done), requests
under `/api/setup/` are forwarded with the same checks as a paper action, the token included: this container holds
no key and writes nothing, and it passes on what the page asks for.

With an overview URL (the Market page's data, `ide/overview`), GETs under `/api/overview/` are forwarded the
same way and every other method there is refused (405): the overview reads public market data and changes
nothing, so nothing but a read reaches it.

With a market-import status file (the one `market follow` writes, mounted read-only), `/api/market-import`
answers it as it is, read at each request, with whether it is stale by `market.follow.check()`'s rule.

An answer goes gzipped to a browser that takes it: every JSON answer of at least 1 KB, and what the paper
and overview services send, streams included. The page alone may be kept: it carries an ETag and is asked
for again at each open, so an unchanged page costs a 304. Everything else stays `no-store`.
"""
from __future__ import annotations

from collections import OrderedDict
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
import gzip
import hashlib
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
import zlib

from . import layout
from .pinned import Pinned
from . import render

CACHED = 8
HEARTBEAT = 15.0
AGENT = "/api/agent/"
AGENT_BODY = 16 * 1024 * 1024  # a chat request carries the whole thread, tool outputs included
AGENT_HEADERS = ("Content-Type", "Accept", "Sec-Fetch-Site", "Sec-Fetch-Mode")
PAPER = "/api/paper/"
RESEARCH = "/api/research/"
PAPER_BODY = 64 * 1024
GZIP_FROM = 1024  # below this an answer gains little from compressing
PAPER_TOKEN = "X-Trade-Paper-Token"
OVERVIEW = "/api/overview/"
SETUP = "/api/setup/"
TRIALS = 16
BARS = 16
COMPARISONS = 64
BUNDLE = re.compile(r"[A-Za-z0-9._@-]{1,200}")  # a registration bundle
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

    def service(self) -> dict:
        return self.run("ledger", "service", "status", f"--ledger={self.ledger}")

    def lines(self, commit: str) -> dict:
        return self.run("line", "list", f"--ledger={self.ledger}", f"--at={commit}")

    def graph(self, commit: str, line: str | None, since: str | None) -> dict:
        options = [f"--line={line}"] if line else []
        options += [f"--since={since}"] if since else []
        return self.run("research", "graph", f"--ledger={self.ledger}", f"--at={commit}", "--without-comparisons", *options)

    def comparison(self, bundle: str, trial_id: int, commit: str) -> dict:
        """One version's comparison, computed when the page opens it: the graph above leaves it out."""
        return self.run("research", "comparison", f"--ledger={self.ledger}", f"--bundle={bundle}",
                        f"--trial-id={trial_id}", f"--at={commit}")

    def unchanged(self, line: str, since: str, commit: str) -> dict:
        return self.run("research", "unchanged", f"--ledger={self.ledger}", f"--line={line}", f"--since={since}", f"--at={commit}")

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
    """One open page: its line, `since` and `at` (full hashes), the commit of the graph its browser kept (when this
    build drew it) and the latest state not yet sent."""

    line: str | None
    since: str | None
    at: str | None
    have: str | None = None
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
        self.comparisons = Pinned[tuple[str, int, str]](lambda key: product.comparison(*key), COMPARISONS)
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
        self.checks: list[tuple[tuple, str]] = []  # (key, the commit a browser kept), oldest first
        self.checking: tuple[tuple, str] | None = None
        self.same: dict[tuple[tuple, str], bool] = {}  # their answers at the head; a new head forgets them

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

    def state(self, key: tuple | None, live: bool = True, have: str | None = None) -> dict:
        message = self._progress(key, live, have)
        available = self._available(key, live)
        if available is not None and available != key:
            message["available_commit"] = available[2]
        return message

    def _progress(self, key: tuple | None, live: bool, have: str | None = None) -> dict:
        """A page's state. A live page (no `at`) is also told, over the view it holds, of a failed refresh."""
        fault = self.fault
        commit = key[2] if key else None
        if live and fault is not None:
            return {"state": "error", "ledger_commit": commit, "error": fault}
        if key in self.views:
            return {"state": "ready", "ledger_commit": commit}
        if key in self.failed:
            return {"state": "error", "ledger_commit": commit, "error": self.failed[key]}
        if have is not None and key is not None and self.same.get((key, have)):
            return {"state": "unchanged", "ledger_commit": commit}
        if key is not None and key == self.running:
            return {"state": "computing", "ledger_commit": commit}
        if key is not None and any(key == wanted for wanted, _ in self.wanted):
            return {"state": "queued", "ledger_commit": commit}
        if fault is not None:
            return {"state": "error", "ledger_commit": commit, "error": fault}
        return {"state": "fetching", "ledger_commit": commit}

    def _notify(self) -> None:
        for client in self.clients:
            message = self.state(self._client_key(client), client.at is None, client.have)
            if message != client.sent:
                client.sent = client.pending = message
                client.ready.set()
        self.lock.notify_all()

    def _want(self, key: tuple, pinned: bool) -> None:
        if key not in self.views and key != self.running and all(key != wanted for wanted, _ in self.wanted):
            self.failed.pop(key, None)
            self.wanted.append((key, pinned))

    def _want_for(self, key: tuple, pinned: bool, have: str | None) -> None:
        """Draw `key`, unless the graph a browser kept may be the same: that is asked first and spares the draw."""
        if have is None or pinned or key in self.views:
            self._want(key, pinned)
        elif (key, have) in self.same:
            if not self.same[key, have]:
                self._want(key, pinned)
        elif (key, have) != self.checking and (key, have) not in self.checks:
            self.checks.append((key, have))

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
                    self.same.clear()
                    self.checks.clear()
                    pending, self.wanted = self.wanted, []
                    for key, pinned in pending:
                        self._want(key if pinned else self.key(head, key[3], key[4]), pinned)
                    for client in self.clients:
                        if client.at is None:
                            self._want_for(self.key(head, client.line, client.since), False, client.have)
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

    def _unchanged(self, line: str, since: str, commit: str) -> bool:
        """Whether the graph of `line` is the same at `commit` as at `since`. A refusal answers no: the draw then meets
        it and it reaches the page like any other."""
        try:
            return self.product.unchanged(line, since, commit).get("unchanged") is True
        except ProductError:
            return False

    def _reused(self, key: tuple) -> dict | None:
        """The live view this scope already has, stamped `key`'s commit, when it would draw the same."""
        with self.lock:
            older = None if key[3] is None or key[4] is not None else self._available(key, True)
            found = None if older is None else self.views[older].view
        scope = None if found is None else found.get("scope")
        if (found is None or not scope or not scope.get("ledger_commit") or scope.get("market_unread")
                or not self._unchanged(key[3], scope["ledger_commit"], key[2])):
            return None
        return {**found, "scope": {**scope, "ledger_commit": key[2], "drawn_commit": scope.get("drawn_commit") or scope["ledger_commit"]}}

    def confirm(self) -> None:
        """Answer the oldest question about a graph a browser kept, one at a time and never behind a draw."""
        while True:
            with self.lock:
                while not self.checks:
                    self.lock.wait()
                self.checking = self.checks.pop(0)
                key, have = self.checking
            same = self._unchanged(key[3], have, key[2])
            with self.lock:
                self.checking = None
                if key[2] == self.head:
                    self.same[key, have] = same
                    if not same:
                        self._want(key, False)
                self._notify()

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
                view = None if pinned else self._reused(key)
                if view is None:
                    view = layout.build_view(self.product.graph(key[2], key[3], key[4]))
                    view["scope"] = {**(view["scope"] or {}), "build": self.build}  # what a page's kept view and answers are good for
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

    def resolve(self, since: str | None, at: str | None) -> tuple[str | None, str | None]:
        """Full hashes for `since` and `at` (a ProductError for an unknown reference)."""
        return (self.product.commit(since) if since else None, self.product.commit(at) if at else None)

    def view(self, line: str | None, since: str | None, at: str | None, have: str | None = None) -> tuple[int, dict]:
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
            self._want_for(key, at is not None, have)
            self._notify()
            available = self._available(key, at is None)
            if available is not None:
                return 200, self.views[available].view
            return 202, self.state(key, at is None, have)

    def join(self, client: Client) -> None:
        with self.lock:
            self.clients.append(client)
            key = self._client_key(client)
            if key is not None:
                self._want_for(key, client.at is not None, client.have)
            client.sent = client.pending = self.state(key, client.at is None, client.have)
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
    return render.built_page().encode()


def _takes_gzip(accepted: str | None) -> bool:
    """Whether an Accept-Encoding header allows gzip (`gzip;q=0` refuses it)."""
    for item in (accepted or "").split(","):
        name, _, weight = item.partition(";")
        if name.strip().lower() == "gzip":
            return weight.strip().lower() not in ("q=0", "q=0.0", "q=0.00", "q=0.000")
    return False


class Server(ThreadingHTTPServer):
    """The research graph service's HTTP server: a client that goes away mid-request (a closed page or reset connection) is
    not an error, so it prints no traceback."""

    daemon_threads = True

    def handle_error(self, request, client_address) -> None:
        if not isinstance(sys.exc_info()[1], ConnectionError):
            super().handle_error(request, client_address)


def handler(hub: Hub, hosts: frozenset[str], agent: str | None = None, paper: str | None = None,
            status: Path | None = None, overview: str | None = None,
            research: str | None = None, setup: str | None = None) -> type[BaseHTTPRequestHandler]:
    token = secrets.token_urlsafe(24)
    page = _page()
    if paper or research or setup:
        page = page.replace(b"</head>", f'<meta name="trade-paper-token" content="{token}">'.encode() + b"</head>", 1)
    if research:
        page = page.replace(b"</head>", b'<meta name="trade-research-sync" content="enabled"></head>', 1)
    zipped_page = gzip.compress(page, 6, mtime=0)
    page_tag = f'"{hashlib.sha256(page).hexdigest()[:32]}'
    # Each forwarded prefix: its service, the largest body it takes and the code of its absence.
    targets = {prefix: (urlsplit(url), limit, code) for prefix, url, limit, code in (
        (AGENT, agent, AGENT_BODY, "AGENT_UNAVAILABLE"), (PAPER, paper, PAPER_BODY, "PAPER_UNAVAILABLE"),
        (OVERVIEW, overview, 0, "OVERVIEW_UNAVAILABLE"),
        (RESEARCH, research, 0, "RESEARCH_UNAVAILABLE"), (SETUP, setup, PAPER_BODY, "SETUP_UNAVAILABLE")) if url}

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def takes_gzip(self) -> bool:
            return _takes_gzip(self.headers.get("Accept-Encoding"))

        def show_page(self) -> None:
            """The page, or a 304 when the browser already holds this one. It is private because it carries the token."""
            zipped = self.takes_gzip()
            tag = page_tag + ('-gzip"' if zipped else '"')
            held = (item.strip().removeprefix("W/") for item in self.headers.get("If-None-Match", "").split(","))
            fresh = tag in held
            self.send_response(304 if fresh else 200)
            self.send_header("ETag", tag)
            self.send_header("Cache-Control", "private, no-cache")
            self.send_header("Vary", "Accept-Encoding")
            self.send_header("X-Content-Type-Options", "nosniff")
            if fresh:
                self.end_headers()
                return
            body = zipped_page if zipped else page
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            if zipped:
                self.send_header("Content-Encoding", "gzip")
            self.end_headers()
            self.wfile.write(body)

        def send(self, status: int, body: bytes, kind: str, renew: bool = False) -> None:
            self.send_response(status)
            self.send_header("Content-Type", kind)
            if len(body) >= GZIP_FROM:
                self.send_header("Vary", "Accept-Encoding")
                if self.takes_gzip():
                    body = gzip.compress(body, 6, mtime=0)
                    self.send_header("Content-Encoding", "gzip")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            if renew:
                self.send_header(PAPER_TOKEN, token)
            self.end_headers()
            self.wfile.write(body)

        def json(self, status: int, value: dict, renew: bool = False) -> None:
            self.send(status, json.dumps(value, ensure_ascii=False).encode(), "application/json; charset=utf-8", renew)

        def admitted(self) -> bool:
            # An OAuth callback or external link may navigate to the page shell. Graphs,
            # subresources and actions still cannot be fetched cross-site.
            navigation = (self.command == "GET" and urlsplit(self.path).path == "/"
                          and self.headers.get("Sec-Fetch-Mode") == "navigate"
                          and self.headers.get("Sec-Fetch-Dest") == "document")
            if self.headers.get("Host") not in hosts or (
                    self.headers.get("Sec-Fetch-Site") == "cross-site" and not navigation):
                self.refuse(403, _failure("FORBIDDEN", "requests come from the page itself"))
                return False
            return True

        def refuse(self, status: int, failure: dict, renew: bool = False) -> None:
            # A refused request's body is never read, so the connection cannot carry another request.
            self.close_connection = True
            self.json(status, failure, renew)

        def forward(self, prefix: str) -> None:
            """The request to the service under `prefix` as it is, its answer streamed back until it ends."""
            if prefix not in targets:
                self.refuse(404, _failure("NOT_FOUND", urlsplit(self.path).path))
                return
            target, limit, absent = targets[prefix]
            if prefix in (PAPER, RESEARCH, SETUP) and self.command != "GET" and (
                    self.headers.get("Sec-Fetch-Site") != "same-origin"
                    or not secrets.compare_digest(self.headers.get(PAPER_TOKEN, ""), token)):
                # A same-origin page may still hold the previous release's nonce. Only this
                # pre-forward rejection can renew it; upstream refusals must never be retried.
                self.refuse(403, _failure("FORBIDDEN", "actions come from the page itself"),
                            renew=self.headers.get("Sec-Fetch-Site") == "same-origin")
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
                # The chat's answer is left as it is; each chunk of the rest is flushed so a stream still arrives as it goes.
                kind = (response.getheader("Content-Type") or "").split(";")[0].strip()
                zipper = None
                if prefix != AGENT and kind in ("application/json", "text/event-stream") and self.takes_gzip():
                    zipper = zlib.compressobj(6, wbits=31)
                    self.send_header("Content-Encoding", "gzip")
                    self.send_header("Vary", "Accept-Encoding")
                self.end_headers()
                while chunk := response.read1(65536):
                    self.wfile.write(zipper.compress(chunk) + zipper.flush(zlib.Z_SYNC_FLUSH) if zipper else chunk)
                    self.wfile.flush()
                if zipper:
                    self.wfile.write(zipper.flush())
            except OSError:
                pass  # the page went away (a stopped answer): closing upstream stops the chat service too
            finally:
                upstream.close()
                self.close_connection = True

        def do_POST(self) -> None:
            if not self.admitted():
                return
            if self.path.startswith(OVERVIEW) and OVERVIEW in targets:
                self.refuse(405, _failure("METHOD_NOT_ALLOWED", "the overview only answers GET"))
            elif prefix := next((p for p in (AGENT, PAPER, RESEARCH, SETUP) if self.path.startswith(p)), None):
                self.forward(prefix)
            else:
                self.refuse(404, _failure("NOT_FOUND", self.path))

        do_PUT = do_PATCH = do_DELETE = do_POST

        def do_GET(self) -> None:
            if not self.admitted():
                return
            if prefix := next((p for p in (AGENT, PAPER, OVERVIEW, RESEARCH, SETUP) if self.path.startswith(p)), None):
                self.forward(prefix)
                return
            url = urlsplit(self.path)
            query = {name: values[0] for name, values in parse_qs(url.query).items() if values and values[0]}
            if url.path == "/":
                self.show_page()
                return
            if url.path == "/api/trial":
                self.trial(query)
                return
            if url.path == "/api/comparison":
                self.comparison(query)
                return
            if url.path == "/api/bars":
                self.bars(query)
                return
            if url.path == "/api/about":
                self.about()
                return
            if url.path == "/api/market-import" and status is not None:
                self.json(*market_import(status, datetime.now(UTC)))
                return
            if url.path not in ("/api/view", "/api/events", "/api/lines"):
                self.json(404, _failure("NOT_FOUND", url.path))
                return
            line = query.get("line")
            # A kept graph counts only as this build drew it, on a page that follows one named line's head.
            kept = query.get("have", "")
            have = kept if COMMIT.fullmatch(kept) and query.get("build") == hub.build and line and not {"since", "at"} & query.keys() else None
            try:
                since, at = hub.resolve(query.get("since"), query.get("at"))
                if url.path == "/api/lines":
                    with hub.lock:
                        commit = at or hub.head
                    self.json(200, hub.line_index.get(commit or hub.product.commit()))
                    return
            except ProductError as exc:
                self.json(400, exc.body)
                return
            if url.path == "/api/view":
                self.json(*hub.view(line, since, at, have))
                return
            self.events(Client(line, since, at, have))

        def about(self) -> None:
            """What this deployment runs: the page's build and the ledger's state, or the refusal reading it."""
            try:
                found = hub.product.service()
            except ProductError as exc:
                self.json(200, {"build": hub.build, "ledger": None, "refusal": exc.body})
                return
            self.json(200, {"build": hub.build, "ledger": {"running": found["running"], "remote": found.get("remote"),
                                                           "unpublished": bool(found.get("unpublished")),
                                                           "commit": found.get("ledger_commit")}})

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

        def comparison(self, query: dict[str, str]) -> None:
            """A version's comparison at a full ledger commit (immutable, so kept), or the product's refusal."""
            bundle, trial_id, at = query.get("bundle", ""), query.get("trial_id", ""), query.get("at", "")
            if not BUNDLE.fullmatch(bundle) or not trial_id.isdigit() or not COMMIT.fullmatch(at):
                self.json(400, _failure("BAD_REQUEST", "give bundle, trial_id and at, a full ledger commit"))
                return
            try:
                self.json(200, hub.comparisons.get((bundle, int(trial_id), at)))
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

        def log_message(self, format: str, *args) -> None:
            sys.stderr.write(f"{self.log_date_time_string()} {format % args}\n")

    return Handler


def serve(product: Product, build: str, host: str, port: int, hosts: list[str],
          agent: str | None = None, paper: str | None = None, status: Path | None = None,
          overview: str | None = None, research: str | None = None, setup: str | None = None) -> None:
    hub = Hub(product, build)
    server = Server((host, port), handler(hub, frozenset(hosts or [f"127.0.0.1:{port}", f"localhost:{port}"]), agent, paper,
                                          status, overview, research, setup))
    for target in (hub.watch, hub.work, hub.confirm):
        threading.Thread(target=target, daemon=True).start()
    print(f"research graph of {product.ledger} at http://127.0.0.1:{port}/", file=sys.stderr, flush=True)
    server.serve_forever()
