"""The drawdown brake and cash floor (engine.live_brake), without a venue or a native node."""

import copy
from decimal import Decimal
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

from engine import live, live_brake, live_commands as commands
from engine.live_errors import LiveRefusal
from tests.engine.test_live_gate import manifest
from tests.engine.test_live_venue import fixture


class BrakeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.output = Path(self.temp.name)
        self.snapshot, _ = fixture()
        self.session = live.Session(manifest(self.snapshot["credential_binding"]), self.output, "run",
                                    account_verified=True)
        self.session.node = mock.Mock()

    def read(self, wallet, unrealized="0"):
        snapshot = copy.deepcopy(self.snapshot)
        snapshot["account"]["assets"][0].update(walletBalance=wallet, unrealizedProfit=unrealized)
        return snapshot

    def events(self, name):
        return [row for row in map(json.loads, (self.output / "events.jsonl").read_text().splitlines())
                if row["event"] == name]

    def test_the_cash_floor_is_85_percent_of_the_wallet_at_the_first_arming(self):
        live_brake.arm(self.session, self.read("117.65", "-3"))
        self.assertEqual(self.session.brake.budget, Decimal("100.00"))  # 99.9525 would round up: down to the cent
        self.assertEqual(self.session.brake.peak, Decimal("114.65"))
        for wallet in ("0", "-1", "NaN"):
            with self.subTest(wallet=wallet), self.assertRaises(LiveRefusal):
                live_brake.budget(self.read(wallet))

    def test_a_start_again_keeps_the_first_cash_floor_and_the_highest_equity(self):
        (self.output / "preflight-1.json").write_text(json.dumps(self.read("100")))
        (self.output / "armed.json").write_text(json.dumps({"run_id": "gate", "observed_ns": 1,
                                                            "observation": "preflight-1.json"}))
        self.session.event("equity_peak", equity="130", observed_ns=2)
        self.session.event("equity_peak", equity="125", observed_ns=3)  # not the highest: a later start ignores it
        resumed = live.Session(self.session.manifest, self.output, "run")
        live_brake.resume(resumed, self.output)
        self.assertEqual((resumed.brake.budget, resumed.brake.peak), (Decimal("85.00"), Decimal("130")))
        live_brake.observe(resumed, self.read("110.51"), 0.0)
        self.assertFalse(resumed.stopping)
        live_brake.observe(resumed, self.read("110.50"), 0.0)  # 15% below 130
        self.assertTrue(resumed.stopping)

    def test_a_tighter_brake_stops_sooner(self):
        live_brake.arm(self.session, self.read("100"))
        self.session.manifest["config"]["drawdown_brake"] = "0.05"
        live_brake.observe(self.session, self.read("100", "-5"), 0.0)
        self.assertEqual([row["reason"] for row in self.events("stopping")], ["drawdown"])

    def test_reads_every_15_seconds_and_a_position_unread_for_a_minute_fails_the_run(self):
        live_brake.arm(self.session, self.read("100"))
        with mock.patch.object(commands, "observe_account", return_value=object()) as observe, \
                mock.patch.object(commands, "observed_account", side_effect=LiveRefusal("LIVE_ACCOUNT_UNAVAILABLE", "x")):
            for now in (0, 1, 15, 16, 30, 31, 45, 46):
                live_brake.tick(self.session, True, now)
            self.assertEqual(observe.call_count, 4)  # each failed read is only that read lost
            self.assertFalse(self.session.stopping)
            live_brake.tick(self.session, False, 70)  # flat: nothing to protect
            self.assertFalse(self.session.stopping)
            live_brake.tick(self.session, True, 70)
        self.assertTrue(self.session.stopping)
        self.assertTrue(self.session.failed)
        self.assertEqual([row["reason"] for row in self.events("stopping")], ["drawdown_unverified"])

    def test_a_completed_read_is_judged_and_the_next_one_waits_its_turn(self):
        live_brake.arm(self.session, self.read("100"))
        with mock.patch.object(commands, "observe_account", return_value=object()) as observe, \
                mock.patch.object(commands, "observed_account", return_value=self.read("100", "-15")):
            live_brake.tick(self.session, True, 0)
            live_brake.tick(self.session, True, 1)
        self.assertEqual(observe.call_count, 1)
        self.assertTrue(self.session.stopping)
        self.assertFalse(self.session.failed)


class ClockTests(unittest.TestCase):
    def test_an_entry_and_a_comparison_read_the_venues_time_and_the_other_reads_do_not(self):
        reader = mock.Mock()
        reader.snapshot.side_effect = lambda symbols: {}
        reader.clock.return_value = ["sample"]
        for purpose, clocked in (("entry", True), ("compare", True), ("brake", False), ("connected", False)):
            with self.subTest(purpose):
                reader.clock.reset_mock()
                result = commands.observe_account(reader, ("BTCUSDT",), purpose).result.result(timeout=2)
                self.assertEqual(reader.clock.called, clocked)
                self.assertEqual("clock" in result, clocked)
