"""Observed account modes and v2 cash must be checked before fresh entry."""
import copy
import io
import json
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch
import urllib.error

from engine.live_errors import LiveRefusal as Refusal
from engine.live_venue import (
    require_clock,
    BinanceReadOnly, Credentials, read_credentials, require_account_mode, require_admission,
)


def fixture():
    credentials = Credentials("test-key", "test-secret")
    snapshot = {
        "observed_ns": time.time_ns(), "credential_binding": credentials.binding,
        "config": {"canTrade": True, "dualSidePosition": True, "multiAssetsMargin": True},
        "account": {"multiAssetsMargin": True, "assets": [
            {"asset": "USDT", "walletBalance": "100", "availableBalance": "199.93889229",
             "marginAvailable": True},
            {"asset": "USDC", "walletBalance": "100", "availableBalance": "199.93889229",
             "marginAvailable": True},
        ]},
        "positions": [], "orders": [], "algo_orders": [],
        "symbols": {"BTCUSDT": {
            "instrument": {"status": "TRADING", "contractType": "PERPETUAL", "marginAsset": "USDT",
                           "filters": [{"filterType": "MIN_NOTIONAL", "notional": "50"},
                                       {"filterType": "LOT_SIZE", "minQty": "0.001"}]},
            "config": [{"symbol": "BTCUSDT", "marginType": "CROSSED", "leverage": 50,
                        "isAutoAddMargin": False}],
            "mark": {"markPrice": "76000"},
        }},
    }
    manifest = {"symbols": ["BTCUSDT"], "credential_binding": credentials.binding,
                "config": {"budget_usdt": "100", "max_notional_per_order": "90", "max_loss_usdt": "10"}}
    return snapshot, manifest


class LiveClockTest(unittest.TestCase):
    def clock(self, sent, received, server_ms=1_000_000):
        ms = 1_000_000
        return {"sent_ns": (server_ms + sent) * ms, "server_ms": server_ms, "received_ns": (server_ms + received) * ms}

    def test_only_a_clock_inside_the_venues_limits_is_admitted(self):
        for samples, code in (
                ([(0, 0)], None), ([(-2499, 999)], None), ([(-2500, 0)], "LIVE_CLOCK"), ([(0, 1000)], "LIVE_CLOCK"),
                ([(-3000, 10), (-20, 10), (-3000, 10)], None),  # One stall in the path is not an offset.
                ([(-10, 3000), (-10, 20)], None),
                ([(-3000, 10), (-2600, 10), (-2500, 10)], "LIVE_CLOCK"),
                ([(-10, 1500), (-10, 1000)], "LIVE_CLOCK")):
            with self.subTest(samples=samples):
                snapshot = {"clock": [self.clock(*sample) for sample in samples]}
                if code is None:
                    require_clock(snapshot)
                else:
                    with self.assertRaises(Refusal) as caught:
                        require_clock(snapshot)
                    self.assertEqual(caught.exception.code, code)

    def test_a_missing_time_is_refused(self):
        for snapshot in ({}, {"clock": []}, {"clock": [{"sent_ns": 1, "received_ns": 2}]},
                         {"clock": [{"sent_ns": 1, "server_ms": None, "received_ns": 2}]}):
            with self.subTest(snapshot), self.assertRaises(Refusal) as caught:
                require_clock(snapshot)
            self.assertEqual(caught.exception.code, "LIVE_ACCOUNT_RESPONSE")

    def test_each_sample_brackets_the_venues_time_with_this_clock(self):
        now = [1_000_000_000]

        def venue(_path):
            now[0] += 100_000_000
            server = now[0] // 1_000_000
            now[0] += 50_000_000
            return {"serverTime": server}

        client = BinanceReadOnly(Credentials("key", "secret"))
        with patch.object(client, "get", side_effect=venue), patch.object(time, "time_ns", side_effect=lambda: now[0]):
            samples = client.clock()
        self.assertEqual(len(samples), 3)
        self.assertEqual(samples[0], {"sent_ns": 1_000_000_000, "server_ms": 1100, "received_ns": 1_150_000_000})

    def test_the_runner_reader_stays_on_futures_and_its_declared_paths(self):
        client = BinanceReadOnly(Credentials("key", "secret"))
        self.assertEqual(client.ORIGIN, "https://fapi.binance.com")
        self.assertEqual({path.split("/")[1] for path in client.PUBLIC | client.PRIVATE}, {"fapi"})
        with self.assertRaises(Refusal) as caught:
            client.get("/sapi/v1/capital/withdraw/apply")
        self.assertEqual(caught.exception.code, "LIVE_READ_PATH")


class LiveAdmissionTest(unittest.TestCase):
    def test_observed_flat_hedge_multiassets_cross_cash_can_be_admitted(self):
        observation, manifest = fixture()
        unchanged = copy.deepcopy(observation)
        require_admission(observation, manifest)
        self.assertEqual(observation, unchanged)

    def test_wrong_account_modes_and_foreign_exposure_are_not_adopted(self):
        base, manifest = fixture()
        changes = [
            ("config", {"canTrade": True, "dualSidePosition": False, "multiAssetsMargin": True}),
            ("config", {"canTrade": True, "dualSidePosition": True, "multiAssetsMargin": False}),
            ("config", {"canTrade": False, "dualSidePosition": True, "multiAssetsMargin": True}),
            ("orders", [{"symbol": "ETHUSDT"}]),
            ("algo_orders", [{"symbol": "BTCUSDT"}]),
            ("positions", [{"symbol": "ETHUSDT", "positionAmt": "-0.1"}]),
            ("credential_binding", "other-key"),
            ("observed_ns", time.time_ns() - 60_000_000_000),
        ]
        for key, value in changes:
            with self.subTest(key=key, value=value), self.assertRaises(Refusal):
                require_admission({**base, key: value}, manifest)

    def test_tiny_usdt_wallet_is_not_replaced_by_shared_collateral_available(self):
        observation, manifest = fixture()
        observation["account"]["assets"][0]["walletBalance"] = "0.01"
        with self.assertRaises(Refusal) as caught:
            require_admission(observation, manifest)
        self.assertEqual(caught.exception.code, "LIVE_FUNDS")

    def test_usdt_available_and_margin_eligibility_are_required(self):
        for available, eligible in [("50", True), ("NaN", True), ("Infinity", True),
                                    ("-1", True), ("199.93889229", False),
                                    ("199.93889229", "true")]:
            observation, manifest = fixture()
            observation["account"]["assets"][0].update(availableBalance=available,
                                                       marginAvailable=eligible)
            with self.subTest(available=available, eligible=eligible), self.assertRaises(Refusal):
                require_admission(observation, manifest)

    def test_all_reported_assets_require_unique_nonempty_names(self):
        for asset in ["USDT", "USDC", "", " ", " USDC", None]:
            observation, manifest = fixture()
            observation["account"]["assets"].append({"asset": asset, "walletBalance": "0"})
            with self.subTest(asset=asset), self.assertRaises(Refusal):
                require_admission(observation, manifest)

    def test_other_asset_nonfinite_or_negative_wallet_refuses_fresh_entry(self):
        for wallet in ["NaN", "sNaN", "Infinity", "-Infinity", "-0.01"]:
            observation, manifest = fixture()
            observation["account"]["assets"][1]["walletBalance"] = wallet
            with self.subTest(wallet=wallet), self.assertRaises(Refusal):
                require_admission(observation, manifest)

    def test_asset_count_is_not_fixed_and_zero_wallet_assets_are_kept(self):
        for count in [0, 1, 12]:
            observation, manifest = fixture()
            observation["account"]["assets"].extend(
                {"asset": f"ASSET{index}", "walletBalance": "0"} for index in range(count)
            )
            with self.subTest(extra_assets=count):
                require_admission(observation, manifest)

    def test_missing_usdt_or_cash_fields_fail_closed(self):
        for key in ["asset", "walletBalance", "availableBalance", "marginAvailable"]:
            observation, manifest = fixture()
            del observation["account"]["assets"][0][key]
            with self.subTest(key=key), self.assertRaises(Refusal):
                require_admission(observation, manifest)
        observation, manifest = fixture()
        observation["account"]["assets"] = observation["account"]["assets"][1:]
        with self.assertRaises(Refusal):
            require_admission(observation, manifest)

    def test_entry_cap_must_fit_three_budgets_and_existing_absolute_limits(self):
        for budget, cap in [("100", "300.01"), ("101", "90"), ("29", "87.01"),
                            ("0", "0"), ("100", "0"), ("NaN", "90"),
                            ("100", "Infinity")]:
            observation, manifest = fixture()
            manifest["config"].update(budget_usdt=budget, max_notional_per_order=cap)
            with self.subTest(budget=budget, cap=cap), self.assertRaises(Refusal) as caught:
                require_admission(observation, manifest)
            self.assertEqual(caught.exception.code, "LIVE_BUDGET")
        observation, manifest = fixture()
        manifest["config"].update(budget_usdt="76", max_notional_per_order="76")
        require_admission(observation, manifest)
        observation, manifest = fixture()
        manifest["config"].update(budget_usdt="100", max_notional_per_order="300")
        require_admission(observation, manifest)

    def test_minimum_notional_and_lot_both_must_fit_the_entry_cap(self):
        for minimum, mark in [("91", "76000"), ("50", "91000")]:
            observation, manifest = fixture()
            details = observation["symbols"]["BTCUSDT"]
            details["instrument"]["filters"][0]["notional"] = minimum
            details["mark"]["markPrice"] = mark
            with self.subTest(minimum=minimum, mark=mark), self.assertRaises(Refusal) as caught:
                require_admission(observation, manifest)
            self.assertEqual(caught.exception.code, "LIVE_MINIMUM_SIZE")
        observation, manifest = fixture()
        manifest["config"].update(budget_usdt="40", max_notional_per_order="95")
        observation["symbols"]["BTCUSDT"]["mark"]["markPrice"] = "91000"
        require_admission(observation, manifest)

    def test_wrong_margin_auto_add_or_missing_settings_fail_closed(self):
        base, manifest = fixture()
        good = base["symbols"]["BTCUSDT"]["config"][0]
        cases = [[], [{**good, "marginType": "ISOLATED"}], [{**good, "symbol": "ETHUSDT"}],
                 [{**good, "isAutoAddMargin": True}], [{**good, "leverage": 0}]]
        for settings in cases:
            observation = copy.deepcopy(base)
            observation["symbols"]["BTCUSDT"]["config"] = settings
            with self.subTest(settings=settings), self.assertRaises(Refusal):
                require_admission(observation, manifest)

    def test_instrument_contract_and_single_symbol_checks_remain(self):
        for key, value in [("status", "PENDING_TRADING"), ("contractType", "CURRENT_QUARTER"),
                           ("marginAsset", "USDC")]:
            observation, manifest = fixture()
            observation["symbols"]["BTCUSDT"]["instrument"][key] = value
            with self.subTest(key=key), self.assertRaises(Refusal):
                require_admission(observation, manifest)
        for symbols in [[], ["BTCUSDT", "ETHUSDT"], ["BTCUSDT", "BTCUSDT"]]:
            observation, manifest = fixture()
            manifest["symbols"] = symbols
            with self.subTest(symbols=symbols), self.assertRaises(Refusal):
                require_admission(observation, manifest)


class AccountModeTest(unittest.TestCase):
    def test_readonly_reconcile_can_observe_losses_positions_orders_and_disabled_trading(self):
        observation, manifest = fixture()
        observation["config"]["canTrade"] = False
        observation["account"]["assets"][0].update(walletBalance="-10", availableBalance="-10",
                                                   marginAvailable=False)
        observation["account"]["assets"][1]["walletBalance"] = "-1"
        observation["positions"] = [{"symbol": "BTCUSDT", "positionAmt": "0.001"}]
        observation["orders"] = [{"symbol": "BTCUSDT"}]
        observation["algo_orders"] = [{"symbol": "BTCUSDT"}]
        require_account_mode(observation, manifest)
        with self.assertRaises(Refusal):
            require_admission(observation, manifest)

    def test_reconcile_still_requires_current_identity_and_account_modes(self):
        for field, value in [("dualSidePosition", False), ("multiAssetsMargin", False)]:
            observation, manifest = fixture()
            observation["config"][field] = value
            with self.subTest(field=field), self.assertRaises(Refusal):
                require_account_mode(observation, manifest)
        observation, manifest = fixture()
        observation["symbols"]["BTCUSDT"]["config"][0]["marginType"] = "ISOLATED"
        with self.assertRaises(Refusal):
            require_account_mode(observation, manifest)
        for key, value in [("credential_binding", "other"), ("observed_ns", 0),
                           ("observed_ns", time.time_ns() + 60_000_000_000)]:
            observation, manifest = fixture()
            observation[key] = value
            with self.subTest(key=key), self.assertRaises(Refusal):
                require_account_mode(observation, manifest)

    def test_existing_thirty_second_observation_boundary_remains(self):
        for age, allowed in [(0, True), (30_000_000_000, True), (30_000_000_001, False), (-1, False)]:
            observation, manifest = fixture()
            observation["observed_ns"] = 100_000_000_000
            with self.subTest(age=age), patch("engine.live_venue.time.time_ns", return_value=100_000_000_000 + age):
                if allowed:
                    require_account_mode(observation, manifest)
                else:
                    with self.assertRaises(Refusal):
                        require_account_mode(observation, manifest)


class ReadOnlyVenueTest(unittest.TestCase):
    def test_named_private_file_and_no_secret_repr(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "credentials.json"
            path.write_text(json.dumps({"api_key": "hidden-key", "api_secret": "hidden-secret"}))
            path.chmod(0o600)
            credentials = read_credentials(path)
            self.assertNotIn("hidden", repr(credentials))
            path.chmod(0o644)
            with self.assertRaises(Refusal):
                read_credentials(path)
            alias = Path(directory) / "alias"
            alias.symlink_to(path)
            with self.assertRaises(Refusal):
                read_credentials(alias)

    def test_get_allowlist_rejects_order_and_configuration_mutations(self):
        client = BinanceReadOnly(Credentials("hidden-key", "hidden-secret"))
        for path in ["/fapi/v1/order", "/fapi/v1/leverage", "/fapi/v3/account",
                     "https://evil.invalid/fapi/v2/account"]:
            with self.assertRaises(Refusal):
                client.get(path)

    def test_snapshot_preserves_the_complete_v2_asset_response(self):
        client = BinanceReadOnly(Credentials("test-key", "test-secret"))
        account = {"multiAssetsMargin": True, "assets": [
            {"asset": "USDT", "walletBalance": "100", "availableBalance": "199.93889229",
             "marginAvailable": True},
            {"asset": "BTC", "walletBalance": "0", "availableBalance": "0",
             "marginAvailable": True},
            {"asset": "USDC", "walletBalance": "100", "availableBalance": "199.93889229",
             "marginAvailable": True},
        ]}
        responses = {"/fapi/v2/account": account, "/fapi/v1/accountConfig": {},
                     "/fapi/v3/positionRisk": [], "/fapi/v1/openOrders": [],
                     "/fapi/v1/openAlgoOrders": [],
                     "/fapi/v1/exchangeInfo": {"symbols": [{"symbol": "BTCUSDT"}]},
                     "/fapi/v1/symbolConfig": [], "/fapi/v1/premiumIndex": {},
                     "/fapi/v1/commissionRate": {}}
        with patch.object(client, "get", side_effect=lambda path, **_: responses[path]) as get:
            snapshot = client.snapshot(["BTCUSDT"])
        self.assertIs(snapshot["account"], account)
        self.assertEqual([row["asset"] for row in snapshot["account"]["assets"]], ["USDT", "BTC", "USDC"])
        self.assertIn("/fapi/v2/account", [call.args[0] for call in get.call_args_list])
        self.assertNotIn("/fapi/v3/account", [call.args[0] for call in get.call_args_list])

    def test_signed_get_error_never_contains_url_signature_or_credentials(self):
        client = BinanceReadOnly(Credentials("hidden-key", "hidden-secret"))
        seen = []

        def response(request, timeout):
            seen.append(request)
            if request.full_url.endswith("/time"):
                return io.BytesIO(b'{"serverTime":123}')
            raise urllib.error.HTTPError(request.full_url, 401, "hidden-key", {}, io.BytesIO(b"hidden-secret"))

        with patch.object(client.opener, "open", side_effect=response), self.assertRaises(Refusal) as caught:
            client.get("/fapi/v2/account")
        self.assertEqual([request.method for request in seen], ["GET", "GET"])
        self.assertIn("signature=", seen[-1].full_url)
        self.assertNotIn("hidden", str(caught.exception))
        self.assertNotIn("signature", str(caught.exception))


if __name__ == "__main__":
    unittest.main()
