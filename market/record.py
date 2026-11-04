"""Liquidation recording (market.record): what Binance's `!forceOrder@arr` and Bybit's `allLiquidation.{symbol}` push,
written down as it arrives (docs/plans/liquidation-recording.zh.md). Neither venue keeps a free history of its
liquidations, so a moment not recorded is lost.

The recorder holds no database account. It appends every frame, verbatim, to a spool of one file per venue and UTC
day, each line a JSON object: `at` and `mono` (the wall and monotonic clocks of the arrival, milliseconds), `conn`
(the connection, `<venue>-<n>`), `event` and, but for a pong, `text`:
- open: the connection is up (`text` its URL); for Binance the stream is subscribed by its URL;
- subscribe: a Bybit request sent (`text` the request); Bybit's frame answering its `req_id` confirms it;
- frame: a frame as received;
- pong: the answer to the recorder's own ping, every PING seconds on each connection, so a quiet market still
  leaves a line while the connection is alive;
- close: the connection ended (`text` why).
`market follow` imports each closed day into the market (market.liquidations), deriving from the lines when each
venue was recorded: from an open or a confirmed subscription to the last line before a close, or before a
wall-clock gap no live connection leaves (host sleep pauses the Docker VM and its monotonic clock with it, so the
wall clock decides). Given the import's status file, the recorder deletes a day's files RETAIN days after the
import has published the day; nothing else deletes them.

Each connection is replaced before it is ROTATE old (Binance ends one at 24 hours): the next one opens first and
the old one closes OVERLAP seconds later, so the two record the same frames for a while and none falls between."""

from __future__ import annotations

from dataclasses import dataclass, field
from collections.abc import Callable
from datetime import UTC, date, datetime, timedelta
import json
import math
import os
from pathlib import Path
import signal
import sys
import tempfile
import threading
import time
from typing import TextIO
import urllib.request

from websockets.exceptions import WebSocketException
from websockets.sync.client import ClientConnection, connect

BINANCE = "wss://fstream.binance.com/market/ws/!forceOrder@arr"  # /ws/ accepts the handshake but sends no frame
BYBIT = "wss://stream.bybit.com/v5/public/linear"
BYBIT_TICKERS = "https://api.bybit.com/v5/market/tickers?category=linear"
VENUES = ("binance", "bybit")
PING = 15  # seconds between the recorder's pings on each connection; one unanswered by the next ends it
ROTATE = 23 * 3600  # seconds a connection lives before its successor opens
OVERLAP = 60  # seconds both connections record before the old one closes
LISTING = 3600  # seconds between Bybit contract listings (new contracts are subscribed as they appear)
BATCH = 10  # Bybit topics per subscribe request
BACKOFF = (5, 60)  # seconds before reconnecting after a failure, doubling to the second
FSYNC = 1.0  # seconds a written line may wait for fsync
STALE = 120  # seconds without a line in a venue's spool that make the recorder unhealthy
RETAIN = 7  # days a spool file is kept after the market import published its day


def default_spool() -> Path:
    return Path(tempfile.gettempdir()) / "market-record"


def _now() -> tuple[int, int]:
    return time.time_ns() // 1_000_000, time.monotonic_ns() // 1_000_000


class Spool:
    """One venue's lines, appended to `<root>/<venue>/<UTC day>.jsonl` by the wall clock of their arrival; every
    line is flushed as written and fsynced within FSYNC seconds, so a crash loses at most the line being written."""

    def __init__(self, root: Path, venue: str):
        self.dir = root / venue
        self.dir.mkdir(parents=True, exist_ok=True)
        self.lock = threading.Lock()
        self.day: str | None = None
        self.file: TextIO | None = None
        self.synced = 0.0

    def write(self, conn: str, event: str, text: str | None = None) -> None:
        at, mono = _now()
        line = {"at": at, "mono": mono, "conn": conn, "event": event}
        if text is not None:
            line["text"] = text
        data = json.dumps(line, separators=(",", ":"), ensure_ascii=False) + "\n"
        day = datetime.fromtimestamp(at / 1000, UTC).date().isoformat()
        with self.lock:
            if day != self.day:
                self._close()
                self.file = open(self.dir / f"{day}.jsonl", "a", encoding="utf-8")
                self.day = day
                if self.file.tell() and _cut(self.dir / f"{day}.jsonl"):
                    self.file.write("\n")  # end a line a crash cut short, so the next one stays readable
            assert self.file is not None
            self.file.write(data)
            self.file.flush()
            if time.monotonic() - self.synced >= FSYNC:
                os.fsync(self.file.fileno())
                self.synced = time.monotonic()

    def close(self) -> None:
        with self.lock:
            self._close()

    def _close(self) -> None:
        if self.file is not None:
            self.file.flush()
            os.fsync(self.file.fileno())
            self.file.close()
            self.file = None


def _cut(path: Path) -> bool:
    with open(path, "rb") as stream:
        stream.seek(-1, os.SEEK_END)
        return stream.read(1) != b"\n"


@dataclass
class Bybit:
    """Bybit's linear contracts, listed every LISTING seconds; each live connection subscribes the ones it lacks."""
    symbols: list[str] = field(default_factory=list)
    lock: threading.Lock = field(default_factory=threading.Lock)

    def refresh(self) -> None:
        request = urllib.request.Request(BYBIT_TICKERS, headers={"User-Agent": "trade-market-record"})
        with urllib.request.urlopen(request, timeout=30) as response:
            body = json.load(response)
        found = sorted({row["symbol"] for row in body["result"]["list"] if isinstance(row.get("symbol"), str)})
        if not found:
            raise ValueError("Bybit listed no linear contract")
        with self.lock:
            self.symbols = found

    def subscribe(self, socket: ClientConnection, spool: Spool, conn: str, held: set[str], requests: list[int]) -> None:
        with self.lock:
            fresh = [symbol for symbol in self.symbols if symbol not in held]
        for start in range(0, len(fresh), BATCH):
            requests[0] += 1
            text = json.dumps({"req_id": f"{conn}-{requests[0]}", "op": "subscribe",
                               "args": [f"allLiquidation.{symbol}" for symbol in fresh[start:start + BATCH]]},
                              separators=(",", ":"))
            spool.write(conn, "subscribe", text)  # before sending: its answer can arrive first
            socket.send(text)
            held.update(fresh[start:start + BATCH])


def hold(url: str, spool: Spool, conn: str, done: Callable[[], bool], opened: threading.Event,
         bybit: Bybit | None = None) -> None:
    """One connection, until `done()`, a failure or an unanswered ping: every frame and pong to the spool."""
    reason = "stopped"
    try:
        with connect(url, open_timeout=10, ping_interval=None, close_timeout=5, max_size=2**22,
                     user_agent_header="trade-market-record") as socket:
            spool.write(conn, "open", url)
            opened.set()
            held: set[str] = set()
            requests = [0]
            listed = pinged = -math.inf
            waiting: threading.Event | None = None
            while not done():
                if bybit is not None and time.monotonic() - listed >= LISTING:
                    bybit.subscribe(socket, spool, conn, held, requests)
                    listed = time.monotonic()
                if waiting is not None and waiting.is_set():
                    spool.write(conn, "pong")
                    waiting = None
                if time.monotonic() - pinged >= PING:
                    if waiting is not None:
                        reason = f"no pong within {PING} s"
                        break
                    waiting, pinged = socket.ping(), time.monotonic()
                    if bybit is not None:
                        socket.send('{"op":"ping"}')  # Bybit's own keep-alive besides the protocol ping
                try:
                    message = socket.recv(timeout=1)
                except TimeoutError:
                    continue
                spool.write(conn, "frame", message if isinstance(message, str) else message.decode("utf-8"))
    except (WebSocketException, OSError, TimeoutError, UnicodeDecodeError) as exc:
        reason = f"{type(exc).__name__}: {exc}"
    spool.write(conn, "close", reason)
    if reason != "stopped":
        print(f"{conn}: {reason}", file=sys.stderr, flush=True)


@dataclass
class _Link:
    thread: threading.Thread
    ended: threading.Event  # set to close this one connection
    opened: threading.Event
    started: float  # monotonic seconds


def keep(venue: str, url: str, spool: Spool, stop: threading.Event, bybit: Bybit | None = None) -> None:
    """A venue's connections until `stop`: reconnect after a failure (BACKOFF), replace one before ROTATE."""
    number, wait = 0, BACKOFF[0]
    current: _Link | None = None

    def start() -> _Link:
        nonlocal number
        number += 1
        ended, opened = threading.Event(), threading.Event()
        thread = threading.Thread(target=hold, args=(url, spool, f"{venue}-{number}",
                                                     lambda: stop.is_set() or ended.is_set(), opened, bybit),
                                  name=f"{venue}-{number}", daemon=True)
        thread.start()
        return _Link(thread, ended, opened, time.monotonic())

    while not stop.is_set():
        if current is None or not current.thread.is_alive():
            if current is not None:
                lived = time.monotonic() - current.started
                wait = BACKOFF[0] if lived >= BACKOFF[1] else min(wait * 2, BACKOFF[1])
                if stop.wait(wait):
                    break
            current = start()
        elif time.monotonic() - current.started >= ROTATE:
            successor = start()
            if successor.opened.wait(30) and successor.thread.is_alive():
                stop.wait(OVERLAP)
                current.ended.set()
                current = successor
            else:  # keep the old connection and try again later
                successor.ended.set()
                current.started += BACKOFF[1]
        stop.wait(1)
    if current is not None:
        current.thread.join(10)


def retire(root: Path, status: Path, today: date) -> list[Path]:
    """Delete the spool files of the days the import status's liquidations published_through says were imported
    and published, but the last such day (the next day's import reads it), once RETAIN days have passed since each
    day's import (the day after it); none while the status is unreadable."""
    try:
        entry = json.loads(status.read_text(encoding="utf-8"))["kinds"]["liquidations"]["spool"]
        through = date.fromisoformat(entry["published_through"])
    except (OSError, ValueError, KeyError, TypeError):
        return []
    removed: list[Path] = []
    for venue in VENUES:
        for path in sorted((root / venue).glob("*.jsonl")):
            try:
                day = date.fromisoformat(path.stem)
            except ValueError:
                continue
            if day + timedelta(days=1) < through and day + timedelta(days=RETAIN + 1) <= today:
                try:
                    path.unlink(missing_ok=True)
                except OSError as exc:
                    print(f"retiring {path}: {exc}", file=sys.stderr, flush=True)
                    continue
                removed.append(path)
    return removed


def record(root: Path, stop: threading.Event | None = None, status: Path | None = None) -> None:
    """market record-liquidations: both venues into `root` until `stop` is set (SIGTERM or SIGINT when run as
    the command); Bybit's contracts listed hourly, and hourly the files the import `status` allows retired."""
    stop = stop or threading.Event()
    if threading.current_thread() is threading.main_thread():
        for signum in (signal.SIGTERM, signal.SIGINT):
            signal.signal(signum, lambda *_: stop.set())
    spools = {venue: Spool(root, venue) for venue in VENUES}
    bybit = Bybit()
    while not stop.is_set():
        try:
            bybit.refresh()
            break
        except (OSError, ValueError, KeyError, TypeError) as exc:
            print(f"bybit listing: {type(exc).__name__}: {exc}", file=sys.stderr, flush=True)
            stop.wait(BACKOFF[1])
    threads = [threading.Thread(target=keep, args=("binance", BINANCE, spools["binance"], stop), daemon=True),
               threading.Thread(target=keep, args=("bybit", BYBIT, spools["bybit"], stop, bybit), daemon=True)]
    for thread in threads:
        thread.start()
    listed, retired = time.monotonic(), -math.inf
    while not stop.wait(5):
        if time.monotonic() - listed >= LISTING:
            try:
                bybit.refresh()
            except (OSError, ValueError, KeyError, TypeError) as exc:
                print(f"bybit listing: {type(exc).__name__}: {exc}", file=sys.stderr, flush=True)
            listed = time.monotonic()
        if status is not None and time.monotonic() - retired >= LISTING:
            for path in retire(root, status, datetime.now(UTC).date()):
                print(f"retired {path}", file=sys.stderr, flush=True)
            retired = time.monotonic()
    for thread in threads:
        thread.join(15)
    for spool in spools.values():
        spool.close()


def check(root: Path | None = None, now: float | None = None) -> int:
    """The healthcheck: 0 when every venue's spool took a line within STALE seconds (each live connection writes
    a pong every PING seconds)."""
    root = root or default_spool()
    now = time.time() if now is None else now
    try:
        for venue in VENUES:
            files = sorted((root / venue).glob("*.jsonl"))
            if not files or now - files[-1].stat().st_mtime > STALE:
                return 1
        return 0
    except OSError:
        return 1
