"""Live's companion container in the existing Web transaction; no separate release state machine. Every release
host pairs one: the product owns the custody root, its account lock and every input a control reads."""

from contextlib import contextmanager
from collections.abc import Callable
import fcntl
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import time

from .release_host import (BACKEND, READERS, REVISION, RUNTIME_REF, SERVICE_REF, UNPRIVILEGED, WEB, contained,
                           durable_json, revision, sync_directory, until_ready)
from .live_configuration import CONTROL, HOST_FIELDS, READER, ROOT, absolute, read_object, snapshot


LIVE = "trade-release-live-"
DOCKER_SOCKET = Path("/var/run/docker.sock")
ACCOUNT_LOCK_WAIT_SECONDS = 30.0
ACCOUNT_LOCK_RETRY_SECONDS = 0.1


class LiveBusy(RuntimeError):
    """The account cannot admit a release now; no deployment failure was established."""


class AccountLockBusy(LiveBusy):
    """The original lock is held; no native account admission has been observed."""


class AccountLockWaitExpired(AccountLockBusy):
    """The bounded acquisition window ended without owning the original lock."""


def _acquire_account_lock(descriptor: int, held: Callable[[], None], *, wait_for_lock: bool) -> None:
    deadline = time.monotonic() + ACCOUNT_LOCK_WAIT_SECONDS if wait_for_lock else None
    while True:
        held()
        if deadline is not None and time.monotonic() >= deadline:
            raise AccountLockWaitExpired("The original Live account lock remained occupied for 30 seconds")
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return
        except BlockingIOError:
            if deadline is None:
                raise AccountLockBusy("A Live operation holds the account lock; keep the current pair") from None
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise AccountLockWaitExpired(
                    "The original Live account lock remained occupied for 30 seconds") from None
            time.sleep(min(ACCOUNT_LOCK_RETRY_SECONDS, remaining))


class LiveHost:
    def __init__(self, web, source):
        self.web, self.source, self.state = web, source, web.state
        self.root = self.state / ROOT

    def directory(self, name: str) -> Path:
        return self.state / "live" / revision(name)

    def configuration(self, name: str) -> Path:
        return self.directory(name) / "configuration.json"

    def socket(self, name: str) -> Path:
        return self.directory(name) / "socket"

    def name(self, web: str) -> str:
        return LIVE + revision(web)

    def facts(self) -> dict:
        """What this host gives every control (HOST_FIELDS): the reader profile each tick writes and the market
        directory the Web mounts."""
        return {"root": str(self.root), "research_ledger": str(self.state / READER),
                "market_root": str(self.web.config.data / "market")}

    def snapshot(self, name: str) -> dict:
        return snapshot(self.configuration(name), self.socket(name) / "control.sock")

    def current(self, owner: str) -> bool:
        """Whether the owner's control reads this host's inputs; a changed market directory needs a new control."""
        existing, host = self.snapshot(WEB + owner), self.facts()
        return all(existing[key] == host[key] for key in HOST_FIELDS)

    def owner(self) -> tuple[int, int]:
        """Root owns the custody root, and every control runs as it (common()): a control reads the release state,
        which is root's alone (0700), and Docker gives a non-root `--user` none of the capabilities it adds, so only
        root's own DAC_READ_SEARCH reaches it. Every capability but that one stays dropped; the control already
        holds the Docker socket."""
        return 0, 0

    def ensure_root(self) -> None:
        """Create the custody root and its account lock together, once, owned by `owner()`; then only
        check them. An existing root is never repaired: a missing lock is never recreated in it."""
        uid, gid = self.owner()
        if not os.path.lexists(self.root):
            staged = self.state / (ROOT + ".new")
            if os.path.lexists(staged):  # an attempt that stopped before its rename: no control ever used it
                if staged.is_symlink() or not staged.is_dir():
                    staged.unlink()
                else:
                    shutil.rmtree(staged)
            staged.mkdir(mode=0o700)
            staged.chmod(0o700)
            descriptor = os.open(staged / "account.lock", os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            try:
                os.fchmod(descriptor, 0o600)
                found = os.fstat(descriptor)
                if (found.st_uid, found.st_gid) != (uid, gid):
                    os.fchown(descriptor, uid, gid)
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
            found = staged.lstat()
            if (found.st_uid, found.st_gid) != (uid, gid):
                os.chown(staged, uid, gid, follow_symlinks=False)
            sync_directory(staged)
            os.rename(staged, self.root)
            sync_directory(self.state)
        try:
            root, lock = self.root.lstat(), (self.root / "account.lock").lstat()
        except FileNotFoundError:
            raise RuntimeError("Live custody root differs from its product installation") from None
        if (not stat.S_ISDIR(root.st_mode) or root.st_mode & 0o077 or (root.st_uid, root.st_gid) != (uid, gid)
                or not stat.S_ISREG(lock.st_mode) or lock.st_mode & 0o077
                or (lock.st_uid, lock.st_gid) != (uid, gid)):
            raise RuntimeError("Live custody root differs from its product installation")

    def prepare(self, owner: str | None, target: dict) -> None:
        """Build the candidate's snapshot from this host's inputs, creating the custody root on the first pairing.

        A running control and its prepared runs keep what they started with. The custody root never moves.
        `owner` is the revision of the routed Web, whose control owns the account, or None when it has no Live.
        """
        self.ensure_root()
        host = self.facts()
        if owner is not None:
            previous = WEB + owner
            if self.snapshot(previous)["root"] != host["root"]:
                raise RuntimeError("Live custody root changed; a release cannot move the account's runs")
            self.checked(previous)
        sha = target["revision"]
        self.web.pull(target.get("service"), SERVICE_REF, sha)
        runtime_source = self.web.pull(target.get("runtime"), RUNTIME_REF)
        self.source.require_runtime(runtime_source, sha)
        self.source.ensure(target)
        name = WEB + sha
        value = {"format": CONTROL, **host, "runtime": target["runtime"],
                 "socket": str(self.socket(name) / "control.sock")}
        path = self.configuration(name)
        if os.path.lexists(path) and read_object(path) != value:
            # Left by an attempt that created no control before the host's inputs changed; a control binds it.
            if self.web.exists(self.name(name)):
                raise RuntimeError("retained Live configuration binds different inputs")
            durable_json(path, value, mode=0o600)
        elif not os.path.lexists(path):
            durable_json(path, value, mode=0o600)
        socket_directory = self.socket(name)
        if not socket_directory.exists():
            socket_directory.mkdir(mode=0o700)
            custody = self.root.stat()
            if (socket_directory.stat().st_uid, socket_directory.stat().st_gid) != (custody.st_uid, custody.st_gid):
                os.chown(socket_directory, custody.st_uid, custody.st_gid)
        socket_stat = socket_directory.lstat()
        if (not stat.S_ISDIR(socket_stat.st_mode) or socket_stat.st_mode & 0o077
                or socket_stat.st_uid != self.root.stat().st_uid):
            raise RuntimeError("Live socket directory differs from its private release binding")

    def common(self, name: str, *, helper: bool = False) -> list[str]:
        value = self.snapshot(name)
        root = absolute(value["root"])
        owner = root.stat()
        # Every mount is the release's own state or an existing reader volume; never load key bytes. The state mount
        # holds the reader profile (research_ledger); the custody root and socket directory are writable over it.
        args = ["--user", f"{owner.st_uid}:{owner.st_gid}", *UNPRIVILEGED, "--cap-add", "DAC_READ_SEARCH",
                "--network", BACKEND, "--env", "TRADE_DOLT_HOST=ledger",
                "--env", "HOME=/tmp", "--env", "DOCKER_CONFIG=/tmp/docker-public",
                "--env", "DOCKER_HOST=unix:///var/run/docker.sock",
                # Telegram notices end with the run's page here (live/notify.py).
                "--env", f"TRADE_PAGE=https://{self.web.config.domain}",
                "--mount", "type=bind,src=/var/run/docker.sock,dst=/var/run/docker.sock",
                "--group-add", str(DOCKER_SOCKET.stat().st_gid),
                "--mount", f"type=bind,src={root},dst={root}" + (",readonly" if helper else ""),
                "--mount", f"type=bind,src={self.state},dst={self.state},readonly",
                "--mount", f"type=volume,src={READERS},dst=/run/trade/ledger-readers,readonly"]
        market = absolute(value["market_root"])
        if market.is_symlink() or not market.is_dir():
            raise RuntimeError("Live's market directory must be a directory")
        # Read-only: preparation reads the contract terms Live compares with exchangeInfo (TERMS_CHANGED).
        args += ["--mount", f"type=bind,src={market},dst={market},readonly"]
        if not helper:
            # Separate from the metadata mount: only this revision's empty socket directory is writable.
            args += ["--mount", f"type=bind,src={self.socket(name)},dst={self.socket(name)}"]
        return args

    def create(self, name: str, service: str) -> None:
        control = self.name(name)
        self.web.discard_failed(control, LIVE)
        self.web.docker("create", "--name", control, "--init", *contained("768m", "0.75"), *self.common(name), service, "python", "-m", "cli.main", "live", "serve",
                        "--configuration", str(self.configuration(name)),
                        "--release-state", str(self.state), "--release-web", name)
        self.checked(name)

    def checked(self, name: str) -> dict:
        control = self.name(name)
        found = self.web.checked(control, LIVE)
        value = self.snapshot(name)
        command = json.loads(self.web.docker("inspect", "--format", "{{json .Config.Cmd}}", found["id"]))
        expected = ["python", "-m", "cli.main", "live", "serve", "--configuration", str(self.configuration(name)),
                    "--release-state", str(self.state), "--release-web", name]
        if command != expected or not SERVICE_REF.fullmatch(found["image"]):
            raise RuntimeError("Live controller command or image differs from its bound Web release")
        mounts = json.loads(self.web.docker("inspect", "--format", "{{json .Mounts}}", found["id"]))
        bindings = {row["Destination"]: (row["Source"], row["RW"]) for row in mounts if row["Type"] == "bind"}
        for path, writable in ((value["root"], True), (str(self.state), False), (str(self.socket(name)), True)):
            if bindings.get(path) != (path, writable):
                raise RuntimeError("Live controller mounts differ from its retained release inputs")
        return found

    def start(self, name: str) -> None:
        facts = self.checked(name)
        if not facts["running"]:
            self.web.docker("start", facts["id"])

    def restore(self, web: str) -> None:
        """Keep the control of a Web that uses Live running: it owns the account."""
        if self.web.requires_live(web):
            self.start(web)
            self.health(web)

    def health(self, name: str) -> None:
        facts = self.checked(name)
        if not facts["running"]:
            raise RuntimeError("paired Live controller is not running")
        code = (
            "import json,sys;from pathlib import Path;from ide.research_graph.live_proxy import UnixConnection;"
            "c=UnixConnection(Path(sys.argv[1]));c.request('GET','/api/live',headers={'Host':'live-control'});"
            "r=c.getresponse();d=json.loads(r.read());assert r.status==200 and d['ok'] is True;"
            "assert isinstance(d['data']['runs'],list)"
        )
        self.web.docker("exec", facts["id"], "python", "-c", code,
                        str(self.socket(name) / "control.sock"), timeout=30)

    def warm(self, name: str) -> None:
        until_ready(lambda: self.health(name), 180, 3)

    @contextmanager
    def barrier(self, name: str, service: str | None = None, *, idle: bool = False, wait_for_lock: bool = False):
        """The metadata writer itself holds the existing inode; an inspector never owns this lock. With `idle` the
        account admits only while Live is idle; an inspection that fails to run or answer is an unavailable one."""
        configured = self.snapshot(name)
        if configured["root"] != str(self.root):
            raise RuntimeError("Live release cannot inspect a different custody authority")
        root = self.root
        if root.is_symlink() or root.resolve() != root:
            raise RuntimeError("Live custody path changed during release")
        original_root = root.stat()
        path = root / "account.lock"
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        try:
            original = os.fstat(descriptor)
            if (not stat.S_ISREG(original.st_mode) or original.st_mode & 0o077
                    or original.st_uid != root.stat().st_uid):
                raise RuntimeError("Live release requires the original private account lock")
            def held() -> None:
                if self.snapshot(name) != configured:
                    raise RuntimeError("Live custody authority changed during release")
                if root.is_symlink() or root.resolve() != root:
                    raise RuntimeError("Live custody path changed during release")
                current_root = root.lstat()
                if ((current_root.st_dev, current_root.st_ino)
                        != (original_root.st_dev, original_root.st_ino)):
                    raise RuntimeError("Live custody path changed during release")
                current = path.lstat()
                if ((current.st_dev, current.st_ino) != (original.st_dev, original.st_ino)
                        or not stat.S_ISREG(current.st_mode)):
                    raise RuntimeError("Live account lock identity changed during release")
                if current.st_mode & 0o077 or current.st_uid != current_root.st_uid:
                    raise RuntimeError("Live release requires the original private account lock")

            _acquire_account_lock(descriptor, held, wait_for_lock=wait_for_lock)
            held()
            if idle:
                service = service or self.checked(name)["image"]
                if not isinstance(service, str) or not SERVICE_REF.fullmatch(service):
                    raise RuntimeError("Live idle inspection needs the admitted immutable service image")
                try:
                    value = json.loads(self.web.docker(
                        "run", "--rm", "--init", "--read-only", "--tmpfs", "/tmp:rw,nosuid,size=67108864",
                        "--memory", "256m", *self.common(name, helper=True), "--entrypoint", "python", service,
                        "-m", "cli.main", "live", "release-inspect", "--configuration", str(self.configuration(name)),
                        timeout=180))
                except (RuntimeError, subprocess.SubprocessError, ValueError):
                    value = {"state": "unavailable"}
                held()
                if value in ({"state": "busy"}, {"state": "unavailable"}):
                    raise LiveBusy("Live is active or unresolved; keep the current Web/control pair")
                elif value != {"state": "idle"}:
                    raise RuntimeError("Live idle observation is unavailable")
            yield held
            held()
        finally:
            os.close(descriptor)

    def kept(self, name: str) -> bool:
        """The control of the committed or loaded Web owns the account and is never drained, so STOP stays reachable."""
        return name in {self.web.disk_route(), self.web.live_route()}

    def _retired(self, name: str, identifier: str) -> dict:
        if (self.state / "transaction.json").exists() or self.kept(name):
            raise RuntimeError("Live controller is still selected or a release is pending; keep it running")
        facts = self.checked(name)
        if facts["id"] != identifier:
            raise RuntimeError("retired Live controller identity changed")
        return facts

    def drain(self, name: str) -> bool:
        """Send a cooperative signal to a verified retired process; never force-stop or delete it."""
        if not self.web.exists(self.name(name)):
            return True
        facts = self.checked(name)
        identifier = facts["id"]
        if not self._retired(name, identifier)["running"]:
            return True
        self.web.docker("update", "--restart=no", identifier)
        if self._retired(name, identifier)["running"]:
            self.web.docker("kill", "--signal", "SIGTERM", identifier)
        return not self._retired(name, identifier)["running"]

    def runtimes(self) -> set[str]:
        """The runtime images the retained Live snapshots and every Live run name. A Live run launches on its
        manifest's image with `--pull never` (runtime/container.py), so whatever its state that image stays."""
        found = {read_object(path)["runtime"] for path in (self.state / "live").glob("*/configuration.json")
                 if REVISION.fullmatch(path.parent.name)}
        runs = self.root / "runs"
        return found | {read_object(path)["runtime"]["image_ref"] for path in runs.glob("*/inputs/manifest.json")}

    def prune(self, kept: set[str]) -> None:
        """After the controllers are pruned, remove each revision directory that neither a kept revision nor a
        remaining controller uses. Its configuration is a derived snapshot; the custody root is no revision's."""
        directory = self.state / "live"
        if not directory.is_dir():
            return  # no control was paired yet
        here = kept | {revision(name, LIVE) for name in self.web.managed(LIVE)}
        for path in directory.iterdir():
            if REVISION.fullmatch(path.name) and path.name not in here and not path.is_symlink() and path.is_dir():
                shutil.rmtree(path)

    def retire(self) -> None:
        for control in self.web.managed(LIVE, running_only=True):
            name = WEB + revision(control, LIVE)
            if not self.kept(name):
                if not self.drain(name):
                    print(f"Retired Live controller {control} is draining; it remains retained", flush=True)
