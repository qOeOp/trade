"""`ide.py serve`: one ledger's research graph as a page that follows the ledger (standard library only).

The page is the web renderer's built page without a view: it reads `/api/view` and follows
`/api/events` (Server-Sent Events). The product is reached only through its command line, `ledger
sql` for a head and `research graph` for a graph, so this module imports no product package. While
a page without `at` is open the head is read every `poll` seconds, after an optional pull command
that fast-forwards a read-only copy; when it moves, each open page's graph is fetched once at the new
head, the latest only. One fetch runs at a time. Successful views stay in memory (the last 8), keyed
by ledger, build, commit, line and `since`; nothing is written anywhere.

The pull command is called as `PULL ledger` before every head read and `PULL market` before the first
fetch at a new head; exit status 3 means the remote's history no longer descends from the copy, and
the service stops pulling and reports it rather than reset anything.
"""
from __future__ import annotations

from collections import OrderedDict
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import subprocess
import sys
import threading
import time
from urllib.parse import parse_qs, urlsplit

from . import layout
from .renderers.web import render

CACHED = 8
HEARTBEAT = 15.0
REWRITTEN = 3  # the pull command's exit status for a remote whose history was rewritten


class ProductError(Exception):
    """A product command that refused (its refusal JSON) or did not answer."""

    def __init__(self, body: dict):
        super().__init__(body.get("message"))
        self.body = body


def _failure(code: str, message: str) -> dict:
    return {"code": code, "message": message}


@dataclass
class Product:
    """The product's command line on one ledger profile."""

    root: Path
    ledger: str

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

    def graph(self, commit: str, line: str | None, since: str | None) -> dict:
        options = [f"--line={line}"] if line else []
        options += [f"--since={since}"] if since else []
        return self.run("research", "graph", f"--ledger={self.ledger}", f"--at={commit}", *options)


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


class Hub:
    """Heads, fetches, cached views and the open pages' states."""

    def __init__(self, product: Product, build: str, pull: str | None = None, poll: float = 5.0):
        self.product, self.build, self.pull, self.poll = product, build, pull, poll
        self.lock = threading.Condition()
        self.refreshing = threading.Lock()
        self.head: str | None = None
        self.checked = 0.0
        self.fault: dict | None = None  # the last failed pull or head read; cleared by a good one
        self.rewritten: dict | None = None  # set once; pulling stops
        self.views: OrderedDict[tuple, dict] = OrderedDict()
        self.failed: dict[tuple, dict] = {}
        self.wanted: list[tuple[tuple, bool]] = []  # (key, pinned to an `at`), oldest first
        self.running: tuple | None = None
        self.clients: list[Client] = []

    def key(self, commit: str, line: str | None, since: str | None) -> tuple:
        return (self.product.ledger, self.build, commit, line or "current", since)

    # States

    def _client_key(self, client: Client) -> tuple | None:
        commit = client.at or self.head
        return None if commit is None else self.key(commit, client.line, client.since)

    def state(self, key: tuple | None, live: bool = True) -> dict:
        """A page's state; a live page (no `at`) is told when its copy no longer follows the public one."""
        fault = self.rewritten or self.fault
        commit = key[2] if key else None
        if live and self.rewritten is not None:
            return {"state": "error", "ledger_commit": commit, "error": self.rewritten}
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

    def _pull(self, what: str) -> None:
        if self.pull is None or self.rewritten is not None:
            return
        try:
            done = subprocess.run([self.pull, what], capture_output=True, text=True, timeout=1800, check=False)
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise ProductError(_failure("PULL_FAILED", f"pulling the {what}: {exc}")) from exc
        text = (done.stderr or done.stdout).strip()[-500:]
        if done.returncode == REWRITTEN:
            with self.lock:
                self.rewritten = _failure("REMOTE_REWRITTEN", f"the {what}'s public copy no longer descends from this "
                                          f"copy; nothing is pulled until it is recreated: {text}")
            raise ProductError(self.rewritten)
        if done.returncode:
            raise ProductError(_failure("PULL_FAILED", f"pulling the {what}: {text}"))

    def refresh(self, wait: bool = False) -> None:
        """Pull, read the head and, when it moved, fetch every open live page's graph at it."""
        if not self.refreshing.acquire(blocking=wait):
            return
        try:
            with self.lock:
                if self.rewritten is not None:  # the copy no longer follows its public copy
                    self.fault = self.rewritten
                    self._notify()
                    return
            try:
                self._pull("ledger")
                head = self.product.commit()
                if head != self.head and self.head is not None:
                    self._pull("market")  # the new head's lines may name a market commit not pulled yet
            except ProductError as exc:
                with self.lock:
                    self.fault, self.checked = exc.body, time.monotonic()
                    self._notify()
                return
            with self.lock:
                moved, self.head, self.fault = head != self.head, head, None
                self.checked = time.monotonic()
                if moved:
                    self.wanted = [(key, pinned) for key, pinned in self.wanted if pinned]
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
                key, _ = self.wanted.pop(0)
                self.running = key
                self._notify()
            view = failure = None
            try:
                view = layout.build_view(self.product.graph(key[2], None if key[3] == "current" else key[3], key[4]))
            except ProductError as exc:
                failure = exc.body
            except Exception as exc:  # a graph the layout cannot read
                failure = _failure("GRAPH_UNREADABLE", f"{type(exc).__name__}: {exc}")
            with self.lock:
                self.running = None
                if view is not None:
                    self.views[key] = view
                    self.views.move_to_end(key)
                    while len(self.views) > CACHED:
                        self.views.popitem(last=False)
                else:
                    self.failed[key] = failure or _failure("GRAPH_UNREADABLE", "no view")
                self._notify()

    # Pages

    def resolve(self, line: str | None, since: str | None, at: str | None) -> tuple[str | None, str | None]:
        """Full hashes for `since` and `at` (a ProductError for an unknown reference)."""
        return (self.product.commit(since) if since else None, self.product.commit(at) if at else None)

    def view(self, line: str | None, since: str | None, at: str | None) -> tuple[int, dict]:
        """(200, view), (202, state) after asking for it, or (503, failure) when there is no head or the
        copy no longer follows its public copy."""
        if at is None and (self.head is None or time.monotonic() - self.checked > self.poll):
            self.refresh(wait=True)
        with self.lock:
            if at is None and self.rewritten is not None:
                return 503, self.rewritten
            commit = at or self.head
            if commit is None:
                return 503, self.fault or _failure("LEDGER_UNAVAILABLE", "the head could not be read")
            key = self.key(commit, line, since)
            if key in self.views:
                self.views.move_to_end(key)
                return 200, self.views[key]
            self._want(key, at is not None)
            self._notify()
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


def _page() -> bytes:
    page = render.built_page()
    return page.replace(render.PLACEHOLDER, "null").encode()


def handler(hub: Hub, hosts: frozenset[str]) -> type[BaseHTTPRequestHandler]:
    page = _page()

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

        def do_GET(self) -> None:  # noqa: N802 (http.server's name)
            # Another site must not make this browser fetch graphs: only this host, never cross-site.
            if self.headers.get("Host") not in hosts or self.headers.get("Sec-Fetch-Site") == "cross-site":
                self.json(403, _failure("FORBIDDEN", "requests come from the page itself"))
                return
            url = urlsplit(self.path)
            query = {name: values[0] for name, values in parse_qs(url.query).items() if values and values[0]}
            if url.path == "/":
                self.send(200, page, "text/html; charset=utf-8")
                return
            if url.path not in ("/api/view", "/api/events"):
                self.json(404, _failure("NOT_FOUND", url.path))
                return
            line = query.get("line")
            try:
                since, at = hub.resolve(line, query.get("since"), query.get("at"))
            except ProductError as exc:
                self.json(400, exc.body)
                return
            if url.path == "/api/view":
                self.json(*hub.view(line, since, at))
                return
            self.events(Client(line, since, at))

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

        def log_message(self, format: str, *args) -> None:  # noqa: A002 (http.server's name)
            sys.stderr.write(f"{self.log_date_time_string()} {format % args}\n")

    return Handler


def serve(product: Product, build: str, host: str, port: int, hosts: list[str], pull: str | None,
          poll: float) -> None:
    hub = Hub(product, build, pull, poll)
    server = ThreadingHTTPServer((host, port), handler(hub, frozenset(hosts or [f"127.0.0.1:{port}", f"localhost:{port}"])))
    server.daemon_threads = True
    for target in (hub.watch, hub.work):
        threading.Thread(target=target, daemon=True).start()
    print(f"research graph of {product.ledger} at http://127.0.0.1:{port}/", file=sys.stderr, flush=True)
    server.serve_forever()
