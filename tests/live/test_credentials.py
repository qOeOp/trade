"""Only fake secrets: immutable versions survive crashes without changing mounted identities."""

import hashlib
import json
import os
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch

from engine.live_errors import LiveRefusal
from engine.live_venue import read_credentials
from live import credentials, release, runs, state
from tests.live.test_runs import IDENTITY
from tests.helpers import refused


class CredentialStoreTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.ref = "a" * 32
        self.other = "b" * 32
        self.key, self.secret = "fake-key-sentinel", "fake-secret-sentinel"
        with state.serialized(self.root):
            pass

    def save(self, ref=None):
        with state.serialized(self.root):
            return credentials.save_locked(self.root, "live", ref or self.ref, self.key, self.secret)

    def prepared(self, *, ref=None, run_id="prepared-one", manifest_format=runs.MANIFEST_FORMAT, environment="live"):
        directory = state.directory(self.root, run_id)
        for part in (directory, directory / "inputs", directory / "out", directory / "egress"):
            state.private_directory(part)
        manifest = {"format": manifest_format, "run_id": run_id, "research_at": "a" * 32, "runtime": IDENTITY,
                    "symbols": ["BTCUSDT"], "config": {"memory": "2g", "environment": environment},
                    "candidate": {"strategy_id": "example", "revision": 1},
                    "source": {"entry_class": "Example", "source_sha256": hashlib.sha256(b"source").hexdigest()},
                    "universe_sha256": hashlib.sha256(b"{}").hexdigest(),
                    "credential_binding": hashlib.sha256(self.key.encode()).hexdigest()}
        state.write_new(directory / "inputs" / "strategy.py", b"source")
        state.write_new(directory / "inputs" / "universe.json", b"{}")
        state.write_new(directory / "inputs" / "manifest.json", state.encode(manifest))
        state.append(directory / "lifecycle.jsonl", "prepared", run_id,
                     **({"credential_ref": ref} if ref else {}))
        return directory

    def launch(self, directory, mode="run", container="runner"):
        state.append(directory / "lifecycle.jsonl", "launch_requested", directory.name,
                     mode=mode, container=container, credentials_path="/private/fake.json")

    def files(self):
        return {str(path.relative_to(self.root)): path.read_bytes()
                for path in self.root.rglob("*") if path.is_file()}

    def secrets_outside_the_version(self) -> list[str]:
        """Every file but the saved versions' own that holds the key or secret."""
        return [name for name, data in self.files().items() if not name.endswith(".json") or "credentials/" not in name
                if self.key.encode() in data or self.secret.encode() in data]

    def test_secret_is_private_and_only_metadata_is_returned(self):
        result = self.save()
        path = self.root / "credentials" / "live" / (self.ref + ".json")
        self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        self.assertEqual(path.parent.stat().st_mode & 0o777, 0o700)
        found = read_credentials(path)
        self.assertEqual((found.api_key, found.api_secret), (self.key, self.secret))
        self.assertNotIn(self.key, json.dumps(result))
        self.assertNotIn(self.secret, json.dumps(result))
        self.assertEqual(self.secrets_outside_the_version(), [])
        self.assertTrue(result["selected"])

    def test_a_save_cut_short_at_each_step_is_finished_by_the_same_save_and_never_selected_otherwise(self):
        original_write, original_link, original_append = state.write_new, os.link, credentials._append
        cuts = {
            "partial pending": (state, "write_new", lambda path, data: (
                original_write(path, data[:10]), (_ for _ in ()).throw(OSError("disk")))),
            "after link": (os, "link", lambda *args, **kwargs: (
                original_link(*args, **kwargs), (_ for _ in ()).throw(OSError("fsync")))),
            "before saved": (credentials, "_append", lambda root, environment, event, ref: (_ for _ in ()).throw(OSError("fsync"))),
            "before selected": (credentials, "_append", lambda root, environment, event, ref: (
                original_append(root, environment, event, ref) if event == "saved" else (_ for _ in ()).throw(OSError("fsync")))),
        }
        for index, (name, (target, attribute, cut)) in enumerate(cuts.items()):
            ref = f"{index:032x}"
            with self.subTest(cut=name):
                with patch.object(target, attribute, side_effect=cut), self.assertRaises(LiveRefusal):
                    self.save(ref)
                # Left unfinished, the version is never selected: a new key saved meanwhile stays the selected one.
                self.save("f" * 31 + str(index))
                self.assertNotIn(ref, [row["credential_ref"] for row in credentials.listing_locked(self.root)["live"]
                                       if row["selected"]])
                result = self.save(ref)  # the same save sent again
                self.assertTrue(result["selected"] and result["available"])
                self.assertEqual(read_credentials(self.root / "credentials" / "live" / (ref + ".json")).api_secret, self.secret)
                self.assertFalse(list((self.root / "credentials" / "live").glob(".*.pending")))
                self.assertEqual(self.secrets_outside_the_version(), [])
                before = self.files()
                self.assertEqual(self.save(ref), result)  # finished: sent again it changes nothing
                self.assertEqual(self.files(), before)

    def test_version_identity_holds_when_the_wall_clock_moves_backwards(self):
        with patch("live.credentials.time.time_ns", side_effect=[200, 100]):
            self.save()
        self.assertEqual(credentials.listing_locked(self.root)["live"][0]["observed_ns"], "200")
        self.assertTrue(credentials.listing_locked(self.root)["live"][0]["selected"])

    def test_listing_does_not_open_secret_bytes_or_change_files(self):
        self.save()
        before = self.files()
        original = os.open

        def opened(path, flags, *args, **kwargs):
            if str(path).endswith(self.ref + ".json"):
                raise AssertionError("metadata read opened secret")
            return original(path, flags, *args, **kwargs)

        with state.reading(self.root), patch.object(os, "open", side_effect=opened):
            result = credentials.listing_locked(self.root)["live"]
        self.assertEqual(result[0]["credential_ref"], self.ref)
        self.assertEqual(self.files(), before)
        absent = self.root / "not-initialized"
        self.assertEqual(credentials.listing_locked(absent), {"live": [], "demo": []})
        self.assertFalse(absent.exists())

    def test_final_path_becomes_visible_only_with_complete_bytes(self):
        original = os.link
        observations = []

        def linked(source, target, **kwargs):
            self.assertFalse(target.exists())
            observations.append(read_credentials(source))
            original(source, target, **kwargs)

        with patch.object(os, "link", side_effect=linked):
            self.save()
        self.assertEqual(observations[0].api_secret, self.secret)
        self.assertFalse(list((self.root / "credentials" / "live").glob("*.pending")))

    def test_a_save_sent_again_after_its_removal_saves_and_selects_nothing(self):
        self.save()
        with state.serialized(self.root):
            result = credentials.remove_locked(self.root, "live", self.ref)
        self.assertTrue(result["removed"])
        before = self.files()
        self.assertEqual(self.save(), result)
        self.assertEqual(self.files(), before)
        self.assertFalse(result["selected"])
        self.assertFalse(result["available"])

    def test_a_removal_cut_short_after_the_unlink_is_finished_by_the_same_removal(self):
        self.save()
        with patch.object(credentials, "_append", side_effect=OSError("fake metadata failure")), \
                state.serialized(self.root), self.assertRaises(LiveRefusal):
            credentials.remove_locked(self.root, "live", self.ref)
        row = credentials.listing_locked(self.root)["live"][0]
        self.assertEqual((row["available"], row["selected"], row["removed"]), (False, True, False))
        with state.serialized(self.root):
            result = credentials.remove_locked(self.root, "live", self.ref)
        self.assertEqual((result["removed"], result["selected"]), (True, False))
        before = self.files()
        with state.serialized(self.root):
            self.assertEqual(credentials.remove_locked(self.root, "live", self.ref), result)
        self.assertEqual(self.files(), before)

    def test_a_restored_file_does_not_make_a_removed_version_usable(self):
        self.save()
        path = self.root / "credentials" / "live" / (self.ref + ".json")
        original = path.read_bytes()
        with state.serialized(self.root):
            credentials.remove_locked(self.root, "live", self.ref)
        state.write_new(path, original)  # Out-of-band filesystem restoration is not a selection.
        self.assertFalse(credentials.listing_locked(self.root)["live"][0]["available"])
        self.assertFalse(self.save()["selected"])  # the same save sent again does not bring it back

    def test_a_symbolic_link_file_is_never_overwritten(self):
        self.save()
        target = self.root / "unrelated"
        target.write_bytes(b"keep")
        (self.root / "credentials" / "live" / (self.other + ".json")).symlink_to(target)
        with self.assertRaises(LiveRefusal):
            self.save(self.other)
        self.assertEqual(target.read_bytes(), b"keep")

    def test_active_preflight_without_account_slot_blocks_rotation_and_removal(self):
        self.save()
        directory = self.prepared(ref=self.ref)
        self.launch(directory, mode="preflight")
        self.assertIsNone(runs.active_run(self.root))
        with patch.object(runs, "inspect_runner", return_value={"State": {"Status": "running"}}):
            self.assertEqual(refused(self.save, self.other, error=LiveRefusal).code, "LIVE_CREDENTIAL_BUSY")
            with state.serialized(self.root), self.assertRaises(LiveRefusal):
                credentials.remove_locked(self.root, "live", self.ref)

    def test_unknown_runner_and_unreleased_clean_run_are_still_in_use(self):
        self.save()
        directory = self.prepared(ref=self.ref)
        self.launch(directory)
        with patch.object(runs, "inspect_runner", return_value=None), self.assertRaises(LiveRefusal):
            self.save(self.other)
        state.append(self.root / "account.jsonl", "reserved", directory.name)
        state.append(directory / "out" / "events.jsonl", "clean_stop", directory.name)
        with patch.object(runs, "inspect_runner", return_value={"State": {"Status": "exited"}}), \
                self.assertRaises(LiveRefusal):
            self.save(self.other)

    def test_every_retained_runner_is_checked_including_an_older_preflight(self):
        self.save()
        directory = self.prepared(ref=self.ref)
        self.launch(directory, mode="preflight", container="older")
        self.launch(directory, mode="preflight", container="latest")

        def runner(root, run_id, run_dir, manifest, launch):
            return {"State": {"Status": "running" if launch["container"] == "older" else "exited"}}

        with patch.object(runs, "inspect_runner", side_effect=runner), self.assertRaises(LiveRefusal):
            self.save(self.other)

    def test_exited_preflight_allows_rotation_only_with_consistent_host_state(self):
        self.save()
        directory = self.prepared(ref=self.ref)
        self.launch(directory, mode="preflight")
        for running in (True, None):
            with patch.object(runs, "inspect_runner", return_value={"State": {"Status": "exited", "Running": running}}), \
                    self.assertRaises(LiveRefusal):
                self.save(self.other)
        with patch.object(runs, "inspect_runner", return_value={"State": {"Status": "exited", "Running": False}}):
            self.save(self.other)
        self.assertEqual([row["credential_ref"] for row in credentials.listing_locked(self.root)["live"] if row["selected"]],
                         [self.other])

    def test_an_earlier_format_run_stays_on_disk_unread_and_holds_nothing(self):
        """0.x keeps no compatibility (the user, 2026-11-14): a run an earlier version prepared, here
        launched with no recorded end and no credential version, is neither listed nor read, and blocks no
        credential change or release; its files stay as they were."""
        self.save()
        directory = self.prepared(run_id="old-format", manifest_format="live-run")
        self.launch(directory)
        before = {path: data for path, data in self.files().items() if path.startswith("runs/")}
        with patch.object(runs, "inspect_runner", side_effect=AssertionError("earlier-format runner inspected")):
            self.assertEqual(credentials.listing_locked(self.root)["live"][0]["referenced_runs"], [])
            self.save(self.other)
            with state.serialized(self.root):
                self.assertTrue(credentials.remove_locked(self.root, "live", self.ref)["removed"])
                self.assertEqual(release.idle_locked(self.root), "idle")
                self.assertEqual(refused(credentials.run_path_locked, self.root, directory.name, "reconcile",
                                         error=LiveRefusal).code, "LIVE_CREDENTIAL_UNMANAGED")
            self.assertEqual(refused(runs.read_manifest, self.root, directory.name,
                                     error=LiveRefusal).code, "LIVE_RECORD_UNAVAILABLE")
        self.assertEqual({path: data for path, data in self.files().items() if path.startswith("runs/")}, before)

    def test_each_environment_keeps_its_own_key_and_a_run_binds_its_own_only(self):
        """The user, 2026-11-21: 「demo 和 live都有各自的key才对吧」. A demo save leaves the live key selected; a run of
        one environment cannot bind the other's key."""
        self.save()
        with state.serialized(self.root):
            credentials.save_locked(self.root, "demo", self.other, "fake-demo-key", "fake-demo-secret")
            listing = credentials.listing_locked(self.root)
            self.assertEqual([(row["credential_ref"], row["selected"]) for row in listing["live"]], [(self.ref, True)])
            self.assertEqual([(row["credential_ref"], row["selected"]) for row in listing["demo"]],
                             [(self.other, True)])
            self.assertEqual(credentials.prepare_path_locked(self.root, "demo", self.other),
                             self.root / "credentials" / "demo" / (self.other + ".json"))
            for environment, ref in (("live", self.other), ("demo", self.ref)):
                with self.subTest(environment=environment):
                    self.assertEqual(refused(credentials.prepare_path_locked, self.root, environment, ref,
                                             error=LiveRefusal).code, "LIVE_CREDENTIAL_CHANGED")
            directory = self.prepared(ref=self.other, run_id="demo-one", environment="demo")
            self.launch(directory, mode="preflight")
            self.assertEqual(credentials.run_path_locked(self.root, "demo-one", "reconcile"),
                             self.root / "credentials" / "demo" / (self.other + ".json"))

    def test_current_format_run_without_a_credential_version_is_unknown_ownership(self):
        self.save()
        self.prepared()
        before = self.files()
        self.assertEqual(refused(self.save, self.other, error=LiveRefusal).code, "LIVE_CREDENTIAL_BUSY")
        self.assertEqual(refused(credentials.listing_locked, self.root, error=LiveRefusal).code, "LIVE_CREDENTIAL_BUSY")
        with state.serialized(self.root):
            self.assertEqual(refused(credentials.prepare_path_locked, self.root, "live", self.ref, error=LiveRefusal).code,
                             "LIVE_CREDENTIAL_BUSY")
        self.assertEqual(self.files(), before)

    def test_an_unknown_run_has_no_managed_credential_version(self):
        self.save()
        self.prepared(ref=self.ref)
        with state.serialized(self.root), self.assertRaises(LiveRefusal) as caught:
            credentials.run_path_locked(self.root, "never-prepared", "reconcile")
        self.assertEqual(caught.exception.code, "LIVE_CREDENTIAL_UNMANAGED")

    def test_new_start_uses_current_version_but_reconcile_keeps_original(self):
        self.save()
        directory = self.prepared(ref=self.ref)
        original = credentials.run_path_locked(self.root, directory.name, "run")
        self.save(self.other)
        for mode in ("run", "preflight"):
            with state.serialized(self.root), self.assertRaises(LiveRefusal) as caught:
                credentials.run_path_locked(self.root, directory.name, mode)
            self.assertEqual(caught.exception.code, "LIVE_CREDENTIAL_CHANGED")
        with state.serialized(self.root):
            self.assertEqual(credentials.run_path_locked(self.root, directory.name, "reconcile"), original)

    def test_unstarted_preparation_can_lose_a_version_but_is_not_rebound(self):
        self.save()
        directory = self.prepared(ref=self.ref)
        with state.serialized(self.root):
            result = credentials.remove_locked(self.root, "live", self.ref)
        self.assertEqual(result["referenced_runs"], [directory.name])
        self.save(self.other)
        with state.serialized(self.root), self.assertRaises(LiveRefusal):
            credentials.run_path_locked(self.root, directory.name, "reconcile")
        self.assertEqual(runs.host_events(directory)[0]["credential_ref"], self.ref)

    def test_an_unrelated_old_version_can_be_removed_during_a_known_new_run(self):
        self.save()
        self.save(self.other)
        directory = self.prepared(ref=self.other)
        self.launch(directory)
        state.append(self.root / "account.jsonl", "reserved", directory.name)
        with state.serialized(self.root), patch.object(runs, "inspect_runner", side_effect=AssertionError("unrelated run read")):
            result = credentials.remove_locked(self.root, "live", self.ref)
        self.assertTrue(result["removed"])
        self.assertEqual(runs.active_run(self.root), directory.name)

    def test_invalid_input_has_a_stable_error_without_secret_echo(self):
        for invalid in (None, "", " " + self.secret, self.secret + "x" * 16384):
            with state.serialized(self.root), self.assertRaises(LiveRefusal) as caught:
                credentials.save_locked(self.root, "live", self.ref, self.key, invalid)
            self.assertNotIn(self.key, str(caught.exception))
            self.assertNotIn(self.secret, str(caught.exception))
        self.assertFalse((self.root / "credentials").exists())

    def test_corrupt_history_and_secret_permissions_do_not_claim_availability(self):
        self.save()
        path = self.root / "credentials" / "live" / (self.ref + ".json")
        path.chmod(0o644)
        self.assertFalse(credentials.listing_locked(self.root)["live"][0]["available"])
        with state.serialized(self.root), self.assertRaises(LiveRefusal):
            credentials.prepare_path_locked(self.root, "live", self.ref)
        metadata = self.root / "credentials" / "live" / "metadata.jsonl"
        with metadata.open("ab") as stream:
            stream.write(b'{"event":"sele')
        with self.assertRaises(LiveRefusal):
            credentials.listing_locked(self.root)["live"]

    def test_prepare_and_rotation_share_the_existing_lock(self):
        self.save()
        selecting, finish, reading = threading.Event(), threading.Event(), threading.Event()
        errors = []
        original = credentials._append

        def append(root, environment, event, ref):
            if event == "selected" and ref == self.other:
                selecting.set()
                if not finish.wait(5):
                    raise RuntimeError("test lock handoff timed out")
            return original(root, environment, event, ref)

        def rotate():
            try:
                self.save(self.other)
            except Exception as exc:
                errors.append(type(exc).__name__)

        def prepare():
            reading.set()
            try:
                with state.serialized(self.root):
                    credentials.prepare_path_locked(self.root, "live", self.ref)
            except LiveRefusal as exc:
                errors.append(exc.code)

        with patch.object(credentials, "_append", side_effect=append):
            writer = threading.Thread(target=rotate)
            reader = threading.Thread(target=prepare)
            writer.start()
            self.assertTrue(selecting.wait(5))
            reader.start()
            self.assertTrue(reading.wait(5))
            self.assertEqual(errors, [])
            finish.set()
            writer.join(5)
            reader.join(5)
        self.assertFalse(writer.is_alive() or reader.is_alive())
        self.assertEqual(errors, ["LIVE_CREDENTIAL_CHANGED"])
