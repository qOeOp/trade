"""A throwaway market database for the market tests: one isolated research ledger's service (the
ledger tests' `Service`) holding a market database beside it, created with the administrator
session the way the live market database was (no product command creates one). Never the active
service.
"""

from __future__ import annotations

import json
from pathlib import Path
import secrets

from ledger import db
from market import store, universe
from tests.ledger.dolt import BINARY, SKIP, Service


MARKET_SCHEMA = Path(__file__).resolve().parents[2] / "market" / "schema.sql"


class TemporaryMarket:
    """A service with a research ledger and a market database `database`; `close()` deletes both."""

    def __init__(self, database: str = "market_test"):
        self.service = Service()
        try:
            self.ledger = self.service.ledger("research")
            self.profile = create_market(self.service.service_root, database, self.service.home)
        except BaseException:
            self.service.close()
            raise

    def close(self) -> None:
        self.service.close()


def create_market(service_root: Path, database: str, home: Path) -> dict:
    """A market database with its schema row and least-privilege import and reader accounts, and its
    profile (kind market) in `home`."""
    config = db._service(service_root)
    accounts = {role: {"user": f"{database}_{role}", "password": secrets.token_urlsafe(24)}
                for role in ("writer", "reader")}
    conn = db._admin(config)
    try:
        with conn.cursor() as cursor:
            cursor.execute(f"CREATE DATABASE `{database}`")
            cursor.execute(f"USE `{database}`")
            for statement in db._statements(MARKET_SCHEMA.read_text(encoding="utf-8")):
                cursor.execute(statement)
            cursor.execute("INSERT INTO market_schema VALUES (1, %s, %s, %s, %s)",
                           (store.SCHEMA_VERSION, store.PRICE_SCALE, store.VOLUME_SCALE, universe.POOL_RULE))
            cursor.execute("CALL DOLT_COMMIT('-A', '-m', 'schema:1')")
            writer, reader = accounts["writer"], accounts["reader"]
            cursor.execute(f"CREATE USER '{writer['user']}'@'%%' IDENTIFIED BY %s", (writer["password"],))
            cursor.execute(f"CREATE USER '{reader['user']}'@'%%' IDENTIFIED BY %s", (reader["password"],))
            cursor.execute(f"GRANT SELECT, INSERT ON `{database}`.* TO '{writer['user']}'@'%'")
            cursor.execute("INSERT INTO dolt_branch_control VALUES (%s, 'main', %s, '%%', 'write')",
                           (database, writer["user"]))
            cursor.execute(f"GRANT EXECUTE ON PROCEDURE `{database}`.dolt_commit TO '{writer['user']}'@'%'")
            cursor.execute(f"GRANT SELECT ON `{database}`.* TO '{reader['user']}'@'%'")
    finally:
        conn.close()
    config["databases"][database] = accounts
    db._private_write(service_root / "service.json", config)
    profile = {"name": database.replace("_", "-"), "kind": "market", "role": "isolated", "service": str(service_root),
               "database": database, "backup": None}
    home.mkdir(parents=True, exist_ok=True)
    (home / f"{profile['name']}.json").write_text(json.dumps(profile), encoding="utf-8")
    return profile


__all__ = ["BINARY", "SKIP", "TemporaryMarket", "create_market"]
