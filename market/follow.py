"""Unattended upkeep of the market (market.follow): the bars of the configured contracts from the configured month
through the last closed UTC day, each named contract's open interest and long/short ratios through the same day (and
those of any contract the market's newest day waits for, from the day after its last, and with the metrics pool those
of the newest month's universe members, from that month's first day), its complete aggTrades and the quotes inferred
from them by closed month, each imported by its existing importer once Binance publishes the archives. What is due is
what the configured range lacks on disk. It adds no import rule; each refusal of an import is sorted into retrying next
round, stopping one kind of data (or one contract's), skipping a month whose archive breaks the aggTrade sequence, or
stopping everything."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, date, datetime, time as day_time, timedelta
import json
from pathlib import Path
import tempfile
import time

from market import aggtrades, files, metrics, quotes, sources, store, universe
from shared import clock
from shared.files import atomic_write
from shared.errors import Refusal


KINDS = ("bars", "metrics", "trades", "quotes")
MONTHLY = ("trades", "quotes")  # imported once per closed month, quotes from the trades: a held month is MONTH_EXISTS
TABLES = {"trades": "agg_trade", "quotes": "quote"}
BARS = "scope"  # the one entry of bars: the whole bar list is imported by one call

# Refusals that a later round can outlive: an archive not out yet, a lock another import holds, the market
# directory unreadable for now, the network, a checksum file out of step with its archive (a mismatching download never reaches the cache), and quotes
# whose month of aggTrades another import has not finished.
RETRY = frozenset({"ARCHIVE_NOT_PUBLISHED", "CONCURRENT_IMPORT", "MARKET_UNREACHABLE", "MARKET_EMPTY",
                   "SOURCE_UNREACHABLE", "CHECKSUM_MISMATCH", "TRADES_NOT_HELD"})
# Refusals about the whole market: everything stops until the service restarts.
WHOLE_MARKET = frozenset({"DATA_TESTS_FAILED"})
# Any other refusal, coded or not (SOURCE_SHAPE, SCALE_LOSS, TERMS_UNKNOWN, a full disk, ...), stops its contract's
# kind; for bars that is the kind. MONTH_EXISTS is a concurrent manual import that took the month, except for bars,
# where it is a stored month the sources now contradict.

LAG_DAYS = 3  # still missing this many days after it closed: report it lagging and poll it daily (bars hourly)
GIVE_UP_DAYS = 40  # a month this long closed and not out is not coming (before the listing): passed over, a hole
WAKE = day_time(0, 30)  # the daily round, UTC
HOURLY = timedelta(hours=1)
NAP = 300  # seconds per sleep; the wall clock is read after each, since host sleep pauses the Docker VM
START_DELAY = 300  # seconds before the first round, so a crash loop never holds the import lock back to back
STALE = timedelta(hours=26)  # a status older than this is a stuck command


@dataclass(frozen=True)
class Scope:
    """The deployment's range. `bar_symbols` None is every eligible contract."""
    symbols: list[str]  # the contracts of metrics from metrics_from, aggTrades and quotes
    bars_from: date
    metrics_from: date
    trades_from: date
    quotes_from: date
    bar_symbols: list[str] | None = None
    metrics_pool: bool = False  # also the metrics of the newest month's universe members, from that month on


@dataclass
class Memory:
    """What rounds carry until the process restarts: stops ("*", (kind, "*") or (kind, contract) to refusal),
    months skipped for a broken aggTrade sequence or never published, months whose cache a sequence gap already
    cleared, metrics days long closed with no archive, and the month whose holes were last tried."""
    stopped: dict = field(default_factory=dict)
    skipped: dict = field(default_factory=dict)
    cleared: set = field(default_factory=set)
    unpublished: set = field(default_factory=set)
    holes_tried: date | None = None

    def stop(self, kind: str, symbol: str) -> dict | None:
        return self.stopped.get("*") or self.stopped.get((kind, "*")) or self.stopped.get((kind, symbol))


def default_status() -> Path:
    return Path(tempfile.gettempdir()) / "market-import" / "status.json"


def _refusal(exc: BaseException) -> dict:
    code = getattr(exc, "code", None)
    return {"code": code or type(exc).__name__, "message": str(getattr(exc, "message", None) or exc)}


def sort(kind: str, exc: BaseException) -> str:
    """retry, contract (the contract's kind), kind or all."""
    code = getattr(exc, "code", None)
    if code in WHOLE_MARKET:
        return "all"
    if code in RETRY or (code == "MONTH_EXISTS" and kind != "bars"):
        return "retry"
    return "kind" if kind == "bars" else "contract"


def _month(day: date) -> date:
    return day.replace(day=1)


def _days(month: date, today: date) -> list[date]:
    end = min(clock.next_month(month), today)
    return [month + timedelta(days=n) for n in range((end - month).days)]


# Open interest and long/short ratios: by day

def missing(held: set[date], first: date, today: date, unpublished=()) -> dict[date, list[date]]:
    """The days from `first` before `today` not held and not known to have no archive, by month."""
    found: dict[date, list[date]] = {}
    for count in range((today - first).days):
        day = first + timedelta(days=count)
        if day not in held and day not in unpublished:
            found.setdefault(_month(day), []).append(day)
    return found


def _fetched(cache: Path, symbol: str, days: list[date], today: date, memory: Memory) -> bool:
    """Download the published archives of `days` into the cache outside the import lock, so that retries and
    back-off never hold it; import_month then reads them from the cache. Whether any is published. A day closed
    longer ago than metrics.SETTLE_DAYS with no archive is not asked for again until the process restarts."""
    published = False
    for day in days:
        if sources.published(cache, sources.metrics_key(symbol, day.isoformat())) is not None:
            published = True
        elif (today - day).days > metrics.SETTLE_DAYS:
            memory.unpublished.add((symbol, day))
    return published


def _passed(memory: Memory, symbol: str) -> set[date]:
    return {day for name, day in memory.unpublished if name == symbol}


# Bars: the configured contracts from the configured month through the last closed day

def bar_months(through: dict[date, date], first: date, today: date) -> tuple[date, date]:
    """The month the next bar import is of and the day it would hold through (`through`: each stored month's first day
    not held; `today`: the first unclosed day): `first` on an empty market; the month before the earliest while that is
    after `first`; the first month missing between the stored ones (which an import refuses, MONTH_INVALID: stopping
    the bars says so); else the latest month until it holds its end, then the month after it."""
    if not through:
        month = first
    else:
        earliest, latest = min(through), max(through)
        gaps = [month for month in clock.months(earliest, latest) if month not in through]
        if first < earliest:
            month = (earliest - timedelta(days=1)).replace(day=1)
        elif gaps:
            month = gaps[0]
        else:
            month = clock.next_month(latest) if through[latest] == clock.next_month(latest) else latest
    return month, min(clock.next_month(month), today)


def _bars_ready(cache: Path, symbols: list[str], day: date) -> bool:
    """The daily klines archive of `day` is out (downloaded into the cache the import reads) for every contract
    whose archive of the day before is, so the import never seals a day from REST alone: a sealed day is never
    compared with its archive again. A contract with neither has stopped trading and is not waited for."""
    days = [(day - timedelta(days=1)).isoformat(), day.isoformat()]
    for symbol in symbols:
        found = sources.daily_archives(cache, sources.KIND_OF["LAST"], symbol, days)
        if days[0] in found and days[1] not in found:
            return False
    return True


def _bars(profile: dict, listing: dict, scope: Scope, cache: Path, today: date, log, entry: dict) -> None:
    through = listing["bars"]
    while True:
        month, end = bar_months(through, scope.bars_from, today)
        if through.get(month, month) >= end:
            # A month's first day has no closed day to import yet: its members now, which the market day of its eve reads.
            if end == month and through and month not in listing["members"]:
                listing["members"][month] = store.import_month(profile, month, cache, symbols=scope.bar_symbols,
                                                               log=log)["universe_members"]
            return
        members = listing["members"].get(month) or listing["members"].get(max(listing["members"], default=None))
        if not _bars_ready(cache, scope.bar_symbols or members or [], end - timedelta(days=1)) and \
                end - timedelta(days=1) >= today - timedelta(days=LAG_DAYS):
            return
        found = store.import_month(profile, month, cache, symbols=scope.bar_symbols, log=log)
        entry["rows"] += found["rows"] + found["funding_rows"]
        through[month] = date.fromisoformat(found["through"])
        listing["members"][month] = found["universe_members"]


# Quotes and complete aggTrades: by closed month

def following(held: set[date], first: date, skipped=()) -> date:
    """The next month to import of a contract holding the months `held`: the month after the latest, or `first`, past
    the `skipped` months."""
    month = clock.next_month(max(held)) if held else first
    while month in skipped:
        month = clock.next_month(month)
    return month


def _after(month: date, skipped=()) -> date:
    """The month after `month` past the `skipped` ones."""
    return following({month}, month, skipped)


def holes(held: set[date], first: date) -> list[date]:
    """The months from `first` to the latest held one that are not held."""
    return [month for month in clock.months(first, max(held)) if month not in held] if held else []


def _keys(symbol: str, month: date, eve: bool = True) -> list[str]:
    """The daily archives an import of `month` reads: the eve (the carried state), with `eve`, and every day."""
    days = ([month - timedelta(days=1)] if eve else []) + _days(month, clock.next_month(month))
    return [sources.aggtrades_key(symbol, day.isoformat()) for day in days]


def _published(cache: Path, symbol: str, month: date, earlier: bool) -> bool:
    """Download a month's aggTrades archives into the cache, streamed and outside the import lock, with the eve's when
    the contract holds an `earlier` month (the import requires it then, aggtrades.month_rows). Whether all are out."""
    return all(sources.published(cache, key) is not None for key in _keys(symbol, month, earlier))


def _overtaken(cache: Path, symbol: str, month: date, today: date, earlier: bool) -> bool:
    """Whether a month whose archives are not all out stops being waited for: it closed GIVE_UP_DAYS ago, or the whole
    of the closed month after it is out. A day published later still comes in as a hole."""
    after = clock.next_month(month)
    return (today - after).days >= GIVE_UP_DAYS or (clock.next_month(after) <= today
                                                    and _published(cache, symbol, after, earlier))


def _clear(cache: Path, symbol: str, month: date) -> None:
    for key in _keys(symbol, month):
        sources.forget(cache, key)


def _republished(cache: Path, symbol: str, month: date, earlier: bool) -> bool:
    """Whether a hole month is worth importing again: one of its archives was never cached here, or Binance has
    published another checksum for one of them since (the stale copy is dropped). One small request a day."""
    changed = False
    for key in _keys(symbol, month, earlier):
        # Every key is asked: an archive not cached must not leave a later one's republished copy stale.
        changed = sources.republished(cache, key) is not False or changed
    return changed


def _sound(cache: Path, symbol: str, month: date, earlier: bool) -> bool:
    """A cached month read through outside the import lock as the import reads it (aggtrades.month_rows): False at a
    broken aggTrade sequence or any other refusal of an archive's content, so a hole whose gap is still there
    never takes the lock to write the days before the gap and roll them back."""
    try:
        for _ in aggtrades.month_rows(cache, symbol, clock.day_ms(month), clock.day_ms(clock.next_month(month)),
                                      earlier):
            pass
    except Refusal:
        return False
    return True


def _import(kind: str, profile: dict, month: date, cache: Path, symbols: list[str], log) -> list[dict]:
    """One month of `symbols` by the kind's importer: [{symbol, rows}]."""
    found = (quotes.import_quotes if kind == "quotes" else aggtrades.import_month)(profile, month, cache, symbols, log)
    return [{"symbol": symbol, "rows": item["rows"]} for symbol, item in found["per_symbol"].items()]


def _held(profile: dict, kind: str, symbols: list[str]) -> dict[str, set[date]]:
    """{symbol: the months it holds a file of}."""
    market = files.open_market(profile, "reader")
    found: dict[str, set[date]] = {symbol: set() for symbol in symbols}
    for entry in files.entries(market, TABLES[kind], symbols):
        found[str(entry.symbol)].add(clock.ms_day(entry.start_ms))
    return found


def _monthly(kind: str, profile: dict, first: date, symbols: list[str], cache: Path, memory: Memory,
             today: date, log, entries: dict) -> None:
    """Import every closed month after each contract's latest (from `first` when it holds none), oldest first.
    aggTrades go one call per month for the contracts due then (each contract its own file, written at once), one
    contract a call after a refused group, once the month's archives are out; a month long closed and not out, or one
    whose next month is wholly out, is passed over. Quotes go one contract a call, once the aggTrades hold the month they read; a month the aggTrades
    passed by (a later month held, this one not) is passed over."""
    held = _held(profile, kind, symbols)
    trades = _held(profile, "trades", symbols) if kind == "quotes" else None
    pending: dict[str, date] = {symbol: following(held[symbol], first, memory.skipped.get((kind, symbol), ()))
                                for symbol in symbols if not memory.stop(kind, symbol)}

    def pass_over(symbol: str, month: date) -> None:
        memory.skipped.setdefault((kind, symbol), []).append(month)
        pending[symbol] = _after(month, memory.skipped[(kind, symbol)])

    while pending:
        month = min(pending.values())
        if clock.next_month(month) > today:
            return
        due = [symbol for symbol, value in pending.items() if value == month]
        ready = []
        for symbol in due:
            if trades is not None:
                if month in trades[symbol]:
                    ready.append(symbol)
                elif any(later > month for later in trades[symbol]):
                    pass_over(symbol, month)
                else:
                    del pending[symbol]  # waits for the month's aggTrades
                continue
            earlier = any(held_month < month for held_month in held[symbol])
            try:
                published = _published(cache, symbol, month, earlier)
                overtaken = not published and _overtaken(cache, symbol, month, today, earlier)
            except Exception as exc:  # every failure of a round is reported, never raised
                if not _stop(kind, symbol, exc, memory):
                    entries[symbol]["retry"] = _refusal(exc)
                del pending[symbol]
                continue
            if published:
                ready.append(symbol)
            elif overtaken:
                pass_over(symbol, month)
            else:
                del pending[symbol]
        groups = [ready] if kind == "trades" and ready else [[symbol] for symbol in ready]
        while groups:
            group = groups.pop(0)
            try:
                for item in _import(kind, profile, month, cache, group, log):
                    entries[item["symbol"]]["rows"] += item["rows"]
                    held[item["symbol"]].add(month)
                    pending[item["symbol"]] = _after(month, memory.skipped.get((kind, item["symbol"]), ()))
            except Exception as exc:
                if len(group) > 1:
                    # Contracts written before the refusal keep their files: read which, then one call each.
                    found = _held(profile, kind, group)
                    for symbol in group:
                        if month in found[symbol]:
                            held[symbol].add(month)
                            pending[symbol] = _after(month, memory.skipped.get((kind, symbol), ()))
                        else:
                            groups.append([symbol])
                    continue
                symbol = group[0]
                action = _gap(kind, symbol, month, exc, cache, memory)
                if action == "again":
                    groups.append(group)
                    continue
                if action == "skip":
                    pending[symbol] = _after(month, memory.skipped[(kind, symbol)])
                    continue
                del pending[symbol]
                if not _stop(kind, symbol, exc, memory):
                    entries[symbol]["retry"] = _refusal(exc)
                if "*" in memory.stopped or (kind, "*") in memory.stopped:
                    return


def _gap(kind: str, symbol: str, month: date, exc: BaseException, cache: Path, memory: Memory) -> str | None:
    """A broken aggTrade sequence in `month`: download the month again once ("again"), then skip it ("skip").
    A gap on the eve (the month before's last day) is not this month's and is left to a person (None)."""
    if getattr(exc, "code", None) != "SEQUENCE_GAP":
        return None
    missing_ = getattr(exc, "missing", ()) or ("",)
    try:
        day = date.fromisoformat(missing_[0].split()[-1])
    except (ValueError, IndexError):
        return None
    if day < month:
        return None
    if (kind, symbol, month) not in memory.cleared:
        memory.cleared.add((kind, symbol, month))
        _clear(cache, symbol, month)
        return "again"
    memory.skipped.setdefault((kind, symbol), []).append(month)
    return "skip"


def _holes(kind: str, profile: dict, first: date, symbols: list[str], cache: Path, memory: Memory,
           log, entries: dict) -> None:
    """Once a month: each hole month whose archives are new here or were republished, imported once; a quotes hole
    once the aggTrades hold the month, which it reads. A refusal leaves the hole as it is until next month's try; one
    about the whole market stops everything."""
    held = _held(profile, kind, symbols)
    trades = _held(profile, "trades", symbols) if kind == "quotes" else None
    for symbol in symbols:
        if memory.stop(kind, symbol):
            continue
        for month in holes(held[symbol], first):
            try:
                if trades is not None:
                    if month not in trades[symbol]:
                        continue
                else:
                    earlier = any(held_month < month for held_month in held[symbol])
                    if not (_republished(cache, symbol, month, earlier) and _published(cache, symbol, month, earlier)
                            and _sound(cache, symbol, month, earlier)):
                        continue
                for item in _import(kind, profile, month, cache, [symbol], log):
                    entries[symbol]["rows"] += item["rows"]
                    entries[symbol].setdefault("filled", []).append(f"{month:%Y-%m}")
            except Exception as exc:
                if sort(kind, exc) == "all":
                    memory.stopped["*"] = _refusal(exc)
                    return


def _stop(kind: str, symbol: str, exc: BaseException, memory: Memory) -> bool:
    """Record the stop a refusal calls for; False when it is retried next round."""
    action = sort(kind, exc)
    if action == "retry":
        return False
    memory.stopped[{"all": "*", "kind": (kind, "*"), "contract": (kind, symbol)}[action]] = _refusal(exc)
    return True


# A round

def _listings(profile: dict, scope: Scope) -> dict:
    """What the market directory holds: bars {month: first day not held}, members {month: symbols}, metrics {symbol:
    days} of the scope's contracts and of the others a round keeps (metrics_from {symbol: first day due}): each
    contract whose metrics the newest day waits for (files.followed_metrics) from the day after its last and, with the
    metrics pool, each other member of the newest month from that month's first day (a member is kept from the month
    it is found in, never backfilled); trades and quotes {symbol: months}."""
    symbols = scope.symbols
    market = files.open_market(profile, "reader")
    members: dict[date, list[str]] = {}
    for month, symbol in universe.months_of(market, None):
        members.setdefault(month, []).append(symbol)
    newest = max(members, default=None)
    followed = files.followed_metrics(market)
    pool = {symbol: newest for symbol in members[newest]} if scope.metrics_pool and newest is not None else {}
    if pool and newest is not None:
        held_in_newest = {str(entry.symbol) for entry in files.entries(market, "metrics", list(pool),
                                                                       clock.day_ms(newest))
                          if files.last_time(market, entry) is not None}
        # A pool member holding metrics in the newest month that is no longer followed has stopped trading.
        pool = {symbol: first for symbol, first in pool.items()
                if symbol in followed or symbol not in held_in_newest}
    others = {**pool, **{symbol: last + timedelta(days=1) for symbol, last in followed.items()}}
    others = {symbol: first for symbol, first in sorted(others.items()) if symbol not in symbols}
    return {"bars": files.bar_months_through(market), "members": members,
            "metrics": {symbol: metrics.held_days(market, symbol) for symbol in [*symbols, *others]},
            "metrics_from": others, **{kind: _held(profile, kind, symbols) for kind in MONTHLY}}


def _metrics_from(listing: dict, scope: Scope) -> dict[str, date]:
    """{contract: first day due} of the metrics a round keeps."""
    return {**{symbol: scope.metrics_from for symbol in scope.symbols}, **listing.get("metrics_from", {})}


def _states(listing: dict | None, scope: Scope, memory: Memory, now: datetime, kinds: dict) -> None:
    today = now.astimezone(UTC).date()
    lag = today - timedelta(days=LAG_DAYS)
    for kind, entries in kinds.items():
        for symbol, entry in entries.items():
            if (refusal := memory.stop(kind, symbol)) is not None:
                entry["state"], entry["refusal"] = "stopped", refusal
            elif listing is None:
                entry["state"] = "unknown"
            elif kind == "bars":
                month, end = bar_months(listing["bars"], scope.bars_from, today)
                first = listing["bars"].get(month, month)
                entry["through"] = first.isoformat()
                entry["state"] = ("caught_up" if first >= end else "lagging" if first < lag else "waiting")
            elif kind == "metrics":
                metrics_from = _metrics_from(listing, scope)
                if symbol not in metrics_from:
                    entry["missing_from"], entry["missing_days"], entry["unpublished"] = None, 0, []
                    entry["state"] = "caught_up"
                    continue
                first = metrics_from[symbol]
                held = listing["metrics"].get(symbol, set())
                passed = _passed(memory, symbol)
                # Unpublished days before the latest held day are settled holes; trailing 404s stall head and lag.
                tail = max(first, max(held) + timedelta(days=1)) if held else first
                left = missing(held, first, today, {day for day in passed if day < tail})
                flat = [day for days in left.values() for day in days]
                entry["missing_from"], entry["missing_days"] = (flat[0].isoformat() if flat else None), len(flat)
                entry["unpublished"] = sorted(day.isoformat() for day in passed)
                entry["state"] = ("caught_up" if not flat else "lagging" if flat[0] < lag else "waiting")
            else:
                first = scope.trades_from if kind == "trades" else scope.quotes_from
                due = following(listing[kind][symbol], first, memory.skipped.get((kind, symbol), ()))
                entry["next_month"] = f"{due:%Y-%m}"
                closed = clock.next_month(due)
                entry["state"] = ("caught_up" if closed > today else "lagging" if closed < lag else "waiting")


def run_round(profile: dict, scope: Scope, cache: Path, memory: Memory, now: datetime, log) -> dict:
    """One round: bars, then each contract's metrics, then each contract's aggTrades and quotes (a refusal of one never
    keeps another from importing), the holes once a month, and the status."""
    today = now.astimezone(UTC).date()
    symbols = scope.symbols
    kinds: dict[str, dict] = {kind: {key: {"rows": 0} for key in ([BARS] if kind == "bars" else symbols)}
                              for kind in KINDS}
    firsts = {"trades": scope.trades_from, "quotes": scope.quotes_from}
    status: dict = {"at": now.isoformat(), "last_closed_day": (today - timedelta(days=1)).isoformat(),
                    "kinds": kinds, "round_refusal": None}
    listing: dict | None = None
    try:
        listing = _listings(profile, scope)
    except Exception as exc:  # every failure of a round is reported, never raised
        status["round_refusal"] = _refusal(exc)
        if sort("bars", exc) == "all":
            memory.stopped["*"] = status["round_refusal"]
    if listing is not None and not memory.stop("bars", BARS):
        try:
            _bars(profile, listing, scope, cache, today, log, kinds["bars"][BARS])
        except Exception as exc:
            if not _stop("bars", BARS, exc, memory):
                kinds["bars"][BARS]["retry"] = _refusal(exc)
    firsts_of_metrics, held_metrics = ({}, {}) if listing is None else (_metrics_from(listing, scope), listing["metrics"])
    for symbol, first in firsts_of_metrics.items():
        if "*" in memory.stopped:
            break
        kinds["metrics"].setdefault(symbol, {"rows": 0})
        if memory.stop("metrics", symbol):
            continue
        left = missing(held_metrics[symbol], first, today, _passed(memory, symbol))
        for month, days in left.items():
            try:
                if not _fetched(cache, symbol, days, today, memory):
                    continue
                found = metrics.import_month(profile, month, cache, [symbol], log=log, first=first)
                kinds["metrics"][symbol]["rows"] += found["rows"]
            except Exception as exc:
                if _stop("metrics", symbol, exc, memory):
                    break
                kinds["metrics"][symbol]["retry"] = _refusal(exc)
    holes_due = memory.holes_tried != _month(today)
    for step, kind in [(_monthly, kind) for kind in MONTHLY] + [(_holes, kind) for kind in MONTHLY if holes_due]:
        if listing is None or "*" in memory.stopped:
            break
        try:
            if step is _monthly:
                _monthly(kind, profile, firsts[kind], symbols, cache, memory, today, log, kinds[kind])
            else:
                _holes(kind, profile, firsts[kind], symbols, cache, memory, log, kinds[kind])
        except Exception as exc:  # a listing or download failure between imports: next round
            if sort(kind, exc) == "all":
                memory.stopped["*"] = _refusal(exc)
            for entry in kinds[kind].values():
                entry.setdefault("retry", _refusal(exc))
    if listing is not None and "*" not in memory.stopped and holes_due:
        memory.holes_tried = _month(today)
    try:
        listing = _listings(profile, scope)
    except Exception as exc:
        status["round_refusal"] = status["round_refusal"] or _refusal(exc)
        listing = None
    _states(listing, scope, memory, now, kinds)
    for kind in MONTHLY:
        for symbol, entry in kinds[kind].items():
            entry["skipped"] = [f"{month:%Y-%m}" for month in memory.skipped.get((kind, symbol), ())]
    # The bar import waits for the newest closed day's archives however far behind it is (_bars_ready), and Binance
    # publishes them hours after the metrics: bars behind keep the rounds hourly, else they never import.
    hourly = listing is None or kinds["bars"][BARS]["state"] == "lagging" or any(
        entry["state"] == "waiting" for entries in kinds.values() for entry in entries.values())
    status["next_round"] = (now + HOURLY if hourly else
                            datetime.combine(today + timedelta(days=1), WAKE, tzinfo=UTC)).isoformat()
    return status


def write_status(path: Path, status: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    atomic_write(path, (json.dumps(status, separators=(",", ":"), ensure_ascii=False) + "\n").encode())


def follow(profile: dict, scope: Scope, cache: Path, status_path: Path, *, log=print, report=print,
           clock=lambda: datetime.now(UTC), sleep=time.sleep, rounds: int | None = None) -> dict:
    """market.follow: after START_DELAY seconds, run rounds for ever (or `rounds` of them), each reported as one JSON
    line and written to `status_path`, sleeping in short naps until the round's next_round. Each round first
    marks the last status running (running_since), which the IDE shows. Stops last until the process restarts."""
    store._scope(scope.bar_symbols)
    if scope.symbols:
        store._scope(scope.symbols)
    memory = Memory()
    done = 0
    status: dict = {}
    until = clock() + timedelta(seconds=START_DELAY)
    while rounds is None or done < rounds:
        while (now := clock()) < until:
            sleep(min(NAP, (until - now).total_seconds()))
        write_status(status_path, {**status, "at": status.get("at", now.isoformat()), "running_since": now.isoformat()})
        status = run_round(profile, scope, cache, memory, now, log)
        write_status(status_path, status)
        report(json.dumps(status, separators=(",", ":"), ensure_ascii=False))
        done += 1
        until = datetime.fromisoformat(status["next_round"])
    return status


def check(path: Path | None = None, now: datetime | None = None, out=print) -> int:
    """The healthcheck: 0 when the latest status is fresh, nothing is stopped, lagging or unknown (skipped months are
    not). A status is fresh while it is younger than STALE, or while the round that started after it (running_since)
    is; a round running longer is stuck. When unhealthy it prints why on one line, which Docker keeps in the
    container's health log."""
    try:
        status = json.loads((path or default_status()).read_text(encoding="utf-8"))
        now = now or datetime.now(UTC)
        age = now - datetime.fromisoformat(status["at"])
        # follow() marks a round in progress (running_since) and writes a status without it when the round ends
        running = status.get("running_since")
        running_for = None if running is None else now - datetime.fromisoformat(running)
        failing = [f"{kind}/{scope} {entry['state']}" + (f" ({entry['refusal']['code']})" if isinstance(
                       entry.get("refusal"), dict) and isinstance(entry["refusal"].get("code"), str) else "")
                   for kind, entries in status.get("kinds", {}).items() for scope, entry in entries.items()
                   if entry["state"] not in ("caught_up", "waiting")]
    except (OSError, ValueError, KeyError, TypeError, AttributeError) as exc:
        out(f"status unreadable ({type(exc).__name__})")
        return 1
    if running_for is not None and running_for > STALE:
        out(f"a round running since {running} is stuck")
        return 1
    if age > STALE and running_for is None:
        out(f"status is {age.total_seconds() / 3600:.1f} h old")
        return 1
    if failing:
        out("; ".join(failing[:5]) + (f"; {len(failing) - 5} more" if len(failing) > 5 else ""))
        return 1
    return 0
