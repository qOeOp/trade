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
from live import credentials, release, requests, runs, state
from tests.live.authority_fixture import recover
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
            return credentials.save_locked(self.root, ref or self.ref, self.key, self.secret)

    def upload(self, request_id="upload-first", ref=None):
        ref = ref or self.ref
        command = {"action": "credential_save", "target": {"credential_ref": ref}, "inputs": {}}
        return requests.dispatch(self.root, request_id, command,
                                 lambda root, rid: credentials.save_locked(root, ref, self.key, self.secret,
                                                                           request_id=rid))

    def prepared(self, *, ref=None, run_id="prepared-one", manifest_format=runs.MANIFEST_FORMAT):
        directory = state.directory(self.root, run_id)
        for part in (directory, directory / "inputs", directory / "out", directory / "egress"):
            state.private_directory(part)
        manifest = {"format": manifest_format, "run_id": run_id, "runtime": IDENTITY,
                    "symbols": ["BTCUSDT"], "config": {"memory": "2g"},
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

    def partial_prepare(self, *, inputs_change=None):
        inputs = {"source_id": "example", "research_at": "a" * 32, "candidate": "example@1",
                  "symbols": ["BTCUSDT"], "source_sha256": hashlib.sha256(b"source").hexdigest(),
                  "entry_class": "Example", "universe_sha256": hashlib.sha256(b"{}").hexdigest(),
                  "runtime": IDENTITY["image_ref"],
                  "universe_file": "/private/fake-universe.json",
                  "config": {"drawdown_brake": "0.15", "leverage": "3",
                             "duration_seconds": 8100, "memory": "2g"}}
        if inputs_change:
            inputs_change(inputs)
        command = {"action": "prepare", "target": {"run_id": "partial-run", "credential_ref": self.ref},
                   "inputs": inputs}

        def interrupted(root, request_id):
            directory = state.directory(root, "partial-run")
            state.private_directory(directory)
            state.private_directory(directory / "inputs")
            state.write_new(directory / "inputs" / "strategy.py", b"source")
            raise SystemExit("fake interruption")

        with self.assertRaises(SystemExit):
            requests.dispatch(self.root, "prepare-original", command, interrupted)
        return state.directory(self.root, "partial-run")

    def resolve_partial_path(self, run_id="partial-run", ref=None):
        with state.serialized(self.root):
            return credentials.resolve_prepare_path_locked(self.root, run_id, ref or self.ref, "prepare-original")

    def test_partial_prepare_resolves_only_original_path_without_filling_inputs(self):
        self.save()
        directory = self.partial_prepare()
        before = self.files()
        with patch.object(runs, "_credentials", side_effect=AssertionError("path resolution read a secret")):
            result = self.resolve_partial_path()
        self.assertEqual(result, self.root / "credentials" / (self.ref + ".json"))
        self.assertEqual(self.files(), before)
        self.assertFalse((directory / "inputs" / "manifest.json").exists())

    def test_partial_prepare_does_not_skip_another_active_preflight(self):
        self.save()
        other = self.prepared(ref=self.ref)
        self.launch(other, mode="preflight")
        self.partial_prepare()
        with patch.object(runs, "inspect_runner", return_value={"State": {"Status": "running", "Running": True}}), \
                self.assertRaises(LiveRefusal) as caught:
            self.resolve_partial_path()
        self.assertEqual(caught.exception.code, "LIVE_CREDENTIAL_BUSY")

    def test_partial_prepare_does_not_skip_an_unknown_execution(self):
        self.save()
        other = self.prepared(ref=self.ref)
        self.launch(other)
        self.partial_prepare()
        with patch.object(runs, "inspect_runner", return_value=None), self.assertRaises(LiveRefusal) as caught:
            self.resolve_partial_path()
        self.assertEqual(caught.exception.code, "LIVE_CREDENTIAL_BUSY")

    def test_partial_prepare_with_a_launch_is_not_local_recovery(self):
        self.save()
        directory = self.partial_prepare()
        self.launch(directory)
        self.assertEqual(refused(self.resolve_partial_path, error=LiveRefusal).code, "LIVE_RUN_CONFLICT")

    def test_partial_prepare_with_native_output_is_not_local_recovery(self):
        self.save()
        directory = self.partial_prepare()
        state.private_directory(directory / "out")
        state.write_new(directory / "out" / "armed.json", b"{}")
        self.assertEqual(refused(self.resolve_partial_path, error=LiveRefusal).code, "LIVE_RUN_CONFLICT")

    def test_partial_prepare_with_even_released_account_history_is_not_local(self):
        self.save()
        self.partial_prepare()
        state.append(self.root / "account.jsonl", "reserved", "partial-run")
        state.append(self.root / "account.jsonl", "released", "partial-run", reason="never_armed")
        self.assertEqual(refused(self.resolve_partial_path, error=LiveRefusal).code, "LIVE_RUN_CONFLICT")

    def test_partial_prepare_cannot_change_target_or_credential_reference(self):
        self.save()
        self.partial_prepare()
        for run_id, ref in (("another-run", self.ref), ("partial-run", self.other)):
            with self.subTest(run_id=run_id, ref=ref), self.assertRaises(LiveRefusal) as caught:
                self.resolve_partial_path(run_id, ref)
            self.assertEqual(caught.exception.code, "LIVE_RUN_CONFLICT")

    def test_partial_prepare_still_requires_current_credential_version(self):
        self.save()
        self.save(self.other)
        self.partial_prepare()
        self.assertEqual(refused(self.resolve_partial_path, error=LiveRefusal).code, "LIVE_CREDENTIAL_CHANGED")

    def test_partial_prepare_requires_complete_original_input_declaration(self):
        self.save()
        self.partial_prepare(inputs_change=lambda value: value["config"].pop("memory"))
        self.assertEqual(refused(self.resolve_partial_path, error=LiveRefusal).code, "LIVE_RUN_CONFLICT")

    def test_secret_is_private_and_only_metadata_is_returned(self):
        result = self.upload()
        path = self.root / "credentials" / (self.ref + ".json")
        self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        self.assertEqual(path.parent.stat().st_mode & 0o777, 0o700)
        found = read_credentials(path)
        self.assertEqual((found.api_key, found.api_secret), (self.key, self.secret))
        exposed = json.dumps(result) + (path.parent / "metadata.jsonl").read_text()
        exposed += (self.root / "requests" / "upload-first.jsonl").read_text()
        self.assertNotIn(self.key, exposed)
        self.assertNotIn(self.secret, exposed)
        self.assertEqual(result["request"]["outcome"], "effect_recorded")

    def test_request_effect_uses_version_identity_when_wall_clock_moves_backwards(self):
        # Both modules use the standard time module: claim=300, saved=200, selected=100.
        with patch("live.requests.time.time_ns", side_effect=[300, 200, 100]):
            result = self.upload()
        self.assertEqual(result["request"]["outcome"], "effect_recorded")
        self.assertEqual(credentials.listing_locked(self.root)[0]["observed_ns"], "200")

    def test_a_closed_upload_id_never_saves_and_does_not_block_a_fresh_upload(self):
        closed = recover(self.root, "upload-first")
        before = (self.root / "requests" / "upload-first.jsonl").read_bytes()
        result = self.upload()
        self.assertEqual(result["request"], closed)
        self.assertFalse((self.root / "credentials").exists())
        self.assertEqual((self.root / "requests" / "upload-first.jsonl").read_bytes(), before)
        result = self.upload("upload-second")
        self.assertEqual(result["request"]["outcome"], "effect_recorded")

    def test_closed_record_is_not_a_credential_or_partial_prepare_recovery_claim(self):
        self.save()
        recover(self.root, "prepare-original")
        before = self.files()
        with state.serialized(self.root) as root:
            claim = requests.read_locked(root, "prepare-original")
            self.assertEqual(refused(credentials.recover_locked, root, claim,
                                     error=LiveRefusal).code, "LIVE_REQUEST_CLOSED_UNCLAIMED")
            self.assertEqual(refused(credentials.resolve_prepare_path_locked, root, "partial-run", self.ref,
                                     "prepare-original", error=LiveRefusal).code, "LIVE_RUN_CONFLICT")
        self.assertEqual(self.files(), before)

    def test_listing_does_not_open_secret_bytes_or_change_files(self):
        self.save()
        before = self.files()
        original = os.open

        def opened(path, flags, *args, **kwargs):
            if str(path).endswith(self.ref + ".json"):
                raise AssertionError("metadata read opened secret")
            return original(path, flags, *args, **kwargs)

        with state.reading(self.root), patch.object(os, "open", side_effect=opened):
            result = credentials.listing_locked(self.root)
        self.assertEqual(result[0]["credential_ref"], self.ref)
        self.assertEqual(self.files(), before)
        absent = self.root / "not-initialized"
        self.assertEqual(credentials.listing_locked(absent), [])
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
        self.assertFalse(list((self.root / "credentials").glob("*.pending")))

    def test_partial_write_stays_private_and_duplicate_upload_never_repairs(self):
        original = state.write_new

        def partial(path, data):
            if path.name.endswith(".pending"):
                original(path, data[:10])
                raise OSError("fake disk failure")
            return original(path, data)

        with patch.object(state, "write_new", side_effect=partial), self.assertRaises(LiveRefusal):
            self.upload()
        before = self.files()
        self.assertFalse((self.root / "credentials" / (self.ref + ".json")).exists())
        with patch.object(credentials, "save_locked", side_effect=AssertionError("upload replayed")):
            repeated = self.upload()
        self.assertEqual(repeated["request"]["outcome"], "outcome_unknown")
        self.assertEqual(self.files(), before)

    def test_crash_after_file_publish_keeps_upload_unknown_without_recreation(self):
        with patch.object(credentials, "_append", side_effect=OSError("fake fsync failure")), \
                self.assertRaises(LiveRefusal):
            self.upload()
        path = self.root / "credentials" / (self.ref + ".json")
        before = path.read_bytes()
        self.assertEqual(self.upload()["request"]["outcome"], "outcome_unknown")
        self.assertEqual(path.read_bytes(), before)
        self.assertEqual(credentials.listing_locked(self.root), [])

    def test_saved_without_selected_does_not_replace_previous_selection(self):
        self.save()
        original = credentials._append

        def append(root, event, ref):
            if event == "selected" and ref == self.other:
                raise OSError("fake selected failure")
            return original(root, event, ref)

        with patch.object(credentials, "_append", side_effect=append), self.assertRaises(LiveRefusal):
            self.upload(ref=self.other)
        listed = credentials.listing_locked(self.root)
        self.assertEqual([row["credential_ref"] for row in listed if row["selected"]], [self.ref])
        self.assertEqual(self.upload(ref=self.other)["request"]["outcome"], "outcome_unknown")

    def test_repeated_upload_after_removal_cannot_resave_or_reselect(self):
        self.upload()
        with state.serialized(self.root):
            result = credentials.remove_locked(self.root, self.ref)
        self.assertTrue(result["removed"])
        before = self.files()
        self.assertEqual(self.upload()["request"]["outcome"], "effect_recorded")
        self.assertEqual(self.files(), before)
        self.assertFalse(result["selected"])
        self.assertFalse(result["available"])

    def test_crash_after_unlink_does_not_claim_removed_or_replay(self):
        self.upload()
        command = {"action": "credential_remove", "target": {"credential_ref": self.ref}, "inputs": {}}
        with patch.object(credentials, "_append", side_effect=OSError("fake metadata failure")), \
                self.assertRaises(LiveRefusal):
            requests.dispatch(self.root, "remove-first", command,
                              lambda root, rid: credentials.remove_locked(root, self.ref, request_id=rid))
        row = credentials.listing_locked(self.root)[0]
        self.assertFalse(row["available"])
        self.assertTrue(row["selected"])
        self.assertFalse(row["removed"])
        repeated = requests.dispatch(self.root, "remove-first", command,
                                     lambda *_: self.fail("removal was replayed"))
        self.assertEqual(repeated["request"]["outcome"], "outcome_unknown")

    def test_explicit_resolution_finishes_unlinked_removal_without_secret_replay(self):
        self.upload()
        command = {"action": "credential_remove", "target": {"credential_ref": self.ref}, "inputs": {}}
        with patch.object(credentials, "_append", side_effect=OSError("fake metadata failure")), \
                self.assertRaises(LiveRefusal):
            requests.dispatch(self.root, "remove-first", command,
                              lambda root, rid: credentials.remove_locked(root, self.ref, request_id=rid))
        self.assertEqual(requests.view(self.root, "remove-first")["outcome"], "outcome_unknown")
        with patch.object(Path, "unlink", side_effect=AssertionError("resolution repeated delete")):
            result = recover(self.root, "remove-first")
        self.assertEqual(result["outcome"], "effect_recorded")
        row = credentials.listing_locked(self.root)[0]
        self.assertTrue(row["removed"])
        self.assertFalse(row["selected"])
        before = self.files()
        self.assertEqual(recover(self.root, "remove-first")["outcome"], "effect_recorded")
        self.assertEqual(self.files(), before)

    def test_explicit_resolution_closes_partial_upload_without_selecting_or_discarding_it(self):
        self.save()
        original = credentials._append

        def append(root, event, ref):
            if event == "selected" and ref == self.other:
                raise OSError("fake selected failure")
            return original(root, event, ref)

        with patch.object(credentials, "_append", side_effect=append), self.assertRaises(LiveRefusal):
            self.upload(ref=self.other)
        path = self.root / "credentials" / (self.other + ".json")
        retained = path.read_bytes()
        result = recover(self.root, "upload-first")
        self.assertEqual((result["outcome"], result["code"]), ("refused", "LIVE_CREDENTIAL_INCOMPLETE"))
        self.assertEqual(path.read_bytes(), retained)
        self.assertEqual([row["credential_ref"] for row in credentials.listing_locked(self.root) if row["selected"]],
                         [self.ref])
        self.assertEqual(self.upload(ref=self.other)["request"]["outcome"], "refused")
        self.assertEqual(self.upload("upload-next", "c" * 32)["request"]["outcome"], "effect_recorded")

    def test_resolution_keeps_unknown_when_a_credential_reference_is_active(self):
        self.upload()
        command = {"action": "credential_remove", "target": {"credential_ref": self.ref}, "inputs": {}}
        with patch.object(credentials, "_append", side_effect=OSError("fake metadata failure")), \
                self.assertRaises(LiveRefusal):
            requests.dispatch(self.root, "remove-first", command,
                              lambda root, rid: credentials.remove_locked(root, self.ref, request_id=rid))
        # An out-of-band observation is deliberately inconsistent with the original idle guard.
        # Recovery must recheck it rather than trust that the earlier mutation was safe.
        directory = self.prepared(ref=self.ref)
        self.launch(directory, mode="preflight")
        with patch.object(runs, "inspect_runner", return_value={"State": {"Status": "running", "Running": True}}):
            self.assertEqual(recover(self.root, "remove-first")["outcome"], "outcome_unknown")
        self.assertFalse(credentials.listing_locked(self.root)[0]["removed"])

    def test_resolution_does_not_accept_unsafe_partial_file_identity(self):
        with patch.object(credentials, "_append", side_effect=OSError("fake fsync failure")), \
                self.assertRaises(LiveRefusal):
            self.upload()
        path = self.root / "credentials" / (self.ref + ".json")
        path.chmod(0o644)
        self.assertEqual(recover(self.root, "upload-first")["outcome"], "outcome_unknown")

    def test_a_restored_file_does_not_make_a_removed_version_usable(self):
        self.save()
        path = self.root / "credentials" / (self.ref + ".json")
        original = path.read_bytes()
        with state.serialized(self.root):
            credentials.remove_locked(self.root, self.ref)
        state.write_new(path, original)  # Out-of-band filesystem restoration is not a selection.
        self.assertFalse(credentials.listing_locked(self.root)[0]["available"])
        with self.assertRaises(LiveRefusal):
            self.save()

    def test_existing_or_symbolic_link_file_is_never_overwritten(self):
        self.save()
        before = self.files()
        with self.assertRaises(LiveRefusal):
            self.save()
        self.assertEqual(self.files(), before)
        target = self.root / "unrelated"
        target.write_bytes(b"keep")
        (self.root / "credentials" / (self.other + ".json")).symlink_to(target)
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
                credentials.remove_locked(self.root, self.ref)

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
        self.assertEqual([row["credential_ref"] for row in credentials.listing_locked(self.root) if row["selected"]],
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
            self.assertEqual(credentials.listing_locked(self.root)[0]["referenced_runs"], [])
            self.save(self.other)
            with state.serialized(self.root):
                self.assertTrue(credentials.remove_locked(self.root, self.ref)["removed"])
                self.assertEqual(release.idle_locked(self.root), "idle")
                self.assertEqual(refused(credentials.run_path_locked, self.root, directory.name, "reconcile",
                                         error=LiveRefusal).code, "LIVE_CREDENTIAL_UNMANAGED")
            self.assertEqual(refused(runs.read_manifest, self.root, directory.name,
                                     error=LiveRefusal).code, "LIVE_RECORD_UNAVAILABLE")
        self.assertEqual({path: data for path, data in self.files().items() if path.startswith("runs/")}, before)

    def test_current_format_run_without_a_credential_version_is_unknown_ownership(self):
        self.save()
        self.prepared()
        before = self.files()
        self.assertEqual(refused(self.save, self.other, error=LiveRefusal).code, "LIVE_CREDENTIAL_BUSY")
        self.assertEqual(refused(credentials.listing_locked, self.root, error=LiveRefusal).code, "LIVE_CREDENTIAL_BUSY")
        with state.serialized(self.root):
            self.assertEqual(refused(credentials.prepare_path_locked, self.root, self.ref, error=LiveRefusal).code,
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
            result = credentials.remove_locked(self.root, self.ref)
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
            result = credentials.remove_locked(self.root, self.ref)
        self.assertTrue(result["removed"])
        self.assertEqual(runs.active_run(self.root), directory.name)

    def test_invalid_input_has_a_stable_error_without_secret_echo(self):
        for invalid in (None, "", " " + self.secret, self.secret + "x" * 16384):
            with state.serialized(self.root), self.assertRaises(LiveRefusal) as caught:
                credentials.save_locked(self.root, self.ref, self.key, invalid)
            self.assertNotIn(self.key, str(caught.exception))
            self.assertNotIn(self.secret, str(caught.exception))
        self.assertFalse((self.root / "credentials").exists())

    def test_corrupt_history_and_secret_permissions_do_not_claim_availability(self):
        self.save()
        path = self.root / "credentials" / (self.ref + ".json")
        path.chmod(0o644)
        self.assertFalse(credentials.listing_locked(self.root)[0]["available"])
        with state.serialized(self.root), self.assertRaises(LiveRefusal):
            credentials.prepare_path_locked(self.root, self.ref)
        metadata = self.root / "credentials" / "metadata.jsonl"
        with metadata.open("ab") as stream:
            stream.write(b'{"event":"sele')
        with self.assertRaises(LiveRefusal):
            credentials.listing_locked(self.root)

    def test_prepare_and_rotation_share_the_existing_lock(self):
        self.save()
        selecting, finish, reading = threading.Event(), threading.Event(), threading.Event()
        errors = []
        original = credentials._append

        def append(root, event, ref):
            if event == "selected" and ref == self.other:
                selecting.set()
                if not finish.wait(5):
                    raise RuntimeError("test lock handoff timed out")
            return original(root, event, ref)

        def rotate():
            try:
                self.save(self.other)
            except Exception as exc:
                errors.append(type(exc).__name__)

        def prepare():
            reading.set()
            try:
                with state.serialized(self.root):
                    credentials.prepare_path_locked(self.root, self.ref)
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
