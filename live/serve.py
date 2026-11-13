"""Private Unix-socket HTTP adapter; every write goes through the fixed Live CLI."""

from __future__ import annotations

from contextlib import contextmanager
import errno
import fcntl
from http.server import BaseHTTPRequestHandler
import json
import os
from pathlib import Path
import re
import signal
import socket
import socketserver
import stat
import subprocess
import sys
import threading
import time
from urllib.parse import urlsplit

from engine.live_errors import LiveRefusal
from live import authority, configuration, control, credentials, daily, notify, release, requests, runs, state


MAX_BODY = 64 * 1024
RUN = r"([a-z0-9][a-z0-9-]{0,23})"
REQUEST = r"([a-z0-9][a-z0-9-]{7,63})"
REF = r"([0-9a-f]{32})"
NOTIFY = {"/api/live/notify/telegram": "notify_save", "/api/live/notify/test": "notify_test",
          "/api/live/notify/remove": "notify_remove"}


def decode(data: bytes) -> dict:
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError
            result[key] = value
        return result

    def constant(_):
        raise ValueError

    try:
        if len(data) > MAX_BODY:
            raise ValueError
        result = json.loads(data, object_pairs_hook=unique, parse_constant=constant)
        if not isinstance(result, dict):
            raise ValueError
        return result
    except (ValueError, RecursionError):
        raise configuration.fail() from None


def command(config_file: Path, action: str, target: str | None, body: dict, *,
            binding: release.Binding | None = None) -> tuple[int, dict]:
    argv = [sys.executable, "-m", "cli.main", "live", "web-command", "--configuration", str(config_file),
            "--action", action]
    if target is not None:
        argv += ["--target", target]
    if binding is not None:
        argv += ["--release-state", str(binding.state), "--release-web", binding.web_name]
    # No shell, no secret argv/env, and no timeout which would kill an accepted operation.
    # Browser/proxy disconnects do not cancel this control command.
    try:
        result = subprocess.run(argv, input=state.encode(body), capture_output=True, check=False)
        value = json.loads(result.stdout) if result.returncode == 0 else None
        if (not isinstance(value, dict) or type(value.get("status")) is not int
                or not 200 <= value["status"] <= 599 or not isinstance(value.get("body"), dict)
                or type(value["body"].get("ok")) is not bool):
            raise ValueError
        return value["status"], value["body"]
    except (OSError, ValueError):
        return 502, control.error("LIVE_RECORD_UNAVAILABLE", body.get("request_id"))


def write_route(path: str) -> tuple[str, str | None]:
    if path == "/api/live/credentials":
        return "credential_save", None
    if path == "/api/live/runs":
        return "prepare", None
    if path in NOTIFY:
        return NOTIFY[path], None
    match = re.fullmatch(r"/api/live/credentials/" + REF + r"/remove", path)
    if match:
        return "credential_remove", match[1]
    match = re.fullmatch(r"/api/live/requests/" + REQUEST + r"/resolve", path)
    if match:
        return "resolve", match[1]
    match = re.fullmatch(r"/api/live/runs/" + RUN + r"/(preflight|start|stop|reconcile|maintain)", path)
    if match:
        return match[2], match[1]
    raise configuration.fail()


def read(config: configuration.Configuration, path: str, *, binding: release.Binding | None = None,
         evidence: control.Evidence | None = None) -> dict:
    if path == "/api/live":
        return control.listing(config, binding=binding, evidence=evidence)
    if path == "/api/live/credentials":
        if not config.root.exists():
            return {"credentials": []}
        with state.reading(config.root) as root:
            return {"credentials": credentials.listing_locked(root)}
    match = re.fullmatch(r"/api/live/requests/" + REQUEST, path)
    if match:
        return requests.view(config.root, match[1])
    match = re.fullmatch(r"/api/live/runs/" + RUN, path)
    if match:
        return control.run_view(config, match[1])
    raise configuration.fail()


def handler(config_file: Path, config: configuration.Configuration, *, binding: release.Binding | None = None,
            evidence: control.Evidence | None = None):
    class Handler(BaseHTTPRequestHandler):
        def answer(self, status: int, value: dict):
            body = state.encode(value)
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Connection", "close")
            self.end_headers()
            self.close_connection = True
            try:
                self.wfile.write(body)
            except OSError:
                pass

        def route(self):
            url = urlsplit(self.path)
            if self.headers.get("Host") != "live-control" or url.query or url.fragment:
                raise configuration.fail()
            return url.path

        def do_GET(self):
            try:
                result = read(config, self.route(), binding=binding, evidence=evidence)
                self.answer(200, {"ok": True, "data": result})
            except Exception as exc:
                code = exc.code if isinstance(exc, LiveRefusal) else "LIVE_RECORD_UNAVAILABLE"
                self.answer(404 if code == "LIVE_REQUEST_MISSING" else 503, control.error(code))

        def do_POST(self):
            try:
                action, target = write_route(self.route())
                lengths = self.headers.get_all("Content-Length", [])
                if (self.headers.get("Transfer-Encoding") or len(lengths) != 1
                        or not lengths[0].isascii() or not lengths[0].isdigit()
                        or int(lengths[0]) > MAX_BODY):
                    raise configuration.fail()
                length = int(lengths[0])
                data = self.rfile.read(length)
                if len(data) != length:
                    raise configuration.fail()
                body = decode(data)
            except Exception:
                self.answer(400, control.error("LIVE_CONFIG"))
                return
            status, result = command(config_file, action, target, body, binding=binding)
            self.answer(status, result)

        def do_other(self):
            self.answer(405, control.error("LIVE_CONFIG"))

        do_DELETE = do_PUT = do_PATCH = do_HEAD = do_other

        def log_message(self, *args):
            pass  # Never log a request target, uploaded body, upstream failure, or credential.

    return Handler


class Server(socketserver.ThreadingUnixStreamServer):
    # Closing the listener must wait for accepted HTTP handlers and their fixed
    # CLI subprocesses. A lost browser response cannot terminate accepted work.
    daemon_threads = False

    def handle_error(self, request, client_address):
        # The safe response is the interface; arbitrary exception text is not a log API.
        pass


@contextmanager
def listener(config: configuration.Configuration, config_file: Path, *, binding: release.Binding | None = None,
             evidence: control.Evidence | None = None):
    directory = state.private_directory(config.socket.parent)
    # This empty process lease protects only this socket inode. Account operations still
    # use the original account.lock, never this lease or a second lifecycle mutex.
    descriptor = os.open(directory / "listener.lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "r+") as lease:
        if not stat.S_ISREG(os.fstat(lease.fileno()).st_mode):
            raise configuration.fail()
        fcntl.flock(lease, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if os.path.lexists(config.socket):
            old = config.socket.lstat()
            if not stat.S_ISSOCK(old.st_mode) or old.st_uid != os.geteuid():
                raise configuration.fail()
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as probe:
                probe.settimeout(1)
                try:
                    probe.connect(str(config.socket))
                except OSError as exc:
                    if exc.errno != errno.ECONNREFUSED:
                        raise configuration.fail() from None
                else:
                    raise configuration.fail()  # An existing listener is never stopped or replaced.
            if config.socket.lstat().st_ino != old.st_ino:
                raise configuration.fail()
            config.socket.unlink()
        server = Server(str(config.socket), handler(config_file, config, binding=binding, evidence=evidence))
        os.chmod(config.socket, 0o600)
        identity = config.socket.stat().st_ino
        try:
            yield server
        finally:
            server.server_close()
            if config.socket.exists() and config.socket.lstat().st_ino == identity:
                config.socket.unlink()


def maintain_existing(config: configuration.Configuration, *, binding: release.Binding | None = None) -> None:
    """Inspect and finish existing host runs, and start an interrupted one again (control.restart_interrupted_locked:
    the runner reads the venue; the control reads no credential, only passes the run's own credential file)."""
    directory = config.root / "runs"
    if not directory.is_dir() or directory.is_symlink():
        return
    for path in sorted(directory.iterdir()):
        if not state.RUN_ID.fullmatch(path.name) or not path.is_dir() or path.is_symlink():
            continue
        try:
            scope = authority.retained(config, binding)
            with scope.mutation(maintenance=True) as root:
                observed = runs._status_view(root, path.name, maintain=False)
                if observed["state"] == "interrupted":
                    control.restart_interrupted_locked(root, path.name, time.time_ns())
                elif observed["state"] == "running" and observed["mode"] == "run":
                    control.check_key_locked(root, path.name, time.monotonic())
                elif observed["state"] != "running":
                    runs._status_view(root, path.name, maintain=True)
        except Exception:
            pass  # Unknown remains retained; the page can request explicit maintenance.


def serve(config_file: Path, *, binding: release.Binding | None = None) -> None:
    scope = authority.from_file(config_file, binding)
    config = scope.config
    with state.reading(config.root):
        scope.retained()
    done = threading.Event()

    def maintain():
        while not done.is_set():
            maintain_existing(config, binding=binding)
            done.wait(10)

    def notifier():
        # Its own thread: a slow or failing Telegram call never delays run maintenance.
        while not done.is_set():
            notify.tick(config, stop=done.is_set)
            done.wait(10)

    evidence = control.Evidence()

    def reader():
        # Its own thread: reading replay evidence runs the execution image's probe, never delaying a request.
        while not done.is_set():
            evidence.check(config)
            done.wait(60)

    def comparer():
        # Its own thread and its own container (live.daily): a day's comparison never delays maintenance or a
        # request, and its memory is never the control's.
        last = None
        while not done.is_set():
            now = time.time_ns()
            if daily.due(now, last):
                last = now
                try:
                    daily.launch(config.root, config.market_root, now)
                except Exception:
                    pass  # the run's record says what the comparison found; the next hour tries again
            done.wait(60)

    previous = {}
    try:
        with listener(config, config_file, binding=binding, evidence=evidence) as server:
            worker = threading.Thread(target=maintain)
            sender = threading.Thread(target=notifier)
            checker = threading.Thread(target=reader, daemon=True)
            # A daemon: a release that drains this control does not wait for a comparison, which holds its own lock.
            comparing = threading.Thread(target=comparer, daemon=True)
            stopping = threading.Event()
            shutdown_thread: threading.Thread | None = None

            def shutdown(*_):
                nonlocal shutdown_thread
                done.set()
                if stopping.is_set():
                    return
                stopping.set()
                # BaseServer.shutdown waits for serve_forever, so it must not run on
                # the signal handler's main thread. Neither signal is forwarded to CLI.
                shutdown_thread = threading.Thread(target=server.shutdown)
                shutdown_thread.start()

            previous = {sig: signal.signal(sig, shutdown) for sig in (signal.SIGTERM, signal.SIGINT)}
            worker.start()
            sender.start()
            checker.start()
            comparing.start()
            try:
                server.serve_forever()
            finally:
                done.set()
                worker.join()
                sender.join()
                if shutdown_thread is not None:
                    shutdown_thread.join()
    finally:
        # Keep repeated termination signals harmless throughout handler/CLI drain,
        # including listener.server_close(), before restoring the caller's handlers.
        for sig, old in previous.items():
            signal.signal(sig, old)
