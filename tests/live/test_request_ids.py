"""A request sent again with its ID does its effect at most once: the effect's own rows say whether it was done."""

from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack
import os
import threading
from unittest.mock import patch

from live import host as host_runtime
from live import control, credentials, runs, state
from tests.live.test_runs import LiveFixture


class RequestIdTests(LiveFixture):
    def setUp(self):
        super().setUp()
        self.ref = "a" * 32
        state.append(self.directory / "lifecycle.jsonl", "prepared", self.run_id, request_id="prepare-original",
                     credential_ref=self.ref)
        with state.serialized(self.root) as root:
            credentials.save_locked(root, self.ref, "example-key", "example-secret")
        self.confirm = self.manifest["source"]["source_sha256"]
        self.runner = {"Id": "c" * 64, "State": {"Running": True, "Status": "running"}}

    def execute(self, action, request_id, **body):
        return control.execute(self.authority.config, action, self.run_id, {"request_id": request_id, **body},
                               binding=self.authority.binding)

    def start(self, request_id="start-request-one"):
        return self.execute("start", request_id, confirm_real_orders=self.confirm)

    def host(self, stack):
        """Docker and the run's network are fake; returns the `docker run` mock."""
        stack.enter_context(patch.object(runs, "_network", return_value={"network": "network"}))
        stack.enter_context(patch.object(runs, "_recycle_others"))
        stack.enter_context(patch.object(host_runtime, "container_identity", return_value={"Id": "c" * 64}))
        stack.enter_context(patch.object(runs, "inspect_runner", side_effect=lambda *_: self.runner))
        return stack.enter_context(patch.object(host_runtime, "checked", return_value="c" * 64))

    def launches(self):
        return [row for row in runs.host_events(self.directory) if row["event"] == "launch_requested"]

    def test_launch_requested_is_durable_before_docker_run(self):
        journal = self.directory / "lifecycle.jsonl"
        seen = []
        fsync = os.fsync

        def synced(descriptor):
            if os.fstat(descriptor).st_ino == journal.stat().st_ino:
                seen.append("journal fsynced")
            return fsync(descriptor)

        def run(*argv):
            seen.append("docker run")
            self.assertEqual([row["request_id"] for row in self.launches()], ["start-request-one"])
            return "c" * 64

        with ExitStack() as stack:
            self.host(stack).side_effect = run
            stack.enter_context(patch("os.fsync", side_effect=synced))
            status, body = self.start()
        self.assertEqual(status, 202, body)
        self.assertEqual(seen[seen.index("docker run") - 1], "journal fsynced")

    def test_the_same_request_after_success_or_a_lost_reply_reads_no_key_and_runs_docker_once(self):
        with ExitStack() as stack:
            docker = self.host(stack)
            first = self.start()
            again = self.start()  # the reply was lost: the page sends the same request
        self.assertEqual(first, again)
        self.assertEqual((docker.call_count, self.key_limits.call_count), (1, 1))
        self.assertEqual([row["request_id"] for row in self.launches()], ["start-request-one"])

    def test_a_start_cut_short_after_its_intent_is_never_run_again_by_the_same_request(self):
        with ExitStack() as stack:
            docker = self.host(stack)
            docker.side_effect = SystemExit("crash before Docker answered")
            with self.assertRaises(SystemExit):
                self.start()
            docker.side_effect = AssertionError("docker run twice")
            with patch.object(runs, "_credentials", side_effect=AssertionError("key read again")):
                status, body = self.start()
        self.assertEqual(status, 202, body)
        self.assertEqual(self.key_limits.call_count, 1)
        self.assertEqual(len(self.launches()), 1)

    def test_two_concurrent_sends_of_one_request_start_once(self):
        entered, release = threading.Event(), threading.Event()

        def run(*argv):
            entered.set()
            self.assertTrue(release.wait(5))
            return "c" * 64

        with ExitStack() as stack:
            docker = self.host(stack)
            docker.side_effect = run
            with ThreadPoolExecutor(max_workers=2) as pool:
                first = pool.submit(self.start)
                self.assertTrue(entered.wait(5))
                second = pool.submit(self.start)
                self.assertFalse(second.done())  # it waits for the account lock
                release.set()
                self.assertEqual(first.result()[0], 202)
                self.assertEqual(second.result()[0], 202)
        self.assertEqual((docker.call_count, len(self.launches())), (1, 1))

    def test_one_request_id_names_one_operation(self):
        with ExitStack() as stack:
            docker = self.host(stack)
            self.start()
            for action, body in (("reconcile", {}), ("preflight", {}), ("stop", {}), ("maintain", {})):
                with self.subTest(action=action):
                    status, refused = self.execute(action, "start-request-one", **body)
                    self.assertEqual((status, refused["error"]["code"]), (409, "LIVE_REQUEST_CONFLICT"))
        self.assertEqual(docker.call_count, 1)
        self.assertFalse((self.directory / "out" / "STOP").exists())

    def test_a_saves_request_id_names_its_version_and_no_run_action(self):
        with state.serialized(self.root) as root:
            credentials.save_locked(root, control._credential_ref("save-request-one"), "example-key", "example-secret")
        for action in ("stop", "maintain"):
            status, refused = self.execute(action, "save-request-one")
            self.assertEqual((status, refused["error"]["code"]), (409, "LIVE_REQUEST_CONFLICT"))
        self.assertFalse((self.directory / "out" / "STOP").exists())

    def test_a_new_request_adopts_a_running_launch_of_the_same_mode(self):
        with ExitStack() as stack:
            docker = self.host(stack)
            self.start()
            status, body = self.start("start-request-two")
        self.assertEqual(status, 202, body)
        self.assertEqual((docker.call_count, len(self.launches())), (1, 1))

    def test_an_unseen_runner_blocks_every_new_launch_but_not_its_own_request_or_stop(self):
        with ExitStack() as stack:
            docker = self.host(stack)
            stack.enter_context(patch.object(control, "_profile"))
            stack.enter_context(patch.object(control.runs, "review"))  # preflight's research read: test_runs
            self.start()
            self.runner = None  # the latest launch's container cannot be found, and nothing was recycled
            self.assertEqual(self.start()[0], 202)  # the same request: answered, never run again
            for action, body in (("preflight", {}), ("start", {"confirm_real_orders": self.confirm}),
                                 ("reconcile", {})):
                with self.subTest(action=action):
                    status, refused = self.execute(action, f"new-{action}-request", **body)
                    self.assertEqual((status, refused["error"]["code"]), (400, "LIVE_DOCKER_UNAVAILABLE"))
            with state.serialized(self.root) as root:  # the control's own start of an interrupted run
                (self.directory / "out" / "armed.json").write_text("{}")
                self.assertEqual(refused_code(control.restart_interrupted_locked, root, self.run_id, 0),
                                 "LIVE_DOCKER_UNAVAILABLE")
            self.assertEqual(self.execute("stop", "stop-request-one")[0], 200)
        self.assertEqual(docker.call_count, 1)
        self.assertTrue((self.directory / "out" / "STOP").exists())
        self.assertEqual(runs.active_run(self.root), self.run_id)  # the slot stays with the unseen runner


def refused_code(function, *args) -> str:
    try:
        function(*args)
    except Exception as exc:
        return getattr(exc, "code", type(exc).__name__)
    raise AssertionError("not refused")
