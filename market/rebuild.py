"""Rebuild the agg_trade, quote and metrics files head lists and the market directory lacks (market.rebuild).

These tables are never uploaded: each file is what one import computed from the exchange's archives, so it is
made again by running that import from its receipt into a temporary directory, and kept only when it is the file
its version lists, byte for byte. The version that adds a file names the import: of the receipts it adds, the one
of that table's kind, contract and interval. The archives are checked against the SHA-256s the receipt records,
not the cache's .CHECKSUM (ARCHIVE_CHANGED); a metrics file reads exactly the receipt's days. The current code
runs first; a file it cannot remake names the image of the code that wrote it.

A rebuild holds the import lock but writes no version and runs no data tests: it only puts back files whose
bytes passed them when they were written.
"""

from __future__ import annotations

import hashlib
import os
from pathlib import Path
import shutil
import tempfile
import time

from market import aggtrades, metrics, series, sources, store, versions
from market.sources import MarketError, _refuse


KINDS = {"agg_trade": store.TRADES, "quote": store.QUOTES, "metrics": store.METRICS}
IMAGE = "ghcr.io/qoeop/trade-service:sha-{}"


def rebuild(profile: dict, cache: Path, tables: list[str] | None = None, symbols: list[str] | None = None,
            log=print) -> dict:
    """Every file of `tables` (default: all three) and `symbols` (default: all) head lists and the directory
    lacks, one at a time. A file that cannot be rebuilt leaves the others to go on; the refusal raised at the end
    is the first one's code and names every file refused."""
    started = time.monotonic()
    scope = store._scope(symbols)
    if tables is not None and (not tables or set(tables) - KINDS.keys()):
        raise _refuse(f"rebuild takes tables {', '.join(KINDS)}, not {tables}", "IMPORT_SCOPE", missing=("--tables",))
    market = versions.open_market(profile, "import")
    rebuilt: list[str] = []
    refused: list[tuple[dict, MarketError]] = []
    with versions.lock(market, complete=False):
        if market.empty:
            raise _refuse("the market has no version yet", "MARKET_EMPTY")
        for left in (market.root / "files").glob(".rebuild-*"):  # an earlier rebuild killed midway
            shutil.rmtree(left, ignore_errors=True)
        missing = [entry for entry in store.head_version(market)["files"] if entry["table"] in (tables or KINDS)
                   and (scope is None or entry["symbol"] in scope)
                   and not (market.root / "files" / f"{entry['sha256']}.parquet").is_file()]
        added = _added(market, missing)
        current = versions.writer()
        for entry in missing:
            label = _label(entry)
            try:
                _rebuild(market, entry, added[versions.canonical(entry)], cache, current)
            except MarketError as exc:
                refused.append((entry, exc))
                log(f"{label}: {exc.code} {exc.message}")
                continue
            rebuilt.append(entry["sha256"])
            log(f"{label}: rebuilt")
    if refused:
        first = refused[0][1]
        named = "; ".join(f"{_label(entry)}: {exc.code} {exc.message}" for entry, exc in refused[:10])
        raise MarketError(f"{len(refused)} of {len(missing)} files were not rebuilt ({len(rebuilt)} were): {named}",
                          code=first.code, missing=tuple(entry["sha256"] for entry, _ in refused))
    return {"commit": market.head, "rebuilt": rebuilt, "seconds": round(time.monotonic() - started, 1)}


def _label(entry: dict) -> str:
    return (f"{entry['table']} {entry['symbol']} {series._ms_day(entry['start_ms'])}.."
            f"{series._ms_day(entry['end_ms'])} {entry['sha256'][:12]}")


def _added(market: versions.Market, missing: list[dict]) -> dict[bytes, str]:
    """The version on head's chain that adds each entry: the newest whose own files list it."""
    wanted = {versions.canonical(entry) for entry in missing}
    found: dict[bytes, str] = {}
    for commit in versions.chain(market):
        if len(found) == len(wanted):
            break
        for entry in versions.own(market, commit)["files"]:
            key = versions.canonical(entry)
            if key in wanted:
                found.setdefault(key, commit)
    return found


def _receipt(market: versions.Market, entry: dict, commit: str) -> dict:
    """The receipt of the import that wrote `entry`, among those `commit` adds."""
    first, through = series._ms_day(entry["start_ms"]), series._ms_day(entry["end_ms"]).isoformat()
    found = []
    for sha in versions.own(market, commit)["receipts"]:
        item = versions.receipt(market, sha)
        if (item.get("import") == KINDS[entry["table"]] and item.get("symbols") == [entry["symbol"]]
                and item.get("through") == through and (item.get("from") == first.isoformat()
                                                         if entry["table"] == "metrics"
                                                         else item.get("month") == f"{first:%Y-%m}")):
            found.append(item)
    if len(found) != 1:
        raise _refuse(f"version {commit} adds {len(found)} receipts of this file's import, not one", "REBUILD_DIFFERS",
                      missing=(entry["sha256"],))
    return found[0]


def _archive(cache: Path, key: str, recorded: str) -> Path:
    """The archive's path, when its bytes have the SHA-256 the receipt records (ARCHIVE_CHANGED otherwise)."""
    try:
        path = aggtrades.fetch_archive(cache, key)
    except MarketError as exc:
        if exc.code == "ARCHIVE_NOT_PUBLISHED":
            raise _refuse(f"{key}, which the receipt records, is no longer published", "ARCHIVE_CHANGED",
                          missing=(key,)) from exc
        raise
    with path.open("rb") as stream:
        actual = hashlib.file_digest(stream, "sha256").hexdigest()
    if actual != recorded:
        raise _refuse(f"{key} has SHA-256 {actual}, the receipt records {recorded}", "ARCHIVE_CHANGED",
                      missing=(key,))
    return path


def _unpublished(cache: Path, key: str) -> None:
    """An archive the receipt does not record (it was not published then) is still not (ARCHIVE_CHANGED otherwise)."""
    try:
        aggtrades.fetch_archive(cache, key)
    except MarketError as exc:
        if exc.code == "ARCHIVE_NOT_PUBLISHED":
            return
        raise
    raise _refuse(f"{key} was not published when the import ran and is now", "ARCHIVE_CHANGED", missing=(key,))


def _rebuild(market: versions.Market, entry: dict, commit: str, cache: Path, current: str | None) -> None:
    table, symbol, start, end = entry["table"], entry["symbol"], entry["start_ms"], entry["end_ms"]
    receipt = _receipt(market, entry, commit)
    recorded = receipt["archives"][symbol]
    files = market.root / "files"
    files.mkdir(exist_ok=True)
    work = Path(tempfile.mkdtemp(prefix=".rebuild-", dir=files))
    try:
        job = {"root": str(work), "market_schema": market.market_schema, "files": [], "symbol": symbol,
               "cache": str(cache), "start": start, "end": end, "held": False, "earlier": False, "workers": 1}
        if table == "metrics":
            found = {day: _archive(cache, sources.metrics_key(symbol, day), sha) for day, sha in sorted(recorded.items())}
            made, again, _ = metrics.write(store.worker_market(job), symbol, receipt["month"], start, found,
                                           receipt["unpublished"][symbol], lambda line: None)
        else:
            # The eve and every day of the interval as the receipt records them; an eve it lacks was unpublished.
            for at in range(start - store.DAY, end, store.DAY):
                day = series._ms_day(at).isoformat()
                if day in recorded:
                    _archive(cache, sources.aggtrades_key(symbol, day), recorded[day])
                elif at < start:
                    _unpublished(cache, sources.aggtrades_key(symbol, day))
                else:
                    raise _refuse(f"the receipt records no archive of {day}", "REBUILD_DIFFERS", missing=(day,))
            if table == "quote":
                # The price increment the import used: the newest terms in the version that adds the file.
                job["tick"] = store._terms_rows(market, versions.load_version(market, commit))[1][symbol][
                    "price_increment"]
                result = store.quote_month(job)
            else:
                result = aggtrades.trade_month(job)
            made, again = result["entry"], result["receipt"]
        if made != entry:
            raise _refuse(_differs(entry, made, receipt, again, current), "REBUILD_DIFFERS",
                          missing=(entry["sha256"],))
        os.replace(work / "files" / f"{made['sha256']}.parquet", files / f"{made['sha256']}.parquet")
        versions._sync_dir(files)
    finally:
        shutil.rmtree(work, ignore_errors=True)


def _differs(entry: dict, made: dict, receipt: dict, again: dict, current: str | None) -> str:
    """Which code wrote the file, what the rebuild made instead, where its receipt departs, and what to run next."""
    keys = []
    for key in sorted((set(receipt) | set(again)) - {"writer"}):
        old, new = receipt.get(key), again.get(key)
        if old == new:
            continue
        if key in ("archives", "readings") and isinstance(old, dict) and isinstance(new, dict):
            days = sorted({day for symbol in set(old) | set(new) for day in {*old.get(symbol, {}), *new.get(symbol, {})}
                           if old.get(symbol, {}).get(day) != new.get(symbol, {}).get(day)})
            keys.append(f"{key} of {', '.join(days[:5])}")
        else:
            keys.append(key)
    writer = receipt.get("writer")
    text = (f"rebuilt as {made['sha256']} [{made['start_ms']}, {made['end_ms']}), the version lists "
            f"{entry['sha256']}; the receipt differs in {', '.join(keys) or 'nothing'}; ")
    if writer is None:
        return text + "the receipt names no writer"
    if writer == current:
        return text + f"this code ({writer}) wrote it"
    return text + (f"rebuild it with the code that wrote it: in {IMAGE.format(writer)}, `python -m cli.main market "
                   f"rebuild --tables {entry['table']} --symbols {entry['symbol']}`")
