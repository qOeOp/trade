"""`ledger mirror` and `ledger sync`: a read-only research replica and a separate, non-publishing Paper database
on one Dolt service.

The IDE receives reader accounts. The Paper controller receives the Paper database's writer and reader
and the mirror's reader, never the service administrator or a DoltHub publishing key. All mutations,
including sync, invoke the CLI. This is not isolation against a compromised lifecycle controller.

A sync validates an immutable commit before fast-forwarding main. The existing origin is the authority;
HTTP cannot choose a URL, branch or database. The replica is a local cache of published research, never a
publishing peer or the Paper execution database.
"""
from __future__ import annotations

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import subprocess
import sys
import threading

import pymysql

from ledger import db, publish, service
from shared.errors import Refusal
from shared.refusals import refuse

HISTORY = 10
SYNC_EVERY = 60  # seconds between the mirror's own syncs from its origin; the page's Sync DoltHub starts one at once
ORIGIN_MAIN = f"{publish.REMOTE}/{db.BRANCH}"


def start(root: Path, data: Path, backups: Path, origin: str, port: int, readers: Path,
          controllers: Path, binary: str | None = None, log=None):
    existing = db.service_config(root)
    if existing and set(existing.get("databases", {}).get("research", {})) != {"reader"}:
        raise refuse("REPLICA_REQUIRED", "this service is not a read-only research mirror; it is left unchanged")
    if not (origin.startswith("file://") or publish.DOLTHUB.fullmatch(origin)):
        raise refuse("USAGE_ERROR", "research origin is a public DoltHub repository, or file:// for isolated "
                                    "verification", expected="https://doltremoteapi.dolthub.com/<owner>/<repository>")
    server, config = service.start(root, data, backups, None, origin, port, binary, None, log)
    try:
        research = db.load_profile("research")
        if status(research)["origin"] != origin:
            raise refuse("REMOTE_MISMATCH", "the configured origin differs from this mirror's origin")
        try:
            config = service.paper_database(root, backups, binary)
        except Refusal as exc:
            raise refuse("REPLICA_REQUIRED", f"the separate Paper database is not intact: {exc}") from exc
        if (research.database != "research" or research.kind is not None
                or "writer" not in config["databases"].get(service.PAPER, {})):
            raise refuse("REPLICA_REQUIRED", "the research mirror and separate Paper database are not intact")
        service.write_readers(readers, config)
        service.write_controllers(controllers, root, backups, config)
        return server, research
    except BaseException:
        service._stop(server)
        raise


def _open(profile: db.LedgerProfile):
    config = db._known_service(profile.service_root)
    accounts = config.get("databases", {}).get(profile.database, {})
    if profile.kind is not None or set(accounts) != {"reader"}:
        raise refuse("REPLICA_REQUIRED", "sync requires a research replica with only a reader account")
    try:
        return db._admin(config, database=profile.database)
    except pymysql.MySQLError as exc:
        raise db._connection_error(exc) from exc


def _origin(cursor) -> str:
    origin = publish._origin(cursor)
    if origin is None:
        raise refuse("REMOTE_UNSET", "the replica has no configured origin")
    return origin


def _history(cursor) -> list[dict]:
    """The latest moves of the replica's main, newest first, read from Dolt's reflog: when it moved (UTC)
    and between which commits. Only bootstrap and sync move main. The reflog survives restarts but not
    garbage collection; the oldest move it holds (bootstrap, or the first kept) has no previous commit."""
    rows = db.cursor_rows(cursor, f"SELECT ref_timestamp, commit_hash FROM dolt_reflog('{db.BRANCH}') LIMIT %s",
                          (HISTORY + 1,))
    return [{"at": at.strftime("%Y-%m-%dT%H:%M:%SZ"), "previous_commit": rows[i + 1][1] if i + 1 < len(rows) else None,
             "ledger_commit": commit} for i, (at, commit) in enumerate(rows[:HISTORY])]


def _head(cursor, branch: str = db.BRANCH) -> str:
    (head,), = db.cursor_rows(cursor, f"SELECT DOLT_HASHOF('{branch}')")
    return head


def status(profile: db.LedgerProfile) -> dict:
    raw = _open(profile)
    try:
        with raw.cursor() as cursor:
            origin = _origin(cursor)
            head = _head(cursor)
            history = _history(cursor)
        return {"database": profile.database, "origin": origin, "ledger_commit": head, "history": history}
    except pymysql.MySQLError as exc:
        raise db.sql_error(exc) from exc
    finally:
        raw.close()


def sync(profile: db.LedgerProfile) -> dict:
    raw = _open(profile)
    before = target = origin = None
    validated = False
    try:
        with raw.cursor() as cursor:
            # The advisory lock serializes both HTTP and independent CLI callers.
            (locked,), = db.cursor_rows(cursor, "SELECT GET_LOCK(%s, 0)", (f"{profile.database}/replica-sync",))
            if not locked:
                raise refuse("REPLICA_BUSY", "a research sync is already running")
            try:
                origin = _origin(cursor)
                if db.cursor_rows(cursor, "SELECT table_name FROM dolt_status"):
                    raise refuse("DIRTY_WORKING_SET", "the replica has local changes; they are retained")
                before = _head(cursor)
                db.cursor_rows(cursor, f"CALL DOLT_FETCH('{publish.REMOTE}')")
                target = _head(cursor, ORIGIN_MAIN)
                # A revision database reads fetched commits without changing the visible head.
                cursor.execute(f"USE `{profile.database}/{target}`")
                if db.cursor_rows(cursor, "SELECT version FROM ledger_schema WHERE singleton = 1") != [
                        (db.SCHEMA_VERSION,)]:
                    raise refuse("REPLICA_INVALID", "the published schema is not readable by this product")
                cursor.execute(f"USE `{profile.database}/{db.BRANCH}`")
                validated = True
                db.cursor_rows(cursor, f"CALL DOLT_MERGE('--ff-only', '{ORIGIN_MAIN}')")
                head = _head(cursor)
                return {"database": profile.database, "origin": origin, "previous_commit": before,
                        "ledger_commit": head, "changed": head != before}
            finally:
                db.cursor_rows(cursor, "SELECT RELEASE_LOCK(%s)", (f"{profile.database}/replica-sync",))
    except pymysql.MySQLError as exc:
        # A lost reply after fast-forward does not prove that nothing changed. Re-read the already
        # validated target instead of resetting or claiming a rollback.
        if validated and before and target:
            try:
                current = status(profile)["ledger_commit"]
            except Refusal:
                current = None
            if current == target:
                return {"database": profile.database, "origin": origin, "previous_commit": before,
                        "ledger_commit": target, "changed": target != before}
        raise refuse("REPLICA_SYNC_FAILED", "sync could not confirm completion; keep the available view and retry: "
                     + str(exc.args[-1])[:300]) from exc
    finally:
        raw.close()


class Sync:
    def __init__(self, profile: db.LedgerProfile):
        self.profile = profile
        self.lock = threading.Lock()
        self.state: dict = {"state": "idle"}

    def status(self) -> dict:
        with self.lock:
            state = dict(self.state)
        return {**state, **status(self.profile)}

    def request(self) -> dict:
        with self.lock:
            if self.state["state"] == "syncing":
                return {"state": "syncing"}
            self.state = {"state": "syncing"}

        def work():
            try:
                done = subprocess.run([sys.executable, "-m", "cli.main", "ledger", "sync", "--ledger",
                                       self.profile.name], capture_output=True, text=True, check=False, timeout=600)
                value = json.loads(done.stderr if done.returncode else done.stdout)
                result = {"state": "error", "error": value} if done.returncode else {"state": "ready", **value}
            except (OSError, ValueError, subprocess.TimeoutExpired):
                result = {"state": "error", "error": {"code": "REPLICA_SYNC_FAILED", "message": "sync did not finish"}}
            with self.lock:
                self.state = result

        threading.Thread(target=work, daemon=True).start()
        return {"state": "syncing"}


def keep_synced(sync: Sync, stop: threading.Event, every: float = SYNC_EVERY) -> None:
    """Start a sync now and every `every` seconds until `stop`, so the mirror follows its origin with no page
    open; a sync still running is not started again (Sync.request), and a failed one shows in the status."""
    while True:
        sync.request()
        if stop.wait(every):
            return


def handler(sync: Sync, hosts: frozenset[str]):
    class Handler(BaseHTTPRequestHandler):
        def reply(self, status: int, body: dict):
            data = json.dumps(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def handle_request(self):
            if self.headers.get("Host") not in hosts or self.headers.get("Sec-Fetch-Site") == "cross-site":
                self.reply(403, {"code": "FORBIDDEN", "message": "requests come from the IDE"})
            elif self.path != "/api/research/sync" or self.command not in ("GET", "POST"):
                self.reply(404, {"code": "NOT_FOUND", "message": self.path})
            elif self.command == "POST" and (self.headers.get("Sec-Fetch-Site") != "same-origin"
                                            or self.headers.get("Content-Length", "0") != "0"):
                self.reply(400, {"code": "USAGE_ERROR", "message": "sync takes no body or caller-selected target"})
            else:
                try:
                    self.reply(202 if self.command == "POST" else 200,
                               sync.request() if self.command == "POST" else sync.status())
                except Refusal as exc:
                    self.reply(503, {"code": exc.code, "message": str(exc)})

        do_GET = do_POST = do_DELETE = do_PUT = do_PATCH = handle_request

    return Handler


def run(root: Path, data: Path, backups: Path, origin: str, port: int, readers: Path, controllers: Path,
        http_host: str, http_port: int, hosts: list[str]) -> tuple[dict, int]:
    """ledger mirror: serve the mirror and its sync page until the server exits (service.serve)."""
    server, profile = start(root, data, backups, origin, port, readers, controllers)
    http = None
    try:
        sync = Sync(profile)
        http = ThreadingHTTPServer((http_host, http_port), handler(sync, frozenset(hosts or [
            f"127.0.0.1:{http_port}", f"localhost:{http_port}"])))
        http.daemon_threads = True
        threading.Thread(target=http.serve_forever, daemon=True).start()
        return service.serve("mirror", server, False, lambda stop: keep_synced(sync, stop))
    finally:
        if http:
            http.shutdown()
            http.server_close()
        service._stop(server)
