"""Private HTTP -> fixed CLI integration with fake credentials and no venue or Docker calls."""

import copy
from contextlib import ExitStack
from datetime import datetime
import hashlib
import http.client
import json
from pathlib import Path
import socket
import tempfile
import threading
import unittest
from unittest.mock import patch

from engine.live_errors import LiveRefusal
from live import host as host_runtime
from live import authority, configuration, control, runs, serve, state
from tests.live.authority_fixture import install, inject_cli


class UnixClient(http.client.HTTPConnection):
    def __init__(self, path):
        super().__init__("live-control", timeout=20)
        self.path = path

    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(20)
        self.sock.connect(str(self.path))


class LiveWebControlTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="lw-", dir="/tmp")
        self.addCleanup(temporary.cleanup)
        self.directory = Path(temporary.name).resolve()
        self.root = self.directory / "custody"
        self.source = self.directory / "source.py"
        self.source.write_text("class Example: pass\n")
        self.universe = self.directory / "universe.json"
        self.universe.write_text("{}")
        self.config_file = self.directory / "control.json"
        self.raw = {"format": "live-control-v1", "root": str(self.root),
                    "socket": str(self.directory / "socket" / "live.sock"),
                    "research_ledger": str(self.directory / "unused-reader.json"), "research_at": "a" * 32,
                    "runtime": "ghcr.io/qoeop/trade-runtime@sha256:" + "b" * 64,
                    "universe_file": str(self.universe), "symbols": ["BTCUSDT"], "memory": "2g",
                    "defaults": {"budget_usdt": "90", "max_notional_per_order": "90", "max_loss_usdt": "2",
                                 "duration_seconds": 8100},
                    "sources": [{"source_id": "example", "candidate": "example@1",
                                 "strategy_file": str(self.source), "entry_class": "Example",
                                 "source_sha256": hashlib.sha256(self.source.read_bytes()).hexdigest(),
                                 "purpose": "controlled", "single_order_source_reviewed": True}]}
        self.authority = install(self, self.root, self.raw, release_state=self.directory / "i")
        self.config_file, self.config, self.raw = self.authority.file, self.authority.config, self.authority.raw
        self.binding = self.authority.binding
        inject_cli(self, self.authority.state)
        listener = serve.listener(self.config, self.config_file, binding=self.binding)
        self.server = listener.__enter__()
        self.addCleanup(listener.__exit__, None, None, None)
        thread = threading.Thread(target=self.server.serve_forever, kwargs={"poll_interval": .01}, daemon=True)
        thread.start()
        self.addCleanup(self.server.shutdown)

    def execute(self, *args, **kwargs):
        return control.execute(self.config, *args, binding=self.binding, **kwargs)

    def call(self, method, path, body=None):
        connection = UnixClient(self.config.socket)
        self.addCleanup(connection.close)
        payload = state.encode(body) if isinstance(body, dict) else body
        connection.request(method, path, body=payload, headers={"Host": "live-control"})
        response = connection.getresponse()
        value = json.loads(response.read())
        self.assertEqual(response.getheader("Cache-Control"), "no-store")
        return response.status, value

    def test_first_get_does_not_create_custody_and_socket_is_private(self):
        status, body = self.call("GET", "/api/live")
        self.assertEqual(status, 200)
        self.assertEqual(body["data"]["credentials"], [])
        self.assertEqual(list(self.root.iterdir()), [self.root / "account.lock"])
        self.assertEqual(self.config.socket.stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.config.socket.parent.stat().st_mode & 0o777, 0o700)

    def test_fake_credential_lifecycle_reaches_real_cli_without_secret_response_or_replay(self):
        upload = {"request_id": "save-request-one", "api_key": "fake-key-sentinel", "api_secret": "fake-secret-sentinel"}
        status, body = self.call("POST", "/api/live/credentials", upload)
        self.assertEqual(status, 200, body)
        self.assertEqual(body["data"]["request"]["outcome"], "effect_recorded")
        ref = body["data"]["credential_ref"]
        credential = self.root / "credentials" / (ref + ".json")
        self.assertEqual(json.loads(credential.read_bytes())["api_key"], upload["api_key"])
        self.assertEqual(credential.stat().st_mode & 0o777, 0o600)
        for secret in (upload["api_key"], upload["api_secret"]):
            self.assertNotIn(secret, json.dumps(body))
            self.assertNotIn(secret, (self.root / "requests" / "save-request-one.jsonl").read_text())
        status, removed = self.call("POST", f"/api/live/credentials/{ref}/remove", {"request_id": "remove-request-one"})
        self.assertEqual(status, 200, removed)
        self.assertFalse(credential.exists())
        before = {str(path): path.read_bytes() for path in self.root.rglob("*") if path.is_file()}
        status, replay = self.call("POST", "/api/live/credentials", {**upload, "api_key": "changed", "api_secret": "changed"})
        self.assertEqual(status, 200, replay)
        self.assertFalse(credential.exists())
        self.assertEqual(before, {str(path): path.read_bytes() for path in self.root.rglob("*") if path.is_file()})
        _, listing = self.call("GET", "/api/live/credentials")
        item = listing["data"]["credentials"][0]
        self.assertTrue(item["removed"])
        self.assertFalse(item["selected"])
        self.assertFalse(item["available"])

    def test_unknown_and_duplicate_fields_are_rejected_before_any_control_effect(self):
        with patch.object(serve, "command", side_effect=AssertionError("malformed body dispatched")):
            status, body = self.call("POST", "/api/live/credentials", b'{"request_id":"request-a","request_id":"request-b"}')
        self.assertEqual(status, 400)
        self.assertEqual(list(self.root.iterdir()), [self.root / "account.lock"])
        status, body = self.call("POST", "/api/live/credentials", {
            "request_id": "save-extra-field", "api_key": "fake", "api_secret": "fake", "credentials_file": "/private"})
        self.assertEqual(status, 400, body)
        self.assertEqual(list(self.root.iterdir()), [self.root / "account.lock"])
        self.assertNotIn("/private", json.dumps(body))

    def test_missing_confirmation_is_not_filled_in_by_control(self):
        with patch.object(control.requests, "dispatch", side_effect=AssertionError("missing confirmation dispatched")):
            status, body = self.execute( "start", "example", {"request_id": "start-request-one"})
        self.assertEqual(status, 400)
        self.assertEqual(list(self.root.iterdir()), [self.root / "account.lock"])
        self.assertEqual(body["error"]["code"], "LIVE_CONFIG")

    def test_explicit_resolve_closes_an_unaccepted_id_before_a_late_valid_post(self):
        request_id = "invalid-upload-one"
        status, _ = self.call("POST", "/api/live/credentials", {
            "request_id": request_id, "api_key": "fake", "api_secret": "fake", "unexpected": True})
        self.assertEqual(status, 400)
        status, missing = self.call("GET", f"/api/live/requests/{request_id}")
        self.assertEqual(status, 404, missing)  # Installed custody exists; GET does not create a request.
        self.assertEqual(list(self.root.iterdir()), [self.root / "account.lock"])
        status, resolved = self.call("POST", f"/api/live/requests/{request_id}/resolve", {"request_id": request_id})
        self.assertEqual(status, 200, resolved)
        view = resolved["data"]["request"]
        self.assertEqual((view["action"], view["target"], view["outcome"], view["code"]),
                         ("unknown", {}, "refused", "LIVE_REQUEST_CLOSED_UNCLAIMED"))
        before = {str(path): path.read_bytes() for path in self.root.rglob("*") if path.is_file()}
        status, duplicate = self.call("POST", "/api/live/credentials", {
            "request_id": request_id, "api_key": "fake-late-key", "api_secret": "fake-late-secret"})
        self.assertEqual(status, 200, duplicate)
        self.assertEqual(duplicate["data"]["request"], view)
        self.assertFalse((self.root / "credentials").exists())
        self.assertEqual(before, {str(path): path.read_bytes() for path in self.root.rglob("*") if path.is_file()})

    def test_prepare_preflight_start_reuse_original_inputs_through_operator_control(self):
        """Use real custody/protocol functions; only research, image and venue/host IO are fake."""
        _, saved = self.execute( "credential_save", None, {
            "request_id": "save-lifecycle-one", "api_key": "fake-key", "api_secret": "fake-secret"})
        ref = saved["data"]["credential_ref"]
        source_hash = self.raw["sources"][0]["source_sha256"]
        origin = {"strategy_id": "example", "revision": 1, "entry_class": "Example",
                  "source": self.source.read_bytes(), "source_sha256": source_hash,
                  "runtime_contract": "replay-contract@v7"}
        identity = {"image_ref": self.config.runtime, "image_digest": "sha256:" + "b" * 64,
                    "platform": "linux/amd64", "runtime_contract": "replay-contract@v7"}
        body = {"request_id": "prepare-lifecycle-one", "run_id": "lifecycle", "source_id": "example",
                "credential_ref": ref, "config": self.config.defaults}
        with ExitStack() as stack:
            stack.enter_context(patch.object(control, "_profile", return_value=object()))
            stack.enter_context(patch.object(runs.db, "read_as_of"))
            stack.enter_context(patch.object(runs.strategies, "read_candidate", return_value=origin))
            stack.enter_context(patch("registration.validation.candidate_registrations", return_value=[]))
            stack.enter_context(patch("engine.load.load_strategy"))
            stack.enter_context(patch("engine.load.read_universe"))
            stack.enter_context(patch.object(runs.image, "resolve", return_value=identity))
            stack.enter_context(patch.object(runs.image, "inspect_runtime", return_value={}))
            stack.enter_context(patch.object(runs.image, "require_main_build"))
            stack.enter_context(patch.object(runs, "_network", return_value={"network": "fake-network"}))
            runner = stack.enter_context(patch.object(runs, "_runner", return_value={
                "Id": "c" * 64, "State": {"Running": True, "Status": "running"}}))
            stack.enter_context(patch.object(host_runtime, "container_identity", return_value={"Id": "c" * 64}))
            stack.enter_context(patch.object(runs, "_recycle_others"))
            docker = stack.enter_context(patch.object(host_runtime, "checked", return_value="c" * 64))
            limits = stack.enter_context(patch.object(runs.key, "require_limits", return_value=[]))
            status, prepared = self.execute( "prepare", None, body)
            self.assertEqual(status, 200, prepared)
            self.assertEqual(prepared["data"]["request"]["outcome"], "effect_recorded")
            directory = state.directory(self.root, "lifecycle")
            manifest = (directory / "inputs" / "manifest.json").read_bytes()
            # Today's catalog file cannot replace the already frozen source for preflight.
            self.source.write_text("class Changed: pass\n")
            status, preflight = self.execute( "preflight", "lifecycle", {
                "request_id": "preflight-lifecycle-one"})
            self.assertEqual(status, 202, preflight)
            self.assertEqual(preflight["data"]["request"]["outcome"], "effect_recorded")
            runner.return_value = {"Id": "c" * 64, "State": {"Running": False, "Status": "exited", "ExitCode": 0}}
            status, wrong = self.execute( "start", "lifecycle", {
                "request_id": "start-wrong-source", "confirm_real_orders": "d" * 64})
            self.assertEqual(status, 400, wrong)
            self.assertEqual(wrong["error"]["code"], "LIVE_IDENTITY_CHANGED")
            status, started = self.execute( "start", "lifecycle", {
                "request_id": "start-lifecycle-one", "confirm_real_orders": source_hash})
            self.assertEqual(status, 202, started)
            self.assertEqual(started["data"]["request"]["outcome"], "effect_recorded")
            duplicate_status, duplicate = self.execute( "start", "lifecycle", {
                "request_id": "start-lifecycle-one", "confirm_real_orders": source_hash})
            self.assertEqual(duplicate_status, 202, duplicate)
            self.assertEqual(docker.call_count, 2)
            self.assertEqual(limits.call_count, 2)
            self.assertEqual((directory / "inputs" / "manifest.json").read_bytes(), manifest)
            launches = [row for row in runs._host_events(directory) if row["event"] == "launch_requested"]
            self.assertEqual([row["mode"] for row in launches], ["preflight", "run"])
            self.assertTrue(all(row["credentials_path"] == str((self.root / "credentials" / f"{ref}.json").resolve())
                                for row in launches))

    def test_private_command_uses_fixed_argv_and_stdin_only_and_discards_raw_errors(self):
        fake = {"request_id": "save-command-one", "api_key": "sentinel-key", "api_secret": "sentinel-secret"}
        completed = type("Completed", (), {"returncode": 1, "stdout": b"", "stderr": b"secret-sentinel"})()
        with patch.object(serve.subprocess, "run", return_value=completed) as run:
            status, body = serve.command(self.config_file, "credential_save", None, fake)
        args, options = run.call_args
        self.assertNotIn("sentinel", " ".join(args[0]))
        self.assertNotIn("shell", options)
        self.assertNotIn("timeout", options)
        self.assertEqual(json.loads(options["input"]), fake)
        self.assertEqual(status, 502)
        self.assertNotIn("secret-sentinel", json.dumps(body))

    def test_control_subprocess_receives_only_the_listener_release_binding(self):
        binding = self.binding
        response = {"status": 200, "body": {"ok": True, "data": {}}}
        completed = type("Completed", (), {"returncode": 0, "stdout": state.encode(response), "stderr": b""})()
        with patch.object(serve.subprocess, "run", return_value=completed) as run:
            status, _ = serve.command(self.config_file, "maintain", "example", {"request_id": "maintain-bound-one"},
                                      binding=binding)
        self.assertEqual(status, 200)
        argv = run.call_args.args[0]
        self.assertEqual(argv[argv.index("--release-state") + 1], str(binding.state))
        self.assertEqual(argv[argv.index("--release-web") + 1], binding.web_name)

    def test_standby_maintenance_never_enters_existing_host_cleanup(self):
        with state.serialized(self.root):
            state.private_directory(self.root / "runs" / "retained")
        binding = self.binding
        with patch.object(serve.release, "admission_locked", side_effect=LiveRefusal("LIVE_RELEASE_UNAVAILABLE", "standby")) as admit, \
                patch.object(serve.runs, "_status_view", side_effect=AssertionError("standby reached host maintenance")):
            serve.maintain_existing(self.config, binding=binding)
        admit.assert_called_once_with(binding, maintenance=True)

    def test_root_configuration_never_accepts_browser_supplied_runtime_or_paths(self):
        for name, value in (("runtime", "image:latest"), ("root", "relative")):
            invalid = {**self.raw, name: value}
            self.config_file.write_bytes(state.encode(invalid))
            with self.assertRaises(ValueError):
                configuration.load(self.config_file)
        duplicate = copy.deepcopy(self.raw)
        duplicate["sources"].append(duplicate["sources"][0])
        self.config_file.write_bytes(state.encode(duplicate))
        with self.assertRaises(ValueError):
            configuration.load(self.config_file)

    def test_maintenance_inspects_existing_runs_without_relaunch_or_credentials(self):
        with state.serialized(self.root):
            state.private_directory(self.root / "runs" / "retained")
        with patch.object(serve.runs, "_status_view", return_value={"state": "running"}) as status, \
                patch.object(serve.runs, "launch", side_effect=AssertionError("maintenance relaunched")), \
                patch.object(serve.runs, "_credentials", side_effect=AssertionError("maintenance read credentials")):
            serve.maintain_existing(self.config, binding=self.binding)
        status.assert_called_once_with(self.root.resolve(), "retained", maintain=False)
        with patch.object(serve.runs, "_status_view", return_value={"state": "clean_stopped"}) as status:
            serve.maintain_existing(self.config, binding=self.binding)
        self.assertEqual([call.kwargs for call in status.call_args_list], [{"maintain": False}, {"maintain": True}])

    def test_second_listener_cannot_replace_the_existing_socket(self):
        inode = self.config.socket.stat().st_ino
        with self.assertRaises(OSError):
            with serve.listener(self.config, self.config_file):
                self.fail("second listener accepted")
        self.assertEqual(self.config.socket.stat().st_ino, inode)

    def test_review_registration_datetimes_survive_direct_http_read(self):
        original = {"research_at": "a" * 32, "origin_candidate_validations": [
            {"registration_id": 1, "window_start": datetime(2026, 1, 1),
             "window_end": datetime(2026, 2, 1), "status": "unbound"}]}
        claim = {"command": {"inputs": {"research_at": "a" * 32}}}
        with patch.object(control, "_prepare_claim", return_value=claim), \
                patch.object(control.runs, "_manifest", return_value=(self.root, {})), \
                patch.object(control, "_profile", return_value=object()), \
                patch.object(control.runs, "review", return_value=original):
            review = control._review(self.config, self.root, "example")
        with patch.object(serve, "read", return_value={"review": review}):
            status, body = self.call("GET", "/api/live/runs/example")
        self.assertEqual(status, 200)
        row = body["data"]["review"]["origin_candidate_validations"][0]
        self.assertEqual(row["window_start"], "2026-01-01T00:00:00")
        self.assertEqual(row["window_end"], "2026-02-01T00:00:00")

    def test_source_catalog_never_implies_the_existing_operator_review_declaration(self):
        for value in (None, "true", 1):
            raw = copy.deepcopy(self.raw)
            if value is None:
                del raw["sources"][0]["single_order_source_reviewed"]
            else:
                raw["sources"][0]["single_order_source_reviewed"] = value
            self.config_file.write_bytes(state.encode(raw))
            with self.assertRaises(ValueError):
                configuration.load(self.config_file)
        raw = copy.deepcopy(self.raw)
        raw["sources"][0]["single_order_source_reviewed"] = False
        self.config_file.write_bytes(state.encode(raw))
        config = configuration.load(self.config_file)
        body = {"request_id": "prepare-unreviewed", "run_id": "unreviewed", "source_id": "example",
                "credential_ref": "a" * 32, "config": config.defaults}
        command = control._fixed_prepare(config, body, authority.retained(config, self.binding))
        self.assertIs(command["inputs"]["config"]["single_order_source_reviewed"], False)
        with patch.object(control.credentials, "prepare_path_locked", return_value=self.directory / "fake.json"), \
                patch.object(control, "_profile", return_value=object()), \
                patch.object(control.runs, "prepare_locked", return_value={}) as prepare:
            control._prepare(config, self.root, "unreviewed", "a" * 32, command["inputs"], "prepare-unreviewed")
        self.assertIs(prepare.call_args.kwargs["single_order_source_reviewed"], False)
