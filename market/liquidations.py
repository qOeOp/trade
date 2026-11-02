"""Liquidations from the recorder's spool (market.import_liquidations): the rows Binance's `!forceOrder@arr` and
Bybit's `allLiquidation.{symbol}` pushed, and when each venue was watched, one closed UTC day per transaction and
commit on the import account under the import lock and commit tests (docs/plans/liquidation-recording.zh.md).

A day is the spool's files of that day (market.record: one per venue, by the wall clock of arrival), read with the
day before (the connections and subscriptions that carry over midnight, and the rows first seen then) and the first
lines of the day after (whether a connection outlived midnight).

Rows. The key of a row is every source field stored; a row seen more than once on one connection is that many
liquidations (`n`), one seen on several connections is one, received first at `received_at`. A day holds the rows
first received that day; a row first received the day before is held there, and a day whose rows are already held
is never imported again (insert only). Every key a message carries is stored or checked: Binance's `f` (IOC), `o`
(LIMIT), `ps` (the contract's pair) and `st` (2 for a coin-margined contract, else 1) are checked; an unknown key, a
value that is no exact decimal, an unknown frame or a decimal the column cannot hold refuses the day.

Watch. A connection watches its venue (Binance: every contract, from its open; Bybit: each contract from the
answer confirming its subscription) until its last line before a close, a wall-clock gap longer than HEARTBEAT, a
jump of the wall clock against the monotonic one (host sleep pauses the Docker VM and its monotonic clock with it),
or an unreadable spool line (a crash mid-write); then it watches again from its next line. A row received more
than EARLY before the venue's time of it shows the wall clock behind (as after host sleep): the stretch ends at the
connection's latest row received in time, and the connection watches nothing until its wall clock jumps against the
monotonic one; the row is stored as received. A connection whose open
or subscription lies before the day before watches nothing. The union of a venue's connections, cut at midnight, is
stored in liquidation_watch: a contract or venue without a watch row was not recorded then."""

from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
import json
from pathlib import Path
import re
import statistics
import time
from typing import Any

import pymysql

from market import metrics, series, store
from market.sources import _refuse


IMPORT = store.LIQUIDATION_IMPORT
VENUES = ("binance", "bybit")
# The streams market.record connects to; a connection opened elsewhere (Binance's /ws/ path takes the handshake but
# sends nothing) watches nothing.
URLS = {"binance": "wss://fstream.binance.com/market/ws/!forceOrder@arr", "bybit": "wss://stream.bybit.com/v5/public/linear"}
TABLES = {"binance": "binance_force_order", "bybit": "bybit_all_liquidation"}
HEARTBEAT = 35_000  # ms: a live connection writes a pong at least every 2 x market.record.PING, plus latency
JUMP = 1_000  # ms the wall clock may move against the monotonic one between two lines of a connection
EARLY = 2_000  # ms a row may be received before the venue's time of it (measured: the VM clock runs <= 92 ms behind)
GRACE = timedelta(minutes=5)  # after midnight, before a day is read: the next day's first lines decide its end
PRICE, SIZE = (32, 12), (32, 8)  # DECIMAL(precision, scale) of the price and quantity columns (market/schema.sql)
DECIMAL = re.compile(r"\d+(\.\d+)?\Z")
SYMBOL = re.compile(r"[^\W_][\w-]{0,39}\Z")
STATUS = re.compile(r"[A-Z_]{1,20}\Z")  # a Binance order status (FILLED in every row measured; stored, not assumed)
COIN_MARGINED = re.compile(r".+USD\Z")  # a Binance pair settled in its coin (ETHUSD; USD-M pairs end USDT or USDC)
BINANCE_KEYS = {"e", "E", "o"}
BINANCE_ORDER = {"s", "S", "o", "f", "q", "p", "ap", "X", "l", "z", "T", "ps", "st"}
BYBIT_KEYS = {"topic", "type", "ts", "data"}
BYBIT_ROW = {"T", "s", "S", "v", "p"}
BYBIT_ANSWER = {"success", "ret_msg", "conn_id", "req_id", "op"}
LINE_KEYS = {"at", "mono", "conn", "event", "text"}
EVENTS = {"open", "subscribe", "frame", "pong", "close"}
COLUMNS = {"binance": ("symbol", "trade_time", "side", "price", "avg_price", "orig_qty", "filled_qty",
                       "last_filled_qty", "status", "event_time"),
           "bybit": ("symbol", "updated_time", "side", "size", "bankruptcy_price", "message_time")}


def path(spool: Path, venue: str, day: date) -> Path:
    return Path(spool) / venue / f"{day.isoformat()}.jsonl"


def spool_days(spool: Path) -> list[date]:
    """The UTC days with a spool file of either venue, oldest first."""
    found = set()
    for venue in VENUES:
        for item in (Path(spool) / venue).glob("*.jsonl"):
            try:
                found.add(date.fromisoformat(item.stem))
            except ValueError:
                continue
    return sorted(found)


def pending(spool: Path, imports: list[dict], now: datetime) -> list[date]:
    """The closed days (GRACE past their end) with a spool file after the latest imported day, oldest first;
    SPOOL_MISSING when the spool has no venue directory (a wrong path or mount would otherwise read as caught up)."""
    if not any((Path(spool) / venue).is_dir() for venue in VENUES):
        raise _refuse(f"{spool} holds no venue directory of the recorder's spool", "SPOOL_MISSING",
                      missing=(str(spool),))
    latest = max((date.fromisoformat(item["day"]) for item in imports), default=None)
    closed = (now.astimezone(UTC) - GRACE).date()
    return [day for day in spool_days(spool) if day < closed and (latest is None or day > latest)]


# Reading a day

def _int(value, label: str) -> int:
    if type(value) is not int:
        raise _refuse(f"{label}: {value!r} is not an integer", "SOURCE_SHAPE", missing=(label,))
    return value


def _decimal(value, label: str, column: tuple[int, int]) -> str:
    if not isinstance(value, str) or not DECIMAL.fullmatch(value):
        raise _refuse(f"{label}: {value!r} is not an exact decimal", "SOURCE_SHAPE", missing=(label,))
    text = metrics.exact(value, label, column[1], column[0])
    return text.rstrip("0").rstrip(".") if "." in text else text  # one text per value: 1.50 and 1.5 are one key


def _symbol(value, label: str) -> str:
    if not isinstance(value, str) or not SYMBOL.fullmatch(value):
        raise _refuse(f"{label}: {value!r} is not a contract code", "SOURCE_SHAPE", missing=(label,))
    return value


def _keys(value, keys: set[str], label: str) -> dict:
    if not isinstance(value, dict) or set(value) != keys:
        found = sorted(value) if isinstance(value, dict) else type(value).__name__
        raise _refuse(f"{label}: keys {found}, expected {sorted(keys)}", "SOURCE_SHAPE", missing=(label,))
    return value


def binance_row(message: dict, label: str) -> tuple:
    """A forceOrder event as its stored key, the event time `E` last."""
    _keys(message, BINANCE_KEYS, label)
    order = _keys(message["o"], BINANCE_ORDER, label + " o")
    symbol = _symbol(order["s"], label + " s")
    pair = symbol.split("_")[0]
    expected = {"e": (message["e"], "forceOrder"), "f": (order["f"], "IOC"), "o": (order["o"], "LIMIT"),
                "ps": (order["ps"], pair), "st": (order["st"], 2 if COIN_MARGINED.fullmatch(pair) else 1)}
    for name, (found, wanted) in expected.items():
        if found != wanted:
            raise _refuse(f"{label}: {name} is {found!r}, not {wanted!r}", "SOURCE_SHAPE", missing=(f"{label} {name}",))
    if order["S"] not in ("BUY", "SELL") or not isinstance(order["X"], str) or not STATUS.fullmatch(order["X"]):
        raise _refuse(f"{label}: S is {order['S']!r}, X {order['X']!r}", "SOURCE_SHAPE", missing=(label,))
    event = _int(message["E"], label + " E")
    key = (symbol, _int(order["T"], label + " T"), order["S"], _decimal(order["p"], label + " p", PRICE),
           _decimal(order["ap"], label + " ap", PRICE), _decimal(order["q"], label + " q", SIZE),
           _decimal(order["z"], label + " z", SIZE), _decimal(order["l"], label + " l", SIZE), order["X"], event)
    return key


def bybit_rows(message: dict, label: str) -> list[tuple]:
    """An allLiquidation message's rows as stored keys, the message time `ts` last."""
    _keys(message, BYBIT_KEYS, label)
    stamp = _int(message["ts"], label + " ts")
    if message["type"] != "snapshot" or not isinstance(message["data"], list) or not message["data"]:
        raise _refuse(f"{label}: type {message['type']!r} with {type(message['data']).__name__} data", "SOURCE_SHAPE",
                      missing=(label,))
    found = []
    for item in message["data"]:
        item = _keys(item, BYBIT_ROW, label + " data")
        symbol = _symbol(item["s"], label + " s")
        if message["topic"] != f"allLiquidation.{symbol}" or item["S"] not in ("Buy", "Sell"):
            raise _refuse(f"{label}: a {item['S']!r} row of {symbol} under topic {message['topic']!r}", "SOURCE_SHAPE",
                          missing=(label,))
        found.append((symbol, _int(item["T"], label + " T"), item["S"], _decimal(item["v"], label + " v", SIZE),
                      _decimal(item["p"], label + " p", PRICE), stamp))
    return found


@dataclass
class _Connection:
    """One connection of the spool (a name is reused when the recorder restarts: each open starts another)."""
    number: int
    opened: int | None = None  # at of its open line; None when it opened before the lines read or elsewhere
    last: tuple[int, int] | None = None  # (at, mono) of its latest line
    since: int | None = None  # at of the first line of its current stretch without a break
    vouched: int | None = None  # at of the stretch's latest row received in time
    behind: bool = False  # a row came too early: its wall clock lags until it jumps
    requests: dict = field(default_factory=dict)  # Bybit req_id -> its symbols
    symbols: dict = field(default_factory=dict)  # Bybit symbol -> at of the answer confirming it


@dataclass
class _Scan:
    venue: str
    rows: dict = field(default_factory=lambda: defaultdict(lambda: {"count": Counter(), "first": None, "last": None}))
    spans: dict = field(default_factory=lambda: defaultdict(list))  # symbol ("" the venue) -> [[from, to]]
    open: dict = field(default_factory=dict)  # connection name -> _Connection
    count: int = 0
    unreadable: Counter = field(default_factory=Counter)  # day -> unreadable lines
    early: Counter = field(default_factory=Counter)  # day -> receipts more than EARLY before the venue's time
    refused: list = field(default_factory=list)  # Bybit subscription answers that failed

    def end(self, conn: _Connection, stop: int | None = None) -> None:
        """The connection's current stretch ends at `stop`, by default its latest line."""
        if conn.since is None or conn.last is None:
            return
        stop = conn.last[0] if stop is None else stop
        if self.venue == "binance":
            if conn.opened is not None:
                self.spans[""].append([max(conn.since, conn.opened), stop])
        elif conn.opened is not None:
            for symbol, confirmed in conn.symbols.items():
                self.spans[symbol].append([max(conn.since, confirmed), stop])
        conn.since = conn.vouched = None

    def line(self, raw: str, day: date, rows: bool) -> None:
        try:
            line = json.loads(raw)
            if (not isinstance(line, dict) or not {"at", "mono", "conn", "event"} <= set(line) <= LINE_KEYS
                    or line["event"] not in EVENTS or type(line["at"]) is not int or type(line["mono"]) is not int
                    or not isinstance(line["conn"], str) or ("text" in line) != (line["event"] != "pong")
                    or not isinstance(line.get("text", ""), str)):
                raise ValueError("not a spool line")
        except ValueError:
            # A line cut short by a crash (and the one appended to it): the frames between the lines around it may
            # be lost, so every connection of the venue breaks there.
            self.unreadable[day] += 1
            for conn in self.open.values():
                self.end(conn)
            return
        at, event = line["at"], line["event"]
        name = line["conn"]
        conn = self.open.get(name)
        if event == "open" or conn is None:
            if conn is not None:  # the recorder restarted: its old connection ended at its last line
                self.end(conn)
            self.count += 1
            conn = self.open[name] = _Connection(self.count, at if event == "open" and line["text"] == URLS[self.venue]
                                                 else None)
        if conn.last is not None:
            jumped = abs((at - line["mono"]) - (conn.last[0] - conn.last[1])) > JUMP
            if jumped or at - conn.last[0] > HEARTBEAT:
                self.end(conn)
            conn.behind = conn.behind and not jumped
        if event == "close":
            self.end(conn)
            del self.open[name]
            return
        if conn.since is None and not conn.behind:
            conn.since = at
        conn.last = (at, line["mono"])
        if not rows:  # the day after: only whether each connection lives on
            return
        label = f"{self.venue} {day} {name} {at}"
        try:
            message: Any = json.loads(line["text"]) if event in ("subscribe", "frame") else None
        except ValueError as exc:
            raise _refuse(f"{label}: a {event} does not parse ({exc})", "SOURCE_SHAPE", missing=(label,)) from exc
        if event == "subscribe":
            try:
                conn.requests[message["req_id"]] = [topic.removeprefix("allLiquidation.") for topic in message["args"]]
            except (TypeError, KeyError, AttributeError) as exc:
                raise _refuse(f"{label}: a subscribe request without req_id and args", "SOURCE_SHAPE",
                              missing=(label,)) from exc
        elif event == "frame":
            self.frame(conn, message, at, day, label)

    def frame(self, conn: _Connection, message, at: int, day: date, label: str) -> None:
        if not isinstance(message, dict):
            raise _refuse(f"{label}: a frame is {type(message).__name__}", "SOURCE_SHAPE", missing=(label,))
        if self.venue == "bybit" and "op" in message:
            _keys(message, BYBIT_ANSWER, label)
            if message["op"] == "subscribe":  # an answer to a request before the lines read is not this day's
                symbols = conn.requests.pop(message["req_id"], None)
                if symbols is not None and message["success"] is True:
                    conn.symbols.update({symbol: at for symbol in symbols if symbol not in conn.symbols})
                elif symbols is not None:
                    self.refused.append({"at": at, "symbols": symbols, "ret_msg": message["ret_msg"]})
            elif not (message["op"] == "ping" and message["success"] is True):
                raise _refuse(f"{label}: an unknown answer {json.dumps(message)[:200]}", "SOURCE_SHAPE",
                              missing=(label,))
            return
        for key in [binance_row(message, label)] if self.venue == "binance" else bybit_rows(message, label):
            row = self.rows[key]
            row["count"][conn.number] += 1
            row["first"] = at if row["first"] is None else min(row["first"], at)
            row["last"] = at if row["last"] is None else max(row["last"], at)
            if at < key[-1] - EARLY:
                self.early[day] += 1
                if conn.vouched is None:
                    conn.since = None
                self.end(conn, conn.vouched)
                conn.behind = True
            elif conn.since is not None:
                conn.vouched = at

    def finish(self) -> None:
        for conn in self.open.values():
            self.end(conn)


def scan(spool: Path, venue: str, day: date) -> _Scan:
    """The venue's day: the day before whole, the day, and the day after until 2 x HEARTBEAT past its start."""
    found = _Scan(venue)
    limit = series._day_ms(day + timedelta(days=1)) + 2 * HEARTBEAT
    for current, rows in ((day - timedelta(days=1), True), (day, True), (day + timedelta(days=1), False)):
        try:
            stream = path(spool, venue, current).open(encoding="utf-8")
        except FileNotFoundError:
            continue
        with stream:
            for raw in stream:
                if not raw.endswith("\n"):  # the line being written, or in a closed day one a crash cut short
                    if rows:
                        found.line(raw, current, rows)
                    break
                stamp = raw[6:raw.find(",")] if raw.startswith('{"at":') else ""
                if not rows and stamp.isdigit() and int(stamp) > limit:
                    break
                found.line(raw, current, rows)
    found.finish()
    return found


def _union(spans: list[list[int]], low: int, high: int) -> list[list[int]]:
    merged: list[list[int]] = []
    for start, stop in sorted([max(start, low), min(stop, high)] for start, stop in spans):
        if start >= stop:
            continue
        if merged and start <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], stop)
        else:
            merged.append([start, stop])
    return merged


# The import (market.import_liquidations)

def import_day(profile: dict, spool: Path, day: date, log=print, now: datetime | None = None) -> dict:
    """market.import_liquidations: one closed UTC day of the spool after the latest imported day as one commit."""
    started = time.monotonic()
    now = now or datetime.now(UTC)
    if not isinstance(day, date) or isinstance(day, datetime) or day >= (now.astimezone(UTC) - GRACE).date():
        raise _refuse(f"{day} is no closed UTC day yet", "DAY_INVALID", missing=(str(day),))
    if not any(path(spool, venue, day).is_file() for venue in VENUES):
        raise _refuse(f"the spool {spool} holds no file of {day}", "SPOOL_MISSING", missing=(str(day),))
    conn = store.connect(profile, "import")
    try:
        store.lock(conn)
        if conn.empty:
            raise _refuse("the market database holds no bar import yet", "MARKET_EMPTY")
        if conn.rows("SELECT table_name FROM dolt_status"):
            raise _refuse("the market database has uncommitted changes", "DIRTY_WORKING_SET", missing=("dolt_status",))
        store.require_commit_checks(conn)
        for table in (*TABLES.values(), "liquidation_watch"):
            if not conn.rows("SHOW TABLES LIKE %s", (table,)):
                raise _refuse(f"{table} is missing; run market upgrade first", "SCHEMA_MISMATCH", missing=(table,))
        held = [date.fromisoformat(item["day"]) for item in store.liquidation_imports(conn)]
        if held and day <= max(held):
            raise _refuse(f"the market database holds liquidations through {max(held)}", "DAY_EXISTS",
                          missing=(str(day),))
        before = day - timedelta(days=1)
        if before not in held and any(path(spool, venue, before).is_file() for venue in VENUES):
            raise _refuse(f"the spool holds {before}, which is not imported yet", "DAY_INVALID", missing=(str(before),))
        readings = {venue: _import(conn, spool, venue, day, log) for venue in VENUES}
        receipt = {"import": IMPORT, "day": day.isoformat(), "heartbeat_ms": HEARTBEAT, "clock_jump_ms": JUMP,
                   "early_ms": EARLY, "readings": readings}
        # A day without rows or watch is still a day read: its commit is the receipt.
        commit = store._commit(conn, json.dumps(receipt, separators=(",", ":"), ensure_ascii=False), allow_empty=True)
    except BaseException:
        try:
            conn.raw.rollback()
        except pymysql.MySQLError:
            pass
        raise
    finally:
        conn.close()  # also releases the import lock
    return {**receipt, "liquidation_rows": sum(item["rows"] for item in readings.values()), "market_commit": commit,
            "seconds": round(time.monotonic() - started, 1)}


def _stored(conn, venue: str, key: tuple) -> int | None:
    found = conn.rows(f"SELECT n FROM {TABLES[venue]} WHERE " + " AND ".join(f"{name} = %s" for name in COLUMNS[venue]),
                      key)
    return int(found[0][0]) if found else None


def _import(conn, spool: Path, venue: str, day: date, log) -> dict:
    """One venue's rows and watch of `day`, written into the open transaction; its readings."""
    low, high = series._day_ms(day), series._day_ms(day + timedelta(days=1))
    found = scan(spool, venue, day)
    # Rows on two connections are one liquidation: they must agree on everything stored, so the event without its
    # venue time is seen at the same venue times on each (or a liquidation would be stored twice).
    times: dict = defaultdict(lambda: defaultdict(set))
    for key, row in found.rows.items():
        for number in row["count"]:
            times[key[:-1]][number].add(key[-1])
    for event, seen in times.items():
        sets = list(seen.values())
        if any(not a & b for i, a in enumerate(sets) for b in sets[i + 1:]):
            raise _refuse(f"{venue} {day}: connections disagree on the venue time of {event}: "
                          f"{sorted(set().union(*sets))}", "STREAMS_DISAGREE", missing=(f"{venue} {day}",))
    inserted, lags, merged, repeated, events = [], [], 0, 0, 0
    for key, row in found.rows.items():
        n = max(row["count"].values())
        first = row["first"]
        if first < low:  # first received the day before, whose import holds it
            if row["last"] < low:
                continue
            stored = _stored(conn, venue, key)
            if stored is None or stored < n:
                raise _refuse(f"{venue} {day}: {key} of the day before is held {stored} times, seen {n} times",
                              "STORED_ROW_DIFFERS", missing=(f"{venue} {day}",))
            continue
        if first >= high:
            continue
        # A row held by a day before the one read was received over a day earlier, so its venue time is before
        # midnight + EARLY (unless a clock lagged by a day: the insert's duplicate key then fails the day).
        if key[-1] < low + EARLY and (stored := _stored(conn, venue, key)) is not None:
            if stored < n:
                raise _refuse(f"{venue} {day}: {key} is held {stored} times, seen {n} times", "STORED_ROW_DIFFERS",
                              missing=(f"{venue} {day}",))
            merged += 1
            continue
        merged += len(row["count"]) > 1
        repeated += n > 1
        events += n
        lags.append(first - key[-1])
        inserted.append((*key, first, n))
    marks = ",".join(["%s"] * (len(COLUMNS[venue]) + 2))
    conn.many(f"INSERT INTO {TABLES[venue]} VALUES ({marks})", sorted(inserted))
    watched = {symbol: _union(spans, low, high) for symbol, spans in found.spans.items()}
    conn.many("INSERT INTO liquidation_watch VALUES (%s, %s, %s, %s)",
              [(venue, symbol, start, stop) for symbol, spans in sorted(watched.items()) for start, stop in spans])
    lags.sort()
    log(f"{venue} {day}: {len(inserted)} rows, {sum(len(spans) for spans in watched.values())} watch intervals")
    return {"rows": len(inserted), "liquidations": events, "repeated_rows": repeated, "merged_rows": merged,
            "lag_ms": {"median": statistics.median(lags) if lags else None,
                       "p99": lags[min(len(lags) - 1, int(0.99 * len(lags)))] if lags else None},
            "unreadable_lines": found.unreadable.get(day, 0), "early_receipts": found.early.get(day, 0),
            "refused_subscriptions": [
                item for item in found.refused if low <= item["at"] < high]}


# Coverage

SIZES = ("1000000", "10000", "1000", "1M")  # contract sizes written into a symbol, before or after its coin


def coin(base: str) -> str:
    """The coin of a contract's base, its size dropped: 1000PEPE and PEPE are PEPE, SHIB1000 is SHIB."""
    for size in SIZES:
        if len(base) > len(size) + 1 and base.startswith(size):
            return base[len(size):]
        if len(base) > len(size) + 1 and base.endswith(size):
            return base[:-len(size)]
    return base


def bybit_symbols(symbol: str, listed: list[str]) -> list[str]:
    """The Bybit contracts of a Binance one among `listed`: the same coin and settlement (Binance's USDT contracts
    are Bybit's USDT ones, its USDC contracts Bybit's PERP ones), dated contracts excluded."""
    for quote, theirs in (("USDT", "USDT"), ("USDC", "PERP")):
        if symbol.endswith(quote):
            wanted = coin(symbol[:-len(quote)])
            return sorted(item for item in listed if item.endswith(theirs) and "-" not in item
                          and coin(item[:-len(theirs)]) == wanted)
    return []
