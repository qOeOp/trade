"""Private Live custody survives unknown launches and never mistakes process exit for flatness."""

import copy
from decimal import Decimal
from datetime import datetime
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
import unittest.mock
from unittest.mock import patch

from cli import main as cli
from engine.live_errors import LiveRefusal
from shared.errors import Refusal
from ledger import db
from live import host as host_runtime
from live import authority, configuration, runs, state
from tests.live.authority_fixture import install, launch, prepare


MARKET_TERMS = runs._market_terms  # LiveFixture replaces it; test_market_terms_* reads it
MARKET = {"market_day": "2026-11-09", "terms": {"BTCUSDT": {"price_increment": "0.10", "size_increment": "0.001", "min_notional": "50"}}}
EVIDENCE = [{"trial_id": 7, "starting_balance_usdt": "100", "image_ref": "ghcr.io/qoeop/trade-runtime@sha256:" + "c" * 64}]
IDENTITY = {"image_ref": "ghcr.io/qoeop/trade-runtime@sha256:" + "a" * 64, "image_digest": "sha256:" + "a" * 64,
            "platform": "linux/amd64", "runtime_contract": "replay-contract@v8"}


class LiveFixture(unittest.TestCase):
    PATCH_EVIDENCE = True  # tests/live/test_replay_evidence.py reads the ledger instead

    def setUp(self):
        if self.PATCH_EVIDENCE:
            evidence = patch.object(runs, "_evidence", return_value=EVIDENCE)
            evidence.start()
            self.addCleanup(evidence.stop)
        patcher = patch.object(runs.key, "require_limits", return_value=[])  # tests/live/test_key.py covers the read.
        self.key_limits = patcher.start()
        self.addCleanup(patcher.stop)
        market = patch.object(runs, "_market_terms", return_value=MARKET)  # test_market_terms_* covers the read
        market.start()
        self.addCleanup(market.stop)
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.authority = install(self, self.root)
        self.scope = authority.from_file(self.authority.file, self.authority.binding)
        self.credentials = self.root / "credentials.json"
        state.write_new(self.credentials, b'{"api_key":"example-key","api_secret":"example-secret"}')
        self.run_id = "probe-one"
        self.directory = state.directory(self.root, self.run_id)
        for part in (self.directory, self.directory / "inputs", self.directory / "out", self.directory / "egress"):
            state.private_directory(part)
        self.manifest = {
            "format": runs.MANIFEST_FORMAT, "run_id": self.run_id, "runtime": IDENTITY, "symbols": ["BTCUSDT"],
            "candidate": {"strategy_id": "example", "revision": 1},
            "source": {"entry_class": "Example", "source_sha256": hashlib.sha256(b"source").hexdigest()},
            "universe_sha256": hashlib.sha256(b"{}").hexdigest(),
            "config": {"memory": "2g", "duration_seconds": 60}, "credential_binding": hashlib.sha256(b"example-key").hexdigest(),
            "evidence": EVIDENCE,
        }
        state.write_new(self.directory / "inputs" / "strategy.py", b"source")
        state.write_new(self.directory / "inputs" / "universe.json", b"{}")
        state.write_new(self.directory / "inputs" / "manifest.json", state.encode(self.manifest))

    def launch_record(self, mode="run"):
        state.append(self.root / "account.jsonl", "reserved", self.run_id)
        state.append(self.directory / "lifecycle.jsonl", "launch_requested", self.run_id,
                     mode=mode, container="runner", credentials_path=str(self.credentials))
        state.append(self.directory / "lifecycle.jsonl", "container_started", self.run_id,
                     mode=mode, container="runner", container_id="c" * 64)

    def inspected(self, role="runner", *, running=True, mode="run"):
        names = host_runtime.resource_names(self.root, self.run_id)
        network = {"Id": "d" * 64, "Name": names["network"], "Driver": "bridge", "Internal": True,
                   "Labels": {"trade.live.run": self.run_id}}
        bridge = {"Id": "e" * 64, "Name": "bridge", "Driver": "bridge", "Internal": False, "Labels": {}}
        name = "runner" if role == "runner" else names["egress"]
        mounts = [{"Type": "bind", "Source": str(self.directory / "out"), "Destination": "/reports", "RW": True},
                  {"Type": "bind", "Source": str(self.directory / "inputs"), "Destination": "/inputs", "RW": False},
                  {"Type": "bind", "Source": str(self.credentials),
                   "Destination": "/run/secrets/binance.json", "RW": False}]
        networks = {names["network"]: {"NetworkID": network["Id"]}}
        command = ["-m", "engine.live", *host_runtime.runner_args(mode)]
        memory = 2 * 1024 ** 3
        if role == "egress":
            mounts = [{"Type": "bind", "Source": str(self.directory / "egress"),
                       "Destination": "/reports", "RW": True}]
            networks["bridge"] = {"NetworkID": bridge["Id"]}
            command = ["-m", "engine.egress", "--port", "3128", "--log", "/reports/egress.log"]
            memory = 256 * 1024 ** 2
        image = {"Id": "sha256:" + "b" * 64, "RepoDigests": [IDENTITY["image_ref"]],
                 "Os": "linux", "Architecture": "amd64", "Config": {"Env": ["PATH=/usr/bin"]}}
        actual = {"Id": "c" * 64, "Name": "/" + name, "Image": image["Id"],
                  "Config": {"Image": IDENTITY["image_ref"], "Entrypoint": ["python"], "Cmd": command,
                             "Env": ["PATH=/usr/bin", "PYTHONDONTWRITEBYTECODE=1"],
                             "Labels": {"trade.live.run": self.run_id, "trade.live.role": role},
                             "User": f"{os.geteuid()}:{os.getegid()}"},
                  "HostConfig": {"NetworkMode": names["network"], "Privileged": False, "ReadonlyRootfs": True,
                                 "CapDrop": ["ALL"], "SecurityOpt": ["no-new-privileges"], "Memory": memory,
                                 "MemorySwap": memory, "PidsLimit": 256,
                                 "Tmpfs": {"/tmp": "rw,nosuid,noexec,size=1073741824"}},
                  "Mounts": mounts, "NetworkSettings": {"Networks": networks},
                  "State": {"Running": running, "ExitCode": 0}}
        return {("container", name): actual, ("image", IDENTITY["image_ref"]): image,
                ("network", names["network"]): network, ("network", "bridge"): bridge}

    @staticmethod
    def docker_view(resources, calls):
        def call(*argv, **kwargs):
            calls.append(argv)
            if len(argv) == 3 and argv[1] == "inspect":
                found = resources.get((argv[0], argv[2]))
                if found is None:
                    return subprocess.CompletedProcess(argv, 1, "", "Error: No such object: " + argv[2])
                return subprocess.CompletedProcess(argv, 0, json.dumps([found]), "")
            if argv[0] == "logs":
                return subprocess.CompletedProcess(argv, 0, "retained log\n", "")
            raise AssertionError(f"unexpected Docker operation {argv}")
        return call


class LiveCustodyTests(LiveFixture):
    def setUp(self):
        super().setUp()
        for name in ("_recycle", "_recycle_others"):  # LiveRecycleTests covers these against a fake host.
            patcher = patch.object(runs, name)
            patcher.start()
            self.addCleanup(patcher.stop)

    def retained_format_launch(self, retained, mode):
        manifest = {**self.manifest, "format": retained}
        (self.directory / "inputs" / "manifest.json").write_bytes(state.encode(manifest))
        return launch(self.root, self.run_id, self.credentials, mode, scope=self.scope)

    def test_a_run_prepared_before_the_current_format_is_refused(self):
        for mode in ("run", "preflight", "reconcile"):
            with self.subTest(mode=mode), patch.object(runs, "_network") as network:
                with self.assertRaises(LiveRefusal) as caught:
                    self.retained_format_launch("live-run-v7", mode)
                self.assertEqual(caught.exception.code, "LIVE_RUN_FORMAT")
                network.assert_not_called()
        self.assertFalse((self.root / "account.jsonl").exists())

    def test_market_terms_are_read_at_the_latest_market_day_and_an_unreadable_market_is_refused(self):
        with self.assertRaises(LiveRefusal) as caught:
            MARKET_TERMS(self.root / "no-market", ["BTCUSDT"])
        self.assertEqual(caught.exception.code, "LIVE_MARKET_TERMS")
        commit = "2026-11-09"
        with patch("market.files.resolve_day", return_value=commit) as resolved, \
                patch("market.instrument.terms", side_effect=lambda market, at, symbol: {"at": at, "symbol": symbol}):
            found = MARKET_TERMS(self.root, ["BTCUSDT"])
        self.assertIsNone(resolved.call_args.args[1])
        self.assertEqual(found, {"market_day": commit, "terms": {"BTCUSDT": {"at": commit, "symbol": "BTCUSDT"}}})

    def test_the_control_and_prepare_take_binances_leverage_range_from_engine_config(self):
        for leverage in ("0", "126", "03", "2.5", 3, None):
            with self.subTest(leverage=leverage):
                with self.assertRaises(LiveRefusal) as caught:
                    configuration.run_config({"drawdown_brake": "0.15", "duration_seconds": 8100,
                                              "leverage": leverage})
                self.assertEqual(caught.exception.code, "LIVE_CONFIG")
                with self.assertRaises(LiveRefusal) as caught:
                    prepare(self.root, "leverage-run", object(), "a" * 32, "original@2", ["BTCUSDT"],
                                 Path("unused"), self.credentials, None, scope=self.scope, drawdown_brake="0.15", duration_seconds=60, memory="2g", leverage=leverage,
                                 market_root=Path("unused"))
                self.assertEqual(caught.exception.code, "LIVE_CONFIG")
        for leverage in ("1", "125"):
            self.assertEqual(configuration.run_config({"drawdown_brake": "0.15",
                                                       "duration_seconds": 8100, "leverage": leverage})["leverage"],
                             leverage)

    def test_prepare_and_the_control_take_only_a_brake_at_most_the_drawdown_target(self):
        from engine import live_brake
        self.assertEqual(Decimal(configuration.BRAKE_DEFAULT), live_brake.BRAKE_MAX)
        self.assertEqual(configuration.run_config({"drawdown_brake": "0.05", "duration_seconds": None,
                                                   "leverage": "3"})["drawdown_brake"], "0.05")
        for limit in ("0", "NaN", "0.1501"):
            with self.subTest(limit), self.assertRaises(LiveRefusal) as caught:
                configuration.run_config({"drawdown_brake": limit, "duration_seconds": None, "leverage": "3"})
            self.assertEqual(caught.exception.code, "LIVE_CONFIG")
        for limit in ("0", "NaN", "0.1501"):
            with self.subTest(limit), self.assertRaises(LiveRefusal) as caught:
                prepare(self.root, "limit-run", object(), "a" * 32, "original@2", ["BTCUSDT"], Path("unused"),
                             self.credentials, None, scope=self.scope, drawdown_brake=limit, duration_seconds=60, memory="2g", leverage="3",
                         market_root=Path("unused"))
            self.assertEqual(caught.exception.code, "LIVE_CONFIG")

    def test_a_key_that_is_refused_takes_no_slot_and_a_reconcile_does_not_ask(self):
        self.key_limits.side_effect = LiveRefusal("LIVE_KEY_WITHDRAWAL", "withdrawals on")
        with patch.object(runs, "_network") as network, self.assertRaises(LiveRefusal) as caught:
            launch(self.root, self.run_id, self.credentials, "run", scope=self.scope)
        self.assertEqual(caught.exception.code, "LIVE_KEY_WITHDRAWAL")
        network.assert_not_called()
        self.assertFalse((self.root / "account.jsonl").exists())
        self.key_limits.assert_called_once_with(self.credentials)  # a timed run's key is checked the same way
        self.key_limits.reset_mock()
        with self.assertRaises(LiveRefusal) as caught:
            launch(self.root, self.run_id, self.credentials, "reconcile", scope=self.scope)
        self.assertEqual(caught.exception.code, "LIVE_RUN_MISSING")
        (self.directory / "out" / "armed.json").write_text("{}")
        with patch.object(runs, "_network", side_effect=RuntimeError("past the key check")), self.assertRaises(RuntimeError):
            launch(self.root, self.run_id, self.credentials, "reconcile", scope=self.scope)
        self.key_limits.assert_not_called()

    def test_status_says_why_the_run_began_to_stop_and_a_damaged_journal_does_not_hide_the_state(self):
        self.launch_record()
        journal = self.directory / "out" / "events.jsonl"
        with patch.object(runs, "_outcome", return_value=("unresolved", 137)):
            self.assertIsNone(runs.status(self.root, self.run_id)["stop_reason"])
            state.append(journal, "stopping", self.run_id, reason="max_loss")
            state.append(journal, "stopping", self.run_id, reason="requested")  # A later reconcile's own stop.
            self.assertEqual(runs.status(self.root, self.run_id)["stop_reason"], "max_loss")
            with journal.open("ab") as stream:
                stream.write(b'{"event":"par')
            result = runs.status(self.root, self.run_id)
        self.assertEqual((result["state"], result["exit_code"], result["stop_reason"]), ("unresolved", 137, None))

    def test_preflight_again_on_a_run_of_an_earlier_format_names_the_format(self):
        (self.directory / "inputs" / "manifest.json").write_bytes(
            state.encode({**self.manifest, "format": "live-run-v7"}))
        universe = self.root / "universe.json"
        universe.write_text("{}")
        with self.assertRaises(LiveRefusal) as caught:
            prepare(self.root, self.run_id, object(), "a" * 32, "original@2", ["BTCUSDT"], universe,
                         self.credentials, None, scope=self.scope, drawdown_brake="0.15",
                         duration_seconds=60, memory="2g", leverage="3",
                         market_root=Path("unused"))
        self.assertEqual(caught.exception.code, "LIVE_RUN_FORMAT")

    def test_failed_launch_retains_account_custody_and_inputs(self):
        with patch.object(runs, "_network", return_value={"network": "network"}), \
                patch.object(host_runtime, "checked", side_effect=RuntimeError("unknown launch")):
            with self.assertRaises(RuntimeError):
                launch(self.root, self.run_id, self.credentials, "run", scope=self.scope)
        self.assertEqual(runs._active(self.root), self.run_id)
        self.assertEqual(runs._host_events(self.directory)[-1]["event"], "launch_unresolved")
        self.assertTrue((self.directory / "inputs" / "manifest.json").exists())

    def test_exited_container_is_unresolved_until_fresh_native_flat_receipt(self):
        self.launch_record()
        with patch.object(runs, "_runner", return_value={"State": {"Running": False, "ExitCode": 0}}):
            self.assertEqual(runs.status(self.root, self.run_id)["state"], "unresolved")
            self.assertEqual(runs._active(self.root), self.run_id)
            state.append(self.directory / "out" / "events.jsonl", "clean_stop", self.run_id)
            self.assertEqual(runs.status(self.root, self.run_id)["state"], "clean_stopped")
            self.assertIsNone(runs._active(self.root))

    def test_old_flat_receipt_cannot_release_new_reconciliation(self):
        state.append(self.directory / "out" / "events.jsonl", "clean_stop", self.run_id)
        self.launch_record("reconcile")
        with patch.object(runs, "_runner", return_value={"State": {"Running": False, "ExitCode": 0}}):
            self.assertEqual(runs.status(self.root, self.run_id)["state"], "unresolved")
            self.assertEqual(runs._active(self.root), self.run_id)

    def test_failed_final_flush_cannot_release_even_with_visible_terminal_line(self):
        self.launch_record()
        state.append(self.directory / "out" / "events.jsonl", "clean_stop", self.run_id)
        with patch.object(runs, "_runner", return_value={"State": {"Running": False, "ExitCode": 1}}):
            self.assertEqual(runs.status(self.root, self.run_id)["state"], "unresolved")
            self.assertEqual(runs._active(self.root), self.run_id)

    def test_reconcile_stop_alone_does_not_release_but_native_reconciled_flat_does(self):
        self.launch_record("reconcile")
        state.append(self.directory / "out" / "events.jsonl", "reconcile_stopped", self.run_id)
        with patch.object(runs, "_runner", return_value={"State": {"Running": False, "ExitCode": 0}}):
            self.assertEqual(runs.status(self.root, self.run_id)["state"], "unresolved")
            self.assertEqual(runs._active(self.root), self.run_id)
            state.append(self.directory / "out" / "events.jsonl", "reconciled_flat", self.run_id)
            self.assertEqual(runs.status(self.root, self.run_id)["state"], "reconciled_flat")
            self.assertIsNone(runs._active(self.root))

    def test_a_venue_flat_reconcile_releases_as_its_own_state_and_unresolved_points_to_the_steps(self):
        self.launch_record("reconcile")
        with patch.object(runs, "_runner", return_value={"State": {"Running": False, "ExitCode": 0}}):
            found = runs.status(self.root, self.run_id)
            self.assertEqual((found["state"], found["note"]), ("unresolved", runs.UNRESOLVED_NOTE))
            state.append(self.directory / "out" / "events.jsonl", "venue_flat", self.run_id)
            found = runs.status(self.root, self.run_id)
        self.assertEqual((found["state"], found["exit_code"], found["account_owned"]), ("venue_flat", 0, False))
        self.assertNotIn("note", found)
        self.assertEqual(state.events(self.root / "account.jsonl")[-1]["reason"], "venue_flat")
        self.assertEqual(runs._settled(self.root, self.run_id, runs._latest_launch(self.directory)), "venue_flat")

    def test_venue_flat_from_a_failed_or_earlier_runner_keeps_the_slot(self):
        state.append(self.directory / "out" / "events.jsonl", "venue_flat", self.run_id)  # Before this launch.
        self.launch_record("reconcile")
        with patch.object(runs, "_runner", return_value={"State": {"Running": False, "ExitCode": 0}}):
            self.assertEqual(runs.status(self.root, self.run_id)["state"], "unresolved")
        state.append(self.directory / "out" / "events.jsonl", "venue_flat", self.run_id)
        with patch.object(runs, "_runner", return_value={"State": {"Running": False, "ExitCode": 2}}):
            self.assertEqual(runs.status(self.root, self.run_id)["state"], "unresolved")
        self.assertEqual(runs._active(self.root), self.run_id)

    EXITED = {"State": {"Running": False, "Status": "exited", "ExitCode": 2}}

    def released(self):
        return [row["reason"] for row in state.events(self.root / "account.jsonl") if row["event"] == "released"]

    def test_runner_refused_before_arming_releases_the_slot_for_a_new_run(self):
        self.launch_record()
        with patch.object(runs, "_runner", return_value=self.EXITED):
            status = runs.status(self.root, self.run_id)
            self.assertEqual((status["state"], status["account_owned"]), ("not_armed", False))
            self.assertEqual(self.released(), ["never_armed"])
            with self.assertRaises(LiveRefusal) as caught:
                launch(self.root, self.run_id, self.credentials, "run", scope=self.scope)
            self.assertEqual(caught.exception.code, "LIVE_RESTART_REQUIRES_RECONCILIATION")
            with self.assertRaises(LiveRefusal) as caught:
                launch(self.root, self.run_id, self.credentials, "reconcile", scope=self.scope)
            self.assertEqual(caught.exception.code, "LIVE_RUN_MISSING")
        self.assertIsNone(runs._active(self.root))

    def second_run(self):
        other = state.directory(self.root, "probe-two")
        for part in (other, other / "inputs", other / "out"):
            state.private_directory(part)
        for name in ("strategy.py", "universe.json"):
            state.write_new(other / "inputs" / name, (self.directory / "inputs" / name).read_bytes())
        state.write_new(other / "inputs" / "manifest.json", state.encode({**self.manifest, "run_id": "probe-two"}))
        return other

    def test_a_new_run_releases_a_slot_left_by_an_unarmed_run(self):
        self.launch_record()
        self.second_run()
        with patch.object(runs, "_runner", return_value=self.EXITED), \
                patch.object(runs, "_network", return_value={"network": "network"}), \
                patch.object(host_runtime, "container_identity", return_value={"Id": "c" * 64}), \
                patch.object(host_runtime, "checked", return_value="c" * 64):
            self.assertEqual(launch(self.root, "probe-two", self.credentials, "run", scope=self.scope)["state"], "starting")
        self.assertEqual(runs._active(self.root), "probe-two")

    def test_slot_reserved_without_any_launch_is_released(self):
        state.append(self.root / "account.jsonl", "reserved", self.run_id)
        self.assertEqual(runs.status(self.root, self.run_id)["state"], "prepared")
        self.assertEqual(self.released(), ["never_armed"])

    def test_a_preflight_runner_alone_does_not_hold_the_slot(self):
        state.append(self.root / "account.jsonl", "reserved", self.run_id)
        state.append(self.directory / "lifecycle.jsonl", "launch_requested", self.run_id,
                     mode="preflight", container="runner", credentials_path=str(self.credentials))
        with patch.object(runs, "_runner", return_value={"State": {"Running": True, "Status": "running"}}):
            runs.status(self.root, self.run_id)
        self.assertEqual(self.released(), ["never_armed"])

    def test_any_doubt_about_arming_keeps_the_slot(self):
        for status in ("running", "created", "paused", "restarting", "dead", None):
            with self.subTest(status=status), \
                    patch.object(runs, "_runner", return_value={"State": {"Running": False, "Status": status}}):
                self.reset_slot()
                runs.status(self.root, self.run_id)
                self.assertEqual(runs._active(self.root), self.run_id)
        with self.subTest("missing container"), patch.object(runs, "_runner", return_value=None):
            self.reset_slot()
            runs.status(self.root, self.run_id)
            self.assertEqual(runs._active(self.root), self.run_id)

    def reset_slot(self, mode="run"):
        (self.root / "account.jsonl").unlink(missing_ok=True)
        (self.directory / "lifecycle.jsonl").unlink(missing_ok=True)
        self.launch_record(mode)

    def test_armed_or_connecting_keeps_the_slot_after_exit(self):
        self.launch_record()
        with patch.object(runs, "_runner", return_value=self.EXITED):
            state.append(self.directory / "out" / "events.jsonl", "connecting", self.run_id)
            self.assertEqual(runs.status(self.root, self.run_id)["state"], "unresolved")
            self.assertEqual(runs._active(self.root), self.run_id)
            (self.directory / "out" / "events.jsonl").unlink()
            state.write_new(self.directory / "out" / "armed.json", b"{}")
            # Armed, and no ending event: interrupted (killed, or SIGTERM), the run starts again as itself.
            self.assertEqual(runs.status(self.root, self.run_id)["state"], "interrupted")
            state.append(self.directory / "out" / "events.jsonl", "unresolved", self.run_id)
            self.assertEqual(runs.status(self.root, self.run_id)["state"], "unresolved")
            state.write_new(self.directory / "out" / "STOP", b"operator stop\n")
            (self.directory / "out" / "events.jsonl").unlink()
            self.assertEqual(runs.status(self.root, self.run_id)["state"], "unresolved")  # a stop was asked for
        self.assertEqual(runs._active(self.root), self.run_id)

    def test_earlier_timed_out_runner_still_alive_keeps_the_slot(self):
        self.launch_record()
        state.append(self.directory / "lifecycle.jsonl", "launch_requested", self.run_id,
                     mode="reconcile", container="later", credentials_path=str(self.credentials))
        def inspected(_root, _run, _directory, _manifest, launch):
            return self.EXITED if launch["container"] == "later" else {"State": {"Running": True, "Status": "running"}}
        with patch.object(runs, "_runner", side_effect=inspected):
            runs.status(self.root, self.run_id)
        self.assertEqual(runs._active(self.root), self.run_id)

    def test_runner_arming_while_being_inspected_keeps_the_slot(self):
        self.launch_record()
        def arm_then_exit(*_):
            state.write_new(self.directory / "out" / "armed.json", b"{}")
            return self.EXITED
        with patch.object(runs, "_runner", side_effect=arm_then_exit):
            self.assertFalse(runs._never_armed(self.root, self.run_id, self.directory, self.manifest))

    def test_reconcile_without_arming_is_refused_before_taking_the_slot(self):
        with self.assertRaises(LiveRefusal) as caught:
            launch(self.root, self.run_id, self.credentials, "reconcile", scope=self.scope)
        self.assertEqual(caught.exception.code, "LIVE_RUN_MISSING")
        self.assertIsNone(runs._active(self.root))

    def test_stop_only_writes_request_and_does_not_call_docker(self):
        self.launch_record()
        with patch.object(host_runtime, "docker", side_effect=AssertionError("stop must not kill")):
            runs.stop(self.root, self.run_id)
            runs.stop(self.root, self.run_id)
        self.assertTrue((self.directory / "out" / "STOP").exists())
        self.assertEqual(sum(row["event"] == "stop_requested" for row in runs._host_events(self.directory)), 1)

    def test_key_change_and_source_change_are_refused_before_docker(self):
        self.credentials.write_text('{"api_key":"another-key","api_secret":"another-secret"}')
        with patch.object(host_runtime, "docker", side_effect=AssertionError("no Docker")):
            with self.assertRaises(LiveRefusal) as caught:
                launch(self.root, self.run_id, self.credentials, "run", scope=self.scope)
            self.assertEqual(caught.exception.code, "LIVE_ACCOUNT_CHANGED")
            (self.directory / "inputs" / "strategy.py").write_bytes(b"changed")
            with self.assertRaises(LiveRefusal) as caught:
                runs.status(self.root, self.run_id)
            self.assertEqual(caught.exception.code, "LIVE_IDENTITY_CHANGED")

    def test_an_attempted_run_never_cold_restarts(self):
        self.launch_record()
        with patch.object(runs, "_runner", return_value={"State": {"Running": False, "ExitCode": 137}}):
            with self.assertRaises(LiveRefusal) as caught:
                launch(self.root, self.run_id, self.credentials, "run", scope=self.scope)
        self.assertEqual(caught.exception.code, "LIVE_RESTART_REQUIRES_RECONCILIATION")

    def test_an_interrupted_run_starts_again_unless_it_ended_or_a_stop_was_asked(self):
        class Reached(Exception):
            """The launch got past the restart check."""

        self.launch_record()
        state.write_new(self.directory / "out" / "armed.json", b"{}")
        with patch.object(runs, "_runner", return_value={"State": {"Running": False, "ExitCode": 137}}), \
                patch.object(runs.key, "require_limits", side_effect=Reached):
            with self.assertRaises(Reached):
                launch(self.root, self.run_id, self.credentials, "run", scope=self.scope)
            state.append(self.directory / "out" / "events.jsonl", "unresolved", self.run_id)
            with self.assertRaises(LiveRefusal) as caught:
                launch(self.root, self.run_id, self.credentials, "run", scope=self.scope)
        self.assertEqual(caught.exception.code, "LIVE_RESTART_REQUIRES_RECONCILIATION")

    def test_at_most_three_restarts_an_hour(self):
        for _ in range(4):  # the first start and three restarts
            state.append(self.directory / "lifecycle.jsonl", "launch_requested", self.run_id, mode="run")
        now = max(row["observed_ns"] for row in state.events(self.directory / "lifecycle.jsonl"))
        self.assertFalse(runs.restarts_due(self.directory, now))
        self.assertTrue(runs.restarts_due(self.directory, now + runs.HOUR_NS))

    def test_a_running_runs_key_is_checked_hourly_and_each_failure_and_recovery_journalled_once(self):
        from live import control
        control._KEY_CHECKED.pop(self.run_id, None)
        refused = LiveRefusal("LIVE_KEY_IP_UNRESTRICTED", "no restriction")  # a timed run, as any other
        with patch.object(control.credentials, "run_path_locked", return_value=self.credentials):
            self.key_limits.side_effect = refused
            for now in (0.0, 10.0, 3600.0):  # the second is within the hour: no read
                control.check_key_locked(self.root, self.run_id, now)
            self.assertEqual(self.key_limits.call_count, 2)
            self.key_limits.assert_called_with(self.credentials)
            self.key_limits.side_effect = None
            control.check_key_locked(self.root, self.run_id, 7200.0)
            control.check_key_locked(self.root, self.run_id, 10800.0)
        rows = [(row["event"], row.get("code")) for row in state.events(self.directory / "lifecycle.jsonl")
                if row["event"] in control.KEY_EVENTS]
        self.assertEqual(rows, [("key_check_failed", "LIVE_KEY_IP_UNRESTRICTED"), ("key_check_passed", None)])

    def test_past_the_limit_the_control_tells_the_user_once_and_starts_nothing(self):
        from live import control
        self.launch_record()
        with patch.object(runs, "restarts_due", return_value=False), \
                patch.object(runs, "launch_locked") as launched:
            self.assertIsNone(control.restart_interrupted_locked(self.root, self.run_id, 0))
            self.assertIsNone(control.restart_interrupted_locked(self.root, self.run_id, 0))
        launched.assert_not_called()
        rows = state.events(self.directory / "lifecycle.jsonl")
        self.assertEqual([row["event"] for row in rows].count("restart_limited"), 1)

    def test_another_run_is_refused_in_every_mode_while_the_slot_holder_may_hold_exposure(self):
        self.launch_record()
        other = self.second_run()
        slot = (self.root / "account.jsonl").read_bytes()
        holders = (("alive", {"Running": True, "Status": "running", "ExitCode": 0}),
                   ("armed and exited", {"Running": False, "Status": "exited", "ExitCode": 137}))
        for holder, runner in holders:
            if holder == "armed and exited":
                state.write_new(self.directory / "out" / "armed.json", b"{}")
            resources = self.inspected()
            resources[("container", "runner")]["State"] = runner
            for mode in ("preflight", "run", "reconcile"):
                # The Docker view fails the test on anything but an inspection, so nothing starts.
                with self.subTest(holder=holder, mode=mode), \
                        patch.object(host_runtime, "docker", side_effect=self.docker_view(resources, [])):
                    with self.assertRaises(LiveRefusal) as caught:
                        launch(self.root, "probe-two", self.credentials, mode, scope=self.scope)
                    self.assertEqual(caught.exception.code, "LIVE_ACCOUNT_OWNED")
                    self.assertEqual((self.root / "account.jsonl").read_bytes(), slot)
                    self.assertEqual(runs._host_events(other), [])

    def test_a_live_runner_refuses_every_other_mode_and_replays_its_own(self):
        for alive, others in (("run", ("preflight", "reconcile")), ("preflight", ("run", "reconcile")),
                              ("reconcile", ("run", "preflight"))):
            self.reset_slot(alive)
            view = self.docker_view(self.inspected(mode=alive), [])
            with patch.object(host_runtime, "docker", side_effect=view):
                for mode in others:
                    with self.subTest(alive=alive, mode=mode):
                        with self.assertRaises(LiveRefusal) as caught:
                            launch(self.root, self.run_id, self.credentials, mode, scope=self.scope)
                        self.assertEqual(caught.exception.code, "LIVE_RUNNING")
                self.assertEqual(launch(self.root, self.run_id, self.credentials, alive, scope=self.scope)["write_status"], "replayed")
            self.assertEqual(sum(row["event"] == "launch_requested" for row in runs._host_events(self.directory)), 1)
        self.key_limits.assert_not_called()  # A repeated command must not depend on the network.

    def test_partial_host_journal_never_means_no_active_account(self):
        (self.root / "account.jsonl").write_bytes(b'{"event":"reserved"')
        with self.assertRaises(LiveRefusal) as caught:
            runs._active(self.root)
        self.assertEqual(caught.exception.code, "LIVE_JOURNAL_UNAVAILABLE")

    def test_live_cli_does_not_load_active_research_or_publish(self):
        with patch.object(db, "profile", side_effect=AssertionError("active ledger")), \
                patch.object(runs, "observe", wraps=runs.observe) as observe, \
                patch("sys.stdout", new_callable=io.StringIO) as output:
            self.assertEqual(cli.main(["live", "status", "--root", str(self.root), "--run-id", self.run_id]), 0)
        observe.assert_called_once_with(self.root, self.run_id)
        self.assertEqual(json.loads(output.getvalue())["state"], "prepared")

    def live_command(self, *arguments):
        """(exit code, stdout, stderr) of one CLI call, with a parser refusal counted as its exit code."""
        with patch("sys.stdout", new_callable=io.StringIO) as output, patch("sys.stderr", new_callable=io.StringIO) as errors:
            try:
                code = cli.main(["live", *arguments])
            except SystemExit as exc:
                code = exc.code
        return code, output.getvalue(), errors.getvalue()

    def test_start_names_the_source_that_will_place_real_orders(self):
        source = runs._manifest(self.root, self.run_id)[1]["source"]["source_sha256"]
        with self.assertRaises(LiveRefusal) as caught:
            runs.require_confirmed_locked(self.root, self.run_id, "0" * 64)
        self.assertEqual(caught.exception.code, "LIVE_IDENTITY_CHANGED")
        runs.require_confirmed_locked(self.root, self.run_id, source)

    def test_status_shows_the_hash_start_asks_for(self):
        source = runs._manifest(self.root, self.run_id)[1]["source"]["source_sha256"]
        self.assertEqual(runs.status(self.root, self.run_id)["source"]["source_sha256"], source)

    def test_the_live_help_states_the_risk_and_offers_no_launch(self):
        code, output, _ = self.live_command("--help")
        self.assertEqual(code, 0)
        self.assertIn("real money", " ".join(output.split()))
        self.assertIn("investment advice", " ".join(output.split()))
        for action in ("preflight", "start", "reconcile"):
            with self.subTest(action=action):
                self.assertNotEqual(self.live_command(action, "--help")[0], 0)

    def review(self, source=b"original", rows=(), candidate="found", read_error=None):
        """The review the control shows after preparation and before any launch (live.control)."""
        origin = hashlib.sha256(b"original").hexdigest()
        manifest = {"candidate": {"strategy_id": "original", "revision": 2},
                    "source": {"source_sha256": hashlib.sha256(source).hexdigest(), "entry_class": "Original"},
                    "runtime": IDENTITY, "evidence": EVIDENCE}
        reader = unittest.mock.MagicMock()
        reader.__enter__.return_value.one.return_value = candidate and {
            "source": b"original", "source_sha256": origin, "entry_class": "Original"}
        reader.__enter__.return_value.dicts.return_value = list(rows)
        with patch.object(runs.db, "read_as_of", return_value=reader, side_effect=read_error) as read:
            return runs.review(object(), "a" * 32, manifest), read, reader.__enter__.return_value

    def refused(self, **review) -> str:
        with self.assertRaises((LiveRefusal, Refusal)) as caught:
            self.review(**review)
        return caught.exception.code

    def test_preflight_shows_the_candidate_and_its_validations(self):
        window = {"window_start": datetime(2026, 1, 1), "window_end": datetime(2026, 2, 1), "universe_rule": "fixed"}
        rows = [{"registration_id": 7, "retry_of": None, "trial_id": None, "status": None, **window},
                {"registration_id": 8, "retry_of": 7, "trial_id": 9, "status": None, **window},
                {"registration_id": 9, "retry_of": 8, "trial_id": 10, "status": "passed", **window}]
        review, read, reader = self.review(rows=rows)
        self.assertEqual(review["research_at"], "a" * 32)
        self.assertEqual(review["source_sha256"], hashlib.sha256(b"original").hexdigest())
        self.assertEqual(review["candidate"], {"strategy_id": "original", "revision": 2})
        self.assertNotIn("rewritten", review)
        self.assertEqual([(item["registration_id"], item["status"], item["retry_of"], item["universe_rule"])
                          for item in review["validations"]],
                         [(7, "unbound", None, "fixed"), (8, "bound", 7, "fixed"), (9, "passed", 8, "fixed")])
        self.assertIn("no verdict on returns", review["validation_note"])
        self.assertEqual(read.call_args.args[1], "a" * 32)
        self.assertEqual(reader.dicts.call_args.args[1], (hashlib.sha256(b"original").hexdigest(),))

    def test_a_prepared_source_that_is_not_the_candidates_is_refused_before_any_launch(self):
        self.assertEqual(self.refused(source=b"adapted"), "LIVE_IDENTITY_CHANGED")

    def test_preflight_and_status_show_the_image_the_run_pinned(self):
        # Only the manifest's digest: a repeat that passes a tag keeps the first digest and resolves nothing.
        pinned = runs._manifest(self.root, self.run_id)[1]["runtime"]["image_ref"]
        self.assertEqual(self.review()[0]["image_ref"], IDENTITY["image_ref"])
        code, output, _ = self.live_command("status", "--root", str(self.root), "--run-id", self.run_id)
        self.assertEqual((code, json.loads(output)["image_ref"]), (0, pinned))

    def test_a_commit_without_the_candidate_is_refused_rather_than_shown_as_no_validation(self):
        self.assertEqual(self.refused(candidate=None), "UNKNOWN_CANDIDATE")

    def test_a_research_read_that_fails_is_refused_before_any_launch(self):
        self.assertEqual(self.refused(read_error=LiveRefusal("LIVE_CONFIG", "unreadable")), "LIVE_CONFIG")

    def test_private_directory_and_id_guards(self):
        public = self.root / "public"
        public.mkdir(mode=0o755)
        os.chmod(public, 0o755)
        with self.assertRaises(LiveRefusal):
            state.private_directory(public)
        with self.assertRaises(LiveRefusal):
            state.directory(self.root, "../../other")

    def test_prepare_captures_the_candidates_own_source_and_never_stores_credentials(self):
        universe = self.root / "universe-input.json"
        universe.write_text('{}')
        origin = {"strategy_id": "original", "revision": 2, "entry_class": "Original",
                  "source": b"original bytes", "source_sha256": hashlib.sha256(b"original bytes").hexdigest(),
                  "runtime_contract": "replay-contract@v8"}
        with patch.object(runs.db, "read_as_of") as read, \
                patch.object(runs.strategies, "read_candidate", return_value=origin), \
                patch("engine.load.read_universe"), \
                patch.object(runs.image, "resolve", return_value=IDENTITY), \
                patch.object(runs.image, "inspect_runtime", return_value={}), \
                patch.object(runs.image, "require_main_build"):
            manifest = prepare(self.root, "candidate-run", object(), "a" * 32, "original@2", ["BTCUSDT"],
                                    universe, self.credentials, None, scope=self.scope, drawdown_brake="0.15", duration_seconds=60, memory="2g", leverage="3",
                                    market_root=Path("unused"))
        self.assertEqual(read.call_args.args[1], "a" * 32)
        self.assertEqual(manifest["format"], runs.MANIFEST_FORMAT)
        self.assertEqual((manifest["config"]["leverage"], manifest["market"]), ("3", MARKET))
        self.assertEqual(manifest["candidate"], {"strategy_id": "original", "revision": 2})
        self.assertEqual(manifest["source"], {"source_sha256": origin["source_sha256"], "entry_class": "Original"})
        captured = state.directory(self.root, "candidate-run") / "inputs"
        self.assertEqual((captured / "strategy.py").read_bytes(), b"original bytes")
        for path in captured.iterdir():
            content = path.read_bytes()
            self.assertNotIn(b"example-key", content)
            self.assertNotIn(b"example-secret", content)

    def test_only_the_declared_source_hash_of_the_candidate_is_prepared(self):
        universe = self.root / "universe-input.json"
        universe.write_text('{}')
        origin = {"strategy_id": "original", "revision": 2, "entry_class": "Original",
                  "source": b"original bytes", "source_sha256": hashlib.sha256(b"original bytes").hexdigest(),
                  "runtime_contract": "replay-contract@v8"}
        for found, declared in ((origin, "f" * 64), ({**origin, "source": b"other bytes"}, origin["source_sha256"])):
            with self.subTest(declared=declared), patch.object(runs.db, "read_as_of"), \
                    patch.object(runs.strategies, "read_candidate", return_value=found), \
                    patch.object(runs.image, "resolve", side_effect=AssertionError("no image before the source")), \
                    self.scope.serialized(self.root) as root, self.assertRaises(LiveRefusal) as caught:
                runs.prepare_locked(root, "declared-run", object(), "a" * 32, "original@2", ["BTCUSDT"], universe,
                                    self.credentials, None, drawdown_brake="0.15",
                                    duration_seconds=60, memory="2g", leverage="3", market_root=Path("unused"),
                                    source_sha256=declared)
            self.assertEqual(caught.exception.code, "LIVE_IDENTITY_CHANGED")
            self.assertFalse(state.directory(self.root, "declared-run").exists())

    def test_a_prepared_run_id_replays_the_same_inputs_and_refuses_any_other(self):
        files = {name: self.root / name for name in ("universe", "other-universe")}
        files["universe"].write_text("{}")
        files["other-universe"].write_text('{"membership":{}}')
        linked = self.root / "linked-universe"
        linked.symlink_to(files["universe"])
        other_key = self.root / "other-key.json"
        state.write_new(other_key, b'{"api_key":"another-key","api_secret":"another-secret"}')
        same = {"candidate": "original@2", "symbols": ["BTCUSDT"], "universe": files["universe"],
                "credentials": self.credentials, "runtime": None, "drawdown_brake": "0.15", "duration_seconds": 60, "memory": "2g", "leverage": "3",
                "market_root": Path("unused")}
        origin = {"strategy_id": "original", "revision": 2, "entry_class": "Original",
                  "source": b"original bytes", "source_sha256": hashlib.sha256(b"original bytes").hexdigest(),
                  "runtime_contract": "replay-contract@v8"}

        def again(**changes):
            return prepare(self.root, "conflict", object(), "a" * 32, scope=self.scope, **{**same, **changes})

        # Only the repeat's inputs: the managed credential version has its own tests (test_credentials, test_requests).
        with patch.object(runs, "_bound_credential", return_value=None), \
                patch.object(runs.db, "read_as_of") as read, \
                patch.object(runs.strategies, "read_candidate", return_value=origin), \
                patch("engine.load.read_universe"), \
                patch.object(runs.image, "resolve", return_value=IDENTITY), \
                patch.object(runs.image, "inspect_runtime", return_value={}), \
                patch.object(runs.image, "require_main_build"):
            manifest = again()
            stored = (state.directory(self.root, "conflict") / "inputs" / "manifest.json").read_bytes()
            # Without this the fixture's own difference could be what each case below is refused for.
            self.assertEqual(again(), manifest)
            for changes in ({"candidate": "original@3"}, {"symbols": ["ETHUSDT"]}, {"drawdown_brake": "0.1"},
                            {"duration_seconds": 61},
                            {"memory": "3g"},
                            {"credentials": other_key},
                            {"universe": files["other-universe"]}, {"universe": linked},
                            {"runtime": "ghcr.io/qoeop/trade-runtime@sha256:" + "f" * 64},
                            {"runtime": "ghcr.io/qoeop/trade-runtime:exec-main"}):
                with self.subTest(changes=changes):
                    with self.assertRaises(LiveRefusal) as caught:
                        again(**changes)
                    self.assertEqual(caught.exception.code, "LIVE_RUN_CONFLICT")
        # The first preparation and the identical repeat read the candidate; a differing repeat is refused first.
        self.assertEqual(read.call_count, 2)
        self.assertEqual((state.directory(self.root, "conflict") / "inputs" / "manifest.json").read_bytes(), stored)

    def test_full_runner_identity_is_required_for_idempotency_and_logs(self):
        self.launch_record()
        base = self.inspected()
        for changed in ("image-id", "image-ref", "label", "mount", "network", "command", "container-id", "env"):
            resources = copy.deepcopy(base)
            found = resources[("container", "runner")]
            if changed == "image-id":
                found["Image"] = "sha256:" + "f" * 64
            elif changed == "image-ref":
                found["Config"]["Image"] = "other:latest"
            elif changed == "label":
                found["Config"]["Labels"]["trade.live.run"] = "someone-else"
            elif changed == "mount":
                found["Mounts"][2]["Source"] = "/another-account.json"
            elif changed == "network":
                found["NetworkSettings"]["Networks"]["bridge"] = {"NetworkID": "e" * 64}
            elif changed == "command":
                found["Config"]["Cmd"][-1] = "reconcile"
            elif changed == "container-id":
                found["Id"] = "f" * 64
            else:
                found["Config"]["Env"].append("BINANCE_API_KEY=foreign")
            calls = []
            with self.subTest(changed=changed), patch.object(host_runtime, "docker", side_effect=self.docker_view(resources, calls)):
                with self.assertRaises(LiveRefusal) as caught:
                    launch(self.root, self.run_id, self.credentials, "run", scope=self.scope)
                self.assertEqual(caught.exception.code, "LIVE_IDENTITY_CHANGED")
                with self.assertRaises(LiveRefusal):
                    runs.logs(self.root, self.run_id)
                self.assertFalse(any(call[0] in ("run", "start", "logs") for call in calls))
                self.assertEqual(runs._active(self.root), self.run_id)

    def test_valid_retained_runner_reuses_identity_and_logs_by_immutable_id(self):
        self.launch_record()
        calls = []
        with patch.object(host_runtime, "docker", side_effect=self.docker_view(self.inspected(), calls)):
            self.assertEqual(launch(self.root, self.run_id, self.credentials, "run", scope=self.scope)["write_status"], "replayed")
            self.assertEqual(runs.logs(self.root, self.run_id)["lines"], ["retained log"])
        self.assertIn(("logs", "--tail", "200", "c" * 64), calls)

    def test_wrong_stopped_runner_mount_cannot_release_account(self):
        self.launch_record()
        state.append(self.directory / "out" / "events.jsonl", "clean_stop", self.run_id)
        resources = self.inspected(running=False)
        resources[("container", "runner")]["Mounts"][0]["Source"] = "/unrelated-output"
        with patch.object(host_runtime, "docker", side_effect=self.docker_view(resources, [])):
            with self.assertRaises(LiveRefusal) as caught:
                runs.status(self.root, self.run_id)
        self.assertEqual(caught.exception.code, "LIVE_IDENTITY_CHANGED")
        self.assertEqual(runs._active(self.root), self.run_id)

    def test_stopped_egress_identity_verified_before_start(self):
        names = host_runtime.resource_names(self.root, self.run_id)
        base = self.inspected("egress", running=False)
        state.append(self.directory / "lifecycle.jsonl", "egress_created", self.run_id, container_id="c" * 64)
        for changed in ("label", "mount", "bridge", "image", "container-id"):
            resources = copy.deepcopy(base)
            found = resources[("container", names["egress"])]
            if changed == "label":
                found["Config"]["Labels"]["trade.live.role"] = "runner"
            elif changed == "mount":
                found["Mounts"].append({"Type": "bind", "Source": str(self.credentials),
                                         "Destination": "/run/secrets/binance.json", "RW": False})
            elif changed == "bridge":
                found["NetworkSettings"]["Networks"].pop("bridge")
            elif changed == "image":
                found["Image"] = "sha256:" + "f" * 64
            else:
                found["Id"] = "f" * 64
            with self.subTest(changed=changed), patch.object(host_runtime, "docker", side_effect=self.docker_view(resources, [])), \
                    patch.object(host_runtime, "checked", side_effect=AssertionError("unrelated container must not start")):
                with self.assertRaises(LiveRefusal) as caught:
                    runs._network(self.root, self.run_id, self.directory, self.manifest)
                self.assertEqual(caught.exception.code, "LIVE_IDENTITY_CHANGED")
        with patch.object(host_runtime, "docker", side_effect=self.docker_view(base, [])), patch.object(host_runtime, "checked") as action:
            runs._network(self.root, self.run_id, self.directory, self.manifest)
        action.assert_called_once_with("start", "c" * 64)

    def test_changed_network_labels_and_missing_retained_resources_are_not_recreated(self):
        names = host_runtime.resource_names(self.root, self.run_id)
        resources = self.inspected("egress", running=False)
        resources[("network", names["network"])]["Labels"]["trade.live.run"] = "foreign-run"
        with patch.object(host_runtime, "docker", side_effect=self.docker_view(resources, [])), \
                patch.object(host_runtime, "checked", side_effect=AssertionError("no replacement")):
            with self.assertRaises(LiveRefusal):
                runs._network(self.root, self.run_id, self.directory, self.manifest)
        for resource in ("network", "egress"):
            resources = self.inspected("egress")
            state.append(self.directory / "lifecycle.jsonl", "network_created", self.run_id, network_id="d" * 64)
            state.append(self.directory / "lifecycle.jsonl", "egress_created", self.run_id, container_id="c" * 64)
            resources.pop(("network", names["network"]) if resource == "network" else ("container", names["egress"]))
            with self.subTest(resource=resource), patch.object(host_runtime, "docker", side_effect=self.docker_view(resources, [])), \
                    patch.object(host_runtime, "checked", side_effect=AssertionError("no replacement")):
                with self.assertRaises(LiveRefusal) as caught:
                    runs._network(self.root, self.run_id, self.directory, self.manifest)
                self.assertEqual(caught.exception.code, "LIVE_IDENTITY_CHANGED")

    def test_fresh_egress_is_verified_and_bound_after_creation(self):
        names = host_runtime.resource_names(self.root, self.run_id)
        resources = self.inspected("egress")
        created = resources.pop(("container", names["egress"]))
        actions = []
        def action(*argv):
            actions.append(argv)
            if argv[0] == "run":
                resources[("container", names["egress"])] = copy.deepcopy(created)
                resources[("container", names["egress"])]["NetworkSettings"]["Networks"].pop("bridge")
                return "c" * 64
            self.assertEqual(argv, ("network", "connect", "bridge", names["egress"]))
            resources[("container", names["egress"])]["NetworkSettings"]["Networks"]["bridge"] = {"NetworkID": "e" * 64}
            return ""
        with patch.object(host_runtime, "docker", side_effect=self.docker_view(resources, [])), \
                patch.object(host_runtime, "checked", side_effect=action):
            runs._network(self.root, self.run_id, self.directory, self.manifest)
        self.assertEqual(len(actions), 2)
        self.assertEqual(runs._host_events(self.directory)[-1]["container_id"], "c" * 64)

    def test_fresh_runner_is_verified_and_its_actual_id_is_retained(self):
        names = host_runtime.resource_names(self.root, self.run_id)
        resources = self.inspected(mode="preflight")
        name = names["network"] + "-preflight-1"
        actual = resources.pop(("container", "runner"))
        actual["Name"] = "/" + name
        resources[("container", name)] = actual
        with patch.object(host_runtime, "docker", side_effect=self.docker_view(resources, [])), \
                patch.object(runs, "_network", return_value=names), patch.object(host_runtime, "checked", return_value="c" * 64):
            self.key_limits.return_value = ["a key note"]
            launched = launch(self.root, self.run_id, self.credentials, "preflight", scope=self.scope)
            self.assertEqual(launched["state"], "starting")
            self.assertEqual(launched["warnings"], ["a key note"])
        request, started = runs._host_events(self.directory)[-2:]
        self.assertEqual(request["credentials_path"], str(self.credentials))
        self.assertEqual(started["container_id"], "c" * 64)

    def test_unknown_inspect_failure_cannot_be_treated_as_missing(self):
        result = subprocess.CompletedProcess([], 1, "", "Cannot connect to the Docker daemon")
        with patch.object(host_runtime, "docker", return_value=result):
            with self.assertRaises(LiveRefusal) as caught:
                host_runtime.inspect("container", "runner")
        self.assertEqual(caught.exception.code, "LIVE_DOCKER_UNAVAILABLE")


class FakeHost:
    """The Docker commands recycling uses, with a stock of what `run` and `network create` would make."""

    def __init__(self, containers, networks, stock=None):
        self.containers, self.networks, self.stock = containers, networks, stock or {}
        self.calls, self.fail = [], set()

    def result(self, code=0, out="", err=""):
        return subprocess.CompletedProcess([], code, out, err)

    def __call__(self, *argv, **kwargs):
        self.calls.append(argv)
        if argv[0] in self.fail:
            self.fail.discard(argv[0])
            return self.result(1, err="refused")
        if argv[:1] == ("ps",):
            wanted = argv[argv.index("--filter") + 1].removeprefix("label=trade.live.run").removeprefix("=")
            rows = [c for c in self.containers.values()
                    if not wanted or c["Config"]["Labels"]["trade.live.run"] == wanted]
            field = (lambda c: c["Id"]) if wanted else (lambda c: c["Config"]["Labels"]["trade.live.run"])
            return self.result(out="\n".join(field(c) for c in rows))
        if argv[:2] == ("network", "ls"):
            return self.result(out="\n".join(n["Labels"]["trade.live.run"] for n in self.networks.values()
                                             if "trade.live.run" in n["Labels"]))
        if argv[:2] == ("network", "rm"):
            del self.networks[argv[2]]
            return self.result()
        if argv[:2] == ("network", "create"):
            self.networks[argv[-1]] = self.stock[argv[-1]]
            return self.result()
        if argv[:2] == ("network", "connect"):
            return self.result()
        if argv[0] == "run":
            name = argv[argv.index("--name") + 1]
            self.containers[name] = self.stock[name]
            return self.result(out=self.stock[name]["Id"])
        if argv[0] == "logs":
            return self.result(out=f"log of {argv[1]}\n")
        if argv[0] == "stop":
            return self.result()
        if argv[0] == "rm":
            self.containers = {k: c for k, c in self.containers.items() if c["Id"] != argv[1]}
            return self.result()
        if argv[1:2] == ("inspect",):
            if argv[0] == "image":
                return self.result(out=json.dumps([self.stock["image"]]))
            pool = self.networks if argv[0] == "network" else self.containers
            found = pool.get(argv[2]) or next((c for c in pool.values() if c["Id"] == argv[2]), None)
            if found is None:
                return self.result(1, err=f"Error: No such object: {argv[2]}")
            return self.result(out=json.dumps([found]))
        raise AssertionError(f"unexpected Docker operation {argv}")


class LiveRecycleTests(LiveFixture):
    def host_for(self, mode="run", exit_code=0, clean=True, armed=True):
        names = host_runtime.resource_names(self.root, self.run_id)
        self.runner = names["network"] + f"-{mode}-1"
        resources = self.inspected(mode=mode, running=False)
        runner = resources[("container", "runner")]
        runner["Name"] = "/" + self.runner
        runner["State"] = {"Running": False, "Status": "exited", "ExitCode": exit_code}
        egress = self.inspected("egress")
        proxy = egress[("container", names["egress"])]
        proxy["Id"] = "f" * 64
        proxy["State"] = {"Running": True, "Status": "running", "ExitCode": 0}
        network = resources[("network", names["network"])]
        host = FakeHost({self.runner: runner, names["egress"]: proxy}, {names["network"]: network, "bridge": egress[("network", "bridge")]},
                        {"image": resources[("image", IDENTITY["image_ref"])], names["network"]: network, names["egress"]: copy.deepcopy(proxy)})
        if mode != "preflight":
            state.append(self.root / "account.jsonl", "reserved", self.run_id)
        state.append(self.directory / "lifecycle.jsonl", "network_created", self.run_id, network_id=network["Id"])
        state.append(self.directory / "lifecycle.jsonl", "egress_created", self.run_id, container_id=proxy["Id"])
        state.append(self.directory / "lifecycle.jsonl", "launch_requested", self.run_id, mode=mode,
                     container=self.runner, credentials_path=str(self.credentials))
        state.append(self.directory / "lifecycle.jsonl", "container_started", self.run_id, mode=mode,
                     container=self.runner, container_id=runner["Id"])
        if armed:
            state.write_new(self.directory / "out" / "armed.json", b"{}")
        if clean:
            state.append(self.directory / "out" / "events.jsonl", "clean_stop", self.run_id)
        return host

    def status(self, host):
        with patch.object(host_runtime, "docker", side_effect=host):
            return runs.status(self.root, self.run_id)

    def removals(self, host):
        return [call for call in host.calls if call[0] in ("rm", "stop") or call[:2] == ("network", "rm")]

    def test_an_ended_run_gives_up_its_resources_and_keeps_its_logs(self):
        host = self.host_for()
        found = self.status(host)
        self.assertEqual((found["state"], found["exit_code"], found["account_owned"]), ("clean_stopped", 0, False))
        self.assertEqual(set(host.containers), set())
        self.assertEqual(set(host.networks), {"bridge"})
        self.assertIn(("stop", "--time", "5", "f" * 64), host.calls)
        calls = list(host.calls)
        again = self.status(host)
        self.assertEqual((again["state"], again["exit_code"], again["container"]), ("clean_stopped", 0, self.runner))
        self.assertFalse([call for call in host.calls[len(calls):] if call[0] == "logs"])
        with patch.object(host_runtime, "docker", side_effect=AssertionError("logs must not read Docker")):
            self.assertEqual(runs.logs(self.root, self.run_id)["lines"], [f"log of {'c' * 64}"])

    def test_an_unresolved_run_keeps_everything(self):
        host = self.host_for(exit_code=137, clean=False)
        found = self.status(host)
        self.assertEqual((found["state"], found["account_owned"]), ("interrupted", True))  # killed: it starts again
        self.assertEqual(self.removals(host), [])
        state.append(self.directory / "out" / "events.jsonl", "unresolved", self.run_id)
        found = self.status(host)
        self.assertEqual((found["state"], found["account_owned"]), ("unresolved", True))
        self.assertEqual(self.removals(host), [])
        self.assertIsNone(runs._recycled(self.directory))

    def test_a_runner_still_alive_behind_a_later_launch_keeps_everything(self):
        host = self.host_for()
        alive = copy.deepcopy(host.containers[self.runner])
        alive.update(Id="a" * 64, Name=f"/{self.runner}-older")
        alive["State"] = {"Running": True, "Status": "running", "ExitCode": 0}
        host.containers["older"] = alive
        self.assertEqual(self.status(host)["state"], "clean_stopped")
        self.assertEqual(self.removals(host), [])
        self.assertIsNone(runs._recycled(self.directory))

    def test_a_log_that_cannot_be_saved_keeps_everything(self):
        host = self.host_for()
        host.fail.add("logs")
        self.assertEqual(self.status(host)["state"], "clean_stopped")
        self.assertEqual(self.removals(host), [])
        self.assertIsNone(runs._recycled(self.directory))
        self.status(host)  # The next look finishes it.
        self.assertEqual(set(host.containers), set())

    def test_a_log_write_cut_short_is_never_taken_for_the_whole_log(self):
        host = self.host_for()
        real = state.write_new

        def partial(path, data):
            real(path, data[:3])
            raise OSError("disk full")

        with patch.object(state, "write_new", side_effect=partial):
            self.assertEqual(self.status(host)["state"], "clean_stopped")
        self.assertEqual(self.removals(host), [])
        self.assertFalse(runs._log_file(self.directory, self.runner).exists())
        self.status(host)
        self.assertEqual(set(host.containers), set())
        self.assertEqual(runs._log_file(self.directory, self.runner).read_text(), f"log of {'c' * 64}\n")

    def test_a_slot_taken_after_a_preflight_removal_is_still_released(self):
        host = self.host_for(mode="preflight", clean=False, armed=False)
        self.status(host)
        state.append(self.root / "account.jsonl", "reserved", self.run_id)  # `start` failed before launching.
        self.assertFalse(self.status(host)["account_owned"])
        self.assertIsNone(runs._active(self.root))
        self.assertEqual(self.status(host)["state"], "preflight_complete")

    def test_resources_from_a_start_that_never_launched_do_not_block_the_next_one(self):
        host = self.host_for(mode="preflight", clean=False, armed=False)
        self.status(host)
        names = host_runtime.resource_names(self.root, self.run_id)
        with patch.object(host_runtime, "docker", side_effect=host):
            runs._network(self.root, self.run_id, self.directory, self.manifest)
        self.assertIn(names["egress"], host.containers)
        self.status(host)
        self.assertEqual(set(host.containers), set())
        self.assertEqual(runs._since_removal(self.directory), [])
        with patch.object(host_runtime, "docker", side_effect=host):
            runs._network(self.root, self.run_id, self.directory, self.manifest)
        self.assertIn(names["egress"], host.containers)

    def test_a_start_finishes_a_removal_cut_short_before_it_takes_the_slot(self):
        host = self.host_for(mode="preflight", clean=False, armed=False)
        host.fail.add("rm")
        self.status(host)
        self.assertTrue(host.containers)
        host.fail.add("rm")
        with patch.object(host_runtime, "docker", side_effect=host), self.assertRaises(LiveRefusal) as caught:
            launch(self.root, self.run_id, self.credentials, "run", scope=self.scope)
        self.assertEqual(caught.exception.code, "LIVE_DOCKER_UNAVAILABLE")
        self.assertIsNone(runs._active(self.root))

        class Reached(Exception):
            pass

        def reached(*args):
            self.assertEqual(set(host.containers), set())
            raise Reached

        with patch.object(host_runtime, "docker", side_effect=host), patch.object(runs, "_network", side_effect=reached), \
                self.assertRaises(Reached):
            launch(self.root, self.run_id, self.credentials, "run", scope=self.scope)

    def test_a_start_keeps_what_a_failed_start_created_after_the_removal(self):
        host = self.host_for(mode="preflight", clean=False, armed=False)
        self.status(host)
        names = host_runtime.resource_names(self.root, self.run_id)
        with patch.object(host_runtime, "docker", side_effect=host):
            runs._network(self.root, self.run_id, self.directory, self.manifest)
        kept = set(host.containers)
        self.assertIn(names["egress"], kept)

        class Reached(Exception):
            pass

        def reached(*args):
            self.assertEqual(set(host.containers), kept)
            raise Reached

        with patch.object(host_runtime, "docker", side_effect=host), patch.object(runs, "_network", side_effect=reached), \
                self.assertRaises(Reached):
            launch(self.root, self.run_id, self.credentials, "run", scope=self.scope)

    def test_a_failed_removal_changes_no_result_and_is_finished_later(self):
        host = self.host_for()
        host.fail.add("rm")
        self.assertEqual(self.status(host)["state"], "clean_stopped")
        self.assertTrue(host.containers)
        self.assertEqual(runs._recycled(self.directory)["state"], "clean_stopped")
        self.assertEqual(self.status(host)["state"], "clean_stopped")
        self.assertEqual(set(host.containers), set())

    def test_an_ended_run_cannot_take_the_slot_again(self):
        host = self.host_for()
        self.status(host)
        with patch.object(host_runtime, "docker", side_effect=host):
            for mode, code in (("reconcile", "LIVE_RUN_MISSING"), ("preflight", "LIVE_RUN_MISSING"),
                               ("run", "LIVE_RESTART_REQUIRES_RECONCILIATION")):
                with self.assertRaises(LiveRefusal) as caught:
                    launch(self.root, self.run_id, self.credentials, mode, scope=self.scope)
                self.assertEqual(caught.exception.code, code)
        self.assertIsNone(runs._active(self.root))
        self.assertEqual(set(host.networks), {"bridge"})

    def test_a_run_that_only_preflighted_gets_new_resources_when_it_starts(self):
        host = self.host_for(mode="preflight", clean=False, armed=False)
        self.assertEqual(self.status(host)["state"], "preflight_complete")
        self.assertEqual(self.status(host)["state"], "preflight_complete")
        self.assertEqual(set(host.containers), set())
        names = host_runtime.resource_names(self.root, self.run_id)
        with patch.object(host_runtime, "docker", side_effect=host):
            runs._network(self.root, self.run_id, self.directory, self.manifest)
        self.assertEqual(set(host.containers), {names["egress"]})
        self.assertIn(names["network"], host.networks)
        created = [row["event"] for row in runs._since_removal(self.directory)]
        self.assertEqual(created, ["network_created", "egress_created"])

    def test_a_preflight_on_a_run_that_holds_the_slot_keeps_everything(self):
        host = self.host_for(mode="preflight", clean=False)
        state.append(self.root / "account.jsonl", "reserved", self.run_id)
        self.assertEqual(self.status(host)["account_owned"], True)
        with patch.object(host_runtime, "docker", side_effect=host):
            runs._recycle_others(self.root, "probe-two")
        self.assertEqual(self.removals(host), [])

    def test_a_new_launch_ends_the_removal_record(self):
        host = self.host_for(mode="preflight", clean=False, armed=False)
        self.status(host)
        self.assertEqual(runs._recycled(self.directory)["state"], "preflight_complete")
        state.append(self.directory / "lifecycle.jsonl", "launch_requested", self.run_id, mode="run", container="next")
        self.assertIsNone(runs._recycled(self.directory))

    def test_a_released_run_whose_network_is_already_gone_still_answers(self):
        host = self.host_for()
        state.append(self.root / "account.jsonl", "released", self.run_id, reason="native_and_venue_flat")
        host.networks = {"bridge": host.networks["bridge"]}
        del host.containers[host_runtime.resource_names(self.root, self.run_id)["egress"]]
        self.assertEqual(self.status(host)["state"], "clean_stopped")
        self.assertEqual(set(host.containers), set())
        self.assertEqual(runs._recycled(self.directory)["exit_code"], 0)

    def test_starting_another_run_recycles_an_ended_one_and_leaves_an_unresolved_one(self):
        host = self.host_for()
        state.append(self.root / "account.jsonl", "released", self.run_id, reason="native_and_venue_flat")
        with patch.object(host_runtime, "docker", side_effect=host):
            runs._recycle_others(self.root, "probe-two")
        self.assertEqual(set(host.containers), set())

    def test_starting_another_run_leaves_a_run_that_holds_the_slot(self):
        host = self.host_for(exit_code=137, clean=False)
        with patch.object(host_runtime, "docker", side_effect=host):
            runs._recycle_others(self.root, "probe-two")
        self.assertEqual(self.removals(host), [])

    def test_starting_another_run_leaves_a_run_still_in_preflight(self):
        host = self.host_for(mode="preflight", clean=False, armed=False)
        host.containers[self.runner]["State"] = {"Running": True, "Status": "running", "ExitCode": 0}
        with patch.object(host_runtime, "docker", side_effect=host):
            runs._recycle_others(self.root, "probe-two")
        self.assertEqual(self.removals(host), [])

    def test_a_host_that_cannot_answer_does_not_stop_a_start(self):
        result = subprocess.CompletedProcess([], 1, "", "Cannot connect to the Docker daemon")
        with patch.object(host_runtime, "docker", return_value=result):
            runs._recycle_others(self.root, self.run_id)


class LiveMonthFileTests(LiveFixture):
    """The control writes each month after the run's market day for the runner (engine.membership), as Paper's."""

    def setUp(self):
        super().setUp()
        manifest = {**self.manifest, "market": MARKET}
        (self.directory / "inputs" / "manifest.json").write_bytes(state.encode(manifest))
        patcher = patch("market.universe.month_files", return_value={"2026-12": b'{"members":["BTCUSDT"]}'})
        self.month_files = patcher.start()
        self.addCleanup(patcher.stop)

    def at(self, day):
        return int(datetime.fromisoformat(day + "T00:00:00+00:00").timestamp()) * 10**9

    def test_a_month_is_written_once_it_has_begun_whole_and_the_market_is_read_once_a_month(self):
        folder = self.directory / "inputs" / "membership"
        self.assertEqual(runs.write_months_locked(self.root, self.run_id, self.root / "market", self.at("2026-11-30")), [])
        self.month_files.assert_not_called()  # the market day's month: the universe file holds it
        self.assertFalse(folder.exists())
        state.private_directory(folder)
        (folder / "2026-12.partial").write_bytes(b"left by a write that died")
        self.assertEqual(runs.write_months_locked(self.root, self.run_id, self.root / "market", self.at("2026-12-01")),
                         ["2026-12"])
        self.month_files.assert_called_once_with({"holds": "market", "root": str(self.root / "market")}, ["BTCUSDT"],
                                                 "2026-11")
        self.assertEqual(sorted(path.name for path in folder.iterdir()), ["2026-12.json"])
        self.assertEqual((folder / "2026-12.json").read_bytes(), b'{"members":["BTCUSDT"]}')
        self.assertEqual((folder / "2026-12.json").stat().st_mode & 0o777, 0o600)
        # Written: not read again, nor rewritten, until the next month begins.
        self.assertEqual(runs.write_months_locked(self.root, self.run_id, self.root / "market", self.at("2026-12-31")), [])
        self.assertEqual(self.month_files.call_count, 1)
        self.month_files.return_value = {"2027-01": b'{"members":[]}'}
        self.assertEqual(runs.write_months_locked(self.root, self.run_id, self.root / "market", self.at("2027-01-01")),
                         ["2027-01"])
        self.assertEqual(self.month_files.call_args.args[2], "2026-12")
        self.assertEqual((folder / "2026-12.json").read_bytes(), b'{"members":["BTCUSDT"]}')

    def test_a_month_the_market_does_not_hold_yet_is_read_again_on_the_next_pass(self):
        self.month_files.return_value = {}
        for _ in range(2):
            self.assertEqual(runs.write_months_locked(self.root, self.run_id, self.root / "market",
                                                      self.at("2026-12-02")), [])
        self.assertEqual(self.month_files.call_count, 2)


if __name__ == "__main__":
    unittest.main()
