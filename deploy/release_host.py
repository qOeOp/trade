"""The deliberately small Docker boundary of remote Web releases; never owns Paper lifecycle."""

from dataclasses import dataclass
import json
import os
from pathlib import Path
import re
import subprocess
import time
from urllib.error import HTTPError
from urllib.request import ProxyHandler, Request, build_opener


REVISION = re.compile(r"[0-9a-f]{40}\Z")
WEB = "trade-release-web-"
AGENT = "trade-release-agent-"
LEGACY = "trade-ide-ide-1"
ROUTER = "trade-ide-ide-router-1"
SOURCE = "https://github.com/qOeOp/trade"
IMAGE = "ghcr.io/qoeop/trade-ide"
IMAGE_REF = re.compile(re.escape(IMAGE) + r"@sha256:[0-9a-f]{64}\Z")
SERVICE_REF = re.compile(r"ghcr\.io/qoeop/trade-service@sha256:[0-9a-f]{64}\Z")
RUNTIME_REF = re.compile(r"ghcr\.io/qoeop/trade-runtime@sha256:[0-9a-f]{64}\Z")
KEPT_RELEASES = 3  # per kind of container: the newest good ones, so an operator can return by hand


def revision(name: str, prefix: str = WEB) -> str:
    value = name.removeprefix(prefix)
    if not name.startswith(prefix) or not REVISION.fullmatch(value):
        raise RuntimeError(f"not a managed release container: {name}")
    return value


def route_config(name: str) -> dict:
    if name != LEGACY:
        revision(name)
    return {
        "admin": {"listen": "127.0.0.1:2019", "config": {"persist": False}},
        "apps": {
            "http": {
                "servers": {
                    "ide": {
                        "listen": [":8765"],
                        "routes": [
                            {
                                "handle": [
                                    {
                                        "handler": "reverse_proxy",
                                        "upstreams": [{"dial": f"{name}:8765"}],
                                        "flush_interval": -1,
                                        "stream_close_delay": 30_000_000_000,
                                    }
                                ]
                            }
                        ],
                    }
                }
            }
        },
    }


def route_name(config: dict) -> str:
    dial = config["apps"]["http"]["servers"]["ide"]["routes"][0]["handle"][0]["upstreams"][0]["dial"]
    if not isinstance(dial, str) or not dial.endswith(":8765"):
        raise RuntimeError("unrecognized router upstream")
    name = dial.removesuffix(":8765")
    if name != LEGACY:
        revision(name)
    return name


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


def sync_directory(path: Path) -> None:
    fd = os.open(path, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


@dataclass(frozen=True)
class Config:
    state: Path = Path("/var/lib/trade-release")
    data: Path = Path("/srv/trade")
    domain: str = "www.vibe-trading.info"
    backend: str = "trade-ide_default"
    frontend: str = "trade-ide_frontend"
    readers: str = "trade-ide_trade-ledger-readers"
    agents: str = "trade-ide_trade-ide-agent"
    warm_seconds: int = 1800
    observe_seconds: int = 90
    probe_seconds: int = 5


# Only selected public response facts cross the probe boundary. Never print a nonce, cookie or key.
PROBE = """import json,sys,urllib.request
path,domain,host=sys.argv[1:]
with urllib.request.urlopen(urllib.request.Request("http://"+host+":8765"+path,headers={"Host":domain}),timeout=15) as r:
 d=json.load(r)
 if path=="/api/lines": out={"status":r.status,"lines":d["lines"]}
 elif path=="/api/paper/runs": out={"status":r.status,"runs":[{"id":x["paper_id"],"candidate":x["candidate"],"state":x["state"],"last":x.get("live",{}).get("last_bar_ns")} for x in d["runs"]]}
 elif path.startswith("/api/view"): out={"status":r.status,"ready":r.status==200 and bool(d.get("widgets")),"state":d.get("state")}
 elif path=="/api/agent/agents": out={"status":r.status,"valid":isinstance(d,list)}
 else: out={"status":r.status,"ok":d.get("ok",True)}
 print(json.dumps(out))
"""


class DockerHost:
    def __init__(self, config: Config):
        self.config = config
        self.state = config.state

    def docker(self, *args: str, check: bool = True, timeout: int = 120) -> str:
        # Empty private Docker configuration: public pulls do not read a host credential helper.
        root = self.state / "docker"
        root.mkdir(parents=True, exist_ok=True)
        result = subprocess.run(
            ["docker", "--config", str(root), "--host", "unix:///var/run/docker.sock", *args],
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
        if check and result.returncode:
            raise RuntimeError(f"docker {args[0]} failed: {result.stderr[-1200:]}")
        return result.stdout.strip()

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

    def managed(self, prefix: str, running_only: bool = False) -> list[str]:
        return [
            name
            for name in self.docker("ps", *([] if running_only else ["-a"]), "--format", "{{.Names}}").splitlines()
            if name.startswith(prefix) and REVISION.fullmatch(name.removeprefix(prefix))
        ]

    def agent(self, allow_legacy: bool = False) -> str | None:
        running = [name for name in self.managed(AGENT, running_only=True) if self.checked(name, AGENT)["running"]]
        legacy = self.exists(LEGACY) and self.inspect(LEGACY)["running"]
        if len(running) + int(legacy) > 1:
            raise RuntimeError("multiple Agent writers; leave deployment unchanged")
        if legacy and not allow_legacy:
            raise RuntimeError("legacy embedded Agent was independently restarted")
        return running[0] if running else None

    def protected(self) -> dict:
        names = ["trade-ide-paper-1", "trade-ide-ledger-1", "trade-ide-docker-api-1"]
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
                raise RuntimeError(f"protected container changed during release: {name}")

    def disk_route(self) -> str:
        return route_name(json.loads((self.state / "router/active.json").read_text()))

    def live_route(self) -> str:
        raw = self.docker("exec", ROUTER, "wget", "-qO-", "http://127.0.0.1:2019/config/")
        return route_name(json.loads(raw))

    def switch(self, name: str) -> None:
        durable_json(self.state / "router/next.json", route_config(name))
        self.docker("exec", ROUTER, "caddy", "reload", "--config", "/etc/caddy/release/next.json")
        if self.live_route() != name:
            raise RuntimeError("router did not load the intended upstream")

    def persist_route(self, name: str) -> None:
        durable_json(self.state / "router/active.json", route_config(name))

    def pull(self, sha: str, image: str) -> str:
        if not REVISION.fullmatch(sha):
            raise RuntimeError("invalid product revision")
        if not IMAGE_REF.fullmatch(image):
            raise RuntimeError("only an admitted immutable IDE digest can be pulled")
        self.docker("pull", image, timeout=600)
        found = json.loads(self.docker("image", "inspect", "--format", "{{json .}}", image))
        labels = found["Config"]["Labels"]
        if (
            found["Architecture"] != "amd64"
            or labels.get("org.opencontainers.image.revision") != sha
            or labels.get("org.opencontainers.image.source") != SOURCE
        ):
            raise RuntimeError("image platform, source or revision does not match successful CI")
        if image not in found["RepoDigests"]:
            raise RuntimeError("pulled image does not match its admitted repository digest")
        return image

    def pull_execution(self, reference: str, pattern, sha: str | None = None) -> str:
        """The existing execution-image admission, shared by Paper and Live controllers."""
        if not isinstance(reference, str) or not pattern.fullmatch(reference):
            raise RuntimeError("execution release has no immutable admitted digest")
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
            raise RuntimeError("execution image source, platform or revision differs from admission")
        return source

    def requires_live(self, name: str) -> bool:
        args = json.loads(self.docker("inspect", "--format", "{{json .Config.Cmd}}", name))
        return any(arg.startswith(("--live-socket", "--live-router")) for arg in args)

    def prepare(self) -> None:
        self.state.mkdir(mode=0o700, parents=True, exist_ok=True)
        profiles = self.state / "profiles"
        durable_json(
            profiles / "research.json",
            {"name": "research", "kind": None, "database": "research", "service": "/run/trade/ledger-readers"},
        )
        durable_json(
            profiles / "market.json", {"name": "market", "kind": "market", "root": str(self.config.data / "market")}
        )

    def create(self, name: str, image: str, agent: bool = False, live_socket: Path | None = None) -> None:
        self.checked_image_name(name, agent)
        if agent and live_socket is not None:
            raise RuntimeError("Agent containers cannot mount the Live control socket")
        if self.exists(name):
            raise RuntimeError(f"release identity is already retained: {name}")
        # One old and one candidate Web process.
        args = [
            "create",
            "--name",
            name,
            "--restart",
            "unless-stopped",
            "--network",
            self.config.backend,
            "--log-opt",
            "max-size=10m",
            "--log-opt",
            "max-file=3",
            "--cap-drop",
            "ALL",
            # Reader service.json is 0600 under the service UID; Agent data remains 0700 root.
            # Retain the existing IDE DAC override; every research/market mount stays read-only.
            "--cap-add",
            "DAC_OVERRIDE",
            "--security-opt",
            "no-new-privileges:true",
            "--oom-score-adj",
            "500",
            "--memory",
            "1024m" if agent else "1536m",
            "--memory-swap",
            "1024m" if agent else "1536m",
            "--cpus",
            "0.5" if agent else "1.5",
            "--env",
            "TRADE_DOLT_HOST=ledger",
            "--env",
            "TRADE_IDE_CHAT=0",
            "--mount",
            f"type=bind,src={self.state / 'profiles'},dst=/run/trade/ledgers,readonly",
            "--mount",
            f"type=volume,src={self.config.readers},dst=/run/trade/ledger-readers,readonly",
            "--mount",
            f"type=bind,src={self.config.data / 'market'},dst={self.config.data / 'market'},readonly",
        ]
        if agent:
            args += [
                "--network-alias",
                "agent",
                "--mount",
                f"type=volume,src={self.config.agents},dst=/data/agent",
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
                "--paper=http://paper-router:8767" if (self.state / "paper-router/active.json").exists() else "--paper=http://paper:8767",
                "--research=http://ledger:8769",
                "--agent=http://agent:8766",
                f"--allow-host={self.config.domain}",
            ]
            if live_socket is not None:
                args += ["--live-socket=/run/trade-live/control.sock", "--live-router=ide-router"]
        self.docker(*args)
        if not agent:
            self.docker("network", "connect", self.config.frontend, name)

    @staticmethod
    def checked_image_name(name: str, agent: bool) -> None:
        revision(name, AGENT if agent else WEB)

    def start(self, name: str) -> None:
        if name != LEGACY:
            self.checked(name, AGENT if name.startswith(AGENT) else WEB)
        if not self.inspect(name)["running"]:
            writer = name == LEGACY or name.startswith(AGENT)
            if writer and self.agent() is not None:
                raise RuntimeError("another Agent writer is already running")
            self.docker("start", name)
            if writer:
                try:
                    if self.agent(allow_legacy=name == LEGACY) != (None if name == LEGACY else name):
                        raise RuntimeError("Agent identity changed during start")
                except RuntimeError:
                    self.docker("stop", "--time", "20", name)
                    raise

    def stop(self, name: str) -> None:
        if name != LEGACY:
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

    def lines(self, name: str) -> list[str]:
        lines = self.probe(name, "/api/lines")["lines"]
        active = [
            run["candidate"]
            for run in self.probe(name, "/api/paper/runs")["runs"]
            if run["state"] in {"running", "stopping", "ended", "unsealed"}
        ]
        found = {line["bundle"] for line in lines if any(candidate in line["versions"] for candidate in active)}
        if not found and lines:
            found.add(max(lines, key=lambda line: line["created_at"])["bundle"])
        if not found:
            raise RuntimeError("no research line available for candidate readiness")
        return sorted(found)

    def health(self, name: str, lines: list[str], routed: bool = False, agent: bool = True) -> None:
        if agent:
            self.agent(allow_legacy=name == LEGACY)
        for path in [
            "/api/paper/health",
            "/api/overview/health",
            *(["/api/agent/health", "/api/agent/agents"] if agent else []),
            *(["/api/live"] if routed and self.requires_live(name) else []),
        ]:
            value = self.probe(name, path, routed)
            if value["status"] != 200 or not value.get("ok", value.get("valid", True)):
                raise RuntimeError(f"candidate endpoint is not healthy: {path}")
        from urllib.parse import quote

        for line in lines:
            if not self.probe(name, f"/api/view?line={quote(line)}", routed).get("ready"):
                raise RuntimeError("candidate research graph is still warming")

    def warm(self, name: str, protected: dict, agent: bool = True) -> list[str]:
        deadline = time.monotonic() + self.config.warm_seconds
        lines: list[str] = []
        while time.monotonic() < deadline:
            self.ensure_protected(protected)
            if not self.inspect(name)["running"]:
                raise RuntimeError("candidate stopped before readiness")
            try:
                lines = lines or self.lines(name)
                self.health(name, lines, agent=agent)
                return lines
            except (RuntimeError, ValueError, KeyError):
                time.sleep(self.config.probe_seconds)
        raise RuntimeError("candidate readiness timed out; previous release kept")

    def observe(self, name: str, lines: list[str], protected: dict) -> None:
        before = {
            run["id"]: run["last"]
            for run in self.probe(name, "/api/paper/runs", routed=True)["runs"]
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
                after = self.probe(name, "/api/paper/runs", routed=True)["runs"]
                if any(
                    run["id"] in before
                    and run["state"] == "running"
                    and (run["last"] is None or run["last"] <= before[run["id"]])
                    for run in after
                ):
                    raise RuntimeError("Paper observations did not advance during release observation")
                return
            time.sleep(self.config.probe_seconds)

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

    def prune(self, prefixes: tuple[str, ...], active: set[str], failed: set[str]) -> None:
        """Bound what releases leave behind. Never a running or active container, never a runtime image.

        A failed candidate does not use up a place meant for a good release; the newest one stays to be read.
        Runtime images are pinned by Paper and Live runs this host cannot enumerate from here.
        """
        for prefix in prefixes:
            rows = []
            for name in self.managed(prefix):
                facts = self.docker("inspect", "--format", "[{{json .Created}},{{json .State.Running}}]", name)
                created, running = json.loads(facts)
                rows.append((created, name, running))
            rows.sort(reverse=True)
            good = [row for row in rows if row[1] not in failed]
            bad = [row for row in rows if row[1] in failed]
            for _, name, running in good[KEPT_RELEASES:] + bad[1:]:
                if not running and name not in active:
                    self.docker("rm", name)
        used = set(self.docker("ps", "-a", "--no-trunc", "--format", "{{.Image}}").splitlines())
        for image in self.docker("images", "--digests", "--format", "{{.Repository}}@{{.Digest}}").splitlines():
            if (IMAGE_REF.fullmatch(image) or SERVICE_REF.fullmatch(image)) and image not in used:
                # Without --force Docker also refuses an image that a stopped container still uses.
                self.docker("image", "rm", image, check=False)

    def memory_available(self) -> bool:
        values = {
            line.split(":")[0]: int(line.split()[1])
            for line in Path("/proc/meminfo").read_text().splitlines()
            if line.startswith("MemAvailable:")
        }
        return values["MemAvailable"] >= 2 * 1024 * 1024  # candidate cap plus 512 MiB headroom
