"""Installed authority counterexamples, isolated roots and fake credentials only."""

import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from cli import main as cli
from deploy.live_configuration import OPERATOR_FIELDS
from deploy.release_host import durable_json, route_config
from engine.live_errors import LiveRefusal
from live import host as host_runtime
from live import authority, control, release, runs, serve, state
from tests.live.authority_fixture import WEB, inject_cli, install

OTHER = "trade-release-web-" + "b" * 40


def prepared(root, run_id="original"):
    directory = root / "runs" / run_id
    for name in ("inputs", "out"):
        state.private_directory(directory / name)
    source, universe = b"class Example: pass\n", b"{}"
    state.write_new(directory / "inputs/strategy.py", source)
    state.write_new(directory / "inputs/universe.json", universe)
    manifest = {"format": "live-run", "run_id": run_id,
                "source": {"entry_class": "Example", "source_sha256": hashlib.sha256(source).hexdigest()},
                "universe_sha256": hashlib.sha256(universe).hexdigest(),
                "runtime": {"image_ref": "ghcr.io/qoeop/trade-runtime@sha256:" + "a" * 64,
                            "platform": "linux/amd64"},
                "origin_candidate": {"strategy_id": "example", "revision": 1},
                "symbols": ["BTCUSDT"], "config": {"memory": "2g"}, "credential_binding": "f" * 64}
    state.write_new(directory / "inputs/manifest.json", state.encode(manifest))
    state.append(directory / "lifecycle.jsonl", "prepared", run_id)
    return directory, manifest


class InstalledAuthorityTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="la-", dir="/tmp")
        self.addCleanup(temporary.cleanup)
        self.work = Path(temporary.name).resolve()
        self.root = self.work / "custody"
        self.fixture = install(self, self.root, release_state=self.work / "i", mock_inventory=False)
        self.scope = authority.operator(self.root, WEB)
        self.declaration = self.fixture.state / "live/configuration.json"
        self.no_containers = patch.object(host_runtime, "checked", return_value="")
        self.no_containers.start()
        self.addCleanup(self.no_containers.stop)

    def files(self):
        return {str(p): p.read_bytes() for p in self.root.rglob("*") if p.is_file()}

    def refused(self, action, code="LIVE_RELEASE_UNAVAILABLE"):
        with self.assertRaises(LiveRefusal) as found:
            action()
        self.assertEqual(found.exception.code, code)

    def test_missing_declaration_never_falls_back_or_reads_credentials(self):
        self.declaration.unlink()
        before = self.files()
        with patch.object(runs, "_credentials", side_effect=AssertionError("key read")), \
                patch.object(runs, "launch_locked", side_effect=AssertionError("venue launch")):
            for mode in ("preflight", "run", "reconcile"):
                self.refused(lambda: runs.launch(self.root, "original", Path("unused-key"), mode, scope=self.scope))
        self.assertEqual(before, self.files())

    def test_alternate_root_and_environment_overrides_do_not_create_a_second_namespace(self):
        alternate = self.work / "other"
        with patch.dict(os.environ, {"LIVE_ROOT": str(alternate), "LIVE_AUTHORITY": str(self.fixture.file),
                                     "TRADE_RELEASE_STATE": str(self.fixture.state)}):
            self.refused(lambda: authority.operator(alternate, WEB), "LIVE_IDENTITY_CHANGED")
        self.assertFalse(alternate.exists())

    def test_unbound_and_copied_configurations_do_not_obtain_authority(self):
        self.refused(lambda: authority.retained(self.fixture.config, None))
        copy = self.work / "copied.json"
        copy.write_bytes(self.fixture.file.read_bytes())
        self.refused(lambda: authority.from_file(copy, self.fixture.binding))
        self.refused(lambda: authority.from_file(self.fixture.file, release.Binding(self.work, WEB)))

    def test_missing_lock_is_not_recreated_by_new_effect_or_request_recovery(self):
        (self.root / "account.lock").unlink()
        self.refused(lambda: authority.operator(self.root, WEB))
        status, body = control.execute(self.fixture.config, "resolve", "missing-request",
                                       {"request_id": "missing-request"}, binding=self.fixture.binding)
        self.assertEqual((status, body["error"]["code"]), (503, "LIVE_RELEASE_UNAVAILABLE"))
        self.assertFalse((self.root / "account.lock").exists())
        self.assertFalse((self.root / "requests").exists())

    def test_declaration_snapshot_and_inode_are_rechecked_after_capture(self):
        scope = authority.operator(self.root, WEB)
        declared = state.read(self.declaration)
        durable_json(self.declaration, {**declared, "defaults": {**declared["defaults"], "budget_usdt": "91"}})
        self.refused(lambda: scope.admit_locked(self.root))
        durable_json(self.declaration, declared)
        original = self.fixture.file.read_bytes()
        changed = state.read(self.fixture.file)
        changed["runtime"] = "ghcr.io/qoeop/trade-runtime@sha256:" + "c" * 64
        durable_json(self.fixture.file, changed)
        self.refused(scope.retained)
        self.fixture.file.write_bytes(original)
        replacement = self.root / "replacement"
        state.write_new(replacement, b"")
        replacement.replace(self.root / "account.lock")
        self.refused(scope.retained)

    def test_release_transaction_and_retired_owner_cannot_admit_new_effects(self):
        scope = authority.operator(self.root, WEB)
        durable_json(self.fixture.state / "transaction.json", {"candidate": OTHER, "previous": WEB})
        self.refused(lambda: scope.admit_locked(self.root))
        scope.admit_locked(self.root, maintenance=True)
        (self.fixture.state / "transaction.json").unlink()
        durable_json(self.fixture.state / "router/active.json", route_config(OTHER, None))
        self.refused(lambda: scope.admit_locked(self.root))
        self.refused(lambda: scope.admit_locked(self.root, maintenance=True))

    def test_exact_receipt_read_survives_current_declaration_loss_without_new_upload(self):
        body = {"request_id": "original-save", "api_key": "fake-key", "api_secret": "fake-secret"}
        first = control.execute(self.fixture.config, "credential_save", None, body, binding=self.fixture.binding)
        self.assertEqual(first[0], 200, first)
        self.declaration.unlink()
        before = self.files()
        self.assertEqual(control.execute(self.fixture.config, "credential_save", None, body,
                                         binding=self.fixture.binding), first)
        self.assertEqual(before, self.files())
        status, refused = control.execute(self.fixture.config, "credential_save", None,
                                          {**body, "request_id": "new-upload"}, binding=self.fixture.binding)
        self.assertEqual((status, refused["error"]["code"]), (503, "LIVE_RELEASE_UNAVAILABLE"))
        self.assertEqual(before, self.files())

    def test_actual_web_command_child_preserves_original_stop_with_missing_or_changed_authority(self):
        directory, manifest = prepared(self.root)
        inject_cli(self, self.fixture.state)
        for kind in ("missing", "changed", "retired"):
            with self.subTest(kind=kind):
                if kind == "missing":
                    self.declaration.unlink()
                elif kind == "changed":
                    other = self.work / "other"
                    with state.serialized(other):
                        pass
                    value = {key: self.fixture.raw[key] for key in OPERATOR_FIELDS}
                    durable_json(self.declaration, {"format": "live-deployment-v1", **value, "root": str(other)})
                else:
                    durable_json(self.fixture.state / "router/active.json", route_config(OTHER, None))
                status, response = serve.command(self.fixture.file, "stop", "original", {"request_id": f"stop-{kind}-request"},
                                                  binding=self.fixture.binding)
                self.assertEqual(status, 200, response)
                self.assertTrue((directory / "out/STOP").exists())
                for action in ("start", "reconcile", "resolve"):
                    target = "new-unknown-request" if action == "resolve" else "original"
                    body = {"request_id": target if action == "resolve" else f"{action}-{kind}-request"}
                    if action == "start":
                        body["confirm_real_orders"] = manifest["source"]["source_sha256"]
                    status, response = serve.command(self.fixture.file, action, target, body, binding=self.fixture.binding)
                    self.assertEqual(status, 503, response)
                    self.assertEqual(response["error"]["code"], "LIVE_RELEASE_UNAVAILABLE")
        self.assertFalse(any(row["event"] == "launch_requested" for row in state.events(directory / "lifecycle.jsonl")))

    def test_unbound_real_cli_and_missing_mount_fail_without_creating_root(self):
        # Uses the production fixed path, no injection or real keys. A genuinely installed
        # host runs these negative cases in its isolated service-container fixture instead.
        if Path("/var/lib/trade-release/live/configuration.json").exists():
            self.skipTest("this host has an installation; run missing-mount case in isolated container")
        alternate = self.work / "absent"
        command = [sys.executable, "-m", "cli.main", "live", "reconcile", "--root", str(alternate),
                   "--run-id", "original", "--release-web", WEB, "--credentials-file", str(self.work / "never-read")]
        result = subprocess.run(command, capture_output=True, text=True, check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("LIVE_RELEASE_UNAVAILABLE", result.stderr)
        self.assertFalse(alternate.exists())
        result = subprocess.run([sys.executable, "-m", "cli.main", "live", "web-command", "--configuration",
                                 str(self.fixture.file), "--action", "credential_save"],
                                input=json.dumps({"request_id": "unbound-save", "api_key": "fake", "api_secret": "fake"}),
                                capture_output=True, text=True, check=False)
        response = json.loads(result.stdout)
        self.assertEqual(response["status"], 503)
        self.assertFalse((self.root / "credentials").exists())

    def test_inspector_rejects_a_noninstalled_configuration_and_keeps_current_root(self):
        copy = self.work / "configuration.json"
        copy.write_bytes(self.fixture.file.read_bytes())
        self.refused(lambda: authority.inspection(copy))
        self.assertEqual(authority.inspection(self.fixture.file).root, self.root)

    def test_status_and_logs_keep_historical_observation_pure(self):
        directory, _ = prepared(self.root)
        self.declaration.unlink()
        before = self.files()
        parser = cli._parser()
        for action in ("status", "logs"):
            args = parser.parse_args(["live", action, "--root", str(self.root), "--run-id", "original"])
            value, code = cli._dispatch(args, [])
            self.assertEqual(code, 0)
            self.assertEqual(value["run_id"], "original")
        self.assertEqual(before, self.files())
        self.assertEqual(len(state.events(directory / "lifecycle.jsonl")), 1)

    def operator_args(self, action, selected=WEB):
        args = ["live", action, "--root", str(self.root), "--run-id", "original", "--release-web", selected,
                "--credentials-file", str(self.work / "never-read-key")]
        if action == "start":
            args += ["--confirm-real-orders", hashlib.sha256(b"class Example: pass\n").hexdigest()]
        if action == "preflight":
            args += ["--research-ledger", "unused-reader", "--research-at", "a" * 32, "--candidate", "example@1",
                     "--symbols", "BTCUSDT", "--universe-file", "unused", "--budget-usdt", "90",
                     "--max-loss-usdt", "2", "--duration-seconds", "8100", "--leverage", "3",
                     "--market", str(self.work / "market-profile.json")]
            (self.work / "market-profile.json").write_text(
                '{"name": "market", "kind": "market", "role": "reader", "root": "/unused-market"}')
        return cli._parser().parse_args(args)

    def commit_other(self):
        self.fixture.snapshot(OTHER)
        durable_json(self.fixture.state / "router/active.json", route_config(OTHER, None))

    def test_selected_service_a_started_after_b_commits_cannot_adopt_b_identity(self):
        self.commit_other()
        before = self.files()
        with patch.object(runs, "_credentials", side_effect=AssertionError("key read")), \
                patch.object(runs, "prepare_locked", side_effect=AssertionError("preparation effect")), \
                patch.object(runs, "launch_locked", side_effect=AssertionError("launch effect")), \
                patch.object(cli.db, "profile", side_effect=AssertionError("reader lookup")):
            for action in ("preflight", "start", "reconcile"):
                self.refused(lambda: cli._dispatch(self.operator_args(action), []))
        self.assertEqual(self.files(), before)

    def test_prepare_keeps_initial_identity_when_publication_finishes_during_profile_lookup(self):
        def reader(_):
            self.commit_other()
            return object()
        with patch.object(cli.db, "profile", side_effect=reader), \
                patch.object(authority, "operator", wraps=authority.operator) as selected, \
                patch.object(runs, "prepare_locked", side_effect=AssertionError("preparation effect")):
            self.refused(lambda: cli._dispatch(self.operator_args("preflight"), []))
        selected.assert_called_once_with(self.root, WEB)
        self.assertFalse((self.root / "runs").exists())

    def test_preflight_keeps_preparation_identity_through_review_and_launch(self):
        def review(*_):
            self.commit_other()
            return {}
        with patch.object(cli.db, "profile", return_value=object()), \
                patch.object(authority, "operator", wraps=authority.operator) as selected, \
                patch.object(runs, "prepare_locked", return_value={}) as prepare, \
                patch.object(runs, "review", side_effect=review), \
                patch.object(runs, "launch_locked", side_effect=AssertionError("launch effect")):
            self.refused(lambda: cli._dispatch(self.operator_args("preflight"), []))
        selected.assert_called_once_with(self.root, WEB)
        prepare.assert_called_once()

    def test_start_keeps_initial_identity_after_source_confirmation_and_route_switch(self):
        prepared(self.root)
        confirm = runs.require_confirmed
        def changed(*args, **kwargs):
            confirm(*args, **kwargs)
            self.commit_other()
        with patch.object(runs, "require_confirmed", side_effect=changed), \
                patch.object(authority, "operator", wraps=authority.operator) as selected, \
                patch.object(runs, "launch_locked", side_effect=AssertionError("launch effect")):
            self.refused(lambda: cli._dispatch(self.operator_args("start"), []))
        selected.assert_called_once_with(self.root, WEB)

    def test_current_selected_service_carries_one_authority_to_confirm_and_launch(self):
        prepared(self.root)
        with patch.object(authority, "operator", wraps=authority.operator) as selected, \
                patch.object(runs, "require_confirmed", wraps=runs.require_confirmed) as confirm, \
                patch.object(runs, "launch", wraps=runs.launch) as launch, \
                patch.object(runs, "launch_locked", return_value={"state": "starting"}):
            self.assertEqual(cli._dispatch(self.operator_args("start"), []), ({"state": "starting"}, 0))
        selected.assert_called_once_with(self.root, WEB)
        self.assertIs(confirm.call_args.kwargs["scope"], launch.call_args.kwargs["scope"])
        self.assertEqual(confirm.call_args.kwargs["scope"].binding.web_name, WEB)

    def test_cli_root_replacement_cannot_move_original_lock_away_from_unresolved_custody(self):
        old, _ = prepared(self.root, "old-owner")
        prepared(self.root)
        state.write_new(old / "out/armed.json", b"{}")
        state.append(old / "lifecycle.jsonl", "launch_requested", "old-owner", mode="run", container="old-runner",
                     credentials_path="/fake-never-read")
        state.append(self.root / "account.jsonl", "reserved", "old-owner")
        retained_account = (self.root / "account.jsonl").read_bytes()
        # Real custody folding refuses even without a currently discoverable container.
        with patch.object(runs, "_credentials"), patch.object(runs, "_runner", return_value=None):
            self.refused(lambda: cli._dispatch(self.operator_args("start"), []), "LIVE_ACCOUNT_OWNED")
        retained_files = {path.relative_to(self.root): path.read_bytes()
                          for path in self.root.rglob("*") if path.is_file() and path.name != "account.lock"}
        previous = self.work / "original-custody"
        original_root, original_lock = self.root.stat(), (self.root / "account.lock").stat()
        confirm = runs.require_confirmed
        def changed(*args, **kwargs):
            confirm(*args, **kwargs)
            self.root.rename(previous)
            self.root.mkdir(mode=0o700)
            (previous / "account.lock").rename(self.root / "account.lock")
            prepared(self.root)
        # Use the actual CLI -> confirmation -> launch -> locked admission path. Only
        # forbidden external effects are replaced; the filesystem, custody and locks are real.
        with patch.object(runs, "require_confirmed", side_effect=changed), \
                patch.object(runs, "_credentials", side_effect=AssertionError("key read")) as keys, \
                patch.object(runs, "_network", side_effect=AssertionError("network effect")) as network, \
                patch.object(host_runtime, "docker", side_effect=AssertionError("Docker effect")) as docker, \
                patch.object(runs.key, "require_limits", side_effect=AssertionError("venue connection")) as venue:
            self.refused(lambda: cli._dispatch(self.operator_args("start"), []))
        for effect in (keys, network, docker, venue):
            effect.assert_not_called()
        current_root, current_lock = self.root.stat(), (self.root / "account.lock").stat()
        self.assertNotEqual((original_root.st_dev, original_root.st_ino), (current_root.st_dev, current_root.st_ino))
        self.assertEqual((original_lock.st_dev, original_lock.st_ino), (current_lock.st_dev, current_lock.st_ino))
        self.assertEqual(runs._active(previous), "old-owner")
        self.assertIsNone(runs._active(self.root))
        self.assertFalse((self.root / "account.jsonl").exists())
        self.assertEqual((previous / "account.jsonl").read_bytes(), retained_account)
        self.assertEqual(retained_files, {path.relative_to(previous): path.read_bytes()
                                         for path in previous.rglob("*") if path.is_file()})
        self.assertEqual([row["event"] for row in runs._host_events(self.root / "runs/original")], ["prepared"])
