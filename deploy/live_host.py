"""Live's companion container in the existing Web transaction; no separate release state machine."""

from contextlib import contextmanager
import fcntl
import json
import os
from pathlib import Path
import stat
import time

from .release_host import RUNTIME_REF, SERVICE_REF, WEB, durable_json, revision


LIVE = "trade-release-live-"
OPERATOR_FIELDS = frozenset({"root", "research_ledger", "research_at", "universe_file", "symbols",
                            "sources", "defaults", "memory"})
DECLARATION = "live-deployment-v1"
CONTROL = "live-control-v1"
DOCKER_SOCKET = Path("/var/run/docker.sock")


class LiveBusy(RuntimeError):
    """The account cannot admit a release now; no deployment failure was established."""


def read_object(path: Path) -> dict:
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, "r") as stream:
        if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
            raise RuntimeError("Live deployment configuration is not a regular file")
        value = json.load(stream)
    if not isinstance(value, dict):
        raise RuntimeError("Live deployment configuration is not an object")
    return value


def absolute(value) -> Path:
    if not isinstance(value, str) or not Path(value).is_absolute() or "," in value:
        raise RuntimeError("Live deployment inputs need explicit absolute bind paths")
    return Path(value)


class LiveHost:
    def __init__(self, web, source):
        self.web, self.source, self.state = web, source, web.state
        self.declaration = self.state / "live/configuration.json"

    def directory(self, name: str) -> Path:
        return self.state / "live" / revision(name)

    def configuration(self, name: str) -> Path:
        return self.directory(name) / "configuration.json"

    def socket(self, name: str) -> Path:
        return self.directory(name) / "socket"

    def name(self, web: str) -> str:
        return LIVE + revision(web)

    def declaration_value(self) -> dict:
        value = read_object(self.declaration)
        if set(value) != OPERATOR_FIELDS | {"format"} or value["format"] != DECLARATION:
            raise RuntimeError("Live installation must declare operator inputs without runtime or socket")
        root = absolute(value["root"])
        if root.is_symlink() or not root.is_dir() or root.stat().st_mode & 0o077:
            raise RuntimeError("Live installation must retain its existing private custody root")
        return value

    def snapshot(self, name: str) -> dict:
        value = read_object(self.configuration(name))
        if (set(value) != OPERATOR_FIELDS | {"format", "runtime", "socket"}
                or value["format"] != CONTROL or not isinstance(value["runtime"], str)
                or not RUNTIME_REF.fullmatch(value["runtime"])
                or value["socket"] != str(self.socket(name) / "control.sock")):
            raise RuntimeError("Live configuration cache does not match its release")
        return value

    def prepare(self, previous: str, target: dict) -> None:
        """Rebuild a derived snapshot; installed operator declarations never override a committed one."""
        declared = self.declaration_value()
        operator = {key: declared[key] for key in OPERATOR_FIELDS}
        if self.web.requires_live(previous):
            existing = self.snapshot(previous)
            prior = {key: existing[key] for key in OPERATOR_FIELDS}
            if prior != operator:
                raise RuntimeError("Live operator inputs changed; install an explicitly reviewed configuration change")
            operator = prior
            self.checked(previous)
        sha = target["revision"]
        self.web.pull_execution(target.get("service"), SERVICE_REF, sha)
        runtime_source = self.web.pull_execution(target.get("runtime"), RUNTIME_REF)
        self.source.require_runtime(runtime_source, sha)
        self.source.ensure(target)
        name = WEB + sha
        value = {"format": CONTROL, **operator, "runtime": target["runtime"],
                 "socket": str(self.socket(name) / "control.sock")}
        path = self.configuration(name)
        if os.path.lexists(path):
            if read_object(path) != value:
                raise RuntimeError("retained Live configuration binds different inputs")
        else:
            durable_json(path, value, mode=0o600)
        socket_directory = self.socket(name)
        if not socket_directory.exists():
            socket_directory.mkdir(mode=0o700)
            owner = absolute(value["root"]).stat()
            if (socket_directory.stat().st_uid, socket_directory.stat().st_gid) != (owner.st_uid, owner.st_gid):
                os.chown(socket_directory, owner.st_uid, owner.st_gid)
        socket_stat = socket_directory.lstat()
        if (not stat.S_ISDIR(socket_stat.st_mode) or socket_stat.st_mode & 0o077
                or socket_stat.st_uid != absolute(value["root"]).stat().st_uid):
            raise RuntimeError("Live socket directory differs from its private release binding")

    def common(self, name: str, *, helper: bool = False) -> list[str]:
        value = self.snapshot(name)
        root = absolute(value["root"])
        owner = root.stat()
        # Every mount is a deployment declaration or existing reader volume; never load key bytes.
        args = ["--user", f"{owner.st_uid}:{owner.st_gid}", "--cap-drop", "ALL",
                "--cap-add", "DAC_READ_SEARCH", "--security-opt", "no-new-privileges:true",
                "--network", self.web.config.backend, "--env", "TRADE_DOLT_HOST=ledger",
                "--env", "HOME=/tmp", "--env", "DOCKER_CONFIG=/tmp/docker-public",
                "--env", "DOCKER_HOST=unix:///var/run/docker.sock",
                "--mount", "type=bind,src=/var/run/docker.sock,dst=/var/run/docker.sock",
                "--group-add", str(DOCKER_SOCKET.stat().st_gid),
                "--mount", f"type=bind,src={root},dst={root}" + (",readonly" if helper else ""),
                "--mount", f"type=bind,src={self.state},dst={self.state},readonly",
                "--mount", f"type=volume,src={self.web.config.readers},dst=/run/trade/ledger-readers,readonly"]
        paths = {absolute(value["research_ledger"]), absolute(value["universe_file"])}
        paths.update(absolute(row["strategy_file"]) for row in value["sources"])
        for path in sorted(paths):
            if path.is_symlink() or not path.is_file():
                raise RuntimeError("Live declared inputs must retain their regular source files")
            args += ["--mount", f"type=bind,src={path},dst={path},readonly"]
        if not helper:
            # Separate from the metadata mount: only this revision's empty socket directory is writable.
            args += ["--mount", f"type=bind,src={self.socket(name)},dst={self.socket(name)}"]
        return args

    def create(self, name: str, service: str) -> None:
        control = self.name(name)
        if self.web.exists(control):
            raise RuntimeError("Live release identity is retained; use a corrected main commit")
        self.web.docker("create", "--name", control, "--init", "--restart", "unless-stopped",
                        "--memory", "768m", "--memory-swap", "768m", "--cpus", "0.75",
                        "--log-opt", "max-size=10m", "--log-opt", "max-file=3",
                        *self.common(name), service, "python", "-m", "cli.main", "live", "serve",
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

    def restore(self, name: str) -> None:
        if self.web.requires_live(name):
            self.start(name)
            self.health(name)

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
        deadline = time.monotonic() + 180
        while True:
            try:
                self.health(name)
                return
            except RuntimeError:
                if time.monotonic() >= deadline:
                    raise
                time.sleep(3)

    @contextmanager
    def barrier(self, name: str, service: str | None = None, *, idle: bool = False):
        """The metadata writer itself holds the existing inode; an inspector never owns this lock."""
        root = absolute(self.snapshot(name)["root"])
        if root.is_symlink() or root.resolve() != root:
            raise RuntimeError("Live custody path changed during release")
        path = root / "account.lock"
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        try:
            original = os.fstat(descriptor)
            if (not stat.S_ISREG(original.st_mode) or original.st_mode & 0o077
                    or original.st_uid != root.stat().st_uid):
                raise RuntimeError("Live release requires the original private account lock")
            try:
                fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise LiveBusy("A Live operation holds the account lock; keep the current pair") from None

            def held() -> None:
                current = path.lstat()
                if ((current.st_dev, current.st_ino) != (original.st_dev, original.st_ino)
                        or not stat.S_ISREG(current.st_mode)):
                    raise RuntimeError("Live account lock identity changed during release")

            held()
            if idle:
                service = service or self.checked(name)["image"]
                if not isinstance(service, str) or not SERVICE_REF.fullmatch(service):
                    raise RuntimeError("Live idle inspection needs the admitted immutable service image")
                result = self.web.docker(
                    "run", "--rm", "--init", "--read-only", "--tmpfs", "/tmp:rw,nosuid,size=67108864",
                    "--memory", "256m", *self.common(name, helper=True), "--entrypoint", "python", service,
                    "-m", "cli.main", "live", "release-inspect", "--configuration", str(self.configuration(name)),
                    timeout=180)
                value = json.loads(result)
                held()
                if value in ({"state": "busy"}, {"state": "unavailable"}):
                    raise LiveBusy("Live is active or unresolved; keep the current Web/control pair")
                if value != {"state": "idle"}:
                    raise RuntimeError("Live idle observation is unavailable")
            yield held
            held()
        finally:
            os.close(descriptor)

    def _retired(self, name: str, identifier: str) -> dict:
        if ((self.state / "transaction.json").exists()
                or self.web.disk_route() == name or self.web.live_route() == name):
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

    def retire(self) -> None:
        for control in self.web.managed(LIVE, running_only=True):
            name = WEB + revision(control, LIVE)
            if name != self.web.disk_route() and name != self.web.live_route():
                if not self.drain(name):
                    print(f"Retired Live controller {control} is draining; it remains retained", flush=True)
