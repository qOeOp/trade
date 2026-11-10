"""A lost HTTP result never becomes permission to dispatch the same operator intent twice."""

from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack
import copy
import fcntl
import hashlib
import os
import threading
from unittest.mock import Mock, patch

from engine.live_errors import LiveRefusal
from live import host as host_runtime
from live import credentials, requests, runs, state
from tests.live.test_runs import IDENTITY, LiveFixture


class LiveRequestTests(LiveFixture):
    REQUEST = "request-one"

    def command(self, action="start", *, run_id=None, inputs=None):
        return {"action": action, "target": {"run_id": run_id or self.run_id}, "inputs": inputs or {}}

    def dispatch(self, operation, *, request_id=REQUEST, command=None):
        return requests.dispatch(self.root, request_id, command or self.command(), operation)

    def test_new_admission_holds_original_lock_before_claim_but_never_intercepts_repeats_or_conflicts(self):
        command = self.command("stop")
        def admit(root):
            self.assertIsNone(requests.read_locked(root, self.REQUEST))
            with (root / "account.lock").open() as stream, self.assertRaises(BlockingIOError):
                fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        admission = Mock(side_effect=admit)
        operation = lambda root, _: runs.stop_locked(root, self.run_id)
        original = requests.dispatch(self.root, self.REQUEST, command, operation, admit_new=admission)
        admission.assert_called_once()
        refused = Mock(side_effect=state.fail("LIVE_RELEASE_UNAVAILABLE", "not current"))
        untouched = Mock(side_effect=AssertionError("duplicate operation"))
        repeat = requests.dispatch(self.root, self.REQUEST, command, untouched, admit_new=refused)
        self.assertEqual(repeat, {"request": original["request"]})
        with self.assertRaises(LiveRefusal) as found:
            requests.dispatch(self.root, self.REQUEST, self.command("start"), untouched, admit_new=refused)
        self.assertEqual(found.exception.code, "LIVE_REQUEST_CONFLICT")
        refused.assert_not_called()
        untouched.assert_not_called()

    def test_new_admission_refusal_precedes_claim_and_closed_id_bypasses_it(self):
        refused = Mock(side_effect=state.fail("LIVE_RELEASE_UNAVAILABLE", "handover"))
        operation = Mock(side_effect=AssertionError("refused operation"))
        with self.assertRaises(LiveRefusal):
            requests.dispatch(self.root, self.REQUEST, self.command(), operation, admit_new=refused)
        self.assertFalse((self.root / "requests" / (self.REQUEST + ".jsonl")).exists())
        closed = requests.recover(self.root, self.REQUEST)
        repeat = requests.dispatch(self.root, self.REQUEST, self.command(), operation, admit_new=refused)
        self.assertEqual(repeat, {"request": closed})
        refused.assert_called_once()
        operation.assert_not_called()

    def launch(self, root, request_id):
        return runs.launch_locked(root, self.run_id, self.credentials, "run", request_id=request_id)

    def fake_launch(self):
        stack = ExitStack()
        stack.enter_context(patch.object(runs, "_network", return_value={"network": "network"}))
        stack.enter_context(patch.object(host_runtime, "checked", return_value="c" * 64))
        stack.enter_context(patch.object(host_runtime, "container_identity", return_value={"Id": "c" * 64}))
        stack.enter_context(patch.object(runs, "_runner", return_value={"Id": "c" * 64, "State": {"Running": True}}))
        stack.enter_context(patch.object(runs, "_recycle_others"))
        return stack

    def test_duplicate_after_success_or_response_loss_never_repeats_key_query_or_runner(self):
        with self.fake_launch():
            first = self.dispatch(self.launch)
            replay = self.dispatch(Mock(side_effect=AssertionError("duplicate operation")))
        self.assertEqual(first["request"]["outcome"], "effect_recorded")
        self.assertEqual(replay, {"request": first["request"]})
        self.key_limits.assert_called_once()
        rows = state.events(self.root / "requests" / (self.REQUEST + ".jsonl"))
        self.assertEqual(len(rows), 1)  # success already has its original lifecycle anchor
        events = state.events(self.directory / "lifecycle.jsonl")
        launches = [row for row in events if row["event"] == "launch_requested"]
        self.assertEqual(len(launches), 1)
        self.assertEqual(launches[0]["request_id"], self.REQUEST)
        self.assertNotIn("request_id", next(row for row in events if row["event"] == "container_started"))

    def test_same_id_with_different_inputs_is_rejected_without_operation(self):
        with self.fake_launch():
            self.dispatch(self.launch)
            operation = Mock()
            with self.assertRaises(LiveRefusal) as caught:
                self.dispatch(operation, command=self.command(inputs={"confirm_real_orders": "a" * 64}))
        self.assertEqual(caught.exception.code, "LIVE_REQUEST_CONFLICT")
        operation.assert_not_called()

    def test_bool_and_number_are_not_the_same_canonical_command(self):
        self.dispatch(lambda root, _: runs.stop_locked(root, self.run_id),
                      command=self.command("stop", inputs={"example": 1}))
        with self.assertRaises(LiveRefusal) as caught:
            self.dispatch(Mock(), command=self.command("stop", inputs={"example": True}))
        self.assertEqual(caught.exception.code, "LIVE_REQUEST_CONFLICT")

    def test_new_intent_can_reference_the_identical_running_launch_without_restarting(self):
        command = self.command(inputs={"confirm_real_orders": self.manifest["source"]["source_sha256"]})
        with self.fake_launch():
            self.dispatch(self.launch, command=command)
            result = self.dispatch(self.launch, request_id="second-start-intent", command=command)
        self.assertEqual(result["result"]["write_status"], "replayed")
        self.assertEqual(result["request"]["outcome"], "effect_recorded")
        self.key_limits.assert_called_once()
        self.assertEqual(sum(row["event"] == "launch_requested" for row in runs._host_events(self.directory)), 1)

    def test_prior_preflight_receipt_survives_its_cleanup_and_a_later_launch(self):
        def preflight(root, request_id):
            return runs.launch_locked(root, self.run_id, self.credentials, "preflight", request_id=request_id)
        with self.fake_launch():
            self.dispatch(preflight, command=self.command("preflight"))
        state.append(self.directory / "lifecycle.jsonl", "recycled", self.run_id,
                     state="preflight_complete", exit_code=0)
        state.append(self.directory / "lifecycle.jsonl", "launch_requested", self.run_id,
                     mode="preflight", container="later", credentials_path=str(self.credentials), request_id="later-request")
        with patch.object(runs, "_runner", side_effect=AssertionError("old recycled runner inspected")):
            self.assertEqual(requests.view(self.root, self.REQUEST)["outcome"], "effect_recorded")

    def test_created_runner_is_not_a_completed_control_effect(self):
        with self.fake_launch(), patch.object(runs, "_runner", return_value={"State": {"Running": False, "Status": "created"}}):
            result = self.dispatch(self.launch)
            self.assertEqual(result["request"]["outcome"], "outcome_unknown")
            self.assertEqual(requests.recover(self.root, self.REQUEST)["outcome"], "outcome_unknown")

    def test_network_failure_before_launch_keeps_original_event_boundary_and_needs_explicit_recovery(self):
        with patch.object(runs, "_network", side_effect=OSError("network interrupted")), \
                patch.object(runs, "_recycle_others"):
            with self.assertRaises(OSError):
                self.dispatch(self.launch)
        self.assertFalse(any(row["event"] == "launch_requested" for row in runs._host_events(self.directory)))
        self.assertEqual(requests.view(self.root, self.REQUEST)["outcome"], "outcome_unknown")
        self.assertEqual(runs._active(self.root), self.run_id)
        self.key_limits.reset_mock()
        with self.assertRaises(LiveRefusal) as caught:
            runs.launch(self.root, self.run_id, self.credentials, "run", scope=self.scope)
        self.assertEqual(caught.exception.code, "LIVE_REQUEST_UNRESOLVED")
        self.key_limits.assert_not_called()
        runs.stop(self.root, self.run_id)  # the unknown start must not block STOP
        result = requests.recover(self.root, self.REQUEST)
        self.assertEqual((result["outcome"], result["code"]), ("refused", "LIVE_REQUEST_NOT_DISPATCHED"))
        self.assertEqual(runs._active(self.root), self.run_id)  # request recovery is not account release
        runs.status(self.root, self.run_id)
        self.assertIsNone(runs._active(self.root))
        self.assertEqual(len(state.events(self.root / "requests" / (self.REQUEST + ".jsonl"))), 2)
        self.dispatch(Mock(side_effect=AssertionError("interrupted ID replayed")))

    def test_crash_after_launch_intent_with_missing_runner_stays_unknown_and_stops_still_work(self):
        with self.fake_launch(), patch.object(host_runtime, "checked", side_effect=SystemExit("crash before Docker reply")):
            with self.assertRaises(SystemExit):
                self.dispatch(self.launch)
        with patch.object(runs, "_runner", return_value=None):
            self.assertEqual(requests.recover(self.root, self.REQUEST)["outcome"], "outcome_unknown")
            self.assertEqual(self.dispatch(Mock(side_effect=AssertionError("never replay")))["request"]["outcome"],
                             "outcome_unknown")
            for action in ("prepare", "preflight", "start", "reconcile"):
                with self.subTest(action=action), self.assertRaises(LiveRefusal) as caught:
                    self.dispatch(Mock(), request_id="new-" + action + "-request", command=self.command(action))
                self.assertEqual(caught.exception.code, "LIVE_REQUEST_UNRESOLVED")
            stopped = self.dispatch(lambda root, _: runs.stop_locked(root, self.run_id),
                                    request_id="stop-request", command=self.command("stop"))
            self.assertEqual(stopped["request"]["outcome"], "effect_recorded")
            with patch.object(runs, "_recycle"):
                self.assertTrue(runs.status(self.root, self.run_id)["account_owned"])

    def test_partial_host_journal_cannot_be_used_to_prove_no_dispatch(self):
        with self.assertRaises(SystemExit):
            self.dispatch(lambda *_: (_ for _ in ()).throw(SystemExit()))
        (self.directory / "lifecycle.jsonl").write_bytes(b'{"event":"launch_')
        self.assertEqual(requests.recover(self.root, self.REQUEST)["outcome"], "outcome_unknown")

    def test_known_key_refusal_before_effect_records_only_code_and_replays_without_key_read(self):
        self.key_limits.side_effect = LiveRefusal("LIVE_KEY_WITHDRAWAL", "sensitive endpoint detail")
        with self.assertRaises(LiveRefusal):
            self.dispatch(self.launch)
        result = self.dispatch(Mock(side_effect=AssertionError("refused command replayed")))
        self.assertEqual(result["request"]["outcome"], "refused")
        self.assertEqual(result["request"]["code"], "LIVE_KEY_WITHDRAWAL")
        journal = (self.root / "requests" / (self.REQUEST + ".jsonl")).read_text()
        self.assertNotIn("sensitive endpoint detail", journal)
        self.assertFalse((self.root / "account.jsonl").exists())

    def test_two_concurrent_identical_submissions_execute_once_under_original_lock(self):
        entered, second_started, release = threading.Event(), threading.Event(), threading.Event()
        calls = []
        def operation(root, request_id):
            calls.append(request_id)
            entered.set()
            self.assertTrue(release.wait(3))
            return runs.stop_locked(root, self.run_id)
        def second():
            second_started.set()
            return self.dispatch(operation, command=self.command("stop"))
        with ThreadPoolExecutor(max_workers=2) as pool:
            first = pool.submit(self.dispatch, operation, command=self.command("stop"))
            self.assertTrue(entered.wait(3))
            duplicate = pool.submit(second)
            self.assertTrue(second_started.wait(3))
            self.assertFalse(duplicate.done())
            release.set()
            self.assertEqual(first.result()["request"], duplicate.result()["request"])
        self.assertEqual(calls, [self.REQUEST])

    def test_credential_upload_is_never_replayed_even_if_no_file_was_written(self):
        ref = "a" * 32
        command = {"action": "credential_save", "target": {"credential_ref": ref}, "inputs": {}}
        with self.assertRaises(SystemExit):
            self.dispatch(lambda *_: (_ for _ in ()).throw(SystemExit()), command=command)
        self.assertEqual(self.dispatch(Mock(side_effect=AssertionError("secret body replayed")), command=command)
                         ["request"]["outcome"], "outcome_unknown")
        recovered = requests.recover(self.root, self.REQUEST)
        self.assertEqual(recovered["code"], "LIVE_REQUEST_NOT_DISPATCHED")
        self.dispatch(Mock(side_effect=AssertionError("recovered secret body replayed")), command=command)

    def test_saved_credential_without_selection_keeps_unknown_until_proven(self):
        ref = "a" * 32
        command = {"action": "credential_save", "target": {"credential_ref": ref}, "inputs": {}}
        def operation(root, _):
            state.private_directory(root / "credentials")
            state.write_new(root / "credentials" / "metadata.jsonl", state.encode(
                {"event": "saved", "credential_ref": ref, "observed_ns": 10**30}))
            raise SystemExit()
        with self.assertRaises(SystemExit):
            self.dispatch(operation, command=command)
        self.assertEqual(requests.recover(self.root, self.REQUEST)["outcome"], "outcome_unknown")
        with self.assertRaises(LiveRefusal) as caught:
            self.dispatch(Mock(), request_id="another-request", command=self.command())
        self.assertEqual(caught.exception.code, "LIVE_REQUEST_UNRESOLVED")

    def test_secret_names_never_enter_canonical_journal(self):
        for name in ("api_key", "api_secret", "authorization", "signature"):
            with self.subTest(name=name), self.assertRaises(LiveRefusal) as caught:
                self.dispatch(Mock(), command=self.command(inputs={name: "FAKE_SECRET_SENTINEL"}))
            self.assertEqual(caught.exception.code, "LIVE_REQUEST_COMMAND")
        self.assertFalse((self.root / "requests").exists())

    def test_get_does_not_mutate_or_recover_unknown_request(self):
        with self.assertRaises(SystemExit):
            self.dispatch(lambda *_: (_ for _ in ()).throw(SystemExit()))
        before = {str(p): p.read_bytes() for p in self.root.rglob("*") if p.is_file()}
        with patch.object(runs, "_credentials", side_effect=AssertionError("no key read")):
            self.assertEqual(requests.view(self.root, self.REQUEST)["outcome"], "outcome_unknown")
        self.assertEqual(before, {str(p): p.read_bytes() for p in self.root.rglob("*") if p.is_file()})

    def test_missing_get_is_pure_and_explicit_resolve_closes_only_the_id(self):
        with state.serialized(self.root):
            pass
        with self.assertRaises(LiveRefusal) as caught:
            requests.view(self.root, self.REQUEST)
        self.assertEqual(caught.exception.code, "LIVE_REQUEST_MISSING")
        self.assertFalse((self.root / "requests").exists())
        expected = {"request_id": self.REQUEST, "action": "unknown", "target": {}, "outcome": "refused",
                    "code": "LIVE_REQUEST_CLOSED_UNCLAIMED"}
        self.assertEqual(requests.recover(self.root, self.REQUEST), expected)
        path = self.root / "requests" / (self.REQUEST + ".jsonl")
        rows = state.events(path)
        self.assertEqual(len(rows), 1)
        self.assertEqual(set(rows[0]), {"event", "observed_ns"})
        self.assertEqual(rows[0]["event"], "closed_unclaimed")
        before = path.read_bytes()
        with patch.object(state, "write_new", side_effect=AssertionError("closed ID was rewritten")), \
                patch.object(requests, "same_command", side_effect=AssertionError("closed ID has no command")):
            self.assertEqual(requests.view(self.root, self.REQUEST), expected)
            self.assertEqual(requests.recover(self.root, self.REQUEST), expected)
            self.assertEqual(self.dispatch(Mock(side_effect=AssertionError("closed ID executed"))), {"request": expected})
            self.assertEqual(self.dispatch(Mock(side_effect=AssertionError("changed closed ID executed")),
                                           command=self.command("stop")), {"request": expected})
        self.assertEqual(path.read_bytes(), before)
        record = requests.read_locked(self.root, self.REQUEST)
        self.assertTrue(requests.is_closed(record))
        self.assertNotIn("command", record)
        self.assertNotIn("disposition", record)
        with state.serialized(self.root) as root:
            requests.require_clear(root)  # terminal closed IDs do not block other work

    def test_resolve_winning_the_lock_prevents_a_waiting_dispatch(self):
        attempted = threading.Event()
        operation = Mock(side_effect=AssertionError("late operation executed"))
        def dispatch():
            attempted.set()
            return self.dispatch(operation)
        with ThreadPoolExecutor(max_workers=1) as pool:
            with state.serialized(self.root) as root:
                pending = pool.submit(dispatch)
                self.assertTrue(attempted.wait(3))
                closed = requests.recover_locked(root, self.REQUEST)
                self.assertFalse(pending.done())
            self.assertEqual(pending.result()["request"], closed)
        operation.assert_not_called()

    def test_dispatch_winning_the_lock_keeps_its_claim_when_resolve_waits(self):
        entered, resolving, release = threading.Event(), threading.Event(), threading.Event()
        calls = []
        def operation(root, request_id):
            calls.append(request_id)
            entered.set()
            self.assertTrue(release.wait(3))
            return runs.stop_locked(root, self.run_id)
        def resolve():
            resolving.set()
            return requests.recover(self.root, self.REQUEST)
        with ThreadPoolExecutor(max_workers=2) as pool:
            dispatched = pool.submit(self.dispatch, operation, command=self.command("stop"))
            self.assertTrue(entered.wait(3))
            resolved = pool.submit(resolve)
            self.assertTrue(resolving.wait(3))
            self.assertFalse(resolved.done())
            release.set()
            result = dispatched.result()
            self.assertEqual(resolved.result(), result["request"])
        self.assertEqual(calls, [self.REQUEST])
        record = requests.read_locked(self.root, self.REQUEST)
        self.assertFalse(requests.is_closed(record))
        self.assertEqual(record["command"]["action"], "stop")
        self.assertEqual(result["request"]["outcome"], "effect_recorded")
        self.assertEqual(len(state.events(self.root / "requests" / (self.REQUEST + ".jsonl"))), 1)

    def test_close_also_wins_against_validation_finishing_outside_the_lock(self):
        validated, resume = threading.Event(), threading.Event()
        original = requests._canonical
        def validation(command):
            result = original(command)
            validated.set()
            self.assertTrue(resume.wait(3))
            return result
        operation = Mock(side_effect=AssertionError("delayed validated operation executed"))
        with patch.object(requests, "_canonical", side_effect=validation), ThreadPoolExecutor(max_workers=1) as pool:
            pending = pool.submit(self.dispatch, operation)
            self.assertTrue(validated.wait(3))
            closed = requests.recover(self.root, self.REQUEST)
            resume.set()
            self.assertEqual(pending.result()["request"], closed)
        operation.assert_not_called()

    def test_an_existing_unknown_launch_cannot_be_closed_unclaimed(self):
        with self.fake_launch(), patch.object(host_runtime, "checked", side_effect=SystemExit()):
            with self.assertRaises(SystemExit):
                self.dispatch(self.launch)
        path = self.root / "requests" / (self.REQUEST + ".jsonl")
        before = path.read_bytes()
        with patch.object(runs, "_runner", return_value=None), \
                patch.object(state, "write_new", side_effect=AssertionError("unknown launch overwritten")):
            self.assertEqual(requests.recover(self.root, self.REQUEST)["outcome"], "outcome_unknown")
        self.assertEqual(path.read_bytes(), before)
        self.assertFalse(requests.is_closed(requests.read_locked(self.root, self.REQUEST)))

    def test_bad_or_nonregular_existing_records_are_never_closed_or_overwritten(self):
        directory = state.private_directory(self.root / "requests")
        samples = [b"", b'{"event":"claimed"}', b'not-json\n',
                   state.encode({"event": "closed_unclaimed", "observed_ns": 1, "code": "extra"}),
                   state.encode({"event": "closed_unclaimed", "observed_ns": True}),
                   state.encode({"event": "closed_unclaimed", "observed_ns": -1}),
                   state.encode({"event": "closed_unclaimed", "observed_ns": 1}) * 2]
        for index, data in enumerate(samples):
            request_id = "bad-record-" + str(index)
            path = directory / (request_id + ".jsonl")
            state.write_new(path, data)
            with self.subTest(index=index), patch.object(state, "write_new", side_effect=AssertionError("bad record replaced")):
                with self.assertRaises(LiveRefusal):
                    requests.recover(self.root, request_id)
            self.assertEqual(path.read_bytes(), data)
        for kind in ("directory", "symlink", "fifo"):
            request_id = "bad-" + kind + "-record"
            path = directory / (request_id + ".jsonl")
            if kind == "directory":
                path.mkdir()
            elif kind == "symlink":
                path.symlink_to(directory / "absent-target")
            else:
                os.mkfifo(path)
            with self.subTest(kind=kind), patch.object(state, "write_new", side_effect=AssertionError("nonregular record replaced")):
                with self.assertRaises(LiveRefusal):
                    requests.recover(self.root, request_id)
            self.assertTrue(os.path.lexists(path))

    def test_closing_still_uses_exclusive_create_if_an_outside_writer_ignores_the_lock(self):
        original = state.write_new
        data = state.encode({"event": "claimed", "observed_ns": 1, "command": self.command()})
        def raced(path, body):
            original(path, data)
            original(path, body)
        with patch.object(state, "write_new", side_effect=raced), self.assertRaises(FileExistsError):
            requests.recover(self.root, self.REQUEST)
        self.assertEqual((self.root / "requests" / (self.REQUEST + ".jsonl")).read_bytes(), data)


class PartialPrepareTests(LiveFixture):
    def setUp(self):
        super().setUp()
        self.new_id = "new-prepared"
        self.source = b"class Source: pass\n"
        self.universe = self.root / "universe.json"
        state.write_new(self.universe, b"{}")
        self.config = {"budget_usdt": "90", "max_loss_usdt": "2",
                       "duration_seconds": 8100, "memory": "2g", "single_order_source_reviewed": True}
        self.ref = "a" * 32
        state.append(self.directory / "lifecycle.jsonl", "prepared", self.run_id)
        with state.serialized(self.root) as root:
            credentials.save_locked(root, self.ref, "example-key", "example-secret")
        self.credentials = self.root / "credentials" / (self.ref + ".json")
        self.command = {"action": "prepare", "target": {"run_id": self.new_id, "credential_ref": self.ref},
                        "inputs": {"research_at": "a" * 32, "candidate": "original@1", "symbols": ["BTCUSDT"],
                                   "source_sha256": hashlib.sha256(self.source).hexdigest(), "entry_class": "Source",
                                   "universe_sha256": hashlib.sha256(b"{}").hexdigest(), "runtime": IDENTITY["image_ref"],
                                   "config": self.config}}
        origin = {"strategy_id": "original", "revision": 1, "source": self.source, "entry_class": "Source",
                  "source_sha256": hashlib.sha256(self.source).hexdigest(), "runtime_contract": IDENTITY["runtime_contract"]}
        for patcher in (patch.object(runs.db, "read_as_of"),
                        patch.object(runs.strategies, "read_candidate", return_value=origin),
                        patch("engine.load.read_universe"),
                        patch.object(runs.image, "resolve", return_value=IDENTITY),
                        patch.object(runs.image, "inspect_runtime", return_value={}),
                        patch.object(runs.image, "require_main_build")):
            patcher.start()
            self.addCleanup(patcher.stop)

    def prepare(self, root, request_id, *, recover=False):
        return runs.prepare_locked(root, self.new_id, object(), "a" * 32, "original@1", ["BTCUSDT"], self.universe,
                                    self.credentials, IDENTITY["image_ref"], **self.config,
                                    request_id=request_id, credential_ref=self.ref,
                                    recover_partial=recover)

    def test_partial_fixed_prepare_is_completed_only_by_explicit_local_recovery(self):
        original = state.write_new
        def interrupted(path, data):
            if path.name == "universe.json" and path.parent.name == "inputs":
                raise SystemExit()
            original(path, data)
        with patch.object(state, "write_new", side_effect=interrupted), self.assertRaises(SystemExit):
            requests.dispatch(self.root, "prepare-request", self.command, self.prepare)
        directory = state.directory(self.root, self.new_id)
        self.assertEqual((directory / "inputs" / "strategy.py").read_bytes(), self.source)
        result = requests.dispatch(self.root, "prepare-request", self.command,
                                   Mock(side_effect=AssertionError("duplicate did preparation")))
        self.assertEqual(result["request"]["outcome"], "outcome_unknown")
        with state.serialized(self.root) as root:
            self.prepare(root, "prepare-request", recover=True)
        self.assertEqual(requests.view(self.root, "prepare-request")["outcome"], "effect_recorded")
        event = state.events(directory / "lifecycle.jsonl")[0]
        self.assertEqual((event["request_id"], event["credential_ref"]), ("prepare-request", self.ref))

    def test_recovery_does_not_overwrite_partial_bytes_or_add_other_missing_files(self):
        def interrupted(root, _):
            directory = state.directory(root, self.new_id)
            state.private_directory(directory / "inputs")
            state.write_new(directory / "inputs" / "strategy.py", b"partial")
            raise SystemExit()
        with self.assertRaises(SystemExit):
            requests.dispatch(self.root, "prepare-request", self.command, interrupted)
        directory = state.directory(self.root, self.new_id)
        with state.serialized(self.root) as root, self.assertRaises(LiveRefusal) as caught:
            self.prepare(root, "prepare-request", recover=True)
        self.assertEqual(caught.exception.code, "LIVE_RUN_CONFLICT")
        self.assertEqual((directory / "inputs" / "strategy.py").read_bytes(), b"partial")
        self.assertFalse((directory / "inputs" / "universe.json").exists())

    def test_fixed_research_commit_cannot_be_reinterpreted_in_local_recovery(self):
        changed = copy.deepcopy(self.command)
        changed["inputs"]["research_at"] = "b" * 32
        with self.assertRaises(SystemExit):
            requests.dispatch(self.root, "prepare-request", changed,
                              lambda *_: (_ for _ in ()).throw(SystemExit()))
        with state.serialized(self.root) as root, self.assertRaises(LiveRefusal) as caught:
            self.prepare(root, "prepare-request", recover=True)
        self.assertEqual(caught.exception.code, "LIVE_RUN_CONFLICT")
        self.assertFalse(state.directory(self.root, self.new_id).exists())

    def test_new_prepare_intent_references_original_effect_without_duplicating_it(self):
        first = requests.dispatch(self.root, "prepare-request", self.command, self.prepare)
        second = requests.dispatch(self.root, "second-prepare-request", self.command, self.prepare)
        self.assertEqual(second["request"]["outcome"], "effect_recorded")
        self.assertEqual(second["request"]["event_ref"], first["request"]["event_ref"])
        events = state.events(state.directory(self.root, self.new_id) / "lifecycle.jsonl")
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["request_id"], "prepare-request")
        self.assertEqual(len(state.events(self.root / "requests" / "second-prepare-request.jsonl")), 1)

    def test_new_prepare_intent_cannot_change_the_first_research_commit(self):
        requests.dispatch(self.root, "prepare-request", self.command, self.prepare)
        changed = copy.deepcopy(self.command)
        changed["inputs"]["research_at"] = "b" * 32
        with self.assertRaises(LiveRefusal) as caught:
            requests.dispatch(self.root, "second-prepare-request", changed, self.prepare)
        self.assertEqual(caught.exception.code, "LIVE_RUN_CONFLICT")
        self.assertEqual(requests.view(self.root, "second-prepare-request")["outcome"], "refused")
        original = requests.read_locked(self.root, "prepare-request")
        self.assertEqual(original["command"]["inputs"]["research_at"], "a" * 32)

    def test_legacy_start_cannot_replace_managed_file_with_a_same_key_copy(self):
        requests.dispatch(self.root, "prepare-request", self.command, self.prepare)
        duplicate = self.root / "same-key-copy.json"
        state.write_new(duplicate, self.credentials.read_bytes())
        with patch.object(runs, "_network", side_effect=AssertionError("credential guard bypassed")), \
                self.assertRaises(LiveRefusal) as caught:
            runs.launch(self.root, self.new_id, duplicate, "run", scope=self.scope)
        self.assertEqual(caught.exception.code, "LIVE_CREDENTIAL_CHANGED")

    def test_legacy_start_cannot_ignore_a_managed_version_change(self):
        requests.dispatch(self.root, "prepare-request", self.command, self.prepare)
        with state.serialized(self.root) as root:
            credentials.save_locked(root, "b" * 32, "example-key", "example-secret")
        with patch.object(runs, "_network", side_effect=AssertionError("changed version launched")), \
                self.assertRaises(LiveRefusal) as caught:
            runs.launch(self.root, self.new_id, self.credentials, "run", scope=self.scope)
        self.assertEqual(caught.exception.code, "LIVE_CREDENTIAL_CHANGED")

    def test_legacy_prepare_uses_the_managed_original_research_snapshot(self):
        requests.dispatch(self.root, "prepare-request", self.command, self.prepare)
        def legacy(commit):
            return runs.prepare(self.root, self.new_id, object(), commit, "original@1", ["BTCUSDT"], self.universe,
                                self.credentials, IDENTITY["image_ref"], scope=self.scope, **self.config)
        self.assertEqual(legacy("a" * 32)["run_id"], self.new_id)
        with self.assertRaises(LiveRefusal) as caught:
            legacy("b" * 32)
        self.assertEqual(caught.exception.code, "LIVE_RUN_CONFLICT")

    def test_preflight_validates_original_preparation_without_rebinding_its_request(self):
        requests.dispatch(self.root, "prepare-request", self.command, self.prepare)
        command = {"action": "preflight", "target": {"run_id": self.new_id}, "inputs": {}}
        def preflight(root, request_id):
            self.prepare(root, request_id)
            return runs.launch_locked(root, self.new_id, self.credentials, "preflight", request_id=request_id)
        with patch.object(runs, "_network", return_value={"network": "network"}), \
                patch.object(host_runtime, "checked", return_value="c" * 64), \
                patch.object(host_runtime, "container_identity", return_value={"Id": "c" * 64}), \
                patch.object(runs, "_runner", return_value={"State": {"Running": True}}), \
                patch.object(runs, "_recycle_others"):
            result = requests.dispatch(self.root, "preflight-request", command, preflight)
        self.assertEqual(result["request"]["outcome"], "effect_recorded")
        prepared = runs._host_events(state.directory(self.root, self.new_id))[0]
        self.assertEqual(prepared["request_id"], "prepare-request")
