"""A new data generation, started by the version that needs it (docs/plans/data-generation-in-release-20261123.zh.md).

A version whose ledger schema generations differ from what the host's ledger service holds (its own `ledger service
check` refuses with SCHEMA_MISMATCH) starts a new generation where it is deployed: the ledger's data is archived and the
ledger starts empty, so its first start makes (a workstation) or mirrors (the release host) that version's ledger. Its
DoltHub repository is `<TRADE_RESEARCH_ORIGIN>-g<N>` (ledger/publish.py research_origin), so no setting changes.

What both deployments share lives here: the version's own origin and generation (`version`), whether that DoltHub
repository holds its ledger (`probe`, through DoltHub's public SQL API, no credential), and the archive, run in a
container of the version's service image (`archiver`, `pruner`; `python -m deploy.generation`), since the release
service may not write the data directory itself. Archiving renames within `$TRADE_DATA` (one file system: `os.rename`
only, never a copy) into `$TRADE_DATA/archive/<UTC time>-<revision>/`. A workstation keeps the volume of Dolt's data
as a tgz (its writer ledger lives there); the release host removes its volume, a mirror of the old generation's DoltHub
repository that a clone gives back. Only the newest archive stays: the others go once the new generation runs. The
market directory has no generation and stays.

`Generation` is the release host's part (deploy/release.py Release.apply); deploy/update.py is the workstation's.
"""

from datetime import datetime, UTC
import json
import os
from pathlib import Path
import re
import shutil
import sys
import tarfile
import time
import urllib.error
import urllib.parse
import urllib.request

from .live_host import LiveBusy
from .release_host import (FOLLOW_WAIT_SECONDS, JOURNAL_FORMAT, LEDGER, MARKET_IMPORT, SERVICE_REF, WEB, durable_json,
                           read_journal, sync_directory)
from .services import PAPER_LISTING_SECONDS, Follow, images

ARCHIVE = "archive"  # $TRADE_DATA/archive/
ARCHIVE_NAME = re.compile(r"[0-9]{8}T[0-9]{6}Z-[0-9a-f]{12}\Z")  # only these are ever pruned
VOLUME = "trade-ide_trade-dolt-data"  # Dolt's data directory (deploy/compose.yaml trade-dolt-data)
VOLUME_TGZ = "trade-dolt-data.tgz"
# What the ledger service leaves in $TRADE_DATA, each into its own archive folder. `dolt/paper` itself stays (Paper's
# containers bind mount it), and so do the other folders: only what they hold moves.
MOVED = (("dolt", "dolt"), ("dolt/paper", "dolt-paper"), ("ledgers", "ledgers"), ("dolt-backups", "dolt-backups"))
JOURNAL = "generation.json"
# A cutover's steps: the data is being archived; it is archived and the ledger is being started; the new generation
# runs and older archives are being removed; done (kept until a version's Web release commits, deploy/release.py).
# The release host takes one step per tick, so a tick stays within trade-release.service's TimeoutStartSec.
PHASES = ("archiving", "archived", "started", "done")
# DoltHub's answers (2026-11-23, read from public repositories): a repository without the table or without a main
# branch holds no ledger yet; any other error is not an answer about the ledger.
NO_LEDGER = ("query error: table not found: ledger_schema", "query error: branch not found")
ARCHIVE_SECONDS = 600  # the release host's archive only renames
API = "https://www.dolthub.com/api/v1alpha1/"
HOST = "https://doltremoteapi.dolthub.com/"
# Run in the version's service image: the repository and generations of that version's code.
ORIGIN = ("import json,sys\nfrom ledger import db, publish\nprint(json.dumps({'origin': publish.research_origin("
          "sys.argv[1]), 'research': db.SCHEMA_VERSION, 'paper': db.PAPER_SCHEMA_VERSION}))")
MOUNTED = "/run/trade/dolt-data"  # where the archive container mounts VOLUME


class OriginUnreadable(RuntimeError):
    """DoltHub's API did not answer about a repository."""


def archive_name(sha: str, now: datetime | None = None) -> str:
    return f"{(now or datetime.now(UTC)):%Y%m%dT%H%M%SZ}-{sha[:12]}"


def version(docker, service: str, base: str) -> dict:
    """The DoltHub repository the version of service image `service` uses for `base` and its two schema generations,
    from its own code (`docker(*args)` returns what the command printed)."""
    value = json.loads(docker("run", "--rm", "--network", "none", "--read-only", "--entrypoint", "python", service,
                              "-c", ORIGIN, base))
    if not isinstance(value.get("origin"), str) or not value["origin"].startswith(HOST):
        raise RuntimeError("TRADE_RESEARCH_ORIGIN does not name a DoltHub repository")
    return value


def probe(origin: str, opener=urllib.request.urlopen) -> tuple[str, str | None]:
    """Whether DoltHub repository `origin` holds a research ledger on main: ("data", its schema version), ("empty",
    None) when it exists without one, or ("absent", None). Public repositories answer without a credential. Only
    those explicit answers count: OriginUnreadable for any other (a wrong guess of "empty" would skip creating the
    repository, and the ledger's first start would fail)."""
    query = urllib.parse.quote("SELECT version FROM ledger_schema WHERE singleton = 1")
    request = urllib.request.Request(f"{API}{origin.removeprefix(HOST)}/main?q={query}",
                                     headers={"User-Agent": "trade-deploy"})
    try:
        with opener(request, timeout=30) as response:
            value = json.load(response)
    except urllib.error.HTTPError as error:
        try:
            value = json.load(error)
        except ValueError:
            raise OriginUnreadable(f"DoltHub answered HTTP {error.code}") from None
        finally:
            error.close()
    except (OSError, ValueError) as error:
        raise OriginUnreadable(f"DoltHub did not answer ({type(error).__name__})") from None
    if not isinstance(value, dict):
        raise OriginUnreadable("DoltHub's answer is not an object")
    status, message, rows = (value.get("query_execution_status"), value.get("query_execution_message"),
                             value.get("rows"))
    if (status == "Success" and isinstance(rows, list) and len(rows) == 1 and isinstance(rows[0], dict)
            and isinstance(rows[0].get("version"), (str, int))):
        return "data", str(rows[0]["version"])
    if status == "Error" and message == "no such repository":
        return "absent", None
    if status == "Error" and message in NO_LEDGER:
        return "empty", None
    raise OriginUnreadable(f"DoltHub answered {str(status)[:40]}: {str(message)[:200]}")


def archiver(data: Path, name: str, service: str, volume: bool) -> list[str]:
    """`docker` arguments that archive the ledger service's data under `data` into archive `name`, with root's read
    and write of any owner's files and nothing else, no network, from the version's own code."""
    return ["run", "--rm", "--network", "none", "--user", "0:0", "--cap-drop", "ALL", "--cap-add", "DAC_OVERRIDE",
            "--security-opt", "no-new-privileges:true", "--mount", f"type=bind,src={data},dst={data}",
            *(("--mount", f"type=volume,src={VOLUME},dst={MOUNTED},readonly") if volume else ()),
            "--workdir", "/opt/trade", "--entrypoint", "python", service, "-m", "deploy.generation", "archive",
            str(data), name, *((MOUNTED,) if volume else ())]


def pruner(data: Path, name: str, service: str) -> list[str]:
    """`docker` arguments that remove every archive but `name`."""
    return ["run", "--rm", "--network", "none", "--user", "0:0", "--cap-drop", "ALL", "--cap-add", "DAC_OVERRIDE",
            "--security-opt", "no-new-privileges:true", "--mount", f"type=bind,src={data / ARCHIVE},dst={data / ARCHIVE}",
            "--workdir", "/opt/trade", "--entrypoint", "python", service, "-m", "deploy.generation", "prune", str(data),
            name]


def archive(data: Path, name: str, volume: Path | None = None) -> None:
    """Move what MOVED names into `data/archive/name`, by rename only; first the volume's files as one tgz (written
    under a partial name, then renamed). Every step can run again after an interruption."""
    target = data / ARCHIVE / name
    target.mkdir(mode=0o700, parents=True, exist_ok=True)
    for _, folder in MOVED:
        (target / folder).mkdir(mode=0o700, exist_ok=True)
    if volume is not None and not (target / VOLUME_TGZ).exists():
        partial = target / (VOLUME_TGZ + ".partial")
        with tarfile.open(partial, "w:gz") as out:
            out.add(volume, arcname=".")
        os.replace(partial, target / VOLUME_TGZ)
    device = target.stat().st_dev
    for source, folder in MOVED:
        origin = data / source
        if not origin.is_dir():
            continue
        for child in sorted(origin.iterdir()):
            if source == "dolt" and child.name == "paper":
                continue
            if child.lstat().st_dev != device:
                raise SystemExit(f"{child} is on another file system than {target}; nothing more was moved")
            os.rename(child, target / folder / child.name)


def prune(data: Path, name: str) -> list[str]:
    """Remove every archive this code named (ARCHIVE_NAME) but `name`; the names removed."""
    removed: list[str] = []
    if not (data / ARCHIVE).is_dir():
        return removed
    for path in sorted((data / ARCHIVE).iterdir()):
        if path.name != name and ARCHIVE_NAME.fullmatch(path.name) and path.is_dir() and not path.is_symlink():
            shutil.rmtree(path)
            removed.append(path.name)
    return removed


class Generation:
    """The release host's cutover (deploy/release.py Release.apply). It waits, with one notice, until the new
    generation's public copy holds that version's ledger (a workstation published it), no Paper runner runs, no
    Paper operation is in progress and Live is idle inside its account lock; then, with Paper's writes paused, it
    stops the ledger and market import and archives. Each later tick takes the next step from its journal (JOURNAL
    in the release state) before anything else: start both from the version's own definition and check that the
    version reads the new ledger; then remove older archives. The release itself follows on the tick after."""

    def __init__(self, release):
        self.release, self.host = release, release.host
        self.journal = self.host.state / JOURNAL

    def read(self) -> dict | None:
        if not self.journal.exists():
            return None
        value = read_journal(self.journal, frozenset({"revision", "service", "archive", "phase", "market"}))
        if value["phase"] not in PHASES or not ARCHIVE_NAME.fullmatch(value["archive"]):
            raise RuntimeError(JOURNAL_FORMAT)
        return value

    def write(self, value: dict) -> dict:
        durable_json(self.journal, value)
        return value

    def done(self) -> bool:
        """The host holds a new generation that the routed version may not read: a rollback cannot check it."""
        try:
            value = self.read()
        except RuntimeError:
            return False
        return value is not None and value["phase"] in ("started", "done")

    def finish(self) -> None:
        """After a Web release committed on the new generation."""
        if self.done():
            self.journal.unlink()
            sync_directory(self.host.state)

    def runners(self) -> list[str]:
        return self.host.docker("ps", "--filter", "label=trade.paper.role=runner", "--format", "{{.Names}}").split()

    def wait(self, sha: str, reason: str, text: str) -> None:
        print(f"Version {sha} waits for its new data generation: {text}", flush=True)
        self.release.waits[f"wait:generation:{sha}:{reason}"] = (
            f"Version {sha[:12]} starts a new data generation on this host and waits: {text} Nothing was changed or "
            "marked failed; every tick checks again (deploy/remote/README.md, A version that starts a new data "
            "generation).")

    def due(self, target: dict, owner: str) -> bool:
        """Whether version `target` reads another schema generation than the host's ledger service holds; if so it
        cuts over when it may, and the release waits for the next tick either way."""
        found = self.release.paper().host.generations(target["service"])
        if not found:
            return False
        named = " and ".join(f"{database} (it reads generation {generation or '?'})"
                             for database, generation in sorted(found.items()))
        print(f"Version {target['revision']} does not read the host's {named}", flush=True)
        self.cut(target, owner)
        return True

    def cut(self, target: dict, owner: str) -> None:
        sha, service = target["revision"], target["service"]
        base = self.host.config.research_origin
        if not base:
            self.wait(sha, "origin", "/etc/trade/remote.env names no TRADE_RESEARCH_ORIGIN, the DoltHub repository "
                                     "whose generations this host mirrors.")
            return
        wanted = version(self.host.docker, service, base)
        if busy := self.runners():
            self.wait(sha, "paper", f"{len(busy)} Paper run(s) still run ({', '.join(busy)}); their containers mount "
                                    "the Paper directory the cutover archives. Stop them on the Paper page.")
            return
        try:
            state, held = probe(wanted["origin"])
        except OriginUnreadable as error:
            self.wait(sha, "dolthub", f"{error} about {wanted['origin']}.")
            return
        if state != "data" or held != str(wanted["research"]):
            self.wait(sha, "published", f"its public ledger {wanted['origin']} holds no generation "
                                        f"{wanted['research']} ledger yet. A workstation's deploy/update.sh makes and "
                                        "publishes it.")
            return
        self.release.github.ensure(target)
        self.release.live.prepare(owner, target)

        def start(held_lock) -> None:
            market = "running" if self.host.follower(MARKET_IMPORT) is not None else "stopped"
            journal = self.write({"revision": sha, "service": service, "archive": archive_name(sha),
                                  "phase": "archiving", "market": market})
            print(f"Starting data generation {wanted['research']} from {wanted['origin']}; archiving into "
                  f"{self.host.config.data / ARCHIVE / journal['archive']}", flush=True)
            self.step(journal, held_lock)

        self.hold(sha, WEB + owner, WEB + sha, service, start)

    def hold(self, sha: str, owner: str, live: str, service: str | None, body) -> None:
        """Run `body(held)` with Paper's writes paused, no Paper operation or runner left and Live idle inside its
        account lock (`live` names the Web whose Live configuration inspects it); otherwise wait with a notice."""
        paper = self.release.paper().host
        controller = paper.disk_route()
        paper.switch(controller, "all")  # new Paper writes wait; normalize below, or recover() after a crash
        try:
            with paper.barrier(paper.inspect(controller)["image"]) as drained:
                drained()  # a lifecycle operation that passed before the freeze has finished
            time.sleep(PAPER_LISTING_SECONDS)
            if Follow(self.release, None).paper_quiet(owner) is None or self.runners():
                self.wait(sha, "paper", "a Paper operation is in progress.")
                return
            with self.release.live.barrier(live, service, idle=True) as held_lock:
                held_lock()
                body(held_lock)
        except LiveBusy as busy_live:
            self.wait(sha, "live", f"{busy_live}.")
        finally:
            paper.normalize()

    def resume(self, control: str) -> bool:
        """Take the next step of a cutover a tick left (its journal), before the tick recovers or releases anything:
        the ledger may be stopped and its data half moved. One step per tick; True when it took one or waited."""
        journal = self.read()
        if journal is None or journal["phase"] == "done":
            return False
        if journal["revision"] != control:  # a newer control took over: it starts its own version's ledger
            target = self.release.github.approved()
            if target["revision"] != control or target["service"] is None:
                raise RuntimeError("a data generation cutover is pending for another version; left for the operator")
            journal = self.write({**journal, "revision": control, "service": target["service"]})
        print(f"Continuing the data generation cutover from its {journal['phase']} step", flush=True)
        if journal["phase"] == "archiving":  # it stops services: the same hold as the first pass
            routed = self.host.disk_route()
            self.hold(journal["revision"], routed, routed, None, lambda held: self.step(journal, held))
        elif journal["phase"] == "archived":
            paper = self.release.paper().host
            paper.switch(paper.disk_route(), "all")
            try:
                self.step(journal, lambda: None)
            finally:
                paper.normalize()
        else:
            self.step(journal, lambda: None)
        return True

    def step(self, journal: dict, held) -> None:
        """One step of the cutover from the journal's phase; each can run again after an interruption."""
        sha, service, data = journal["revision"], journal["service"], self.host.config.data
        if journal["phase"] == "archiving":
            for name in (MARKET_IMPORT, LEDGER):
                if self.host.exists(name):
                    self.host.docker("stop", "--time", "60", name, timeout=180)
            if self.host.exists(LEDGER):
                self.host.docker("rm", LEDGER)  # it holds the volume
            held()
            self.host.docker(*archiver(data, journal["archive"], service, False), timeout=ARCHIVE_SECONDS)
            if VOLUME in self.host.docker("volume", "ls", "--format", "{{.Name}}").splitlines():
                self.host.docker("volume", "rm", VOLUME)  # a mirror: the old generation's repository holds it
            self.write({**journal, "phase": "archived"})
            print(f"Archived the ledger's data in {data / ARCHIVE / journal['archive']}; the next tick starts the "
                  "new generation's ledger", flush=True)
        elif journal["phase"] == "archived":
            files = self.host.definition(service, sha)
            env = images(self.release.github, {"revision": sha, "service": service})
            # Compose runs with --pull never, and a settled tick's prune removes service images no container uses:
            # the admitted image read at the handover may be gone by now.
            self.host.pull(service, SERVICE_REF, sha)
            # No --force-recreate: a ledger a resumed cutover finds already started is waited for, never restarted
            # in the middle of its first start.
            self.host.compose(files, "up", "--detach", "--no-deps", "--pull", "never", "--wait", "--wait-timeout",
                              str(FOLLOW_WAIT_SECONDS), "ledger", env=env, timeout=FOLLOW_WAIT_SECONDS + 180)
            if journal["market"] == "running":
                self.host.compose(files, "up", "--detach", "--no-deps", "--pull", "never", "market-import", env=env)
            if self.release.paper().host.generations(service):
                raise RuntimeError("the new data generation's ledger is not the version's schema generation")
            self.write({**journal, "phase": "started"})
            print(f"Data generation started for {sha}; the next tick removes older archives", flush=True)
        elif journal["phase"] == "started":
            removed = self.host.docker(*pruner(data, journal["archive"], service), timeout=1800)
            self.write({**journal, "phase": "done"})
            print(f"Data generation cutover done; archived in {data / ARCHIVE / journal['archive']}"
                  + (f", removed older archives {removed}" if removed else ""), flush=True)


def main(argv: list[str]) -> None:
    """Inside the version's service image (archiver, pruner): `archive DATA NAME [VOLUME]` or `prune DATA NAME`."""
    if len(argv) >= 3 and not ARCHIVE_NAME.fullmatch(argv[2]):
        raise SystemExit(f"{argv[2]} is not an archive name")
    if len(argv) in (3, 4) and argv[0] == "archive":
        archive(Path(argv[1]), argv[2], Path(argv[3]) if len(argv) == 4 else None)
    elif len(argv) == 3 and argv[0] == "prune":
        print(" ".join(prune(Path(argv[1]), argv[2])))
    else:
        raise SystemExit("usage: python -m deploy.generation archive DATA NAME [VOLUME] | prune DATA NAME")


if __name__ == "__main__":
    main(sys.argv[1:])
