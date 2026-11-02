"""Throwaway Dolt market databases for the tests of reads still on Dolt: one isolated research ledger's
service (the ledger tests' `Service`) holding market databases made by ledger.db.init_market. `seed`
writes rows the way the Dolt import committed them, for tests that need a market database without
stitching sources; `load` copies the versions the imports wrote to a market directory. Never the active
service.
"""

from __future__ import annotations

import io
import json
from pathlib import Path

import numpy as np
import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.csv as pcsv

from ledger import db
from market import series, sources, store, universe, versions
from tests.ledger.dolt import BINARY, SKIP, Service

INSERT_ROWS = 20_000
# Receipt kinds and the Dolt message kinds the Dolt reads list.
DOLT_KINDS = {store.BARS: store.IMPORT, store.QUOTES: store.QUOTE_IMPORT, store.TRADES: store.TRADE_IMPORT,
              store.METRICS: store.METRICS_IMPORT}


class TemporaryMarket:
    """A service with a research ledger and a market database `database`; `close()` deletes both."""

    def __init__(self, database: str = "market_test", kind: str = "isolated"):
        self.service = Service()
        try:
            self.ledger = self.service.ledger("research")
            self.profile = self.add(database, kind)
        except BaseException:
            self.service.close()
            raise

    def add(self, database: str, kind: str = "isolated", backup_root: Path | None = None) -> dict:
        """A new market database on the service. `market init` refuses an active one under /tmp, so an
        "active" fixture is made isolated and its throwaway profile marked active afterwards (the
        default market of commands without --market)."""
        made = db.init_market(database.replace("_", "-"), database, self.service.service_root,
                              "isolated" if kind == "active" else kind, backup_root, dolt_binary=BINARY)
        path = Path(made["profile"])
        profile = json.loads(path.read_text(encoding="utf-8"))
        if kind == "active":
            profile["role"] = "active"
            db._private_write(path, profile)
        return profile

    def admin(self, profile: dict, statement: str, params=None) -> list[tuple]:
        conn = db._admin(db._service(Path(profile["service"])), database=profile["database"])
        try:
            with conn.cursor() as cursor:
                cursor.execute(statement, params)
                return list(cursor.fetchall())
        finally:
            conn.close()

    def close(self) -> None:
        self.service.close()


def seed(profile: dict, *, month: str, through: str, terms: list[tuple[str, dict]], bars: dict,
         funding: dict | None = None, members: list[tuple] = (), scope="all", observed_at: int = 1) -> str:
    """Commit one fixture import: terms [(symbol, {increments})], bars {(symbol, price_type): integer
    columns}, funding {symbol: [(time, rate)]}, universe members [(month date, symbol)]; the first seed
    writes the schema row and the commit tests."""
    with store.connect(profile, "import") as conn:
        if conn.empty:
            conn.execute("INSERT INTO market_schema VALUES (1, %s, %s, %s, %s, 1)",
                         (store.SCHEMA_VERSION, store.PRICE_SCALE, store.VOLUME_SCALE, universe.RULE))
            conn.many("INSERT INTO dolt_tests VALUES (%s, 'commit', %s, 'expected_single_value', '==', '0')",
                      list(store.TESTS))
        else:
            conn.execute("UPDATE market_schema SET import_seq = import_seq + 1")
        classification = json.dumps({"contract_type": "PERPETUAL", "quote_asset": "USDT", "underlying_type": "COIN",
                                     "underlying_sub_types": []})
        conn.many("INSERT INTO instrument VALUES (%s, %s, 'exchange_info', %s, %s, %s, %s, %s, %s, %s, %s)",
                  [(symbol, observed_at, item["price_increment"], item["size_increment"], "0.001", "1000", "5", "0.01",
                    "1000000", classification) for symbol, item in terms])
        for (symbol, price_type), columns in bars.items():
            for statement in insert_statements(columns, symbol, price_type):
                conn.execute(statement)
        conn.many("INSERT INTO funding VALUES (%s, %s, %s)",
                  [(symbol, at, rate) for symbol, rows in (funding or {}).items() for at, rate in rows])
        conn.many("INSERT INTO universe_month VALUES (%s, %s, %s)", [(universe.RULE, m, s) for m, s in members])
        message = json.dumps({"import": store.IMPORT, "month": month, "through": through,
                              "universe_rule": universe.RULE, "scope": scope}, separators=(",", ":"))
        return commit(conn, message)


def insert_statements(bars: dict[str, np.ndarray], symbol: str, price_type: str):
    """Multi-row INSERT statements of INSERT_ROWS bars each (the import account has no FILE privilege)."""
    sources.check_symbol(symbol)
    prefix = f"('{symbol}','{price_type}',".encode()
    numbers = pa.table({name: pa.array(bars[name]) for name in series.COLUMNS})
    for offset in range(0, numbers.num_rows, INSERT_ROWS):
        sink = io.BytesIO()
        pcsv.write_csv(numbers.slice(offset, INSERT_ROWS), sink,
                       write_options=pcsv.WriteOptions(include_header=False, quoting_style="none"))
        body = sink.getvalue().rstrip(b"\n").replace(b"\n", b")," + prefix)
        yield b"INSERT INTO bar VALUES " + prefix + body + b")"


def commit(conn: store.MarketConnection, message: str) -> str:
    """One DOLT_COMMIT of everything written, which runs the commit tests."""
    (made,), = conn.rows("CALL DOLT_COMMIT('-A', '-m', %s)", (message,))
    conn.raw.commit()
    return made


def lock(conn: store.MarketConnection) -> None:
    """Hold the Dolt market's import lock for this connection's life, as `market backup` takes it."""
    (held,), = conn.rows("SELECT GET_LOCK(%s, 0)", (f"market-import:{conn.database}",))
    assert held == 1, f"the import lock of {conn.database} is held elsewhere"


def load(source: dict, profile: dict, loaded: dict[str, str]) -> dict[str, str]:
    """The versions of the market directory `source` not yet in `loaded` (version id: Dolt commit) copied into
    the Dolt market `profile` in chain order: each version's new rows in one commit whose message is its
    receipt. A market-upgrade version adds no commit and maps to the commit before it. Returns `loaded`."""
    market = versions.open_market(source, "reader")
    previous = None
    for version_id in reversed(list(versions.chain(market))):
        if version_id in loaded:
            previous = loaded[version_id]
            continue
        version = versions.load_version(market, version_id)
        parent = versions.load_version(market, version["parent"]) if version["parent"] else {"files": []}
        body = versions.receipt(market, version["receipts"][-1])
        if body["import"] == "market-upgrade":
            loaded[version_id] = previous
            continue
        with store.connect(profile, "import") as conn:
            if conn.empty:
                conn.execute("INSERT INTO market_schema VALUES (1, %s, %s, %s, %s, 1)",
                             (store.SCHEMA_VERSION, store.PRICE_SCALE, store.VOLUME_SCALE, universe.RULE))
                conn.many("INSERT INTO dolt_tests VALUES (%s, 'commit', %s, 'expected_single_value', '==', '0')",
                          list(store.TESTS))
            else:
                conn.execute("UPDATE market_schema SET import_seq = import_seq + 1")
            for entry in version["files"][len(parent["files"]):]:
                definition = versions.tables_of(version)[entry["table"]]
                rows = pa.Table.from_batches(list(versions.file_batches(
                    versions.file_bytes(market, entry["sha256"], "parquet"), definition)), definition.schema)
                if entry["table"] == "bar":
                    pairs = zip(rows["symbol"].to_pylist(), rows["price_type"].to_pylist(), strict=True)
                    for symbol, price_type in sorted(set(pairs)):
                        one = rows.filter(pc.and_(pc.equal(rows["symbol"], symbol),
                                                  pc.equal(rows["price_type"], price_type)))
                        columns = {name: one[name].to_numpy() for name in series.COLUMNS}
                        for statement in insert_statements(columns, symbol, price_type):
                            conn.execute(statement)
                elif rows.num_rows:
                    marks = ", ".join(["%s"] * rows.num_columns)
                    conn.many(f"INSERT INTO `{entry['table']}` VALUES ({marks})",
                              list(zip(*(column.to_pylist() for column in rows.columns), strict=True)))
            message = json.dumps({**body, "import": DOLT_KINDS[body["import"]]}, separators=(",", ":"),
                                 ensure_ascii=False)
            previous = loaded[version_id] = commit(conn, message)
    return loaded


__all__ = ["BINARY", "SKIP", "TemporaryMarket", "commit", "insert_statements", "load", "lock", "seed"]
