"""The market directory (`market.open_market`, `market.read_table`, `market.write_file`, `market.place`):
financial data in plain Parquet files whose paths say what they hold.

    <root>/<table>/<YYYY-MM>.parquet            bar, funding, universe_month: one month of every contract
    <root>/<table>/<YYYY-MM>/<symbol>.parquet   agg_trade, quote, metrics
    <root>/instrument.parquet                   contract terms, appended to
    <root>/lock                                 the import lock

There is no manifest: what the files hold is what the market holds, and the code that imports them is the record of
how they were made. A market commit is the last day it includes, written as eight date digits and 24 zeros so it keeps
the shape the ledger's market_commit has; reading at a commit reads the rows of that day and before. A write goes to
a temporary file that the import sees as the file (`write_file`) until `place` renames it into position.
"""

from __future__ import annotations

from collections.abc import Iterable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from decimal import Decimal
import fcntl
import json
import os
from pathlib import Path
import re
import tempfile

import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.parquet as pq

from market import series, universe
from market.sources import DAY, _refuse


ROW_GROUP = 1_000_000  # rows per row group, fixed so the same rows give the same bytes however they were batched
DATED = re.compile(r"(\d{8})0{24}\Z")
MONTH = re.compile(r"\d{4}-\d{2}\Z")
FOREVER = 2**63 - 1

# The market commits the ledger cites from before commits were days, each read as the last day of data it held. An
# export at one is not promised to equal the one made then: the data before that day may have been completed since.
LEGACY: dict[str, date] = {
    "l1kfbo4b2of54ijpjnpn02ijdm175aqd": date(2026, 10, 18),
    "53tgna1pa02hb1t9v6r3h6pqh8d2e1s1": date(2026, 10, 18),
    "gc305h705ocn5fm3lcjjerln283gek2t": date(2026, 10, 25),
    "6ho8evfcea6p4680qbkeo3mdhaqjscp5": date(2026, 10, 25),
    "1kcbv73ptu3l3clg37g0f0k77c370kk8": date(2026, 10, 25),
    "dbnggsrnquf09evsncorvngiuan1br6a": date(2026, 10, 25),
    "pn5bee9mvj18qj1boc5v9b5faotu4ehb": date(2026, 10, 25),
    "iv711v5dpnv5qr62i5ejk3udk431f5k6": date(2026, 10, 31),
}

STRING, INT = pa.string(), pa.int64()


@dataclass(frozen=True)
class Table:
    schema: pa.Schema
    key: tuple[str, ...]
    time: str  # the column a file's [start_ms, end_ms) and read filters refer to
    layout: str = "month"  # month: one file a month; contract: one file a contract and month; single: one file


def _schema(*columns) -> pa.Schema:
    return pa.schema([pa.field(name, kind, nullable=nullable) for name, kind, nullable in columns])


# Each table's columns (integers at series.PRICE_SCALE and VOLUME_SCALE), primary key and time column.
INSTRUMENT = Table(_schema(
    ("symbol", STRING, False), ("observed_at", INT, False), ("terms_source", STRING, False),
    ("price_increment", STRING, False), ("size_increment", STRING, False), ("min_quantity", STRING, True),
    ("max_quantity", STRING, True), ("min_notional", STRING, True), ("min_price", STRING, True),
    ("max_price", STRING, True), ("classification", STRING, True)), ("symbol", "observed_at"), "observed_at", "single")
BAR = Table(_schema(
    ("symbol", STRING, False), ("price_type", STRING, False), ("ts_open", INT, False), ("open", INT, False),
    ("high", INT, False), ("low", INT, False), ("close", INT, False), ("volume", INT, False)),
    ("symbol", "price_type", "ts_open"), "ts_open")
FUNDING = Table(_schema(
    ("symbol", STRING, False), ("funding_time", INT, False), ("rate", pa.decimal128(20, 10), False)),
    ("symbol", "funding_time"), "funding_time")
UNIVERSE_MONTH = Table(_schema(
    ("universe_rule", STRING, False), ("month", pa.date32(), False), ("symbol", STRING, False)),
    ("universe_rule", "month", "symbol"), "month")
QUOTE = Table(_schema(
    ("symbol", STRING, False), ("ts", INT, False), ("agg_trade_id", INT, False), ("bid", INT, False),
    ("ask", INT, False)), ("symbol", "ts", "agg_trade_id"), "ts", "contract")
AGG_TRADE = Table(_schema(
    ("symbol", STRING, False), ("transact_time", INT, False), ("agg_trade_id", INT, False), ("price", INT, False),
    ("quantity", INT, False), ("first_trade_id", INT, False), ("last_trade_id", INT, False),
    ("is_buyer_maker", pa.bool_(), False)), ("symbol", "transact_time", "agg_trade_id"), "transact_time", "contract")
METRICS = Table(_schema(
    ("symbol", STRING, False), ("create_time", INT, False), ("sum_open_interest", pa.decimal128(38, 16), False),
    ("count_toptrader_long_short_ratio", pa.decimal128(38, 16), True),
    ("sum_toptrader_long_short_ratio", pa.decimal128(38, 16), True),
    ("count_long_short_ratio", pa.decimal128(38, 16), True)), ("symbol", "create_time"), "create_time", "contract")

# The tables this code reads and writes; a table with no file reads as empty.
TABLES = {"instrument": INSTRUMENT, "bar": BAR, "funding": FUNDING, "universe_month": UNIVERSE_MONTH, "quote": QUOTE,
          "agg_trade": AGG_TRADE, "metrics": METRICS}


def _zero(kind):
    return pa.scalar(Decimal(0), kind)


def row_rules(table: str, batch: pa.RecordBatch) -> list[tuple[str, pa.Array]]:
    """The row rules every data file keeps, as (rule, rows that keep it); a null keeps a rule."""
    c = batch.column
    if table == "instrument":
        inferred = pc.equal(c("terms_source"), "inferred")
        empty = pc.and_kleene(*[pc.is_null(c(name)) for name in ("min_quantity", "max_quantity")])
        for name in ("min_notional", "min_price", "max_price", "classification"):
            empty = pc.and_kleene(empty, pc.is_null(c(name)))
        return [("terms_source in (exchange_info, inferred)", pc.is_in(c("terms_source"),
                                                                        pa.array(["exchange_info", "inferred"]))),
                ("inferred terms carry no limits or classification", pc.equal(inferred, empty))]
    if table == "bar":
        low, high, open_, close, volume = (c(name) for name in ("low", "high", "open", "close", "volume"))
        ordered = pc.and_(pc.and_(pc.greater(low, 0), pc.less_equal(low, open_)), pc.less_equal(low, close))
        ordered = pc.and_(pc.and_(ordered, pc.greater_equal(high, open_)), pc.greater_equal(high, close))
        return [("price_type in (LAST, MARK)", pc.is_in(c("price_type"), pa.array(["LAST", "MARK"]))),
                ("low > 0 and low <= open, close <= high", ordered),
                ("volume >= 0", pc.greater_equal(volume, 0)),
                ("price_type = LAST or volume = 0", pc.or_(pc.equal(c("price_type"), "LAST"), pc.equal(volume, 0)))]
    if table == "funding":
        rate = c("rate")
        return [("-1 < rate < 1", pc.and_(pc.greater(rate, pa.scalar(Decimal(-1), rate.type)),
                                          pc.less(rate, pa.scalar(Decimal(1), rate.type))))]
    if table == "universe_month":
        return [("month is a month start", pc.equal(pc.day(c("month")), 1))]
    if table == "quote":
        return [("bid > 0 and ask > bid", pc.and_(pc.greater(c("bid"), 0), pc.greater(c("ask"), c("bid"))))]
    if table == "metrics":
        times = c("create_time").to_numpy(zero_copy_only=False)
        rules = [("create_time on a 5-minute grid", pa.array(times % 300_000 == 0))]
        for name in ("sum_open_interest", "count_toptrader_long_short_ratio", "sum_toptrader_long_short_ratio",
                     "count_long_short_ratio"):
            rules.append((f"{name} >= 0", pc.fill_null(pc.greater_equal(c(name), _zero(c(name).type)), True)))
        return rules
    return []


@dataclass(frozen=True)
class DataFile:
    """One file of a table: its path under the market directory and the [start_ms, end_ms) its rows lie in."""
    relative: str
    table: str
    symbol: str | None
    start_ms: int
    end_ms: int


@dataclass(frozen=True)
class Written:
    """A file written beside its place (`write_file`), and its place's (inode, mtime) when the import read it."""
    relative: str
    temporary: str
    stamp: tuple[int, int] | None


@dataclass
class Market:
    """One opened market directory as one role."""

    root: Path
    role: str
    locked: bool = False
    pending: dict[str, Written] = field(default_factory=dict, repr=False)  # written, not yet placed: an import reads them
    seen: dict[str, tuple[int, int] | None] = field(default_factory=dict, repr=False)  # read under the import lock

    @property
    def empty(self) -> bool:
        return not entries(self, "bar")


# Bytes on disk

def _sync(fd: int) -> None:
    # os.fsync on macOS leaves the data in the drive's cache; F_FULLFSYNC reaches the disk.
    if hasattr(fcntl, "F_FULLFSYNC"):
        try:
            fcntl.fcntl(fd, fcntl.F_FULLFSYNC)
            return
        except OSError:
            pass
    os.fsync(fd)


def _sync_dir(path: Path) -> None:
    fd = os.open(path, os.O_RDONLY)
    try:
        _sync(fd)
    finally:
        os.close(fd)


def _stamp(path: Path) -> tuple[int, int] | None:
    try:
        found = path.stat()
    except FileNotFoundError:
        return None
    return found.st_ino, found.st_mtime_ns


def file_bytes(market: Market, entry: DataFile) -> pa.Buffer:
    """A data file's bytes, memory-mapped: its pages are the page cache's, not the process's, and stay mapped while
    the buffer lives, even once the file is replaced. An import reads what it has written and not yet placed."""
    path = market.root / entry.relative
    if market.locked:
        market.seen.setdefault(entry.relative, _stamp(path))
    written = market.pending.get(entry.relative)
    return pa.memory_map(written.temporary if written is not None else str(path)).read_buffer()


# Opening

def open_market(profile: dict, role: str) -> Market:
    if role not in ("import", "reader"):
        raise _refuse(f"role {role!r} is not import or reader", "ROLE_UNKNOWN")
    if not profile.get("root"):
        raise _refuse("the market profile names no market directory (root)", "MARKET_UNREACHABLE")
    root = Path(profile["root"])
    if not root.is_dir():
        raise _refuse(f"the market directory {root} does not exist", "MARKET_UNREACHABLE", missing=(str(root),))
    return Market(root=root, role=role)


# Paths

def relative_path(table: str, month: date | None, symbol: str | None = None) -> str:
    layout = TABLES[table].layout
    if layout == "single":
        return f"{table}.parquet"
    return f"{table}/{month:%Y-%m}/{symbol}.parquet" if layout == "contract" else f"{table}/{month:%Y-%m}.parquet"


def data_file(table: str, month: date | None, symbol: str | None = None) -> DataFile:
    low, high = (series._day_ms(month), series._day_ms(universe.next_month(month))) if month is not None else (0, FOREVER)
    return DataFile(relative_path(table, month, symbol), table, symbol, low, high)


def _on_disk(market: Market, table: str, symbols: list[str] | None) -> Iterator[DataFile]:
    layout, folder = TABLES[table].layout, market.root / table
    if layout == "single":
        if (market.root / f"{table}.parquet").is_file():
            yield data_file(table, None)
        return
    if not folder.is_dir():
        return
    for item in os.scandir(folder):
        name = item.name.removesuffix(".parquet") if layout == "month" else item.name
        if not MONTH.fullmatch(name):
            continue
        month = date.fromisoformat(f"{name}-01")
        if layout == "month":
            yield data_file(table, month)
            continue
        for found in os.scandir(item.path):
            if found.name.endswith(".parquet") and not found.name.startswith("."):
                symbol = found.name.removesuffix(".parquet")
                if symbols is None or symbol in symbols:
                    yield data_file(table, month, symbol)


def entries(market: Market, table: str, symbols: list[str] | None = None, start_ms: int | None = None,
            end_ms: int | None = None) -> list[DataFile]:
    """The files of `table` that may hold rows of the request, those the import has not placed yet included, in
    start order (a table's files of one contract are disjoint in time, so for one contract this is time order)."""
    found = {entry.relative: entry for entry in _on_disk(market, table, symbols)}
    for relative in market.pending:
        if relative.startswith(f"{table}/") or relative == f"{table}.parquet":
            parts = relative.removesuffix(".parquet").split("/")
            month = date.fromisoformat(f"{parts[1]}-01") if len(parts) > 1 else None
            symbol = parts[2] if len(parts) > 2 else None
            if symbol is None or symbols is None or symbol in symbols:
                found[relative] = data_file(table, month, symbol)
    return sorted((entry for entry in found.values() if (start_ms is None or entry.end_ms > start_ms)
                   and (end_ms is None or entry.start_ms < end_ms)),
                  key=lambda entry: (entry.start_ms, entry.symbol or ""))


# Market commits

def commit_of(day: date) -> str:
    return f"{day:%Y%m%d}" + "0" * 24


def commit_day(commit: str) -> date | None:
    """The last day a market commit includes; None when it is neither a day nor one of LEGACY."""
    if commit in LEGACY:
        return LEGACY[commit]
    found = DATED.fullmatch(commit) if isinstance(commit, str) else None
    try:
        return datetime.strptime(found.group(1), "%Y%m%d").date() if found else None
    except ValueError:
        return None


def last_time(market: Market, entry: DataFile) -> int | None:
    """The latest value of the table's time column in a file, from its footer's statistics; None with no rows."""
    reader = pq.ParquetFile(pa.BufferReader(file_bytes(market, entry)))
    column = reader.schema_arrow.get_field_index(TABLES[entry.table].time)
    found = [stats.max for group in range(reader.num_row_groups)
             if (stats := reader.metadata.row_group(group).column(column).statistics) is not None and stats.has_min_max]
    return max(found, default=None)


def last_day(market: Market, table: str) -> date | None:
    """The last day a table holds, read from the newest file's footer: imports write closed days whole."""
    for entry in reversed(entries(market, table)):
        moment = last_time(market, entry)
        if moment is not None:
            return series._ms_day(moment)
    return None


def bar_months_through(market: Market) -> dict[date, date]:
    """{month: the first day it does not hold} of the bars."""
    found = {}
    for entry in entries(market, "bar"):
        moment = last_time(market, entry)
        if moment is not None:
            found[series._ms_day(entry.start_ms)] = series._ms_day(moment) + timedelta(days=1)
    return found


def _metrics_day(market: Market) -> date | None:
    """The last complete day of the contracts whose metrics are followed, those holding a file in the table's newest
    month or the one before it (the newer may not have begun for every contract): the earliest of their last days."""
    held = entries(market, "metrics")
    if not held:
        return None
    since = series._day_ms((series._ms_day(held[-1].start_ms) - timedelta(days=1)).replace(day=1))
    latest: dict[str, date] = {}
    for entry in held:
        moment = last_time(market, entry) if entry.start_ms >= since else None
        if moment is not None:
            symbol = str(entry.symbol)
            latest[symbol] = max(latest.get(symbol, series._ms_day(moment)), series._ms_day(moment))
    return min(latest.values(), default=None)


def latest_day(market: Market) -> date | None:
    """The newest day a market commit can name: the earlier of the last complete days of the bars and the followed
    metrics. A month's last day waits for the next month's members, which its commit reads: named only once they
    stand, that commit's membership never changes. None with no bars."""
    bars = last_day(market, "bar")
    if bars is None:
        return None
    metrics = _metrics_day(market)
    day = bars if metrics is None else min(bars, metrics)
    after = day + timedelta(days=1)
    if after.day == 1 and not entries(market, "universe_month", None, series._day_ms(after), series._day_ms(universe.next_month(after))):
        return day - timedelta(days=1)
    return day


def latest_commit(market: Market) -> str | None:
    day = latest_day(market)
    return None if day is None else commit_of(day)


def resolve_commit(market: Market, ref: str | None) -> str:
    if ref is None or ref in ("", "main", "head"):
        commit = latest_commit(market)
        if commit is None:
            raise _refuse("the market holds no bars yet", "MARKET_EMPTY")
        return commit
    day = commit_day(ref)
    if day is None:
        raise _refuse(f"{ref!r} is not main, head or a market commit (a day's eight digits and 24 zeros)", "UNKNOWN_REF",
                      missing=(ref,))
    if ref not in LEGACY:
        latest = latest_day(market)
        if latest is None or day > latest:
            raise _refuse(f"{ref!r} is after the newest day this market holds, {latest}", "UNKNOWN_REF", missing=(ref,))
    return ref


# Reading

def _times(table: Table, column: pa.Array) -> pa.Array:
    if table.schema.field(table.time).type == pa.date32():
        return pc.multiply(pc.cast(pc.cast(column, pa.int32()), INT), DAY)
    return column


def commit_end(table: str, commit: str) -> int:
    """The end of what a commit reads of a table: the rows of its last day and before; the universe's months through
    that of the day after it (a month's members depend only on the days before it, so the eve of a month covers its
    first day); the terms observed through the day after it (a day's data is imported the next day, its terms observed
    then)."""
    day = commit_day(commit)
    if day is None:
        raise _refuse(f"{commit!r} is not a market commit", "UNKNOWN_REF", missing=(str(commit),))
    if table == "universe_month":
        return series._day_ms(universe.next_month((day + timedelta(days=1)).replace(day=1)))
    return series._day_ms(day) + (2 if table == "instrument" else 1) * DAY


def _visible(table: str, commit: str | None, end_ms: int | None) -> int | None:
    if commit is None:
        return end_ms
    stop = commit_end(table, commit)
    return stop if end_ms is None else min(stop, end_ms)


def file_batches(data: pa.Buffer, table: Table, symbols: list[str] | None = None, start_ms: int | None = None,
                 end_ms: int | None = None) -> Iterator[pa.RecordBatch]:
    """The rows of one data file's bytes that fall in the request, row group by row group."""
    reader = pq.ParquetFile(pa.BufferReader(data))
    names = sorted(set(symbols)) if symbols is not None else None
    wanted = pa.array(names, STRING) if names is not None else None
    for group in range(reader.num_row_groups):
        stats = reader.metadata.row_group(group).column(reader.schema_arrow.get_field_index(table.time)).statistics
        if stats is not None and stats.has_min_max and table.schema.field(table.time).type == INT:
            if (start_ms is not None and stats.max < start_ms) or (end_ms is not None and stats.min >= end_ms):
                continue
        if names is not None:  # files of several contracts are sorted by symbol first: a row group holds a few
            stats = reader.metadata.row_group(group).column(reader.schema_arrow.get_field_index("symbol")).statistics
            if stats is not None and stats.has_min_max and not any(stats.min <= name <= stats.max for name in names):
                continue
        batch = reader.read_row_group(group)
        keep = None
        if start_ms is not None or end_ms is not None:
            times = _times(table, batch.column(table.time))
            keep = pc.and_(pc.greater_equal(times, start_ms if start_ms is not None else -2**63),
                           pc.less(times, end_ms if end_ms is not None else FOREVER))
        if wanted is not None:
            member = pc.is_in(batch.column("symbol"), wanted)
            keep = member if keep is None else pc.and_(keep, member)
        if keep is not None:
            batch = batch.filter(keep)
        yield from batch.to_batches()


def read_table(market: Market, commit: str | None, table: str, symbols: list[str] | None = None,
               start_ms: int | None = None, end_ms: int | None = None) -> Iterator[pa.RecordBatch]:
    """The rows of the request at `commit` in key order; every row held with commit None (an import's own reads)."""
    definition = TABLES[table]
    end_ms = _visible(table, commit, end_ms)
    found = sorted(entries(market, table, symbols, start_ms, end_ms),
                   key=lambda entry: (entry.symbol or "", entry.start_ms))
    if definition.key[:2] == ("symbol", definition.time) and all(entry.symbol is not None for entry in found):
        # One contract per file, disjoint intervals and a key of (symbol, time, ...): files in (symbol, start)
        # order are in key order. bar's key puts price_type before the time, so its files are gathered.
        for entry in found:
            yield from file_batches(file_bytes(market, entry), definition, symbols, start_ms, end_ms)
        return
    # Files holding several contracts: their filtered rows are gathered and sorted, so a caller narrows the
    # read by contract or time.
    rows = [batch for entry in found for batch in file_batches(
        file_bytes(market, entry), definition, symbols, start_ms, end_ms)]
    if rows:
        gathered = pa.Table.from_batches(rows, definition.schema)
        yield from gathered.sort_by([(name, "ascending") for name in definition.key]).to_batches()


def scan(market: Market, commit: str | None, table: str, symbols: list[str] | None = None, start_ms: int | None = None,
         end_ms: int | None = None) -> Iterator[pa.RecordBatch]:
    """The rows read_table gives, file by file in start order and unsorted across contracts, so a caller
    that needs no key order (a count, a set of days, a digest per contract) holds one row group at a time."""
    definition = TABLES[table]
    end_ms = _visible(table, commit, end_ms)
    for entry in entries(market, table, symbols, start_ms, end_ms):
        yield from file_batches(file_bytes(market, entry), definition, symbols, start_ms, end_ms)


# Writing

@contextmanager
def lock(market: Market) -> Iterator[None]:
    """The import lock for the whole import. fcntl excludes only processes sharing one kernel: every writer runs in a
    container of the compose project whose volume holds the market directory, and `place` checks its targets for a
    writer outside it. What a killed import left is removed; what this one leaves unplaced is removed at its end."""
    if market.role != "import":
        raise _refuse("only the import role takes the import lock", "ROLE_UNKNOWN")
    if market.locked:
        raise RuntimeError("this market already holds its import lock")
    handle = open(market.root / "lock", "a+")
    try:
        try:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise _refuse(f"another import holds the lock of {market.root}", "CONCURRENT_IMPORT") from None
        for leftover in market.root.rglob(".*.tmp"):
            leftover.unlink(missing_ok=True)
        market.pending, market.seen = {}, {}
        market.locked = True
        yield
    finally:
        market.locked = False
        for written in market.pending.values():
            Path(written.temporary).unlink(missing_ok=True)
        market.pending = {}
        handle.close()


def _held(market: Market) -> None:
    if not market.locked:
        raise RuntimeError("a market write needs the import lock (files.lock)")


def first_out_of_order(previous: pa.RecordBatch | None, batch: pa.RecordBatch, key: tuple[str, ...]) -> int | None:
    """The index in batch of the first row whose key is not above the row before it, None when all ascend."""
    rows = batch.select(list(key))
    if previous is not None:
        rows = pa.Table.from_batches([previous.select(list(key)).slice(previous.num_rows - 1), rows]).combine_chunks()
        rows = rows.to_batches()[0]
    if rows.num_rows < 2:
        return None
    above = None
    for name in reversed(key):
        before, after = rows.column(name).slice(0, rows.num_rows - 1), rows.column(name).slice(1)
        step = pc.less(before, after)
        above = step if above is None else pc.or_(step, pc.and_(pc.equal(before, after), above))
    bad = pc.index(above, False).as_py()
    if bad < 0:
        return None
    # above[i] compares rows i and i + 1; row 0 is the previous batch's last row when there is one.
    return bad + 1 if previous is None else bad


def check_rows(table: str, definition: Table, batch: pa.RecordBatch, symbol: str | None, start_ms: int,
           end_ms: int) -> None:
    def fail(rule: str, rows: pa.Array) -> None:
        index = pc.index(rows, False).as_py()
        key = {name: batch.column(name)[index].as_py() for name in definition.key}
        raise _refuse(f"{table} row {key} breaks {rule}", "CHECK_FAILED", missing=(table,))

    for name in definition.schema.names:
        if not definition.schema.field(name).nullable and batch.column(name).null_count:
            fail(f"{name} is not null", pc.is_valid(batch.column(name)))
    times = _times(definition, batch.column(definition.time))
    inside = pc.and_(pc.greater_equal(times, start_ms), pc.less(times, end_ms))
    if not pc.all(inside).as_py():
        fail(f"{definition.time} within [{start_ms}, {end_ms})", inside)
    if symbol is not None and "symbol" in definition.schema.names:
        same = pc.equal(batch.column("symbol"), symbol)
        if not pc.all(same).as_py():
            fail(f"symbol = {symbol}", same)
    for rule, kept in row_rules(table, batch):
        if not pc.all(pc.fill_null(kept, True)).as_py():
            fail(rule, pc.fill_null(kept, True))


def write_file(market: Market, table: str, month: date | None, symbol: str | None,
               batches: Iterable[pa.RecordBatch]) -> Written:
    """The table's whole file of `month` (and `symbol`) written beside its place, every row checked. The import reads
    it as that file from now on; `place` puts it there."""
    _held(market)
    definition, entry = TABLES[table], data_file(table, month, symbol)
    target = market.root / entry.relative
    if not target.parent.is_dir():
        target.parent.mkdir(parents=True, exist_ok=True)
        _sync_dir(target.parent.parent)
    stamp = market.seen[entry.relative] if entry.relative in market.seen else _stamp(target)
    descriptor, name = tempfile.mkstemp(dir=target.parent, prefix=".", suffix=".tmp")
    os.close(descriptor)
    temporary = Path(name)
    previous, size = None, 0
    pending: list[pa.RecordBatch] = []
    try:
        with pq.ParquetWriter(temporary, definition.schema, compression="zstd", compression_level=3,
                              write_statistics=True) as writer:
            def flush(rows: int) -> None:
                nonlocal pending, size
                gathered = pa.Table.from_batches(pending, definition.schema).combine_chunks()
                writer.write_table(gathered.slice(0, rows), row_group_size=ROW_GROUP)
                pending = gathered.slice(rows).to_batches()
                size -= rows

            for batch in batches:
                if (batch.schema.names, batch.schema.types) != (definition.schema.names, definition.schema.types):
                    raise _refuse(f"{table} rows have columns {batch.schema.names} {batch.schema.types}, "
                                  f"the table has {definition.schema.names} {definition.schema.types}",
                                  "CHECK_FAILED", missing=(table,))
                batch = pa.RecordBatch.from_arrays(batch.columns, schema=definition.schema)
                check_rows(table, definition, batch, symbol, entry.start_ms, entry.end_ms)
                bad = first_out_of_order(previous, batch, definition.key)
                if bad is not None:
                    key = {name: batch.column(name)[bad].as_py() for name in definition.key}
                    raise _refuse(f"{table} row {key} does not follow the row before it in key order",
                                  "CHECK_FAILED", missing=(table,))
                if batch.num_rows:
                    previous = batch
                    pending.append(batch)
                    size += batch.num_rows
                while size >= ROW_GROUP:
                    flush(ROW_GROUP)
            if size:
                flush(size)
        with open(temporary, "rb") as handle:
            _sync(handle.fileno())
    except BaseException:
        temporary.unlink(missing_ok=True)
        raise
    written = Written(entry.relative, str(temporary), stamp)
    market.pending[entry.relative] = written
    return written


def place(market: Market, written: Iterable[Written]) -> None:
    """Rename written files into position in the order given: an import crashing between two renames has moved the
    market's newest day no further than its data. A place changed since the import read it was written by someone the
    lock does not reach (fcntl does not cross from the host into the container): CONCURRENT_IMPORT, nothing placed."""
    _held(market)
    items = list(written)
    for item in items:
        if _stamp(market.root / item.relative) != item.stamp:
            raise _refuse(f"{item.relative} changed under this import", "CONCURRENT_IMPORT", missing=(item.relative,))
    for item in items:
        target = market.root / item.relative
        os.replace(item.temporary, target)
        _sync_dir(target.parent)
        market.pending.pop(item.relative, None)
        market.seen[item.relative] = _stamp(target)


def data_tests(market: Market) -> list[str]:
    """The three member and terms checks a bar import must leave standing; the names of those it fails."""
    months = pa.Table.from_batches(list(read_table(market, None, "universe_month")), TABLES["universe_month"].schema)
    if not months.num_rows:
        return []
    failed = []
    latest = pc.max(months.column("month")).as_py()
    newest = months.filter(pc.equal(months.column("month"), pa.scalar(latest, pa.date32())))
    members = sorted(set(newest.column("symbol").to_pylist()))
    eve = (latest - date(1970, 1, 1)).days * DAY - DAY
    traded = set()
    for batch in read_table(market, None, "bar", members, eve, eve + DAY):
        minute = pa.array(batch.column("ts_open").to_numpy(zero_copy_only=False) % 60_000 == 0)
        last = batch.filter(pc.and_(pc.and_(pc.equal(batch.column("price_type"), "LAST"),
                                            pc.greater(batch.column("volume"), 0)), minute))
        traded.update(last.column("symbol").to_pylist())
    # Counted by rows: a member listed under two rules is two rows and one traded symbol, and fails.
    rows = newest.column("symbol").to_pylist()
    if len(rows) != len({symbol for symbol in rows if symbol in traded}):
        failed.append("universe_members_traded_on_the_eve")
    every = set(months.column("symbol").to_pylist())
    termed = set()
    for batch in read_table(market, None, "instrument", sorted(every)):
        termed.update(batch.column("symbol").to_pylist())
    if every - termed:
        failed.append("universe_members_have_terms")
    if set(newest.column("universe_rule").to_pylist()) != {universe.RULE}:
        failed.append("universe_rule_is_recorded")
    return failed


# A new market

NAME = re.compile(r"[A-Za-z0-9_-]{1,64}\Z")
KINDS = ("active", "isolated", "temporary")


def init_market(name: str, root: Path, kind: str) -> dict:
    """An empty market directory (its lock alone: the first import writes the first file) and its profile
    {name, kind: market, role, root} in the profile directory."""
    from ledger import db

    if not isinstance(name, str) or not NAME.fullmatch(name) or kind not in KINDS:
        raise _refuse("the profile name or kind is malformed", "INVALID_NAME", missing=(str(name), str(kind)))
    root = Path(root).expanduser().absolute()
    found = {}
    for path in sorted(db.home().glob("*.json")) if db.home().is_dir() else ():
        try:
            found[path.stem] = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
    if name in found:
        raise _refuse(f"a profile named {name} already exists; nothing is replaced", "MARKET_EXISTS", missing=(name,))
    markets = [value for value in found.values() if isinstance(value, dict) and value.get("kind") == "market"]
    active = [value for value in markets if value.get("role") == "active" and value.get("root")]
    if kind == "active" and active:
        raise _refuse("an active market directory already exists; there is only one", "MARKET_EXISTS",
                      missing=(active[0]["root"],))
    if kind == "active" and (db._inside(root, db.REPOSITORY) or db._is_temporary(root)):
        raise _refuse("the active market directory lies outside the source checkout and temporary roots",
                      "ISOLATION_BREACH", missing=(str(root),))
    if kind != "active" and any(db._inside(root, Path(value["root"])) for value in active):
        raise _refuse(f"{root} is the active market's directory; use another", "ISOLATION_BREACH",
                      missing=(str(root),))
    if root.exists() and (not root.is_dir() or any(root.iterdir())):
        raise _refuse(f"{root} is not an empty directory", "MARKET_EXISTS", missing=(str(root),))
    root.mkdir(parents=True, exist_ok=True)
    (root / "lock").touch()
    _sync_dir(root)
    profile = {"name": name, "kind": "market", "role": kind, "root": str(root)}
    db._private_write(db.home() / f"{name}.json", profile)
    return {**profile, "profile": str(db.home() / f"{name}.json")}
