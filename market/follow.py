"""Unattended upkeep of the stored open interest and long/short ratios (market.follow_metrics): each named
contract's days through the last closed UTC day, imported by market.import_metrics once Binance publishes
them, and the market published after every round. It adds no import rule; each refusal of an import or a
publish is sorted into retrying next round or stopping (docs/plans/daily-metrics-import.zh.md)."""

from __future__ import annotations

from datetime import UTC, date, datetime, time as day_time, timedelta
import json
import os
from pathlib import Path
import tempfile
import time

from market import metrics, sources, store, universe


# Refusals that a later round can outlive: an archive not out yet, a lock another import or a backup holds,
# the Dolt service restarting or bootstrapping, the network, an unconfirmed push, and a concurrent manual
# import that already took the days.
RETRY = frozenset({"ARCHIVE_NOT_PUBLISHED", "CONCURRENT_IMPORT", "MARKET_UNREACHABLE", "MARKET_EMPTY",
                   "SOURCE_UNREACHABLE", "PUBLISH_FAILED", "MONTH_EXISTS"})
# Refusals about the whole database or its publication: every contract stops until the service restarts.
DATABASE = frozenset({"DIRTY_WORKING_SET", "SCHEMA_MISMATCH", "SCHEMA_VERSION_MISMATCH", "COMMIT_CHECKS_DISABLED",
                      "DATA_TESTS_FAILED", "RULE_VERSION_MISMATCH", "PUBLISH_REJECTED", "PUBLISH_FORBIDDEN",
                      "REMOTE_UNSET", "REMOTE_INVALID"})
# Any other coded refusal of a contract (SOURCE_SHAPE, SCALE_LOSS, CHECKSUM_MISMATCH, ...) stops that contract.

LAG_DAYS = 3  # a day still missing this many days after it closed: poll it daily and report the contract lagging
WAKE = day_time(0, 30)  # the daily round, UTC
HOURLY = timedelta(hours=1)
NAP = 300  # seconds per sleep; the wall clock is read after each, since host sleep pauses the Docker VM
STALE = timedelta(hours=26)  # a status older than this is a stuck command
NO_HISTORY = "NO_METRICS_HELD"


def default_status() -> Path:
    return Path(tempfile.gettempdir()) / "metrics-import" / "status.json"


def _refusal(exc: BaseException) -> dict:
    code = getattr(exc, "code", None)
    return {"code": code or type(exc).__name__, "message": str(getattr(exc, "message", None) or exc)}


def _month(day: date) -> date:
    return day.replace(day=1)


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


def _imports(profile: dict) -> list[dict]:
    with store.connect(profile, "reader") as conn:
        if conn.empty:
            raise sources.MarketError("the market database holds no bar import yet", code="MARKET_EMPTY")
        return store.metrics_imports(conn)


def run_round(profile: dict, symbols: list[str], cache: Path, stopped: dict[str, dict], publish, now: datetime,
              log) -> dict:
    """One round: import each contract's months with days missing, one contract at a time (a refusal of
    one never keeps another from importing), publish when the market is ahead of origin, and return the status.
    `stopped` (contract, or "*" for every contract, to refusal) carries the stops across rounds."""
    today = now.astimezone(UTC).date()
    contracts: dict[str, dict] = {symbol: {"rows": 0, "commits": []} for symbol in symbols}
    status: dict = {"at": now.isoformat(), "last_closed_day": (today - timedelta(days=1)).isoformat(),
                    "contracts": contracts, "round_refusal": None, "published": None, "publish_refusal": None}
    imports: list[dict] | None = None
    try:
        imports = _imports(profile)
    except Exception as exc:  # noqa: BLE001 - every failure of a round is reported, never raised
        status["round_refusal"] = _refusal(exc)
        if getattr(exc, "code", None) in DATABASE:
            stopped["*"] = status["round_refusal"]
    for symbol in symbols:
        if imports is None or "*" in stopped:
            break
        if symbol in stopped:
            continue
        for month, days in (missing(imports, symbol, today) or {}).items():
            try:
                if not _fetched(cache, symbol, days):
                    continue
                found = metrics.import_month(profile, month, cache, [symbol], log=log)
                contracts[symbol]["rows"] += found["metrics_rows"]
                contracts[symbol]["commits"] += [item["market_commit"] for item in found["imports"]]
            except Exception as exc:  # noqa: BLE001
                refusal, code = _refusal(exc), getattr(exc, "code", None)
                if code in DATABASE:
                    stopped["*"] = refusal
                    break
                if code is not None and code not in RETRY:
                    stopped[symbol] = refusal
                    break
                contracts[symbol]["retry"] = refusal
    if imports is not None and "*" not in stopped:
        try:
            status["published"] = publish()
        except Exception as exc:  # noqa: BLE001
            status["publish_refusal"], code = _refusal(exc), getattr(exc, "code", None)
            if code is not None and code not in RETRY:
                stopped["*"] = status["publish_refusal"]
    try:
        imports = _imports(profile)
    except Exception as exc:  # noqa: BLE001
        status["round_refusal"] = status["round_refusal"] or _refusal(exc)
        imports = None
    for symbol, entry in contracts.items():
        left = missing(imports, symbol, today) if imports is not None else {}
        flat = [day for month_days in (left or {}).values() for day in month_days]
        entry["missing_from"], entry["missing_days"] = (flat[0].isoformat() if flat else None), len(flat)
        if symbol in stopped or "*" in stopped:
            entry["state"], entry["refusal"] = "stopped", stopped.get(symbol) or stopped["*"]
        elif imports is None:
            entry["state"] = "unknown"
        elif left is None:
            entry["state"] = "stopped"
            entry["refusal"] = {"code": NO_HISTORY, "message": f"no metrics import holds {symbol}; import its "
                                "history once with market import-metrics"}
        elif not flat:
            entry["state"] = "caught_up"
        else:
            entry["state"] = "lagging" if flat[0] < today - timedelta(days=LAG_DAYS) else "waiting"
    hourly = imports is None or any(entry["state"] == "waiting" for entry in contracts.values())
    status["next_round"] = (now + HOURLY if hourly else
                            datetime.combine(today + timedelta(days=1), WAKE, tzinfo=UTC)).isoformat()
    return status


def write_status(path: Path, status: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_name(path.name + ".part")
    partial.write_text(json.dumps(status, separators=(",", ":"), ensure_ascii=False) + "\n", encoding="utf-8")
    os.replace(partial, path)


def follow(profile: dict, symbols: list[str], cache: Path, status_path: Path, publish, *, log=print, report=print,
           clock=lambda: datetime.now(UTC), sleep=time.sleep, rounds: int | None = None) -> dict:
    """market.follow_metrics: run rounds for ever (or `rounds` of them), each reported as one JSON line and
    written to `status_path`, sleeping in short naps until the round's next_round. Stops last until the
    process restarts."""
    scope = store._scope(symbols)
    if scope is None:
        raise sources.MarketError("follow-metrics needs the contracts to keep", code="IMPORT_SCOPE",
                                  missing=("--symbols",))
    stopped: dict[str, dict] = {}
    done, status = 0, {}
    while rounds is None or done < rounds:
        status = run_round(profile, scope, cache, stopped, publish, clock(), log)
        write_status(status_path, status)
        report(json.dumps(status, separators=(",", ":"), ensure_ascii=False))
        done += 1
        if rounds is not None and done >= rounds:
            break
        until = datetime.fromisoformat(status["next_round"])
        while (now := clock()) < until:
            sleep(min(NAP, (until - now).total_seconds()))
    return status


def check(path: Path | None = None, now: datetime | None = None) -> int:
    """The healthcheck: 0 when the latest status is fresh and no contract is stopped, lagging or unknown."""
    try:
        status = json.loads((path or default_status()).read_text(encoding="utf-8"))
        fresh = (now or datetime.now(UTC)) - datetime.fromisoformat(status["at"]) <= STALE
        return 0 if fresh and all(item["state"] in ("caught_up", "waiting")
                                  for item in status["contracts"].values()) else 1
    except (OSError, ValueError, KeyError, TypeError):
        return 1
