"""The Paper controller release boundary. Strategy containers are inspect-only here."""

from contextlib import contextmanager
import json
import select
import subprocess
import time

from .release_host import (
    LEDGER,
    Config,
    DockerHost,
    RUNTIME_REF,
    durable_json,
    revision,
)

PAPER = "trade-release-paper-"
PAPER_ROUTER = "trade-ide-paper-router-1"
CONTROLLERS = "trade-ide_trade-paper-controller"


def route_config(name: str, freeze: str | None = None) -> dict:
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
    routes.append(
        {
            "handle": [
                {
                    "handler": "reverse_proxy",
                    "upstreams": [{"dial": f"{name}:8767"}],
                    "headers": {"request": {"set": {"Host": ["paper:8767"]}}},
                    "flush_interval": -1,
                    "stream_close_delay": 30_000_000_000,
                }
            ]
        }
    )
    return {
        "admin": {"listen": "127.0.0.1:2019", "config": {"persist": False}},
        "apps": {"http": {"servers": {"paper": {"listen": [":8767"], "routes": routes}}}},
    }


def route_name(value: dict) -> str:
    dial = value["apps"]["http"]["servers"]["paper"]["routes"][-1]["handle"][0]["upstreams"][0]["dial"]
    if not isinstance(dial, str) or not dial.endswith(":8767"):
        raise RuntimeError("unrecognized Paper route")
    name = dial.removesuffix(":8767")
    revision(name, PAPER)
    return name


def runtime_default(args: list[str]) -> str:
    """The runtime image a Paper controller starts new runs with, read from its command."""
    ref = next((arg.split("=", 1)[1] for arg in args if arg.startswith("--runtime=")), None)
    if ref is None and "--runtime" in args:
        ref = args[args.index("--runtime") + 1]
    if not ref or not RUNTIME_REF.fullmatch(ref):
        raise RuntimeError("Paper controller has no fixed runtime default")
    return ref


class PaperHost(DockerHost):
    def __init__(self, config: Config):
        super().__init__(config)
        self.web = DockerHost(config)
        self.router = self.state / "paper-router"

    def disk_config(self) -> dict:
        return json.loads((self.router / "active.json").read_text())

    def live_config(self) -> dict:
        return json.loads(self.docker("exec", PAPER_ROUTER, "wget", "-qO-", "http://127.0.0.1:2019/config/"))

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

    def write_route(self, file: str, name: str, freeze: str | None) -> None:
        self.router.mkdir(exist_ok=True)
        self.router.chmod(0o755)  # public routing metadata, read by the unprivileged controller
        path = self.router / file
        durable_json(path, route_config(name, freeze), mode=0o644)

    def persist_route(self, name: str, freeze: str | None = None) -> None:
        self.write_route("active.json", name, freeze)

    def switch(self, name: str, freeze: str | None = None) -> None:
        self.write_route("next.json", name, freeze)
        self.docker("exec", PAPER_ROUTER, "caddy", "reload", "--config", "/etc/caddy/release/next.json")
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

    def pull(self, reference: str, pattern, sha: str | None = None) -> str:
        return self.pull_execution(reference, pattern, sha)

    def common(self) -> list[str]:
        # The service identity (TRADE_UID:TRADE_GID) the ledger runs as, which owns the execution records;
        # read from the ledger so that a new host's first controller has one too.
        user = self.docker("inspect", "--format", "{{.Config.User}}", LEDGER)
        if not user or any(char not in "0123456789:" for char in user):
            raise RuntimeError("the ledger service has no numeric unprivileged UID/GID")
        return [
            "--user",
            user,
            "--cap-drop",
            "ALL",
            "--security-opt",
            "no-new-privileges:true",
            "--network",
            self.config.backend,
            "--env",
            "TRADE_DOLT_HOST=ledger",
            "--env",
            "TRADE_LEDGER_HOME=/run/trade/paper-profiles",
            "--mount",
            f"type=volume,src={CONTROLLERS},dst=/run/trade/paper-profiles,readonly",
            "--mount",
            f"type=volume,src={CONTROLLERS},dst={self.config.data / 'dolt'},readonly",
        ]

    def create(self, name: str, service: str, runtime: str) -> None:
        revision(name, PAPER)
        if self.exists(name):
            raise RuntimeError("Paper release identity is retained; use a corrected main commit")
        market = self.state / "paper-market.json"
        durable_json(market, {"name": "market", "kind": "market", "root": str(self.config.data / "market")}, mode=0o644)
        self.docker(
            "create",
            "--name",
            name,
            "--init",
            "--restart",
            "unless-stopped",
            *self.common(),
            "--memory",
            "1024m",
            "--memory-swap",
            "1024m",
            "--cpus",
            "0.75",
            "--oom-score-adj",
            "500",
            "--log-opt",
            "max-size=10m",
            "--log-opt",
            "max-file=3",
            "--env",
            "DOCKER_HOST=tcp://docker-api:2375",
            "--env",
            "DOCKER_CONFIG=/tmp/docker-public",
            "--env",
            f"TMPDIR={self.config.data / 'paper-tmp'}",
            "--env",
            f"HOME={self.config.data / 'paper-tmp'}",
            "--mount",
            f"type=bind,src={market},dst=/run/trade/paper-market.json,readonly",
            "--mount",
            f"type=bind,src={self.config.data / 'dolt/paper'},dst={self.config.data / 'dolt/paper'}",
            "--mount",
            f"type=bind,src={self.config.data / 'paper-tmp'},dst={self.config.data / 'paper-tmp'}",
            "--mount",
            f"type=bind,src={self.config.data / 'market'},dst={self.config.data / 'market'},readonly",
            "--mount",
            f"type=bind,src={self.router},dst=/run/trade/paper-release,readonly",
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
        self.docker("network", "connect", "trade-ide_docker-api", name)

    def runtime(self, name: str) -> str:
        return runtime_default(json.loads(self.docker("inspect", "--format", "{{json .Config.Cmd}}", name)))

    def health(self, name: str) -> None:
        code = (
            "import json,urllib.request;"
            'r=urllib.request.Request("http://127.0.0.1:8767/api/paper/runs",headers={"Host":"paper-router:8767"});'
            'd=json.load(urllib.request.urlopen(r,timeout=20));assert isinstance(d["runs"],list)'
        )
        self.docker("exec", name, "python", "-c", code, timeout=30)
        check = (
            "import json,urllib.request,sys;"
            'r=urllib.request.Request("http://127.0.0.1:8767/api/paper/health",headers={"Host":"paper-router:8767"});'
            "d=json.load(urllib.request.urlopen(r,timeout=15));"
            'assert d["runtime"]==sys.argv[1] and d["active"]==(sys.argv[2]=="yes")'
        )
        self.docker(
            "exec",
            name,
            "python",
            "-c",
            check,
            self.runtime(name),
            "yes" if self.disk_route() == name else "no",
            timeout=25,
        )

    def compatible(self, name: str) -> None:
        self.docker(
            "exec",
            name,
            "python",
            "-m",
            "paper.release",
            "check",
            "--ledger=paper",
            f"--runtime={self.runtime(name)}",
            timeout=300,
        )

    def warm(self, name: str, protected: dict) -> None:
        deadline = time.monotonic() + 180
        while True:
            self.ensure_protected(protected)
            try:
                self.health(name)
                self.compatible(name)
                return
            except RuntimeError:
                if time.monotonic() >= deadline:
                    raise
                time.sleep(3)

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
            "--memory",
            "512m",
            "--memory-swap",
            "512m",
            "--cpus",
            "0.5",
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

        def read(expected: str, seconds: int = 20) -> None:
            if not select.select([process.stdout], [], [], seconds)[0] or process.stdout.readline().strip() != expected:
                raise RuntimeError("Paper lifecycle barrier was lost or did not become ready")

        def held() -> None:
            if process.poll() is not None:
                raise RuntimeError("Paper lifecycle barrier process exited")
            process.stdin.write("held\n")
            process.stdin.flush()
            read("held")

        try:
            read("locked", 150)
            held()
            yield held
        finally:
            try:
                process.stdin.close()
            except OSError:
                pass
            process.stdin = None
            try:
                process.communicate(timeout=15)
            except subprocess.TimeoutExpired:
                process.terminate()
                process.communicate(timeout=15)
            if process.returncode != 0:
                raise RuntimeError("Paper lifecycle barrier did not release cleanly")
