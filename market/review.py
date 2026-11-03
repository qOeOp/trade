"""`market.review`: the whole market directory checked without trusting its writer
(docs/plans/market-parquet-store.zh.md §3). It reports findings and changes nothing.
"""

from __future__ import annotations

import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.parquet as pq

from market import versions
from market.sources import MarketError, _refuse


def review(market: versions.Market, ledger_commits: list[str]) -> list[dict]:
    """Findings {check, commit, detail}: hashes, row rules and data_tests, disjoint entries, the parent
    chain only growing, the ledger's market commits on head's chain, the converted versions."""
    findings: list[dict] = []

    def found(check: str, commit: str | None, detail: str) -> None:
        findings.append({"check": check, "commit": commit, "detail": detail})

    if market.head is None:
        found("MARKET_EMPTY", None, "the market has no version")
        return findings
    on_chain: list[str] = []
    commit: str | None = market.head
    while commit is not None:
        try:
            parent = versions.load_version(market, commit)["parent"]
        except MarketError as error:
            found(error.code, commit, f"the parent chain breaks: {error.message}")
            break
        on_chain.append(commit)
        commit = parent
    reviewed = list(on_chain)
    for commit in versions.CONVERTED if versions.CONVERTED_HEAD in on_chain else ():  # a market begun empty has none
        if commit not in on_chain:
            try:
                versions.load_version(market, commit)
                reviewed.append(commit)
            except MarketError as error:
                found(error.code, commit, error.message)

    for commit in reviewed:
        try:
            _check_parent(market, commit, found)
        except MarketError as error:
            found(error.code, commit, error.message)
    for commit in reviewed:
        _check_disjoint(commit, versions.load_version(market, commit), found)
    _check_files(market, reviewed, found)
    if on_chain and on_chain[0] == market.head:
        try:
            for name in versions.data_tests(market, versions.load_version(market, market.head)):
                found("DATA_TESTS_FAILED", market.head, name)
        except MarketError as error:
            found(error.code, market.head, f"data tests could not read head: {error.message}")
        except pa.ArrowException as error:
            found("CHECK_FAILED", market.head, f"data tests could not read head: {error}")

    chained = set(on_chain)
    for commit in sorted(set(ledger_commits)):
        if commit in chained:
            continue
        try:
            version, root = versions.load_version(market, commit), commit
            while root in versions.CONVERTED and version["parent"] is not None:  # a converted version's ancestors
                root, version = version["parent"], versions.load_version(market, version["parent"])
        except MarketError as error:
            found("MARKET_COMMIT_UNRESOLVED", commit, f"the ledger cites it: {error.message}")
            continue
        if not (root in versions.CONVERTED and version["parent"] is None):
            found("HISTORY_REWRITTEN", commit, "the ledger cites it and it is neither on head's parent chain nor "
                                               "a converted version")
    if market.origin:
        try:
            public = versions.fetch_public(market, "head")
        except MarketError as error:
            found(error.code, None, error.message)
        else:
            if public is None:
                found("MARKET_UNREACHABLE", None, "the public copy has no head")
            elif public.decode(errors="replace").strip() not in chained:
                found("HISTORY_REWRITTEN", public.decode(errors="replace").strip(),
                      "the public copy's head is not on the local chain")
    return findings


def _check_parent(market: versions.Market, commit: str, found) -> None:
    """A child lists its parent's entries and receipts unchanged and first; market_schema stays, except a
    market-upgrade version raising its version by one."""
    child = versions.load_version(market, commit)
    if child["parent"] is None:
        return
    parent = versions.load_version(market, child["parent"])
    for name in ("files", "receipts"):
        if child[name][:len(parent[name])] != parent[name]:
            found("HISTORY_REWRITTEN", commit, f"its {name} do not begin with its parent's unchanged")
    schema, before = child["market_schema"], parent["market_schema"]
    if schema != before:
        added = child["receipts"][len(parent["receipts"]):]
        upgraded = any(versions.receipt(market, sha).get("import") == "market-upgrade" for sha in added)
        same = {key: value for key, value in schema.items() if key != "version"}
        if not (upgraded and schema["version"] == before["version"] + 1
                and same == {key: value for key, value in before.items() if key != "version"}):
            found("HISTORY_REWRITTEN", commit, f"market_schema changed from {before} to {schema}")


def _check_disjoint(commit: str, version: dict, found) -> None:
    """Entries of one table sharing a contract do not meet; with every row inside its entry's interval
    (checked per file) and keys rising within a file, keys are unique across files."""
    by_table: dict[str, list[dict]] = {}
    for entry in version["files"]:
        by_table.setdefault(entry["table"], []).append(entry)
    for table, entries in by_table.items():
        active: list[dict] = []
        for entry in sorted(entries, key=lambda item: item["start_ms"]):
            active = [other for other in active if other["end_ms"] > entry["start_ms"]]
            for other in active:
                if versions.overlap(entry, other):
                    found("ENTRY_OVERLAP", commit, f"{table} {entry['symbol'] or 'all contracts'} "
                          f"[{entry['start_ms']}, {entry['end_ms']}) meets [{other['start_ms']}, {other['end_ms']})")
            active.append(entry)


def _check_files(market: versions.Market, reviewed: list[str], found) -> None:
    """Every file the reviewed versions list: its bytes hash to its name, every row keeps its table's rules
    and its entry's contract and interval, keys rise through the file, and each row group's time statistics
    (which reads use to skip row groups) are its rows' minimum and maximum."""
    entries: dict[tuple, str] = {}
    receipts: dict[str, str] = {}
    for commit in reviewed:
        version = versions.load_version(market, commit)
        for entry in version["files"]:
            key = (entry["sha256"], entry["table"], entry["symbol"], entry["start_ms"], entry["end_ms"])
            entries.setdefault(key, commit)
        for sha in version["receipts"]:
            receipts.setdefault(sha, commit)
    for sha, commit in receipts.items():
        try:
            versions.receipt(market, sha)
        except MarketError as error:
            found(error.code, commit, error.message)
    for (sha, table, symbol, start_ms, end_ms), commit in entries.items():
        definition = versions.tables_of(versions.load_version(market, commit)).get(table)
        if definition is None:
            found("CHECK_FAILED", commit, f"file {sha} is a {table} file, a table its version lacks")
            continue
        try:
            reader = pq.ParquetFile(pa.BufferReader(versions.entry_bytes(market, {"sha256": sha, "table": table})))
            if (reader.schema_arrow.names, reader.schema_arrow.types) != (definition.schema.names,
                                                                          definition.schema.types):
                raise _refuse(f"file {sha} has columns {reader.schema_arrow.names}", "CHECK_FAILED")
            column = reader.schema_arrow.get_field_index(definition.time)
            previous = None
            for group in range(reader.num_row_groups):
                rows = reader.read_row_group(group)
                stats = reader.metadata.row_group(group).column(column).statistics
                if stats is not None and stats.has_min_max and rows.num_rows:
                    bounds = pc.min_max(rows.column(definition.time))
                    if (stats.min, stats.max) != (bounds["min"].as_py(), bounds["max"].as_py()):
                        raise _refuse(f"file {sha} row group {group} states {definition.time} from {stats.min} to "
                                      f"{stats.max}; its rows run {bounds['min']} to {bounds['max']}", "CHECK_FAILED")
                for batch in rows.to_batches():
                    versions.check_rows(table, definition, batch, symbol, start_ms, end_ms)
                    bad = versions.first_out_of_order(previous, batch, definition.key)
                    if bad is not None:
                        raise _refuse(f"file {sha} row {bad} of a batch does not rise in key order", "CHECK_FAILED")
                    if batch.num_rows:
                        previous = batch
        except MarketError as error:
            found(error.code, commit, error.message)
        except pa.ArrowException as error:
            found("CHECK_FAILED", commit, f"file {sha} is no readable Parquet file: {error}")
