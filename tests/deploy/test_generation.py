"""A new data generation on the release host and its shared parts (deploy/generation.py), with Docker, DoltHub, Paper
and Live faked; the archive itself runs on temporary directories. Never a real ledger, volume or DoltHub repository."""

from contextlib import contextmanager
import io
import json
import re
from pathlib import Path
import tarfile
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
import urllib.error
import urllib.parse

from deploy import generation
from deploy.generation import ARCHIVE, JOURNAL, MOUNTED, VOLUME, Generation, OriginUnreadable
from deploy.live_host import LiveBusy
from deploy.paper_host import PAPER
from deploy.release_host import LEDGER, MARKET_IMPORT, WEB, Config

A, B = "a" * 40, "b" * 40
SERVICE = "ghcr.io/qoeop/trade-service@sha256:" + "e" * 64
TARGET = {"revision": B, "service": SERVICE}
BASE = "https://doltremoteapi.dolthub.com/owner/research"
HEAD = "h" * 32


def fill(data: Path) -> Path:
    """A ledger service's data as a host holds it, and the Dolt volume's files; returns the volume."""
    for path, text in (("dolt/service.json", "{}"), ("dolt/cfg/config.yaml", "x"), ("dolt/paper/7/run.json", "{}"),
                       ("ledgers/research.json", "{}"), ("ledgers/market.json", "{}"), ("dolt-backups/research/b", "b"),
                       ("market/bar/2020-01.parquet", "bars"), ("volume/research/.dolt/noms", "chunks"),
                       ("volume/paper/.dolt/noms", "runs")):
        (data / path).parent.mkdir(parents=True, exist_ok=True)
        (data / path).write_text(text)
    return data / "volume"


class Docker:
    """The host's Docker: records every call; runs the version's archive and prune code on the temporary data."""

    def __init__(self, data: Path, volume: Path):
        self.data, self.volume, self.calls = data, volume, []
        self.runners: list[str] = []
        self.containers = {LEDGER, MARKET_IMPORT}
        self.stopped: set[str] = set()
        self.volumes = {VOLUME}
        self.fail: str | None = None
        self.seconds = 0  # the longest each command may take, summed
        self.line = "v0.6"  # the version's line
        self.where = {"remote": BASE, "tracked": ["main"], "line": "v0.5", "head": HEAD}  # the host's mirror

    def __call__(self, *args, timeout=120, **_):
        self.calls.append(args)
        self.seconds += timeout
        if self.fail and self.fail in args:
            self.fail = None
            raise RuntimeError(f"crash at {args[0]}")
        if args[:2] == ("ps", "--filter"):
            return "\n".join(self.runners)
        if args[:2] == ("volume", "ls"):
            return "\n".join(sorted(self.volumes))
        if args[:2] == ("volume", "rm"):
            self.volumes.discard(args[2])
            return ""
        if args[0] == "stop":
            self.stopped.add(args[-1])
            return ""
        if args[0] == "rm":
            self.stopped.discard(args[1])
            self.containers.discard(args[1])
            return ""
        if args[0] == "run" and "deploy.generation" in args:
            command = list(args[args.index("deploy.generation") + 1:])
            command = [str(self.volume) if item == MOUNTED else item for item in command]
            if command[0] == "prune":
                return " ".join(generation.prune(Path(command[1]), command[2]))
            generation.main(command)
            return ""
        if args[0] == "run" and generation.ORIGIN in args:
            return json.dumps({"line": self.line, "main": True, "research": 2, "paper": 1})
        if args[0] == "run" and generation.WHERE in args:
            return json.dumps(self.where)
        return ""


class Host:
    def __init__(self, state: Path, data: Path, docker: Docker):
        self.state, self.docker = state, docker
        self.config = Config(state=state, data=data, research_origin=BASE)
        self.composed: list[tuple] = []
        self.compose_fail = False
        self.pulled: set[str] = set()  # images present; compose runs with --pull never
        self.starting = 0  # Paper runs being started
        self.moves = True  # whether the version's mirror tracks main once it starts

    def pull(self, reference, pattern, sha=None):
        self.docker.seconds += 600
        self.pulled.add(reference)
        return sha

    def exists(self, name):
        return name in self.docker.containers

    def follower(self, name):
        return {"image": SERVICE} if name in self.docker.containers - self.docker.stopped else None

    def definition(self, service, sha):
        return ["compose.yaml"]

    def compose(self, files, *args, env, timeout=120):
        if self.compose_fail:
            self.compose_fail = False
            raise RuntimeError("compose crashed")
        if "never" in args and env.get("TRADE_SERVICE_IMAGE") not in self.pulled:
            raise RuntimeError("No such image")  # pruned since the handover read the definition
        self.composed.append(args)
        self.docker.seconds += timeout
        started = {"ledger": LEDGER, "market-import": MARKET_IMPORT}[args[-1]]
        self.docker.containers.add(started)
        self.docker.stopped.discard(started)
        where = self.docker.where
        if args[-1] == "ledger" and where["tracked"] == ["v0.5"]:
            if self.moves:  # the version's mirror dropped v0.5 and fetched main with its line's tag
                self.docker.where = {**where, "tracked": ["main"], "line": "v0.5"}
        elif args[-1] == "ledger" and where["line"] != self.docker.line:
            self.docker.where = {**where, "line": self.docker.line}  # a new generation's mirror of main
        return ""

    def probe(self, web, path, routed=False):
        if path == "/api/paper/runs" and self.follower(LEDGER) is None:
            raise RuntimeError("the Paper database does not answer")
        return {"status": 200, "starting": self.starting, "runs": []}

    def disk_route(self):
        return WEB + A


class Paper:
    def __init__(self):
        self.unread: dict[str, str] = {"research": "2"}
        self.frozen: list[str] = []
        self.ledger = lambda: True  # whether the ledger service runs: the barrier locks in its Paper database

    def generations(self, service):
        return self.unread

    def common(self):
        return []

    def disk_route(self):
        return PAPER + A

    def inspect(self, name):
        return {"image": SERVICE}

    def switch(self, name, freeze=None):
        self.frozen.append(freeze)

    def normalize(self):
        self.frozen.append(None)

    @contextmanager
    def barrier(self, service):
        if not self.ledger():
            raise RuntimeError("Paper lifecycle barrier was lost or did not become ready")
        yield lambda: None


class Live:
    def __init__(self):
        self.busy = False
        self.inspected: list[str] = []

    def prepare(self, owner, target):
        pass

    @contextmanager
    def barrier(self, name, service=None, *, idle=False, wait_for_lock=False):
        self.inspected.append(name)
        if self.busy:
            raise LiveBusy("a Live run holds the account")
        yield lambda: None


class GenerationTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        self.data = root / "trade"
        self.volume = fill(self.data)
        (root / "state").mkdir()
        self.docker = Docker(self.data, self.volume)
        self.host = Host(root / "state", self.data, self.docker)
        self.paper = Paper()
        self.paper.ledger = lambda: self.host.follower(LEDGER) is not None
        self.live = Live()
        paper_release = SimpleNamespace(host=self.paper)
        self.release = SimpleNamespace(host=self.host, waits={}, github=Mock(), live=self.live,
                                       paper=lambda: paper_release)
        self.release.github.approved.return_value = TARGET
        self.generation = Generation(self.release)
        self.published = ("data", "2", "v0.6")  # what the repository's main holds
        self.held = True  # whether the branch asked about holds the mirror's head
        self.asked: list[tuple] = []
        sleep = patch.object(generation.time, "sleep")
        sleep.start()
        self.addCleanup(sleep.stop)

    def due(self) -> bool:
        unread = self.paper.unread

        def after_start(service):
            # The version reads the ledger once the cutover started it.
            started = any(call[-1] == "ledger" for call in self.host.composed)
            return {} if started or not unread else dict(unread)

        self.paper.generations = after_start
        with patch.object(generation, "probe", side_effect=lambda origin: self.published), \
                patch.object(generation, "contains", side_effect=lambda origin, branch, head:
                             self.asked.append((branch, head)) or self.held):
            return self.generation.due(TARGET, A, lambda: True)

    def journal(self) -> dict | None:
        path = self.host.state / JOURNAL
        return json.loads(path.read_text()) if path.exists() else None

    def assertUntouched(self):
        self.assertIsNone(self.journal())
        self.assertFalse([call for call in self.docker.calls if call[0] in ("stop", "rm")])
        self.assertTrue((self.data / "dolt/service.json").exists())
        self.assertEqual(self.host.composed, [])

    def test_a_version_of_the_host_ledger_s_line_changes_nothing(self):
        self.paper.unread = {}
        self.docker.line = "v0.5"
        self.assertFalse(self.generation.due(TARGET, A, lambda: True))
        self.assertUntouched()
        self.assertEqual(self.release.waits, {})

    def test_another_line_starts_a_new_generation_even_with_the_same_schema(self):
        self.paper.generations = lambda service: {}
        with patch.object(generation, "probe", return_value=self.published) as probe, \
                patch.object(generation, "contains", return_value=True) as contains:
            self.assertTrue(self.generation.due(TARGET, A, lambda: True))
        probe.assert_called_once_with(BASE)
        contains.assert_called_once_with(BASE, "v0.5", HEAD)  # the old line's branch holds the mirror's head
        self.assertEqual((self.journal()["kind"], self.journal()["line"], self.journal()["phase"]),
                         ("cutover", "v0.6", "archived"))

    def test_a_schema_change_within_the_line_waits_and_changes_nothing(self):
        self.docker.line = "v0.5"
        self.assertTrue(self.generation.due(TARGET, A, lambda: True))
        self.assertUntouched()
        self.assertIn("a schema change needs a new line", self.release.waits[f"wait:generation:{B}:schema"])

    def test_a_mirror_that_has_not_fetched_its_line_waits(self):
        self.paper.unread = {}
        self.docker.where = {"remote": BASE, "tracked": [], "line": None, "head": HEAD}
        self.assertTrue(self.generation.due(TARGET, A, lambda: True))
        self.assertUntouched()
        self.assertIn(f"wait:generation:{B}:mirror", self.release.waits)

    def test_a_mirror_of_another_repository_fails_the_tick_and_changes_nothing(self):
        self.paper.unread = {}
        self.docker.where = {"remote": "https://doltremoteapi.dolthub.com/someone/else", "tracked": ["main"],
                             "line": "v0.5", "head": HEAD}
        with self.assertRaisesRegex(RuntimeError, "not to .*owner/research"):
            self.generation.due(TARGET, A, lambda: True)
        self.assertUntouched()

    def test_the_v0_5_mirror_moves_to_main_only_once_main_holds_the_ledger_and_its_head(self):
        self.docker.line = "v0.5"
        self.docker.where = {"remote": BASE, "tracked": ["v0.5"], "line": None, "head": HEAD}
        self.paper.unread = {}
        self.published = ("data", "1", None)  # main still holds the previous generation
        self.assertTrue(self.due())
        self.assertUntouched()
        self.assertIn("holds no ledger of line v0.5", self.release.waits[f"wait:generation:{B}:published"])
        self.published, self.held = ("data", "2", "v0.5"), False
        self.release.waits.clear()
        self.assertTrue(self.due())
        self.assertUntouched()
        self.assertIn(f"main of {BASE} does not hold the mirror's head {HEAD}",
                      self.release.waits[f"wait:generation:{B}:held"])
        self.held = True
        self.assertTrue(self.due())
        self.assertEqual(self.asked[-1], ("main", HEAD))
        self.assertEqual(self.journal(), {"kind": "move", "line": "v0.5", "revision": B, "service": SERVICE,
                                          "phase": "started", "market": "stopped"})
        self.assertEqual([call[-1] for call in self.host.composed], ["ledger"], "the version's ledger alone")
        self.assertEqual(self.docker.where["tracked"], ["main"])
        self.assertFalse([call for call in self.docker.calls if call[0] in ("stop", "rm") or "deploy.generation" in call],
                         "nothing is archived")
        self.assertIn(VOLUME, self.docker.volumes, "the volume holds the host's Paper database too")
        self.assertTrue((self.data / "dolt/service.json").exists())
        self.assertEqual(self.live.inspected, [WEB + B], "the same hold as a cutover")
        self.assertTrue(self.generation.done(), "a rollback's version would refuse the moved mirror")
        self.assertTrue(self.generation.resume(B))
        self.assertEqual(self.journal()["phase"], "done")
        self.assertFalse([call for call in self.docker.calls if "deploy.generation" in call], "no archive is pruned")
        with self.assertRaisesRegex(RuntimeError, "does not move onto main"):  # 0.6.0 on a mirror 0.5.4 never moved
            generation.place({"remote": BASE, "tracked": ["v0.5"], "line": None, "head": HEAD}, {"origin": BASE, "line": "v0.6"})

    def test_a_move_waits_when_the_mirror_synced_past_main_before_the_hold(self):
        self.docker.line = "v0.5"
        before = {"remote": BASE, "tracked": ["v0.5"], "line": None, "head": HEAD}
        self.paper.unread = {}
        self.published = ("data", "2", "v0.5")
        newer = "n" * 32
        reads = [before, {**before, "head": newer}]
        with patch.object(self.generation, "where", side_effect=lambda service: reads.pop(0)), \
                patch.object(generation, "probe", side_effect=lambda origin: self.published), \
                patch.object(generation, "contains", side_effect=lambda origin, branch, head: head == HEAD):
            self.assertTrue(self.generation.due(TARGET, A, lambda: True))
        self.assertEqual(reads, [], "read again inside the hold")
        self.assertUntouched()
        self.assertIn(f"does not hold the mirror's head {newer}", self.release.waits[f"wait:generation:{B}:held"])
        self.assertEqual(self.paper.frozen[-1:], [None], "Paper's writes are never left paused")

    def test_a_mirror_that_does_not_track_main_yet_is_checked_again_by_the_next_tick(self):
        self.docker.line = "v0.5"
        self.docker.where = {"remote": BASE, "tracked": ["v0.5"], "line": None, "head": HEAD}
        self.paper.unread = {}
        self.published = ("data", "2", "v0.5")
        self.host.moves = False  # its start could not fetch main
        self.assertTrue(self.due())
        self.assertEqual(self.journal()["phase"], "archived")
        self.assertTrue(self.generation.resume(B))
        self.assertEqual(self.journal()["phase"], "archived", "still not on main: not started")
        self.host.moves = True
        self.assertTrue(self.generation.resume(B))
        self.assertEqual(self.journal()["phase"], "started")

    def test_it_waits_with_one_notice_while_any_condition_is_unmet(self):
        cases = {
            "paper": lambda: setattr(self.docker, "runners", ["trade-paper-7-runner"]),
            "published": lambda: setattr(self, "published", ("other", None, None)),
            "held": lambda: setattr(self, "held", False),
            "live": lambda: setattr(self.live, "busy", True),
            "origin": lambda: setattr(self.host, "config", Config(state=self.host.state, data=self.data)),
        }
        for reason, unmet in cases.items():
            with self.subTest(reason=reason):
                self.setUp()
                unmet()
                self.assertTrue(self.due())
                self.assertUntouched()
                [key] = self.release.waits
                self.assertEqual(key, f"wait:generation:{B}:{reason}")
                self.assertEqual(self.paper.frozen[-1:], [None] if self.paper.frozen else [],
                                 "Paper's writes are never left paused")
        for published in (("data", "1", "v0.6"), ("data", "2", "v0.5"), ("data", "2", None)):
            self.setUp()  # another schema generation of the line, or main still holds the old line or no line
            self.published = published
            self.assertTrue(self.due())
            self.assertUntouched()
            self.assertIn(f"wait:generation:{B}:published", self.release.waits)
        self.setUp()
        with patch.object(generation, "probe", side_effect=OriginUnreadable("DoltHub answered HTTP 503")):
            self.assertTrue(self.generation.due(TARGET, A, lambda: True))
        self.assertUntouched()
        self.assertIn("HTTP 503", self.release.waits[f"wait:generation:{B}:dolthub"])
        self.setUp()
        self.docker.line = "v0.5"
        self.paper.unread = {}
        self.docker.where = {"remote": BASE, "tracked": ["v0.5"], "line": None, "head": HEAD}
        with patch.object(generation, "probe", return_value=("data", "2", "v0.5")), \
                patch.object(generation, "contains", side_effect=OriginUnreadable("DoltHub answered HTTP 503")):
            self.assertTrue(self.generation.due(TARGET, A, lambda: True))
        self.assertUntouched()
        self.assertIn("HTTP 503", self.release.waits[f"wait:generation:{B}:dolthub"])

    def test_the_cutover_archives_the_ledger_and_starts_the_version_on_an_empty_one(self):
        older = self.data / ARCHIVE / ("20260101T000000Z-" + "c" * 12)
        older.mkdir(parents=True)
        manual = self.data / ARCHIVE / "generation-1"  # not one this code named: never removed
        manual.mkdir()
        self.assertTrue(self.due())
        journal = self.journal()
        self.assertEqual(journal["phase"], "archived", "the first tick only archives")
        self.assertEqual(self.host.composed, [])
        self.assertFalse(self.generation.done())
        self.assertTrue(self.generation.resume(B))
        self.assertEqual(self.journal()["phase"], "started")
        self.assertTrue(older.exists(), "older archives go on the tick after the start")
        self.assertTrue(self.generation.done())
        self.assertTrue(self.generation.resume(B))
        self.assertEqual(self.journal()["phase"], "done")
        self.assertFalse(self.generation.resume(B), "a finished cutover is not resumed")
        archive = self.data / ARCHIVE / journal["archive"]
        self.assertEqual(sorted(path.name for path in (self.data / "dolt").iterdir()), ["paper"])
        self.assertEqual(list((self.data / "dolt/paper").iterdir()), [], "its mount point stays, emptied")
        self.assertEqual(list((self.data / "ledgers").iterdir()), [])
        self.assertTrue((archive / "dolt/service.json").is_file())
        self.assertTrue((archive / "dolt-paper/7/run.json").is_file())
        self.assertTrue((archive / "ledgers/market.json").is_file())
        self.assertTrue((archive / "dolt-backups/research/b").is_file())
        self.assertTrue((self.data / "market/bar/2020-01.parquet").is_file(), "the market has no generation")
        with tarfile.open(archive / generation.VOLUME_TGZ) as kept:
            self.assertIn("./paper/.dolt/noms", kept.getnames(), "the volume holds the host's only live Paper database")
            self.assertNotIn("./research/.dolt/noms", kept.getnames(), "a mirror of the old line's branch: never copied")
        self.assertNotIn(VOLUME, self.docker.volumes)
        self.assertFalse(older.exists(), "only the newest archive stays")
        self.assertTrue(manual.exists())
        steps = [call[:2] for call in self.docker.calls if call[0] in ("stop", "rm")]
        self.assertEqual(steps, [("stop", "--time"), ("stop", "--time"), ("rm", LEDGER)])
        self.assertEqual([call[-1] for call in self.host.composed], ["ledger", "market-import"])
        self.assertNotIn("--force-recreate", self.host.composed[0])
        self.assertEqual(self.paper.frozen, ["all", None, "all", None], "Paper's writes wait for the archive and "
                         "the start only")
        self.assertTrue(self.generation.done())

    def test_each_tick_of_a_cutover_fits_well_within_the_release_unit_s_start_timeout(self):
        unit = (Path(__file__).parents[2] / "deploy/remote/trade-release.service").read_text()
        minutes = int(re.search(r"^TimeoutStartSec=([0-9]+)min$", unit, re.M).group(1))
        steps = [self.due, lambda: self.generation.resume(B), lambda: self.generation.resume(B)]
        for step in steps:
            self.docker.seconds = 0
            step()
            self.assertLessEqual(self.docker.seconds, minutes * 60 / 2,
                                 "the rest of a tick (preparing, Live's inspection) needs the other half")
        self.assertEqual(self.journal()["phase"], "done")

    def test_the_volume_stays_until_its_paper_database_is_archived(self):
        with patch.object(generation.tarfile, "open", side_effect=OSError("no space left")), self.assertRaises(OSError):
            self.due()
        self.assertIn(VOLUME, self.docker.volumes)
        self.assertEqual(self.journal()["phase"], "archiving")
        self.assertTrue(self.generation.resume(B))
        self.assertEqual(self.journal()["phase"], "archived")
        self.assertNotIn(VOLUME, self.docker.volumes)
        with tarfile.open(self.data / ARCHIVE / self.journal()["archive"] / generation.VOLUME_TGZ) as kept:
            self.assertIn("./paper/.dolt/noms", kept.getnames())

    def test_a_volume_already_removed_is_not_mounted_again(self):
        self.docker.volumes.clear()
        self.assertTrue(self.due())
        self.assertNotIn(f"type=volume,src={VOLUME},dst={MOUNTED},readonly",
                         [item for call in self.docker.calls for item in call], "Docker would create it, empty")

    def test_market_import_that_was_stopped_stays_stopped(self):
        self.docker.containers.discard(MARKET_IMPORT)
        self.assertTrue(self.due())
        self.assertTrue(self.generation.resume(B))
        self.assertEqual([call[-1] for call in self.host.composed], ["ledger"])

    def test_an_interrupted_cutover_is_finished_by_the_next_ticks_from_its_step(self):
        self.docker.fail = "--workdir"  # the archive container died
        with self.assertRaises(RuntimeError):
            self.due()
        self.assertEqual(self.journal()["phase"], "archiving")
        self.assertFalse(self.generation.done())
        stops = len([call for call in self.docker.calls if call[0] == "stop"])
        self.assertTrue(self.generation.resume(B))
        self.assertEqual(self.journal()["phase"], "archived")
        self.assertEqual(len([call for call in self.docker.calls if call[0] == "stop"]), stops + 1,
                         "the stopped ledger is gone; market import is stopped again")
        self.assertEqual(self.live.inspected, [WEB + B, WEB + A], "the resumed archive takes the same hold")
        self.host.compose_fail = True
        with self.assertRaises(RuntimeError):
            self.generation.resume(B)
        self.assertEqual(self.journal()["phase"], "archived")
        self.assertTrue(self.generation.resume(B))
        self.assertTrue(self.generation.resume(B))
        self.assertEqual(self.journal()["phase"], "done")
        self.assertEqual(len([call for call in self.docker.calls if call[0] == "stop"]), stops + 1,
                         "an archived step is never redone")
        self.assertEqual(list((self.data / "ledgers").iterdir()), [])

    def test_a_resumed_archive_without_a_ledger_waits_while_live_or_a_runner_is_busy(self):
        for reason in ("live", "paper"):
            with self.subTest(reason=reason):
                self.setUp()
                self.docker.fail = "--workdir"
                with self.assertRaises(RuntimeError):
                    self.due()
                self.assertNotIn(LEDGER, self.docker.containers)
                calls = len(self.docker.calls)
                if reason == "live":
                    self.live.busy = True
                else:
                    self.docker.runners = ["trade-paper-7-runner"]
                self.assertTrue(self.generation.resume(B))
                self.assertEqual(self.journal()["phase"], "archiving")
                self.assertFalse([call for call in self.docker.calls[calls:] if call[0] in ("stop", "rm", "run")])
                self.assertIn(f"wait:generation:{B}:{reason}", self.release.waits)
                self.assertEqual(self.paper.frozen[-2:], ["all", None], "Paper's writes wait meanwhile, and only then")

    def test_a_cutover_stopped_before_the_ledger_is_removed_goes_on(self):
        self.docker.fail = "rm"
        with self.assertRaises(RuntimeError):
            self.due()
        self.assertIn(LEDGER, self.docker.containers & self.docker.stopped)
        self.assertTrue(self.generation.resume(B))
        self.assertEqual(self.journal()["phase"], "archived")

    def test_a_resumed_archive_with_a_ledger_still_asks_paper(self):
        self.docker.fail = "--workdir"
        with self.assertRaises(RuntimeError):
            self.due()
        self.docker.containers.add(LEDGER)  # an operator started it again
        self.docker.stopped.clear()
        self.host.starting = 1
        self.assertTrue(self.generation.resume(B))
        self.assertEqual(self.journal()["phase"], "archiving")
        self.assertIn(f"wait:generation:{B}:paper", self.release.waits)

    def test_the_first_pass_never_skips_the_paper_check(self):
        self.docker.stopped.add(LEDGER)
        with self.assertRaisesRegex(RuntimeError, "barrier"):
            self.due()
        self.assertUntouched()

    def test_a_resumed_archive_waits_while_live_or_paper_is_busy(self):
        for reason in ("live", "paper"):
            with self.subTest(reason=reason):
                self.setUp()
                self.docker.fail = "--workdir"
                with self.assertRaises(RuntimeError):
                    self.due()
                self.docker.containers.update({LEDGER, MARKET_IMPORT})  # an operator started them again
                calls = len(self.docker.calls)
                if reason == "live":
                    self.live.busy = True
                else:
                    self.docker.runners = ["trade-paper-7-runner"]
                self.assertTrue(self.generation.resume(B))
                self.assertEqual(self.journal()["phase"], "archiving")
                self.assertFalse([call for call in self.docker.calls[calls:] if call[0] in ("stop", "rm", "run")])
                self.assertIn(f"wait:generation:{B}:{reason}", self.release.waits)
                self.assertEqual(self.paper.frozen[-1], None, "Paper's writes are never left paused")

    def test_a_ledger_the_version_still_does_not_read_fails_the_tick_and_keeps_the_journal(self):
        self.paper.generations = lambda service: {"research": "2"}
        with patch.object(generation, "probe", return_value=self.published), \
                patch.object(generation, "contains", return_value=True):
            self.generation.cut(TARGET, A, lambda: True, {"origin": BASE, "line": "v0.6", "research": 2}, self.docker.where)
        with self.assertRaisesRegex(RuntimeError, "not the version's schema generation"):
            self.generation.resume(B)
        self.assertEqual(self.journal()["phase"], "archived")

    def test_a_journal_of_another_shape_is_refused(self):
        whole = {"kind": "cutover", "line": "v0.6", "revision": B, "service": SERVICE,
                 "archive": "20261123T000000Z-" + B[:12], "phase": "archiving", "market": "stopped"}
        for value in ({"revision": B, "phase": "archiving"}, {**whole, "kind": "other"}, {**whole, "archive": None},
                      {**whole, "kind": "move"}, {**whole, "line": "main"},
                      {key: value for key, value in whole.items() if key != "archive"}):
            with self.subTest(value=value):
                (self.host.state / JOURNAL).write_text(json.dumps(value))
                with self.assertRaisesRegex(RuntimeError, "not in this control's format"):
                    self.generation.resume(B)
                self.assertFalse(self.generation.done())

    def test_a_newer_control_takes_over_a_cutover_of_its_own_line_only(self):
        self.docker.fail = "--workdir"
        with self.assertRaises(RuntimeError):
            self.due()
        newer = {"revision": "c" * 40, "service": SERVICE}
        self.release.github.approved.return_value = newer
        self.docker.line = "v0.7"
        with self.assertRaisesRegex(RuntimeError, "pending for another line"):
            self.generation.resume(newer["revision"])
        self.assertEqual(self.journal()["revision"], B)
        self.docker.line = "v0.6"
        self.assertTrue(self.generation.resume(newer["revision"]))
        self.assertEqual((self.journal()["revision"], self.journal()["phase"]), (newer["revision"], "archived"))


class ProbeTests(unittest.TestCase):
    TAGS = {"query_execution_status": "Success", "rows": [{"tag_name": "line/v0.5", "tag_hash": "r" * 32},
                                                          {"tag_name": "line/v0.6", "tag_hash": "s" * 32}]}

    def answer(self, value=None, status=200, error=None, tags=None, held=("s" * 32,)):
        """DoltHub's answers on main: `value` to the ledger_schema query, `tags` to the line tags', and whether main's
        log holds a commit (those in `held`)."""
        def opener(request, timeout):
            self.assertTrue(request.full_url.startswith(generation.API + "owner/research/main?q="))
            query = urllib.parse.unquote(request.full_url.split("?q=", 1)[1])
            if error is not None:
                raise error
            if "dolt_tags" in query:
                reply = self.TAGS if tags is None else tags
            elif "dolt_log" in query:
                reply = {"query_execution_status": "Success",
                         "rows": [{"n": "1" if any(commit in query for commit in held) else "0"}]}
            else:
                reply = value
            body = io.BytesIO(json.dumps(reply).encode())
            if status != 200:
                raise urllib.error.HTTPError(request.full_url, status, "", {}, body)
            return body
        return opener

    def test_main_holds_a_ledger_of_a_line_holds_none_or_does_not_exist(self):
        ok = {"query_execution_status": "Success", "rows": [{"version": "2"}]}
        self.assertEqual(generation.probe(BASE, opener=self.answer(ok)), ("data", "2", "v0.6"),
                         "the line tag on main's history, not an archived line's")
        self.assertEqual(generation.probe(BASE, opener=self.answer(ok, held=())), ("data", "2", None))
        missing = {"query_execution_status": "Error", "query_execution_message": "no such repository"}
        self.assertEqual(generation.probe(BASE, opener=self.answer(missing, 400)), ("absent", None, None))
        for message, state in ((generation.NO_BRANCH, "empty"), (generation.NO_TABLE, "other")):
            empty = {"query_execution_status": "Error", "query_execution_message": message}
            self.assertEqual(generation.probe(BASE, opener=self.answer(empty)), (state, None, None))

    def test_several_line_tags_or_a_tag_of_another_shape_are_unreadable(self):
        ok = {"query_execution_status": "Success", "rows": [{"version": "2"}]}
        with self.assertRaisesRegex(OriginUnreadable, "several line tags"):
            generation.probe(BASE, opener=self.answer(ok, held=("r" * 32, "s" * 32)))
        odd = {"query_execution_status": "Success", "rows": [{"tag_name": "line/main", "tag_hash": "s" * 32}]}
        with self.assertRaises(OriginUnreadable):
            generation.probe(BASE, opener=self.answer(ok, tags=odd))

    def test_any_other_answer_is_unreadable_never_an_empty_repository(self):
        for value in ({"query_execution_status": "Error", "query_execution_message": "query error: timeout"},
                      {"query_execution_status": "Success", "rows": []},
                      {"query_execution_status": "Success", "rows": [{"other": "2"}]},
                      {"query_execution_status": "Running"}, {}):
            with self.subTest(value=value), self.assertRaises(OriginUnreadable):
                generation.probe(BASE, opener=self.answer(value))

    def test_no_answer_is_unreadable_never_a_guess(self):
        with self.assertRaises(OriginUnreadable):
            generation.probe(BASE, opener=self.answer(error=OSError("unreachable")))
        def html(request, timeout):
            raise urllib.error.HTTPError(request.full_url, 502, "", {}, io.BytesIO(b"<html>"))
        with self.assertRaisesRegex(OriginUnreadable, "502"):
            generation.probe(BASE, opener=html)


class ContainsTests(unittest.TestCase):
    def answer(self, value):
        def opener(request, timeout):
            self.assertTrue(request.full_url.startswith(generation.API + "owner/research/v0.5?q="))
            self.assertIn(HEAD, urllib.parse.unquote(request.full_url))
            return io.BytesIO(json.dumps(value).encode())
        return opener

    def test_a_branch_holds_a_commit_or_not_and_anything_else_is_unreadable(self):
        for n, held in (("1", True), ("0", False), (1, True)):
            value = {"query_execution_status": "Success", "rows": [{"n": n}]}
            self.assertIs(generation.contains(BASE, "v0.5", HEAD, self.answer(value)), held)
        missing = {"query_execution_status": "Error", "query_execution_message": "query error: branch not found"}
        self.assertFalse(generation.contains(BASE, "v0.5", HEAD, self.answer(missing)))
        for value in ({"query_execution_status": "Error", "query_execution_message": "no such repository"},
                      {"query_execution_status": "Success", "rows": [{"n": "2"}]},
                      {"query_execution_status": "Success", "rows": []}):
            with self.subTest(value=value), self.assertRaises(OriginUnreadable):
                generation.contains(BASE, "v0.5", HEAD, self.answer(value))
        with self.assertRaisesRegex(RuntimeError, "not a Dolt commit"):
            generation.contains(BASE, "v0.5", "x' OR '1'='1", self.answer({}))


class VersionTests(unittest.TestCase):
    def test_the_version_s_line_comes_from_its_code_and_the_base_is_the_repository_itself(self):
        docker = Mock(return_value=json.dumps({"line": "v0.5", "main": True, "research": 2, "paper": 1}))
        self.assertEqual(generation.version(docker, SERVICE, BASE),
                         {"line": "v0.5", "main": True, "research": 2, "paper": 1, "origin": BASE})
        for base in ("file:///tmp/r", BASE + "/x"):
            with self.subTest(base=base), self.assertRaisesRegex(RuntimeError, "DoltHub repository"):
                generation.version(docker, SERVICE, base)
        for line, main in ((None, True), ("main", True), ("v0", True), ("v01", True), ("v0.5", False),
                           ("v0.5", None)):
            docker.return_value = json.dumps({"line": line, "research": 2, "paper": 1,
                                              **({} if main is None else {"main": main})})
            with self.subTest(line=line, main=main), self.assertRaisesRegex(RuntimeError, "older than 0.5.4"):
                generation.version(docker, SERVICE, BASE)

    def test_where_a_ledger_stands_decides_what_the_version_does(self):
        wanted = {"origin": BASE, "line": "v0.6"}
        here = {"remote": BASE, "tracked": ["main"], "head": HEAD}
        self.assertEqual(generation.place({**here, "line": "v0.6"}, wanted), "same")
        self.assertEqual(generation.place({**here, "line": "v0.5"}, wanted), "cutover")
        self.assertEqual(generation.place({**here, "line": "v0.10"}, {**wanted, "line": "v1"}), "cutover")
        self.assertEqual(generation.place({**here, "tracked": [], "line": None}, wanted), "unpublished")
        for where, text in (({**here, "line": "v0.7"}, "does not go back"), ({**here, "line": None}, "no line tag"),
                            ({**here, "line": "v0.6", "remote": BASE + "-g2"}, "not to"),
                            ({**here, "line": "v0.6", "tracked": ["main", "v0.4"]}, "does not move onto main"),
                            ({**here, "tracked": "main"}, "which branches")):
            with self.subTest(where=where), self.assertRaisesRegex(RuntimeError, text):
                generation.place(where, wanted)


class ArchiveTests(unittest.TestCase):
    def test_archive_and_prune_names_are_checked(self):
        with self.assertRaises(SystemExit):
            generation.main(["archive", "/tmp/x", "../escape"])
        with self.assertRaises(SystemExit):
            generation.main(["prune", "/tmp/x", "name"])

    def test_a_partial_tgz_is_written_again(self):
        with tempfile.TemporaryDirectory() as directory:
            data = Path(directory)
            volume = fill(data)
            name = "20261123T000000Z-" + B[:12]
            (data / ARCHIVE / name).mkdir(parents=True)
            (data / ARCHIVE / name / (generation.VOLUME_TGZ + ".partial")).write_text("cut short")
            generation.archive(data, name, volume)
            generation.archive(data, name, volume)  # again: nothing left to move
            with tarfile.open(data / ARCHIVE / name / generation.VOLUME_TGZ) as kept:
                self.assertIn("./research/.dolt/noms", kept.getnames())
            self.assertFalse((data / ARCHIVE / name / (generation.VOLUME_TGZ + ".partial")).exists())


if __name__ == "__main__":
    unittest.main()
