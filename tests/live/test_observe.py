"""Web polling can inspect custody, but cannot turn an exit into a released account."""

from unittest.mock import patch

from engine.live_errors import LiveRefusal
from live import host as host_runtime
from live import runs, state
from tests.live.test_runs import LiveFixture
from tests.helpers import refused


class LiveObservationTests(LiveFixture):
    def setUp(self):
        super().setUp()
        with state.serialized(self.root):
            pass

    def files(self):
        return {str(path.relative_to(self.root)): path.read_bytes()
                for path in self.root.rglob("*") if path.is_file()}

    def test_observing_a_clean_exit_keeps_custody_and_resources(self):
        self.assert_flat_observation_keeps_custody("clean_stop", "clean_stopped")

    def test_observing_venue_flat_keeps_custody_and_resources(self):
        self.assert_flat_observation_keeps_custody("venue_flat", "venue_flat")

    def assert_flat_observation_keeps_custody(self, event, expected_state):
        self.launch_record()
        state.append(self.directory / "out" / "events.jsonl", event, self.run_id)
        before = self.files()
        calls = []
        resources = self.inspected(running=False)
        with patch.object(host_runtime, "docker", side_effect=self.docker_view(resources, calls)), \
                patch.object(runs, "_release_if_resolved", side_effect=AssertionError("poll released custody")), \
                patch.object(runs, "_recycle", side_effect=AssertionError("poll removed resources")), \
                patch.object(runs, "_credentials", side_effect=AssertionError("poll read a credential")):
            result = runs.observe(self.root, self.run_id)
        self.assertEqual(result["state"], expected_state)
        self.assertTrue(result["account_owned"])
        self.assertEqual(self.files(), before)
        self.assertTrue(calls)
        self.assertTrue(all(len(call) == 3 and call[1] == "inspect" for call in calls))

    def test_read_does_not_create_a_root_or_missing_lock(self):
        absent = self.root / "absent"
        with self.assertRaises(LiveRefusal):
            runs.observe(absent, self.run_id)
        self.assertFalse(absent.exists())
        (self.root / "account.lock").unlink()
        before = self.files()
        with self.assertRaises(LiveRefusal):
            runs.observe(self.root, self.run_id)
        self.assertEqual(self.files(), before)

    def test_read_does_not_follow_a_lock_symlink(self):
        target = self.root / "other"
        target.write_bytes(b"untouched")
        (self.root / "account.lock").unlink()
        (self.root / "account.lock").symlink_to(target)
        with self.assertRaises(LiveRefusal):
            runs.observe(self.root, self.run_id)
        self.assertEqual(target.read_bytes(), b"untouched")

    def test_incomplete_host_journal_does_not_become_a_prepared_run(self):
        (self.directory / "lifecycle.jsonl").write_bytes(b'{"event":"launch_')
        before = self.files()
        self.assertEqual(refused(runs.observe, self.root, self.run_id,
                                 error=LiveRefusal).code, "LIVE_JOURNAL_UNAVAILABLE")
        self.assertEqual(self.files(), before)
