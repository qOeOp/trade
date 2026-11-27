"""The Docker boundary of the release plane: fixed names, routes, image admission, the Web and Agent containers
and the pruning of every managed kind. PaperHost and LiveHost build on it; Live reads its names and routes."""

from dataclasses import dataclass
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import time
from urllib.error import HTTPError
from urllib.request import ProxyHandler, Request, build_opener

from .registry import Registry


REVISION = re.compile(r"[0-9a-f]{40}\Z")
WEB = "trade-release-web-"
AGENT = "trade-release-agent-"
# What compose (project `trade-ide`, deploy/compose.yaml and deploy/remote/) names: fixed, not settings.
LEDGER = "trade-ide-ledger-1"
MARKET_IMPORT = "trade-ide-market-import-1"
ROUTER = "trade-ide-ide-router-1"
PAPER_ROUTER = "trade-ide-paper-router-1"
DOCKER_API = "trade-ide-docker-api-1"
OAUTH2, EDGE = "trade-ide-oauth2-1", "trade-ide-edge-1"
DOCKER_API_NETWORK = "trade-ide_docker-api"
BACKEND = "trade-ide_default"
FRONTEND = "trade-ide_frontend"
READERS = "trade-ide_trade-ledger-readers"
AGENTS = "trade-ide_trade-ide-agent"
WARM_SECONDS, PROBE_SECONDS = 1800, 5  # how long a candidate may take to warm, and the interval between probes
# CD serves the author's own deployment only: the source, image names and digest patterns below are the
# author's repository and GHCR namespace, deliberately not settings (deploy/remote/README.md, Who this is for).
SOURCE = "https://github.com/qOeOp/trade"
IMAGE = "ghcr.io/qoeop/trade-ide"
IMAGE_REF = re.compile(re.escape(IMAGE) + r"@sha256:[0-9a-f]{64}\Z")
SERVICE_REF = re.compile(r"ghcr\.io/qoeop/trade-service@sha256:[0-9a-f]{64}\Z")
RUNTIME_REF = re.compile(r"ghcr\.io/qoeop/trade-runtime@sha256:[0-9a-f]{64}\Z")
DOCKER_API_REF = re.compile(r"ghcr\.io/qoeop/trade-docker-api@sha256:[0-9a-f]{64}\Z")  # pinned in deploy/compose.yaml
KEPT_RELEASES = 2  # per kind of container: the routed version and the previous good one, to return to by hand
# A release needs this much MemAvailable before it starts a candidate (its Web's cap plus 512 MiB). Paper admission
# keeps the same amount free after a new run's limit (paper/runs.py): starting a run never takes the host below it.
RELEASE_MEMORY_MIB = 2048
MEMINFO = Path("/proc/meminfo")


def revision(name: str, prefix: str = WEB) -> str:
    value = name.removeprefix(prefix)
    if not name.startswith(prefix) or not REVISION.fullmatch(value):
        raise RuntimeError(f"not a managed release container: {name}")
    return value


def proxy(name: str, port: int, **options) -> dict:
    """A router route to one release container, streaming without a whole-request deadline."""
    return {"handle": [{"handler": "reverse_proxy", "upstreams": [{"dial": f"{name}:{port}"}], **options,
                        "flush_interval": -1, "stream_close_delay": 30_000_000_000}]}


def router(server: str, port: int, routes: list[dict]) -> dict:
    """A whole internal Caddy configuration: one server, reloaded only through its local admin endpoint."""
    return {"admin": {"listen": "127.0.0.1:2019", "config": {"persist": False}},
            "apps": {"http": {"servers": {server: {"listen": [f":{port}"], "routes": routes}}}}}


def upstream(config: dict, server: str, port: int, prefix: str) -> str:
    """The managed container the last route of `server` proxies to."""
    dial = config["apps"]["http"]["servers"][server]["routes"][-1]["handle"][0]["upstreams"][0]["dial"]
    if not isinstance(dial, str) or not dial.endswith(f":{port}"):
        raise RuntimeError("unrecognized router upstream")
    name = dial.removesuffix(f":{port}")
    revision(name, prefix)
    return name


def route_config(name: str) -> dict:
    """The committed Web; with Live installed its own control owns the account."""
    return router("ide", 8765, [proxy(name, 8765)])


def route_name(config: dict) -> str:
    return upstream(config, "ide", 8765, WEB)


def limits(memory: str, cpus: str) -> list[str]:
    """Its own memory, without swap, and a CPU share."""
    return ["--memory", memory, "--memory-swap", memory, "--cpus", cpus]


# A long-lived container's log goes to the host journal under the container's name, so it outlives the container (a
# release recreates and prunes them) and a reboot; journald's own size cap bounds it (remote/README.md, Logs).
JOURNALD = ["--log-driver", "journald", "--log-opt", "tag={{.Name}}"]


def contained(memory: str, cpus: str) -> list[str]:
    """What every long-lived release container is created with: restarted with the host, its log in the host
    journal (JOURNALD) and `limits`. The command line itself names everything else."""
    return ["--restart", "unless-stopped", *JOURNALD, *limits(memory, cpus)]


UNPRIVILEGED = ["--cap-drop", "ALL", "--security-opt", "no-new-privileges:true"]


def until_ready(check, seconds: float, interval: float, guard=lambda: None, errors: tuple = (RuntimeError,)):
    """`check()`'s result once it stops raising `errors`, or its last error after `seconds`. `guard()` runs
    before every attempt and is never retried."""
    deadline = time.monotonic() + seconds
    while True:
        guard()
        try:
            return check()
        except errors:
            if time.monotonic() >= deadline:
                raise
            time.sleep(interval)


def durable_json(path: Path, value: dict, mode: int | None = None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".pending")
    with temporary.open("w") as out:
        json.dump(value, out, separators=(",", ":"))
        out.write("\n")
        if mode is not None:
            os.fchmod(out.fileno(), mode)
        out.flush()
        os.fsync(out.fileno())
    temporary.replace(path)
    sync_directory(path.parent)


JOURNAL_FORMAT = "pending release journal is not in this control's format; left for the operator"


def read_journal(path: Path, keys: frozenset[str], optional: frozenset[str] = frozenset()) -> dict[str, str]:
    """A pending release journal, read only when it has exactly the shape this control writes: `keys`, any of
    `optional`, and string values. A newer control may recover an older one's journal (Release.tick); until 1.0 no
    version reads another's format (CHANGELOG.md), so one this control did not write is refused, never guessed."""
    try:
        value = json.loads(path.read_text())
    except ValueError:
        raise RuntimeError(JOURNAL_FORMAT) from None
    if (not isinstance(value, dict) or not keys <= value.keys() <= keys | optional
            or not all(isinstance(item, str) for item in value.values())):
        raise RuntimeError(JOURNAL_FORMAT)
    return value


def sync_directory(path: Path) -> None:
    fd = os.open(path, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def durable_copy(source: Path, target: Path) -> None:
    """Copy a regular file's bytes to `target` (0644), replacing it in one rename."""
    temporary = target.with_name(target.name + ".pending")
    with temporary.open("wb") as out:
        out.write(source.read_bytes())
        os.fchmod(out.fileno(), 0o644)
        out.flush()
        os.fsync(out.fileno())
    temporary.replace(target)


ENV_FILE = Path("/etc/trade/remote.env")
IMAGE_DEPLOY = "/opt/trade/deploy"  # deploy/Dockerfile: WORKDIR /opt/trade, COPY . ./ (deploy/Dockerfile.dockerignore)
EXTRACTOR = "trade-release-control-extract"
# The compose files of the host's whole project, as each version's service image carries them under deploy/, and the
# files they name. The release recreates each long-lived service from its own version's files, passing only the image
# variables (deploy/services.py; docs/plans/release-moves-ledger-mirror-20261116.zh.md).
COMPOSE = ("compose.yaml", "remote/compose.yaml", "remote/cd.compose.yaml", "remote/paper-cd.compose.yaml")
# What install-release.sh installs where the release service cannot write (/opt, /etc), by each version's copy.
INSTALLED = (("remote/trade-release-tick", Path("/opt/trade-release/trade-release-tick")),
             ("remote/trade-release.service", Path("/etc/systemd/system/trade-release.service")),
             ("remote/trade-release.timer", Path("/etc/systemd/system/trade-release.timer")))
DEFINITION = (*COMPOSE, "remote/Caddyfile", "remote/oauth2-proxy.cfg", *(name for name, _ in INSTALLED))
# The compose services of the service image: each one, its container, and whether its health check says the image
# works (market-import's says whether the data lags, so it is only seen running).
FOLLOWERS = (("ledger", LEDGER, True), ("market-import", MARKET_IMPORT, False))
# Every long-lived compose service of the host the release keeps on the routed version's definition
# (deploy/services.py), its container, and whether compose waits for its health check.
SERVICES = (*FOLLOWERS, ("docker-api", DOCKER_API, False), ("ide-router", ROUTER, False),
            ("paper-router", PAPER_ROUTER, False), ("oauth2", OAUTH2, False), ("edge", EDGE, False))
CONFIG_HASH = "com.docker.compose.config-hash"  # the label compose gives a container: its service's `config --hash`
# The variables deploy/compose.yaml takes those services' images from, and docker-api's (which defaults to its pin).
SERVICE_IMAGE, DOCKER_API_IMAGE = "TRADE_SERVICE_IMAGE", "TRADE_DOCKER_API_IMAGE"
FOLLOW_WAIT_SECONDS, FOLLOW_SETTLE_SECONDS = 600, 30


def moment(created: str) -> tuple[str, str]:
    """Docker's RFC 3339 creation time (UTC, trailing zeros of the fraction trimmed) in an order that compares."""
    whole, _, fraction = created.removesuffix("Z").partition(".")
    return whole, fraction.ljust(9, "0")


def deployment_env(path: Path, run=subprocess.run) -> dict[str, str]:
    """The compose env file the operator writes (README.md here), as Compose itself resolves it: its quoting,
    comments and interpolation, and the process environment over the file, exactly as for `compose up`."""
    result = run(["docker", "compose", "--env-file", str(path), "-f", "-", "config", "--environment"],
                 input="services: {}\n", capture_output=True, text=True, timeout=60, check=False)
    if result.returncode:
        raise RuntimeError(f"Docker Compose 2.28 or newer could not read {path}: {result.stderr[-400:]}")
    return dict(line.split("=", 1) for line in result.stdout.splitlines() if "=" in line)


@dataclass(frozen=True)
class Config:
    state: Path = Path("/var/lib/trade-release")
    data: Path = Path("/srv/trade")
    domain: str = "trade.example.com"
    observe_seconds: int = 90
    paper_memory: str = ""  # TRADE_PAPER_MEMORY for the Paper controllers it creates; empty: paper/runs.py's default
    research_origin: str = ""  # TRADE_RESEARCH_ORIGIN: the DoltHub repository each generation's is named after

    @classmethod
    def installed(cls, path: Path = ENV_FILE, run=subprocess.run) -> "Config":
        """The host's TRADE_DOMAIN, TRADE_DATA, optional TRADE_PAPER_MEMORY and TRADE_RESEARCH_ORIGIN, from the env
        file compose and the installer read."""
        values = deployment_env(path, run)
        domain, data = values.get("TRADE_DOMAIN", ""), Path(values.get("TRADE_DATA", ""))
        if not re.fullmatch(r"[a-z0-9]([a-z0-9.-]*[a-z0-9])?", domain) or not data.is_absolute():
            raise RuntimeError(f"{path} must set TRADE_DOMAIN to a host name and TRADE_DATA to an absolute path")
        memory = values.get("TRADE_PAPER_MEMORY", "")
        if memory and not re.fullmatch(r"[1-9][0-9]{0,5}[mg]", memory):  # what paper/runs.py mib() accepts
            raise RuntimeError(f"{path} must leave TRADE_PAPER_MEMORY empty or set it to a size such as 3584m or 4g")
        return cls(data=data, domain=domain, paper_memory=memory, research_origin=values.get("TRADE_RESEARCH_ORIGIN", ""))


# Only selected public response facts cross the probe boundary. Never print a nonce, cookie or key. A reader that
# does not answer 200 gives its HTTP status, or the class of the error that stopped the read, never its body.
PROBE = """import json,sys,urllib.error,urllib.request
path,domain,host=sys.argv[1:]
try:
 with urllib.request.urlopen(urllib.request.Request("http://"+host+":8765"+path,headers={"Host":domain}),timeout=15) as r:
  d=json.load(r)
  if path=="/api/lines": out={"status":r.status,"lines":d["lines"]}
  elif path=="/api/paper/runs": out={"status":r.status,"starting":len(d.get("starting",[])),"runs":[{"id":x["paper_id"],"candidate":x["candidate"],"state":x["state"],"containers":len(x.get("containers",[])),"last":x.get("readings",{}).get("last_bar_ns"),"recovery":(x.get("recovery") or {}).get("code"),"unprotected":[u.get("position_id") for u in x.get("unprotected") or []],**{k:(x.get("seal") or {}).get(k) for k in ("stop_reason","stopped_ns","reasons")}} for x in d["runs"]]}
  elif path=="/api/about": l=d.get("ledger"); out={"status":r.status,"version":d.get("version"),"ledger":l and {k:l.get(k) for k in ("unpublished","behind_seconds","diverged")}}
  elif path.startswith("/api/view"): out={"status":r.status,"ready":r.status==200 and bool(d.get("widgets")),"state":d.get("state")}
  elif path=="/api/agent/agents": out={"status":r.status,"valid":isinstance(d,list)}
  else: out={"status":r.status,"ok":d.get("ok",True)}
except urllib.error.HTTPError as e:
 e.close(); out={"status":e.code}
except Exception as e:
 out={"status":None,"error":type(e).__name__}
print(json.dumps(out))
"""
ERROR_CLASS = re.compile(r"[A-Za-z_][A-Za-z0-9_]{0,63}\Z")


def answered(value: dict) -> str:
    """What a probe that did not answer healthy says, bounded: `HTTP <status>` or the error class that stopped it."""
    status, error = value.get("status"), value.get("error")
    if type(status) is int:
        return f"HTTP {status}"
    return error if isinstance(error, str) and ERROR_CLASS.fullmatch(error) else "no answer"


class ReaderFailure(RuntimeError):
    """A reader of the release that did not answer healthy: which one (a fixed name), the path it was asked (no
    query), and `answered`'s HTTP status or error class. failure_summary prints exactly these; never a body."""

    def __init__(self, reader: str, path: str, answer: str):
        super().__init__(reader, path.partition("?")[0], answer)
        self.reader, self.path, self.answer = reader, path.partition("?")[0], answer

    def __str__(self) -> str:
        return f"{self.reader} {self.path}: {self.answer}"


class HostCondition(RuntimeError):
    """A condition of the host, not of the version being released: a protected container that restarted or changed,
    or memory the release needs. A release it stops is undone like any other but marks nothing failed: the version
    waits and the next tick tries again (deploy/release.py Release.wait)."""


class DockerFailure(RuntimeError):
    """A `docker` command that exited non-zero. Its stderr stays in the exception for a traceback by hand;
    failure_summary prints only the subcommand and the exit status, since stderr can quote what a container printed."""

    def __init__(self, command: str, status: int, stderr: str):
        super().__init__(f"docker {command} failed: {stderr}")
        self.command, self.status, self.stderr = command, status, stderr


def printed_refusal(stderr: str) -> dict | None:
    """The refusal a product command printed on stderr (cli.main: one JSON object, the stream's last output), None
    when it ends in none. shared.errors.printed_refusal, which this host's Python cannot import."""
    text = stderr.rstrip()
    for start in reversed([match.start() for match in re.finditer(r"^\{", text, re.MULTILINE)]):
        try:
            value = json.loads(text[start:])
        except ValueError:
            continue
        return value if isinstance(value, dict) and isinstance(value.get("code"), str) else None
    return None


class DockerHost:
    CODE = Path(__file__).resolve().parent  # this control's deploy/: control/<revision>/deploy on a host

    def __init__(self, config: Config):
        self.config = config
        self.state = config.state

    def docker(self, *args: str, check: bool = True, timeout: int = 120, env: dict[str, str] | None = None,
               binary: bool = False):
        # Empty private Docker configuration: public pulls do not read a host credential helper.
        root = self.state / "docker"
        root.mkdir(parents=True, exist_ok=True)
        result = subprocess.run(
            ["docker", "--config", str(root), "--host", "unix:///var/run/docker.sock", *args],
            capture_output=True,
            text=not binary,
            timeout=timeout,
            check=False,
            env=None if env is None else {**os.environ, **env},
        )
        if check and result.returncode:
            stderr = result.stderr.decode(errors="replace") if binary else result.stderr
            raise DockerFailure(args[0], result.returncode, stderr[-1200:])
        return result.stdout if binary else result.stdout.strip()

    def inspect(self, name: str) -> dict:
        template = (
            '{"id":{{json .Id}},"revision":{{json (index .Config.Labels "org.opencontainers.image.revision")}},'
            '"running":{{json .State.Running}},"started":{{json .State.StartedAt}},'
            '"oom":{{json .State.OOMKilled}},"restarts":{{json .RestartCount}},"image":{{json .Config.Image}}}'
        )
        return json.loads(self.docker("inspect", "--format", template, name))

    def checked(self, name: str, prefix: str = WEB) -> dict:
        expected = revision(name, prefix)
        found = self.inspect(name)
        if found["revision"] != expected:
            raise RuntimeError(f"container identity mismatch: {name}")
        return found

    def exists(self, name: str) -> bool:
        return name in self.docker("ps", "-a", "--format", "{{.Names}}").splitlines()

    def created(self, name: str) -> tuple[str, str]:
        return moment(json.loads(self.docker("inspect", "--format", "{{json .Created}}", name)))

    def follower(self, name: str) -> dict | None:
        """A running compose service's image, creation time, compose configuration hash (CONFIG_HASH) and the host
        source of each bind mount by its destination; None when it is absent or stopped."""
        if not self.exists(name):
            return None
        template = ('{"running":{{json .State.Running}},"image":{{json .Config.Image}},"created":{{json .Created}},'
                    f'"hash":{{{{json (index .Config.Labels "{CONFIG_HASH}")}}}},"mounts":{{{{json .Mounts}}}}}}')
        found = json.loads(self.docker("inspect", "--format", template, name))
        if not found["running"]:
            return None
        return {"image": found["image"], "created": moment(found["created"]), "hash": found["hash"],
                "mounts": {mount["Destination"]: mount["Source"] for mount in found["mounts"] or []
                           if mount.get("Type") == "bind"}}

    def compose(self, files: list[str], *args: str, env: dict[str, str], timeout: int = 120) -> str:
        """`docker compose` on the host's project from the compose `files` (`definition`) and the env file, with `env`
        in the process environment, which compose reads over the env file (the env file is never written)."""
        return self.docker("compose", "--env-file", str(ENV_FILE), *[arg for path in files for arg in ("-f", path)],
                           "--profile", "local-research-import", *args, timeout=timeout, env=env)

    def condition(self, name: str) -> dict | None:
        """A compose service's container as Docker last saw it: running, its health check's status (None without
        one) and what the check last printed (`output`, None without one), whether its last exit was out of memory,
        and its restarts; None when it is absent."""
        if not self.exists(name):
            return None
        template = ('{"running":{{json .State.Running}},"health":{{if .State.Health}}{{json .State.Health.Status}}'
                    '{{else}}null{{end}},"log":{{if .State.Health}}{{json .State.Health.Log}}{{else}}null{{end}},'
                    '"oom":{{json .State.OOMKilled}},"restarts":{{json .RestartCount}}}')
        found = json.loads(self.docker("inspect", "--format", template, name))
        log = found.pop("log") or []
        found["output"] = log[-1].get("Output") if log and isinstance(log[-1], dict) else None
        return found

    def extract(self, service: str, target: Path) -> None:
        """Copy IMAGE_DEPLOY out of the service image to `target`, from a container created and never started."""
        self.docker("rm", "--force", EXTRACTOR, check=False)
        self.docker("create", "--name", EXTRACTOR, "--network", "none", service, "true")
        try:
            self.docker("cp", f"{EXTRACTOR}:{IMAGE_DEPLOY}", str(target))
        finally:
            self.docker("rm", "--force", EXTRACTOR, check=False)

    def definition(self, service: str, sha: str) -> list[str]:
        """The compose files of version `sha`, the one this control runs, beside its code (CODE). The first call
        reads DEFINITION out of its admitted service image, as the handoff read the code (deploy/control.py)."""
        root = self.CODE
        if root.parent.name != sha:
            raise RuntimeError("the running control is not the version whose compose definition is read")
        if not all((root / name).is_file() for name in DEFINITION):
            self.pull(service, SERVICE_REF, sha)
            staged = root.parent / "definition.new"
            shutil.rmtree(staged, ignore_errors=True)  # an interrupted read
            staged.mkdir(mode=0o700)
            try:
                self.extract(service, staged / "image")
                for name in DEFINITION:
                    source = staged / "image" / name
                    if source.is_symlink() or not source.is_file():
                        raise RuntimeError("the admitted service image holds no compose definition")
                    (root / name).parent.mkdir(mode=0o755, exist_ok=True)
                    durable_copy(source, root / name)
            finally:
                shutil.rmtree(staged, ignore_errors=True)
            sync_directory(root / "remote")
            sync_directory(root)
            print(f"Read the compose definition of {sha} from its service image", flush=True)
        return [str(root / name) for name in COMPOSE]

    def installed(self, service: str, sha: str) -> list[str]:
        """The launcher and units install-release.sh put on the host that differ from version `sha`'s own copies.
        Read only: the release service cannot write /opt or /etc, so the owner reinstalls them."""
        self.definition(service, sha)
        return [str(path) for name, path in INSTALLED
                if not path.is_file() or path.read_bytes() != (self.CODE / name).read_bytes()]

    def recreate(self, service: str, name: str, image: str, healthy: bool, files: list[str], env: dict[str, str],
                 pull: bool = False) -> None:
        """Recreate one compose service from the compose `files` of the active version (`definition`), with the image
        variables `env` (`compose`), so compose makes it and its mounts anew. `pull` lets compose pull an image it does
        not hold (one pinned by digest in the definition, or one a move puts back); otherwise the release pulled and
        checked it."""
        wait = ["--wait", "--wait-timeout", str(FOLLOW_WAIT_SECONDS)] if healthy else []
        self.compose(files, "up", "--detach", "--no-deps", "--force-recreate", "--timeout", "60",
                     "--pull", "missing" if pull else "never", *wait, service, env=env, timeout=FOLLOW_WAIT_SECONDS + 180)
        if not healthy:
            time.sleep(FOLLOW_SETTLE_SECONDS)
        found = self.inspect(name)
        if found["image"] != image or not found["running"] or found["restarts"]:
            raise RuntimeError(f"compose service did not start on its image: {service}")
        # Compose's `--wait` can time out and still exit 0 on a health check that never passed.
        health = (self.condition(name) or {"health": "gone"})["health"] if healthy else None
        if health not in (None, "healthy"):
            raise RuntimeError(f"compose service is {health} after its wait: {service}")

    def discard_failed(self, name: str, prefix: str) -> None:
        """Remove what an earlier attempt at this revision left, before creating it again: the operator deleted
        the failed marker to retry. Only a stopped container of exactly this revision goes; any other refuses."""
        if not self.exists(name):
            return
        found = self.inspect(name)
        if found["revision"] != revision(name, prefix) or found["running"]:
            raise RuntimeError(f"release identity is already retained: {name}")
        self.docker("rm", name)

    def managed(self, prefix: str, running_only: bool = False) -> list[str]:
        return [
            name
            for name in self.docker("ps", *([] if running_only else ["-a"]), "--format", "{{.Names}}").splitlines()
            if name.startswith(prefix) and REVISION.fullmatch(name.removeprefix(prefix))
        ]

    def agent(self) -> str | None:
        running = [name for name in self.managed(AGENT, running_only=True) if self.checked(name, AGENT)["running"]]
        if len(running) > 1:
            raise RuntimeError("multiple Agent writers; leave deployment unchanged")
        return running[0] if running else None

    def protected(self) -> dict:
        names = [LEDGER, DOCKER_API]
        names += self.docker("ps", "--filter", "label=trade.paper.ledger", "--format", "{{.Names}}").splitlines()
        return {
            name: {
                key: value
                for key, value in self.inspect(name).items()
                if key in {"id", "running", "started", "oom", "restarts"}
            }
            for name in names
        }

    def ensure_protected(self, before: dict) -> None:
        for name, identity in before.items():
            current = self.inspect(name)
            if any(current[key] != value for key, value in identity.items()):
                raise HostCondition(f"protected container changed during release: {name}")

    # The router this host switches and the directory of its configurations (mounted at /etc/caddy/release).
    ROUTER: str = ROUTER
    ROUTES: str = "router"
    ROUTE_MODE: int | None = None

    @property
    def routes(self) -> Path:
        return self.state / self.ROUTES

    def disk_config(self) -> dict:
        return json.loads((self.routes / "active.json").read_text())

    def live_config(self) -> dict:
        return json.loads(self.docker("exec", self.ROUTER, "wget", "-qO-", "http://127.0.0.1:2019/config/"))

    def write_route(self, file: str, config: dict) -> None:
        durable_json(self.routes / file, config, mode=self.ROUTE_MODE)

    def reload(self, config: dict) -> None:
        self.write_route("next.json", config)
        self.docker("exec", self.ROUTER, "caddy", "reload", "--config", "/etc/caddy/release/next.json")

    def disk_route(self) -> str:
        return route_name(self.disk_config())

    def live_route(self) -> str:
        return route_name(self.live_config())

    def switch(self, name: str) -> None:
        self.reload(route_config(name))
        if route_name(self.live_config()) != name:
            raise RuntimeError("router did not load the intended upstream")

    def persist_route(self, name: str) -> None:
        self.write_route("active.json", route_config(name))

    def pull(self, reference: str, pattern, sha: str | None = None) -> str:
        """Pull an admitted digest and check what CI built: amd64, this repository and, given `sha`, that revision.
        The revision it was built from."""
        if not isinstance(reference, str) or not pattern.fullmatch(reference):
            raise RuntimeError("release has no immutable admitted digest")
        self.docker("pull", reference, timeout=600)
        value = json.loads(self.docker("image", "inspect", "--format", "{{json .}}", reference))
        labels = value["Config"]["Labels"]
        source = labels.get("org.opencontainers.image.revision")
        if (
            value["Architecture"] != "amd64"
            or labels.get("org.opencontainers.image.source") != SOURCE
            or not isinstance(source, str)
            or not REVISION.fullmatch(source)
            or (sha is not None and source != sha)
            or reference not in value["RepoDigests"]
        ):
            raise RuntimeError("image source, platform or revision differs from admission")
        return source

    def prepare(self) -> None:
        self.state.mkdir(mode=0o700, parents=True, exist_ok=True)
        profiles = self.state / "profiles"
        durable_json(
            profiles / "research.json",
            {"name": "research", "holds": "research", "kind": None, "database": "research", "service": "/run/trade/ledger-readers"},
        )
        # Live admission reads the Paper runs through it (live/reconcile.py); the readers volume holds each
        # database's reader account.
        durable_json(
            profiles / "paper.json",
            {"name": "paper", "holds": "paper", "kind": None, "database": "paper", "service": "/run/trade/ledger-readers"},
        )
        durable_json(
            profiles / "market.json", {"name": "market", "holds": "market", "kind": None, "root": str(self.config.data / "market")}
        )

    def create(self, name: str, image: str, agent: bool = False, live_socket: Path | None = None) -> None:
        revision(name, AGENT if agent else WEB)
        if agent and live_socket is not None:
            raise RuntimeError("Agent containers cannot mount the Live control socket")
        self.discard_failed(name, AGENT if agent else WEB)
        # One old and one candidate Web process.
        args = [
            "create",
            "--name",
            name,
            *contained("1024m" if agent else "1536m", "0.5" if agent else "1.5"),
            "--network",
            BACKEND,
            *UNPRIVILEGED,
            # Reader service.json is 0600 under the service UID; Agent data remains 0700 root.
            # Retain the existing IDE DAC override; every research/market mount stays read-only.
            "--cap-add",
            "DAC_OVERRIDE",
            "--oom-score-adj",
            "500",
            "--env",
            "TRADE_DOLT_HOST=ledger",
            "--env",
            "TRADE_IDE_CHAT=0",
            "--mount",
            f"type=bind,src={self.state / 'profiles'},dst=/run/trade/ledgers,readonly",
            "--mount",
            f"type=volume,src={READERS},dst=/run/trade/ledger-readers,readonly",
            "--mount",
            f"type=bind,src={self.config.data / 'market'},dst={self.config.data / 'market'},readonly",
        ]
        if agent:
            args += [
                "--network-alias",
                "agent",
                "--mount",
                f"type=volume,src={AGENTS},dst=/data/agent",
                "--entrypoint",
                "node",
                image,
                "/opt/trade/ide/agent/src/main.ts",
                "--product=/opt/trade",
                "--ledger=research",
                "--market=market",
                "--data=/data/agent",
                "--host=agent",
                "--port=8766",
            ]
        else:
            if live_socket is not None:
                args += ["--mount", f"type=bind,src={live_socket},dst=/run/trade-live,readonly"]
            args += [
                "--tmpfs",
                "/data/agent:rw,nosuid,size=1048576",
                image,
                "--paper=http://paper-router:8767",
                "--research=http://ledger:8769",
                "--agent=http://agent:8766",
                f"--allow-host={self.config.domain}",
            ]
            if live_socket is not None:
                args += ["--live-socket=/run/trade-live/control.sock", "--live-router=ide-router"]
        self.docker(*args)
        if not agent:
            self.docker("network", "connect", FRONTEND, name)

    def start(self, name: str) -> None:
        self.checked(name, AGENT if name.startswith(AGENT) else WEB)
        if not self.inspect(name)["running"]:
            writer = name.startswith(AGENT)
            if writer and self.agent() is not None:
                raise RuntimeError("another Agent writer is already running")
            self.docker("start", name)
            if writer:
                try:
                    if self.agent() != name:
                        raise RuntimeError("Agent identity changed during start")
                except RuntimeError:
                    self.docker("stop", "--time", "20", name)
                    raise

    def stop(self, name: str) -> None:
        self.checked(name, AGENT if name.startswith(AGENT) else WEB)
        if self.exists(name) and self.inspect(name)["running"]:
            self.docker("stop", "--time", "20", name)

    def probe(self, name: str, path: str, routed: bool = False) -> dict:
        return json.loads(
            self.docker(
                "exec",
                name,
                "python3",
                "-c",
                PROBE,
                path,
                self.config.domain,
                "ide-router" if routed else "127.0.0.1",
                timeout=25,
            )
        )

    def answer(self, name: str, path: str, routed: bool = False) -> dict:
        """`probe`'s facts when the Web answered 200; else ReaderFailure naming the Web, the path and what it said."""
        value = self.probe(name, path, routed)
        if value.get("status") != 200:
            raise ReaderFailure("routed Web" if routed else "Web", path, answered(value))
        return value

    def lines(self, name: str) -> list[str]:
        """The research lines a candidate draws before it serves: those of active Paper runs, else the newest.
        Empty while the research ledger it read has no line yet (a new ledger): there is no graph to warm."""
        lines = self.answer(name, "/api/lines")["lines"]
        if not lines:
            return []
        active = [
            run["candidate"]
            for run in self.answer(name, "/api/paper/runs")["runs"]
            if run["state"] in {"running", "stopping", "ended", "unsealed"}
        ]
        found = {line["name"] for line in lines if any(candidate in line["candidates"] for candidate in active)}
        return sorted(found or {max(lines, key=lambda line: line["created_at"])["name"]})

    def health(self, name: str, lines: list[str], routed: bool = False, live: bool = True) -> None:
        """`live` False leaves out /api/live: a caller holding the Live account lock (Live barrier) would wait on
        itself there, since the listing reads under that lock (live/state.py reading)."""
        self.agent()
        for path in [
            "/api/paper/health",
            "/api/overview/health",
            "/api/agent/health",
            "/api/agent/agents",
            *(["/api/live"] if routed and live else []),
        ]:
            if not (value := self.answer(name, path, routed)).get("ok", value.get("valid", True)):
                raise ReaderFailure("routed Web" if routed else "Web", path, "not ok")
        from urllib.parse import quote

        for line in lines:
            if not self.probe(name, f"/api/view?line={quote(line)}", routed).get("ready"):
                raise RuntimeError("candidate research graph is still warming")

    def warm(self, name: str, protected: dict) -> list[str]:
        lines: list[str] = []

        def guard() -> None:
            self.ensure_protected(protected)
            if not self.inspect(name)["running"]:
                raise RuntimeError("candidate stopped before readiness")

        def check() -> list[str]:
            lines[:] = lines or self.lines(name)
            self.health(name, lines)
            return lines

        return until_ready(check, WARM_SECONDS, PROBE_SECONDS, guard,
                           (RuntimeError, ValueError, KeyError))

    def observe(self, name: str, lines: list[str], protected: dict) -> None:
        before = {
            run["id"]: run["last"]
            for run in self.answer(name, "/api/paper/runs", routed=True)["runs"]
            if run["state"] == "running" and run["last"] is not None
        }
        deadline = time.monotonic() + self.config.observe_seconds
        while True:
            self.ensure_protected(protected)
            self.health(name, lines, routed=True)
            if self.live_route() != name:
                raise RuntimeError("loaded route changed during observation")
            self.auth_denied()
            if self.live_route() != name:
                raise RuntimeError("loaded route changed during authentication probe")
            if time.monotonic() >= deadline:
                after = self.answer(name, "/api/paper/runs", routed=True)["runs"]
                if any(
                    run["id"] in before
                    and run["state"] == "running"
                    and (run["last"] is None or run["last"] <= before[run["id"]])
                    for run in after
                ):
                    raise RuntimeError("Paper observations did not advance during release observation")
                return
            time.sleep(PROBE_SECONDS)

    def auth_denied(self) -> None:
        opener = build_opener(ProxyHandler({}))
        for path in ("/api/paper/health", "/api/agent/health", "/api/live"):
            try:
                with opener.open(Request(f"https://{self.config.domain}{path}"), timeout=15) as response:
                    status = response.status
            except HTTPError as error:
                status = error.code
                error.close()
            if status != 401:
                raise RuntimeError("public API authentication boundary is not healthy")

    def prune(self, prefixes: tuple[str, ...], active: set[str], failed: set[str],
              runtimes: set[str] | None = None, stale: frozenset[str] = frozenset(),
              waiting: frozenset[str] = frozenset()) -> list[str]:
        """Bound what releases leave behind, and name what it removed. Never a running or active container.

        A failed candidate does not use up a place meant for a good release; the newest one stays to be read, unless
        it is `stale` (a version older than the routed one).
        Paper and Live runs this host cannot enumerate pin runtime images by digest and pull a missing one
        again (runtime/image.py resolve), so a runtime image goes only when no container uses it, no kept
        release names it (`runtimes`; None keeps them all) and the registry still serves its digest. The images of a
        version that waits to be released (`waiting`) stay: no container uses them yet.
        """
        removed = []
        for prefix in prefixes:
            rows = []
            for name in self.managed(prefix):
                facts = self.docker("inspect", "--format", "[{{json .Created}},{{json .State.Running}}]", name)
                created, running = json.loads(facts)
                rows.append((created, name, running))
            rows.sort(reverse=True)
            good = [row for row in rows if row[1] not in failed]
            bad = [row for row in rows if row[1] in failed and row[1] not in stale]
            for _, name, running in good[KEPT_RELEASES:] + bad[1:] + [row for row in rows if row[1] in stale]:
                if not running and name not in active:
                    self.docker("rm", name)
                    removed.append(name)
        used = set(self.docker("ps", "-a", "--no-trunc", "--format", "{{.Image}}").splitlines())
        for image in self.docker("images", "--digests", "--format", "{{.Repository}}@{{.Digest}}").splitlines():
            if image in used or image in waiting:
                continue
            # Without --force Docker also refuses an image that a stopped container still uses.
            if (IMAGE_REF.fullmatch(image) or SERVICE_REF.fullmatch(image) or DOCKER_API_REF.fullmatch(image)
                    or (runtimes is not None and RUNTIME_REF.fullmatch(image) and image not in runtimes
                        and Registry(timeout=15).serves(image))) and self.docker("image", "rm", image, check=False):
                removed.append(image)  # it printed what it untagged and deleted
        return removed

    def memory_available(self) -> bool:
        values = {
            line.split(":")[0]: int(line.split()[1])
            for line in MEMINFO.read_text().splitlines()
            if line.startswith("MemAvailable:")
        }
        return values["MemAvailable"] >= RELEASE_MEMORY_MIB * 1024
