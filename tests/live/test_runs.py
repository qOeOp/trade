"""Private Live custody survives unknown launches and never mistakes process exit for flatness."""

import copy
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
from live import authority, runs, state
from tests.live.authority_fixture import install


IDENTITY = {"image_ref": "ghcr.io/qoeop/trade-runtime@sha256:" + "a" * 64, "image_digest": "sha256:" + "a" * 64,
            "platform": "linux/amd64", "runtime_contract": "replay-contract@v7"}


class LiveFixture(unittest.TestCase):
    def setUp(self):
        patcher = patch.object(runs.key, "require_limits", return_value=[])  # tests/live/test_key.py covers the read.
        self.key_limits = patcher.start()
        self.addCleanup(patcher.stop)
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.authority = install(self, self.root)
        self.scope = authority.operator(self.root, self.authority.binding.web_name)
        self.credentials = self.root / "credentials.json"
        state.write_new(self.credentials, b'{"api_key":"example-key","api_secret":"example-secret"}')
        self.run_id = "probe-one"
        self.directory = state.directory(self.root, self.run_id)
        for part in (self.directory, self.directory / "inputs", self.directory / "out", self.directory / "egress"):
            state.private_directory(part)
        self.manifest = {
            "format": "live-run-v5", "run_id": self.run_id, "runtime": IDENTITY, "symbols": ["BTCUSDT"],
            "origin_candidate": {"strategy_id": "example", "revision": 1,
                                 "source_sha256": hashlib.sha256(b"original").hexdigest()},
            "source": {"entry_class": "Example", "source_sha256": hashlib.sha256(b"source").hexdigest()},
            "universe_sha256": hashlib.sha256(b"{}").hexdigest(),
            "config": {"memory": "2g"}, "credential_binding": hashlib.sha256(b"example-key").hexdigest(),
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
        names = runs._names(self.root, self.run_id)
        network = {"Id": "d" * 64, "Name": names["network"], "Driver": "bridge", "Internal": True,
                   "Labels": {"trade.live.run": self.run_id}}
        bridge = {"Id": "e" * 64, "Name": "bridge", "Driver": "bridge", "Internal": False, "Labels": {}}
        name = "runner" if role == "runner" else names["egress"]
        mounts = [{"Type": "bind", "Source": str(self.directory / "out"), "Destination": "/reports", "RW": True},
                  {"Type": "bind", "Source": str(self.directory / "inputs"), "Destination": "/inputs", "RW": False},
                  {"Type": "bind", "Source": str(self.credentials),
                   "Destination": "/run/secrets/binance.json", "RW": False}]
        networks = {names["network"]: {"NetworkID": network["Id"]}}
        command = ["-m", "engine.live", *runs._runner_args(mode)]
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
        return runs.launch(self.root, self.run_id, self.credentials, mode, scope=self.scope)

    def test_a_run_prepared_before_a_format_change_can_only_reconcile(self):
        for retained in ("live-run-v1", "live-run-v2", "live-run-v3", "live-run-v4"):
            for mode in ("run", "preflight"):
                with self.subTest(retained=retained, mode=mode), patch.object(runs, "_network") as network:
                    with self.assertRaises(LiveRefusal) as caught:
                        self.retained_format_launch(retained, mode)
                    self.assertEqual(caught.exception.code, "LIVE_RUN_FORMAT")
                    network.assert_not_called()
            self.assertFalse((self.root / "account.jsonl").exists())
            with self.assertRaises(LiveRefusal) as caught:  # Past the format gate: this run was never armed.
                self.retained_format_launch(retained, "reconcile")
            self.assertEqual(caught.exception.code, "LIVE_RUN_MISSING")

    def test_prepare_requires_a_loss_limit_within_the_budget(self):
        for limit in ("0", "NaN", "100.01"):
            with self.subTest(limit), self.assertRaises(LiveRefusal) as caught:
                runs.prepare(self.root, "limit-run", object(), "a" * 32, "original@2", ["BTCUSDT"], Path("unused"),
                             self.credentials, None, scope=self.scope, budget_usdt="100", max_notional_per_order="90",
                             max_loss_usdt=limit, duration_seconds=60, memory="2g", single_order_source_reviewed=True)
            self.assertEqual(caught.exception.code, "LIVE_CONFIG")

    def test_a_key_that_is_refused_takes_no_slot_and_a_reconcile_does_not_ask(self):
        self.key_limits.side_effect = LiveRefusal("LIVE_KEY_WITHDRAWAL", "withdrawals on")
        with patch.object(runs, "_network") as network, self.assertRaises(LiveRefusal) as caught:
            runs.launch(self.root, self.run_id, self.credentials, "run", scope=self.scope)
        self.assertEqual(caught.exception.code, "LIVE_KEY_WITHDRAWAL")
        network.assert_not_called()
        self.assertFalse((self.root / "account.jsonl").exists())
        self.key_limits.assert_called_once_with(self.credentials)
        self.key_limits.reset_mock()
        with self.assertRaises(LiveRefusal) as caught:
            runs.launch(self.root, self.run_id, self.credentials, "reconcile", scope=self.scope)
        self.assertEqual(caught.exception.code, "LIVE_RUN_MISSING")
        (self.directory / "out" / "armed.json").write_text("{}")
        with patch.object(runs, "_network", side_effect=RuntimeError("past the key check")), self.assertRaises(RuntimeError):
            runs.launch(self.root, self.run_id, self.credentials, "reconcile", scope=self.scope)
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
            state.encode({**self.manifest, "format": "live-run-v4"}))
        universe = self.root / "universe.json"
        universe.write_text("{}")
        with self.assertRaises(LiveRefusal) as caught:
            runs.prepare(self.root, self.run_id, object(), "a" * 32, "original@2", ["BTCUSDT"], universe,
                         self.credentials, None, scope=self.scope, budget_usdt="100", max_notional_per_order="90", max_loss_usdt="10",
                         duration_seconds=60, memory="2g", single_order_source_reviewed=True)
        self.assertEqual(caught.exception.code, "LIVE_RUN_FORMAT")

    def test_failed_launch_retains_account_custody_and_inputs(self):
        with patch.object(runs, "_network", return_value={"network": "network"}), \
                patch.object(runs, "_checked", side_effect=RuntimeError("unknown launch")):
            with self.assertRaises(RuntimeError):
                runs.launch(self.root, self.run_id, self.credentials, "run", scope=self.scope)
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
                runs.launch(self.root, self.run_id, self.credentials, "run", scope=self.scope)
            self.assertEqual(caught.exception.code, "LIVE_RESTART_REQUIRES_RECONCILIATION")
            with self.assertRaises(LiveRefusal) as caught:
                runs.launch(self.root, self.run_id, self.credentials, "reconcile", scope=self.scope)
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
                patch.object(runs, "_container", return_value={"Id": "c" * 64}), \
                patch.object(runs, "_checked", return_value="c" * 64):
            self.assertEqual(runs.launch(self.root, "probe-two", self.credentials, "run", scope=self.scope)["state"], "starting")
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
            self.assertEqual(runs.status(self.root, self.run_id)["state"], "unresolved")
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
            runs.launch(self.root, self.run_id, self.credentials, "reconcile", scope=self.scope)
        self.assertEqual(caught.exception.code, "LIVE_RUN_MISSING")
        self.assertIsNone(runs._active(self.root))

    def test_stop_only_writes_request_and_does_not_call_docker(self):
        self.launch_record()
        with patch.object(runs, "_docker", side_effect=AssertionError("stop must not kill")):
            runs.stop(self.root, self.run_id)
            runs.stop(self.root, self.run_id)
        self.assertTrue((self.directory / "out" / "STOP").exists())
        self.assertEqual(sum(row["event"] == "stop_requested" for row in runs._host_events(self.directory)), 1)

    def test_key_change_and_source_change_are_refused_before_docker(self):
        self.credentials.write_text('{"api_key":"another-key","api_secret":"another-secret"}')
        with patch.object(runs, "_docker", side_effect=AssertionError("no Docker")):
            with self.assertRaises(LiveRefusal) as caught:
                runs.launch(self.root, self.run_id, self.credentials, "run", scope=self.scope)
            self.assertEqual(caught.exception.code, "LIVE_ACCOUNT_CHANGED")
            (self.directory / "inputs" / "strategy.py").write_bytes(b"changed")
            with self.assertRaises(LiveRefusal) as caught:
                runs.status(self.root, self.run_id)
            self.assertEqual(caught.exception.code, "LIVE_IDENTITY_CHANGED")

    def test_an_attempted_run_never_cold_restarts(self):
        self.launch_record()
        with patch.object(runs, "_runner", return_value={"State": {"Running": False, "ExitCode": 137}}):
            with self.assertRaises(LiveRefusal) as caught:
                runs.launch(self.root, self.run_id, self.credentials, "run", scope=self.scope)
        self.assertEqual(caught.exception.code, "LIVE_RESTART_REQUIRES_RECONCILIATION")

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
                        patch.object(runs, "_docker", side_effect=self.docker_view(resources, [])):
                    with self.assertRaises(LiveRefusal) as caught:
                        runs.launch(self.root, "probe-two", self.credentials, mode, scope=self.scope)
                    self.assertEqual(caught.exception.code, "LIVE_ACCOUNT_OWNED")
                    self.assertEqual((self.root / "account.jsonl").read_bytes(), slot)
                    self.assertEqual(runs._host_events(other), [])

    def test_a_live_runner_refuses_every_other_mode_and_replays_its_own(self):
        for alive, others in (("run", ("preflight", "reconcile")), ("preflight", ("run", "reconcile")),
                              ("reconcile", ("run", "preflight"))):
            self.reset_slot(alive)
            view = self.docker_view(self.inspected(mode=alive), [])
            with patch.object(runs, "_docker", side_effect=view):
                for mode in others:
                    with self.subTest(alive=alive, mode=mode):
                        with self.assertRaises(LiveRefusal) as caught:
                            runs.launch(self.root, self.run_id, self.credentials, mode, scope=self.scope)
                        self.assertEqual(caught.exception.code, "LIVE_RUNNING")
                self.assertEqual(runs.launch(self.root, self.run_id, self.credentials, alive, scope=self.scope)["write_status"], "replayed")
            self.assertEqual(sum(row["event"] == "launch_requested" for row in runs._host_events(self.directory)), 1)
        self.key_limits.assert_not_called()  # A repeated command must not depend on the network.

    def test_partial_host_journal_never_means_no_active_account(self):
        (self.root / "account.jsonl").write_bytes(b'{"event":"reserved"')
        with self.assertRaises(LiveRefusal) as caught:
            runs._active(self.root)
        self.assertEqual(caught.exception.code, "LIVE_JOURNAL_UNAVAILABLE")

    def test_live_cli_does_not_load_active_research_or_publish(self):
        with patch.object(cli, "ledger_profile", side_effect=AssertionError("active ledger")), \
                patch.object(runs, "status", return_value={"state": "prepared"}), \
                patch("sys.stdout", new_callable=io.StringIO) as output:
            self.assertEqual(cli.main(["live", "status", "--root", str(self.root), "--run-id", self.run_id]), 0)
        self.assertEqual(json.loads(output.getvalue())["state"], "prepared")

    def live_command(self, *arguments):
        """(exit code, stdout, stderr) of one CLI call, with a parser refusal counted as its exit code."""
        if arguments[0] in {"preflight", "start", "reconcile"}:
            arguments = (*arguments, "--release-web", self.authority.binding.web_name)
        with patch("sys.stdout", new_callable=io.StringIO) as output, patch("sys.stderr", new_callable=io.StringIO) as errors:
            try:
                code = cli.main(["live", *arguments])
            except SystemExit as exc:
                code = exc.code
        return code, output.getvalue(), errors.getvalue()

    def test_start_names_the_source_that_will_place_real_orders(self):
        start = ("start", "--root", str(self.root), "--run-id", self.run_id, "--credentials-file", str(self.credentials))
        source = runs._manifest(self.root, self.run_id)[1]["source"]["source_sha256"]
        with patch.object(runs, "launch", return_value={"state": "starting"}) as launch:
            code, _, errors = self.live_command(*start)
            self.assertNotEqual(code, 0)
            self.assertIn("--confirm-real-orders", errors)
            code, _, errors = self.live_command(*start, "--confirm-real-orders", "0" * 64)
            self.assertEqual((code, json.loads(errors)["code"]), (1, "LIVE_IDENTITY_CHANGED"))
            launch.assert_not_called()
            self.assertEqual(self.live_command(*start, "--confirm-real-orders", source)[0], 0)
            self.assertEqual(launch.call_args.args[3], "run")
            launch.reset_mock()
            self.assertEqual(self.live_command("reconcile", "--root", str(self.root), "--run-id", self.run_id,
                                               "--credentials-file", str(self.credentials))[0], 0)
            self.assertEqual(launch.call_args.args[3], "reconcile")
            launch.reset_mock()
            code, _, errors = self.live_command("start", "--root", str(self.root), "--run-id", "never-prepared",
                                                "--credentials-file", str(self.credentials),
                                                "--confirm-real-orders", source)
            self.assertEqual(code, 1)
            launch.assert_not_called()

    def test_status_shows_the_hash_start_asks_for(self):
        source = runs._manifest(self.root, self.run_id)[1]["source"]["source_sha256"]
        self.assertEqual(runs.status(self.root, self.run_id)["source"]["source_sha256"], source)

    def test_the_live_help_states_the_risk(self):
        for command in (("--help",), ("start", "--help")):
            code, output, _ = self.live_command(*command)
            self.assertEqual(code, 0)
            self.assertIn("real money", " ".join(output.split()))
        self.assertIn("investment advice", " ".join(self.live_command("--help")[1].split()))

    def preflight(self, source=b"original", entry_class="Original", rows=(), candidate="found", read_error=None):
        arguments = ("preflight", "--root", str(self.root), "--run-id", self.run_id, "--research-ledger", "reader",
                     "--research-at", "a" * 32, "--candidate", "original@2", "--symbols", "BTCUSDT",
                     "--universe-file", "unused", "--credentials-file", str(self.credentials), "--budget-usdt", "100",
                     "--max-notional-per-order", "90", "--max-loss-usdt", "10", "--duration-seconds", "60")
        origin = hashlib.sha256(b"original").hexdigest()
        manifest = {"origin_candidate": {"strategy_id": "original", "revision": 2, "source_sha256": origin},
                    "source": {"source_sha256": hashlib.sha256(source).hexdigest(), "entry_class": entry_class},
                    "runtime": IDENTITY}
        reader = unittest.mock.MagicMock()
        reader.__enter__.return_value.one.return_value = candidate and {
            "source": b"original", "source_sha256": origin, "entry_class": "Original"}
        reader.__enter__.return_value.dicts.return_value = list(rows)
        with patch.object(cli, "ledger_profile", return_value=object()), patch.object(runs, "prepare", return_value=manifest), \
                patch.object(runs.db, "read_as_of", return_value=reader, side_effect=read_error) as read, \
                patch.object(runs, "launch", return_value={"state": "starting", "warnings": []}) as launch:
            result = self.live_command(*arguments)
        return result, read, launch, reader.__enter__.return_value

    def test_preflight_shows_the_origin_its_validations_and_whether_the_source_was_rewritten(self):
        window = {"window_start": datetime(2026, 1, 1), "window_end": datetime(2026, 2, 1), "universe_rule": "fixed"}
        rows = [{"registration_id": 7, "retry_of": None, "trial_id": None, "status": None, **window},
                {"registration_id": 8, "retry_of": 7, "trial_id": 9, "status": None, **window},
                {"registration_id": 9, "retry_of": 8, "trial_id": 10, "status": "passed", **window}]
        (code, output, _), read, launch, reader = self.preflight(rows=rows)
        self.assertEqual(code, 0)
        found = json.loads(output)
        self.assertEqual((found["state"], found["warnings"]), ("starting", []))
        review = found["review"]
        self.assertEqual(review["research_at"], "a" * 32)
        self.assertEqual(review["source_sha256"], hashlib.sha256(b"original").hexdigest())
        self.assertEqual(review["origin_candidate"]["strategy_id"], "original")
        self.assertIs(review["rewritten"], False)
        self.assertEqual([(item["registration_id"], item["status"], item["retry_of"], item["universe_rule"])
                          for item in review["origin_candidate_validations"]],
                         [(7, "unbound", None, "fixed"), (8, "bound", 7, "fixed"), (9, "passed", 8, "fixed")])
        self.assertIn("no verdict on returns", review["validation_note"])
        self.assertEqual(read.call_args.args[1], "a" * 32)
        self.assertEqual(reader.dicts.call_args.args[1], ("original", 2))
        launch.assert_called_once()
        for changed, expected_class in (({"source": b"adapted", "entry_class": "Adapted"}, "Adapted"),
                                        ({"entry_class": "Another"}, "Another")):
            (code, output, _), *_ = self.preflight(rows=rows, **changed)
            self.assertEqual(code, 0)
            review = json.loads(output)["review"]
            self.assertIs(review["rewritten"], True)
            self.assertEqual(review["entry_class"], expected_class)
            self.assertEqual(len(review["origin_candidate_validations"]), 3)  # Shown, and the note says they do not apply.
        (code, output, _), *_ = self.preflight(source=b"adapted")
        self.assertEqual(json.loads(output)["review"]["origin_candidate_validations"], [])

    def test_preflight_and_status_show_the_image_the_run_pinned(self):
        # Only the manifest's digest: a repeat that passes a tag keeps the first digest and resolves nothing.
        pinned = runs._manifest(self.root, self.run_id)[1]["runtime"]["image_ref"]
        (code, output, _), *_ = self.preflight()
        self.assertEqual((code, json.loads(output)["review"]["image_ref"]), (0, IDENTITY["image_ref"]))
        code, output, _ = self.live_command("status", "--root", str(self.root), "--run-id", self.run_id)
        self.assertEqual((code, json.loads(output)["image_ref"]), (0, pinned))

    def test_a_commit_without_the_candidate_is_refused_rather_than_shown_as_no_validation(self):
        (code, _, errors), _, launch, _ = self.preflight(candidate=None)
        self.assertEqual((code, json.loads(errors)["code"]), (1, "UNKNOWN_CANDIDATE"))
        launch.assert_not_called()

    def test_a_research_read_that_fails_takes_nothing_from_the_account(self):
        (code, *_), _, launch, _ = self.preflight(read_error=LiveRefusal("LIVE_CONFIG", "unreadable"))
        self.assertEqual(code, 1)
        launch.assert_not_called()

    def test_private_directory_and_id_guards(self):
        public = self.root / "public"
        public.mkdir(mode=0o755)
        os.chmod(public, 0o755)
        with self.assertRaises(LiveRefusal):
            state.private_directory(public)
        with self.assertRaises(LiveRefusal):
            state.directory(self.root, "../../other")

    def test_adaptation_keeps_original_provenance_and_never_stores_credentials(self):
        universe = self.root / "universe-input.json"
        universe.write_text('{}')
        adapted = self.root / "adapted.py"
        adapted.write_bytes(b"adapted exact bytes")
        origin = {"strategy_id": "original", "revision": 2, "entry_class": "Original",
                  "source": b"original bytes", "source_sha256": hashlib.sha256(b"original bytes").hexdigest(),
                  "runtime_contract": "replay-contract@v7"}
        with patch.object(runs.db, "read_as_of") as read, \
                patch.object(runs.strategies, "read_candidate", return_value=origin), \
                patch("engine.load.read_universe"), patch("engine.load.load_strategy") as load, \
                patch.object(runs.image, "resolve", return_value=IDENTITY), \
                patch.object(runs.image, "inspect_runtime", return_value={}), \
                patch.object(runs.image, "require_main_build"):
            manifest = runs.prepare(self.root, "adaptation", object(), "a" * 32, "original@2", ["BTCUSDT"],
                                    universe, self.credentials, None, scope=self.scope, budget_usdt="100",
                                    max_notional_per_order="90", max_loss_usdt="10", duration_seconds=60, memory="2g",
                                    single_order_source_reviewed=True, strategy_file=adapted, strategy_class="Adapted")
        self.assertEqual(read.call_args.args[1], "a" * 32)
        self.assertEqual(manifest["format"], "live-run-v5")
        load.assert_called_once_with(adapted, "Adapted", hashlib.sha256(adapted.read_bytes()).hexdigest())
        self.assertEqual(manifest["origin_candidate"]["source_sha256"], origin["source_sha256"])
        self.assertEqual(manifest["source"]["source_sha256"], hashlib.sha256(adapted.read_bytes()).hexdigest())
        self.assertNotIn("runtime_contract", manifest["source"])
        captured = state.directory(self.root, "adaptation") / "inputs"
        self.assertEqual((captured / "strategy.py").read_bytes(), adapted.read_bytes())
        for path in captured.iterdir():
            content = path.read_bytes()
            self.assertNotIn(b"example-key", content)
            self.assertNotIn(b"example-secret", content)

    def test_start_cannot_replace_prepared_adaptation(self):
        adapted = self.root / "different.py"
        adapted.write_bytes(b"different")
        with patch.object(runs, "_docker", side_effect=AssertionError("no Docker before identity check")):
            with self.assertRaises(LiveRefusal) as caught:
                runs.launch(self.root, self.run_id, self.credentials, "run",
                            scope=self.scope, strategy_file=adapted, strategy_class="Example")
        self.assertEqual(caught.exception.code, "LIVE_IDENTITY_CHANGED")

    def test_a_prepared_run_id_replays_the_same_inputs_and_refuses_any_other(self):
        files = {name: self.root / name for name in ("universe", "other-universe", "adapted", "other-source")}
        files["universe"].write_text("{}")
        files["other-universe"].write_text('{"membership":{}}')
        files["adapted"].write_bytes(b"adapted")
        files["other-source"].write_bytes(b"other")
        linked = self.root / "linked-universe"
        linked.symlink_to(files["universe"])
        other_key = self.root / "other-key.json"
        state.write_new(other_key, b'{"api_key":"another-key","api_secret":"another-secret"}')
        same = {"candidate": "original@2", "symbols": ["BTCUSDT"], "universe": files["universe"],
                "credentials": self.credentials, "runtime": None, "budget_usdt": "100",
                "max_notional_per_order": "90", "max_loss_usdt": "10", "duration_seconds": 60, "memory": "2g",
                "single_order_source_reviewed": True, "strategy_file": files["adapted"], "strategy_class": "Adapted"}
        origin = {"strategy_id": "original", "revision": 2, "entry_class": "Original",
                  "source": b"original bytes", "source_sha256": hashlib.sha256(b"original bytes").hexdigest(),
                  "runtime_contract": "replay-contract@v7"}

        def prepare(**changes):
            return runs.prepare(self.root, "conflict", object(), "a" * 32, scope=self.scope, **{**same, **changes})

        with patch.object(runs.db, "read_as_of") as read, \
                patch.object(runs.strategies, "read_candidate", return_value=origin), \
                patch("engine.load.read_universe"), patch("engine.load.load_strategy"), \
                patch.object(runs.image, "resolve", return_value=IDENTITY), \
                patch.object(runs.image, "inspect_runtime", return_value={}), \
                patch.object(runs.image, "require_main_build"):
            manifest = prepare()
            stored = (state.directory(self.root, "conflict") / "inputs" / "manifest.json").read_bytes()
            # Without this the fixture's own difference could be what each case below is refused for.
            self.assertEqual(prepare(), manifest)
            for changes in ({"candidate": "original@3"}, {"symbols": ["ETHUSDT"]}, {"budget_usdt": "101"},
                            {"max_notional_per_order": "91"}, {"max_loss_usdt": "11"}, {"duration_seconds": 61},
                            {"memory": "3g"},
                            {"single_order_source_reviewed": False}, {"credentials": other_key},
                            {"universe": files["other-universe"]}, {"universe": linked},
                            {"strategy_file": files["other-source"]}, {"strategy_class": "Other"},
                            {"runtime": "ghcr.io/qoeop/trade-runtime@sha256:" + "f" * 64}):
                with self.subTest(changes=changes):
                    with self.assertRaises(LiveRefusal) as caught:
                        prepare(**changes)
                    self.assertEqual(caught.exception.code, "LIVE_RUN_CONFLICT")
        read.assert_called_once()
        self.assertEqual((state.directory(self.root, "conflict") / "inputs" / "manifest.json").read_bytes(), stored)

    def test_a_repeat_binds_the_same_source_whether_or_not_it_names_a_file(self):
        universe = self.root / "universe-input.json"
        universe.write_text("{}")
        files = {name: self.root / f"{name}.py" for name in ("adapted", "copy")}
        files["adapted"].write_bytes(b"adapted")
        files["copy"].write_bytes(b"original bytes")
        origin = {"strategy_id": "original", "revision": 2, "entry_class": "Original",
                  "source": b"original bytes", "source_sha256": hashlib.sha256(b"original bytes").hexdigest(),
                  "runtime_contract": "replay-contract@v7"}

        def prepare(run_id, source=None):
            file, entry_class = source or (None, None)
            return runs.prepare(self.root, run_id, object(), "a" * 32, "original@2", ["BTCUSDT"], universe,
                                self.credentials, None, scope=self.scope, budget_usdt="100", max_notional_per_order="90",
                                max_loss_usdt="10", duration_seconds=60, memory="2g",
                                single_order_source_reviewed=True, strategy_file=file, strategy_class=entry_class)

        own, adapted = (files["copy"], "Original"), (files["adapted"], "Adapted")
        same_bytes = (files["copy"], "Other")  # another class of the candidate's own bytes is still a rewrite
        with patch.object(runs.db, "read_as_of"), \
                patch.object(runs.strategies, "read_candidate", return_value=origin), \
                patch("engine.load.read_universe"), patch("engine.load.load_strategy"), \
                patch.object(runs.image, "resolve", return_value=IDENTITY), \
                patch.object(runs.image, "inspect_runtime", return_value={}), \
                patch.object(runs.image, "require_main_build"):
            for first, same, others in ((None, (None, own), (adapted, same_bytes)),
                                        (adapted, (adapted,), (None, own, same_bytes)),
                                        (same_bytes, (same_bytes,), (None, own, adapted))):
                run_id = f"source-{(first[1] if first else 'none').lower()}"
                manifest = prepare(run_id, first)
                stored = (state.directory(self.root, run_id) / "inputs" / "manifest.json").read_bytes()
                for source in same:
                    with self.subTest(first=first, again=source):
                        self.assertEqual(prepare(run_id, source), manifest)
                for source in others:
                    with self.subTest(first=first, other=source):
                        with self.assertRaises(LiveRefusal) as caught:
                            prepare(run_id, source)
                        self.assertEqual(caught.exception.code, "LIVE_RUN_CONFLICT")
                self.assertEqual((state.directory(self.root, run_id) / "inputs" / "manifest.json").read_bytes(),
                                 stored)

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
            with self.subTest(changed=changed), patch.object(runs, "_docker", side_effect=self.docker_view(resources, calls)):
                with self.assertRaises(LiveRefusal) as caught:
                    runs.launch(self.root, self.run_id, self.credentials, "run", scope=self.scope)
                self.assertEqual(caught.exception.code, "LIVE_IDENTITY_CHANGED")
                with self.assertRaises(LiveRefusal):
                    runs.logs(self.root, self.run_id)
                self.assertFalse(any(call[0] in ("run", "start", "logs") for call in calls))
                self.assertEqual(runs._active(self.root), self.run_id)

    def test_valid_retained_runner_reuses_identity_and_logs_by_immutable_id(self):
        self.launch_record()
        calls = []
        with patch.object(runs, "_docker", side_effect=self.docker_view(self.inspected(), calls)):
            self.assertEqual(runs.launch(self.root, self.run_id, self.credentials, "run", scope=self.scope)["write_status"], "replayed")
            self.assertEqual(runs.logs(self.root, self.run_id)["lines"], ["retained log"])
        self.assertIn(("logs", "--tail", "200", "c" * 64), calls)

    def test_wrong_stopped_runner_mount_cannot_release_account(self):
        self.launch_record()
        state.append(self.directory / "out" / "events.jsonl", "clean_stop", self.run_id)
        resources = self.inspected(running=False)
        resources[("container", "runner")]["Mounts"][0]["Source"] = "/unrelated-output"
        with patch.object(runs, "_docker", side_effect=self.docker_view(resources, [])):
            with self.assertRaises(LiveRefusal) as caught:
                runs.status(self.root, self.run_id)
        self.assertEqual(caught.exception.code, "LIVE_IDENTITY_CHANGED")
        self.assertEqual(runs._active(self.root), self.run_id)

    def test_stopped_egress_identity_verified_before_start(self):
        names = runs._names(self.root, self.run_id)
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
            with self.subTest(changed=changed), patch.object(runs, "_docker", side_effect=self.docker_view(resources, [])), \
                    patch.object(runs, "_checked", side_effect=AssertionError("unrelated container must not start")):
                with self.assertRaises(LiveRefusal) as caught:
                    runs._network(self.root, self.run_id, self.directory, self.manifest)
                self.assertEqual(caught.exception.code, "LIVE_IDENTITY_CHANGED")
        with patch.object(runs, "_docker", side_effect=self.docker_view(base, [])), patch.object(runs, "_checked") as action:
            runs._network(self.root, self.run_id, self.directory, self.manifest)
        action.assert_called_once_with("start", "c" * 64)

    def test_changed_network_labels_and_missing_retained_resources_are_not_recreated(self):
        names = runs._names(self.root, self.run_id)
        resources = self.inspected("egress", running=False)
        resources[("network", names["network"])]["Labels"]["trade.live.run"] = "foreign-run"
        with patch.object(runs, "_docker", side_effect=self.docker_view(resources, [])), \
                patch.object(runs, "_checked", side_effect=AssertionError("no replacement")):
            with self.assertRaises(LiveRefusal):
                runs._network(self.root, self.run_id, self.directory, self.manifest)
        for resource in ("network", "egress"):
            resources = self.inspected("egress")
            state.append(self.directory / "lifecycle.jsonl", "network_created", self.run_id, network_id="d" * 64)
            state.append(self.directory / "lifecycle.jsonl", "egress_created", self.run_id, container_id="c" * 64)
            resources.pop(("network", names["network"]) if resource == "network" else ("container", names["egress"]))
            with self.subTest(resource=resource), patch.object(runs, "_docker", side_effect=self.docker_view(resources, [])), \
                    patch.object(runs, "_checked", side_effect=AssertionError("no replacement")):
                with self.assertRaises(LiveRefusal) as caught:
                    runs._network(self.root, self.run_id, self.directory, self.manifest)
                self.assertEqual(caught.exception.code, "LIVE_IDENTITY_CHANGED")

    def test_fresh_egress_is_verified_and_bound_after_creation(self):
        names = runs._names(self.root, self.run_id)
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
        with patch.object(runs, "_docker", side_effect=self.docker_view(resources, [])), \
                patch.object(runs, "_checked", side_effect=action):
            runs._network(self.root, self.run_id, self.directory, self.manifest)
        self.assertEqual(len(actions), 2)
        self.assertEqual(runs._host_events(self.directory)[-1]["container_id"], "c" * 64)

    def test_fresh_runner_is_verified_and_its_actual_id_is_retained(self):
        names = runs._names(self.root, self.run_id)
        resources = self.inspected(mode="preflight")
        name = names["network"] + "-preflight-1"
        actual = resources.pop(("container", "runner"))
        actual["Name"] = "/" + name
        resources[("container", name)] = actual
        with patch.object(runs, "_docker", side_effect=self.docker_view(resources, [])), \
                patch.object(runs, "_network", return_value=names), patch.object(runs, "_checked", return_value="c" * 64):
            self.key_limits.return_value = ["this API key has no IP restriction"]
            launched = runs.launch(self.root, self.run_id, self.credentials, "preflight", scope=self.scope)
            self.assertEqual(launched["state"], "starting")
            self.assertEqual(launched["warnings"], ["this API key has no IP restriction"])
        request, started = runs._host_events(self.directory)[-2:]
        self.assertEqual(request["credentials_path"], str(self.credentials))
        self.assertEqual(started["container_id"], "c" * 64)

    def test_unknown_inspect_failure_cannot_be_treated_as_missing(self):
        result = subprocess.CompletedProcess([], 1, "", "Cannot connect to the Docker daemon")
        with patch.object(runs, "_docker", return_value=result):
            with self.assertRaises(LiveRefusal) as caught:
                runs._inspect("container", "runner")
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
        names = runs._names(self.root, self.run_id)
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
        with patch.object(runs, "_docker", side_effect=host):
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
        with patch.object(runs, "_docker", side_effect=AssertionError("logs must not read Docker")):
            self.assertEqual(runs.logs(self.root, self.run_id)["lines"], [f"log of {'c' * 64}"])

    def test_an_unresolved_run_keeps_everything(self):
        host = self.host_for(exit_code=137, clean=False)
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
        names = runs._names(self.root, self.run_id)
        with patch.object(runs, "_docker", side_effect=host):
            runs._network(self.root, self.run_id, self.directory, self.manifest)
        self.assertIn(names["egress"], host.containers)
        self.status(host)
        self.assertEqual(set(host.containers), set())
        self.assertEqual(runs._since_removal(self.directory), [])
        with patch.object(runs, "_docker", side_effect=host):
            runs._network(self.root, self.run_id, self.directory, self.manifest)
        self.assertIn(names["egress"], host.containers)

    def test_a_start_finishes_a_removal_cut_short_before_it_takes_the_slot(self):
        host = self.host_for(mode="preflight", clean=False, armed=False)
        host.fail.add("rm")
        self.status(host)
        self.assertTrue(host.containers)
        host.fail.add("rm")
        with patch.object(runs, "_docker", side_effect=host), self.assertRaises(LiveRefusal) as caught:
            runs.launch(self.root, self.run_id, self.credentials, "run", scope=self.scope)
        self.assertEqual(caught.exception.code, "LIVE_DOCKER_UNAVAILABLE")
        self.assertIsNone(runs._active(self.root))

        class Reached(Exception):
            pass

        def reached(*args):
            self.assertEqual(set(host.containers), set())
            raise Reached

        with patch.object(runs, "_docker", side_effect=host), patch.object(runs, "_network", side_effect=reached), \
                self.assertRaises(Reached):
            runs.launch(self.root, self.run_id, self.credentials, "run", scope=self.scope)

    def test_a_start_keeps_what_a_failed_start_created_after_the_removal(self):
        host = self.host_for(mode="preflight", clean=False, armed=False)
        self.status(host)
        names = runs._names(self.root, self.run_id)
        with patch.object(runs, "_docker", side_effect=host):
            runs._network(self.root, self.run_id, self.directory, self.manifest)
        kept = set(host.containers)
        self.assertIn(names["egress"], kept)

        class Reached(Exception):
            pass

        def reached(*args):
            self.assertEqual(set(host.containers), kept)
            raise Reached

        with patch.object(runs, "_docker", side_effect=host), patch.object(runs, "_network", side_effect=reached), \
                self.assertRaises(Reached):
            runs.launch(self.root, self.run_id, self.credentials, "run", scope=self.scope)

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
        with patch.object(runs, "_docker", side_effect=host):
            for mode, code in (("reconcile", "LIVE_RUN_MISSING"), ("preflight", "LIVE_RUN_MISSING"),
                               ("run", "LIVE_RESTART_REQUIRES_RECONCILIATION")):
                with self.assertRaises(LiveRefusal) as caught:
                    runs.launch(self.root, self.run_id, self.credentials, mode, scope=self.scope)
                self.assertEqual(caught.exception.code, code)
        self.assertIsNone(runs._active(self.root))
        self.assertEqual(set(host.networks), {"bridge"})

    def test_a_run_that_only_preflighted_gets_new_resources_when_it_starts(self):
        host = self.host_for(mode="preflight", clean=False, armed=False)
        self.assertEqual(self.status(host)["state"], "preflight_complete")
        self.assertEqual(self.status(host)["state"], "preflight_complete")
        self.assertEqual(set(host.containers), set())
        names = runs._names(self.root, self.run_id)
        with patch.object(runs, "_docker", side_effect=host):
            runs._network(self.root, self.run_id, self.directory, self.manifest)
        self.assertEqual(set(host.containers), {names["egress"]})
        self.assertIn(names["network"], host.networks)
        created = [row["event"] for row in runs._since_removal(self.directory)]
        self.assertEqual(created, ["network_created", "egress_created"])

    def test_a_preflight_on_a_run_that_holds_the_slot_keeps_everything(self):
        host = self.host_for(mode="preflight", clean=False)
        state.append(self.root / "account.jsonl", "reserved", self.run_id)
        self.assertEqual(self.status(host)["account_owned"], True)
        with patch.object(runs, "_docker", side_effect=host):
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
        del host.containers[runs._names(self.root, self.run_id)["egress"]]
        self.assertEqual(self.status(host)["state"], "clean_stopped")
        self.assertEqual(set(host.containers), set())
        self.assertEqual(runs._recycled(self.directory)["exit_code"], 0)

    def test_starting_another_run_recycles_an_ended_one_and_leaves_an_unresolved_one(self):
        host = self.host_for()
        state.append(self.root / "account.jsonl", "released", self.run_id, reason="native_and_venue_flat")
        with patch.object(runs, "_docker", side_effect=host):
            runs._recycle_others(self.root, "probe-two")
        self.assertEqual(set(host.containers), set())

    def test_starting_another_run_leaves_a_run_that_holds_the_slot(self):
        host = self.host_for(exit_code=137, clean=False)
        with patch.object(runs, "_docker", side_effect=host):
            runs._recycle_others(self.root, "probe-two")
        self.assertEqual(self.removals(host), [])

    def test_starting_another_run_leaves_a_run_still_in_preflight(self):
        host = self.host_for(mode="preflight", clean=False, armed=False)
        host.containers[self.runner]["State"] = {"Running": True, "Status": "running", "ExitCode": 0}
        with patch.object(runs, "_docker", side_effect=host):
            runs._recycle_others(self.root, "probe-two")
        self.assertEqual(self.removals(host), [])

    def test_a_host_that_cannot_answer_does_not_stop_a_start(self):
        result = subprocess.CompletedProcess([], 1, "", "Cannot connect to the Docker daemon")
        with patch.object(runs, "_docker", return_value=result):
            runs._recycle_others(self.root, self.run_id)


if __name__ == "__main__":
    unittest.main()
