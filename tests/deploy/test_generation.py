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
                       ("market/bar/2020-01.parquet", "bars"), ("volume/research/.dolt/noms", "chunks")):
        (data / path).parent.mkdir(parents=True, exist_ok=True)
        (data / path).write_text(text)
    return data / "volume"


class Docker:
    """The host's Docker: records every call; runs the version's archive and prune code on the temporary data."""

    def __init__(self, data: Path, volume: Path):
        self.data, self.volume, self.calls = data, volume, []
        self.runners: list[str] = []
        self.containers = {LEDGER, MARKET_IMPORT}
        self.volumes = {VOLUME}
        self.fail: str | None = None
        self.seconds = 0  # the longest each command may take, summed
        self.line = "v0.6"  # the version's line
        self.where = {"remote": BASE, "lines": ["v0.5"], "head": HEAD}  # where the host's mirror is

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
        if args[0] == "rm":
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
            return json.dumps({"line": self.line, "research": 2, "paper": 1})
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
        self.renames = True

    def pull(self, reference, pattern, sha=None):
        self.docker.seconds += 600
        self.pulled.add(reference)
        return sha

    def exists(self, name):
        return name in self.docker.containers

    def follower(self, name):
        return {"image": SERVICE} if name in self.docker.containers and name == MARKET_IMPORT else None

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
        self.docker.containers.add({"ledger": LEDGER, "market-import": MARKET_IMPORT}[args[-1]])
        where = self.docker.where
        if args[-1] == "ledger" and where["remote"] == BASE + "-g2" and self.renames:
            self.docker.where = {**where, "remote": BASE, "lines": []}  # the version's mirror renamed its origin
        elif args[-1] == "ledger" and where["remote"] == BASE and where["lines"] != [self.docker.line]:
            self.docker.where = {**where, "lines": [self.docker.line]}  # a new generation's mirror of its line
        return ""

    def probe(self, web, path, routed=False):
        return {"status": 200, "starting": 0, "runs": []}

    def disk_route(self):
        return WEB + A


class Paper:
    def __init__(self):
        self.unread: dict[str, str] = {"research": "2"}
        self.frozen: list[str] = []

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
        self.live = Live()
        paper_release = SimpleNamespace(host=self.paper)
        self.release = SimpleNamespace(host=self.host, waits={}, github=Mock(), live=self.live,
                                       paper=lambda: paper_release)
        self.release.github.approved.return_value = TARGET
        self.generation = Generation(self.release)
        self.published = ("data", "2")
        self.held = True  # whether the repository's branch v0.5 holds the mirror's head
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
        with patch.object(generation, "probe", side_effect=lambda origin, line: self.published), \
                patch.object(generation, "contains", side_effect=lambda origin, line, head: self.held):
            return self.generation.due(TARGET, A)

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
        self.assertFalse(self.generation.due(TARGET, A))
        self.assertUntouched()
        self.assertEqual(self.release.waits, {})

    def test_another_line_starts_a_new_generation_even_with_the_same_schema(self):
        self.paper.generations = lambda service: {}
        with patch.object(generation, "probe", return_value=self.published) as probe:
            self.assertTrue(self.generation.due(TARGET, A))
        probe.assert_called_once_with(BASE, "v0.6")
        self.assertEqual((self.journal()["kind"], self.journal()["line"], self.journal()["phase"]),
                         ("cutover", "v0.6", "archived"))

    def test_a_schema_change_within_the_line_waits_and_changes_nothing(self):
        self.docker.line = "v0.5"
        self.assertTrue(self.generation.due(TARGET, A))
        self.assertUntouched()
        self.assertIn("a schema change needs a new line", self.release.waits[f"wait:generation:{B}:schema"])

    def test_a_mirror_that_has_not_fetched_its_line_waits(self):
        self.paper.unread = {}
        self.docker.where = {"remote": BASE, "lines": [], "head": HEAD}
        self.assertTrue(self.generation.due(TARGET, A))
        self.assertUntouched()
        self.assertIn(f"wait:generation:{B}:mirror", self.release.waits)

    def test_a_mirror_of_another_repository_fails_the_tick_and_changes_nothing(self):
        self.paper.unread = {}
        self.docker.where = {"remote": "https://doltremoteapi.dolthub.com/someone/else-g2", "lines": ["main"],
                             "head": HEAD}
        with self.assertRaisesRegex(RuntimeError, "not to .*owner/research"):
            self.generation.due(TARGET, A)
        self.assertUntouched()

    def test_the_v0_5_mirror_moves_only_once_v0_5_holds_its_head(self):
        self.docker.line = "v0.5"
        self.docker.where = {"remote": BASE + "-g2", "lines": ["main"], "head": HEAD}
        self.paper.unread = {}
        self.held = False
        self.assertTrue(self.due())
        self.assertUntouched()
        self.assertIn(f"does not hold the mirror's head {HEAD}", self.release.waits[f"wait:generation:{B}:published"])
        self.held = True
        self.assertTrue(self.due())
        self.assertEqual(self.journal(), {"kind": "move", "line": "v0.5", "revision": B, "service": SERVICE,
                                          "phase": "started", "market": "stopped"})
        self.assertEqual([call[-1] for call in self.host.composed], ["ledger"], "the version's ledger alone")
        self.assertEqual(self.docker.where["remote"], BASE)
        self.assertFalse([call for call in self.docker.calls if call[0] in ("stop", "rm") or "deploy.generation" in call],
                         "nothing is archived")
        self.assertIn(VOLUME, self.docker.volumes, "the volume holds the host's Paper database too")
        self.assertTrue((self.data / "dolt/service.json").exists())
        self.assertEqual(self.live.inspected, [WEB + B], "the same hold as a cutover")
        self.assertTrue(self.generation.done(), "a rollback's version would refuse the moved mirror")
        self.assertTrue(self.generation.resume(B))
        self.assertEqual(self.journal()["phase"], "done")
        self.assertFalse([call for call in self.docker.calls if "deploy.generation" in call], "no archive is pruned")
        self.docker.line = "v0.6"  # 0.6.0 itself on a v0.5 mirror of that repository: a new generation
        self.docker.where = {"remote": BASE + "-g2", "lines": ["main"], "head": HEAD}
        self.assertEqual(generation.place(self.docker.where, {"origin": BASE, "line": "v0.6"}), "cutover")

    def test_a_move_waits_when_the_mirror_synced_past_the_line_before_the_hold(self):
        self.docker.line = "v0.5"
        before = {"remote": BASE + "-g2", "lines": ["main"], "head": HEAD}
        self.paper.unread = {}
        newer = "n" * 32
        reads = [before, {**before, "head": newer}]
        with patch.object(self.generation, "where", side_effect=lambda service: reads.pop(0)), \
                patch.object(generation, "probe", side_effect=lambda origin, line: self.published), \
                patch.object(generation, "contains", side_effect=lambda origin, line, head: head == HEAD):
            self.assertTrue(self.generation.due(TARGET, A))
        self.assertEqual(reads, [], "read again inside the hold")
        self.assertUntouched()
        self.assertIn(f"does not hold the mirror's head {newer}", self.release.waits[f"wait:generation:{B}:published"])
        self.assertEqual(self.paper.frozen[-1:], [None], "Paper's writes are never left paused")

    def test_a_mirror_that_did_not_move_fails_the_tick_and_keeps_the_journal(self):
        self.docker.line = "v0.5"
        self.docker.where = {"remote": BASE + "-g2", "lines": ["main"], "head": HEAD}
        self.paper.unread = {}
        self.host.renames = False
        with self.assertRaisesRegex(RuntimeError, "does not follow the research repository"):
            self.due()
        self.assertEqual(self.journal()["phase"], "archived")

    def test_it_waits_with_one_notice_while_any_condition_is_unmet(self):
        cases = {
            "paper": lambda: setattr(self.docker, "runners", ["trade-paper-7-runner"]),
            "published": lambda: setattr(self, "published", ("other", None)),
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
        self.setUp()
        self.published = ("data", "1")  # another schema generation's ledger on that line: not this version's
        self.assertTrue(self.due())
        self.assertUntouched()
        self.setUp()
        with patch.object(generation, "probe", side_effect=OriginUnreadable("DoltHub answered HTTP 503")):
            self.assertTrue(self.generation.due(TARGET, A))
        self.assertUntouched()
        self.assertIn("HTTP 503", self.release.waits[f"wait:generation:{B}:dolthub"])
        self.setUp()
        self.docker.line = "v0.5"
        self.paper.unread = {}
        self.docker.where = {"remote": BASE + "-g2", "lines": ["main"], "head": HEAD}
        with patch.object(generation, "contains", side_effect=OriginUnreadable("DoltHub answered HTTP 503")):
            self.assertTrue(self.generation.due(TARGET, A))
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
        self.assertFalse((archive / generation.VOLUME_TGZ).exists(),
                         "the host's volume mirrors the old generation's DoltHub repository: never copied")
        self.assertNotIn(VOLUME, self.docker.volumes)
        self.assertNotIn(MOUNTED, [item for call in self.docker.calls for item in call])
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
        with patch.object(generation, "probe", return_value=self.published):
            self.generation.cut(TARGET, A, {"origin": BASE, "line": "v0.6", "research": 2})
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
    def answer(self, value=None, status=200, error=None):
        def opener(request, timeout):
            self.assertTrue(request.full_url.startswith(generation.API + "owner/research/v0.6?q="))
            if error is not None:
                raise error
            body = io.BytesIO(json.dumps(value).encode())
            if status != 200:
                raise urllib.error.HTTPError(request.full_url, status, "", {}, body)
            return body
        return opener

    def test_a_repository_holds_a_ledger_holds_none_or_does_not_exist(self):
        ok = {"query_execution_status": "Success", "rows": [{"version": "2"}]}
        self.assertEqual(generation.probe(BASE, "v0.6", self.answer(ok)), ("data", "2"))
        missing = {"query_execution_status": "Error", "query_execution_message": "no such repository"}
        self.assertEqual(generation.probe(BASE, "v0.6", self.answer(missing, 400)), ("absent", None))
        for message, state in ((generation.NO_BRANCH, "empty"), (generation.NO_TABLE, "other")):
            empty = {"query_execution_status": "Error", "query_execution_message": message}
            self.assertEqual(generation.probe(BASE, "v0.6", self.answer(empty)), (state, None))

    def test_any_other_answer_is_unreadable_never_an_empty_repository(self):
        for value in ({"query_execution_status": "Error", "query_execution_message": "query error: timeout"},
                      {"query_execution_status": "Success", "rows": []},
                      {"query_execution_status": "Success", "rows": [{"other": "2"}]},
                      {"query_execution_status": "Running"}, {}):
            with self.subTest(value=value), self.assertRaises(OriginUnreadable):
                generation.probe(BASE, "v0.6", self.answer(value))

    def test_no_answer_is_unreadable_never_a_guess(self):
        with self.assertRaises(OriginUnreadable):
            generation.probe(BASE, "v0.6", self.answer(error=OSError("unreachable")))
        def html(request, timeout):
            raise urllib.error.HTTPError(request.full_url, 502, "", {}, io.BytesIO(b"<html>"))
        with self.assertRaisesRegex(OriginUnreadable, "502"):
            generation.probe(BASE, "v0.6", html)


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
        docker = Mock(return_value=json.dumps({"line": "v0.5", "research": 2, "paper": 1}))
        self.assertEqual(generation.version(docker, SERVICE, BASE),
                         {"line": "v0.5", "research": 2, "paper": 1, "origin": BASE})
        for base, text in ((BASE + "-g2", "repository of one generation"), ("file:///tmp/r", "DoltHub repository"),
                           (BASE + "/x", "DoltHub repository")):
            with self.subTest(base=base), self.assertRaisesRegex(RuntimeError, text):
                generation.version(docker, SERVICE, base)
        for line in (None, "main", "v0", "v01"):
            docker.return_value = json.dumps({"line": line, "research": 2, "paper": 1})
            with self.subTest(line=line), self.assertRaisesRegex(RuntimeError, "publishes no version line"):
                generation.version(docker, SERVICE, BASE)


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
