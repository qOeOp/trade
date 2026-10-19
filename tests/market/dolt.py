"""Throwaway market databases for the market tests: one isolated research ledger's service (the ledger
tests' `Service`) holding market databases made by `market init` (ledger.db.init_market). `seed`
writes rows the way an import commits them, for tests that need a market database without
stitching sources. Never the active service.
"""

from __future__ import annotations

import json
from pathlib import Path

from ledger import db
from market import store, universe
from tests.ledger.dolt import BINARY, SKIP, Service


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

    def add(self, database: str, kind: str = "isolated") -> dict:
        made = db.init_market(database.replace("_", "-"), database, self.service.service_root, kind,
                              dolt_binary=BINARY)
        return json.loads(Path(made["profile"]).read_text(encoding="utf-8"))

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
            for statement in store.insert_statements(columns, symbol, price_type):
                conn.execute(statement)
        conn.many("INSERT INTO funding VALUES (%s, %s, %s)",
                  [(symbol, at, rate) for symbol, rows in (funding or {}).items() for at, rate in rows])
        conn.many("INSERT INTO universe_month VALUES (%s, %s, %s)", [(universe.RULE, m, s) for m, s in members])
        message = json.dumps({"import": store.IMPORT, "month": month, "through": through,
                              "universe_rule": universe.RULE, "scope": scope}, separators=(",", ":"))
        (commit,), = conn.rows("CALL DOLT_COMMIT('-A', '-m', %s)", (message,))
        conn.raw.commit()
    return commit


__all__ = ["BINARY", "SKIP", "TemporaryMarket", "seed"]
