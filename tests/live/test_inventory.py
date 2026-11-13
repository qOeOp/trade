"""Cross-root discovery uses exact retained identity, never key hashes or container names alone."""

import copy
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from engine.live_errors import LiveRefusal
from live import host as host_runtime
from live import inventory, runs, state
from tests.live.test_authority import prepared
from tests.helpers import refused


class DockerClientTests(unittest.TestCase):
    def test_no_docker_client_is_refused_as_unavailable(self):
        with patch("live.host.subprocess.run", side_effect=FileNotFoundError("docker")):
            with self.assertRaises(LiveRefusal) as caught:
                host_runtime.docker("ps")
        self.assertEqual(caught.exception.code, "LIVE_DOCKER_UNAVAILABLE")


class ForeignInventoryTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.work = Path(temporary.name).resolve()
        self.canonical, self.foreign = self.work / "canonical", self.work / "foreign"
        for root in (self.canonical, self.foreign):
            with state.serialized(root):
                pass
            directory, _ = prepared(root, "same-run")
            state.append(directory / "lifecycle.jsonl", "launch_requested", "same-run", mode="preflight",
                         container="original-runner", credentials_path="/fake-never-read")
            state.append(directory / "lifecycle.jsonl", "container_started", "same-run", mode="preflight",
                         container="original-runner", container_id="a" * 64)
        self.found = {"Id": "a" * 64, "Name": "/original-runner",
                      "Config": {"Labels": {"trade.live.run": "same-run", "trade.live.role": "runner"}},
                      "Mounts": [{"Type": "bind", "Destination": "/reports",
                                  "Source": str(self.foreign / "runs/same-run/out"), "RW": True}],
                      "State": {"Running": True, "Status": "running", "ExitCode": None}}

    def check(self, found=None):
        found = self.found if found is None else found
        with patch.object(host_runtime, "checked", return_value="a" * 64) as listed, \
                patch.object(host_runtime, "inspect", return_value=found), \
                patch.object(runs, "inspect_runner", return_value=found) as runner:
            inventory.require_clear(self.canonical)
        listed.assert_called_once_with("ps", "-aq", "--no-trunc", "--filter", "label=trade.live.run")
        return runner

    def refused(self, found=None):
        self.assertEqual(refused(self.check, found, error=LiveRefusal).code, "LIVE_ACCOUNT_OWNED")

    def test_same_run_id_and_same_key_binding_in_foreign_root_do_not_share_canonical_authority(self):
        before = {str(p): p.read_bytes() for p in self.work.rglob("*") if p.is_file()}
        self.refused()
        self.assertEqual(before, {str(p): p.read_bytes() for p in self.work.rglob("*") if p.is_file()})

    def test_foreign_stopped_container_does_not_release_unresolved_custody(self):
        self.found["State"] = {"Running": False, "Status": "exited", "ExitCode": 0}
        state.append(self.foreign / "account.jsonl", "reserved", "same-run")
        self.refused()

    def test_conclusively_closed_foreign_history_is_not_an_everlasting_block(self):
        self.found["State"] = {"Running": False, "Status": "exited", "ExitCode": 0}
        runner = self.check()
        self.assertTrue(all(call.args[0] == self.foreign for call in runner.call_args_list))
        self.assertTrue((self.foreign / "runs/same-run/lifecycle.jsonl").exists())

    def test_canonical_runner_uses_full_native_resource_verifier_and_keeps_existing_preflight_semantics(self):
        self.found["Mounts"][0]["Source"] = str(self.canonical / "runs/same-run/out")
        runner = self.check()
        self.assertEqual(runner.call_args.args[0], self.canonical)
        self.assertEqual(runner.call_args.args[4]["mode"], "preflight")

    def test_inaccessible_foreign_history_does_not_get_mounted_or_initialized(self):
        absent = self.work / "not-mounted"
        self.found["Mounts"][0]["Source"] = str(absent / "runs/same-run/out")
        self.refused()
        self.assertFalse(absent.exists())

    def test_malformed_labels_mounts_or_identity_cannot_hide_as_canonical(self):
        for mutation in (lambda f: f["Config"]["Labels"].pop("trade.live.role"),
                         lambda f: f["Mounts"].append(copy.deepcopy(f["Mounts"][0])),
                         lambda f: f["Mounts"][0].update(Source=str(self.canonical / "wrong")),
                         lambda f: f.update(Id="b" * 64),
                         lambda f: f.update(Name="/unrecorded-runner")):
            found = copy.deepcopy(self.found)
            mutation(found)
            self.refused(found)

    def test_lost_docker_observation_is_unavailable_and_never_adopts_or_removes(self):
        with patch.object(host_runtime, "checked", return_value="a" * 64), patch.object(host_runtime, "inspect", return_value=None), \
                patch.object(host_runtime, "remove_resources", side_effect=AssertionError("adoption/cleanup")):
            with self.assertRaises(LiveRefusal):
                inventory.require_clear(self.canonical)

    def test_foreign_lock_contention_refuses_without_waiting_under_the_canonical_lock(self):
        with state.serialized(self.foreign):
            self.refused()
