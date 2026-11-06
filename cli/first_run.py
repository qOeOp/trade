"""`ledger service run --setup`: a first start finished from the IDE's page (docs/plans/ide-first-run.zh.md).

With no service.json, the service opens a small HTTP port instead of exiting on what it lacks. The IDE forwards
`/api/setup/` to it. A GET says where the first start stands; a POST names the DoltHub repository and starts it.
The bootstrap runs on the main thread, one at a time, so a reload or a second tab changes nothing, and a signal
reaches its cleanup. A failed one is reported on the page and waited past; one that cannot be retried from there
(directories that are not empty, a key directory without a key) is only reported. Once the ledger is up a POST
changes nothing and a GET says so, which is how an open page learns it is done.

The DoltHub key is made here only when its directory holds nothing at all, so a directory holding someone's
`dolt login` home is never written. Dolt only ever runs on a throwaway copy of the key. The page is given the public
half, never the private one.
"""

from __future__ import annotations

from collections.abc import Callable
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import threading

from ledger import publish
from ledger.errors import Refusal
from ledger.refusals import refuse

PATH = "/api/setup/"
BODY = 4096
ADDRESS = re.compile(r"[A-Za-z0-9.-]+:[0-9]+")
HOST = "https://doltremoteapi.dolthub.com/"
NAME = r"[A-Za-z0-9_-]+/[A-Za-z0-9_-]+"
PAGE_URL = re.compile(rf"(?:https?://)?(?:www\.)?dolthub\.com/repositories/({NAME})(?:[/?#].*)?")
PLAIN = re.compile(rf"(?:{re.escape(HOST)})?({NAME})/?")


def _log(text: str) -> None:
    print(f"ledger service run: {text}", file=sys.stderr, flush=True)


def origin_of(repository: str) -> str:
    """The remote of what the page was given: `owner/repository`, or the address of its DoltHub page."""
    text = repository.strip()
    found = PAGE_URL.fullmatch(text) or PLAIN.fullmatch(text)
    if found is None:
        raise refuse("REMOTE_INVALID", f"{text!r} does not name a DoltHub repository", missing=(text,),
                     expected="owner/repository, or the address of its DoltHub page")
    return HOST + found[1]


def _dolt(binary: str, home: Path, *arguments: str) -> subprocess.CompletedProcess:
    return subprocess.run([binary, *arguments], env={**os.environ, "DOLT_ROOT_PATH": str(home),
                                                     "DOLT_DISABLE_EVENT_FLUSH": "true"},
                          capture_output=True, text=True, cwd=home)


def _make_key(binary: str, scratch: Path, credentials: Path) -> None:
    """A new key into the empty directory `credentials`, named last so a partial copy names no key."""
    (scratch / "new").mkdir()
    made = _dolt(binary, scratch / "new", "creds", "new")
    if made.returncode:
        raise refuse("DOLTHUB_CREDENTIALS", f"Dolt could not make a key: {made.stderr.strip()[-300:]}",
                     missing=(str(credentials),))
    source = scratch / "new" / ".dolt"
    try:
        shutil.copytree(source / "creds", credentials / "creds")
        shutil.copy2(source / "config_global.json", credentials / "config_global.json")
    except OSError as exc:
        raise refuse("DOLTHUB_CREDENTIALS", f"the key directory {credentials} cannot be written: {exc.strerror or exc}. "
                                            "Make it as the user the services run as, then restart the ledger service",
                     missing=(str(credentials),)) from exc


def public_key(binary: str, credentials: Path) -> str:
    """The public half of the key in `credentials`, a key made first when that directory is empty."""
    with tempfile.TemporaryDirectory(prefix="dolt-key-") as temporary:
        scratch = Path(temporary)
        if not credentials.exists() or (credentials.is_dir() and not any(credentials.iterdir())):
            _make_key(binary, scratch, credentials)
        publish.install_key(scratch, credentials)
        listed = _dolt(binary, scratch / "home", "creds", "ls", "-v")
    for line in listed.stdout.splitlines():
        if line.startswith("*"):
            return line.split()[1]
    raise refuse("DOLTHUB_CREDENTIALS", f"Dolt lists no current key under {credentials}: "
                                        f"{listed.stderr.strip()[-300:]}", missing=(str(credentials),))


def check_key(binary: str, credentials: Path) -> None:
    """Whether DoltHub knows the key. A clone cannot tell: an unknown key's clone of an empty repository
    reads as an empty repository (measured)."""
    with tempfile.TemporaryDirectory(prefix="dolt-key-") as temporary:
        scratch = Path(temporary)
        publish.install_key(scratch, credentials)
        checked = _dolt(binary, scratch / "home", "creds", "check")
    if checked.returncode:
        raise refuse("DOLTHUB_CREDENTIALS", "DoltHub does not accept this key yet. Add it to your account, then try "
                                            f"again ({(checked.stderr or checked.stdout).strip()[-200:]})",
                     missing=(str(credentials),))


class _Page:
    """What the page reads and asks for, shared between the HTTP threads and the main thread."""

    def __init__(self, origin: str | None):
        self.changed = threading.Condition()
        self.origin = origin
        self.public_key: str | None = None
        self.step: str | None = None
        self.refusal: dict | None = None
        self.state = "running" if origin else "waiting"  # waiting, running, done or blocked
        self.wanted = bool(origin)
        self.unasked = bool(origin)  # the deployment's own value is being tried, nobody pressed anything

    def answer(self) -> dict:
        with self.changed:
            return {"state": self.state, "repository": (self.origin or "").removeprefix(HOST) or None,
                    "public_key": self.public_key, "step": self.step, "refusal": self.refusal}

    def ask(self, repository: str | None) -> dict:
        """Start with `repository` (None: the one already known), unless one is running or nothing can start."""
        with self.changed:
            known = repository and repository.strip() in (self.origin, (self.origin or "").removeprefix(HOST))
            origin = origin_of(repository) if repository and not known else None
            if self.state == "waiting":
                if origin is None and self.origin is None:
                    raise refuse("REMOTE_INVALID", "no repository was named", missing=("repository",),
                                 expected="owner/repository, or the address of its DoltHub page")
                self.origin = origin or self.origin
                self.state, self.wanted, self.unasked, self.step, self.refusal = "running", True, False, None, None
                self.changed.notify_all()
        return self.answer()

    def say(self, text: str) -> None:
        _log(text)
        with self.changed:
            self.step = text

    def take(self) -> str:
        """The next repository to try, waiting for one."""
        with self.changed:
            while not self.wanted:
                self.changed.wait()
            self.wanted = False
            assert self.origin is not None
            return self.origin

    def failed(self, refusal: Refusal) -> None:
        _log(str(refusal))
        with self.changed:
            # The page asks for the key anyway, so the deployment's own try is no failure to show.
            quiet = self.unasked and refusal.code == "DOLTHUB_CREDENTIALS"
            self.state, self.step, self.unasked = "waiting", None, False
            self.refusal = None if quiet else {"code": refusal.code, "message": refusal.message}

    def blocked(self, refusal: Refusal) -> None:
        _log(str(refusal))
        with self.changed:
            self.state, self.wanted = "blocked", False
            self.refusal = {"code": refusal.code, "message": refusal.message}

    def finished(self) -> None:
        with self.changed:
            self.state, self.step, self.refusal = "done", None, None


def _handler(page: _Page, host: str) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        def reply(self, status: int, value: dict) -> None:
            body = json.dumps(value).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def admitted(self) -> bool:
            if self.headers.get("Host") != host:
                self.reply(403, {"code": "FORBIDDEN", "message": "this port answers only the IDE"})
            elif self.path != PATH:
                self.reply(404, {"code": "NOT_FOUND", "message": self.path})
            else:
                return True
            return False

        def do_GET(self) -> None:
            if self.admitted():
                self.reply(200, page.answer())

        def do_POST(self) -> None:
            if not self.admitted():
                return
            length = int(self.headers.get("Content-Length") or 0)
            if length > BODY:
                self.reply(413, {"code": "TOO_LARGE", "message": f"{length} bytes"})
                return
            try:
                body = json.loads(self.rfile.read(length) or b"{}")
                repository = body.get("repository") if isinstance(body, dict) else None
                if repository is not None and not isinstance(repository, str):
                    raise ValueError("repository is not a string")
            except ValueError as exc:
                self.reply(400, {"code": "BAD_REQUEST", "message": str(exc)})
                return
            try:
                self.reply(202, page.ask(repository))
            except Refusal as exc:
                self.reply(400, {"code": exc.code, "message": exc.message})

        def log_message(self, format: str, *args) -> None:
            pass  # the page polls; refusals are logged where they happen

    return Handler


class _Server(ThreadingHTTPServer):
    daemon_threads = True


def _leave(received, frame) -> None:
    """Out through the bootstrap's cleanup; a second signal must not interrupt that cleanup."""
    for signum in (signal.SIGTERM, signal.SIGINT):
        signal.signal(signum, signal.SIG_IGN)
    raise SystemExit(0)


def serve(address: str, origin: str | None, credentials: Path, binary: str, listen: str, check: Callable[[], None],
          start: Callable[[str, Callable[[str], None]], subprocess.Popen]) -> subprocess.Popen:
    """Wait for a repository and bootstrap it through `start`, until one comes up, and return its running
    server. `address` is how the IDE reaches this port (the only Host answered), `check` what would refuse any
    attempt. The port stays open answering GETs and the process exits only by a signal."""
    if not ADDRESS.fullmatch(address):
        raise refuse("USAGE_ERROR", f"--setup names {address!r}, not host:port", expected="ledger:8770")
    for signum in (signal.SIGTERM, signal.SIGINT):
        signal.signal(signum, _leave)
    page = _Page(origin)
    try:
        check()
        page.public_key = public_key(binary, credentials)
    except Refusal as exc:
        page.blocked(exc)
    http = _Server((listen, int(address.rpartition(":")[2])), _handler(page, address))
    threading.Thread(target=http.serve_forever, daemon=True).start()
    _log(f"waiting for the first start on the IDE's page ({address})")
    while True:
        wanted = page.take()
        try:
            if publish.DOLTHUB.fullmatch(wanted):
                page.say("checking the DoltHub key")
                check_key(binary, credentials)
            server = start(wanted, page.say)
        except Refusal as exc:
            page.failed(exc)
        except Exception as exc:  # the page is the only place this deployment's operator is looking
            page.failed(refuse("BOOTSTRAP_FAILED", f"{type(exc).__name__}: {exc}"[:300], missing=(wanted,)))
        else:
            page.finished()
            return server
