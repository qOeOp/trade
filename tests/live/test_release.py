"""Pair admission shares custody's process lock and never turns release checks into trading."""

import json
from pathlib import Path
import select
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from cli import live_commands
from deploy.release_host import durable_json, route_config
from engine.live_errors import LiveRefusal
from live import host as host_runtime
from live import control, release, runs, state
from tests.live.test_runs import LiveFixture
from tests.live.authority_fixture import inject_cli, install
from tests.helpers import refused


OLD = "trade-release-web-" + "a" * 40
NEW = "trade-release-web-" + "b" * 40
JOURNAL = {"candidate": NEW, "previous": OLD, "agent_before": "trade-release-agent-" + "d" * 40}


class LiveReleaseMetadataTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.directory = Path(temporary.name)
        self.binding = release.Binding(self.directory, OLD)
        self.route = self.directory / "router" / "active.json"
        self.transaction = self.directory / "transaction.json"
        durable_json(self.route, route_config(OLD))

    def refused(self, binding=None, *, maintenance=False):
        self.assertEqual(refused(release.admission_locked, binding or self.binding, maintenance=maintenance,
                                 error=LiveRefusal).code, "LIVE_RELEASE_UNAVAILABLE")

    def test_committed_owner_and_atomic_route_replacement(self):
        release.admission_locked(self.binding)
        release.admission_locked(self.binding, maintenance=True)
        candidate = release.Binding(self.directory, NEW)
        self.refused(candidate)
        durable_json(self.route, route_config(NEW))
        self.refused()
        self.refused(maintenance=True)
        release.admission_locked(candidate)

    def test_transaction_keeps_only_previous_maintenance_even_after_persist(self):
        candidate = release.Binding(self.directory, NEW)
        durable_json(self.transaction, JOURNAL)
        for route in (OLD, NEW):
            durable_json(self.route, route_config(route))
            self.refused()
            self.refused(candidate)
            release.admission_locked(self.binding, maintenance=True)
            self.refused(candidate, maintenance=True)
        self.transaction.unlink()
        release.admission_locked(candidate)
        self.refused(maintenance=True)

    def test_corrupt_ambiguous_missing_and_nonregular_metadata_are_unavailable(self):
        for value in ({"candidate": NEW}, {**JOURNAL, "unexpected": 1}, {"candidate": NEW, "previous": OLD},
                      {**JOURNAL, "agent_before": None}, {**JOURNAL, "previous": NEW}, {**JOURNAL, "candidate": NEW + "-x"}):
            with self.subTest(value=value):
                durable_json(self.transaction, value)
                self.refused()
                self.refused(maintenance=True)
        self.transaction.write_text('{"candidate":')
        self.refused()
        self.transaction.unlink()
        self.transaction.symlink_to(self.directory / "missing")
        self.refused(maintenance=True)
        self.transaction.unlink()
        value = route_config(OLD)
        value["apps"]["http"]["servers"]["ide"]["routes"][0]["handle"][0]["upstreams"][0]["dial"] = OLD + "-x:8765"
        durable_json(self.route, value)
        self.refused()
        value = route_config(OLD)
        value["apps"]["http"]["servers"]["ide"]["routes"].append({"handle": []})
        durable_json(self.route, value)
        self.refused()
        self.route.unlink()
        self.route.mkdir()
        self.refused()
        self.route.rmdir()
        self.refused()

    def test_binding_must_be_fixed_complete_and_managed(self):
        self.assertIsNone(release.parse_binding(None, None))
        with self.assertRaises(LiveRefusal):
            release.admission_locked(None)
        for path, name in ((None, OLD), (self.directory, None), (Path("relative"), OLD),
                           (self.directory, "browser-value")):
            with self.subTest(path=path, name=name), self.assertRaises(LiveRefusal):
                release.parse_binding(path, name)


class LiveReleaseTests(LiveFixture):
    def setUp(self):
        super().setUp()
        state.append(self.directory / "lifecycle.jsonl", "prepared", self.run_id, credential_ref="a" * 32)
        with state.serialized(self.root):
            pass
        self.authority = install(self, self.root)
        self.release_state = self.authority.state
        self.binding = self.authority.binding
        self.route = self.release_state / "router" / "active.json"
        self.transaction = self.release_state / "transaction.json"
        durable_json(self.route, route_config(OLD))
        self.config = self.authority.config

    def files(self):
        return {str(path): path.read_bytes() for path in self.root.rglob("*") if path.is_file()}

    def process(self, script, *args):
        child = subprocess.Popen([sys.executable, "-c", script, *map(str, args)],
                                 stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                 text=True, bufsize=1)
        def cleanup():
            if child.poll() is None:
                child.communicate(timeout=10)
            for stream in (child.stdin, child.stdout, child.stderr):
                stream.close()
        self.addCleanup(cleanup)
        return child

    def line(self, child):
        self.assertTrue(select.select([child.stdout], [], [], 10)[0], "helper did not answer")
        return child.stdout.readline().strip()

    def test_idle_is_read_only_and_includes_preflight_without_a_slot(self):
        before = self.files()
        with patch.object(runs, "_credentials", side_effect=AssertionError("read key")), \
                patch.object(host_runtime, "docker", side_effect=AssertionError("prepared run queried Docker")):
            self.assertEqual(release.idle_locked(self.root), "idle")
        self.assertEqual(before, self.files())
        state.append(self.directory / "lifecycle.jsonl", "launch_requested", self.run_id,
                     mode="preflight", container="first", credentials_path=str(self.credentials))
        with patch.object(runs, "inspect_runner", return_value={"State": {"Running": True, "Status": "running"}}):
            self.assertEqual(release.idle_locked(self.root), "busy")
        with patch.object(runs, "inspect_runner", return_value=None):
            self.assertEqual(release.idle_locked(self.root), "unavailable")
        state.append(self.directory / "lifecycle.jsonl", "launch_requested", self.run_id,
                     mode="preflight", container="second", credentials_path=str(self.credentials))
        def runner(root, run_id, directory, manifest, launch):
            return {"State": {"Running": launch["container"] == "first", "Status": "exited", "ExitCode": 0}}
        with patch.object(runs, "inspect_runner", side_effect=runner):
            self.assertEqual(release.idle_locked(self.root), "busy")

    def test_a_busy_run_does_not_hide_a_later_unreadable_one(self):
        self.launch_record()
        with patch.object(runs, "inspect_runner", return_value={"State": {"Running": True, "Status": "running"}}):
            self.assertEqual(release.idle_locked(self.root), "busy")
            later = self.root / "runs" / "zz-unreadable"  # read after the busy run: no inputs, no outputs
            later.mkdir(mode=0o700)
            self.assertEqual(release.idle_locked(self.root), "unavailable")
            later.rmdir()
        args = SimpleNamespace(verb="release-inspect", configuration=self.authority.file)
        with patch.object(release, "idle_locked", return_value="busy"):
            self.assertEqual(live_commands.live_release_inspect(args), {"state": "busy"})

    def test_invalid_run_set_partial_native_and_unseen_runner_do_not_mean_idle(self):
        other = self.root / "runs" / "invalid_name"
        other.mkdir()
        self.assertEqual(release.idle_locked(self.root), "unavailable")
        other.rmdir()
        journal = self.directory / "out" / "events.jsonl"
        journal.write_text('{"event":')
        self.assertEqual(release.idle_locked(self.root), "unavailable")
        journal.unlink()
        journal.symlink_to(self.root / "missing-native-journal")
        self.assertEqual(release.idle_locked(self.root), "unavailable")
        journal.unlink()
        state.append(journal, "connecting", self.run_id)
        self.assertEqual(release.idle_locked(self.root), "unavailable")
        journal.unlink()
        armed = self.directory / "out" / "armed.json"
        armed.write_text("{}")
        self.assertEqual(release.idle_locked(self.root), "unavailable")
        armed.unlink()
        self.unseen_launch()
        with patch.object(runs, "inspect_runner", return_value=None):
            self.assertEqual(release.idle_locked(self.root), "unavailable")

    def unseen_launch(self):
        """A start whose container cannot be found: it may still be alive."""
        state.append(self.directory / "lifecycle.jsonl", "launch_requested", self.run_id, mode="run",
                     container="unseen", credentials_path=str(self.credentials), request_id="unseen-start")

    def test_stop_and_the_same_stop_again_remain_available_with_bad_release_and_unseen_execution(self):
        self.unseen_launch()
        self.transaction.parent.mkdir(exist_ok=True)
        self.transaction.write_text("broken")
        body = {"request_id": "stop-through-release"}
        status, stopped = control.execute(self.config, "stop", self.run_id, body, binding=self.binding)
        self.assertEqual(status, 200, stopped)
        self.assertTrue((self.directory / "out" / "STOP").exists())
        before = self.files()
        self.assertEqual(control.execute(self.config, "stop", self.run_id, body, binding=self.binding),
                         (status, stopped))
        self.assertEqual(before, self.files())

    def test_an_admission_refusal_comes_before_any_effect(self):
        durable_json(self.transaction, JOURNAL)
        before = self.files()
        with patch.object(control, "_operation", side_effect=AssertionError("secret dispatched")):
            status, refused = control.execute(self.config, "credential_save", None, {
                "request_id": "save-during-release", "environment": "live", "api_key": "fake", "api_secret": "fake"}, binding=self.binding)
        self.assertEqual((status, refused["error"]["code"]), (503, "LIVE_RELEASE_UNAVAILABLE"))
        self.assertEqual(before, self.files())

    def test_listing_and_explicit_maintenance_distinguish_previous_from_candidate(self):
        durable_json(self.transaction, JOURNAL)
        with patch.object(control, "run_view", return_value={"run_id": self.run_id}):
            previous = control.listing(self.config, binding=self.binding)
            candidate = control.listing(self.config, binding=release.Binding(self.release_state, NEW))
        self.assertFalse(previous["write_enabled"])
        self.assertTrue(previous["maintenance_enabled"])
        self.assertFalse(candidate["write_enabled"])
        self.assertFalse(candidate["maintenance_enabled"])
        with patch.object(runs, "maintain_locked", return_value={"state": "prepared"}) as maintain:
            status, _ = control.execute(self.config, "maintain", self.run_id, {"request_id": "previous-maintain"},
                                        binding=self.binding)
            self.assertEqual(status, 200)
            maintain.assert_called_once_with(self.root, self.run_id)
            status, _ = control.execute(self.config, "maintain", self.run_id, {"request_id": "candidate-maintain"},
                                        binding=release.Binding(self.release_state, NEW))
            self.assertEqual(status, 503)
            maintain.assert_called_once()

    def test_host_lock_waits_for_existing_writer_then_observes_its_new_slot(self):
        writer = self.process('''
import sys
from pathlib import Path
from live import state
with state.serialized(Path(sys.argv[1])) as root:
    print("locked", flush=True)
    sys.stdin.readline()
    state.append(root / "account.jsonl", "reserved", sys.argv[2])
''', self.root, self.run_id)
        self.assertEqual(self.line(writer), "locked")
        host = self.process('''
import fcntl, os, sys
from pathlib import Path
from live import release
root = Path(sys.argv[1])
descriptor = os.open(root / "account.lock", os.O_RDONLY | os.O_NOFOLLOW)
with os.fdopen(descriptor, "rb") as locked:
    fcntl.flock(locked, fcntl.LOCK_EX)
    print(release.idle_locked(root), flush=True)
''', self.root)
        self.assertFalse(select.select([host.stdout], [], [], .15)[0])
        writer.stdin.write("finish\n")
        writer.stdin.flush()
        writer.wait(timeout=10)
        self.assertEqual(self.line(host), "busy")
        host.wait(timeout=10)
        self.assertEqual(host.returncode, 0)

    def test_request_waiting_behind_host_lock_rechecks_transaction_before_any_effect(self):
        host = self.process('''
import fcntl, os, sys
from pathlib import Path
from deploy.release_host import durable_json
from live import release
root, metadata = map(Path, sys.argv[1:3])
descriptor = os.open(root / "account.lock", os.O_RDONLY | os.O_NOFOLLOW)
with os.fdopen(descriptor, "rb") as locked:
    fcntl.flock(locked, fcntl.LOCK_EX)
    print(release.idle_locked(root), flush=True)
    sys.stdin.readline()
    durable_json(metadata / "transaction.json", {"candidate": sys.argv[4], "previous": sys.argv[3], "agent_before": "trade-release-agent-" + "d" * 40})
    print("committed", flush=True)
''', self.root, self.release_state, OLD, NEW)
        self.assertEqual(self.line(host), "idle")
        writer = self.process('''
import sys
from pathlib import Path
from engine.live_errors import LiveRefusal
from live import authority, control, inventory, release
root, metadata = map(Path, sys.argv[1:3])
authority.STATE = metadata
inventory.require_clear = lambda root: None
binding = release.Binding(metadata, sys.argv[3])
config = authority.from_file(Path(sys.argv[4]), binding).config
print("validated", flush=True)
status, body = control.execute(config, "credential_save", None,
                               {"request_id": "late-save-request", "environment": "live", "api_key": "fake", "api_secret": "fake"},
                               binding=binding)
print(body["error"]["code"] if status != 200 else "saved", flush=True)
''', self.root, self.release_state, OLD, self.authority.file)
        self.assertEqual(self.line(writer), "validated")
        self.assertFalse(select.select([writer.stdout], [], [], .15)[0])
        host.stdin.write("commit\n")
        host.stdin.flush()
        self.assertEqual(self.line(host), "committed")
        host.wait(timeout=10)
        self.assertEqual(self.line(writer), "LIVE_RELEASE_UNAVAILABLE")
        writer.wait(timeout=10)
        self.assertFalse((self.root / "credentials").exists())

    def test_inspection_never_creates_an_absent_root_or_lock(self):
        absent = self.root / "not-created"
        self.assertEqual(release.idle_locked(absent), "unavailable")
        self.assertFalse(absent.exists())
        (self.root / "account.lock").unlink()
        before = self.files()
        self.assertEqual(release.idle_locked(self.root), "unavailable")
        self.assertEqual(before, self.files())

    def test_real_inspect_cli_does_not_reacquire_the_hosts_account_lock(self):
        configuration = self.authority.file
        inject_cli(self, self.release_state)
        before = self.files()
        with state.serialized(self.root):
            child = subprocess.run([sys.executable, "-m", "cli.main", "live", "release-inspect", "--configuration",
                                    str(configuration)], capture_output=True, text=True, timeout=10)
        self.assertEqual(child.returncode, 0, child.stderr)
        self.assertEqual(json.loads(child.stdout), {"state": "idle"})
        self.assertEqual(before, self.files())

