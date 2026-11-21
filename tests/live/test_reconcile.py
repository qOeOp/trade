"""Live admission needs a reconciled Paper run (20261120-06, decided 2026-11-21): the bar a comparison must meet, the
serving control's background answer, and preparation's question to it over the control socket. No database: the
Paper runs, images and comparisons are stand-ins; ReplayEvidenceTests covers the check inside preparation."""

from contextlib import ExitStack
import json
import os
from pathlib import Path
import tempfile
import threading
import unittest
import unittest.mock
from unittest.mock import patch

from engine.live_errors import LiveRefusal
from live import configuration, control, reconcile, serve
from shared.refusals import refuse
from tests.helpers import refused

CODE = {"source_files_sha256": "1" * 64, "audit_source_sha256": "2" * 64, "dependency_lock_sha256": "3" * 64}
LIVE_IMAGE = "ghcr.io/qoeop/trade-runtime@sha256:" + "b" * 64
SOURCE = "5" * 64


def comparison(**changes) -> dict:
    """A comparison.json that reconciles, with `changes`."""
    value = {"data_source": "archive", "preliminary": None, "replay": {"status": "passed"},
             "summary": {"groups": 2, "look_ahead_suspects": 0, "equity_unexplained_minutes": 0},
             "groups": [{"cause": None}, {"cause": "consequence"}]}
    for key, item in changes.items():
        value[key] = {**value[key], **item} if isinstance(item, dict) and isinstance(value.get(key), dict) else item
    return value


def config(directory: Path) -> configuration.Configuration:
    return configuration.Configuration(root=directory / "live-root", socket=directory / "socket" / "control.sock",
                                       research_ledger=directory / "profiles" / "research.json", runtime=LIVE_IMAGE,
                                       market_root=directory / "market")


class BarTests(unittest.TestCase):
    def test_only_an_archive_comparison_with_orders_and_nothing_unexplained_reconciles(self):
        self.assertIsNone(reconcile.unreconciled(comparison()))
        for changes, reason in (
                ({"data_source": "rest", "preliminary": {"minutes": 3}}, "preliminary"),
                ({"replay": {"status": "invalid"}}, "did not pass"),
                ({"summary": {"groups": None}}, "did not pass"),
                ({"summary": {"groups": 0}, "groups": []}, "no order group"),
                ({"groups": [{"cause": "unexplained"}, {"cause": None}]}, "1 order group"),
                ({"summary": {"look_ahead_suspects": 1}}, "look-ahead"),
                ({"summary": {"equity_unexplained_minutes": 4}}, "4 equity minute")):
            with self.subTest(changes=changes):
                self.assertIn(reason, reconcile.unreconciled(comparison(**changes)))


class ReconciliationTests(unittest.TestCase):
    def setUp(self):
        self.config = config(Path("/unused"))
        self.runs = [{"paper_id": 7, "image_ref": "paper@sha256:" + "7" * 64},
                     {"paper_id": 5, "image_ref": "paper@sha256:" + "5" * 64}]
        listed = patch.object(reconcile, "matching", side_effect=lambda *_: self.runs)
        self.listed = listed.start()
        self.addCleanup(listed.stop)
        self.codes = {LIVE_IMAGE: CODE, self.runs[0]["image_ref"]: CODE, self.runs[1]["image_ref"]: CODE}
        self.results = {7: {"paper_id": 7, "market_day": "2026-11-20", "retry": False, "reason": None},
                        5: {"paper_id": 5, "market_day": "2026-11-20", "retry": False, "reason": None}}
        self.compared = []

        def compare(_, paper_id):
            self.compared.append(paper_id)
            return self.results[paper_id]
        self.reconciliation = reconcile.Reconciliation(compare, lambda image_ref, _: self.codes.get(image_ref))

    def answer(self, symbols=("BTCUSDT",)):
        return self.reconciliation.answer(self.config, (SOURCE, symbols))

    def test_the_newest_matching_run_that_reconciles_is_the_answer(self):
        self.assertEqual(self.answer(), {"state": "reconciled", "paper_id": 7, "reasons": []})
        self.assertEqual(self.listed.call_args.args, (self.config.paper_ledger, SOURCE, ["BTCUSDT"]))
        self.assertEqual(self.config.paper_ledger, Path("/unused/profiles/paper.json"), "beside the research reader")
        self.results[7] = {**self.results[7], "reason": "1 order group(s) differ for no known cause"}
        self.reconciliation._compared.clear()
        self.assertEqual(self.answer(), {"state": "reconciled", "paper_id": 5, "reasons": []})
        self.assertEqual(self.compared, [7, 7, 5])
        self.answer()
        self.assertEqual(self.compared, [7, 7, 5], "a run is compared once in the control's life")

    def test_a_run_on_other_replay_code_or_none_at_all_is_no_reconciliation(self):
        self.codes[self.runs[0]["image_ref"]] = {**CODE, "audit_source_sha256": "4" * 64}
        self.codes.pop(self.runs[1]["image_ref"])  # an image that cannot be read now
        found = self.answer()
        self.assertEqual((found["state"], found["paper_id"]), ("unreconciled", None))
        self.assertIn("no sealed, complete Paper run", found["reasons"][0])
        self.assertEqual(self.compared, [])
        self.runs.clear()
        self.assertEqual(self.answer()["state"], "unreconciled")

    def test_a_comparison_not_done_is_checking_and_is_compared_again_later(self):
        self.runs.pop()
        self.results[7] = {**self.results[7], "retry": True, "reason": reconcile.UNCOVERED}
        found = self.answer()
        self.assertEqual(found, {"state": "checking", "paper_id": None,
                                 "reasons": [f"Paper run 7: {reconcile.UNCOVERED}"]})
        self.answer()
        self.assertEqual(self.compared, [7], "not before RETRY_NS")
        self.results[7] = {**self.results[7], "retry": False, "reason": None}
        with patch.object(reconcile.time, "monotonic_ns", return_value=self.reconciliation._compared[7]["at"]
                          + reconcile.Reconciliation.RETRY_NS):
            self.assertEqual(self.answer()["state"], "reconciled")
        self.assertEqual(self.compared, [7, 7])

    def test_a_key_is_checking_until_the_background_check_answers_it(self):
        key = (SOURCE, ("BTCUSDT",))
        with patch.object(reconcile.threading, "Thread") as thread:
            self.assertEqual(self.reconciliation.request(self.config, key)["state"], "checking")
        thread.assert_called_once()
        self.reconciliation.check(self.config)
        self.assertEqual(self.reconciliation.view(key)["state"], "reconciled")
        self.listed.side_effect = OSError("the Paper database is down")
        self.reconciliation.check(self.config)
        found = self.reconciliation.view(key)
        self.assertEqual(found["state"], "checking")
        self.assertIn("could not be read now (OSError)", found["reasons"][0])


class CompareOneTests(unittest.TestCase):
    """live paper-compare, the comparison container's command: one run, its own working directory, removed after."""

    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="lp-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve() / "live-root"
        self.root.mkdir(mode=0o700)
        (self.root / "account.lock").touch(mode=0o600)
        self.journal = [{"kind": "started"}]
        self.outcome = comparison()
        stack = ExitStack()
        self.addCleanup(stack.close)
        stack.enter_context(patch.dict(os.environ))  # the command sets its own TMPDIR
        stack.enter_context(patch.object(tempfile, "tempdir", None))
        stack.enter_context(patch.object(reconcile, "_paper"))
        stack.enter_context(patch.object(reconcile.db, "connect"))
        stack.enter_context(patch("ledger.paper.paper_files"))
        stack.enter_context(patch("ledger.paper.sealed_journal", side_effect=lambda _: self.journal))
        self.held = unittest.mock.Mock(return_value=None)

    def compare(self, profile, market, at, paper_id, output):
        self.assertEqual((market, at), ({"holds": "market", "root": "/market"}, None), "the archive, never REST")
        self.assertTrue(str(output).startswith(str(self.root / reconcile.TMP)))
        if isinstance(self.outcome, Exception):
            raise self.outcome
        output.mkdir(parents=True)
        (output / "comparison.json").write_text(json.dumps({**self.outcome, "market_day": "2026-11-20"}))
        return {"path": str(output / "comparison.json")}

    def run_one(self) -> dict:
        found = reconcile.compare_one(self.root, Path("/profiles/paper.json"), Path("/market"), 7,
                                      compare=self.compare, held_since=self.held)
        self.assertEqual(list((self.root / reconcile.TMP).iterdir()), [], "its working directory is removed")
        return found

    def test_one_run_is_compared_on_the_archive(self):
        self.assertEqual(self.run_one(), {"paper_id": 7, "market_day": "2026-11-20", "retry": False, "reason": None})
        self.outcome = comparison(summary={"look_ahead_suspects": 2})
        self.assertEqual(self.run_one()["reason"], "2 look-ahead suspect(s)")
        self.outcome = refuse("COMPARE_UNCOVERED", "the market lacks the run's minutes")
        self.assertEqual(self.run_one(), {"paper_id": 7, "market_day": None, "retry": True,
                                          "reason": reconcile.UNCOVERED})
        self.held.return_value = 1
        self.assertEqual(self.run_one(), {"paper_id": 7, "market_day": None, "retry": False,
                                          "reason": "the run was held after an interruption"})


class RequireTests(unittest.TestCase):
    """Preparation runs in `live web-command`, outside the serving control, and asks it over the socket."""

    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="lr-", dir="/tmp")  # a socket path must stay short
        self.addCleanup(temporary.cleanup)
        self.config = config(Path(temporary.name).resolve())

    def serve(self, reconciliation):
        listener = serve.listener(self.config, Path("/unused"), reconciliation=reconciliation)
        server = listener.__enter__()
        self.addCleanup(listener.__exit__, None, None, None)
        threading.Thread(target=server.serve_forever, kwargs={"poll_interval": .01}, daemon=True).start()
        self.addCleanup(server.shutdown)

    def refusal(self, source_sha256=SOURCE) -> str:
        caught = refused(reconcile.require, self.config, "example@2", source_sha256, ["ETHUSDT", "BTCUSDT"],
                         error=LiveRefusal)
        self.assertEqual(caught.code, "LIVE_PAPER_UNRECONCILED")
        return caught.message

    def test_preparation_is_refused_until_the_serving_control_holds_a_reconciled_run(self):
        self.assertIn("has not finished comparing", self.refusal(), "no control answers")
        self.serve(None)
        self.assertIn("has not finished comparing", self.refusal(), "a control that does not compare Paper runs")

    def test_the_serving_controls_answer_decides(self):
        reconciliation = reconcile.Reconciliation(compare=None, replay_code=None)
        self.serve(reconciliation)
        answer = {"state": "unreconciled", "paper_id": None, "reasons": ["Paper run 3: 1 look-ahead suspect(s)"]}
        with patch.object(control, "candidate", return_value={"source_sha256": SOURCE}), \
                patch.object(reconciliation, "request", side_effect=lambda *_: answer) as asked:
            self.assertEqual(self.refusal(), "Paper run 3: 1 look-ahead suspect(s)")
            self.assertEqual(asked.call_args.args[1], (SOURCE, ("ETHUSDT", "BTCUSDT")))
            self.assertIn("source changed", self.refusal("6" * 64))
            answer = {"state": "reconciled", "paper_id": 3, "reasons": []}
            self.assertIsNone(reconcile.require(self.config, "example@2", SOURCE, ["ETHUSDT", "BTCUSDT"]))


if __name__ == "__main__":
    unittest.main()
