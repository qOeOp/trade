"""What market.validate_lifecycle refuses of a manifest's sources, instrument IDs and event clocks."""

import unittest

from market import lifecycle
from tests.helpers import assert_refused


DAY, AAA, BBB = "2025-03-01", "AAAUSDT-E1-PERP.BINANCE", "BBBUSDT-E1-PERP.BINANCE"
FILES = {"notice.txt": b"the exchange notice", "../notice.txt": b"the exchange notice"}


def status(action: str, at: int, instrument_id: str = AAA) -> dict:
    return {"type": "InstrumentStatus", "instrument_id": instrument_id, "action": action, "ts_event": at, "ts_init": at,
            "reason": "delisting", "trading_event": None, "is_trading": None, "is_quoting": None,
            "is_short_sell_restricted": None}


def episode(symbol: str = "AAAUSDT", instrument_id: str = AAA, sources=("notice.txt",), events=()) -> dict:
    return {"symbol": symbol, "instrument_id": instrument_id, "start_ns": 0, "sources": list(sources),
            "events": list(events)}


def manifest(*episodes: dict) -> dict:
    return {"format": lifecycle.FORMAT, "market_day": DAY, "episodes": list(episodes)}


class GuardTests(unittest.TestCase):
    def test_a_manifest_that_keeps_every_rule_is_taken(self):
        ended = episode(events=[status("PRE_CLOSE", 5), status("CLOSE", 10)])
        self.assertEqual(lifecycle.validate_lifecycle(manifest(ended, episode("BBBUSDT", BBB)), DAY, FILES),
                         {"AAAUSDT": [ended], "BBBUSDT": [episode("BBBUSDT", BBB)]})

    def test_each_broken_rule_is_refused(self):
        for name, episodes in (
                ("a held source above the bundle", [episode(sources=["../notice.txt"])]),
                ("a terminated instrument ID again", [episode(events=[status("CLOSE", 10)]), episode("BBBUSDT", AAA)]),
                ("a decreasing clock", [episode(events=[status("PRE_CLOSE", 10), status("PRE_CLOSE", 5)])]),
                ("an event after the termination", [episode(events=[status("CLOSE", 5), status("PRE_CLOSE", 10)])])):
            with self.subTest(name):
                assert_refused(self, "LIFECYCLE_INPUT", lifecycle.validate_lifecycle, manifest(*episodes), DAY, FILES)
