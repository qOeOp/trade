"""A new data generation, started by the version whose line needs it (docs/plans/data-generation-in-release-20261123.zh.md,
docs/plans/main-is-the-ledger-in-use-20261123.zh.md).

The research repository's (TRADE_RESEARCH_ORIGIN) `main` holds the ledger in use; a line (`v0.<minor>` before 1.0,
`v<major>` from 1.0; ledger/publish.py LINE) is one ledger, named by the tag `line/<line>` on its first commit. A
version of a later line than the host's ledger starts a new generation where it is deployed, even when its schema did
not change: the ledger's data is archived and the ledger starts empty. On a workstation its first start pushes the
repository's `main` to the branch named after the old line, checks it, and puts the new line's ledger on `main` in its
place; the release host waits until `main` holds the new line's ledger and the old line's branch its mirror's head,
then mirrors `main`. A schema change within a line is refused (the release workflow never lets one be released).

What both deployments share lives here: the version's own line and generations (`version`), where the host's ledger
publishes and which line it is on (`WHERE`, read in a container of the version's image), what to do about it
(`place`), which ledger a branch of the repository holds and whether it holds a commit (`probe`, `contains`, through
DoltHub's public SQL API, no credential), and the archive, run in a container of the version's service image
(`archiver`, `pruner`; `python -m deploy.generation`), since the release service may not write the data directory
itself. Archiving renames within `$TRADE_DATA` (one file system: `os.rename` only, never a copy) into
`$TRADE_DATA/archive/<UTC time>-<revision>/`. Both keep the volume of Dolt's data as a tgz before they remove it: a
workstation all of it (its writer ledger lives there), the release host all but the research mirror, which a fetch of
the old line's branch gives back; the Paper database in that volume has no other copy but its backup. Only the newest
archive stays: the others go once the new generation runs. The market directory has no generation and stays.

`move` is the one-time move of the v0.5 ledger, which 0.5.3 published as the repository's branch `v0.5`, onto
`main`: a workstation's ledger does it at its first publish under 0.5.4 (ledger/publish.py onto_main); the release
host's mirror follows once `main` holds its head (a 0.5.4 mirror tracks only `main`). To be removed in the next line.

`Generation` is the release host's part (deploy/release.py Release.apply); deploy/update.py is the workstation's.
"""

from collections.abc import Callable
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
# runs and older archives are being removed; done (kept until a version that reads it is routed, deploy/release.py).
# The release host takes one step per tick, so a tick stays within trade-release.service's TimeoutStartSec. A move
# starts at "archived" (nothing is archived) and removes no archive.
PHASES = ("archiving", "archived", "started", "done")
KINDS = ("cutover", "move")
# DoltHub's answers (2026-11-23, read from public repositories): no such branch holds no ledger yet; a branch without
# the table holds something else; any other error is not an answer about the ledger.
NO_BRANCH = "query error: branch not found"
NO_TABLE = "query error: table not found: ledger_schema"
ARCHIVE_SECONDS = 600  # the release host's archive renames and packs the Paper database
API = "https://www.dolthub.com/api/v1alpha1/"
HOST = "https://doltremoteapi.dolthub.com/"
REPOSITORY = re.compile(re.escape(HOST) + r"[A-Za-z0-9_-]+/[A-Za-z0-9_-]+\Z")
LINE = re.compile(r"v(?:0\.([0-9]+)|([1-9][0-9]*))\Z")  # shared/version.py LINE (this module is stdlib only)
TAG = "line/"  # a ledger's line tag, on its first commit
LINE_TAGS = f"SELECT tag_name, tag_hash FROM dolt_tags WHERE LEFT(tag_name, {len(TAG)}) = '{TAG}'"
COMMIT = re.compile(r"[0-9a-v]{32}\Z")
MAIN = "main"  # the repository's branch of the ledger in use
MOVED_LINE = "v0.5"  # the line 0.5.3 published as a branch, which `move` takes onto main
# Run in the version's service image: the line and generations of that version's code, and whether it publishes its
# ledger on main (0.5.4 on: publish.TAG).
ORIGIN = ("import json\nfrom ledger import db, publish\nprint(json.dumps({'line': getattr(publish, 'LINE', None), "
          "'main': hasattr(publish, 'TAG'), 'research': db.SCHEMA_VERSION, 'paper': db.PAPER_SCHEMA_VERSION}))")
# Run in the version's service image with the reader's profile: where the host's ledger publishes (publish.where).
WHERE = ("import json\nfrom ledger import db, publish\nprint(json.dumps(publish.where(db.load_profile('research'))))")
MOUNTED = "/run/trade/dolt-data"  # where the archive container mounts VOLUME
MIRROR = "research"  # the release host's mirror in VOLUME, left out of its tgz


class OriginUnreadable(RuntimeError):
    """DoltHub's API did not answer about a repository."""


def order(line: str) -> tuple[int, int]:
    """Where `line` comes among lines (shared/version.py order)."""
    found = LINE.fullmatch(line)
    if found is None:
        raise RuntimeError(f"{line!r} is not a version line")
    return (0, int(found[1])) if found[1] is not None else (int(found[2]), 0)


def archive_name(sha: str, now: datetime | None = None) -> str:
    return f"{(now or datetime.now(UTC)):%Y%m%dT%H%M%SZ}-{sha[:12]}"


def version(docker, service: str, base: str) -> dict:
    """The research repository `base` (TRADE_RESEARCH_ORIGIN), the line of the ledger the version of service image
    `service` publishes and its two schema generations, from its own code (`docker(*args)` returns what the command
    printed). A version older than 0.5.4 is refused: it publishes its ledger as its line's branch, not on `main`, so it
    would start a new generation on a host whose ledger is already on `main`."""
    if not REPOSITORY.fullmatch(base):
        raise RuntimeError("TRADE_RESEARCH_ORIGIN does not name a DoltHub repository")
    value = json.loads(docker("run", "--rm", "--network", "none", "--read-only", "--entrypoint", "python", service,
                              "-c", ORIGIN))
    if not isinstance(value.get("line"), str) or not LINE.fullmatch(value["line"]) or value.get("main") is not True:
        raise RuntimeError("the version does not publish its ledger on main (it is older than 0.5.4); this deployment "
                           "does not move to it")
    return {**value, "origin": base}


def place(where: dict, wanted: dict) -> str:
    """What the version `wanted` (version()) does with the host's ledger, which publishes as `where` says
    (publish.where): "same" (its line: nothing), "cutover" (an earlier line: a new generation), "move" (the v0.5
    ledger 0.5.3 published as the branch `v0.5`, onto `main`) or "unpublished" (it has not published or fetched yet:
    ask again after it has). Any other origin, a ledger without a line or of a later line raises: moving a ledger's
    public copy, or going back a line, is the user's."""
    remote, tracked, base, line = where.get("remote"), where.get("tracked"), wanted["origin"], wanted["line"]
    if not isinstance(tracked, list) or not all(isinstance(item, str) for item in tracked):
        raise RuntimeError("the ledger did not say which branches it tracks")
    if remote != base:
        raise RuntimeError(f"the ledger publishes to {remote}, not to {base} (TRADE_RESEARCH_ORIGIN); nothing was "
                           "changed. Report it: moving a ledger's public copy is the user's decision")
    if other := [branch for branch in tracked if branch != MAIN]:
        if other == [MOVED_LINE] and line == MOVED_LINE:
            return "move"
        raise RuntimeError(f"the ledger tracks {', '.join(other)} of {base}, which version line {line} does not move "
                           "onto main; nothing was changed")
    if not tracked:
        return "unpublished"
    held = where.get("line")
    if not isinstance(held, str) or not LINE.fullmatch(held):
        raise RuntimeError("the ledger names no version line (no line tag); nothing was changed")
    if held == line:
        return "same"
    if order(held) < order(line):
        return "cutover"
    raise RuntimeError(f"the ledger is of line {held}, later than the version's {line}; a deployment does not go back "
                       "a line")


def _query(origin: str, ref: str, sql: str, opener) -> dict:
    """DoltHub's public SQL API's answer about branch or commit `ref` of repository `origin`."""
    request = urllib.request.Request(f"{API}{origin.removeprefix(HOST)}/{ref}?q={urllib.parse.quote(sql)}",
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
    return value


def _unread(value: dict) -> OriginUnreadable:
    return OriginUnreadable(f"DoltHub answered {str(value.get('query_execution_status'))[:40]}: "
                            f"{str(value.get('query_execution_message'))[:200]}")


def probe(origin: str, branch: str = MAIN, opener=urllib.request.urlopen) -> tuple[str, str | None, str | None]:
    """Which research ledger DoltHub repository `origin`'s `branch` (main) holds: ("data", its schema version, its line
    or None without a line tag), ("empty", None, None) when the repository exists without that branch, ("other", None,
    None) when the branch holds no ledger, or ("absent", None, None) without the repository. Public repositories
    answer without a credential. Only those explicit answers count: OriginUnreadable for any other (a wrong "empty"
    would make a second ledger)."""
    value = _query(origin, branch, "SELECT version FROM ledger_schema WHERE singleton = 1", opener)
    status, message, rows = (value.get("query_execution_status"), value.get("query_execution_message"),
                             value.get("rows"))
    if (status == "Success" and isinstance(rows, list) and len(rows) == 1 and isinstance(rows[0], dict)
            and isinstance(rows[0].get("version"), (str, int))):
        return "data", str(rows[0]["version"]), line_of(origin, branch, opener)
    if status == "Error" and message == "no such repository":
        return "absent", None, None
    if status == "Error" and message == NO_BRANCH:
        return "empty", None, None
    if status == "Error" and message == NO_TABLE:
        return "other", None, None
    raise _unread(value)


def line_of(origin: str, branch: str, opener=urllib.request.urlopen) -> str | None:
    """The line tag on `branch`'s history (publish.ledger_line), None without one: every line tag of the repository,
    each looked up by hash in the branch's log (walking the log times out on DoltHub, measured)."""
    value = _query(origin, branch, LINE_TAGS, opener)
    rows = value.get("rows")
    if value.get("query_execution_status") != "Success" or not isinstance(rows, list):
        raise _unread(value)
    found = []
    for row in rows:
        name, commit = (row.get("tag_name"), row.get("tag_hash")) if isinstance(row, dict) else (None, None)
        if not isinstance(name, str) or not isinstance(commit, str) or not LINE.fullmatch(name.removeprefix(TAG)):
            raise OriginUnreadable(f"DoltHub listed a tag it should not: {str(row)[:100]}")
        if COMMIT.fullmatch(commit) and contains(origin, branch, commit, opener):
            found.append(name.removeprefix(TAG))
    if len(found) > 1:
        raise OriginUnreadable(f"{branch} of {origin} carries several line tags ({', '.join(sorted(found))})")
    return found[0] if found else None


def contains(origin: str, line: str, head: str, opener=urllib.request.urlopen) -> bool:
    """Whether DoltHub repository `origin`'s branch `line` holds commit `head` (False without that branch)."""
    if not COMMIT.fullmatch(head):
        raise RuntimeError(f"{head!r} is not a Dolt commit")
    value = _query(origin, line, f"SELECT COUNT(*) AS n FROM dolt_log WHERE commit_hash = '{head}'", opener)
    status, message, rows = (value.get("query_execution_status"), value.get("query_execution_message"),
                             value.get("rows"))
    if status == "Success" and isinstance(rows, list) and len(rows) == 1 and isinstance(rows[0], dict) \
            and str(rows[0].get("n")) in ("0", "1"):
        return str(rows[0]["n"]) == "1"
    if status == "Error" and message == NO_BRANCH:
        return False
    raise _unread(value)


def archiver(data: Path, name: str, service: str, volume: bool, skip: str | None = None) -> list[str]:
    """`docker` arguments that archive the ledger service's data under `data` into archive `name`, with root's read
    and write of any owner's files and nothing else, no network, from the version's own code. `volume`: VOLUME's files
    too, but its database `skip`."""
    return ["run", "--rm", "--network", "none", "--user", "0:0", "--cap-drop", "ALL", "--cap-add", "DAC_OVERRIDE",
            "--security-opt", "no-new-privileges:true", "--mount", f"type=bind,src={data},dst={data}",
            *(("--mount", f"type=volume,src={VOLUME},dst={MOUNTED},readonly") if volume else ()),
            "--workdir", "/opt/trade", "--entrypoint", "python", service, "-m", "deploy.generation", "archive",
            str(data), name, *((MOUNTED, *((skip,) if skip else ())) if volume else ())]


def pruner(data: Path, name: str, service: str) -> list[str]:
    """`docker` arguments that remove every archive but `name`."""
    return ["run", "--rm", "--network", "none", "--user", "0:0", "--cap-drop", "ALL", "--cap-add", "DAC_OVERRIDE",
            "--security-opt", "no-new-privileges:true", "--mount", f"type=bind,src={data / ARCHIVE},dst={data / ARCHIVE}",
            "--workdir", "/opt/trade", "--entrypoint", "python", service, "-m", "deploy.generation", "prune", str(data),
            name]


def archive(data: Path, name: str, volume: Path | None = None, skip: str | None = None) -> None:
    """Move what MOVED names into `data/archive/name`, by rename only; first the volume's files, but its top directory
    `skip`, as one tgz (written under a partial name, synced to disk, then renamed: the caller removes the volume after
    it). Every step can run again after an interruption."""
    target = data / ARCHIVE / name
    target.mkdir(mode=0o700, parents=True, exist_ok=True)
    for _, folder in MOVED:
        (target / folder).mkdir(mode=0o700, exist_ok=True)
    if volume is not None and not (target / VOLUME_TGZ).exists():
        partial = target / (VOLUME_TGZ + ".partial")
        with tarfile.open(partial, "w:gz") as out:
            out.add(volume, arcname=".", filter=lambda item: None if skip and item.name == f"./{skip}" else item)
        with partial.open("rb") as written:
            os.fsync(written.fileno())
        os.replace(partial, target / VOLUME_TGZ)
        sync_directory(target)
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
    """The release host's cutover (deploy/release.py Release.apply). It waits, with one notice, until the public
    repository's `main` holds the new line's ledger of that version's schema (a workstation put it there) and the
    branch named after the mirror's line holds the mirror's head (the workstation archived the old line there), no
    Paper runner runs, no Paper operation is in progress and Live is idle inside its account lock; then, with Paper's
    writes paused, it stops the ledger and market import and archives. Each later tick takes the next step from its
    journal (JOURNAL in the release state) before anything else: start both from the version's own definition, whose
    first start mirrors `main` afresh (nothing is merged into the old history), and check that the version reads the
    new ledger; then remove older archives. The release itself follows on the tick after.
    A move (the module's docstring) waits until `main` holds the v0.5 ledger and the mirror's head, then, in the same
    hold, starts the version's ledger (whose mirror then tracks only `main`) without archiving anything; it is started
    once the mirror tracks `main` and reads line v0.5 there."""

    def __init__(self, release):
        self.release, self.host = release, release.host
        self.journal = self.host.state / JOURNAL

    def read(self) -> dict | None:
        if not self.journal.exists():
            return None
        value = read_journal(self.journal, frozenset({"kind", "line", "revision", "service", "phase", "market"}),
                             frozenset({"archive"}))
        archived = value["kind"] == "cutover" and ARCHIVE_NAME.fullmatch(value.get("archive", ""))
        if (value["phase"] not in PHASES or not LINE.fullmatch(value["line"])
                or not (archived or (value["kind"] == "move" and "archive" not in value))):
            raise RuntimeError(JOURNAL_FORMAT)
        return value

    def write(self, value: dict) -> dict:
        durable_json(self.journal, value)
        return value

    def done(self) -> bool:
        """The host holds a new generation (or a moved mirror) that the routed version may not read: a rollback
        cannot check it."""
        try:
            value = self.read()
        except RuntimeError:
            return False
        return value is not None and value["phase"] in ("started", "done")

    def finish(self, routed: str) -> None:
        """Every tick, once a version that reads the new generation is routed: its own or a later one. Rollbacks then
        check the previous version again."""
        value = self.read() if self.done() else None
        if value is not None and self.release.github.ancestor(value["revision"], routed):
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

    def where(self, service: str) -> dict:
        """Where the host's ledger publishes (publish.where), read by the version's own code with the research
        reader's profile, in the container shape of its schema check (paper_host generations)."""
        paper = self.release.paper().host
        return json.loads(self.host.docker("run", "--rm", "--init", "--read-only", "--tmpfs",
                                           "/tmp:rw,nosuid,size=16777216", *paper.common(), "--env", "HOME=/tmp",
                                           "--entrypoint", "python", service, "-c", WHERE, timeout=180))

    def due(self, target: dict, owner: str, ready: Callable[[], bool]) -> bool:
        """Whether version `target` is of another line than the host's ledger (or must move it); if so it cuts over
        (or moves) when it may, and the release waits for the next tick either way. It needs only the version's service image
        until it may act; `ready` then pulls the rest and says whether the version can be released (it printed why not)."""
        sha, service = target["revision"], target["service"]
        found = self.release.paper().host.generations(service)
        base = self.host.config.research_origin
        if not base:
            if not found:
                return False
            self.wait(sha, "origin", "/etc/trade/remote.env names no TRADE_RESEARCH_ORIGIN, the DoltHub repository "
                                     "this host mirrors.")
            return True
        wanted = version(self.host.docker, service, base)
        where = self.where(service)
        how = place(where, wanted)
        if found and how != "cutover":
            named = " and ".join(sorted(found))
            self.wait(sha, "schema", f"it reads another schema generation of {named} within the host's line "
                                     f"{wanted['line']}; a schema change needs a new line (a new minor version before "
                                     "1.0), so this version cannot be deployed here.")
            return True
        if how == "same":
            return False
        if how == "unpublished":
            self.wait(sha, "mirror", "the mirror has not fetched main yet.")
            return True
        print(f"Version {target['revision']} publishes a ledger of line {wanted['line']} on main of {base}; the host's "
              f"ledger is of line {where.get('line') or '?'} and tracks {', '.join(where['tracked'])}: {how}",
              flush=True)
        if how == "move":
            self.move(target, owner, ready, wanted, where)
        else:
            self.cut(target, owner, ready, wanted, where)
        return True

    def move(self, target: dict, owner: str, ready: Callable[[], bool], wanted: dict, where: dict) -> None:
        sha, service = target["revision"], target["service"]
        if busy := self.runners():
            self.wait(sha, "paper", f"{len(busy)} Paper run(s) still run ({', '.join(busy)}). Stop them on the "
                                    "Paper page.")
            return
        if not self.held(sha, wanted, MAIN, where["head"]) or not ready():
            return
        self.release.github.ensure(target)
        self.release.live.prepare(owner, target)

        def start(held_lock) -> None:
            if not self.held(sha, wanted, MAIN, self.where(service)["head"]):  # the mirror synced on meanwhile
                return
            journal = self.write({"kind": "move", "line": wanted["line"], "revision": sha, "service": service,
                                  "phase": "archived", "market": "stopped"})
            print(f"Moving the mirror from {MOVED_LINE} to main of {wanted['origin']}", flush=True)
            self.step(journal, held_lock)

        self.hold(sha, WEB + owner, WEB + sha, service, start)

    def held(self, sha: str, wanted: dict, branch: str, head: str) -> bool:
        """Whether `main` of the research repository holds the ledger of the version's line (and schema generation)
        and its `branch` the mirror's `head`; otherwise wait."""
        try:
            state, schema, line = probe(wanted["origin"])
            published = state == "data" and line == wanted["line"] and schema == str(wanted["research"])
            kept = published and contains(wanted["origin"], branch, head)
        except OriginUnreadable as error:
            self.wait(sha, "dolthub", f"{error} about {wanted['origin']}.")
            return False
        if not published:
            self.wait(sha, "published", f"main of its public repository {wanted['origin']} holds no ledger of line "
                                        f"{wanted['line']} and schema generation {wanted['research']} yet. A "
                                        "workstation's deploy/update.sh puts it there.")
        elif not kept:
            self.wait(sha, "held", f"{branch} of {wanted['origin']} does not hold the mirror's head {head} yet. A "
                                       "workstation's deploy/update.sh keeps the old line there.")
        return kept

    def cut(self, target: dict, owner: str, ready: Callable[[], bool], wanted: dict, where: dict) -> None:
        sha, service = target["revision"], target["service"]
        if busy := self.runners():
            self.wait(sha, "paper", f"{len(busy)} Paper run(s) still run ({', '.join(busy)}); their containers mount "
                                    "the Paper directory the cutover archives. Stop them on the Paper page.")
            return
        if not self.held(sha, wanted, where["line"], where["head"]) or not ready():
            return
        self.release.github.ensure(target)
        self.release.live.prepare(owner, target)

        def start(held_lock) -> None:
            market = "running" if self.host.follower(MARKET_IMPORT) is not None else "stopped"
            journal = self.write({"kind": "cutover", "line": wanted["line"], "revision": sha, "service": service,
                                  "archive": archive_name(sha), "phase": "archiving", "market": market})
            print(f"Starting line {wanted['line']} from {wanted['origin']}; archiving into "
                  f"{self.host.config.data / ARCHIVE / journal['archive']}", flush=True)
            self.step(journal, held_lock)

        self.hold(sha, WEB + owner, WEB + sha, service, start)

    def hold(self, sha: str, owner: str, live: str, service: str | None, body, resumed: bool = False) -> None:
        """Run `body(held)` with Paper's writes paused, no Paper operation or runner left and Live idle inside its
        account lock (`live` names the Web whose Live configuration inspects it); otherwise wait with a notice. A
        `resumed` archive stopped the ledger itself, after it read that no Paper operation was in progress: with the
        ledger down Paper's lock and listing cannot be read and no operation can begin, so it goes on without them
        (the user, 2026-11-23, qOeOp/trade#3493)."""
        paper = self.release.paper().host
        controller = paper.disk_route()
        paper.switch(controller, "all")  # new Paper writes wait; normalize below, or recover() after a crash
        try:
            quiet = resumed and self.host.follower(LEDGER) is None
            if not quiet:
                with paper.barrier(paper.inspect(controller)["image"]) as drained:
                    drained()  # a lifecycle operation that passed before the freeze has finished
                time.sleep(PAPER_LISTING_SECONDS)
                quiet = Follow(self.release, None).paper_quiet(owner) is not None
            if not quiet or self.runners():
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
            if version(self.host.docker, target["service"], self.host.config.research_origin)["line"] \
                    != journal["line"]:
                raise RuntimeError("a data generation cutover is pending for another line; left for the operator")
            journal = self.write({**journal, "revision": control, "service": target["service"]})
        print(f"Continuing the data generation {journal['kind']} from its {journal['phase']} step", flush=True)
        if journal["phase"] == "archiving":  # it stops services: the same hold as the first pass
            routed = self.host.disk_route()
            self.hold(journal["revision"], routed, routed, None, lambda held: self.step(journal, held),
                      resumed=True)
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
        """One step of the cutover (or move) from the journal's phase; each can run again after an interruption."""
        sha, service, data = journal["revision"], journal["service"], self.host.config.data
        if journal["phase"] == "archiving":
            for name in (MARKET_IMPORT, LEDGER):
                if self.host.exists(name):
                    self.host.docker("stop", "--time", "60", name, timeout=180)
            if self.host.exists(LEDGER):
                self.host.docker("rm", LEDGER)  # it holds the volume
            held()
            volume = VOLUME in self.host.docker("volume", "ls", "--format", "{{.Name}}").splitlines()
            self.host.docker(*archiver(data, journal["archive"], service, volume, MIRROR), timeout=ARCHIVE_SECONDS)
            if volume:
                self.host.docker("volume", "rm", VOLUME)  # the tgz holds all but the mirror
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
            # in the middle of its first start. A move recreates the ledger: its image changed.
            self.host.compose(files, "up", "--detach", "--no-deps", "--pull", "never", "--wait", "--wait-timeout",
                              str(FOLLOW_WAIT_SECONDS), "ledger", env=env, timeout=FOLLOW_WAIT_SECONDS + 180)
            if journal["market"] == "running":
                self.host.compose(files, "up", "--detach", "--no-deps", "--pull", "never", "market-import", env=env)
            if self.release.paper().host.generations(service):
                raise RuntimeError("the new data generation's ledger is not the version's schema generation")
            if journal["kind"] == "move":
                moved = self.where(service)
                if moved["tracked"] != [MAIN] or moved["line"] != journal["line"]:
                    # Its start dropped the v0.5 tracking branch and fetched main; a fetch that failed is the next
                    # sync's. The next tick checks again.
                    print(f"The moved mirror tracks {', '.join(moved['tracked']) or 'nothing'} and reads line "
                          f"{moved['line'] or '?'}; the next tick checks again", flush=True)
                    return
            self.write({**journal, "phase": "started"})
            print(f"Data generation {journal['kind']} started for {sha}"
                  + ("; the next tick removes older archives" if journal["kind"] == "cutover" else ""), flush=True)
        elif journal["phase"] == "started":
            removed = (self.host.docker(*pruner(data, journal["archive"], service), timeout=1800)
                       if journal["kind"] == "cutover" else "")
            self.write({**journal, "phase": "done"})
            print(f"Data generation {journal['kind']} done"
                  + (f"; archived in {data / ARCHIVE / journal['archive']}" if "archive" in journal else "")
                  + (f", removed older archives {removed}" if removed else ""), flush=True)

def main(argv: list[str]) -> None:
    """Inside the version's service image (archiver, pruner): `archive DATA NAME [VOLUME [SKIP]]` or `prune DATA NAME`."""
    if len(argv) >= 3 and not ARCHIVE_NAME.fullmatch(argv[2]):
        raise SystemExit(f"{argv[2]} is not an archive name")
    if len(argv) in (3, 4, 5) and argv[0] == "archive":
        archive(Path(argv[1]), argv[2], Path(argv[3]) if len(argv) > 3 else None, argv[4] if len(argv) == 5 else None)
    elif len(argv) == 3 and argv[0] == "prune":
        print(" ".join(prune(Path(argv[1]), argv[2])))
    else:
        raise SystemExit("usage: python -m deploy.generation archive DATA NAME [VOLUME [SKIP]] | prune DATA NAME")


if __name__ == "__main__":
    main(sys.argv[1:])
