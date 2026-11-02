"""`market.convert`: the Dolt market database (archived on DoltHub as `vincent/trade-market`) as a market
directory (docs/plans/market-parquet-store.zh.md §4). The commits the ledger pins become versions under
their own ids and Dolt main's latest commit the version after them. Reads Dolt, writes only the new directory.
"""

from __future__ import annotations

from collections.abc import Iterator
from concurrent.futures import ProcessPoolExecutor
from datetime import date, timedelta
import hashlib
import itertools
import json
from pathlib import Path
import re
import sys
import time

import pyarrow as pa
import pyarrow.parquet as pq

from market import review, store, universe, versions
from market.sources import _refuse

# The ledger's pinned market commits, each chain in history order: legacy-20261025 holds the bars-only
# market of 10-19, main was rebuilt on 10-26. The main chain continues with main's latest commit.
PINNED = (("legacy-20261025", ("l1kfbo4b2of54ijpjnpn02ijdm175aqd",)),
          ("main", ("gc305h705ocn5fm3lcjjerln283gek2t", "6ho8evfcea6p4680qbkeo3mdhaqjscp5",
                    "1kcbv73ptu3l3clg37g0f0k77c370kk8", "dbnggsrnquf09evsncorvngiuan1br6a",
                    "pn5bee9mvj18qj1boc5v9b5faotu4ehb", "iv711v5dpnv5qr62i5ejk3udk431f5k6")))
MAIN = "main"
# Dolt import kinds and the receipt kinds they become.
KINDS = {store.IMPORT: store.BARS, store.QUOTE_IMPORT: store.QUOTES, store.TRADE_IMPORT: store.TRADES,
         store.METRICS_IMPORT: store.METRICS}
PER_CONTRACT = {store.QUOTES: "quote", store.TRADES: "agg_trade", store.METRICS: "metrics"}
# The administrator's commits: tables created or views dropped, never rows.
SCHEMA_COMMIT = re.compile(r"Initialize data repository|market tables|market views dropped: \w+")
UPGRADE = re.compile(r"market tables: (\w+)")
EPOCH = date(1970, 1, 1)
TABLES = {name for known in versions.TABLES.values() for name in known}


def convert(profile: dict, root: Path, workers: int = 4, pinned=PINNED, log=None) -> dict:
    """The market directory of the Dolt market `profile` written at `root` (absent or empty), and the check
    report: findings is empty when every version holds Dolt's rows and passes data_tests and market review."""
    log = log or (lambda line: print(line, file=sys.stderr, flush=True))
    started = time.monotonic()
    root = Path(root)
    if root.exists() and any(root.iterdir()):
        raise _refuse(f"{root} is not an empty directory", "LEDGER_EXISTS", missing=(str(root),))
    for path in (root / "files", root / "versions"):
        path.mkdir(parents=True, exist_ok=True)
    market = versions.open_market({"root": str(root)}, "import")
    findings: list[dict] = []
    report: list[dict] = []
    written: dict[str, bytes] = {}
    with store.connect(profile, "reader") as conn, versions.lock(market), ProcessPoolExecutor(workers) as pool:
        main = conn.rows("SELECT HASHOF(%s)", (MAIN,))[0][0]
        branches = {row[0] for row in conn.rows("SELECT name FROM dolt_branches")}
        for branch, commits in pinned:
            order = [row[0] for row in _history(conn, branch) if row[0] in commits] if branch in branches else []
            if order != list(commits):
                raise _refuse(f"the pinned commits are not in this order on {branch}: {', '.join(commits)}",
                              "HISTORY_REWRITTEN", missing=tuple(commits))
            chain: dict = {"schema": None, "through": {}, "version": None, "parent": None, "done": 0}
            for target in [*commits, *([main] if branch == MAIN and main != commits[-1] else [])]:
                version_id, version = _convert_version(conn, pool, market, profile, chain, target, target in commits,
                                                findings)
                written[version_id] = versions.canonical(version)
                counted = {}
                for table in versions.TABLES[version["market_schema"]["version"]]:
                    counted[table] = {"dolt": conn.rows(f"SELECT COUNT(*) FROM `{table}` AS OF '{target}'")[0][0],
                                      "files": sum(pq.read_metadata(root / "files" / f"{entry['sha256']}.parquet")
                                                   .num_rows for entry in version["files"] if entry["table"] == table)}
                    if counted[table]["dolt"] != counted[table]["files"]:
                        findings.append({"check": "CHECK_FAILED", "commit": version_id,
                                         "detail": f"{table}: Dolt holds {counted[table]['dolt']} rows at {target}, "
                                                   f"the version's files {counted[table]['files']}"})
                findings += [{"check": "DATA_TESTS_FAILED", "commit": version_id, "detail": name}
                             for name in versions.data_tests(market, version)]
                report.append({"commit": version_id, "dolt_commit": target, "parent": version["parent"],
                               "schema_version": version["market_schema"]["version"],
                               "files": len(version["files"]), "receipts": len(version["receipts"]), "rows": counted})
                log(f"{version_id} ({target}): {len(version['files'])} files, {len(version['receipts'])} receipts, "
                    f"{round(time.monotonic() - started)}s")
        head = report[-1]["commit"]
        versions._place(root / "head", f"{head}\n".encode())

    converted = {commit: hashlib.sha256(written[commit]).hexdigest() for _, commits in pinned for commit in commits}
    if versions.CONVERTED:
        findings += [{"check": "HASH_MISMATCH", "commit": commit,
                      "detail": f"the conversion gives {sha}, CONVERTED pins {versions.CONVERTED.get(commit)}"}
                     for commit, sha in converted.items() if versions.CONVERTED.get(commit) != sha]
    else:
        versions.CONVERTED.update(converted)  # this process only: market review resolves the pinned ids by it
    findings += review.review(versions.open_market({"root": str(root)}, "reader"), list(converted))
    return {"root": str(root), "main": main, "head": head, "versions": report, "converted": converted,
            "findings": findings, "seconds": round(time.monotonic() - started)}


def _history(conn: store.MarketConnection, ref: str) -> list[tuple[str, str, str]]:
    """(commit, committer, message) from the first commit to ref, which must be a line: each commit's parent
    is the one before it."""
    history = [tuple(row) for row in conn.rows("SELECT commit_hash, committer, message FROM DOLT_LOG(%s)", (ref,))]
    merges = {row[0] for row in conn.rows("SELECT commit_hash FROM dolt_commit_ancestors WHERE parent_index > 0")}
    merged = [commit for commit, _, _ in history if commit in merges]
    if merged:
        raise _refuse(f"{ref}'s history merges at {merged[0]}", "HISTORY_REWRITTEN", missing=tuple(merged))
    return history[::-1]


def _tables(conn: store.MarketConnection, ref: str) -> set[str]:
    # SHOW TABLES AS OF lists the session's views, not the commit's.
    return {row[0] for row in conn.rows(f"SHOW FULL TABLES AS OF '{ref}' WHERE Table_type = 'BASE TABLE'")} - {
        "market_schema"}


def _day_ms(day: str) -> int:
    return (date.fromisoformat(day) - EPOCH).days * versions.DAY


def _added(conn: store.MarketConnection, before: str, commit: str) -> dict[str, int]:
    """The rows an import commit added to each market table. It may only add rows (and count the import in
    market_schema), so the rows Dolt holds at a commit are its parent's and these."""
    added = {}
    for row in conn.dicts("SELECT * FROM DOLT_DIFF_STAT(%s, %s)", (before, commit)):
        table = row["table_name"]
        if table.startswith("dolt_"):  # Dolt's own tables (dolt_tests holds the data tests), no market data
            continue
        if table == "market_schema" and not row["rows_deleted"] and row["rows_added"] + row["rows_modified"] <= 1:
            continue  # the first import writes the singleton row, every later one counts itself in import_seq
        if table not in TABLES or row["rows_deleted"] or row["rows_modified"]:
            raise _refuse(f"commit {commit} changes {table} rows: {row['rows_deleted']} deleted, "
                          f"{row['rows_modified']} modified", "HISTORY_REWRITTEN", missing=(commit,))
        added[table] = int(row["rows_added"])
    return added


def _convert_version(conn, pool, market: versions.Market, profile: dict, chain: dict, target: str,
                     pinned: bool, findings: list[dict]) -> tuple[str, dict]:
    """The version of target: its commits after the chain's previous version, each import a receipt and the
    data files of the rows it added, read at target. An import's files hold as many rows as Dolt says it
    added to each table, else a CHECK_FAILED finding."""
    history = _history(conn, target)
    done = chain["done"]
    if done and history[done - 1][0] != chain["dolt"]:
        raise _refuse(f"{target} does not descend from {chain['dolt']}", "HISTORY_REWRITTEN", missing=(target,))
    receipts: list[bytes] = []
    plans: list[dict] = []
    added: dict[str, dict[str, int]] = {}
    for index in range(done, len(history)):
        commit, committer, message = history[index]
        before = history[index - 1][0] if index else None
        if committer != "root" and message.startswith("{"):
            try:
                receipt = json.loads(message)
            except json.JSONDecodeError:
                receipt = {}
            kind = KINDS.get(str(receipt.get("import"))) if isinstance(receipt, dict) else None
            if kind is None or before is None:
                raise _refuse(f"commit {commit} is no import: {message[:80]}", "HISTORY_REWRITTEN", missing=(commit,))
            receipts.append(versions.canonical({**receipt, "import": kind}))
            added[commit] = _added(conn, before, commit)
            plans += [{**plan, "commit": commit} for plan in _plans(conn, chain, kind, receipt, before, commit)]
            continue
        upgrade = UPGRADE.fullmatch(message)
        if not (SCHEMA_COMMIT.fullmatch(message) or upgrade):
            raise _refuse(f"commit {commit} by {committer} is neither an import nor a schema change: {message[:80]}",
                          "HISTORY_REWRITTEN", missing=(commit,))
        # The administrator's commits create tables and drop views (dolt_schemas): no market table's rows or
        # columns change.
        if before is not None and any(
                (row["data_change"] and {row["from_table_name"], row["to_table_name"]} & TABLES)
                or (row["schema_change"] and row["from_table_name"] in TABLES)
                for row in conn.dicts("SELECT * FROM DOLT_DIFF_SUMMARY(%s, %s)", (before, commit))):
            raise _refuse(f"schema commit {commit} changes a market table", "HISTORY_REWRITTEN", missing=(commit,))
        if message == "market tables":
            tables = _tables(conn, commit)
            chain["schema"] = next((number for number, known in versions.TABLES.items() if set(known) == tables), None)
        elif upgrade:
            schema = chain["schema"]
            if schema is None or set(versions.TABLES.get(schema + 1, ())) - set(versions.TABLES[schema]) != {
                    upgrade.group(1)}:
                raise _refuse(f"commit {commit} adds {upgrade.group(1)}, not the table of version {schema} + 1",
                              "HISTORY_REWRITTEN", missing=(commit,))
            chain["schema"] = schema + 1
            receipts.append(versions.canonical({"import": "market-upgrade"}))
    schema = chain["schema"]
    if schema is None or set(versions.TABLES[schema]) != _tables(conn, target):
        raise _refuse(f"{target}'s tables are no table version's", "HISTORY_REWRITTEN", missing=(target,))
    facts = conn.dicts(f"SELECT price_scale, volume_scale, universe_rule FROM market_schema AS OF '{target}'")[0]
    market_schema = {"version": schema, **facts}
    parent = chain["version"] or {"files": [], "receipts": []}
    for index, plan in enumerate(plans):
        for other in parent["files"] + plans[:index]:
            if versions.overlap(plan, other):
                raise _refuse(f"{plan['table']} {plan['symbol'] or 'all contracts'} [{plan['start_ms']}, "
                              f"{plan['end_ms']}) meets [{other['start_ms']}, {other['end_ms']})", "ENTRY_OVERLAP",
                              missing=(plan["table"],))
    shas = [hashlib.sha256(data).hexdigest() for data in receipts]
    tasks = [{**plan, "profile": profile, "root": str(market.root), "at": target, "market_schema": market_schema}
             for plan in plans]
    futures = [pool.submit(_write, task) for task in tasks]
    try:
        results = [future.result() for future in futures]
    except BaseException:
        for future in futures:  # a refusal reports once the running files end, not after every queued one
            future.cancel()
        raise
    entries, held = [], {commit: dict.fromkeys(stat, 0) for commit, stat in added.items()}
    for plan, entry in zip(plans, results, strict=True):
        if entry is not None:
            entries.append(entry)
            counts = held[plan["commit"]]
            counts[plan["table"]] = counts.get(plan["table"], 0) + pq.read_metadata(
                market.root / "files" / f"{entry['sha256']}.parquet").num_rows
    for commit, counts in held.items():
        findings += [{"check": "CHECK_FAILED", "commit": commit,
                      "detail": f"{table}: the commit adds {added[commit].get(table, 0)} rows, its files hold {count}"}
                     for table, count in counts.items() if added[commit].get(table, 0) != count]
    for data, sha in zip(receipts, shas, strict=True):
        versions._place(market.root / "files" / f"{sha}.json", data)
    version = {"market_schema": market_schema, "parent": chain["parent"], "files": parent["files"] + entries,
               "receipts": parent["receipts"] + shas}
    version_id = target if pinned else versions.version_id(version)
    versions._place(market.root / "versions" / f"{version_id}.json", versions.canonical(version))
    chain.update(version=version, parent=version_id, done=len(history), dolt=target)
    return version_id, version


def _plans(conn, chain: dict, kind: str, receipt: dict, before: str, commit: str) -> list[dict]:
    """The data files of one import commit: {table, symbol, start_ms, end_ms}, symbol None for a file of
    every contract. An interval starts where the same month's (and contract's) previous import ended."""
    month = date.fromisoformat(receipt["month"] + "-01")
    start, end = _day_ms(receipt["month"] + "-01"), _day_ms(receipt["through"])
    plans = []
    if kind == store.BARS:
        low = chain["through"].get((kind, month), start)
        chain["through"][(kind, month)] = end
        if low < end:
            plans += [{"table": table, "symbol": None, "start_ms": low, "end_ms": end} for table in ("bar", "funding")]
        added = {}
        for table, time in (("universe_month", "month"), ("instrument", "observed_at")):
            found = conn.rows(f"SELECT MIN(to_{time}), MAX(to_{time}) FROM DOLT_DIFF(%s, %s, '{table}') "
                              "WHERE diff_type = 'added'", (before, commit))[0]
            added[table] = found if found[0] is not None else None
        if added["universe_month"]:
            first, last = added["universe_month"]
            if first != last:
                raise _refuse(f"commit {commit} adds members of several months", "HISTORY_REWRITTEN",
                              missing=(commit,))
            plans.append({"table": "universe_month", "symbol": None, "start_ms": _day_ms(first.isoformat()),
                          "end_ms": _day_ms(universe.next_month(first).isoformat())})
        if added["instrument"]:
            plans.append({"table": "instrument", "symbol": None, "start_ms": added["instrument"][0],
                          "end_ms": added["instrument"][1] + 1})
        return plans
    for symbol in receipt["symbols"]:
        low = _day_ms(receipt["from"]) if kind == store.METRICS else chain["through"].get((kind, symbol, month),
                                                                                              start)
        chain["through"][(kind, symbol, month)] = end
        if low < end:
            plans.append({"table": PER_CONTRACT[kind], "symbol": symbol, "start_ms": low, "end_ms": end})
    return plans


def _write(task: dict) -> dict | None:
    """One planned data file (in a worker process), or None when Dolt holds no rows in its interval."""
    # The converting process holds the import lock and checked the planned intervals against each other.
    market = versions.Market(Path(task["root"]), "import", None, True, locked=True,
                             version={"market_schema": task["market_schema"], "files": []})
    definition = versions.TABLES[task["market_schema"]["version"]][task["table"]]
    with store.connect(task["profile"], "reader") as conn:
        batches = _rows(conn, task, definition)
        first = next(batches, None)
        if first is None:
            return None
        return versions.write_file(market, task["table"], task["symbol"], task["start_ms"], task["end_ms"],
                                   itertools.chain([first], batches))


def _rows(conn: store.MarketConnection, task: dict, definition: versions.Table) -> Iterator[pa.RecordBatch]:
    """The rows of one planned file at its Dolt commit, in key order: per contract (and price type) by the
    primary key's prefix, so Dolt reads an index range, not the table."""
    table, at, low, high = task["table"], task["at"], task["start_ms"], task["end_ms"]
    columns = ", ".join(f"`{name}`" for name in definition.schema.names)
    order = ", ".join(f"`{name}`" for name in definition.key)
    select = f"SELECT {columns} FROM `{table}` AS OF '{at}' WHERE "
    queries: list[tuple[str, tuple]]
    if table == "universe_month":
        queries = [(select + f"month >= %s AND month < %s ORDER BY {order}",
                    (EPOCH + timedelta(milliseconds=low), EPOCH + timedelta(milliseconds=high)))]
    elif table == "instrument":
        queries = [(select + f"observed_at >= %s AND observed_at < %s ORDER BY {order}", (low, high))]
    else:
        symbols = [task["symbol"]] if task["symbol"] else sorted(
            row[0] for row in conn.rows(f"SELECT DISTINCT symbol FROM instrument AS OF '{at}'"))
        time_range = f"`{definition.time}` >= %s AND `{definition.time}` < %s ORDER BY {order}"
        if table == "bar":
            queries = [(select + "symbol = %s AND price_type = %s AND " + time_range, (symbol, kind, low, high))
                       for symbol in symbols for kind in ("LAST", "MARK")]
        else:
            queries = [(select + "symbol = %s AND " + time_range, (symbol, low, high)) for symbol in symbols]
    for statement, params in queries:
        for chunk in conn.stream(statement, params):
            yield _batch(definition, chunk)


def _batch(definition: versions.Table, rows: list[tuple]) -> pa.RecordBatch:
    arrays = []
    for field, values in zip(definition.schema, zip(*rows, strict=True), strict=True):
        if field.type == pa.bool_():
            values = tuple(bool(value) for value in values)
        elif field.name == "classification":
            # Dolt gives JSON back in its own spelling; store the importer's (market.store), whatever Dolt's version.
            values = tuple(None if value is None else json.dumps(json.loads(value), sort_keys=True) for value in values)
        arrays.append(pa.array(values, type=field.type))
    return pa.RecordBatch.from_arrays(arrays, schema=definition.schema)
