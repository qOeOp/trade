"""Remote controls retain run identity, bound log access, and preserve the existing HTTP boundary."""
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
import unittest
import tempfile
from unittest import mock

from ledger import db, paper as records
from paper import runs, serve
from tests.paper.test_serve import request, server
from tests.helpers import refused

OP = "paper-web:12345678-1234-4234-8234-123456789abc"
ROW = {"paper_id": 8, "symbols": ["BTCUSDT"], "image_ref": "original@sha256:" + "a" * 64,
       "config": {"candidate": "a@1", "leverage": "3"}}


@contextmanager
def connection(*_args):
    yield mock.Mock()


class StartIdentityTests(unittest.TestCase):
    def test_retry_returns_original_even_after_market_image_and_liveness_change(self):
        profile = SimpleNamespace(service_root=Path("/isolated"), database="test")
        with mock.patch.object(db, "connect", connection), mock.patch.object(records, "paper_start_of", return_value=ROW), \
                mock.patch.object(runs.image, "resolve", side_effect=AssertionError("must not resolve new image")), \
                mock.patch.object(runs, "containers", side_effect=AssertionError("must not apply new-run limit")):
            found = runs.start.__wrapped__(profile, {}, "changed", "a@1", ["BTCUSDT"], "changed", op_id=OP,
                                           research=mock.Mock())
        self.assertEqual((found["paper_id"], found["symbols"], found["image_ref"], found["write_status"]),
                         (8, ["BTCUSDT"], ROW["image_ref"], "replayed"))

    def test_reusing_operation_for_another_target_does_not_start_anything(self):
        with mock.patch.object(db, "connect", connection), mock.patch.object(records, "paper_start_of", return_value=ROW):
            for candidate, symbols, leverage in [("b@1", ["BTCUSDT"], "3"), ("a@1", ["ETHUSDT"], "3"),
                                                 ("a@1", ["BTCUSDT"], "5")]:
                with self.subTest(candidate=candidate, symbols=symbols, leverage=leverage):
                    caught = refused(runs.start.__wrapped__, mock.Mock(), {}, None, candidate, symbols, None, op_id=OP,
                                     research=mock.Mock(), leverage=leverage)
                self.assertEqual(caught.code, "OP_ID_CONFLICT")

    def test_http_retry_precedes_mutable_default_selection(self):
        daemon = serve.Daemon.__new__(serve.Daemon)
        daemon.start_result = mock.Mock(return_value={"run": {**ROW, "candidate": "a@1", "state": "accepted"}})
        daemon.last_config = mock.Mock(side_effect=AssertionError("must not resolve new defaults"))
        self.assertEqual(daemon.start({"candidate": "a@1", "op_id": OP})["paper_id"], 8)

    def test_reusing_symbols_op_id_with_universe_pool_conflicts_while_pool_retry_replays(self):
        profile = SimpleNamespace(service_root=Path("/isolated"), database="test")
        dated = {**ROW, "market_day": "2026-03-01", "created_at": datetime(2026, 3, 15, 12, 0)}
        pool = ["BTCUSDT", "ETHUSDT"]
        pool_row = {**dated, "symbols": pool}
        with mock.patch.object(db, "connect", connection), \
                mock.patch.object(runs, "selection", return_value=("2026-03-01", {"universe_rule": "r"}, pool)):
            with mock.patch.object(records, "paper_start_of", return_value=dated):
                caught = refused(runs.start.__wrapped__, profile, {}, None, "a@1", None, None, op_id=OP,
                                 research=mock.Mock())
                self.assertEqual(caught.code, "OP_ID_CONFLICT")
            with mock.patch.object(records, "paper_start_of", return_value=pool_row):
                replayed = runs.start.__wrapped__(profile, {}, None, "a@1", None, None, op_id=OP, research=mock.Mock())
                self.assertEqual((replayed["paper_id"], replayed["symbols"], replayed["write_status"]),
                                 (8, pool, "replayed"))
        # Over HTTP: universe='pool' with an op_id belonging to a --symbols run refuses OP_ID_CONFLICT,
        # while a pool retry replays without starting a new run.
        daemon = serve.Daemon.__new__(serve.Daemon)
        daemon.profile, daemon.market = profile, None
        with mock.patch.object(db, "connect", connection), \
                mock.patch.object(runs.profiles, "market", return_value={}), \
                mock.patch.object(runs, "selection", return_value=("2026-03-01", {"universe_rule": "r"}, pool)):
            daemon.start_result = mock.Mock(return_value={"run": {**dated, "candidate": "a@1", "state": "accepted"}})
            with mock.patch.object(records, "paper_start_of", return_value=dated):
                caught = refused(daemon.start, {"candidate": "a@1", "universe": "pool", "op_id": OP},
                                 error=serve.Failure)
                self.assertEqual((caught.status, caught.body["code"]), (409, "OP_ID_CONFLICT"))
            daemon.start_result = mock.Mock(return_value={"run": {**pool_row, "candidate": "a@1", "state": "accepted"}})
            with mock.patch.object(records, "paper_start_of", return_value=pool_row):
                replayed = daemon.start({"candidate": "a@1", "universe": "pool", "op_id": OP})
                self.assertEqual((replayed["paper_id"], replayed["symbols"]), (8, pool))

    def test_stop_intent_survives_controller_state_loss(self):
        with tempfile.TemporaryDirectory() as root:
            profile = SimpleNamespace(service_root=Path(root), database="test")
            output = runs.run_dir(profile, 8) / "out"
            with mock.patch.object(db, "connect", connection), mock.patch.object(records, "read_paper_run"), \
                    mock.patch.object(records, "seal_of", return_value=None):
                self.assertEqual(runs.request_stop.__wrapped__(profile, 8)["state"], "stopping")
            self.assertEqual((output / "STOP").read_bytes(), b"")
            replacement = serve.Daemon.__new__(serve.Daemon)
            replacement.profile = profile
            replacement.stopping = set()
            replacement.runs = mock.Mock(return_value={"runs": [{"paper_id": 8, "state": "running"}]})
            replacement.stop = mock.Mock()
            replacement.write_months = mock.Mock()
            replacement.release_route = replacement.release_name = None
            replacement.seal_found()
            replacement.stop.assert_called_once_with(8)


class RemoteHttpTests(unittest.TestCase):
    def setUp(self):
        self.daemon = mock.Mock(profile=SimpleNamespace(database="test"))
        self.http, self.port = server(self.daemon)
        self.addCleanup(self.http.server_close)
        self.addCleanup(self.http.shutdown)

    def test_resume_is_a_business_operation(self):
        self.daemon.resume_run.return_value = {"paper_id": 8, "state": "resuming"}
        headers = {"Content-Type": "application/json"}
        self.assertEqual(request(self.port, "POST", "/api/paper/runs/8/resume", b"{}", **headers),
                         (200, {"paper_id": 8, "state": "resuming"}))
        self.daemon.resume_run.assert_called_once_with(8)

    def test_receipt_and_logs_are_scoped_business_reads(self):
        self.daemon.start_result.return_value = {"run": None}
        self.assertEqual(request(self.port, "GET", f"/api/paper/starts?op_id={OP}"), (200, {"run": None}))
        self.daemon.logs.return_value = {"text": "native output"}
        self.assertEqual(request(self.port, "GET", "/api/paper/runs/8/logs?source=egress&tail=50"),
                         (200, {"text": "native output"}))
        self.daemon.logs.assert_called_once_with(8, "egress", 50)
        self.assertEqual(request(self.port, "GET", "/api/paper/runs/8/logs?tail=x")[0], 400)


class LogBoundaryTests(unittest.TestCase):
    def daemon(self):
        daemon = serve.Daemon.__new__(serve.Daemon)
        daemon.profile = SimpleNamespace(service_root=Path("/isolated"), database="test")
        return daemon

    def test_no_path_or_container_name_is_accepted_from_the_page(self):
        with mock.patch.object(runs, "_docker") as docker:
            for source, tail in [("../../secret", 200), ("another-container", 1), ("runner", 0), ("runner", 2001)]:
                with self.subTest(source=source, tail=tail), self.assertRaises(serve.Failure):
                    self.daemon().logs(8, source, tail)
            docker.assert_not_called()

    def test_live_output_has_a_byte_bound_and_sealed_logs_use_retained_originals(self):
        daemon = self.daemon()
        with mock.patch.object(db, "connect", connection), mock.patch.object(records, "read_paper_run"), \
                mock.patch.object(records, "seal_of", return_value=None) as sealed, \
                mock.patch.object(runs, "_docker", return_value=SimpleNamespace(returncode=0, stdout=b"x" * 400000, stderr=b"")) as docker:
            found = daemon.logs(8, "runner", 10)
            self.assertEqual(len(found["text"]), 262144)
            self.assertFalse(found["sealed"])
            self.assertEqual(docker.call_args.args, ("logs", "--tail", "10", runs.names(daemon.profile, 8)["runner"]))
            docker.reset_mock()
            sealed.return_value = {"status": "complete"}
            daemon.files = mock.Mock(return_value={"runner.log": b"first\nlast\n"})
            self.assertEqual(daemon.logs(8, "runner", 1)["text"], "last")
            docker.assert_not_called()
