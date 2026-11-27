"""`ide.py serve`: one ledger's research graph as a page that follows the ledger (standard library only).

The page is the web renderer's built page: it reads `/api/view` and follows
`/api/events` (Server-Sent Events). The product is reached only through its command line, `ledger
sql` for a head, `research graph` for a graph without its comparisons, `research comparison` for the one a page
opens (`/api/comparison`, at a full ledger commit), `research state --without-image` for the line menu's gates and
review readings (`/api/state`, at a full ledger commit), `replay report --tables` for a trial's report (the Runs
page's backtest, `/api/trial`, at a full ledger commit) and `market bars --timeframe 1d` for a contract's
daily bars (its backtest candles, `/api/bars`, whole UTC days at a market day, YYYY-MM-DD, on the market
profile given or the active one), and `market coverage` for the contracts the market directory holds bars of
(`/api/market/local`), so this module imports no product package. Product processes start only while
the container's memory has room for their peak (`HEAVY` for a read of research data, `LIGHT` for a ledger head, status
or line list), so a page's burst of reads fits it and further reads wait their turn; the kernel kills a product process
before this server or the overview, and such a read is answered `OUT_OF_MEMORY`, which a page may ask again. While
a page without `at` is open the head is read every `poll` seconds (a research mirror's from its controller, the
only place a Sync moves it, so no product process runs per read); when it moves, each open page's
graph is fetched once at the new head, the latest only. Graphs are asked for in one queue, oldest first: one draw
runs at a time, and a question about a kept graph never waits behind it. A graph is spared its draw when `research
unchanged` says a named line's graph drawn at another commit is the same at the new one: the live graph this server
holds of the line (kept under the new commit), or the one a page's browser kept (`have`, with the `build` that drew
it; the page is then told `unchanged`). Every other answer goes the same way as without them. Up to 8 successful views
stay in memory, keyed by commit, line and `since`, retaining a scope's newest live completion before its older
duplicates, so a named live page can show it while a newer head is still drawing.
Every other product read (a trial's report, a version's comparison, a line's state, counts or multiple-testing reading, the line index,
`research history` for `/api/history`, the lines with their recommendations for `/api/readings`, a contract's daily
bars, the market directory's contracts, read once per UTC day) is kept by what it was read for in one cache of at most `KEPT` bytes of JSON, least recently used dropped first,
and the ledger's state `/api/about` gives (`ledger service status`) for the head for up to `STATUS_SECONDS`.
A head whose history does not continue the one read before (the old head is not in its log: the ledger was replaced) drops every view, failure and read kept for the old history's commits.
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

With a dev-assets URL (a Vite dev server of `ide/web` on loopback, for working on the page), the page is the dev
server's index.html read at each open, the same metas put in it here, and every other GET outside `/api/` (modules,
styles, Vite's client) and Vite's hot-update WebSocket go to that server, so the browser talks only to this origin and
the token is still put in the page by this service alone. Both this service and the dev server must be on loopback.

`/api/about` also names the newest released version, the product's latest GitHub release read anonymously at
most once an hour, so a deployment that does not follow versions is told it is behind.

An answer goes gzipped to a browser that takes it: every JSON answer of at least 1 KB, and what the paper
and overview services send, streams included. The page alone may be kept: it carries an ETag and is asked
for again at each open, so an unchanged page costs a 304. Everything else stays `no-store`.
"""
from __future__ import annotations

from collections import OrderedDict
from collections.abc import Callable
import contextlib
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
import gzip
import hashlib
import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import re
import os
import secrets
import signal
import socket
import subprocess
import sys
import threading
import time
from typing import NamedTuple
from urllib.parse import parse_qs, urlsplit
import zlib

from . import layout
from .pinned import Pinned
from .released import Released
from . import live_proxy, render

CACHED = 8
HEARTBEAT = 15.0
AGENT = "/api/agent/"
AGENT_BODY = 16 * 1024 * 1024  # a chat request carries the whole thread, tool outputs included
AGENT_HEADERS = ("Content-Type", "Accept", "Sec-Fetch-Site", "Sec-Fetch-Mode")
PAPER = "/api/paper/"
RESEARCH = "/api/research/"
PAPER_BODY = 64 * 1024
JSON = "application/json; charset=utf-8"
GZIP_FROM = 1024  # below this an answer gains little from compressing
PAPER_TOKEN = "X-Trade-Paper-Token"
OVERVIEW = "/api/overview/"
SETUP = "/api/setup/"
DEV = "/"  # with --dev-assets: what is not the page or under /api/ goes to the Vite dev server
# What the product's reads other than graphs may keep in memory, as the JSON a page is sent, least recently used dropped first.
KEPT = 64 * 2**20
# A product read's peak memory the kernel cannot reclaim. A read of research data (graph, comparison, trial, history,
# bars): the largest the kernel's OOM tables showed in the production Web container held 430 MiB anon (2026-11-19,
# `research comparison`). A ledger head, status or line list: a `ledger sql` holds 78 MiB at most, files included.
HEAVY = 450 * 2**20
LIGHT = 96 * 2**20
LIGHT_READS = (("ledger", "sql"), ("ledger", "service"), ("line", "list"))
# Room left for this server and the overview to grow past what they held when last measured.
MARGIN = 64 * 2**20
CGROUP = Path("/sys/fs/cgroup")
# What the line menu reads of `research state`; the judgments stay with the Agent's tool.
STATE_KEYS = ("ledger_commit", "gates", "review_every", "undistinguished_runs", "unreviewed_trials")
# `/api/about`'s ledger state (its `behind_seconds` moves with time) is read again after this many seconds or a new head.
STATUS_SECONDS = 30
SYMBOL = re.compile(r"[^\W_]+\Z")  # market.sources.SYMBOL: a contract as the market holds it, a non-ASCII coin included
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


def _stamped(view: dict, commit: str, same: dict) -> dict:
    """A view drawn at another commit as the one at `commit`, with what `same` adds to its summary (its trial counts)."""
    scope = view["scope"]
    return {**view, "widgets": [{**w, **same} if w["type"] == "summary" else w for w in view["widgets"]],
            "scope": {**scope, "ledger_commit": commit, "drawn_commit": scope.get("drawn_commit") or scope["ledger_commit"]}}


def _refusal(stderr: str) -> dict | None:
    """The refusal a product command printed on stderr: one JSON object, the stream's last output, past any lines
    written before it, such as a warning (shared.errors.printed_refusal, kept here as this module imports no product
    package); None when stderr does not end in one, as after a crash."""
    text = stderr.rstrip()
    for start in reversed([match.start() for match in re.finditer(r"^\{", text, re.MULTILINE)]):
        try:
            value = json.loads(text[start:])
        except ValueError:
            continue
        return value if isinstance(value, dict) and isinstance(value.get("code"), str) else None
    return None


def container_memory(cgroup: Path = CGROUP) -> tuple[int, int]:
    """The bytes this container may use (its cgroup v2 `memory.max`) and what its processes hold now that the kernel
    cannot reclaim without swap (`anon` and `kernel` of `memory.stat`; page cache is left out). Outside a limited
    cgroup, the machine's physical memory and nothing held."""
    try:
        limit = (cgroup / "memory.max").read_text().strip()
        if limit.isdigit():
            stat = dict(line.split() for line in (cgroup / "memory.stat").read_text().splitlines())
            return int(limit), int(stat.get("anon", 0)) + int(stat.get("kernel", 0))
    except (OSError, ValueError):
        pass
    return os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES"), 0


def mirror_head(url: str) -> Callable[[], str]:
    """A research mirror's head as its controller (`ledger mirror`, already running) answers the sync status, in
    place of a product process per read; a controller that does not give one raises OSError or ValueError."""
    target = urlsplit(url)

    def read() -> str:
        connection = http.client.HTTPConnection(target.hostname or "127.0.0.1", target.port, timeout=10)
        try:
            connection.request("GET", RESEARCH + "sync", headers={"Host": target.netloc})
            commit = json.loads(connection.getresponse().read()).get("ledger_commit")
        finally:
            connection.close()
        if not isinstance(commit, str) or not COMMIT.fullmatch(commit):
            raise ValueError(f"no head from {target.netloc}")
        return commit
    return read


def _market_day(at: str) -> bool:
    """Whether `at` is a market day, a valid YYYY-MM-DD (market.resolve_day's exact form). main and head are not:
    a day's bars never change, so they are kept by it, while main and head move."""
    if not DAY.fullmatch(at):
        return False
    try:
        date.fromisoformat(at)
    except ValueError:
        return False
    return True


def _days(start: str, end: str) -> bool:
    """Whether `start` and `end` are UTC days, `start` the earlier."""
    return _market_day(start) and _market_day(end) and start < end


@dataclass
class Product:
    """The product's command line on one ledger profile and a market profile (None: the active one), run with the
    product's own environment (`.venv`, which `uv sync` makes). A product process starts while the memory it may
    reach (`HEAVY`, or `LIGHT` for a light read) fits in what `memory` (the container's limit and what its processes
    hold) leaves after `MARGIN` and the processes already running, or when none runs; the rest wait their turn, and
    the 600 s a process is given starts when it starts, so waiting changes neither an answer nor a refusal. What the
    container holds is read when no product process runs, so it is never a running read's memory. Each process
    asks the kernel to kill it first when the container runs out of memory."""

    root: Path
    ledger: str
    market: str | None = None
    memory: Callable[[], tuple[int, int]] = container_memory
    turn: threading.Condition = field(init=False, repr=False, compare=False, default_factory=threading.Condition)
    using: int = field(init=False, repr=False, compare=False, default=0)
    room: int = field(init=False, repr=False, compare=False, default=0)

    def _start(self, cost: int) -> None:
        with self.turn:
            while self.using and self.using + cost > self.room:
                self.turn.wait()
            if not self.using:
                limit, held = self.memory()
                self.room = limit - held - MARGIN
            self.using += cost

    def _end(self, cost: int) -> None:
        with self.turn:
            self.using -= cost
            self.turn.notify_all()

    def run(self, *arguments: str) -> dict:
        argv = [str(self.root / ".venv" / "bin" / "python"), "-m", "cli.main", *arguments]
        cost = LIGHT if tuple(arguments[:2]) in LIGHT_READS and "--readings" not in arguments else HEAVY
        self._start(cost)
        try:
            with subprocess.Popen(argv, cwd=self.root, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True) as process:
                with contextlib.suppress(OSError):  # no /proc (macOS): no OOM killer to steer
                    Path(f"/proc/{process.pid}/oom_score_adj").write_text("1000")
                try:
                    stdout, stderr = process.communicate(timeout=600)
                except subprocess.TimeoutExpired:
                    process.kill()
                    raise
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise ProductError(_failure("PRODUCT_UNAVAILABLE", f"{' '.join(arguments[:2])}: {exc}")) from exc
        finally:
            self._end(cost)
        if process.returncode == -signal.SIGKILL:
            raise ProductError(_failure("OUT_OF_MEMORY", f"{' '.join(arguments[:2])}: the IDE ran out of memory on "
                                                         "this read; open it again to retry"))
        try:
            value = _refusal(stderr) if process.returncode else json.loads(stdout)
        except ValueError:
            value = None
        if process.returncode or not isinstance(value, dict):
            text = (stderr or stdout).strip()[-500:]
            raise ProductError(value if isinstance(value, dict)
                               else _failure("PRODUCT_FAILED", f"{' '.join(arguments[:2])}: {text}"))
        return value

    def commit(self, ref: str | None = None) -> str:
        """The full commit hash of `ref` (default: the research head)."""
        at = [f"--at={ref}"] if ref else []
        return self.run("ledger", "sql", f"--ledger={self.ledger}", *at, "SELECT 1")["ledger_commit"]

    def follows(self, older: str, newer: str) -> bool:
        """Whether `newer` is `older` or a commit after it (both full hashes): false when the history was replaced. The
        log at `newer` is its ancestry (`ledger sql` reads at a detached commit, where DOLT_MERGE_BASE is refused)."""
        query = f"SELECT commit_hash FROM dolt_log WHERE commit_hash = '{older}'"
        return self.run("ledger", "sql", f"--ledger={self.ledger}", f"--at={newer}", query)["rows"] == [[older]]

    def service(self) -> dict:
        return self.run("ledger", "service", "status", f"--ledger={self.ledger}")

    def lines(self, commit: str) -> dict:
        return self.run("line", "list", "--all", "--full", f"--ledger={self.ledger}", f"--at={commit}")

    def history(self, commit: str) -> dict:
        """Every line's closing history test (the History page's heatmap), as `research history` reads it."""
        return self.run("research", "history", f"--ledger={self.ledger}", f"--at={commit}", *([f"--market={self.market}"] if self.market else []))

    def readings(self, commit: str) -> dict:
        """Every line with its recommendation as its graph's summary reads it, without drawing a graph (the phone)."""
        return self.run("line", "list", "--all", "--readings", f"--ledger={self.ledger}", f"--at={commit}")

    def graph(self, commit: str, line: str | None, since: str | None) -> dict:
        options = [f"--line={line}"] if line else []
        options += [f"--since={since}"] if since else []
        # One worker: a served graph's reads run inside the container's CPU cap, where more workers add only CPU.
        return self.run("research", "graph", f"--ledger={self.ledger}", f"--at={commit}", "--without-comparisons", "--without-counts", "--workers=1", *options)

    def counts(self, line: str, commit: str) -> dict:
        """A line's trial counts, read for each graph served: the graph above leaves them out, so what they refuse is here."""
        return self.run("research", "counts", f"--ledger={self.ledger}", f"--line={line}", f"--at={commit}")

    def comparison(self, registration: int, trial_id: int, commit: str) -> dict:
        """One version's comparison, computed when the page opens it: the graph above leaves it out."""
        return self.run("research", "comparison", f"--ledger={self.ledger}", f"--registration={registration}",
                        f"--trial-id={trial_id}", f"--at={commit}")

    def state(self, line: str, commit: str) -> dict:
        """A line's gates and review readings, read when the page opens its menu: a due change of approach reads the
        line's latest comparisons, which the graph above leaves out."""
        found = self.run("research", "state", f"--ledger={self.ledger}", f"--line={line}", f"--at={commit}", "--without-image")
        return {key: found.get(key) for key in STATE_KEYS}

    def testing(self, line: str, commit: str) -> dict:
        """A line's multiple-testing reading with its runs' deflated Sharpe ranges, read when a page shows a backtest:
        they move with every overlapping trial, so neither a run's report nor the graph carries them."""
        return self.run("research", "multiple-testing", f"--ledger={self.ledger}", f"--line={line}", f"--at={commit}")

    def unchanged(self, line: str, since: str, commit: str) -> dict:
        return self.run("research", "unchanged", f"--ledger={self.ledger}", f"--line={line}", f"--since={since}", f"--at={commit}")

    def trial(self, trial_id: int, commit: str) -> dict:
        """A sealed trial's report with its drill-down tables, as the product gives or refuses it."""
        return self.run("replay", "report", f"--ledger={self.ledger}", f"--trial-id={trial_id}", f"--at={commit}", "--tables")

    def bars(self, symbol: str, start: str, end: str, market_day: str) -> dict:
        """A contract's daily LAST bars from UTC day `start` to `end` (left out) at a market day, all inline."""
        days = (date.fromisoformat(end) - date.fromisoformat(start)).days
        market = [f"--market={self.market}"] if self.market else []
        return self.run("market", "bars", *market, f"--market-day={market_day}", f"--symbol={symbol}", "--timeframe=1d", "--price-type=LAST",
                        f"--start={start}T00:00:00Z", f"--end={end}T00:00:00Z", f"--limit={days}")

    def local(self, day: str) -> dict:
        """The contracts the market directory holds bars of, for the Market page's marks: `market coverage` of the
        universe members of UTC day `day`'s month, over that day's first minute (the window only picks the members;
        each contract's first and last held LAST bar is its `listing_delisting.data_bounds_proxy`, whatever the
        window), as {market_day, contracts: [{symbol, first_open_ms, last_open_ms}]}, a contract with no bar left out."""
        market = [f"--market={self.market}"] if self.market else []
        found = self.run("market", "coverage", *market, f"--start={day}T00:00:00Z", f"--end={day}T00:01:00Z")
        held = [(row["symbol"], row["listing_delisting"]["data_bounds_proxy"]["last"]) for row in found["coverage"]]
        return {"market_day": found["market_day"],
                "contracts": [{"symbol": symbol, **bounds} for symbol, bounds in held if bounds is not None]}


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


class ViewKey(NamedTuple):
    """What a view is drawn for. A Hub serves one ledger with one build, so only these vary."""

    commit: str
    line: str | None
    since: str | None


class Job(NamedTuple):
    """A graph asked for. With `have`, the commit of a graph a page's browser kept, it is a question: whether that graph
    holds at `key`'s commit. Without, a draw, spared when the live graph this server holds of the line holds."""

    key: ViewKey
    pinned: bool  # asked for an `at`: drawn on the history it names, never spared
    have: str | None = None


@dataclass(frozen=True)
class CompletedView:
    view: dict
    live: bool  # historical `at` renders must not replace a line's newest completed live graph


class Hub:
    """Heads, the jobs that draw or spare graphs, kept views and reads, and the open pages' states."""

    def __init__(self, product: Product, build: str, poll: float = 5.0, mirror: Callable[[], str] | None = None,
                 version: str | None = None, released: Callable[[], str | None] = lambda: None):
        self.product, self.build, self.poll, self.mirror, self.version = product, build, poll, mirror, version
        self.released = released
        self.reads = Pinned(KEPT)
        self.lock = threading.Condition()
        self.refreshing = threading.Lock()
        self.head: str | None = None
        self.checked = 0.0
        self.fault: dict | None = None  # the last failed head read; cleared by a good one
        self.views: OrderedDict[ViewKey, CompletedView] = OrderedDict()  # completion order, not access order
        self.failed: dict[ViewKey, dict] = {}
        self.jobs: list[Job] = []  # oldest first
        self.running: list[Job] = []
        self.clients: list[Client] = []
        # A kept graph's answers at the head: None when it must be drawn, else what the unchanged state adds. A new head forgets them.
        self.same: dict[tuple[ViewKey, str], dict | None] = {}
        self.history_epoch = 0  # moves when the head's history replaces the one read before; a draw begun before it is dropped

    def kept(self, name: str, *arguments) -> bytes:
        """The JSON of the product's read `name` (a Product method) for `arguments`, kept."""
        return self.reads.get((name, *arguments), lambda: getattr(self.product, name)(*arguments))

    # States

    def _client_key(self, client: Client) -> ViewKey | None:
        commit = client.at or self.head
        return None if commit is None else ViewKey(commit, client.line, client.since)

    @staticmethod
    def _scope(key: ViewKey) -> tuple:
        return key[1:]  # line and since; only the commit may differ

    def _available(self, key: ViewKey | None, live: bool) -> ViewKey | None:
        if key in self.views:
            return key
        # An unnamed default can resolve to another line at the new head. Explicit `at` is exact.
        if not live or key is None or key.line is None:
            return None
        return next((old for old in reversed(self.views)
                     if self.views[old].live and self._scope(old) == self._scope(key)), None)

    def _remember(self, key: ViewKey, view: dict, pinned: bool) -> None:
        self.views[key] = CompletedView(view, live=not pinned)
        self.views.move_to_end(key)
        if len(self.views) > CACHED:
            newest = {self._scope(old): old for old, cached in self.views.items() if cached.live}
            protected = set(newest.values())
            victim = next((old for old in self.views if old != key and old not in protected), next(iter(self.views)))
            del self.views[victim]

    def state(self, key: ViewKey | None, live: bool = True, have: str | None = None) -> dict:
        message = self._progress(key, live, have)
        available = self._available(key, live)
        if available is not None and available != key:
            message["available_commit"] = available.commit
        return message

    def _progress(self, key: ViewKey | None, live: bool, have: str | None = None) -> dict:
        """A page's state. A live page (no `at`) is also told, over the view it holds, of a failed refresh."""
        fault = self.fault
        commit = key.commit if key else None
        if live and fault is not None:
            return {"state": "error", "ledger_commit": commit, "error": fault}
        if key in self.views:
            return {"state": "ready", "ledger_commit": commit}
        if key in self.failed:
            return {"state": "error", "ledger_commit": commit, "error": self.failed[key]}
        if key is not None:
            same = None if have is None else self.same.get((key, have))
            if same is not None:
                return {"state": "unchanged", "ledger_commit": commit, **same}
            if have not in (None, commit) and Job(key, False, have) in (*self.running, *self.jobs):
                return {"state": "checking", "ledger_commit": commit}
            if Job(key, False) in self.running or Job(key, True) in self.running:
                return {"state": "computing", "ledger_commit": commit}
            if Job(key, False) in self.jobs or Job(key, True) in self.jobs:
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

    def _want(self, key: ViewKey, pinned: bool, have: str | None = None) -> None:
        """Draw `key`, unless the graph a browser kept at `have` may hold there: that is asked first and spares the draw."""
        if key in self.views:
            return
        if pinned:
            have = None
        elif have is not None and (key, have) in self.same:
            if self.same[key, have] is not None:
                return
            have = None
        if all(job.key != key or job.have != have for job in (*self.running, *self.jobs)):
            if have is None:
                self.failed.pop(key, None)
            self.jobs.append(Job(key, pinned, have))

    # The head

    def _follows(self, older: str | None, newer: str) -> bool:
        """Whether `newer` continues the history `older` was read on. Only a confirmed ancestor does: a refusal, an
        unknown commit included, counts as a replaced history, which costs a draw and never shows another ledger's graph."""
        if older is None or older == newer:
            return True
        if not (COMMIT.fullmatch(older) and COMMIT.fullmatch(newer)):
            return False
        try:
            return self.product.follows(older, newer)
        except ProductError:
            return False

    def _forget(self) -> None:
        """Drop the graphs and failures of the replaced history (the caller holds the lock)."""
        self.history_epoch += 1
        self.views.clear()
        self.failed.clear()

    def _head(self) -> str:
        """The head from the mirror's controller when there is one; else, or when it gives none, from the product,
        whose refusal is what a page should see."""
        if self.mirror is not None:
            try:
                return self.mirror()
            except (OSError, ValueError):
                pass
        return self.product.commit()

    def refresh(self, wait: bool = False) -> None:
        """Read the head and, when it moved, fetch every open live page's graph at it."""
        if not self.refreshing.acquire(blocking=wait):
            return
        try:
            try:
                head = self._head()
                index = None
                replaced = not self._follows(self.head, head)
                if replaced:  # reads pinned to the replaced history's commits; a day's bars stay
                    self.reads.drop(lambda key: key[0] != "bars")
                if head != self.head:
                    # navigation metadata has its own error path; it must not block a valid graph
                    with contextlib.suppress(ProductError):
                        index = json.loads(self.kept("lines", head))
            except ProductError as exc:
                with self.lock:
                    self.fault, self.checked = exc.body, time.monotonic()
                    self._notify()
                return
            with self.lock:
                moved, self.head, self.fault = head != self.head, head, None
                self.checked = time.monotonic()
                if replaced:
                    self._forget()
                if moved:
                    self.same.clear()
                    pending, self.jobs = [job for job in self.jobs if job.have is None], []
                    for job in pending:
                        self._want(job.key if job.pinned else job.key._replace(commit=head), job.pinned)
                    for client in self.clients:
                        if client.at is None:
                            self._want(ViewKey(head, client.line, client.since), False, client.have)
                    # An open line no page follows yet is drawn after theirs, so choosing it finds its graph ready.
                    followed = {client.line for client in self.clients if client.at is None}
                    for line in (index or {}).get("lines", []):
                        if not line.get("closed") and line.get("name") not in followed:
                            self._want(ViewKey(head, line["name"], None), False)
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

    # Jobs

    def _held(self, job: Job) -> tuple[str, dict] | None:
        """The commit and view of the live graph a draw may be spared by: the newest of the same named line at another
        commit, drawn with the market (the caller holds the lock)."""
        if job.have is not None or job.pinned or job.key.line is None or job.key.since is not None:
            return None
        older = self._available(job.key, True)
        if older is None or self.views[older].view["scope"].get("market_unread"):
            return None
        return older.commit, self.views[older].view

    def _holds(self, key: ViewKey, have: str) -> dict | None:
        """What the graph of `key`'s line drawn at `have` adds to be the one at `key`'s commit (its trial counts; nothing
        at its own commit), or None when `research unchanged` does not say it is the same, a refusal included: the draw
        then meets it and it reaches the page like any other. A refusal of the counts raises."""
        assert key.line is not None  # only a named line's graph is ever compared
        try:
            if self.product.unchanged(key.line, have, key.commit).get("unchanged") is not True:
                return None
        except ProductError:
            return None
        return {} if have == key.commit else {"trial_counts": json.loads(self.kept("counts", key.line, key.commit))["trial_counts"]}

    def _draw(self, key: ViewKey) -> dict:
        graph = self.product.graph(*key)
        graph["line"]["trial_counts"] = json.loads(self.kept("counts", graph["line"]["name"], key.commit))["trial_counts"]
        view = layout.build_view(graph)
        view["scope"] = {**(view["scope"] or {}), "build": self.build}  # what a page's kept view and answers are good for
        return view

    def _next(self) -> Job | None:
        """The oldest job that may start: a question at any time, a draw while no other runs (the caller holds the lock)."""
        drawing = any(job.have is None for job in self.running)
        return next((job for job in self.jobs if job.have is not None or not drawing), None)

    def work(self) -> None:
        """Run jobs, oldest first. `serve` runs two, so a question about a kept graph never waits behind a draw."""
        while True:
            with self.lock:
                while (job := self._next()) is None:
                    self.lock.wait()
                self.jobs.remove(job)
                self.running.append(job)
                epoch, held = self.history_epoch, self._held(job)
                self._notify()
            key, view, same, failure = job.key, None, None, None
            try:
                have = job.have or (held[0] if held else None)
                same = None if have is None else self._holds(key, have)
                if job.have is None:
                    view = self._draw(key) if same is None or held is None else _stamped(held[1], key.commit, same)
            except ProductError as exc:
                failure = exc.body
            except Exception as exc:  # a graph the layout cannot read
                failure = _failure("GRAPH_UNREADABLE", f"{type(exc).__name__}: {exc}")
            with self.lock:
                self.running.remove(job)
                if job.have is not None:  # a refusal of its counts is met by the draw too
                    if key.commit == self.head:
                        self.same[key, job.have] = same
                        self._want(key, False, job.have)
                elif epoch != self.history_epoch:
                    if job.pinned:  # drawn on the history the head left: an `at` page is answered on the new one
                        self._want(key, True)
                elif view is not None:
                    self._remember(key, view, job.pinned)
                else:
                    self.failed[key] = failure or _failure("GRAPH_UNREADABLE", "no view")
                self._notify()

    # Pages

    def resolve(self, since: str | None, at: str | None) -> tuple[str | None, str | None]:
        """Full hashes for `since` and `at` (a ProductError for an unknown reference). The head read last is its own
        hash, as a live page names it when the head moves."""
        with self.lock:
            head = self.head

        def full(ref: str | None) -> str | None:
            return (ref if ref == head else self.product.commit(ref)) if ref else None
        return full(since), full(at)

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
            key = ViewKey(commit, line, since)
            self._want(key, at is not None, have)
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
                self._want(key, client.at is not None, client.have)
            client.sent = client.pending = self.state(key, client.at is None, client.have)
            client.ready.set()
            self._notify()

    def leave(self, client: Client) -> None:
        with self.lock:
            self.clients.remove(client)


def market_import(path: Path, now: datetime) -> tuple[int, dict]:
    """The market-import service's status file as it is, with the time it was read and whether it is stale by
    market.follow.check()'s rule (the round in progress, else the last round, began longer ago than STALE); 503 when
    there is no file or it is not a status."""
    try:
        status = json.loads(path.read_text(encoding="utf-8"))
    except OSError as exc:
        return 503, _failure("MARKET_IMPORT_UNAVAILABLE", f"no status at {path}: {exc.strerror or exc}")
    except ValueError as exc:
        return 503, _failure("MARKET_IMPORT_UNREADABLE", f"{path}: {exc}")
    try:
        at, running = datetime.fromisoformat(status["at"]), status.get("running_since")
        stale = now - (at if running is None else datetime.fromisoformat(running)) > STALE
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
            research: str | None = None, setup: str | None = None, *,
            live_socket: Path | None = None, live_router: str | None = None,
            dev_assets: str | None = None) -> type[BaseHTTPRequestHandler]:
    if (live_socket is None) != (live_router is None):
        raise ValueError("Live needs both its private socket and trusted router name")
    token = secrets.token_urlsafe(24)

    def dressed(page: bytes) -> bytes:
        """The page with the metas only this service puts in it."""
        if paper or research or setup or live_socket:
            page = page.replace(b"</head>", f'<meta name="trade-paper-token" content="{token}">'.encode() + b"</head>", 1)
        if research:
            page = page.replace(b"</head>", b'<meta name="trade-research-sync" content="enabled"></head>', 1)
        return page

    page = b"" if dev_assets else dressed(_page())
    zipped_page = gzip.compress(page, 6, mtime=0)
    page_tag = f'"{hashlib.sha256(page).hexdigest()[:32]}'
    # Each forwarded prefix: its service, the largest body it takes and the code of its absence.
    targets = {prefix: (urlsplit(url), limit, code) for prefix, url, limit, code in (
        (AGENT, agent, AGENT_BODY, "AGENT_UNAVAILABLE"), (PAPER, paper, PAPER_BODY, "PAPER_UNAVAILABLE"),
        (OVERVIEW, overview, 0, "OVERVIEW_UNAVAILABLE"),
        (RESEARCH, research, 0, "RESEARCH_UNAVAILABLE"), (SETUP, setup, PAPER_BODY, "SETUP_UNAVAILABLE"),
        (DEV, dev_assets, 0, "DEV_ASSETS_UNAVAILABLE")) if url}

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def takes_gzip(self) -> bool:
            return _takes_gzip(self.headers.get("Accept-Encoding"))

        def show_page(self) -> None:
            """The page, or a 304 when the browser already holds this one. It is private because it carries the token."""
            if DEV in targets:
                self.show_dev_page()
                return
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

        def show_dev_page(self) -> None:
            """The dev server's page as it is now, with this service's metas; never kept."""
            target, _, absent = targets[DEV]
            upstream = http.client.HTTPConnection(target.hostname or "127.0.0.1", target.port, timeout=60)
            try:
                upstream.request("GET", "/", headers={"Host": target.netloc, "Accept": "text/html"})
                response = upstream.getresponse()
                body = response.read()
            except (OSError, http.client.HTTPException) as exc:
                self.json(502, _failure(absent, f"{target.netloc} did not answer: {exc}"))
                return
            finally:
                upstream.close()
            if response.status != 200:
                self.json(502, _failure(absent, f"{target.netloc} answered {response.status} for the page"))
                return
            self.send(200, dressed(body), "text/html; charset=utf-8")

        def tunnel(self) -> None:
            """Vite's hot-update WebSocket: the upgrade sent on with the dev server's Host, then bytes both ways
            until either side closes. Vite checks the Origin and the token its client carries in the query."""
            target, _, absent = targets[DEV]
            try:
                upstream = socket.create_connection((target.hostname or "127.0.0.1", target.port or 80), timeout=10)
            except OSError as exc:
                self.refuse(502, _failure(absent, f"{target.netloc} did not answer: {exc}"))
                return
            self.close_connection = True
            lines = [f"{self.command} {self.path} HTTP/1.1", f"Host: {target.netloc}"] + [
                f"{name}: {value}".replace("\r", "").replace("\n", "")
                for name, value in self.headers.items() if name.lower() != "host"]
            try:
                upstream.sendall(("\r\n".join(lines) + "\r\n\r\n").encode("latin-1"))
                upstream.settimeout(None)

                def back() -> None:
                    try:
                        while chunk := upstream.recv(65536):
                            self.connection.sendall(chunk)
                    except OSError:
                        pass
                    finally:
                        for end in (self.connection, upstream):
                            with contextlib.suppress(OSError):
                                end.shutdown(socket.SHUT_RDWR)

                threading.Thread(target=back, daemon=True).start()
                while chunk := self.rfile.read1(65536):
                    upstream.sendall(chunk)
            except OSError:
                pass  # either side went away
            finally:
                upstream.close()

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
            self.send(status, json.dumps(value, ensure_ascii=False).encode(), JSON, renew)

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
            declared = (self.headers.get("Content-Length") or "").strip() or "0"  # int() takes "-1": read to the end
            if not declared.isascii() or not declared.isdigit() or len(declared) > 18:
                self.refuse(400, _failure("BAD_REQUEST", f"content length {declared!r}"))
                return
            length = int(declared)
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
            except (OSError, http.client.HTTPException) as exc:
                upstream.close()
                self.json(502, _failure(absent, f"{target.netloc} did not answer: {exc}"))
                return
            try:
                self.send_response(response.status)
                for name in ("Content-Type", "Cache-Control", "X-Content-Type-Options", "X-Vercel-AI-UI-Message-Stream"):
                    if value := response.getheader(name):
                        # http.client keeps an obs-folded value's line breaks; re-sent, they would start new headers.
                        self.send_header(name, value.replace("\r", "").replace("\n", ""))
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
            except (OSError, http.client.HTTPException):
                # The page went away (a stopped answer), and closing upstream stops the chat service too; or the service cut
                # its answer short, and so is the page's.
                pass
            finally:
                upstream.close()
                self.close_connection = True

        def do_POST(self) -> None:
            if not self.admitted():
                return
            if live_proxy.matches(self.path):
                live_proxy.forward(self, live_socket, live_router, token, PAPER_TOKEN)
            elif self.path.startswith(OVERVIEW) and OVERVIEW in targets:
                self.refuse(405, _failure("METHOD_NOT_ALLOWED", "the overview only answers GET"))
            elif prefix := next((p for p in (AGENT, PAPER, RESEARCH, SETUP) if self.path.startswith(p)), None):
                self.forward(prefix)
            else:
                self.refuse(404, _failure("NOT_FOUND", self.path))

        do_PUT = do_PATCH = do_DELETE = do_POST

        def do_GET(self) -> None:
            if not self.admitted():
                return
            if live_proxy.matches(self.path):
                live_proxy.forward(self, live_socket, live_router, token, PAPER_TOKEN)
                return
            if prefix := next((p for p in (AGENT, PAPER, OVERVIEW, RESEARCH, SETUP) if self.path.startswith(p)), None):
                self.forward(prefix)
                return
            url = urlsplit(self.path)
            if DEV in targets and self.headers.get("Upgrade", "").lower() == "websocket":
                self.tunnel()
                return
            if DEV in targets and url.path != "/" and not url.path.startswith("/api/"):
                self.forward(DEV)
                return
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
            if url.path == "/api/state":
                self.line_read("state", query)
                return
            if url.path == "/api/testing":
                self.line_read("testing", query)
                return
            if url.path == "/api/bars":
                self.bars(query)
                return
            if url.path == "/api/about":
                self.about()
                return
            if url.path == "/api/market/local":
                # Yesterday (UTC): a whole day the market can hold, its month's members the contracts now listed.
                self.kept("local", (datetime.now(UTC) - timedelta(days=1)).date().isoformat())
                return
            if url.path == "/api/market-import" and status is not None:
                self.json(*market_import(status, datetime.now(UTC)))
                return
            if url.path not in ("/api/view", "/api/events", "/api/lines", "/api/history", "/api/readings"):
                self.json(404, _failure("NOT_FOUND", url.path))
                return
            line = query.get("line")
            # A kept graph counts only as this build drew it, on a page that follows one named line's head.
            kept = query.get("have", "")
            have = kept if COMMIT.fullmatch(kept) and query.get("build") == hub.build and line and not {"since", "at"} & query.keys() else None
            try:
                since, at = hub.resolve(query.get("since"), query.get("at"))
                if url.path in ("/api/lines", "/api/history", "/api/readings"):
                    with hub.lock:
                        commit = at or hub.head
                    read = {"/api/lines": "lines", "/api/history": "history", "/api/readings": "readings"}[url.path]
                    self.send(200, hub.kept(read, commit or hub.product.commit()), JSON)
                    return
            except ProductError as exc:
                self.json(400, exc.body)
                return
            if url.path == "/api/view":
                self.json(*hub.view(line, since, at, have))
                return
            self.events(Client(line, since, at, have))

        def about(self) -> None:
            """What this deployment runs: the product version and the page's build, the newest released version
            (null while unknown), and the ledger's state or the refusal reading it."""
            runs = {"version": hub.version, "build": hub.build, "released": hub.released()}
            try:
                with hub.lock:
                    head = hub.head
                found = json.loads(hub.reads.get(("service", head, int(time.monotonic() // STATUS_SECONDS)), hub.product.service))
            except ProductError as exc:
                self.json(200, {**runs, "ledger": None, "refusal": exc.body})
                return
            self.json(200, {**runs, "ledger": {"running": found["running"], "remote": found.get("remote"),
                                                           "unpublished": bool(found.get("unpublished")),
                                                           "behind_seconds": found.get("behind_seconds"),
                                                           "diverged": bool(found.get("diverged")),
                                                           "commit": found.get("ledger_commit")}})

        def kept(self, read: str, *arguments) -> None:
            """What the hub keeps of the product's `read` for `arguments`, or the product's refusal."""
            try:
                self.send(200, hub.kept(read, *arguments), JSON)
            except ProductError as exc:
                self.json(400, exc.body)

        def trial(self, query: dict[str, str]) -> None:
            """A trial's report at a full ledger commit (immutable, so kept), or the product's refusal."""
            trial_id, at = query.get("trial_id", ""), query.get("at", "")
            if not trial_id.isdigit() or not COMMIT.fullmatch(at):
                self.json(400, _failure("BAD_REQUEST", "give trial_id and at, a full ledger commit"))
                return
            self.kept("trial", int(trial_id), at)

        def comparison(self, query: dict[str, str]) -> None:
            """A version's comparison at a full ledger commit (immutable, so kept), or the product's refusal."""
            registration, trial_id, at = query.get("registration", ""), query.get("trial_id", ""), query.get("at", "")
            if not registration.isdigit() or not trial_id.isdigit() or not COMMIT.fullmatch(at):
                self.json(400, _failure("BAD_REQUEST", "give registration, trial_id and at, a full ledger commit"))
                return
            self.kept("comparison", int(registration), int(trial_id), at)

        def line_read(self, read: str, query: dict[str, str]) -> None:
            """The product's `read` of a line at a full ledger commit (immutable, so kept), or its refusal."""
            line, at = query.get("line", ""), query.get("at", "")
            if not line or not COMMIT.fullmatch(at):
                self.json(400, _failure("BAD_REQUEST", "give line and at, a full ledger commit"))
                return
            self.kept(read, line, at)

        def bars(self, query: dict[str, str]) -> None:
            """A contract's daily bars over whole UTC days at a market day (kept), or the product's refusal."""
            symbol, start, end, at = (query.get(name, "") for name in ("symbol", "start", "end", "at"))
            if query.get("timeframe") != "1d" or not SYMBOL.fullmatch(symbol) or not _market_day(at) or not _days(start, end):
                self.json(400, _failure("BAD_REQUEST", "give symbol, timeframe=1d, start and end (UTC days, start first) and at, a market day (YYYY-MM-DD)"))
                return
            self.kept("bars", symbol, start, end, at)

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
            if live_proxy.matches(self.path):
                return  # Live paths may contain malformed input; never put them in access logs.
            if int(code) >= 400:  # the page polls; only a failed request is news
                super().log_request(code, size)

        def log_message(self, format: str, *args) -> None:
            sys.stderr.write(f"{time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())} {format % args}\n")

    return Handler


def serve(product: Product, build: str, host: str, port: int, hosts: list[str],
          agent: str | None = None, paper: str | None = None, status: Path | None = None,
          overview: str | None = None, research: str | None = None, setup: str | None = None, *,
          live_socket: Path | None = None, live_router: str | None = None, version: str | None = None,
          dev_assets: str | None = None) -> None:
    hub = Hub(product, build, mirror=mirror_head(research) if research else None, version=version, released=Released())
    server = Server((host, port), handler(hub, frozenset(hosts or [f"127.0.0.1:{port}", f"localhost:{port}"]), agent, paper,
                                          status, overview, research, setup,
                                          live_socket=live_socket, live_router=live_router, dev_assets=dev_assets))
    for target in (hub.watch, hub.work, hub.work):
        threading.Thread(target=target, daemon=True).start()
    print(f"research graph of {product.ledger} at http://127.0.0.1:{port}/", file=sys.stderr, flush=True)
    server.serve_forever()
