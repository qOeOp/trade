"""If this fails, a preliminary comparison writes into the market directory, fetches minutes the market already
holds, misses those it lacks, or waits out Binance's rate limits instead of stopping (replay.preliminary,
market.sources)."""

from __future__ import annotations

from datetime import date
from decimal import Decimal
import hashlib
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

import numpy as np

from market import read, sources
from replay import preliminary
from shared.errors import Refusal
from tests.helpers import refused
from tests.market import directory

DAY_MS = int(np.datetime64("2026-11-01T00:00:00", "ms").astype(np.int64))
MINUTE = 60_000
SCALE = 10**8


def stored(minutes: int, volume: int = 5) -> dict:
    opens = np.arange(minutes, dtype=np.int64) * MINUTE + DAY_MS
    price = np.full(minutes, 100 * SCALE, np.int64)
    return {"ts_open": opens, "open": price, "high": price, "low": price, "close": price,
            "volume": np.full(minutes, volume * SCALE, np.int64)}


def rest_rows(price_type, symbol, interval, start_ms, end_ms, now_ms=None, patient=True):
    assert patient is False
    return [(at, "101.0", "101.0", "101.0", "101.0", "0" if price_type == "MARK" else "2", at + MINUTE - 1, "0")
            for at in range(start_ms, end_ms, MINUTE)]


def digests(root: Path) -> dict[str, str]:
    return {str(path.relative_to(root)): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in sorted(root.rglob("*")) if path.is_file()}


class Overlay(unittest.TestCase):
    def setUp(self):
        self.market = {"name": "market", "holds": "market", **directory.directory(self.addCleanup)}
        directory.seed(self.market, month="2026-11", through="2026-11-02",
                       terms=[("BTCUSDT", {"price_increment": "0.1", "size_increment": "0.001"})],
                       bars={("BTCUSDT", kind): stored(10, 5 if kind == "LAST" else 0) for kind in ("LAST", "MARK")},
                       funding={"BTCUSDT": [(DAY_MS, Decimal("0.0001"))]},
                       members=[(date(2026, 11, 1), "BTCUSDT"), (date(2026, 12, 1), "BTCUSDT")])
        self.before = digests(Path(self.market["root"]))

    def test_rest_adds_only_what_the_market_lacks_and_the_market_is_left_as_it_was(self):
        asked = []

        def klines(*args, **kwargs):
            asked.append(args[0:1] + args[3:5])
            return rest_rows(*args, **kwargs)
        with tempfile.TemporaryDirectory() as temporary, \
                mock.patch.object(sources, "rest_klines", klines), \
                mock.patch.object(sources, "rest_funding", return_value=[(DAY_MS + 8 * 60 * MINUTE + 3, "0.0002")]):
            root = Path(temporary) / "market"
            profile, fetched = preliminary.overlay(self.market, ["BTCUSDT"], (DAY_MS + 5 * MINUTE) * 10**6,
                                                   (DAY_MS + 9 * 60 * MINUTE) * 10**6, False, root)
            self.assertEqual(asked, [("LAST", DAY_MS + 10 * MINUTE, DAY_MS + 540 * MINUTE),
                                     ("MARK", DAY_MS + 10 * MINUTE, DAY_MS + 540 * MINUTE)])
            self.assertEqual(fetched["fetched"]["BTCUSDT"]["LAST"]["bars"], 530)
            self.assertEqual((fetched["data_source"], profile["root"], profile["name"]), ("rest", str(root), "market-rest"))
            bars = read.stored_bars(profile, None, "BTCUSDT", "LAST", "1m", "2026-11-01T00:05:00Z",
                                    "2026-11-01T09:00:00Z", None)
            self.assertEqual(bars["bars"]["count"], 535)
            self.assertEqual([row[1] for row in bars["funding"]["rows"]], ["0.0002"])
            self.assertTrue((root / "instrument.parquet").is_symlink())
            self.assertFalse((root / "bar" / "2026-11.parquet").is_symlink())
        self.assertEqual(digests(Path(self.market["root"])), self.before)

    def test_a_contract_the_market_holds_through_the_window_asks_rest_for_nothing(self):
        with tempfile.TemporaryDirectory() as temporary, \
                mock.patch.object(sources, "rest_klines", side_effect=AssertionError("asked")), \
                mock.patch.object(sources, "rest_funding", return_value=[]):
            _, fetched = preliminary.overlay(self.market, ["BTCUSDT"], DAY_MS * 10**6, (DAY_MS + 10 * MINUTE) * 10**6,
                                             False, Path(temporary) / "market")
        self.assertEqual(fetched["fetched"]["BTCUSDT"]["LAST"], {"from": None, "bars": 0})


class Limits(unittest.TestCase):
    def test_an_impatient_request_stops_at_a_rate_limit_without_waiting(self):
        response = SimpleNamespace(status=429, headers={"Retry-After": "60"}, read=lambda *_: b"", will_close=False)
        connection = SimpleNamespace(request=lambda *args, **kwargs: None, getresponse=lambda: response)
        with mock.patch.object(sources, "_connection", return_value=connection), \
                mock.patch.object(sources.time, "sleep", side_effect=AssertionError("waited")):
            self.assertEqual(refused(sources._get, f"{sources.REST}/fapi/v1/klines", patient=False,
                                     error=Refusal).code,
                             "SOURCE_UNREACHABLE")


if __name__ == "__main__":
    unittest.main()
