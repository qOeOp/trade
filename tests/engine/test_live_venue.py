"""Live admission must fail before a native execution client can submit anything."""
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
from engine.live_venue import BinanceReadOnly, Credentials, read_credentials, require_admission


def fixture():
    credentials = Credentials("test-key", "test-secret")
    snapshot = {
        "observed_ns": time.time_ns(), "credential_binding": credentials.binding,
        "config": {"canTrade": True, "dualSidePosition": False, "multiAssetsMargin": False},
        "account": {"assets": [{"asset": "USDT", "walletBalance": "100", "availableBalance": "100"}]},
        "positions": [], "orders": [], "algo_orders": [],
        "symbols": {"BTCUSDT": {
            "instrument": {"status": "TRADING", "contractType": "PERPETUAL", "marginAsset": "USDT",
                           "filters": [{"filterType": "MIN_NOTIONAL", "notional": "50"},
                                       {"filterType": "LOT_SIZE", "minQty": "0.001"}]},
            "config": [{"symbol": "BTCUSDT", "marginType": "ISOLATED", "leverage": 1, "isAutoAddMargin": False}],
            "mark": {"markPrice": "76000"},
        }},
    }
    manifest = {"symbols": ["BTCUSDT"], "credential_binding": credentials.binding,
                "config": {"budget_usdt": "100", "max_notional_per_order": "150"}}
    return snapshot, manifest


class LiveAdmissionTest(unittest.TestCase):
    def test_current_observed_flat_isolated_account_can_be_admitted(self):
        require_admission(*fixture())

    def test_collateral_modes_and_foreign_orders_are_not_silently_adopted(self):
        base, manifest = fixture()
        changes = [
            ("config", {"canTrade": True, "dualSidePosition": True, "multiAssetsMargin": False}),
            ("config", {"canTrade": True, "dualSidePosition": False, "multiAssetsMargin": True}),
            ("orders", [{"symbol": "ETHUSDT"}]),
            ("algo_orders", [{"symbol": "BTCUSDT"}]),
            ("positions", [{"symbol": "ETHUSDT", "positionAmt": "-0.1"}]),
            ("credential_binding", "other-key"),
            ("observed_ns", time.time_ns() - 60_000_000_000),
        ]
        for key, value in changes:
            with self.subTest(key=key, value=value), self.assertRaises(Refusal):
                require_admission({**base, key: value}, manifest)

    def test_real_usdt_and_minimum_lot_must_fit_budget(self):
        base, manifest = fixture()
        for balance, mark in [("50", "76000"), ("100", "101000")]:
            observation = copy.deepcopy(base)
            observation["account"]["assets"][0]["walletBalance"] = balance
            observation["symbols"]["BTCUSDT"]["mark"]["markPrice"] = mark
            with self.subTest(balance=balance, mark=mark), self.assertRaises(Refusal):
                require_admission(observation, manifest)

    def test_cross_margin_or_leverage_and_missing_fields_fail_closed(self):
        base, manifest = fixture()
        for settings in [[], [{"symbol": "BTCUSDT", "marginType": "CROSSED", "leverage": 50,
                              "isAutoAddMargin": False}]]:
            observation = copy.deepcopy(base)
            observation["symbols"]["BTCUSDT"]["config"] = settings
            with self.assertRaises(Refusal):
                require_admission(observation, manifest)


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
        for path in ["/fapi/v1/order", "/fapi/v1/leverage", "https://evil.invalid/fapi/v3/account"]:
            with self.assertRaises(Refusal):
                client.get(path)

    def test_signed_get_error_never_contains_url_signature_or_credentials(self):
        client = BinanceReadOnly(Credentials("hidden-key", "hidden-secret"))
        seen = []

        def response(request, timeout):
            seen.append(request)
            if request.full_url.endswith("/time"):
                return io.BytesIO(b'{"serverTime":123}')
            raise urllib.error.HTTPError(request.full_url, 401, "hidden-key", {}, io.BytesIO(b"hidden-secret"))

        with patch.object(client.opener, "open", side_effect=response), self.assertRaises(Refusal) as caught:
            client.get("/fapi/v3/account")
        self.assertEqual([request.method for request in seen], ["GET", "GET"])
        self.assertIn("signature=", seen[-1].full_url)
        self.assertNotIn("hidden", str(caught.exception))
        self.assertNotIn("signature", str(caught.exception))


if __name__ == "__main__":
    unittest.main()
