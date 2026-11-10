"""A public research mirror and a separate, non-publishing Paper database on one Dolt service.

The IDE receives reader accounts. The Paper controller receives the Paper database's writer and reader
and the mirror's reader, never the service administrator or a DoltHub publishing key. All mutations,
including sync, invoke the CLI. This is not isolation against a compromised lifecycle controller.
"""
from __future__ import annotations

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import signal
import subprocess
import sys
import threading
from urllib.parse import urlsplit

from cli import service
from ledger import db, replica
from shared import profiles
from shared.errors import Refusal
from shared.refusals import refuse


def start(root: Path, data: Path, backups: Path, origin: str, port: int, readers: Path,
          controllers: Path, binary: str | None = None, log=None):
    existing = db._service(root)
    if existing and set(existing.get("databases", {}).get("research", {})) != {"reader"}:
        raise refuse("REPLICA_REQUIRED", "this service is not a read-only research mirror; it is left unchanged")
    parsed = urlsplit(origin)
    if not ((parsed.scheme == "https" and parsed.hostname == "doltremoteapi.dolthub.com"
             and not parsed.username and not parsed.password and not parsed.query and not parsed.fragment)
            or parsed.scheme == "file"):
        raise refuse("USAGE_ERROR", "research origin is a public DoltHub URL, or file:// for isolated verification")
    server, config = service.start(root, data, backups, None, origin, port, binary, None, log)
    try:
        research = db.load_profile("research")
        if replica.status(research)["origin"] != origin:
            raise refuse("REMOTE_MISMATCH", "the configured origin differs from this mirror's origin")
        try:
            config = service.paper_database(root, backups, binary)
        except Refusal as exc:
            raise refuse("REPLICA_REQUIRED", f"the separate Paper database is not intact: {exc}") from exc
        if (research.database != "research" or research.kind is not None
                or "writer" not in config["databases"].get(service.PAPER, {})):
            raise refuse("REPLICA_REQUIRED", "the research mirror and separate Paper database are not intact")
        service.write_readers(readers, config)
        # Paper mounts this controller directory read-only at its service root, with the
        # host's writable run directory mounted beneath it. Docker must find that child
        # mountpoint already present before it can attach the writable bind mount.
        controllers.mkdir(parents=True, mode=0o700, exist_ok=True)
        (controllers / "paper").mkdir(mode=0o700, exist_ok=True)
        # The accounts Paper uses, never the service administrator or a DoltHub publishing credential.
        profiles.private_write(controllers / "service.json", {
            "port": config["port"], "databases": {
                "research": config["databases"]["research"], "paper": config["databases"]["paper"]}})
        profiles.private_write(controllers / "research.json", db.LedgerProfile(
            "research", "research", root, kind=None).as_json())
        profiles.private_write(controllers / "paper.json", db.LedgerProfile(
            "paper", "paper", root, kind="isolated", backup_root=backups / "paper", holds="paper").as_json())
        return server, research
    except BaseException:
        service._stop(server)
        raise


class Sync:
    def __init__(self, profile: db.LedgerProfile):
        self.profile = profile
        self.lock = threading.Lock()
        self.state: dict = {"state": "idle"}

    def status(self) -> dict:
        with self.lock:
            state = dict(self.state)
        return {**state, **replica.status(self.profile)}

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
    server, profile = start(root, data, backups, origin, port, readers, controllers)
    http = None
    try:
        http = ThreadingHTTPServer((http_host, http_port), handler(Sync(profile), frozenset(hosts or [
            f"127.0.0.1:{http_port}", f"localhost:{http_port}"])))
        http.daemon_threads = True
        threading.Thread(target=http.serve_forever, daemon=True).start()
        for signum in (signal.SIGTERM, signal.SIGINT):
            signal.signal(signum, lambda received, frame: server.send_signal(received))
        code = server.wait()
        return {"action": "mirror", "server_exit": code}, 0 if code in (0, -signal.SIGTERM, -signal.SIGINT) else 1
    finally:
        if http:
            http.shutdown()
            http.server_close()
        service._stop(server)
