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

Before `up -d`, a version of a later line than this ledger starts a new data generation here (`Cutover`,
deploy/generation.py); the first 0.5.4 update moves the v0.5 ledger, which 0.5.3 published as the research
repository's branch `v0.5`, onto its `main` (ledger/publish.py onto_main).
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
import time
import urllib.request

from . import generation
from .images import CHANNELS, architecture_of, channel_source, resolve, write_env, write_file
from .paper_host import DATABASES
from .release_host import Registry, printed_refusal


PROJECT = "trade-ide"
LEDGER = f"{PROJECT}-ledger-1"
NETWORK = f"{PROJECT}_default"
CONTROLLERS = f"{PROJECT}_trade-paper-controller"  # what ledger writes for Paper: its profiles and service file
SERVICES = ("ide", "ledger", "market-import", "paper", "docker-api")
VERSIONED = ("ide", "ledger", "market-import", "paper")  # docker-api moves with its pin, not the revision
REPOSITORIES = tuple(f"ghcr.io/qoeop/trade-{name}" for name in ("ide", "service", "runtime", "docker-api"))
REVISION_LABEL = "org.opencontainers.image.revision"
REPLAY_AGE = timedelta(hours=1)  # a replay removes its own container right after it exits (replay/seams.py)
# Run in the ledger's container: what its first start's port answers (ledger/first_run.py; compose.yaml --setup).
FIRST_START = ("import http.client, json\nc = http.client.HTTPConnection('ledger', 8770, timeout=10)\n"
               "c.request('GET', '/api/setup/')\nprint(json.load(c.getresponse())['state'])")
MOVE_SECONDS, MOVE_POLL = 1800, 20  # how long a wait for the ledger lasts, and how often it looks
PORT_SECONDS = 60  # how long a ledger container just started may take to open its first-start port or be healthy


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


class Cutover:
    """A new data generation on this workstation (deploy/generation.py; docs/plans/data-generation-in-release-
    20261123.zh.md, docs/plans/main-is-the-ledger-in-use-20261123.zh.md): when the admitted version is of a later line
    than this ledger, publish what the old ledger holds, check the research repository, stop every other service and
    publish again, stop the ledger, archive its data under $TRADE_DATA/archive/, start the ledger alone (its first
    start archives the repository's `main` as the old line's branch and puts the new line's ledger on `main`, or
    fetches the one already there), put market.json back and keep only this archive. The journal
    $TRADE_DATA/deploy/generation.json lets the next update finish an interrupted cutover from its step. A move
    (deploy/generation.py) publishes the old ledger, then starts the version's ledger, whose publish moves it onto
    `main`, and waits until it tracks `main`."""

    def __init__(self, docker: Docker, env: Path, data: Path, sha: str, service: str, opener=urllib.request.urlopen,
                 sleep=time.sleep, clock=time.monotonic):
        self.docker, self.env, self.data, self.sha, self.service, self.opener = docker, env, data, sha, service, opener
        self.sleep, self.clock = sleep, clock
        self.journal = data / "deploy" / generation.JOURNAL
        self.wanted: dict = {}
        self.user = ""
        self.line: str | None = None  # the line of this ledger

    def pending(self) -> dict | None:
        """The journal of a cutover an earlier update left."""
        if not self.journal.exists():
            return None
        value = json.loads(self.journal.read_text())
        if (not isinstance(value, dict) or set(value) != {"revision", "line", "archive", "phase", "market"}
                or value["phase"] not in generation.PHASES[:2] or not generation.ARCHIVE_NAME.fullmatch(value["archive"])
                or not isinstance(value["line"], str) or not generation.LINE.fullmatch(value["line"])):
            raise RuntimeError(f"{self.journal} is not a cutover journal this version writes; left as it is")
        self.docker("pull", "--quiet", self.service)
        line = generation.version(self.docker, self.service, read_env(self.env).get("TRADE_RESEARCH_ORIGIN") or "")[
            "line"]
        if line != value["line"]:  # its archive is that line's ledger, which this version would not start
            raise RuntimeError(f"a data generation cutover to {value['line']} is pending, but version {self.sha} "
                               f"publishes its ledger as {line}; update to a version of {value['line']} to finish it")
        return value

    def reading(self, user: str) -> list[str]:
        """`docker run` arguments of a read-only container of the version's service image with Paper's profiles (the
        research reader among them), as on the release host (deploy/paper_host.py generations)."""
        return ["run", "--rm", "--init", "--read-only", "--tmpfs", "/tmp:rw,nosuid,size=16777216", "--user", user,
                "--network", NETWORK, "--env", "TRADE_DOLT_HOST=ledger", "--env",
                "TRADE_LEDGER_HOME=/run/trade/paper-profiles", "--env", "HOME=/tmp", "--mount",
                f"type=volume,src={CONTROLLERS},dst=/run/trade/paper-profiles,readonly", "--mount",
                f"type=volume,src={CONTROLLERS},dst={self.data / 'dolt'},readonly"]

    def assess(self, running: dict[str, dict], check: bool = False) -> tuple[dict[str, str], str]:
        """What the version does with this ledger (generation.place: "same", "cutover" or "move"; "first" without
        one) and the databases its code does not read (their schema generation, "" when the refusal names none). Both
        are read by the version's own code, read-only, in containers of its service image."""
        item = running.get("ledger")
        if item is None:
            if (self.data / "dolt" / "service.json").exists():  # only whether it exists: it holds passwords
                raise RuntimeError(f"the ledger has data ({self.data / 'dolt'}) but no container, so its line cannot "
                                   "be compared with the version's; start it (docker compose up -d ledger with the "
                                   "current definition) and update again")
            return {}, "first"  # a first start: there is nothing to compare
        if item["state"] != "running":
            raise RuntimeError("the ledger is not running, so its line cannot be compared with the version's; start "
                               f"it (docker start {LEDGER}) and update again")
        user = self.user = self.docker("inspect", "--format", "{{.Config.User}}", LEDGER).strip()
        self.docker("pull", "--quiet", self.service)
        named = read_env(self.env).get("TRADE_RESEARCH_ORIGIN")
        # Unnamed: the repository the ledger publishes to; named below once checked.
        base = named or self.where(user).get("remote") or ""
        if not base:
            raise RuntimeError(f"{self.env} names no TRADE_RESEARCH_ORIGIN and the ledger publishes nowhere; name the "
                               "DoltHub repository of the research ledger there and update again")
        self.wanted = generation.version(self.docker, self.service, base)
        found = {}
        for database in DATABASES:
            result = self.docker.result(*self.reading(user), self.service, "python", "-m", "cli.main", "ledger",
                                        "service", "check", "--ledger", database)
            if result.returncode:
                refusal = printed_refusal(result.stderr)
                if refusal is None or refusal["code"] != "SCHEMA_MISMATCH":
                    raise RuntimeError(f"the version's ledger check of {database} failed: {result.stderr[-400:]}")
                expected = refusal.get("expected")
                found[database] = expected if isinstance(expected, str) else ""
        where = self.where(user)
        how = generation.place(where, self.wanted)
        if how == "unpublished" and check:
            print("The ledger has not published to main yet: an update publishes it")
        elif how == "unpublished":
            self.publish()
            where = self.where(user)
            how = generation.place(where, self.wanted)
            if how == "unpublished":
                raise RuntimeError("the ledger has not published to main; publish it (`ledger publish`) and update "
                                   "again")
        self.line = where.get("line")
        if found and how != "cutover":
            raise RuntimeError(f"version {self.sha} reads another schema generation of {' and '.join(sorted(found))} "
                               f"within this ledger's line {self.wanted['line']}; a schema change needs a new line (a "
                               "new minor version before 1.0). Nothing was changed")
        if not named and not check:
            write_env(self.env, {"TRADE_RESEARCH_ORIGIN": base})  # once: every line is a branch of it
        return found, how

    def where(self, user: str) -> dict:
        """Where the ledger publishes (ledger/publish.py where), read by the version's own code."""
        result = self.docker.result(*self.reading(user), "--entrypoint", "python", self.service, "-c",
                                    generation.WHERE)
        try:
            value = json.loads(result.stdout) if result.returncode == 0 else None
        except ValueError:
            value = None
        if not isinstance(value, dict):
            raise RuntimeError(f"the ledger did not say where it publishes: {result.stderr.strip()[-300:]}")
        return value

    def publish(self) -> str | None:
        """Push what the ledger holds to its repository; the repository, or None when it failed."""
        result = self.docker.result("exec", LEDGER, "python", "-m", "cli.main", "ledger", "publish", "--ledger",
                                    "research")
        try:
            remote = json.loads(result.stdout).get("remote") if result.returncode == 0 else None
        except ValueError:
            remote = None
        if not isinstance(remote, str):
            print(f"update: the ledger's publish failed: {result.stderr.strip()[-300:]}", flush=True)
            return None
        print(f"Published the ledger to {remote}", flush=True)
        return remote

    def healthy(self) -> None:
        """Start the stopped ledger container as it is and wait until its health check passes."""
        self.docker("start", LEDGER)
        deadline = self.clock() + MOVE_SECONDS
        while self.docker("inspect", "--format", "{{.State.Health.Status}}", LEDGER).strip() != "healthy":
            if self.clock() > deadline:
                raise RuntimeError(f"the old ledger did not answer healthy within {MOVE_SECONDS} s of its start, so it "
                                   "cannot publish before the cutover; look at its log and update again")
            self.sleep(MOVE_POLL)

    def settle_first_start(self) -> None:
        """Before the `up` that follows: wait for a first start under way to end, since `up` recreates the container of
        another definition (a new version, a changed env file) and could kill it between its steps; then stop a ledger
        whose first start failed, for `up` to start it again: it runs on and waits for the IDE's page, which the
        cutover stopped. A ledger that serves (no first-start port) goes on to `up` as it is."""
        begun, seen = self.clock(), False
        while True:
            answer = self.docker.result("exec", LEDGER, "python", "-c", FIRST_START)
            state = answer.stdout.strip() if answer.returncode == 0 else ""
            if state in ("waiting", "blocked", "done"):
                break
            # An unanswered look says nothing while the container is short of healthy: one under way missed it, or the
            # container just started and its port is not open yet (a serving ledger is healthy well within PORT_SECONDS).
            if not state and not ((seen or self.clock() - begun < PORT_SECONDS) and self.docker(
                    "inspect", "--format", "{{.State.Health.Status}}", LEDGER, check=False).strip() == "starting"):
                break
            if self.clock() - begun >= MOVE_SECONDS:
                raise RuntimeError(f"the ledger's first start is still under way after {MOVE_SECONDS} s, and replacing "
                                   f"its container could kill it between its steps; follow its log (docker logs "
                                   f"--follow {LEDGER}) and update again once it ends (the cutover resumes here). One that is "
                                   f"stuck: docker stop --time 600 {LEDGER} lets it clean up, then update again")
            if state and not seen:
                print(f"The ledger's first start is under way; waiting up to {MOVE_SECONDS} s for it to end", flush=True)
            seen = seen or bool(state)
            self.sleep(MOVE_POLL)
        if state in ("waiting", "blocked"):
            print("The ledger's first start failed before (its log says why); starting it again", flush=True)
            self.docker("stop", LEDGER)

    def move(self, check: bool) -> None:
        """Before anything changes: publish what the old ledger holds to the branch it tracks (`v0.5` under 0.5.3)."""
        print(f"Version {self.sha} moves this ledger onto main of {self.wanted['origin']}", flush=True)
        if check:
            print("An update would publish the ledger, start the version's ledger and publish it: the repository's "
                  "main (the previous generation) goes to the branch v0.4, the ledger onto main, and "
                  f"{generation.MOVED_LINE} is deleted once main holds its head")
            return
        if self.publish() is None:
            raise RuntimeError("the ledger's publish failed, so its public copy may lack what this ledger holds; fix "
                               "the publish (the ledger's log, `ledger publish`) and update again; nothing was "
                               "changed")

    def moved(self, base: list[str]) -> None:
        """Start the version's ledger and publish it (its publish moves it onto main, ledger/publish.py onto_main),
        then wait until it tracks only main and reads its line there: a publish round of the ledger may hold the
        move when this publish asks."""
        self.docker(*base, "up", "--detach", "--wait", "--wait-timeout", "1800", "ledger")
        self.publish()
        deadline = self.clock() + MOVE_SECONDS
        while True:
            where = self.where(self.user)
            if where.get("tracked") == [generation.MAIN] and where.get("line") == self.wanted["line"]:
                break
            if self.clock() >= deadline:
                raise RuntimeError(f"after {MOVE_SECONDS} s the ledger tracks {', '.join(where.get('tracked') or [])} "
                                   f"and reads line {where.get('line')}, so it is not on main yet; its publish rounds "
                                   "retry (the ledger's log), and the next update checks again")
            self.sleep(MOVE_POLL)
        print(f"The ledger now publishes on main of {self.wanted['origin']} (line {self.wanted['line']})", flush=True)

    def begin(self, found: dict[str, str], check: bool) -> dict | None:
        """Everything the cutover needs before it changes anything; its journal, or None with --check."""
        line = self.wanted["line"]
        named = "".join(f"; it does not read this ledger's {database} (the version reads generation {expected or '?'})"
                        for database, expected in sorted(found.items()))
        print(f"Version {self.sha} publishes a ledger of line {line}{named}: it starts a new data generation",
              flush=True)
        if check:
            print("An update would publish the old ledger, archive it under "
                  f"{self.data / generation.ARCHIVE} and start the line's ledger")
            return None
        if self.publish() is None:
            # The old line's public copy must hold all of it before its local copy is archived and, a generation
            # later, removed.
            raise RuntimeError("the old ledger's publish failed, so its public copy may lack what this ledger holds; "
                               "fix the publish (the ledger's log, `ledger publish`) and update again; nothing was "
                               "changed")
        origin = self.wanted["origin"]
        state, held, main = generation.probe(origin, generation.MAIN, self.opener)
        if state == "absent":
            raise RuntimeError(f"the research repository {origin.removeprefix(generation.HOST)} does not exist on "
                               "DoltHub; create it once on dolthub.com (public), then update again; nothing was "
                               "changed")
        if state == "other":
            raise RuntimeError(f"main of {origin} holds no research ledger, so the line's ledger cannot start there; "
                               "nothing was changed. Report it: that branch is the owner's to look at")
        if state == "data" and main == line and held != str(self.wanted["research"]):
            raise RuntimeError(f"main of {origin} holds a ledger of line {line} and schema generation {held}, not "
                               f"{self.wanted['research']}; nothing was changed")
        if state == "data" and main not in (line, self.line):
            raise RuntimeError(f"main of {origin} holds a ledger of line {main or 'unknown (no line tag)'}, neither "
                               f"this ledger's {self.line} nor the version's {line}; nothing was changed. Report it: "
                               "that branch is the owner's to look at")
        print(f"The line's ledger on main of {origin}: "
              + ("fetched (it is already there)" if main == line else
                 f"made here; the ledger of line {main} on main goes to the branch {main} first" if state == "data"
                 else "made and published here"), flush=True)
        market = self.data / "ledgers" / "market.json"
        # Kept here: the archive is root's, which this user may not read.
        journal = {"revision": self.sha, "line": line, "archive": generation.archive_name(self.sha),
                   "phase": "archiving", "market": market.read_text() if market.exists() else None}
        self.journal.parent.mkdir(parents=True, exist_ok=True)
        write_file(self.journal, json.dumps(journal) + "\n")
        return journal

    def run(self, journal: dict, base: list[str]) -> None:
        """The cutover from the journal's step; every step can run again after an interruption."""
        archive = self.data / generation.ARCHIVE / journal["archive"]
        if journal["phase"] == "archiving":
            # Nothing else writes the ledger once the other services stop: publish what it holds then, since its new
            # line's first start replaces main with the new ledger. A ledger container that is gone was removed here
            # after that; one that stopped (here, or since an interruption) starts again to publish first.
            self.docker(*base, "stop", *(service for service in SERVICES if service != "ledger"))
            state = services(self.docker).get("ledger", {}).get("state")
            if state is not None and state != "running":
                self.healthy()
            if state is not None and self.publish() is None:
                raise RuntimeError("the old ledger's publish after the other services stopped failed, so main may lack "
                                   "what it holds; fix the publish and update again (the cutover resumes here)")
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
        self.settle_first_start()
        self.docker(*base, "up", "--detach", "--wait", "--wait-timeout", "1800", "ledger")
        # Compose's `--wait` can time out and still exit 0 on a health check that never passed.
        health = self.docker("inspect", "--format", "{{if .State.Health}}{{.State.Health.Status}}{{end}}",
                             LEDGER).strip()
        if health not in ("", "healthy"):
            raise RuntimeError(f"the line's ledger is {health} after its wait, so its first start is not done; look at "
                               "its log and update again (the cutover resumes here)")
        market = self.data / "ledgers" / "market.json"
        if journal["market"] is not None and not market.exists():
            write_file(market, journal["market"])
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
        found, how = ({}, "pending") if pending else cutover.assess(running, args.check)
        if args.check:
            if pending:
                print(f"A data generation cutover is pending at its {pending['phase']} step; an update finishes it")
            elif how == "cutover":
                cutover.begin(found, check=True)
            elif how == "move":
                cutover.move(check=True)
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

    # Everything a cutover checks comes before the first write: a refusal leaves the env file naming the old images.
    journal = pending or (cutover.begin(found, check=False) if how == "cutover" else None)
    if how == "move":
        cutover.move(check=False)
    target = root / sha
    target.mkdir(parents=True, exist_ok=True)
    write_file(target / "compose.yaml", text)
    write_file(target / "images.env", "".join(f"{key}={value}\n" for key, value in values.items()))
    write_env(args.env, values)
    base = compose(args.env, target / "compose.yaml")
    if journal is not None:
        cutover.run(journal, base)
        running = services(docker)
    elif how == "move":
        cutover.moved(base)
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
    staged = root / "current.pending"
    staged.unlink(missing_ok=True)
    staged.symlink_to(sha)
    os.replace(staged, current)
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
