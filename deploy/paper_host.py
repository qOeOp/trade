"""The Paper controller release boundary. Strategy containers are inspect-only here."""

from contextlib import contextmanager, suppress
import json
import re
import select
import subprocess

from .release_host import (
    BACKEND,
    DOCKER_API_NETWORK,
    DockerFailure,
    LEDGER,
    PAPER_ROUTER,
    UNPRIVILEGED,
    Config,
    DockerHost,
    RUNTIME_REF,
    ReaderFailure,
    answered,
    contained,
    limits,
    durable_json,
    printed_refusal,
    proxy,
    revision,
    router,
    until_ready,
    upstream,
)

# Like release_host.PROBE: selected public facts, the HTTP status or the error class, never a body.
CONTROLLER_PROBE = """import json,sys,urllib.error,urllib.request
path=sys.argv[1]
try:
 with urllib.request.urlopen(urllib.request.Request("http://127.0.0.1:8767"+path,headers={"Host":"paper-router:8767"}),timeout=20) as r:
  d=json.load(r)
  out={"status":r.status,"runs":isinstance(d.get("runs"),list)} if path.endswith("/runs") else {"status":r.status,"runtime":d.get("runtime"),"active":d.get("active")}
except urllib.error.HTTPError as e:
 e.close(); out={"status":e.code}
except Exception as e:
 out={"status":None,"error":type(e).__name__}
print(json.dumps(out))
"""
PAPER = "trade-release-paper-"
CONTROLLERS = "trade-ide_trade-paper-controller"
# The databases a version reads on the host's ledger service, each by its profile in CONTROLLERS.
DATABASES = ("research", "paper")
GENERATION = re.compile(r"[0-9]{1,4}\Z")


def route_config(name: str, freeze: str | None = None) -> dict:
    """The Paper controller and its write barrier: all POSTs, run starts only, or none."""
    revision(name, PAPER)
    routes = []
    if freeze:
        match = {"method": ["POST"]}
        if freeze == "starts":
            match["path"] = ["/api/paper/runs"]
        elif freeze != "all":
            raise RuntimeError("unknown Paper write barrier")
        routes.append(
            {
                "match": [match],
                "handle": [
                    {
                        "handler": "static_response",
                        "status_code": 503,
                        "headers": {"Content-Type": ["application/json"], "Retry-After": ["5"]},
                        "body": '{"code":"PAPER_UPGRADING","message":"Paper release is in progress; existing strategies continue"}',
                    }
                ],
            }
        )
    routes.append(proxy(name, 8767, headers={"request": {"set": {"Host": ["paper:8767"]}}}))
    return router("paper", 8767, routes)


def route_name(value: dict) -> str:
    return upstream(value, "paper", 8767, PAPER)


def runtime_default(args: list[str]) -> str:
    """The runtime image a Paper controller starts new runs with, read from its command."""
    ref = next((arg.split("=", 1)[1] for arg in args if arg.startswith("--runtime=")), None)
    if ref is None and "--runtime" in args:
        ref = args[args.index("--runtime") + 1]
    if not ref or not RUNTIME_REF.fullmatch(ref):
        raise RuntimeError("Paper controller has no fixed runtime default")
    return ref


class PaperHost(DockerHost):
    ROUTER = PAPER_ROUTER
    ROUTES = "paper-router"
    ROUTE_MODE = 0o644  # public routing metadata, read by the unprivileged controller

    def __init__(self, config: Config):
        super().__init__(config)
        self.web = DockerHost(config)

    def disk_route(self) -> str:
        return route_name(self.disk_config())

    def live_route(self) -> str:
        return route_name(self.live_config())

    def known(self, names: set[str]) -> None:
        for value in (self.disk_config(), self.live_config()):
            name = route_name(value)
            if name not in names or value not in [route_config(name, f) for f in (None, "all", "starts")]:
                raise RuntimeError("Paper router has an independent change; preserve transaction")

    def pending(self, candidate: str, previous: str) -> None:
        self.known({candidate, previous})
        if route_config(candidate) in (self.disk_config(), self.live_config()):
            raise RuntimeError("uncommitted Paper candidate was independently unfrozen; preserve transaction")

    def phase(self, name: str, live_freeze: str | None, disk_freeze: str | None) -> None:
        if self.live_config() != route_config(name, live_freeze) or self.disk_config() != route_config(
            name, disk_freeze
        ):
            raise RuntimeError("Paper router changed during handoff; preserve transaction")

    def write_route(self, file: str, config: dict) -> None:
        self.routes.mkdir(exist_ok=True)
        self.routes.chmod(0o755)
        super().write_route(file, config)

    def persist_route(self, name: str, freeze: str | None = None) -> None:
        self.write_route("active.json", route_config(name, freeze))

    def switch(self, name: str, freeze: str | None = None) -> None:
        self.reload(route_config(name, freeze))
        if self.live_config() != route_config(name, freeze):
            raise RuntimeError("Paper router did not select its intended configuration")

    def normalize(self) -> None:
        name = self.disk_route()
        self.known({name})
        if self.disk_config() != route_config(name) or self.live_config() != route_config(name):
            self.persist_route(name)
            self.switch(name)

    def checked(self, name: str, prefix: str = PAPER) -> dict:
        return super().checked(name, prefix)

    def start(self, name: str) -> None:
        self.checked(name)
        if not self.inspect(name)["running"]:
            self.docker("start", name)

    def stop(self, name: str) -> None:
        self.checked(name)
        if self.inspect(name)["running"]:
            self.docker("stop", "--time", "30", name)

    def common(self) -> list[str]:
        # The service identity (TRADE_UID:TRADE_GID) the ledger runs as, which owns the execution records;
        # read from the ledger so that a new host's first controller has one too.
        user = self.docker("inspect", "--format", "{{.Config.User}}", LEDGER)
        if not user or any(char not in "0123456789:" for char in user):
            raise RuntimeError("the ledger service has no numeric unprivileged UID/GID")
        return [
            "--user",
            user,
            *UNPRIVILEGED,
            "--network",
            BACKEND,
            "--env",
            "TRADE_DOLT_HOST=ledger",
            "--env",
            "TRADE_LEDGER_HOME=/run/trade/paper-profiles",
            "--mount",
            f"type=volume,src={CONTROLLERS},dst=/run/trade/paper-profiles,readonly",
            "--mount",
            f"type=volume,src={CONTROLLERS},dst={self.config.data / 'dolt'},readonly",
        ]

    def create_controller(self, name: str, service: str, runtime: str) -> None:
        revision(name, PAPER)
        self.discard_failed(name, PAPER)
        market = self.state / "paper-market.json"
        durable_json(market, {"name": "market", "holds": "market", "kind": None, "root": str(self.config.data / "market")}, mode=0o644)
        self.docker(
            "create",
            "--name",
            name,
            "--init",
            *contained("1024m", "0.75"),
            *self.common(),
            "--oom-score-adj",
            "500",
            "--env",
            "DOCKER_HOST=tcp://docker-api:2375",
            "--env",
            "DOCKER_CONFIG=/tmp/docker-public",
            "--env",
            f"TMPDIR={self.config.data / 'paper-tmp'}",
            "--env",
            f"HOME={self.config.data / 'paper-tmp'}",
            *(("--env", f"TRADE_PAPER_MEMORY={self.config.paper_memory}") if self.config.paper_memory else ()),
            "--mount",
            f"type=bind,src={market},dst=/run/trade/paper-market.json,readonly",
            "--mount",
            f"type=bind,src={self.config.data / 'dolt/paper'},dst={self.config.data / 'dolt/paper'}",
            "--mount",
            f"type=bind,src={self.config.data / 'paper-tmp'},dst={self.config.data / 'paper-tmp'}",
            "--mount",
            f"type=bind,src={self.config.data / 'market'},dst={self.config.data / 'market'},readonly",
            "--mount",
            f"type=bind,src={self.routes},dst=/run/trade/paper-release,readonly",
            service,
            "python",
            "-m",
            "cli.main",
            "paper",
            "serve",
            "--ledger=paper",
            "--research-ledger=research",
            "--host=0.0.0.0",
            "--allow-host=paper-router:8767",
            "--allow-host=paper:8767",
            "--market=/run/trade/paper-market.json",
            f"--runtime={runtime}",
            "--release-route=/run/trade/paper-release/active.json",
            f"--release-name={name}",
        )
        self.docker("network", "connect", DOCKER_API_NETWORK, name)

    def generations(self, service: str) -> dict[str, str]:
        """The databases on the host's ledger service that the version of service image `service` does not read: each
        one its own `ledger service check` (the ledger's health check) refuses with SCHEMA_MISMATCH, mapped to the
        schema generation that version expects ("" when its refusal names none). The check runs read-only in a
        container of that image with the Paper controller's profiles. Any other failure raises."""
        found = {}
        for database in DATABASES:
            try:
                self.docker("run", "--rm", "--init", "--read-only", "--tmpfs", "/tmp:rw,nosuid,size=16777216",
                            *limits("256m", "0.5"), *self.common(), "--env", "HOME=/tmp", service,
                            "python", "-m", "cli.main", "ledger", "service", "check", "--ledger", database,
                            timeout=180)
            except DockerFailure as error:
                refusal = printed_refusal(error.stderr)
                if refusal is None or refusal["code"] != "SCHEMA_MISMATCH":
                    raise
                expected = refusal.get("expected")
                found[database] = expected if isinstance(expected, str) and GENERATION.fullmatch(expected) else ""
        return found

    def runtime(self, name: str) -> str:
        return runtime_default(json.loads(self.docker("inspect", "--format", "{{json .Config.Cmd}}", name)))

    def controller_health(self, name: str) -> None:
        """Its runs listing (which reads the Paper database on the ledger service and Docker through docker-api),
        then its health: the runtime default and whether it is the routed controller. A failure is ReaderFailure."""
        if self.reply(name, "/api/paper/runs").get("runs") is not True:
            raise ReaderFailure("Paper controller", "/api/paper/runs", "no run list")
        found = self.reply(name, "/api/paper/health")
        if found.get("runtime") != self.runtime(name):
            raise ReaderFailure("Paper controller", "/api/paper/health", "another runtime")
        if found.get("active") is not (self.disk_route() == name):
            raise ReaderFailure("Paper controller", "/api/paper/health", "another active state")

    def reply(self, name: str, path: str) -> dict:
        """CONTROLLER_PROBE's facts at `path` when the controller answered 200; else ReaderFailure."""
        value = json.loads(self.docker("exec", name, "python", "-c", CONTROLLER_PROBE, path, timeout=30))
        if value.get("status") != 200:
            raise ReaderFailure("Paper controller", path, answered(value))
        return value

    def warm_controller(self, name: str, protected: dict) -> None:
        until_ready(lambda: self.controller_health(name), 180, 3, lambda: self.ensure_protected(protected))

    @contextmanager
    def barrier(self, service: str):
        # A disposable helper has no Docker socket, run writes or role. It only holds GET_LOCK.
        root = self.state / "docker"
        command = [
            "docker",
            "--config",
            str(root),
            "--host",
            "unix:///var/run/docker.sock",
            "run",
            "--rm",
            "-i",
            "--init",
            "--read-only",
            *limits("512m", "0.5"),
            "--oom-score-adj",
            "500",
            *self.common(),
            "--entrypoint",
            "python",
            service,
            "-m",
            "paper.release",
            "barrier",
            "--ledger=paper",
        ]
        process = subprocess.Popen(
            command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1
        )
        assert process.stdin is not None and process.stdout is not None  # both are PIPE
        stdin, stdout = process.stdin, process.stdout

        def read(expected: str, seconds: int = 20) -> None:
            if not select.select([stdout], [], [], seconds)[0] or stdout.readline().strip() != expected:
                raise RuntimeError("Paper lifecycle barrier was lost or did not become ready")

        def held() -> None:
            if process.poll() is not None:
                raise RuntimeError("Paper lifecycle barrier process exited")
            stdin.write("held\n")
            stdin.flush()
            read("held")

        try:
            read("locked", 150)
            held()
            yield held
        finally:
            with suppress(OSError):
                stdin.close()
            process.stdin = None
            try:
                process.communicate(timeout=15)
            except subprocess.TimeoutExpired:
                process.terminate()
                process.communicate(timeout=15)
            if process.returncode != 0:
                raise RuntimeError("Paper lifecycle barrier did not release cleanly")
