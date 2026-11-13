"""A running Live run takes a confirmed new runtime image at its next flat moment (design §3.8,
docs/plans/live-continuous-step8-runtime-switch-20261113.zh.md): the control's request, the SWITCH file, the image each
launch runs on, the fallback, cancellation, the request journal, the readers of a launch's image and the page facts."""

import os
from types import SimpleNamespace
from unittest.mock import patch

from engine.live_errors import LiveRefusal
from live import compare, control, notify, requests, runs, state, views
from shared.errors import Refusal
from tests.live.authority_fixture import launch
from tests.live.test_runs import EVIDENCE, IDENTITY, LiveFixture

NEW = {**IDENTITY, "image_ref": IDENTITY["image_ref"][:-64] + "f" * 64, "image_digest": "sha256:" + "f" * 64}
REVISION = "e" * 40


class SwitchTests(LiveFixture):
    def setUp(self):
        super().setUp()
        self.events = self.directory / "out" / "events.jsonl"
        self.lifecycle = self.directory / "lifecycle.jsonl"

    def running(self, trial=EVIDENCE[0]["trial_id"]):
        self.launch_record()
        state.append(self.events, "replay_evidence", self.run_id, trial_id=trial)
        state.write_new(self.directory / "out" / "armed.json", b"{}")

    def request(self, identity=NEW, request_id="web-switch-1"):
        with patch.object(runs, "_outcome", return_value=("running", None)), \
                patch.object(runs.image, "resolve", return_value=dict(identity)), \
                patch.object(runs.image, "inspect_runtime", return_value={}), \
                patch.object(runs.image, "require_main_build", return_value=REVISION), \
                patch.object(runs, "_run_launches", return_value=0):
            return runs.request_switch_locked(self.root, self.run_id, identity["image_ref"], None, "c" * 40,
                                              request_id=request_id)

    def rows(self, *events):
        return [row for row in state.events(self.lifecycle) if row["event"] in events]

    def refused(self, code, **request):
        with self.assertRaises(LiveRefusal) as caught:
            self.request(**request)
        self.assertEqual(caught.exception.code, code)

    def test_a_confirmed_switch_is_recorded_once_with_the_arming_replay_and_writes_switch(self):
        self.refused("LIVE_SWITCH")  # no launch: not a running run
        self.running()
        self.assertEqual(self.request()["state"], "switch_requested")
        [row] = self.rows("runtime_switch_requested")
        self.assertEqual((row["runtime"], row["trial_id"], row["request_id"]),
                         ({**NEW, "build_revision": REVISION}, 7, "web-switch-1"))
        self.assertTrue((self.directory / "out" / runs.SWITCH).is_file())
        self.refused("LIVE_SWITCH")  # one switch waits at a time

    def test_a_switch_is_refused_for_its_own_image_another_contract_a_stop_or_another_replay(self):
        self.running()
        self.refused("LIVE_SWITCH", identity=IDENTITY)
        self.refused("LIVE_IDENTITY_CHANGED", identity={**NEW, "runtime_contract": "replay-contract@v9"})
        state.write_new(self.directory / "out" / "STOP", b"")
        self.refused("LIVE_SWITCH")
        os.unlink(self.directory / "out" / "STOP")
        with patch.object(runs, "_evidence", return_value=[{**EVIDENCE[0], "trial_id": 8}]):
            self.refused("LIVE_EVIDENCE_MISSING")  # the new image's evidence lacks the replay this run armed on
        self.assertEqual(self.rows("runtime_switch_requested"), [])
        self.assertFalse(os.path.lexists(self.directory / "out" / runs.SWITCH))

    def test_switch_follows_the_journal_the_restart_budget_and_a_stop(self):
        self.running()
        self.request()
        switch = self.directory / "out" / runs.SWITCH
        with patch.object(runs, "_run_launches", return_value=runs.RESTARTS_PER_HOUR):
            runs.sync_switch_locked(self.root, self.run_id, 0)
        self.assertFalse(switch.exists())  # one start left within the hour, none for a fallback: wait
        with patch.object(runs, "_run_launches", return_value=runs.RESTARTS_PER_HOUR - 1):
            runs.sync_switch_locked(self.root, self.run_id, 0)
            self.assertTrue(switch.exists())
            runs.cancel_switch_locked(self.root, self.run_id, "web-cancel-1")
            self.assertFalse(switch.exists())
            runs.sync_switch_locked(self.root, self.run_id, 0)
        self.assertFalse(switch.exists())
        [row] = self.rows("runtime_switch_canceled")
        self.assertEqual((row["reason"], row["cancel_request_id"], row["request_id"]), ("user", "web-cancel-1", "web-switch-1"))
        with self.assertRaises(LiveRefusal):
            runs.cancel_switch_locked(self.root, self.run_id)
        self.request(request_id="web-switch-2")
        runs.stop_locked(self.root, self.run_id)
        self.assertFalse(switch.exists())
        self.assertEqual([row["reason"] for row in self.rows("runtime_switch_canceled")], ["user", "stopped"])

    def take(self, *native, image=True, mode="run"):
        for event in native:
            state.append(self.events, event, self.run_id)
        latest = runs._latest_launch(self.directory)
        with patch.object(runs.host_runtime, "inspect", return_value={"Id": "x"} if image else None):
            runtime, taken, rows = runs._launch_runtime_locked(self.directory, self.run_id, self.manifest, latest, mode)
        for event, fields in rows:
            state.append(self.lifecycle, event, self.run_id, **fields)
        return runtime, taken

    def launch(self, runtime, request_id=None):
        state.append(self.lifecycle, "launch_requested", self.run_id, mode="run", container="runner",
                     credentials_path=str(self.credentials), image_ref=runtime["image_ref"],
                     **({"switch_request_id": request_id} if request_id else {}))

    def test_the_next_start_after_a_flat_end_takes_the_switch_and_only_that(self):
        self.running()
        self.request()
        self.assertEqual(self.take("interrupted"), (IDENTITY, None))  # not flat: the old image again
        self.assertEqual(self.take("rewarming"), ({**NEW, "build_revision": REVISION}, "web-switch-1"))
        [row] = self.rows("runtime_switched")
        self.assertEqual((row["image_ref"], row["previous"]), (NEW["image_ref"], IDENTITY["image_ref"]))
        self.assertIsNone(runs.pending_switch(self.directory))
        self.launch(NEW, "web-switch-1")
        launch = runs._latest_launch(self.directory)
        self.assertEqual(runs.launch_runtime(self.directory, self.manifest, launch)["image_ref"], NEW["image_ref"])
        state.append(self.events, "warmup", self.run_id)
        self.assertEqual(self.take("interrupted")[0]["image_ref"], NEW["image_ref"])  # it stays on the new image

    def test_a_held_flat_end_takes_it_and_a_missing_image_keeps_the_old_one(self):
        self.running()
        self.request()
        self.assertEqual(self.take("held_flat", image=False), (IDENTITY, None))
        [row] = self.rows("runtime_switch_failed")
        self.assertEqual(row["code"], "RUNTIME_UNAVAILABLE")
        self.assertIsNone(runs.pending_switch(self.directory))

    def test_a_new_image_that_ends_before_its_warm_up_falls_back_once(self):
        self.running()
        self.request()
        self.take("rewarming")
        self.launch(NEW, "web-switch-1")
        runtime, taken = self.take("interrupted")  # no warmup since the switch's launch
        self.assertEqual((runtime, taken), (IDENTITY, None))
        [row] = self.rows("runtime_switch_failed")
        self.assertEqual((row["code"], row["request_id"]), ("LIVE_RUNTIME_START", "web-switch-1"))
        self.launch(IDENTITY)
        self.assertEqual(self.take("interrupted"), (IDENTITY, None))  # once: nothing more to fall back from
        self.assertEqual(len(self.rows("runtime_switch_failed")), 1)

    def test_a_reconciliation_after_a_new_image_that_did_not_start_falls_back_and_takes_no_switch(self):
        self.running()
        self.request()
        self.assertEqual(self.take("rewarming", mode="reconcile"), (IDENTITY, None))  # only a run start takes it
        self.assertIsNotNone(runs.pending_switch(self.directory))
        self.take("rewarming")
        self.launch(NEW, "web-switch-1")
        self.assertEqual(self.take("interrupted", mode="reconcile"), (IDENTITY, None))
        self.assertEqual([row["code"] for row in self.rows("runtime_switch_failed")], ["LIVE_RUNTIME_START"])

    def test_a_run_start_takes_the_switch_records_it_after_the_launch_and_runs_the_new_image(self):
        self.running()
        self.request()
        self.assertTrue((self.directory / "out" / runs.SWITCH).is_file())
        state.append(self.events, "rewarming", self.run_id, switch=True)
        started = []

        def identity(*args, **kwargs):
            started.append(kwargs["runtime"])
            return {"Id": "c" * 64}

        with patch.object(runs, "_runner", return_value={"State": {"Running": False, "ExitCode": 3}}), \
                patch.object(runs, "_network", return_value={"network": "network"}), \
                patch.object(runs.host_runtime, "inspect", return_value={"Id": "x"}), \
                patch.object(runs.host_runtime, "container_identity", side_effect=identity), \
                patch.object(runs.host_runtime, "checked", return_value="c" * 64) as checked:
            self.assertEqual(launch(self.root, self.run_id, self.credentials, "run", scope=self.scope)["state"],
                             "starting")
        self.assertIn(NEW["image_ref"], checked.call_args.args)
        self.assertEqual(started[0]["image_ref"], NEW["image_ref"])
        rows = [row for row in state.events(self.lifecycle) if row["event"] in {"launch_requested", "runtime_switched"}]
        self.assertEqual([row["event"] for row in rows][-2:], ["launch_requested", "runtime_switched"])
        self.assertEqual((rows[-2]["image_ref"], rows[-2]["switch_request_id"]), (NEW["image_ref"], "web-switch-1"))
        self.assertFalse(os.path.lexists(self.directory / "out" / runs.SWITCH))

    def test_switch_needs_room_for_the_new_start_and_one_fallback_within_the_hour(self):
        self.running()
        self.request()
        switch = self.directory / "out" / runs.SWITCH
        now = max(row["observed_ns"] for row in state.events(self.lifecycle))
        for _ in range(runs.RESTARTS_PER_HOUR - 2):
            state.append(self.lifecycle, "launch_requested", self.run_id, mode="run")
        runs.sync_switch_locked(self.root, self.run_id, now)
        self.assertTrue(switch.exists())  # RESTARTS_PER_HOUR - 1 launches: two more allowed
        state.append(self.lifecycle, "launch_requested", self.run_id, mode="run")
        runs.sync_switch_locked(self.root, self.run_id, now)
        self.assertFalse(switch.exists())  # only one more: the new image would have no fallback
        self.assertTrue(runs.restarts_due(self.directory, now))

    def test_a_switch_refused_by_an_image_or_ledger_check_is_recorded_as_refused(self):
        self.running()
        command = {"action": "runtime_switch", "target": {"run_id": self.run_id}, "inputs": {}}

        unread = Refusal("LEDGER_UNAVAILABLE", "the ledger is not reachable", write_status="not_written")
        with patch.object(runs, "_evidence", side_effect=unread):
            with self.assertRaises(LiveRefusal) as caught:
                self.request()
        self.assertEqual(caught.exception.code, "LIVE_SWITCH_CHECK")
        self.assertIn("LEDGER_UNAVAILABLE", caught.exception.message)

        def unreadable(root, request_id):
            raise OSError("ledger unreachable")

        with self.assertRaises(OSError):
            requests.dispatch(self.root, "web-switch-ledger", command, unreadable)
        view = requests.view(self.root, "web-switch-ledger")
        self.assertEqual((view["outcome"], view.get("code")), ("refused", "LIVE_SWITCH_CHECK"))
        requests.require_clear(self.root)  # a later restart is not blocked

    def test_a_launch_naming_an_image_no_switch_confirmed_is_refused(self):
        self.launch(NEW)
        with self.assertRaises(LiveRefusal) as caught:
            runs.launch_runtime(self.directory, self.manifest, runs._latest_launch(self.directory))
        self.assertEqual(caught.exception.code, "LIVE_IDENTITY_CHANGED")
        self.assertEqual(runs.launch_runtime(self.directory, self.manifest, None), IDENTITY)

    def test_a_runner_is_checked_against_the_image_its_launch_names_and_the_egress_against_the_manifest(self):
        self.running()
        self.request()
        self.take("rewarming")
        self.launch(NEW, "web-switch-1")
        resources = {**self.inspected("egress"), **self.inspected()}
        image = {**resources[("image", IDENTITY["image_ref"])], "Id": "sha256:" + "9" * 64, "RepoDigests": [NEW["image_ref"]]}
        on_new = {**resources[("container", "runner")], "Image": image["Id"],
                  "Config": {**resources[("container", "runner")]["Config"], "Image": NEW["image_ref"]}}
        launch = runs._latest_launch(self.directory)
        with patch.object(runs.host_runtime, "docker", side_effect=self.docker_view(
                {**resources, ("container", "runner"): on_new, ("image", NEW["image_ref"]): image}, [])):
            self.assertIsNotNone(runs._runner(self.root, self.run_id, self.directory, self.manifest, launch))
            names = runs.host_runtime.resource_names(self.root, self.run_id)
            self.assertIsNotNone(runs.host_runtime.container_identity(
                self.root, self.run_id, self.directory, self.manifest, names["egress"], "egress",
                runtime={**NEW, "build_revision": REVISION}))  # the egress stays on the manifest's image
        with patch.object(runs.host_runtime, "docker", side_effect=self.docker_view(resources, [])):
            with self.assertRaises(LiveRefusal):  # the old image's container is not this launch's
                runs._runner(self.root, self.run_id, self.directory, self.manifest, launch)
        command = runs.host_runtime.runner_command(self.manifest, self.directory, self.run_id, self.credentials, "run",
                                                   "runner", runs.host_runtime.resource_names(self.root, self.run_id),
                                                   runtime=NEW)
        self.assertIn(NEW["image_ref"], command)
        self.assertNotIn(IDENTITY["image_ref"], command)

    def test_a_run_that_will_not_start_again_cancels_its_switch(self):
        self.running()
        self.request()
        with patch.object(runs, "_outcome", return_value=("interrupted", 3)):
            runs.maintain_locked(self.root, self.run_id)
        self.assertIsNotNone(runs.pending_switch(self.directory))  # it starts again: still waiting
        with patch.object(runs, "_outcome", return_value=("unresolved", 1)):
            runs.maintain_locked(self.root, self.run_id)
        self.assertEqual([row["reason"] for row in self.rows("runtime_switch_canceled")], ["ended"])
        self.assertFalse(os.path.lexists(self.directory / "out" / runs.SWITCH))

    def test_the_request_journal_settles_a_switch_and_records_its_refusal(self):
        self.running()
        command = {"action": "runtime_switch", "target": {"run_id": self.run_id}, "inputs": {}}

        def refuse(root, request_id):
            raise LiveRefusal("LIVE_EVIDENCE_MISSING", "missing")

        with self.assertRaises(LiveRefusal):
            requests.dispatch(self.root, "web-switch-refused", command, refuse)
        self.assertEqual(requests.view(self.root, "web-switch-refused")["outcome"], "refused")
        requests.require_clear(self.root)  # a refused switch never blocks the next start
        result = requests.dispatch(self.root, "web-switch-1", command, lambda root, request_id: self.request(
            request_id=request_id))
        self.assertEqual(result["request"]["outcome"], "effect_recorded")
        cancel = {"action": "runtime_switch_cancel", "target": {"run_id": self.run_id}, "inputs": {}}
        result = requests.dispatch(self.root, "web-cancel-1", cancel,
                                   lambda root, request_id: runs.cancel_switch_locked(root, self.run_id, request_id))
        self.assertEqual(result["request"]["outcome"], "effect_recorded")
        requests.require_clear(self.root)

    def test_each_trading_start_is_compared_on_the_image_it_ran_on(self):
        self.running()
        state.append(self.events, "connecting", self.run_id)
        first = {"events": state.events(self.events)}
        self.assertEqual(compare.segment_image(self.directory, self.manifest, first), IDENTITY["image_ref"])
        self.request()
        self.take("rewarming")
        self.launch(NEW, "web-switch-1")
        state.append(self.events, "connecting", self.run_id)
        second = {"events": state.events(self.events)[-1:]}
        self.assertEqual(compare.segment_image(self.directory, self.manifest, second), NEW["image_ref"])
        self.assertEqual(compare.segment_image(self.directory, self.manifest, first), IDENTITY["image_ref"])

    def test_the_view_shows_the_current_image_a_waiting_switch_and_how_one_ended(self):
        self.running()
        found = views._switch(self.manifest, state.events(self.lifecycle), state.events(self.events))
        self.assertEqual(found["current"], {"digest": IDENTITY["image_digest"], "build_revision": None})
        self.assertEqual((found["pending"], found["events"], found["trial_id"]), (None, [], "7"))
        self.request()
        found = views._switch(self.manifest, state.events(self.lifecycle), state.events(self.events))
        self.assertEqual(found["pending"]["build_revision"], REVISION)
        self.take("held_flat", image=False)
        found = views._switch(self.manifest, state.events(self.lifecycle), state.events(self.events))
        self.assertIsNone(found["pending"])
        self.assertEqual([(row["event"], row["code"], row["digest"]) for row in found["events"]],
                         [("runtime_switch_requested", None, NEW["image_digest"]),
                          ("runtime_switch_failed", "RUNTIME_UNAVAILABLE", NEW["image_digest"])])

    def test_the_control_offers_its_image_to_a_running_run_on_another_with_its_evidence_and_paired_replay(self):
        config = SimpleNamespace(runtime=NEW["image_ref"])
        source = SimpleNamespace(source_id="deployed", symbols=("BTCUSDT",))
        evidence = control.Evidence()
        evidence._found["deployed"] = {"state": "found", "replays": [{"trial_id": 7, "starting_balance_usdt": "100"}],
                                       "at": 0}
        evidence._revision = REVISION
        paired = {"image_ref": NEW["image_ref"], "day": "2026-11-12", "state": "done"}
        run = {"host": {"state": "running", "mode": "run"}, "symbols": ["BTCUSDT"], "compare": {"paired": paired},
               "switch": {"current": {"digest": IDENTITY["image_digest"]}, "trial_id": "7"}}
        self.assertEqual(control._offered(config, run, source, evidence),
                         {"digest": NEW["image_digest"], "build_revision": REVISION, "evidence": "found",
                          "paired": paired})
        self.assertEqual(control._offered(config, {**run, "switch": {**run["switch"], "trial_id": "8"}}, source,
                                          evidence)["evidence"], "missing")
        self.assertIsNone(control._offered(config, {**run, "host": {"state": "interrupted", "mode": "run"}}, source,
                                           evidence))
        self.assertIsNone(control._offered(SimpleNamespace(runtime=IDENTITY["image_ref"]), run,
                                           source, evidence))  # already on it
        other = {**run, "compare": {"paired": {**paired, "image_ref": IDENTITY["image_ref"]}}}
        self.assertIsNone(control._offered(config, other, source, evidence)["paired"])  # another image's replay

    def test_telegram_names_an_offered_image_once_and_says_how_a_switch_ended(self):
        run = {"run_id": self.run_id, "switch": {"offered": {"digest": NEW["image_digest"]}, "events": [
            {"event": "runtime_switch_failed", "observed_ns": "1", "code": "LIVE_RUNTIME_START", "reason": None},
            {"event": "runtime_switch_failed", "observed_ns": "2", "code": "RUNTIME_UNAVAILABLE", "reason": None},
            {"event": "runtime_switch_canceled", "observed_ns": "3", "code": None, "reason": "ended"},
            {"event": "runtime_switch_canceled", "observed_ns": "4", "code": None, "reason": "user"}]}}
        found = notify._switch_messages(run, "Live run")
        self.assertEqual([key for key, _ in found], [f"{self.run_id}:offered:{NEW['image_digest']}",
                                                     f"{self.run_id}:switch:runtime_switch_failed:1",
                                                     f"{self.run_id}:switch:runtime_switch_failed:2",
                                                     f"{self.run_id}:switch:runtime_switch_canceled:3"])
        self.assertIn("LIVE_RUNTIME_START", found[1][1])
        restarts = [{"event": "rewarming", "observed_ns": "1", "switch": True}, {"event": "resuming", "observed_ns": "2"},
                    {"event": "warmup", "observed_ns": "3"}]
        texts = [text for _, text in notify._restart_messages({"run_id": self.run_id, "restarts": restarts}, "Run")]
        self.assertEqual(texts, ["Run holds no position: it starts again on the new runtime image you confirmed.",
                                 "Run warmed up on the new runtime image; entries are open."])
        canceled = {"run_id": self.run_id, "restarts": restarts, "switch": {"events": [
            {"event": "runtime_switch_canceled", "observed_ns": "2", "code": None, "reason": "user"}]}}
        texts = [text for _, text in notify._restart_messages(canceled, "Run")]
        self.assertEqual(texts, ["Run warmed up again; entries are open."])  # canceled after the start ended
