"""Web polling can inspect custody, but cannot turn an exit into a released account."""

from unittest.mock import patch

from engine.live_errors import LiveRefusal
from live import runs, state
from tests.live.test_runs import LiveFixture


class LiveObservationTests(LiveFixture):
    def setUp(self):
        super().setUp()
        with state.serialized(self.root):
            pass

    def files(self):
        return {str(path.relative_to(self.root)): path.read_bytes()
                for path in self.root.rglob("*") if path.is_file()}

    def test_observing_a_clean_exit_keeps_custody_and_resources(self):
        self.launch_record()
        state.append(self.directory / "out" / "events.jsonl", "clean_stop", self.run_id)
        before = self.files()
        calls = []
        resources = self.inspected(running=False)
        with patch.object(runs, "_docker", side_effect=self.docker_view(resources, calls)), \
                patch.object(runs, "_release_if_resolved", side_effect=AssertionError("poll released custody")), \
                patch.object(runs, "_recycle", side_effect=AssertionError("poll removed resources")), \
                patch.object(runs, "_credentials", side_effect=AssertionError("poll read a credential")):
            result = runs.observe(self.root, self.run_id)
        self.assertEqual(result["state"], "clean_stopped")
        self.assertTrue(result["account_owned"])
        self.assertEqual(self.files(), before)
        self.assertTrue(calls)
        self.assertTrue(all(len(call) == 3 and call[1] == "inspect" for call in calls))

    def test_missing_runner_is_unresolved_and_does_not_release_account(self):
        self.launch_record()
        before = self.files()
        with patch.object(runs, "_docker", side_effect=self.docker_view({}, [])):
            result = runs.observe(self.root, self.run_id)
        self.assertEqual(result["state"], "unresolved")
        self.assertTrue(result["account_owned"])
        self.assertEqual(self.files(), before)

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

    def test_archived_result_does_not_require_removed_resources(self):
        self.launch_record()
        state.append(self.root / "account.jsonl", "released", self.run_id, reason="native_and_venue_flat")
        state.append(self.directory / "lifecycle.jsonl", "recycled", self.run_id,
                     state="clean_stopped", exit_code=0)
        before = self.files()
        with patch.object(runs, "_docker", side_effect=AssertionError("removed resources inspected")):
            result = runs.observe(self.root, self.run_id)
        self.assertEqual(result["state"], "clean_stopped")
        self.assertFalse(result["account_owned"])
        self.assertEqual(self.files(), before)

    def test_incomplete_host_journal_does_not_become_a_prepared_run(self):
        (self.directory / "lifecycle.jsonl").write_bytes(b'{"event":"launch_')
        before = self.files()
        with self.assertRaises(LiveRefusal) as caught:
            runs.observe(self.root, self.run_id)
        self.assertEqual(caught.exception.code, "LIVE_JOURNAL_UNAVAILABLE")
        self.assertEqual(self.files(), before)
