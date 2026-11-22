"""Move this workstation's compose deployment to an admitted version (README.md here, Updating; deploy/update.sh).

One definition owns the deployment: the admitted revision's own compose.yaml, kept at
$TRADE_DATA/deploy/<revision>/compose.yaml with the images it admitted (images.env), and `current` naming the one the
services were last moved to. Every later recreate uses that file with the same env file and project, so no service runs
from a scratch or deleted definition.

It refuses while a Paper run or comparison is under way, reports each service's revision against the admitted one
(flagging one on a build the version does not contain), names the images in the env file, pulls, runs `up -d` (compose
recreates exactly the services whose definition or image changed, ledger only when its own did), checks every service
now runs the definition, and then removes what nothing uses: replay containers left exited over an hour, dangling
anonymous volumes, and images no container runs that the definition, the env file or a non-`pr-` tag does not name:
this repository's and nameless (dangling) ones. `--check` reports and changes nothing.
"""

import argparse
from datetime import datetime, timedelta, UTC
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys
import tempfile

from .images import CHANNELS, architecture_of, channel_source, resolve, write_env, write_file
from .release_host import Registry


PROJECT = "trade-ide"
SERVICES = ("ide", "ledger", "market-import", "paper", "docker-api")
VERSIONED = ("ide", "ledger", "market-import", "paper")  # docker-api moves with its pin, not the revision
REPOSITORIES = tuple(f"ghcr.io/qoeop/trade-{name}" for name in ("ide", "service", "runtime", "docker-api"))
REVISION_LABEL = "org.opencontainers.image.revision"
REPLAY_AGE = timedelta(hours=1)  # a replay removes its own container right after it exits (replay/seams.py)


class Docker:
    def __init__(self, run=subprocess.run):
        self.run = run

    def __call__(self, *args: str, check: bool = True) -> str:
        result = self.run(["docker", *args], capture_output=True, text=True, check=False)
        if check and result.returncode != 0:
            raise RuntimeError(f"docker {shlex.join(args)} failed: {result.stderr.strip()}")
        return result.stdout if result.returncode == 0 else ""

    def inspect(self, kind: str, ids: list[str]) -> list[dict]:
        return json.loads(self(kind, "inspect", *ids)) if ids else []


def read_env(path: Path) -> dict[str, str]:
    """KEY=VALUE lines of a compose env file, one level of quotes removed."""
    values = {}
    for line in path.read_text().splitlines():
        key, equals, value = line.partition("=")
        if equals and not key.lstrip().startswith("#"):
            value = value.strip()
            if len(value) > 1 and value[0] == value[-1] and value[0] in "\"'":
                value = value[1:-1]
            values[key.strip()] = value
    return values


def paper_busy(docker: Docker) -> list[str]:
    """What a restart of paper or docker-api would interrupt: running Paper runners and a comparison in paper."""
    busy = [f"Paper runner {name}" for name in docker(
        "ps", "--filter", "label=trade.paper.role=runner", "--format", "{{.Names}}").split()]
    papers = docker("ps", "-q", "--filter", f"label=com.docker.compose.project={PROJECT}",
                    "--filter", "label=com.docker.compose.service=paper").split()
    busy += ["a Paper comparison" for container in papers if "paper compare" in docker("top", container, check=False)]
    return busy


def services(docker: Docker) -> dict[str, dict]:
    """The project's containers by service: state, revision label, compose config hash and definition file."""
    ids = docker("ps", "-aq", "--filter", f"label=com.docker.compose.project={PROJECT}").split()
    found = {}
    for item in docker.inspect("container", ids):
        labels = item["Config"]["Labels"] or {}
        found[labels.get("com.docker.compose.service", item["Name"])] = {
            "state": item["State"]["Status"], "revision": labels.get(REVISION_LABEL), "hash": labels.get("com.docker.compose.config-hash"),
            "definition": labels.get("com.docker.compose.project.config_files")}
    return found


def relation(running: str | None, admitted: str, ancestor) -> str:
    if running == admitted:
        return "admitted"
    if running and ancestor(running, admitted):
        return "older"
    return "NOT IN THE ADMITTED VERSION"


def plan(hashes: dict[str, str], running: dict[str, dict]) -> dict[str, str]:
    """What `up -d` does to each service: compose recreates one whose hash differs and starts a stopped one."""
    def step(service: str, value: str) -> str:
        item = running.get(service)
        if item is None or item["hash"] != value:
            return "recreate"
        return "keep" if item["state"] == "running" else "start"

    return {service: step(service, value) for service, value in hashes.items()}


def report(running: dict[str, dict], admitted: str, ancestor, steps: dict[str, str] | None = None) -> list[str]:
    lines = []
    for service in SERVICES:
        item = running.get(service)
        if item is None:
            lines.append(f"{service}: not created")
            continue
        line = f"{service}: {item['state']}, revision {(item['revision'] or 'unlabelled')[:12]}"
        if service in VERSIONED:
            line += f" ({relation(item['revision'], admitted, ancestor)})"
        line += f", from {item['definition']}"
        if steps:
            line += f"; {steps.get(service, 'keep')}"
        lines.append(line)
    return lines


def compose(env: Path, definition: Path) -> list[str]:
    return ["compose", "-p", PROJECT, "--env-file", str(env.resolve()), "-f", str(definition.resolve())]


def hashes(docker: Docker, base: list[str]) -> dict[str, str]:
    pairs = (line.split() for line in docker(*base, "config", "--hash", "*").splitlines() if line.strip())
    return {pair[0]: pair[1] for pair in pairs if len(pair) == 2}


def stale_replays(docker: Docker, now: datetime) -> list[str]:
    """Replay stage containers exited over REPLAY_AGE ago: their replay is gone, or it would have removed them."""
    ids = docker("ps", "-aq", "--filter", "status=exited", "--filter", "label=trade.runtime.contract").split()
    stale = []
    for item in docker.inspect("container", ids):
        labels = item["Config"]["Labels"] or {}
        if not item["Name"].lstrip("/").startswith("replay-") or any(
                key.startswith(("com.docker.compose.", "trade.paper", "trade.live")) for key in labels):
            continue
        finished = datetime.fromisoformat(item["State"]["FinishedAt"].split(".")[0].removesuffix("Z")).replace(
            tzinfo=UTC)
        if now - finished > REPLAY_AGE:
            stale.append(item["Name"].lstrip("/"))
    return stale


def removable(images: list[dict], kept: set[str]) -> list[dict]:
    """This repository's images that no container runs and nothing kept names: untagged, or tagged only pr-N;
    and any other image with no name at all (dangling)."""
    out = []
    for image in images:
        names = [*image.get("RepoTags", []), *image.get("RepoDigests", [])]
        ours = all(name.startswith(REPOSITORIES) for name in names)  # true of a dangling image too
        # The containerd image store lists repo@digest names among RepoTags too: they are not tags.
        tags = [tag.rsplit(":", 1)[1] for tag in image.get("RepoTags", []) if "@" not in tag]
        if ours and image["Id"] not in kept and all(tag.startswith("pr-") for tag in tags):
            out.append(image)
    return out


def clean(docker: Docker, references: list[str], now: datetime, remove: bool = True) -> list[str]:
    """Remove (or with `remove` false, list) what nothing uses. Docker itself still refuses to remove an image any
    container uses (no --force)."""
    done = [f"container {name}" for name in stale_replays(docker, now)
            if not remove or docker("rm", "-v", name, check=False)]
    volumes = docker("volume", "ls", "-q", "--filter", "dangling=true",
                     "--filter", "label=com.docker.volume.anonymous").split()
    done += [f"volume {volume}" for volume in volumes if not remove or docker("volume", "rm", volume, check=False)]
    kept = {item["Image"] for item in docker.inspect("container", docker("ps", "-aq").split())}
    for reference in references:
        identity = docker("image", "inspect", "-f", "{{.Id}}", reference, check=False).strip()
        if identity:
            kept.add(identity)
    images = docker.inspect("image", sorted(set(docker("image", "ls", "-aq", "--no-trunc").split())))
    for image in removable(images, kept):
        names = sorted({*image.get("RepoTags", []), *image.get("RepoDigests", [])}) or [image["Id"]]
        if not remove or docker("image", "rm", *names, check=False):
            done.append(f"image {image['Id'][:19]} ({', '.join(names)})")
    return done


def kept_references(docker: Docker, base: list[str], values: dict[str, str]) -> list[str]:
    """The images an update never removes: the definition's, the env file's and the replay image `main` names."""
    return [*values.values(), *docker(*base, "config", "--images").split(), "ghcr.io/qoeop/trade-runtime:main"]


def main(argv: list[str] | None = None, docker: Docker | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env", required=True, type=Path, help="the compose env file (deploy/.env)")
    parser.add_argument("--revision", help="an admitted revision (default: the newest)")
    parser.add_argument("--channel", choices=tuple(CHANNELS), default="deploy",
                        help="deploy: the admitted versions (default); main: every checked main build, for staging")
    parser.add_argument("--arch", choices=("arm64", "amd64"), help="the Docker engine's CPU (default: this machine's)")
    parser.add_argument("--check", action="store_true", help="report the plan and each service's revision only")
    args = parser.parse_args(argv)
    docker = docker or Docker()
    if Path("/opt/trade-release").is_dir():
        raise RuntimeError("this is the release host: its release tick moves it (deploy/remote/README.md)")
    data = read_env(args.env).get("TRADE_DATA")
    if not data:
        raise RuntimeError(f"{args.env} names no TRADE_DATA (README.md here)")
    root = Path(data) / "deploy"
    busy = paper_busy(docker)
    if busy and not args.check:
        raise RuntimeError(f"Paper is not idle ({', '.join(busy)}); update once it is")
    architecture = architecture_of(args.arch)
    running = services(docker)
    with tempfile.TemporaryDirectory() as state:
        source, branch = channel_source(Path(state) / "source", args.channel)
        sha, values = resolve(source, Registry(), architecture, args.revision, branch)
        text = source.git("show", f"{sha}:deploy/compose.yaml", raw=True)
        known = {item["revision"] for item in running.values() if item["revision"]}
        ancestors = {revision: source.ancestor(revision, sha) for revision in known}
        print(f"Admitted on {branch}: {sha} ({architecture})", flush=True)
        if args.check:
            env = Path(state) / "env"
            env.write_text(args.env.read_text())
            write_env(env, values)
            definition = Path(state) / "compose.yaml"
            definition.write_text(text)
            steps = plan(hashes(docker, compose(env, definition)), running)
            print("\n".join(report(running, sha, lambda before, _after: ancestors.get(before, False), steps)))
            references = kept_references(docker, compose(env, definition), values)
            for line in clean(docker, references, datetime.now(UTC), remove=False):
                print(f"would remove {line}")
            if busy:
                print(f"Paper is not idle ({', '.join(busy)}): an update would refuse now")
            return 0

    def ancestor(before: str, _after: str) -> bool:
        return ancestors.get(before, False)

    target = root / sha
    target.mkdir(parents=True, exist_ok=True)
    write_file(target / "compose.yaml", text)
    write_file(target / "images.env", "".join(f"{key}={value}\n" for key, value in values.items()))
    write_env(args.env, values)
    base = compose(args.env, target / "compose.yaml")
    steps = plan(hashes(docker, base), running)
    print("\n".join(report(running, sha, ancestor, steps)), flush=True)
    docker(*base, "pull", "--quiet")
    docker(*base, "up", "-d")
    after, wanted = services(docker), hashes(docker, base)
    stale = [service for service, value in wanted.items() if after.get(service, {}).get("hash") != value]
    if stale:
        raise RuntimeError(f"{', '.join(stale)} did not take the definition {target / 'compose.yaml'}")
    current = root / "current"
    pending = root / "current.pending"
    pending.unlink(missing_ok=True)
    pending.symlink_to(sha)
    os.replace(pending, current)
    print("\n".join(report(after, sha, ancestor)))
    for line in clean(docker, kept_references(docker, base, values), datetime.now(UTC)):
        print(f"removed {line}")
    print(f"Definition: {current}/compose.yaml (env {args.env.resolve()})")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main(sys.argv[1:]))
    except Exception as error:
        print(f"update: {error}", file=sys.stderr, flush=True)
        raise SystemExit(1) from error
