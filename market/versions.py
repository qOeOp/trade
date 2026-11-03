"""The market directory (`market.open_market`, `market.read_table`, `market.write_file`,
`market.commit_version`; docs/plans/market-parquet-store.zh.md).

    <root>/files/<sha256>.parquet   data files, named by content, never changed
    <root>/files/<sha256>.json      import receipts, named by content
    <root>/versions/<id>.json       one version file per version: a base (with market_schema) lists every
                                    file and receipt, a delta only those it adds to its parent
    <root>/head                     the newest version id
    <root>/lock                     the import lock

A version id is the SHA-256 of the version file's canonical JSON in Dolt's alphabet, 32 characters,
so the ledger's market_commit keeps its shape; through its parent a delta's id pins everything back to its
base. Imports write deltas; an empty market's first version is a base. A base child lists every entry and
receipt of its parent unchanged; the eight versions converted from the Dolt commits the ledger pins keep those
commits' ids and are checked against CONVERTED instead. Every read hashes the bytes it actually read.
"""

from __future__ import annotations

import base64
from collections.abc import Iterable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import urllib.error
import urllib.request

import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.parquet as pq

from market import series, universe
from market.sources import _refuse


DAY = 86_400_000
ROW_GROUP = 1_000_000  # rows per row group, fixed so the same rows give the same bytes however they were batched
PREFIX = re.compile(r"[0-9a-v]{1,32}\Z")
COMMIT = re.compile(r"[0-9a-v]{32}\Z")
SHA256 = re.compile(r"[0-9a-f]{64}\Z")
FETCH_TIMEOUT = 60

# {market commit: SHA-256 of its version file} for the versions converted from the Dolt commits the ledger
# pins: their ids are those commits', not computed from content (plan §4).
CONVERTED: dict[str, str] = {
    "l1kfbo4b2of54ijpjnpn02ijdm175aqd": "b6a36fcf4ae4840c194be9ce90cdedb38fad89162b7be9c2b3b5fed25fc8b6a8",
    "53tgna1pa02hb1t9v6r3h6pqh8d2e1s1": "46944510b5b5a82d7f955167c425450c6d09390d4d9ca3b69961327c5d60390d",
    "gc305h705ocn5fm3lcjjerln283gek2t": "8809ed7ec268302259f4558b035646be8900cd950188b3c5439a87a09289c2ee",
    "6ho8evfcea6p4680qbkeo3mdhaqjscp5": "d501d6fb0fdd5289628da60945ee95f02f43a1045a0c52730b6ac5ca2723ad7e",
    "1kcbv73ptu3l3clg37g0f0k77c370kk8": "3d126f645f8efc5a7797a96b6cae05a8787d936fa754e31bc8ec18ad2b61c551",
    "dbnggsrnquf09evsncorvngiuan1br6a": "5f04f3f5d4af6415acba98f87018dfda26339ca012d1b9afaf5dfbd002d0012b",
    "pn5bee9mvj18qj1boc5v9b5faotu4ehb": "9c0c8fc4060488a7309619aebafdce622ce2fe8684439f0b2a510937a313925a",
    "iv711v5dpnv5qr62i5ejk3udk431f5k6": "1db6aa3a446d15e1e0480d61fa43c2b7c1bea95c3931265d867ae3ff5779ef3d",
}
# The version converted from the Dolt market's last main commit (ire8moaj1thrkbhpiggali41hdl92q1c): it and its
# ancestors were written by the conversion, not by an import, and their receipts are the Dolt market's.
CONVERTED_HEAD: str | None = "5sjp1ur4mn1tonrbru1u5ue70rf6el6r"

# The tables whose data files go to the public copy (market.publish): what an import observed and cannot fetch
# again (terms, members, bars and funding with their REST rows). The others are rebuilt from their receipts'
# archives and are never fetched from the public copy.
UPLOADED = frozenset({"instrument", "universe_month", "bar", "funding"})

STRING, INT = pa.string(), pa.int64()


@dataclass(frozen=True)
class Table:
    schema: pa.Schema
    key: tuple[str, ...]
    time: str  # the column a file's [start_ms, end_ms) and read filters refer to


def _schema(*columns) -> pa.Schema:
    return pa.schema([pa.field(name, kind, nullable=nullable) for name, kind, nullable in columns])


# Each table's columns (integers at the market_schema scales), primary key and time column.
INSTRUMENT = Table(_schema(
    ("symbol", STRING, False), ("observed_at", INT, False), ("terms_source", STRING, False),
    ("price_increment", STRING, False), ("size_increment", STRING, False), ("min_quantity", STRING, True),
    ("max_quantity", STRING, True), ("min_notional", STRING, True), ("min_price", STRING, True),
    ("max_price", STRING, True), ("classification", STRING, True)), ("symbol", "observed_at"), "observed_at")
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
    ("ask", INT, False)), ("symbol", "ts", "agg_trade_id"), "ts")
AGG_TRADE = Table(_schema(
    ("symbol", STRING, False), ("transact_time", INT, False), ("agg_trade_id", INT, False), ("price", INT, False),
    ("quantity", INT, False), ("first_trade_id", INT, False), ("last_trade_id", INT, False),
    ("is_buyer_maker", pa.bool_(), False)), ("symbol", "transact_time", "agg_trade_id"), "transact_time")
METRICS = Table(_schema(
    ("symbol", STRING, False), ("create_time", INT, False), ("sum_open_interest", pa.decimal128(38, 16), False),
    ("count_toptrader_long_short_ratio", pa.decimal128(38, 16), True),
    ("sum_toptrader_long_short_ratio", pa.decimal128(38, 16), True),
    ("count_long_short_ratio", pa.decimal128(38, 16), True)), ("symbol", "create_time"), "create_time")

# The tables this code reads and writes. A version listing a table not here is refused (_set_head); a table a
# version lists no file of reads as empty. Old version files keep a market_schema.version, which is not read.
TABLES = {"instrument": INSTRUMENT, "bar": BAR, "funding": FUNDING, "universe_month": UNIVERSE_MONTH, "quote": QUOTE,
          "agg_trade": AGG_TRADE, "metrics": METRICS}


def _zero(kind):
    return pa.scalar(Decimal(0), kind)


def row_rules(table: str, batch: pa.RecordBatch) -> list[tuple[str, pa.Array]]:
    """The row rules every data file keeps, as (rule, rows that keep it); a NULL keeps a rule, as in SQL."""
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


@dataclass
class Market:
    """One opened market directory as one role."""

    root: Path
    role: str
    origin: str | None
    writable: bool
    head: str | None = None
    version: dict | None = None
    locked: bool = False
    _files: dict[str, dict] = field(default_factory=dict, repr=False)  # version files as stored
    _views: dict[str, dict] = field(default_factory=dict, repr=False)  # complete versions asked for

    @property
    def empty(self) -> bool:
        return self.head is None

    @property
    def market_schema(self) -> dict:
        if self.version is not None:
            return self.version["market_schema"]
        return {"price_scale": series.PRICE_SCALE, "volume_scale": series.VOLUME_SCALE, "universe_rule": universe.RULE}


# Bytes on disk

def canonical(value) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def version_id(version: dict) -> str:
    digest = hashlib.sha256(canonical(version)).digest()
    return base64.b32hexencode(digest).decode().lower()[:32]


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


def _place(path: Path, data: bytes) -> None:
    """Write data to path durably: a temporary file synced, renamed, then the directory synced."""
    descriptor, name = tempfile.mkstemp(dir=path.parent, prefix=".", suffix=".tmp")
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(data)
            handle.flush()
            _sync(handle.fileno())
        os.replace(name, path)
    finally:
        Path(name).unlink(missing_ok=True)
    _sync_dir(path.parent)


def fetch_public(market: Market, relative: str) -> bytes | None:
    """The public copy's bytes of one path, None when it has none; MARKET_UNREACHABLE when it cannot be read."""
    if not market.origin:
        raise _refuse("the market profile names no public copy (origin)", "MARKET_UNREACHABLE", missing=(relative,))
    try:
        # r2.dev answers 403 to urllib's own User-Agent
        request = urllib.request.Request(f"{market.origin.rstrip('/')}/{relative}", headers={"User-Agent": "trade-market/2"})
        with urllib.request.urlopen(request, timeout=FETCH_TIMEOUT) as response:
            return response.read()
    except urllib.error.HTTPError as error:
        error.close()  # an HTTPError holds the response open
        if error.code == 404:
            return None
        raise _refuse(f"the public copy answered {error.code} for {relative}", "MARKET_UNREACHABLE",
                      missing=(relative,)) from error
    except (urllib.error.URLError, OSError) as error:
        raise _refuse(f"the public copy cannot be reached for {relative}: {error}", "MARKET_UNREACHABLE",
                      missing=(relative,)) from error


def _read(market: Market, relative: str, check, fetch: bool = True) -> pa.Buffer:
    """Local bytes of one path, else (when `fetch`) the public copy's into a writable directory; check(bytes)
    raises when they are not the expected ones and runs before anything fetched is kept. A local file is
    memory-mapped: its pages are the page cache's, not the process's, and stay mapped while the buffer lives."""
    path = market.root / relative
    try:
        data = pa.memory_map(str(path)).read_buffer()
    except FileNotFoundError:
        if not fetch:
            raise _refuse(f"{relative} is not in the market directory {market.root}; the public copy does not hold "
                          "it (it is rebuilt from its receipt)", "MARKET_UNREACHABLE", missing=(relative,)) from None
        if not (market.writable and market.origin):
            raise _refuse(f"{relative} is not in the market directory {market.root} and it fetches nothing",
                          "MARKET_UNREACHABLE", missing=(relative,)) from None
        fetched = fetch_public(market, relative)
        if fetched is None:
            raise _refuse(f"the public copy has no {relative}", "MARKET_UNREACHABLE", missing=(relative,)) from None
        check(fetched)
        path.parent.mkdir(exist_ok=True)
        _place(path, fetched)
        return pa.py_buffer(fetched)
    check(data)
    return data


def _sha_check(expected: str, relative: str):
    def check(data) -> None:
        if hashlib.sha256(data).hexdigest() != expected:
            raise _refuse(f"{relative} does not hash to its name", "HASH_MISMATCH", missing=(relative,))
    return check


# Opening and versions

def open_market(profile: dict, role: str) -> Market:
    if role not in ("import", "reader"):
        raise _refuse(f"role {role!r} is not import or reader", "ROLE_UNKNOWN")
    if not profile.get("root"):
        raise _refuse("the market profile names no market directory (root)", "MARKET_UNREACHABLE")
    root = Path(profile["root"])
    if not root.is_dir():
        raise _refuse(f"the market directory {root} does not exist", "MARKET_UNREACHABLE", missing=(str(root),))
    market = Market(root=root, role=role, origin=profile.get("origin"), writable=os.access(root, os.W_OK))
    head = _local_head(root)
    if head is None and role == "reader":
        if not (market.writable and market.origin):
            raise _refuse(f"the market directory {root} has no head and fetches nothing", "MARKET_EMPTY")
        fetched = fetch_public(market, "head")
        if fetched is None:
            raise _refuse("the public copy has no head", "MARKET_EMPTY")
        head = fetched.decode().strip()
    if head is not None:
        _set_head(market, head)
    return market


def _local_head(root: Path) -> str | None:
    try:
        return (root / "head").read_text().strip()
    except FileNotFoundError:
        return None


def _set_head(market: Market, head: str) -> None:
    if not COMMIT.fullmatch(head):
        raise _refuse(f"head {head!r} is not a version id", "HASH_MISMATCH", missing=("head",))
    version = load_version(market, head)
    unknown = sorted({entry["table"] for entry in version["files"]} - TABLES.keys())
    if unknown:
        raise _refuse(f"head {head} lists tables this code does not know: {', '.join(unknown)}",
                      "SCHEMA_VERSION_MISMATCH", missing=tuple(unknown))
    market.head, market.version = head, version


def _json(data, relative: str):
    try:
        return json.loads(memoryview(data).tobytes())
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise _refuse(f"{relative} is not JSON: {error}", "HASH_MISMATCH", missing=(relative,)) from None


def version_file(market: Market, commit: str) -> dict:
    """The version file as stored, checked against its id: a base or a delta."""
    if commit in market._files:
        return market._files[commit]
    if not COMMIT.fullmatch(commit):
        raise _refuse(f"{commit!r} is not a version id", "UNKNOWN_REF", missing=(commit,))
    relative = f"versions/{commit}.json"

    def check(data) -> None:
        if commit in CONVERTED:
            if hashlib.sha256(data).hexdigest() != CONVERTED[commit]:
                raise _refuse(f"{relative} is not the converted version CONVERTED names", "HASH_MISMATCH",
                              missing=(relative,))
        elif version_id(_json(data, relative)) != commit:
            raise _refuse(f"{relative} does not hash to its version id", "HASH_MISMATCH", missing=(relative,))

    version = _json(_read(market, relative, check), relative)
    market._files[commit] = version
    return version


def load_version(market: Market, commit: str) -> dict:
    """The complete version {market_schema, parent, files, receipts}: the nearest base back along the parent
    chain with the deltas after it, in order."""
    if commit in market._views:
        return market._views[commit]
    deltas: list[dict] = []
    at, stored = commit, version_file(market, commit)
    while "market_schema" not in stored and at not in market._views:
        deltas.append(stored)
        if stored["parent"] is None:
            raise _refuse(f"version {commit} reaches no base version", "HASH_MISMATCH", missing=(commit,))
        at = stored["parent"]
        stored = version_file(market, at)
    view = market._views.get(at, stored)
    if deltas:
        files, receipts = list(view["files"]), list(view["receipts"])
        for delta in reversed(deltas):
            files += delta["files"]
            receipts += delta["receipts"]
        view = {"market_schema": view["market_schema"], "parent": deltas[0]["parent"], "files": files,
                "receipts": receipts}
    market._views[commit] = view
    return view


def own(market: Market, commit: str) -> dict:
    """{files, receipts} the version adds to its parent: a delta's own lists, a base's beyond its parent's."""
    stored = version_file(market, commit)
    if "market_schema" not in stored or stored["parent"] is None:
        return {"files": stored["files"], "receipts": stored["receipts"]}
    parent = load_version(market, stored["parent"])
    return {name: stored[name][len(parent[name]):] for name in ("files", "receipts")}


def chain(market: Market, start: str | None = None) -> Iterator[str]:
    """The version ids from start (head by default) back along parent links."""
    commit = start or market.head
    while commit is not None:
        yield commit
        commit = version_file(market, commit)["parent"]


def converted(market: Market) -> set[str]:
    """The versions converted from the Dolt market, in a market descended from the conversion (CONVERTED_HEAD on
    its chain): CONVERTED and CONVERTED_HEAD with its ancestors. Their receipts were written before receipts
    named their writer. None in a market begun empty."""
    if CONVERTED_HEAD is None or CONVERTED_HEAD not in chain(market):
        return set()
    return set(CONVERTED) | set(chain(market, CONVERTED_HEAD))


def resolve_commit(market: Market, ref: str | None) -> str:
    if ref is None or ref in ("", "main", "head"):
        if market.head is None:
            raise _refuse("the market has no version yet", "MARKET_EMPTY")
        return market.head
    if not PREFIX.fullmatch(ref):
        raise _refuse(f"{ref!r} is not main, head or a version id", "UNKNOWN_REF", missing=(ref,))
    known = set(chain(market)) | set(CONVERTED)
    found = sorted(commit for commit in known if commit.startswith(ref))
    if len(found) > 1:
        raise _refuse(f"{ref!r} names {len(found)} versions", "AMBIGUOUS_REF", missing=(ref,))
    if not found:
        raise _refuse(f"{ref!r} is no version of this market", "UNKNOWN_REF", missing=(ref,))
    return found[0]


# Reading

def _times(table: Table, column: pa.Array) -> pa.Array:
    if table.schema.field(table.time).type == pa.date32():
        return pc.multiply(pc.cast(pc.cast(column, pa.int32()), INT), DAY)
    return column


def entries(version: dict, table: str, symbols: list[str] | None = None, start_ms: int | None = None,
            end_ms: int | None = None) -> list[dict]:
    """The version's file entries of `table` that may hold rows of the request, in start order (a table's
    files are disjoint in time, so for one contract this is time order)."""
    return sorted((entry for entry in version["files"] if entry["table"] == table
                   and (entry["symbol"] is None or symbols is None or entry["symbol"] in symbols)
                   and (start_ms is None or entry["end_ms"] > start_ms)
                   and (end_ms is None or entry["start_ms"] < end_ms)), key=lambda entry: entry["start_ms"])


def overlap(a: dict, b: dict) -> bool:
    shared = a["symbol"] is None or b["symbol"] is None or a["symbol"] == b["symbol"]
    return (a["table"] == b["table"] and shared and a["start_ms"] < b["end_ms"] and b["start_ms"] < a["end_ms"])


def file_bytes(market: Market, sha256: str, suffix: str, fetch: bool = True) -> pa.Buffer:
    relative = f"files/{sha256}.{suffix}"
    if not SHA256.fullmatch(sha256):
        raise _refuse(f"{relative} is not a SHA-256 name", "HASH_MISMATCH", missing=(relative,))
    return _read(market, relative, _sha_check(sha256, relative), fetch)


def entry_bytes(market: Market, entry: dict) -> pa.Buffer:
    """A data file's bytes; fetched from the public copy only for the tables it holds (UPLOADED)."""
    return file_bytes(market, entry["sha256"], "parquet", entry["table"] in UPLOADED)


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
                           pc.less(times, end_ms if end_ms is not None else 2**63 - 1))
        if wanted is not None:
            member = pc.is_in(batch.column("symbol"), wanted)
            keep = member if keep is None else pc.and_(keep, member)
        if keep is not None:
            batch = batch.filter(keep)
        yield from batch.to_batches()


def read_version(market: Market, version: dict, table: str, symbols: list[str] | None = None,
                 start_ms: int | None = None, end_ms: int | None = None) -> Iterator[pa.RecordBatch]:
    """read_table on a version file's contents, which may be a child not yet written."""
    definition = TABLES[table]
    found = sorted(entries(version, table, symbols, start_ms, end_ms),
                   key=lambda entry: (entry["symbol"] or "", entry["start_ms"]))
    if definition.key[:2] == ("symbol", definition.time) and all(entry["symbol"] is not None for entry in found):
        # One contract per file, disjoint intervals and a key of (symbol, time, ...): files in (symbol, start)
        # order are in key order. bar's key puts price_type before the time, so its files are gathered.
        for entry in found:
            yield from file_batches(entry_bytes(market, entry), definition, symbols, start_ms,
                                    end_ms)
        return
    # Files holding several contracts: their filtered rows are gathered and sorted, so a caller narrows the
    # read by contract or time.
    rows = [batch for entry in found for batch in file_batches(
        entry_bytes(market, entry), definition, symbols, start_ms, end_ms)]
    if rows:
        gathered = pa.Table.from_batches(rows, definition.schema)
        yield from gathered.sort_by([(name, "ascending") for name in definition.key]).to_batches()


def read_table(market: Market, commit: str, table: str, symbols: list[str] | None = None,
               start_ms: int | None = None, end_ms: int | None = None) -> Iterator[pa.RecordBatch]:
    return read_version(market, load_version(market, commit), table, symbols, start_ms, end_ms)


def scan(market: Market, version: dict, table: str, symbols: list[str] | None = None, start_ms: int | None = None,
         end_ms: int | None = None) -> Iterator[pa.RecordBatch]:
    """The rows read_version gives, file by file in start order and unsorted across contracts, so a caller
    that needs no key order (a count, a set of days, a digest per contract) holds one row group at a time."""
    definition = TABLES[table]
    for entry in entries(version, table, symbols, start_ms, end_ms):
        yield from file_batches(entry_bytes(market, entry), definition, symbols, start_ms, end_ms)


def receipt(market: Market, sha256: str) -> dict:
    return _json(file_bytes(market, sha256, "json"), f"files/{sha256}.json")


def receipts(market: Market, commit: str | None, kind: str) -> list[dict]:
    """The commit's receipts of one kind in import order, none on an empty market (commit None): the import's
    own state, read from the commit's complete version (an import reads these; imports adds the version that
    wrote each)."""
    if commit is None:
        return []
    return [body for sha in load_version(market, commit)["receipts"] if (body := receipt(market, sha))["import"] == kind]


def imports(market: Market, commit: str, kind: str) -> list[dict]:
    """The commit's receipts of one kind in import order, each with the version whose own receipts list it
    (two imports may write the same receipt: position tells them apart). Walking the chain reads version files
    only."""
    listed = load_version(market, commit)["receipts"]
    found = [(index, body) for index, sha in enumerate(listed) if (body := receipt(market, sha))["import"] == kind]
    writers: dict[int, str] = {}
    end, first = len(listed), min((index for index, _ in found), default=len(listed))
    for ancestor in chain(market, commit):
        if end <= first:
            break
        added = len(own(market, ancestor)["receipts"])
        writers.update(dict.fromkeys(range(end - added, end), ancestor))
        end -= added
    return [{**body, "commit": writers[index]} for index, body in found]


# Writing

@contextmanager
def lock(market: Market) -> Iterator[None]:
    """The import lock for the whole import. fcntl excludes only processes sharing one kernel: every writer
    runs in a container of the compose project whose volume holds the market directory."""
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
        head = _local_head(market.root)
        market.head = market.version = None
        if head is not None:
            if not (market.root / "versions" / f"{head}.json").is_file():
                raise _refuse(f"head {head} has no version file in {market.root}", "HEAD_INCOMPLETE",
                              missing=(f"versions/{head}.json",))
            _set_head(market, head)
            version = load_version(market, head)
            missing = [f"files/{entry['sha256']}.parquet" for entry in version["files"]]
            missing += [f"files/{sha}.json" for sha in version["receipts"]]
            missing = [relative for relative in missing if not (market.root / relative).is_file()]
            if missing:
                raise _refuse(f"head {head} lists {len(missing)} files the market directory lacks",
                              "HEAD_INCOMPLETE", missing=missing[:20])
        market.locked = True
        yield
    finally:
        market.locked = False
        handle.close()


def _held(market: Market) -> None:
    if not market.locked:
        raise RuntimeError("a market write needs the import lock (versions.lock)")


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


def write_file(market: Market, table: str, symbol: str | None, start_ms: int, end_ms: int,
               batches: Iterable[pa.RecordBatch]) -> dict:
    _held(market)
    definition = TABLES[table]
    if not start_ms < end_ms:
        raise _refuse(f"{table} file interval [{start_ms}, {end_ms}) is empty", "CHECK_FAILED", missing=(table,))
    entry = {"table": table, "symbol": symbol, "start_ms": start_ms, "end_ms": end_ms}
    for stored in (market.version or {"files": []})["files"]:
        if overlap(stored, entry):
            raise _refuse(f"{table} {symbol or 'all contracts'} [{start_ms}, {end_ms}) meets the stored file "
                          f"[{stored['start_ms']}, {stored['end_ms']})", "ENTRY_OVERLAP", missing=(table,))
    if not (market.root / "files").is_dir():
        (market.root / "files").mkdir()
        _sync_dir(market.root)
    descriptor, name = tempfile.mkstemp(dir=market.root / "files", prefix=f".{table}.", suffix=".tmp")
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
                check_rows(table, definition, batch, symbol, start_ms, end_ms)
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
            digest = hashlib.file_digest(handle, "sha256").hexdigest()
        os.replace(temporary, market.root / "files" / f"{digest}.parquet")
        _sync_dir(market.root / "files")
    finally:
        temporary.unlink(missing_ok=True)
    return {**entry, "sha256": digest}


def data_tests(market: Market, version: dict) -> list[str]:
    """The three member and terms checks a version must pass; the names of those it fails."""
    months = pa.Table.from_batches(list(read_version(market, version, "universe_month")),
                                   TABLES["universe_month"].schema)
    if not months.num_rows:
        return []
    failed = []
    latest = pc.max(months.column("month")).as_py()
    newest = months.filter(pc.equal(months.column("month"), pa.scalar(latest, pa.date32())))
    members = sorted(set(newest.column("symbol").to_pylist()))
    eve = (latest - date(1970, 1, 1)).days * DAY - DAY
    traded = set()
    for batch in read_version(market, version, "bar", members, eve, eve + DAY):
        minute = pa.array(batch.column("ts_open").to_numpy(zero_copy_only=False) % 60_000 == 0)
        last = batch.filter(pc.and_(pc.and_(pc.equal(batch.column("price_type"), "LAST"),
                                            pc.greater(batch.column("volume"), 0)), minute))
        traded.update(last.column("symbol").to_pylist())
    # As the SQL test counts: a member listed under two rules is two rows and one traded symbol, and fails.
    rows = newest.column("symbol").to_pylist()
    if len(rows) != len({symbol for symbol in rows if symbol in traded}):
        failed.append("universe_members_traded_on_the_eve")
    every = set(months.column("symbol").to_pylist())
    termed = set()
    for batch in read_version(market, version, "instrument", sorted(every)):
        termed.update(batch.column("symbol").to_pylist())
    if every - termed:
        failed.append("universe_members_have_terms")
    if set(newest.column("universe_rule").to_pylist()) != {version["market_schema"]["universe_rule"]}:
        failed.append("universe_rule_is_recorded")
    return failed


def writer() -> str | None:
    """The Git revision of the code writing a version, recorded in its receipt: HEAD of this checkout when no
    tracked file is modified (files an image leaves out count as unmodified), else None. market.publish
    refuses a version whose receipt names no writer, so a rebuild knows which code wrote the bytes."""
    root = Path(__file__).resolve().parents[1]
    try:
        head = subprocess.run(["git", "rev-parse", "HEAD"], cwd=root, capture_output=True, text=True, check=True,
                              timeout=30).stdout.strip()
        modified = subprocess.run(["git", "diff", "--quiet", "--diff-filter=d", "HEAD"], cwd=root,
                                  capture_output=True, timeout=60).returncode
    except (OSError, subprocess.SubprocessError):
        return None
    return head if modified == 0 and re.fullmatch(r"[0-9a-f]{40}", head) else None


def commit_version(market: Market, entries: list[dict], receipt: dict) -> str:
    """Write the import's receipt and its child version, then replace head: data files and receipt
    durable, version file durable, head's replacement durable, in that order. The child is a delta (only
    the entries and the receipt it adds); the first version of an empty market is a base."""
    _held(market)
    for index, entry in enumerate(entries):
        for other in entries[index + 1:]:
            if overlap(entry, other):
                raise _refuse(f"two {entry['table']} files of one import meet", "ENTRY_OVERLAP",
                              missing=(entry["table"],))
    receipt_bytes = canonical({**receipt, "writer": writer()})
    receipt_sha = hashlib.sha256(receipt_bytes).hexdigest()
    parent = market.version or {"files": [], "receipts": []}
    complete = {"market_schema": market.market_schema, "parent": market.head, "files": parent["files"] + entries,
                "receipts": parent["receipts"] + [receipt_sha]}
    failed = data_tests(market, complete)
    if failed:
        raise _refuse(f"the new version fails {', '.join(failed)}", "DATA_TESTS_FAILED", missing=failed)
    for directory in ("files", "versions"):  # an import writing no data file may be the directory's first
        if not (market.root / directory).is_dir():
            (market.root / directory).mkdir()
            _sync_dir(market.root)
    _place(market.root / "files" / f"{receipt_sha}.json", receipt_bytes)
    stored = complete if market.head is None else {"parent": market.head, "files": entries, "receipts": [receipt_sha]}
    commit = version_id(stored)
    _place(market.root / "versions" / f"{commit}.json", canonical(stored))
    if _local_head(market.root) != market.head:
        raise RuntimeError(f"head of {market.root} moved under the import lock")
    _place(market.root / "head", f"{commit}\n".encode())
    market._files[commit], market._views[commit] = stored, complete
    market.head, market.version = commit, complete
    return commit


# A new market

NAME = re.compile(r"[A-Za-z0-9_-]{1,64}\Z")
KINDS = ("active", "isolated", "temporary")


def init_market(name: str, root: Path, kind: str) -> dict:
    """An empty market directory (files/, versions/ and lock, no head: the first import writes the first
    version) and its profile {name, kind: market, role, root} in the profile directory."""
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
        raise _refuse(f"a profile named {name} already exists; nothing is replaced", "LEDGER_EXISTS", missing=(name,))
    markets = [value for value in found.values() if isinstance(value, dict) and value.get("kind") == "market"]
    active = [value for value in markets if value.get("role") == "active" and value.get("root")]
    if kind == "active" and active:
        raise _refuse("an active market directory already exists; there is only one", "LEDGER_EXISTS",
                      missing=(active[0]["root"],))
    if kind == "active" and (db._inside(root, db.REPOSITORY) or db._is_temporary(root)):
        raise _refuse("the active market directory lies outside the source checkout and temporary roots",
                      "ISOLATION_BREACH", missing=(str(root),))
    if kind != "active" and any(db._inside(root, Path(value["root"])) for value in active):
        raise _refuse(f"{root} is the active market's directory; use another", "ISOLATION_BREACH",
                      missing=(str(root),))
    if root.exists() and (not root.is_dir() or any(root.iterdir())):
        raise _refuse(f"{root} is not an empty directory", "LEDGER_EXISTS", missing=(str(root),))
    for path in (root / "files", root / "versions"):
        path.mkdir(parents=True, exist_ok=True)
    (root / "lock").touch()
    _sync_dir(root)
    profile = {"name": name, "kind": "market", "role": kind, "root": str(root)}
    db._private_write(db.home() / f"{name}.json", profile)
    return {**profile, "profile": str(db.home() / f"{name}.json")}
