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

Before `up -d`, a version whose code reads another ledger schema generation starts a new data generation here
(`Cutover`, deploy/generation.py).
"""

import argparse
from datetime import datetime, timedelta, UTC
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request

from . import generation
from .images import CHANNELS, architecture_of, channel_source, resolve, write_env, write_file
from .paper_host import DATABASES
from .release_host import Registry, printed_refusal


PROJECT = "trade-ide"
LEDGER = f"{PROJECT}-ledger-1"
NETWORK = f"{PROJECT}_default"
CONTROLLERS = f"{PROJECT}_trade-paper-controller"  # what ledger writes for Paper: its profiles and service file
TOKEN = "TRADE_DOLTHUB_TOKEN_FILE"  # optional: a DoltHub API token, with which an update creates a new repository
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

    def result(self, *args: str) -> subprocess.CompletedProcess:
        """The whole outcome, a failure included (its stderr holds a product refusal)."""
        return self.run(["docker", *args], capture_output=True, text=True, check=False)


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


def create_repository(origin: str, token: Path, opener=urllib.request.urlopen) -> None:
    """Create DoltHub repository `origin`, empty and public, with the API token in file `token` (read here only,
    never printed). Without the file the update stops before it changes anything and names the repository."""
    owner, name = origin.removeprefix(generation.HOST).split("/")
    if not token.is_file():
        raise RuntimeError(
            f"the new data generation's DoltHub repository {owner}/{name} does not exist. Create it, empty and public, "
            f"on dolthub.com, or put a DoltHub API token in {token} ({TOKEN} in the env file names another file) so "
            "an update creates it; then update again. Nothing was changed")
    body = json.dumps({"ownerName": owner, "repoName": name, "visibility": "public",
                       "description": "The public research ledger of one data generation"}).encode()
    request = urllib.request.Request(f"{generation.API}database", data=body, method="POST", headers={
        "authorization": f"token {token.read_text().strip()}", "Content-Type": "application/json",
        "User-Agent": "trade-deploy"})
    try:
        with opener(request, timeout=30):
            pass
    except urllib.error.HTTPError as error:
        error.close()
        raise RuntimeError(f"DoltHub refused to create {owner}/{name} (HTTP {error.code}); nothing was changed") \
            from None
    except OSError as error:
        raise RuntimeError(f"DoltHub did not answer ({type(error).__name__}); nothing was changed") from None
    print(f"Created the public DoltHub repository {owner}/{name}", flush=True)


class Cutover:
    """A new data generation on this workstation (deploy/generation.py; docs/plans/data-generation-in-release-
    20261123.zh.md): when the admitted version's own `ledger service check` refuses this ledger with SCHEMA_MISMATCH,
    publish what the old ledger holds, make sure its new DoltHub repository exists, stop the project, archive the
    ledger's data under $TRADE_DATA/archive/, start the ledger alone (its first start makes and publishes the new
    ledger, or clones the one already published), put market.json back and keep only this archive. The journal
    $TRADE_DATA/deploy/generation.json lets the next update finish an interrupted cutover from its step."""

    def __init__(self, docker: Docker, env: Path, data: Path, sha: str, service: str, opener=urllib.request.urlopen):
        self.docker, self.env, self.data, self.sha, self.service, self.opener = docker, env, data, sha, service, opener
        self.journal = data / "deploy" / generation.JOURNAL

    def pending(self) -> dict | None:
        """The journal of a cutover an earlier update left."""
        if not self.journal.exists():
            return None
        value = json.loads(self.journal.read_text())
        if (not isinstance(value, dict) or set(value) != {"revision", "archive", "phase"}
                or value["phase"] not in generation.PHASES[:2] or not generation.ARCHIVE_NAME.fullmatch(value["archive"])):
            raise RuntimeError(f"{self.journal} is not a cutover journal this version writes; left as it is")
        return value

    def unread(self, running: dict[str, dict]) -> dict[str, str]:
        """The databases this ledger holds that the version's code does not read (its schema generation, "" when
        the refusal names none). The check runs read-only in a container of the version's service image with
        Paper's profiles, as on the release host (deploy/paper_host.py generations)."""
        item = running.get("ledger")
        if item is None:
            return {}  # a first start: there is nothing to compare
        if item["state"] != "running":
            raise RuntimeError("the ledger is not running, so its schema generation cannot be compared with the "
                               f"version's; start it (docker start {LEDGER}) and update again")
        user = self.docker("inspect", "--format", "{{.Config.User}}", LEDGER).strip()
        self.docker("pull", "--quiet", self.service)
        found = {}
        for database in DATABASES:
            result = self.docker.result(
                "run", "--rm", "--init", "--read-only", "--tmpfs", "/tmp:rw,nosuid,size=16777216", "--user", user,
                "--network", NETWORK, "--env", "TRADE_DOLT_HOST=ledger", "--env",
                "TRADE_LEDGER_HOME=/run/trade/paper-profiles", "--env", "HOME=/tmp", "--mount",
                f"type=volume,src={CONTROLLERS},dst=/run/trade/paper-profiles,readonly", "--mount",
                f"type=volume,src={CONTROLLERS},dst={self.data / 'dolt'},readonly", self.service, "python", "-m",
                "cli.main", "ledger", "service", "check", "--ledger", database)
            if result.returncode:
                refusal = printed_refusal(result.stderr)
                if refusal is None or refusal["code"] != "SCHEMA_MISMATCH":
                    raise RuntimeError(f"the version's ledger check of {database} failed: {result.stderr[-400:]}")
                expected = refusal.get("expected")
                found[database] = expected if isinstance(expected, str) else ""
        return found

    def publish(self) -> str | None:
        """Push what the old ledger holds to its own DoltHub repository; the repository, or None when it failed."""
        result = self.docker.result("exec", LEDGER, "python", "-m", "cli.main", "ledger", "publish", "--ledger",
                                    "research")
        try:
            remote = json.loads(result.stdout).get("remote") if result.returncode == 0 else None
        except ValueError:
            remote = None
        if not isinstance(remote, str):
            print(f"update: the old ledger's publish failed: {result.stderr.strip()[-300:]}", flush=True)
            return None
        print(f"Published the old ledger to {remote}", flush=True)
        return remote

    def begin(self, found: dict[str, str], check: bool) -> dict | None:
        """Everything the cutover needs before it changes anything; its journal, or None with --check."""
        values = read_env(self.env)
        named = " and ".join(f"{database} (the version reads generation {expected or '?'})"
                             for database, expected in sorted(found.items()))
        print(f"Version {self.sha} does not read this ledger's {named}: it starts a new data generation", flush=True)
        if check:
            print("An update would publish the old ledger, archive it under "
                  f"{self.data / generation.ARCHIVE} and start the new generation's ledger")
            return None
        published = self.publish()
        if published is None and "research" not in found:
            raise RuntimeError("only the Paper database changes generation, and the research ledger is cloned again "
                               "from DoltHub, so what it has not published would be lost; nothing was changed")
        base = values.get("TRADE_RESEARCH_ORIGIN") or published
        if not base:
            raise RuntimeError(f"{self.env} names no TRADE_RESEARCH_ORIGIN and the old ledger published nowhere; set it "
                               "to the DoltHub repository the generations are named after; nothing was changed")
        if not values.get("TRADE_RESEARCH_ORIGIN"):
            write_env(self.env, {"TRADE_RESEARCH_ORIGIN": base})  # once: every generation is named after it
        wanted = generation.version(self.docker, self.service, base)
        state, held = generation.probe(wanted["origin"], self.opener)
        if state == "data" and held != str(wanted["research"]):
            raise RuntimeError(f"{wanted['origin']} holds a ledger of schema generation {held}, not "
                               f"{wanted['research']}; nothing was changed")
        if state == "absent":
            token = Path(values.get(TOKEN) or self.data / "dolthub-token")
            create_repository(wanted["origin"], token, self.opener)
        print(f"The new generation's ledger: {wanted['origin']}"
              + (" (cloned: it is already published)" if state == "data" else " (made and published here)"),
              flush=True)
        journal = {"revision": self.sha, "archive": generation.archive_name(self.sha), "phase": "archiving"}
        self.journal.parent.mkdir(parents=True, exist_ok=True)
        write_file(self.journal, json.dumps(journal) + "\n")
        return journal

    def run(self, journal: dict, base: list[str]) -> None:
        """The cutover from the journal's step; every step can run again after an interruption."""
        archive = self.data / generation.ARCHIVE / journal["archive"]
        if journal["phase"] == "archiving":
            self.docker(*base, "stop")
            self.docker("rm", "--force", LEDGER, check=False)  # it holds the volume
            volume = generation.VOLUME in self.docker("volume", "ls", "--format", "{{.Name}}").split()
            self.docker(*generation.archiver(self.data, journal["archive"], self.service, volume))
            if volume:
                self.docker("volume", "rm", generation.VOLUME)
            journal = {**journal, "phase": "archived"}
            write_file(self.journal, json.dumps(journal) + "\n")
            print(f"Archived the ledger's data in {archive}", flush=True)
        self.docker(*base, "pull", "--quiet")
        # The ledger alone first: its first start refuses a profile directory holding any profile, and the other
        # services read market.json, which goes back once it is up.
        self.docker(*base, "up", "--detach", "--wait", "--wait-timeout", "1800", "ledger")
        market = self.data / "ledgers" / "market.json"
        kept = archive / "ledgers" / "market.json"
        if kept.is_file() and not market.exists():
            shutil.copy2(kept, market)
        removed = self.docker(*generation.pruner(self.data, journal["archive"], self.service)).strip()
        self.journal.unlink()
        print(f"New data generation started; old data in {archive}"
              + (f"; removed older archives {removed}" if removed else ""), flush=True)


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
        cutover = Cutover(docker, args.env, Path(data), sha, values["TRADE_SERVICE_IMAGE"])
        pending = cutover.pending()
        found = {} if pending else cutover.unread(running)
        if args.check:
            if pending:
                print(f"A data generation cutover is pending at its {pending['phase']} step; an update finishes it")
            elif found:
                cutover.begin(found, check=True)
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
    journal = pending or (cutover.begin(found, check=False) if found else None)
    if journal is not None:
        cutover.run(journal, base)
        running = services(docker)
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
