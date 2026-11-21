"""Paper admission by memory (paper/runs.py, docs/plans/paper-admission-by-memory.zh.md)."""

from __future__ import annotations

from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

from deploy import release_host
from ledger import db, strategies
from shared.errors import Refusal
from paper import runs
from tests.ledger.dolt import BINARY, SKIP, Service, sha, source

# A source that declares Paper recovery as the runner checks it (engine.paper_session.declares_recovery).
RECOVERING = b"""from nautilus_trader.trading import Strategy


class Fixture(Strategy):
    PAPER_RECOVERY = 1

    def on_save(self):
        return {}

    def on_load(self, state):
        pass
"""
RUNNING = [{"name": "a-runner", "running": True}, {"name": "a-egress", "running": True},
           {"name": "b-runner", "running": False}]


class DockerClientTests(unittest.TestCase):
    def test_no_docker_client_is_refused_as_unavailable(self):
        with mock.patch("paper.runs.subprocess.run", side_effect=FileNotFoundError("docker")):
            with self.assertRaises(Refusal) as caught:
                runs._docker("ps")
        self.assertEqual(caught.exception.code, "RUNTIME_UNAVAILABLE")


class AdmissionTests(unittest.TestCase):
    def state(self, reserved: int, host: int | None, budget: str = "3g") -> dict:
        with mock.patch.object(runs, "limits", return_value=reserved) as limits, \
                mock.patch.object(runs, "_host_available", return_value=host), \
                mock.patch.dict("os.environ", {runs.BUDGET_ENV: budget}):
            found = runs.memory_state(RUNNING)
        limits.assert_called_once_with(["a-runner", "a-egress"])
        return found

    def refused(self, need: int, reserved: int, host: int | None) -> str:
        with mock.patch.object(runs, "limits", return_value=reserved), \
                mock.patch.object(runs, "_host_available", return_value=host), \
                mock.patch.dict("os.environ", {runs.BUDGET_ENV: "3g"}), self.assertRaises(Refusal) as caught:
            runs.admit(need, RUNNING)
        self.assertEqual(caught.exception.code, "PAPER_MEMORY_FULL")
        return caught.exception.message

    def test_a_runner_reserves_by_its_contracts_in_steps(self):
        one, many = runs.mib(runs.runner_memory(1)), runs.mib(runs.runner_memory(21))
        self.assertEqual((one % runs.RUNNER_STEP_MIB, many % runs.RUNNER_STEP_MIB), (0, 0))
        self.assertGreater(many, one)
        self.assertGreaterEqual(one, runs.RUNNER_BASE_MIB + runs.RUNNER_PER_CONTRACT_MIB)

    def test_free_memory_is_the_budget_less_running_limits_and_the_hosts_headroom(self):
        self.assertEqual(self.state(1024, None)["free"], 2048)
        self.assertEqual(self.state(1024, 2500)["free"], 2500 - release_host.RELEASE_MEMORY_MIB)
        self.assertEqual(self.state(4096, 8000)["free"], 0)
        self.assertEqual(self.state(0, None, "2g")["budget"], 2048)

    def test_a_run_beyond_the_budget_or_the_headroom_is_refused_with_its_numbers(self):
        self.assertIn("reserve 2560 of the 3072 MiB", self.refused(768, 2560, None))
        self.assertIn("host has 1500 MiB available", self.refused(768, 0, 1500))
        with mock.patch.object(runs, "limits", return_value=0), \
                mock.patch.object(runs, "_host_available", return_value=None):
            runs.admit(768, RUNNING)

    def test_an_admitted_run_leaves_the_host_what_a_release_needs(self):
        # 2500 MiB available less a 768 MiB run leaves 1732 MiB: below what a release needs, so the run is refused.
        self.assertIn("host has 2500 MiB available", self.refused(768, 0, 2500))
        host = release_host.RELEASE_MEMORY_MIB + 768
        with mock.patch.object(runs, "limits", return_value=0), \
                mock.patch.object(runs, "_host_available", return_value=host):
            runs.admit(768, RUNNING)
        with tempfile.TemporaryDirectory() as root:
            meminfo = Path(root) / "meminfo"
            meminfo.write_text(f"MemAvailable:    {(host - 768) * 1024} kB\n")
            with mock.patch.object(release_host, "MEMINFO", meminfo):
                self.assertTrue(object.__new__(release_host.DockerHost).memory_available())

    def test_the_host_reading_is_meminfo_available_or_none(self):
        with tempfile.TemporaryDirectory() as root:
            meminfo = Path(root) / "meminfo"
            meminfo.write_text("MemTotal:        7596168 kB\nMemAvailable:    4231492 kB\n")
            with mock.patch.object(runs, "MEMINFO", meminfo):
                self.assertEqual(runs._host_available(), 4132)
            with mock.patch.object(runs, "MEMINFO", Path(root) / "absent"):
                self.assertIsNone(runs._host_available())


class SealCollectTests(unittest.TestCase):
    """A sealed run's working copy and containers go: its sealed files are what it is read from."""

    def run_with(self, root, stored, present):
        profile = SimpleNamespace(database="paper", service_root=root.parent)
        calls = []
        with mock.patch.object(runs.db, "connect"), \
                mock.patch.object(runs.records, "read_paper_run", return_value={"paper_id": 7}), \
                mock.patch.object(runs.records, "seal_of", return_value=stored), \
                mock.patch.object(runs.records, "capture", return_value={}), \
                mock.patch.object(runs.records, "seal_paper_run", return_value={"paper_id": 7}), \
                mock.patch.object(runs, "run_dir", return_value=root), \
                mock.patch.object(runs, "_running", return_value=False), \
                mock.patch.object(runs, "_logs", return_value=b""), mock.patch.object(runs, "_state", return_value=None), \
                mock.patch.object(runs, "containers", side_effect=lambda _: list(present)), \
                mock.patch.object(runs, "_docker", side_effect=lambda *args, **_: calls.append(args)):
            runs.seal.__wrapped__(profile, 7)  # without the cross-process lock
        return calls

    def test_sealing_removes_the_directory_and_sealing_again_collects_what_is_left(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name) / "7"
            (root / "out").mkdir(parents=True)
            calls = self.run_with(root, None, [])
            self.assertFalse(root.exists())
            self.assertIn(("network", "rm", runs.names(SimpleNamespace(database="paper", service_root=Path(name)), 7)["network"]), calls)

            (root / "out").mkdir(parents=True)  # left by an earlier controller
            self.run_with(root, {"status": "complete"}, [])
            self.assertFalse(root.exists())

    def test_a_directory_stays_while_the_containers_cannot_be_removed(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name) / "7"
            (root / "out").mkdir(parents=True)
            with self.assertRaisesRegex(RuntimeError, "could not be removed"):
                self.run_with(root, {"status": "complete"}, [{"paper_id": 7, "role": "runner", "running": False}])
            self.assertTrue(root.exists())


class StartFailureTests(unittest.TestCase):
    """A declared run whose inputs cannot be written is sealed with START_FAILED, not left for the orphan sweep."""

    def start(self, root, failing):
        profile = SimpleNamespace(database="paper", service_root=root.parent)
        row = {"paper_id": 7, "write_status": "written", "source_sha256": "s" * 64, "ledger_commit": "l"}
        found = {"source_sha256": "s" * 64, "source": RECOVERING, "entry_class": "Fixture"}
        with mock.patch.object(runs.db, "connect"), mock.patch.object(runs.db, "read_as_of"), \
                mock.patch.object(runs.strategies, "read_runnable", return_value=found), \
                mock.patch.object(runs.records, "copy_source", return_value=found), \
                mock.patch.object(runs.image, "resolve", return_value={"image_ref": "image@sha256:" + "a" * 64}), \
                mock.patch.object(runs, "containers", return_value=[]), \
                mock.patch.object(runs, "selection", return_value=("c" * 32, {"universe_rule": "fixed"}, ["BTCUSDT"])), \
                mock.patch.object(runs, "_terms", return_value={}), mock.patch.object(runs, "admit"), \
                mock.patch.object(runs.records, "open_paper_run", return_value=row), \
                mock.patch.object(runs, "run_dir", return_value=root), \
                mock.patch.object(runs, "write_months"), mock.patch.object(runs, "bind", side_effect=failing), \
                mock.patch.object(runs, "_run_containers", side_effect=AssertionError("no containers after a failure")), \
                mock.patch.object(runs, "seal", return_value={"paper_id": 7}) as seal, \
                self.assertRaises(Refusal) as caught:
            runs.start.__wrapped__(profile, {}, None, "example@1", None, None, research=profile)
        return caught.exception, seal

    def test_an_input_write_failure_after_the_declaration_seals_start_failed(self):
        with tempfile.TemporaryDirectory() as name:
            refusal, seal = self.start(Path(name) / "7", OSError("No space left on device"))
        self.assertEqual(refusal.code, "PAPER_START_FAILED")
        self.assertEqual(seal.call_args.args[1], 7)
        self.assertIn("No space left on device", seal.call_args.kwargs["start_error"])

    def test_a_directory_left_from_before_seals_start_failed(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name) / "7"
            (root / "inputs").mkdir(parents=True)
            refusal, seal = self.start(root, AssertionError("no binding after a failed mkdir"))
        self.assertEqual(refusal.code, "PAPER_START_FAILED")
        self.assertIn("FileExistsError", seal.call_args.kwargs["start_error"])


@unittest.skipUnless(BINARY, SKIP)
class RefusedStartWritesNothingTests(unittest.TestCase):
    """A refused `paper start` says write_status not_written, so it leaves the Paper database as it was: the
    source copy comes after every refusal that needs no write (memory admission, a running run of the source)."""

    def setUp(self):
        service = Service()
        self.addCleanup(service.close)
        self.research = service.ledger("research")
        self.profile = service.ledger("paper", holds="paper")
        strategies.publish_candidate(self.research, RECOVERING, "start", "Fixture", "template root")
        strategies.publish_candidate(self.research, source("plain"), "plain", "Fixture", "no recovery")
        self.sha = sha(RECOVERING)

    def copies(self) -> int:
        with db.connect(self.profile, "reader") as conn:
            return conn.rows("SELECT COUNT(*) FROM paper_source")[0][0]

    def start(self, *, present=(), admit=None, declared=None, candidate="start@1"):
        with mock.patch.object(runs.image, "resolve", return_value={"image_ref": "image@sha256:" + "a" * 64}), \
                mock.patch.object(runs, "containers", return_value=list(present)), \
                mock.patch.object(runs, "selection", return_value=("c" * 32, {"universe_rule": "fixed"}, ["BTCUSDT"])), \
                mock.patch.object(runs, "_terms", return_value={}), \
                mock.patch.object(runs, "memory_state", return_value={
                    "budget": 3584, "reserved": 3584 if admit == "full" else 0, "host_available": None,
                    "free": 0 if admit == "full" else 3584}), \
                mock.patch.object(runs.records, "open_paper_run", side_effect=declared or AssertionError("declared")):
            runs.start.__wrapped__(self.profile, {}, None, candidate, None, None, research=self.research)

    def test_a_start_refused_for_memory_copies_no_source(self):
        with self.assertRaises(Refusal) as caught:
            self.start(admit="full")
        self.assertEqual((caught.exception.code, caught.exception.write_status), ("PAPER_MEMORY_FULL", "not_written"))
        self.assertEqual(self.copies(), 0)

    def test_a_start_refused_for_a_running_run_of_the_source_copies_no_source(self):
        running = [{"name": "r", "paper_id": 1, "role": "runner", "source_sha256": self.sha, "running": True}]
        with self.assertRaises(Refusal) as caught:
            self.start(present=running)
        self.assertEqual((caught.exception.code, caught.exception.write_status), ("PAPER_RUN_ACTIVE", "not_written"))
        self.assertEqual(self.copies(), 0)

    def test_a_source_without_paper_recovery_is_refused_before_its_copy(self):
        with self.assertRaises(Refusal) as caught:
            self.start(candidate="plain@1")
        self.assertEqual((caught.exception.code, caught.exception.write_status, caught.exception.missing),
                         ("PAPER_RECOVERY_UNDECLARED", "not_written", ("PAPER_RECOVERY", "on_save", "on_load")))
        self.assertEqual(self.copies(), 0)

    def test_an_admitted_start_copies_the_source_once(self):
        """The control: the same start, admitted, reaches the copy (and stops at the declaration the test stubs)."""
        with self.assertRaises(RuntimeError):
            self.start(declared=RuntimeError("declared"))
        self.assertEqual(self.copies(), 1)


class RecoveryNamesTests(unittest.TestCase):
    """paper start's check never refuses a source the runner would find declaring recovery."""

    def test_a_source_the_runner_finds_declaring_recovery_names_all_three(self):
        from engine.paper_session import declares_recovery
        shapes = {
            "own": RECOVERING,
            "base of the file, hooks bound by assignment": b"""from nautilus_trader.trading import Strategy


def keep(self):
    return {}


class Base(Strategy):
    on_save = keep
    on_load = lambda self, state: None


class Fixture(Base):
    PAPER_RECOVERY = 2 - 1
""",
            "flag set after the class": RECOVERING.replace(b"    PAPER_RECOVERY = 1\n", b"") + b"Fixture.PAPER_RECOVERY = 1\n",
        }
        for shape, text in shapes.items():
            with self.subTest(shape):
                namespace: dict = {}
                exec(compile(text, "<strategy>", "exec"), namespace)
                self.assertTrue(declares_recovery(namespace["Fixture"]))
                self.assertEqual(runs.unnamed_recovery(text), [])

    def test_a_missing_name_is_reported(self):
        self.assertEqual(runs.unnamed_recovery(RECOVERING.replace(b"on_load", b"on_restore")), ["on_load"])
        self.assertEqual(runs.unnamed_recovery(source("plain")), ["PAPER_RECOVERY", "on_save", "on_load"])


class MonthFileTests(unittest.TestCase):
    def test_each_held_month_after_the_start_gets_its_members_once(self):
        from datetime import date
        import json
        from market import files, universe
        rows = [(date(2026, 1, 1), "AAAUSDT"), (date(2026, 1, 1), "BBBUSDT"), (date(2026, 2, 1), "AAAUSDT"),
                (date(2026, 2, 1), "CCCUSDT")]
        with tempfile.TemporaryDirectory() as name, mock.patch.object(files, "open_market"), \
                mock.patch.object(files, "resolve_day", return_value="c" * 32), \
                mock.patch.object(universe, "months_of", return_value=rows):
            directory = Path(name)
            (directory / "inputs").mkdir()
            self.assertEqual(runs.write_months({}, directory, ["AAAUSDT", "BBBUSDT"], "2026-01"), ["2026-02"])
            written = directory / "inputs" / "membership" / "2026-02.json"
            self.assertEqual(json.loads(written.read_text()), {"market_day": "c" * 32, "members": ["AAAUSDT"]})
            self.assertEqual(sorted(path.name for path in written.parent.iterdir()), ["2026-02.json"])
            self.assertEqual(runs.write_months({}, directory, ["AAAUSDT", "BBBUSDT"], "2026-01"), [])  # never rewritten
