"""A new data generation on the release host and its shared parts (deploy/generation.py), with Docker, DoltHub, Paper
and Live faked; the archive itself runs on temporary directories. Never a real ledger, volume or DoltHub repository."""

from contextlib import contextmanager
import io
import json
from pathlib import Path
import tarfile
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
import urllib.error

from deploy import generation
from deploy.generation import ARCHIVE, JOURNAL, MOUNTED, VOLUME, Generation, OriginUnreadable
from deploy.live_host import LiveBusy
from deploy.paper_host import PAPER
from deploy.release_host import LEDGER, MARKET_IMPORT, Config

A, B = "a" * 40, "b" * 40
SERVICE = "ghcr.io/qoeop/trade-service@sha256:" + "e" * 64
TARGET = {"revision": B, "service": SERVICE}
BASE = "https://doltremoteapi.dolthub.com/owner/research"
ORIGIN = BASE + "-g2"


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

    def __call__(self, *args, timeout=120, **_):
        self.calls.append(args)
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
            return json.dumps({"origin": ORIGIN, "research": 2, "paper": 1})
        return ""


class Host:
    def __init__(self, state: Path, data: Path, docker: Docker):
        self.state, self.docker = state, docker
        self.config = Config(state=state, data=data, research_origin=BASE)
        self.composed: list[tuple] = []
        self.compose_fail = False

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
        self.composed.append(args)
        self.docker.containers.add({"ledger": LEDGER, "market-import": MARKET_IMPORT}[args[-1]])
        return ""

    def probe(self, web, path, routed=False):
        return {"status": 200, "starting": 0, "runs": []}


class Paper:
    def __init__(self):
        self.unread: dict[str, str] = {"research": "2"}
        self.frozen: list[str] = []

    def generations(self, service):
        return self.unread

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

    def prepare(self, owner, target):
        pass

    @contextmanager
    def barrier(self, name, service=None, *, idle=False, wait_for_lock=False):
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
        sleep = patch.object(generation.time, "sleep")
        sleep.start()
        self.addCleanup(sleep.stop)

    def due(self) -> bool:
        def after_start(service):
            # The version reads the ledger once the cutover started it.
            return {} if any(call[-1] == "ledger" for call in self.host.composed) else {"research": "2"}

        self.paper.generations = after_start
        with patch.object(generation, "probe", side_effect=lambda origin: self.published):
            return self.generation.due(TARGET, A)

    def journal(self) -> dict | None:
        path = self.host.state / JOURNAL
        return json.loads(path.read_text()) if path.exists() else None

    def assertUntouched(self):
        self.assertIsNone(self.journal())
        self.assertFalse([call for call in self.docker.calls if call[0] in ("stop", "rm")])
        self.assertTrue((self.data / "dolt/service.json").exists())
        self.assertEqual(self.host.composed, [])

    def test_a_version_that_reads_the_host_ledger_changes_nothing(self):
        self.paper.unread = {}
        self.assertFalse(self.generation.due(TARGET, A))
        self.assertUntouched()
        self.assertEqual(self.release.waits, {})

    def test_it_waits_with_one_notice_while_any_condition_is_unmet(self):
        cases = {
            "paper": lambda: setattr(self.docker, "runners", ["trade-paper-7-runner"]),
            "published": lambda: setattr(self, "published", ("empty", None)),
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
        self.published = ("data", "1")  # an earlier generation's ledger under that name: not this version's
        self.assertTrue(self.due())
        self.assertUntouched()
        self.setUp()
        with patch.object(generation, "probe", side_effect=OriginUnreadable("DoltHub answered HTTP 503")):
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
        self.assertEqual(journal["phase"], "done")
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
            self.assertIn("./research/.dolt/noms", kept.getnames())
        self.assertNotIn(VOLUME, self.docker.volumes)
        self.assertFalse(older.exists(), "only the newest archive stays")
        self.assertTrue(manual.exists())
        steps = [call[:2] for call in self.docker.calls if call[0] in ("stop", "rm")]
        self.assertEqual(steps, [("stop", "--time"), ("stop", "--time"), ("rm", LEDGER)])
        self.assertEqual([call[-1] for call in self.host.composed], ["ledger", "market-import"])
        self.assertNotIn("--force-recreate", self.host.composed[0])
        self.assertEqual(self.paper.frozen, ["all", None], "Paper's writes wait for the cutover only")
        self.assertTrue(self.generation.done())

    def test_market_import_that_was_stopped_stays_stopped(self):
        self.docker.containers.discard(MARKET_IMPORT)
        self.assertTrue(self.due())
        self.assertEqual([call[-1] for call in self.host.composed], ["ledger"])

    def test_an_interrupted_cutover_is_finished_by_the_next_tick_from_its_step(self):
        for crash in ("run", "compose"):
            with self.subTest(crash=crash):
                self.setUp()
                if crash == "run":
                    self.docker.fail = "--workdir"  # the archive container died
                else:
                    self.host.compose_fail = True
                with self.assertRaises(RuntimeError):
                    self.due()
                self.assertEqual(self.journal()["phase"], "archiving" if crash == "run" else "archived")
                self.assertFalse(self.generation.done())
                stops = len([call for call in self.docker.calls if call[0] == "stop"])
                self.assertTrue(self.generation.resume(B))
                self.assertEqual(self.journal()["phase"], "done")
                self.assertEqual(len([call for call in self.docker.calls if call[0] == "stop"]),
                                 stops if crash == "compose" else stops + 1,  # the ledger is already gone
                                 "an archived step is never redone")
                self.assertEqual(list((self.data / "ledgers").iterdir()), [])
                self.assertFalse(self.generation.resume(B), "a finished cutover is not resumed")

    def test_a_ledger_the_version_still_does_not_read_fails_the_tick_and_keeps_the_journal(self):
        self.paper.generations = lambda service: {"research": "2"}
        with patch.object(generation, "probe", return_value=self.published), \
                self.assertRaisesRegex(RuntimeError, "not the version's schema generation"):
            self.generation.cut(TARGET, A)
        self.assertEqual(self.journal()["phase"], "archived")

    def test_a_journal_of_another_shape_is_refused(self):
        (self.host.state / JOURNAL).write_text(json.dumps({"revision": B, "phase": "archiving"}))
        with self.assertRaisesRegex(RuntimeError, "not in this control's format"):
            self.generation.resume(B)
        self.assertFalse(self.generation.done())


class ProbeTests(unittest.TestCase):
    def answer(self, value=None, status=200, error=None):
        def opener(request, timeout):
            self.assertTrue(request.full_url.startswith(generation.API + "owner/research-g2/main?q="))
            if error is not None:
                raise error
            body = io.BytesIO(json.dumps(value).encode())
            if status != 200:
                raise urllib.error.HTTPError(request.full_url, status, "", {}, body)
            return body
        return opener

    def test_a_repository_holds_a_ledger_holds_none_or_does_not_exist(self):
        ok = {"query_execution_status": "Success", "rows": [{"version": "2"}]}
        self.assertEqual(generation.probe(ORIGIN, self.answer(ok)), ("data", "2"))
        missing = {"query_execution_status": "Error", "query_execution_message": "no such repository"}
        self.assertEqual(generation.probe(ORIGIN, self.answer(missing, 400)), ("absent", None))
        empty = {"query_execution_status": "Error", "query_execution_message": "table not found: ledger_schema"}
        self.assertEqual(generation.probe(ORIGIN, self.answer(empty, 400)), ("empty", None))

    def test_no_answer_is_unreadable_never_a_guess(self):
        with self.assertRaises(OriginUnreadable):
            generation.probe(ORIGIN, self.answer(error=OSError("unreachable")))
        def html(request, timeout):
            raise urllib.error.HTTPError(request.full_url, 502, "", {}, io.BytesIO(b"<html>"))
        with self.assertRaisesRegex(OriginUnreadable, "502"):
            generation.probe(ORIGIN, html)


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
