"""Unattended upkeep of the market (market.follow): the bars of the database's scope through the last closed UTC
day, each named contract's open interest and long/short ratios through the same day, and its inferred quotes and
complete aggTrades by closed month, each imported by its existing importer once Binance publishes the archives,
and the market published after every round. It adds no import rule; each refusal of an import or a publish is
sorted into retrying next round, stopping one kind of data (or one contract's), skipping a month whose archive
breaks the aggTrade sequence, or stopping everything (docs/plans/monthly-market-import.zh.md)."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, date, datetime, time as day_time, timedelta
import json
import os
from pathlib import Path
import tempfile
import time

from market import aggtrades, metrics, sources, store, universe


KINDS = ("bars", "metrics", "quotes", "trades")
MONTHLY = ("quotes", "trades")  # imported once per closed month: a month holding any row is MONTH_EXISTS
BARS = "scope"  # the one entry of bars: the database's whole scope is imported by one call

# Refusals that a later round can outlive: an archive not out yet, a lock another import or a backup holds, a
# concurrent writer, the Dolt service restarting or bootstrapping (for the import account or the administrator
# that publishes), the network, an unconfirmed push, and a checksum file out of step with its archive (a
# mismatching download never reaches the cache).
RETRY = frozenset({"ARCHIVE_NOT_PUBLISHED", "CONCURRENT_IMPORT", "CONCURRENT_WRITE", "MARKET_UNREACHABLE",
                   "LEDGER_UNAVAILABLE", "MARKET_EMPTY", "SOURCE_UNREACHABLE", "PUBLISH_FAILED",
                   "CHECKSUM_MISMATCH"})
# Refusals about the whole database or its publication: everything stops until the service restarts. The universe
# rule (RULE_VERSION_MISMATCH of bars) is the database's own.
DATABASE = frozenset({"DIRTY_WORKING_SET", "SCHEMA_VERSION_MISMATCH", "COMMIT_CHECKS_DISABLED", "DATA_TESTS_FAILED",
                      "PUBLISH_REJECTED", "PUBLISH_FORBIDDEN", "REMOTE_UNSET", "REMOTE_INVALID"})
# A rule or a table of one kind of data: that kind stops, the others go on.
KIND = frozenset({"RULE_VERSION_MISMATCH", "SCHEMA_MISMATCH"})
# Any other refusal, coded or not (SOURCE_SHAPE, SCALE_LOSS, TERMS_UNKNOWN, a full disk, ...), stops its contract's
# kind; for bars that is the kind. MONTH_EXISTS is a concurrent manual import that took the month, except for bars,
# where it is a stored month the sources now contradict.

LAG_DAYS = 3  # still missing this many days after it closed: poll it daily and report it lagging
WAKE = day_time(0, 30)  # the daily round, UTC
HOURLY = timedelta(hours=1)
NAP = 300  # seconds per sleep; the wall clock is read after each, since host sleep pauses the Docker VM
START_DELAY = 300  # seconds before the first round, so a crash loop never holds the import lock back to back
STALE = timedelta(hours=26)  # a status older than this is a stuck command
NO_HISTORY = "NO_HISTORY"
PARTIAL_MONTH = "PARTIAL_MONTH"


@dataclass
class Memory:
    """What rounds carry until the process restarts: stops ("*", (kind, "*") or (kind, contract) to refusal),
    months skipped for a broken aggTrade sequence, months whose cache a sequence gap already cleared, and the
    month whose holes were last tried."""
    stopped: dict = field(default_factory=dict)
    skipped: dict = field(default_factory=dict)
    cleared: set = field(default_factory=set)
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
    if code in DATABASE or (kind == "bars" and code == "RULE_VERSION_MISMATCH"):
        return "all"
    if code in RETRY or (code == "MONTH_EXISTS" and kind != "bars"):
        return "retry"
    if code in KIND or kind == "bars":
        return "kind"
    return "contract"


def _month(day: date) -> date:
    return day.replace(day=1)


def _months(first: date, last: date) -> list[date]:
    found = []
    while first <= last:
        found.append(first)
        first = universe.next_month(first)
    return found


def _days(month: date, today: date) -> list[date]:
    end = min(universe.next_month(month), today)
    return [month + timedelta(days=n) for n in range((end - month).days)]


# Open interest and long/short ratios: by day

def missing(imports: list[dict], symbol: str, today: date) -> dict[date, list[date]] | None:
    """The days before `today` still to import for `symbol`, by month: in each month after the last day an
    earlier import holds (market.import_metrics continues there), from the earlier of that month and the month
    before the last closed day (its last day arrives in the next month), never before the first month held.
    None when no import holds the contract: its history is imported once by hand."""
    held: dict[date, date] = {}
    for item in imports:
        if symbol in (item.get("symbols") or ()):
            month = date.fromisoformat(item["month"] + "-01")
            held[month] = max(held.get(month, month), date.fromisoformat(item["through"]))
    if not held:
        return None
    closed = _month(today - timedelta(days=1))
    month = max(min(held), min(_month(max(held.values()) - timedelta(days=1)), _month(closed - timedelta(days=1))))
    found: dict[date, list[date]] = {}
    while month <= closed:
        start, end = held.get(month, month), min(universe.next_month(month), today)
        if start < end:
            found[month] = [start + timedelta(days=n) for n in range((end - start).days)]
        month = universe.next_month(month)
    return found


def _fetched(cache: Path, symbol: str, days: list[date]) -> bool:
    """Download the published archives of `days` into the cache outside the import lock, so that retries and
    back-off never hold it; import_month then reads them from the cache. Whether any is published."""
    published = False
    for day in days:
        try:
            sources.fetch_archive(cache, sources.metrics_key(symbol, day.isoformat()))
            published = True
        except sources.MarketError as exc:
            if exc.code != "ARCHIVE_NOT_PUBLISHED":
                raise
    return published


# Bars: the scope through the last closed day

def bar_months(imports: list[dict], today: date) -> tuple[date, date]:
    """The month the next bar import is of and the day it would hold through: the latest month until it holds
    its end, then the month after it (`today` is the first unclosed day)."""
    through = {item["month"]: date.fromisoformat(item["through"]) for item in imports}
    latest = date.fromisoformat(max(through) + "-01")
    month = universe.next_month(latest) if through[max(through)] == universe.next_month(latest) else latest
    return month, min(universe.next_month(month), today)


def _bars_ready(cache: Path, symbols: list[str], day: date) -> bool:
    """The daily klines archive of `day` is out (downloaded into the cache the import reads) for every contract
    whose archive of the day before is, so the import never seals a day from REST alone: a sealed day is never
    compared with its archive again. A contract with neither has stopped trading and is not waited for."""
    days = [(day - timedelta(days=1)).isoformat(), day.isoformat()]
    for symbol in symbols:
        found = sources.daily_archives(cache, sources.KIND_OF["LAST"], symbol, "1m", days)
        if days[0] in found and days[1] not in found:
            return False
    return True


def _bars(profile: dict, listing: dict, cache: Path, memory: Memory, today: date, log, entry: dict) -> None:
    imports = listing["bars"]
    scope = imports[-1]["scope"]
    symbols = None if scope == "all" else list(scope)
    while True:
        month, end = bar_months(imports, today)
        held = {item["month"]: date.fromisoformat(item["through"]) for item in imports}.get(f"{month:%Y-%m}")
        if held is not None and held >= end:
            return
        if end > month:  # closed days to import: wait for the last one's archives (a month's first day has none)
            members = listing["members"].get(month) or listing["members"].get(max(listing["members"], default=None))
            if not _bars_ready(cache, members or symbols or [], end - timedelta(days=1)) and \
                    end - timedelta(days=1) >= today - timedelta(days=LAG_DAYS):
                return
        found = store.import_month(profile, month, cache, symbols=symbols, log=log)
        entry["rows"] += found["bar_rows"] + found["funding_rows"]
        entry["commits"].append(found["market_commit"])
        imports = imports + [{"month": found["month"], "through": found["through"], "scope": found["scope"]}]
        listing["members"][month] = found["universe_members"]


# Quotes and complete aggTrades: by closed month

def _held(imports: list[dict], symbol: str) -> dict[date, date]:
    """{month: through} of the imports holding `symbol` (a month imported twice keeps its latest)."""
    return {date.fromisoformat(item["month"] + "-01"): date.fromisoformat(item["through"])
            for item in imports if symbol in (item.get("symbols") or ())}


def following(imports: list[dict], symbol: str, skipped=()) -> date | dict:
    """The next month to import for `symbol`: the month after the latest held one, past `skipped` months; or the
    refusal that keeps the contract stopped (no history, or a latest month held short of its end)."""
    held = _held(imports, symbol)
    if not held:
        return {"code": NO_HISTORY, "message": f"no import holds {symbol}; import its history once by hand"}
    latest = max(held)
    if held[latest] != universe.next_month(latest):
        return {"code": PARTIAL_MONTH, "message": f"{symbol} {latest:%Y-%m} is held through {held[latest]}, short of "
                                                  "its end; a month is imported once, so it is left to a person"}
    return _after(latest, skipped)


def _after(month: date, skipped=()) -> date:
    """The month after `month` past the `skipped` ones."""
    month = universe.next_month(month)
    while month in skipped:
        month = universe.next_month(month)
    return month


def holes(imports: list[dict], symbol: str) -> list[date]:
    """The months between the first and the latest held one that no import holds."""
    held = _held(imports, symbol)
    return [month for month in _months(min(held), max(held)) if month not in held] if held else []


def _keys(symbol: str, month: date) -> list[str]:
    """The daily archives an import of `month` reads: the eve (the carried state) and every day."""
    days = [month - timedelta(days=1)] + _days(month, universe.next_month(month))
    return [sources.aggtrades_key(symbol, day.isoformat()) for day in days]


def _published(cache: Path, symbol: str, month: date) -> bool:
    """Download a month's aggTrades archives (and the eve's: a followed contract holds the month before) into the
    cache, streamed and outside the import lock. Whether all are out."""
    for key in _keys(symbol, month):
        try:
            aggtrades.fetch_archive(cache, key)
        except sources.MarketError as exc:
            if exc.code != "ARCHIVE_NOT_PUBLISHED":
                raise
            return False
    return True


def _clear(cache: Path, symbol: str, month: date) -> None:
    for key in _keys(symbol, month):
        for path in (Path(cache) / key, Path(cache) / (key + ".CHECKSUM")):
            path.unlink(missing_ok=True)


def _republished(cache: Path, symbol: str, month: date) -> bool:
    """Whether a hole month is worth importing again: its archives were never cached here, or Binance has
    published another checksum for one of them since (the stale copy is dropped). One small request a day."""
    changed = False
    for key in _keys(symbol, month):
        cached = Path(cache) / (key + ".CHECKSUM")
        if not cached.is_file():
            return True
        try:
            remote = sources._get(sources.ARCHIVE + key + ".CHECKSUM").split()
        except sources._NotPublished:
            continue
        if remote and remote[0].decode("ascii", errors="replace").lower() != cached.read_text().split()[0].lower():
            (Path(cache) / key).unlink(missing_ok=True)
            cached.unlink(missing_ok=True)
            changed = True
    return changed


def _sound(cache: Path, symbol: str, month: date) -> bool:
    """A cached month (with its eve) read through outside the import lock as the import reads it: False at a
    broken aggTrade sequence or any other refusal of an archive's content, so a hole whose gap is still there
    never takes the lock to write the days before the gap and roll them back."""
    state = aggtrades.State()
    try:
        for key in _keys(symbol, month):
            day = key.removesuffix(".zip").rsplit("-aggTrades-", 1)[1]
            for _ in aggtrades.batches(Path(cache) / key, symbol, day, state, {}):
                pass
    except sources.MarketError:
        return False
    return True


def _import(kind: str, profile: dict, month: date, cache: Path, symbols: list[str], log) -> list[dict]:
    """One month of `symbols` by the kind's importer: [{symbol, rows, commit, through}]."""
    if kind == "quotes":
        found = store.import_quotes(profile, month, cache, symbols=symbols, log=log)
        return [{"symbol": symbol, "rows": found["per_symbol"][symbol]["quotes"], "commit": found["market_commit"],
                 "through": found["through"]} for symbol in symbols]
    found = aggtrades.import_month(profile, month, cache, symbols, log=log)
    return [{"symbol": item["symbols"][0], "rows": item["trade_rows"], "commit": item["market_commit"],
             "through": item["through"]} for item in found["imports"]]


def _listing(kind: str, profile: dict) -> list[dict]:
    with store.connect(profile, "reader") as conn:
        return (store.quote_imports if kind == "quotes" else store.trade_imports)(conn)


def _monthly(kind: str, profile: dict, imports: list[dict], symbols: list[str], cache: Path, memory: Memory,
             today: date, log, entries: dict) -> None:
    """Import every closed month after each contract's latest, oldest first. Quotes go one contract a call (one
    transaction for the whole call); aggTrades go one call per month for the contracts due then (each contract
    its own commit, written at once), one contract a call after a refused group."""
    pending: dict[str, date] = {}
    for symbol in symbols:
        if memory.stop(kind, symbol):
            continue
        month = following(imports, symbol, memory.skipped.get((kind, symbol), ()))
        if isinstance(month, dict):
            memory.stopped[(kind, symbol)] = month
        else:
            pending[symbol] = month
    while pending:
        month = min(pending.values())
        if universe.next_month(month) > today:
            return
        due = [symbol for symbol, value in pending.items() if value == month]
        ready = []
        for symbol in due:
            try:
                published = _published(cache, symbol, month)
            except Exception as exc:  # noqa: BLE001 - every failure of a round is reported, never raised
                if not _stop(kind, symbol, exc, memory):
                    entries[symbol]["retry"] = _refusal(exc)
                published = False
            if published:
                ready.append(symbol)
            else:
                del pending[symbol]
        groups = [ready] if kind == "trades" and ready else [[symbol] for symbol in ready]
        while groups:
            group = groups.pop(0)
            try:
                for item in _import(kind, profile, month, cache, group, log):
                    entry = entries[item["symbol"]]
                    entry["rows"] += item["rows"]
                    entry["commits"].append(item["commit"])
                    if item["through"] != universe.next_month(month).isoformat():
                        memory.stopped[(kind, item["symbol"])] = {"code": PARTIAL_MONTH, "message": (
                            f"{item['symbol']} {month:%Y-%m} was imported through {item['through']}")}
                        pending.pop(item["symbol"], None)
                    else:
                        pending[item["symbol"]] = _after(month, memory.skipped.get((kind, item["symbol"]), ()))
            except Exception as exc:  # noqa: BLE001
                if len(group) > 1:
                    # Contracts written before the refusal keep their commits: read which, then one call each.
                    held = _listing(kind, profile)
                    for symbol in group:
                        if universe.next_month(month) == _held(held, symbol).get(month):
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


def _holes(kind: str, profile: dict, imports: list[dict], symbols: list[str], cache: Path, memory: Memory,
           log, entries: dict) -> None:
    """Once a month: each hole month whose archives are new here or were republished, imported once. A refusal
    leaves the hole as it is until next month's try; one about the whole database stops everything."""
    for symbol in symbols:
        if memory.stop(kind, symbol):
            continue
        for month in holes(imports, symbol):
            try:
                if not (_republished(cache, symbol, month) and _published(cache, symbol, month)
                        and _sound(cache, symbol, month)):
                    continue
                for item in _import(kind, profile, month, cache, [symbol], log):
                    entries[symbol]["rows"] += item["rows"]
                    entries[symbol]["commits"].append(item["commit"])
                    entries[symbol].setdefault("filled", []).append(f"{month:%Y-%m}")
            except Exception as exc:  # noqa: BLE001
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

def _listings(profile: dict) -> dict:
    with store.connect(profile, "reader") as conn:
        if conn.empty:
            raise sources.MarketError("the market database holds no bar import yet", code="MARKET_EMPTY")
        bars = store.imports(conn)
        latest = date.fromisoformat(max(item["month"] for item in bars) + "-01")
        members: dict[date, list[str]] = {}
        for month, symbol in conn.rows("SELECT month, symbol FROM universe_month WHERE universe_rule = %s AND "
                                       "month >= %s ORDER BY month, symbol", (conn.universe_rule, latest)):
            members.setdefault(month, []).append(symbol)
        return {"bars": bars, "members": members, "metrics": store.metrics_imports(conn),
                "quotes": store.quote_imports(conn), "trades": store.trade_imports(conn)}


def _states(listing: dict | None, symbols: list[str], memory: Memory, today: date, kinds: dict) -> None:
    lag = today - timedelta(days=LAG_DAYS)
    for kind, entries in kinds.items():
        for symbol, entry in entries.items():
            if (refusal := memory.stop(kind, symbol)) is not None:
                entry["state"], entry["refusal"] = "stopped", refusal
            elif listing is None:
                entry["state"] = "unknown"
            elif kind == "bars":
                month, end = bar_months(listing["bars"], today)
                held = {item["month"]: item["through"] for item in listing["bars"]}.get(f"{month:%Y-%m}")
                entry["through"] = held or month.isoformat()
                first = date.fromisoformat(entry["through"])
                entry["state"] = ("caught_up" if first >= end else "lagging" if first < lag else "waiting")
            elif kind == "metrics":
                left = missing(listing["metrics"], symbol, today)
                if left is None:
                    entry["state"], entry["refusal"] = "stopped", {"code": NO_HISTORY, "message": (
                        f"no metrics import holds {symbol}; import its history once with market import-metrics")}
                    continue
                flat = [day for days in (left or {}).values() for day in days]
                entry["missing_from"], entry["missing_days"] = (flat[0].isoformat() if flat else None), len(flat)
                entry["state"] = ("caught_up" if not flat else "lagging" if flat[0] < lag else "waiting")
            else:
                due = following(listing[kind], symbol, memory.skipped.get((kind, symbol), ()))
                if isinstance(due, dict):
                    entry["state"], entry["refusal"] = "stopped", due
                    continue
                entry["next_month"] = f"{due:%Y-%m}"
                closed = universe.next_month(due)
                entry["state"] = ("caught_up" if closed > today else "lagging" if closed < lag else "waiting")


def run_round(profile: dict, symbols: list[str], cache: Path, memory: Memory, publish, now: datetime, log) -> dict:
    """One round: bars, then each contract's metrics, quotes and aggTrades (a refusal of one never keeps another
    from importing), the holes once a month, a publish when the market is ahead of origin, and the status."""
    today = now.astimezone(UTC).date()
    kinds: dict[str, dict] = {kind: {key: {"rows": 0, "commits": []} for key in ([BARS] if kind == "bars" else symbols)}
                              for kind in KINDS}
    status: dict = {"at": now.isoformat(), "last_closed_day": (today - timedelta(days=1)).isoformat(),
                    "kinds": kinds, "round_refusal": None, "published": None, "publish_refusal": None}
    listing: dict | None = None
    try:
        listing = _listings(profile)
    except Exception as exc:  # noqa: BLE001 - every failure of a round is reported, never raised
        status["round_refusal"] = _refusal(exc)
        if sort("bars", exc) == "all":
            memory.stopped["*"] = status["round_refusal"]
    if listing is not None and not memory.stop("bars", BARS):
        try:
            _bars(profile, listing, cache, memory, today, log, kinds["bars"][BARS])
        except Exception as exc:  # noqa: BLE001
            if not _stop("bars", BARS, exc, memory):
                kinds["bars"][BARS]["retry"] = _refusal(exc)
    for symbol in symbols:
        if listing is None or "*" in memory.stopped:
            break
        if memory.stop("metrics", symbol):
            continue
        for month, days in (missing(listing["metrics"], symbol, today) or {}).items():
            try:
                if not _fetched(cache, symbol, days):
                    continue
                found = metrics.import_month(profile, month, cache, [symbol], log=log)
                kinds["metrics"][symbol]["rows"] += found["metrics_rows"]
                kinds["metrics"][symbol]["commits"] += [item["market_commit"] for item in found["imports"]]
            except Exception as exc:  # noqa: BLE001
                if _stop("metrics", symbol, exc, memory):
                    break
                kinds["metrics"][symbol]["retry"] = _refusal(exc)
    holes_due = memory.holes_tried != _month(today)
    for step, kind in [(_monthly, kind) for kind in MONTHLY] + [(_holes, kind) for kind in MONTHLY if holes_due]:
        if listing is None or "*" in memory.stopped:
            break
        try:
            if step is _monthly:
                _monthly(kind, profile, listing[kind], symbols, cache, memory, today, log, kinds[kind])
            else:
                _holes(kind, profile, listing[kind], symbols, cache, memory, log, kinds[kind])
        except Exception as exc:  # noqa: BLE001 - a listing or download failure between imports: next round
            if sort(kind, exc) == "all":
                memory.stopped["*"] = _refusal(exc)
            for entry in kinds[kind].values():
                entry.setdefault("retry", _refusal(exc))
    if listing is not None and "*" not in memory.stopped and holes_due:
        memory.holes_tried = _month(today)
    if listing is not None and "*" not in memory.stopped:
        try:
            status["published"] = publish()
        except Exception as exc:  # noqa: BLE001
            status["publish_refusal"] = _refusal(exc)
            if sort("bars", exc) == "all":
                memory.stopped["*"] = status["publish_refusal"]
    try:
        listing = _listings(profile)
    except Exception as exc:  # noqa: BLE001
        status["round_refusal"] = status["round_refusal"] or _refusal(exc)
        listing = None
    _states(listing, symbols, memory, today, kinds)
    for kind in MONTHLY:
        for symbol, entry in kinds[kind].items():
            entry["skipped"] = [f"{month:%Y-%m}" for month in memory.skipped.get((kind, symbol), ())]
    hourly = listing is None or any(entry["state"] == "waiting" for entries in kinds.values()
                                    for entry in entries.values())
    status["next_round"] = (now + HOURLY if hourly else
                            datetime.combine(today + timedelta(days=1), WAKE, tzinfo=UTC)).isoformat()
    return status


def write_status(path: Path, status: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_name(path.name + ".part")
    partial.write_text(json.dumps(status, separators=(",", ":"), ensure_ascii=False) + "\n", encoding="utf-8")
    os.replace(partial, path)


def follow(profile: dict, symbols: list[str], cache: Path, status_path: Path, publish, *, log=print, report=print,
           clock=lambda: datetime.now(UTC), sleep=time.sleep, rounds: int | None = None,
           delay: float = START_DELAY) -> dict:
    """market.follow: after `delay` seconds, run rounds for ever (or `rounds` of them), each reported as one JSON
    line and written to `status_path`, sleeping in short naps until the round's next_round. Each round first
    marks the last status running, so a long round reads as healthy. Stops last until the process restarts.
    publish_failing_since is the first round of the current run of refused publishes."""
    scope = store._scope(symbols)
    if scope is None:
        raise sources.MarketError("follow needs the contracts to keep", code="IMPORT_SCOPE", missing=("--symbols",))
    memory = Memory()
    done, failing_since = 0, None
    status: dict = {}
    until = clock() + timedelta(seconds=delay)
    while rounds is None or done < rounds:
        while (now := clock()) < until:
            sleep(min(NAP, (until - now).total_seconds()))
        write_status(status_path, {**status, "at": status.get("at", now.isoformat()), "running_since": now.isoformat()})
        status = run_round(profile, scope, cache, memory, publish, now, log)
        failing_since = (failing_since or status["at"]) if status.get("publish_refusal") else None
        status["publish_failing_since"] = failing_since
        write_status(status_path, status)
        report(json.dumps(status, separators=(",", ":"), ensure_ascii=False))
        done += 1
        until = datetime.fromisoformat(status["next_round"])
    return status


def check(path: Path | None = None, now: datetime | None = None) -> int:
    """The healthcheck: 0 when the latest status is fresh (or a round is running since it), nothing is stopped,
    lagging or unknown (skipped months are not), and publishes have not been refused for longer than STALE."""
    try:
        status = json.loads((path or default_status()).read_text(encoding="utf-8"))
        now = now or datetime.now(UTC)
        fresh = now - datetime.fromisoformat(status["at"]) <= STALE
        failing = status.get("publish_failing_since")
        published = failing is None or now - datetime.fromisoformat(failing) <= STALE
        return 0 if fresh and published and all(entry["state"] in ("caught_up", "waiting")
                                                for entries in status.get("kinds", {}).values()
                                                for entry in entries.values()) else 1
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        return 1
