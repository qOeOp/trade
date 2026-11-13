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
from live import control, release, requests, runs, state
from tests.live.test_runs import IDENTITY, LiveFixture
from tests.live.authority_fixture import inject_cli, install, recover
from tests.helpers import refused


OLD = "trade-release-web-" + "a" * 40
NEW = "trade-release-web-" + "b" * 40


class LiveReleaseMetadataTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.directory = Path(temporary.name)
        self.binding = release.Binding(self.directory, OLD)
        self.route = self.directory / "router" / "active.json"
        self.transaction = self.directory / "transaction.json"
        durable_json(self.route, route_config(OLD, None))

    def refused(self, binding=None, *, maintenance=False):
        self.assertEqual(refused(release.admission_locked, binding or self.binding, maintenance=maintenance,
                                 error=LiveRefusal).code, "LIVE_RELEASE_UNAVAILABLE")

    def test_committed_owner_and_atomic_route_replacement(self):
        release.admission_locked(self.binding)
        release.admission_locked(self.binding, maintenance=True)
        candidate = release.Binding(self.directory, NEW)
        self.refused(candidate)
        durable_json(self.route, route_config(NEW, None))
        self.refused()
        self.refused(maintenance=True)
        release.admission_locked(candidate)

    def test_transaction_keeps_only_previous_maintenance_even_after_persist(self):
        candidate = release.Binding(self.directory, NEW)
        durable_json(self.transaction, {"candidate": NEW, "previous": OLD})
        for route in (OLD, NEW):
            durable_json(self.route, route_config(route, None))
            self.refused()
            self.refused(candidate)
            release.admission_locked(self.binding, maintenance=True)
            self.refused(candidate, maintenance=True)
        self.transaction.unlink()
        release.admission_locked(candidate)
        self.refused(maintenance=True)

    def test_a_web_only_route_and_transaction_keep_the_owner_admitted(self):
        third = "trade-release-web-" + "c" * 40
        owner, newer = release.Binding(self.directory, NEW), release.Binding(self.directory, third)
        durable_json(self.route, route_config(NEW, "a" * 40))
        release.admission_locked(self.binding)
        self.refused(owner)
        durable_json(self.transaction, {"candidate": third, "previous": NEW, "candidate_owner": "a" * 40})
        for route in (NEW, third):
            durable_json(self.route, route_config(route, "a" * 40))
            release.admission_locked(self.binding)  # the account's work goes on through the Web's move
            self.refused(owner)
            self.refused(newer, maintenance=True)
        durable_json(self.route, route_config(third, None))
        self.refused(maintenance=True)

    def test_a_web_ahead_of_its_control_keeps_the_owner_admitted_until_its_own_control_pairs(self):
        ahead = NEW + "-pre"
        durable_json(self.transaction, {"candidate": ahead, "previous": OLD, "candidate_owner": "a" * 40})
        for route in (OLD, ahead):
            durable_json(self.route, route_config(ahead, "a" * 40) if route == ahead else route_config(OLD, None))
            release.admission_locked(self.binding)  # the owner's account work goes on beside the newer Web
            release.admission_locked(self.binding, maintenance=True)
        self.transaction.unlink()
        release.admission_locked(self.binding)
        own = release.Binding(self.directory, NEW)
        self.refused(own)
        durable_json(self.transaction, {"candidate": NEW, "previous": ahead, "previous_owner": "a" * 40})
        self.refused()
        release.admission_locked(self.binding, maintenance=True)
        self.refused(own, maintenance=True)
        self.transaction.unlink()
        durable_json(self.route, route_config(NEW, None))
        release.admission_locked(own)
        self.refused(maintenance=True)
        with self.assertRaises(LiveRefusal):
            release.Binding(self.directory, ahead)  # a control is only ever bound to a plain Web

    def test_a_paired_release_from_a_web_only_state_keeps_maintenance_with_the_owner(self):
        third = "trade-release-web-" + "c" * 40
        newer = release.Binding(self.directory, third)
        durable_json(self.transaction, {"candidate": third, "previous": NEW, "previous_owner": "a" * 40})
        for route, owner in ((NEW, "a" * 40), (third, None)):
            durable_json(self.route, route_config(route, owner))
            self.refused()
            release.admission_locked(self.binding, maintenance=True)
            self.refused(release.Binding(self.directory, NEW), maintenance=True)
            self.refused(newer, maintenance=True)
        self.transaction.unlink()
        release.admission_locked(newer)
        self.refused(maintenance=True)

    def test_corrupt_ambiguous_missing_and_nonregular_metadata_are_unavailable(self):
        for value in ({"candidate": NEW}, {"candidate": NEW, "previous": OLD, "unexpected": 1},
                      {"candidate": NEW, "previous": OLD, "agent_before": None},
                      {"candidate": NEW, "previous": NEW},
                      {"candidate": NEW, "previous": OLD, "candidate_owner": "a" * 40, "previous_owner": "a" * 40},
                      {"candidate": NEW, "previous": OLD, "candidate_owner": "not-a-revision"},
                      {"candidate": NEW, "previous": OLD, "previous_owner": None},
                      {"candidate": NEW + "-pre", "previous": OLD},
                      {"candidate": NEW + "-post", "previous": OLD, "candidate_owner": "a" * 40}):
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
        value = route_config(NEW, "a" * 40)
        value["apps"]["http"]["servers"]["ide"]["routes"][0]["@id"] = "live-unknown"
        durable_json(self.route, value)
        self.refused()
        value = route_config(NEW + "-pre", "a" * 40)
        del value["apps"]["http"]["servers"]["ide"]["routes"][0]["@id"]
        durable_json(self.route, value)
        self.refused()
        value = route_config(OLD, None)
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
        self.release_state = self.root / "release-fixture"
        self.authority = install(self, self.root, release_state=self.release_state)
        self.binding = self.authority.binding
        self.route = self.release_state / "router" / "active.json"
        self.transaction = self.release_state / "transaction.json"
        durable_json(self.route, route_config(OLD, None))
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

    def test_adopt_inspection_lists_each_busy_runtime_only_after_every_run_was_read(self):
        self.launch_record()
        original = runs.read_manifest
        built = "b" * 40

        def manifest(root, run_id):
            directory, value = original(root, run_id)
            return directory, {**value, "runtime": {**value["runtime"], "build_revision": built}}

        running = {"State": {"Running": True, "Status": "running"}}
        with patch.object(runs, "inspect_runner", return_value=running):
            self.assertEqual(release.inspect_locked(self.root), ("busy", [None]))  # this manifest names no revision
            with patch.object(runs, "read_manifest", side_effect=manifest):
                self.assertEqual(release.inspect_locked(self.root), ("busy", [built]))
                # After a confirmed switch the run answers with the build its latest launch runs on (design §3.8).
                switched = {**IDENTITY, "image_ref": IDENTITY["image_ref"][:-64] + "f" * 64, "build_revision": "f" * 40}
                state.append(self.directory / "lifecycle.jsonl", "runtime_switch_requested", self.run_id,
                             runtime=switched, request_id="switch-1")
                state.append(self.directory / "lifecycle.jsonl", "launch_requested", self.run_id, mode="run",
                             container="runner", image_ref=switched["image_ref"])
                self.assertEqual(release.inspect_locked(self.root), ("busy", ["f" * 40]))
            later = self.root / "runs" / "zz-unreadable"  # read after the busy run: no inputs, no outputs
            later.mkdir(mode=0o700)
            self.assertEqual(release.inspect_locked(self.root), ("unavailable", []))
            self.assertEqual(release.idle_locked(self.root), "unavailable", "a busy run no longer hides a later one")
            later.rmdir()
        args = SimpleNamespace(verb="release-inspect", configuration=self.authority.file, adopt=True)
        with patch.object(release, "inspect_locked", return_value=("busy", [built, None])):
            self.assertEqual(live_commands.dispatch(args, []), ({"state": "busy", "runtimes": [built, None]}, 0))
            self.assertEqual(live_commands.dispatch(SimpleNamespace(**{**vars(args), "adopt": False}), []),
                             ({"state": "busy"}, 0))
        with patch.object(release, "inspect_locked", return_value=("idle", [])):
            self.assertEqual(live_commands.dispatch(args, []), ({"state": "idle"}, 0))

    def test_invalid_run_set_partial_native_and_unknown_request_do_not_mean_idle(self):
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
        requests.dispatch(self.root, "unknown-start", {"action": "start", "target": {"run_id": self.run_id},
                                                       "inputs": {}}, lambda *_: None)
        self.assertEqual(release.idle_locked(self.root), "unavailable")

    def test_stop_and_exact_duplicate_remain_available_with_bad_release_and_unknown_execution(self):
        requests.dispatch(self.root, "unknown-start", {"action": "start", "target": {"run_id": self.run_id},
                                                       "inputs": {}}, lambda *_: None)
        self.transaction.parent.mkdir(exist_ok=True)
        self.transaction.write_text("broken")
        body = {"request_id": "stop-through-release"}
        status, stopped = control.execute(self.config, "stop", self.run_id, body, binding=self.binding)
        self.assertEqual(status, 200, stopped)
        self.assertTrue((self.directory / "out" / "STOP").exists())
        before = self.files()
        with patch.object(control, "_operation", side_effect=AssertionError("duplicate effect")):
            self.assertEqual(control.execute(self.config, "stop", self.run_id, body, binding=self.binding),
                             (status, stopped))
        self.assertEqual(before, self.files())

    def test_new_admission_has_no_claim_or_key_effect_and_duplicate_receipt_ignores_handover(self):
        body = {"request_id": "save-before-release", "api_key": "fake", "api_secret": "fake"}
        first = control.execute(self.config, "credential_save", None, body, binding=self.binding)
        self.assertEqual(first[0], 200, first)
        durable_json(self.transaction, {"candidate": NEW, "previous": OLD})
        before = self.files()
        with patch.object(control, "_operation", side_effect=AssertionError("secret dispatched")):
            self.assertEqual(control.execute(self.config, "credential_save", None, body, binding=self.binding), first)
            status, refused = control.execute(self.config, "credential_save", None,
                                              {**body, "request_id": "new-save-during-release"}, binding=self.binding)
        self.assertEqual((status, refused["error"]["code"]), (503, "LIVE_RELEASE_UNAVAILABLE"))
        self.assertEqual(before, self.files())
        stale = release.Binding(self.release_state, NEW)
        self.assertEqual(control.execute(self.authority.snapshot(NEW).config, "credential_save", None, body, binding=stale), first)

    def test_resolve_determined_receipts_is_read_only_but_missing_or_unknown_needs_owner(self):
        recover(self.root, "closed-before-release")
        requests.dispatch(self.root, "unknown-start", {"action": "start", "target": {"run_id": self.run_id},
                                                       "inputs": {}}, lambda *_: None)
        durable_json(self.transaction, {"candidate": NEW, "previous": OLD})
        before = self.files()
        for identity in ("missing-request", "unknown-start"):
            status, result = control.execute(self.config, "resolve", identity, {"request_id": identity},
                                              binding=self.binding)
            self.assertEqual((status, result["error"]["code"]), (503, "LIVE_RELEASE_UNAVAILABLE"))
        status, _ = control.execute(self.config, "resolve", "closed-before-release",
                                    {"request_id": "closed-before-release"}, binding=self.binding)
        self.assertEqual(status, 200)
        self.assertEqual(before, self.files())

    def test_listing_and_explicit_maintenance_distinguish_previous_from_candidate(self):
        durable_json(self.transaction, {"candidate": NEW, "previous": OLD})
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

    def test_request_waiting_behind_host_lock_rechecks_transaction_before_claim(self):
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
    durable_json(metadata / "transaction.json", {"candidate": sys.argv[4], "previous": sys.argv[3]})
    print("committed", flush=True)
''', self.root, self.release_state, OLD, NEW)
        self.assertEqual(self.line(host), "idle")
        writer = self.process('''
import sys
from pathlib import Path
from engine.live_errors import LiveRefusal
from live import release, requests
root, metadata = map(Path, sys.argv[1:3])
binding = release.Binding(metadata, sys.argv[3])
command = {"action": "credential_save", "target": {"credential_ref": "a" * 32}, "inputs": {}}
print("validated", flush=True)
try:
    requests.dispatch(root, "late-save-request", command, lambda *_: (root / "unexpected-effect").touch(),
                      admit_new=lambda _: release.admission_locked(binding))
except LiveRefusal as exc:
    print(exc.code, flush=True)
''', self.root, self.release_state, OLD)
        self.assertEqual(self.line(writer), "validated")
        self.assertFalse(select.select([writer.stdout], [], [], .15)[0])
        host.stdin.write("commit\n")
        host.stdin.flush()
        self.assertEqual(self.line(host), "committed")
        host.wait(timeout=10)
        self.assertEqual(self.line(writer), "LIVE_RELEASE_UNAVAILABLE")
        writer.wait(timeout=10)
        self.assertFalse((self.root / "requests" / "late-save-request.jsonl").exists())
        self.assertFalse((self.root / "unexpected-effect").exists())

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
        with state.serialized(self.root):
            child = subprocess.run([sys.executable, "-m", "cli.main", "live", "release-inspect", "--configuration",
                                    str(configuration), "--adopt"], capture_output=True, text=True, timeout=10)
        self.assertEqual((child.returncode, json.loads(child.stdout)), (0, {"state": "idle"}), child.stderr)
        self.assertEqual(before, self.files())

