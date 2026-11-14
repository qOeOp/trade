"""One profile structure: `holds` says research, paper or market, `kind` the lifecycle; the old market format is refused."""

import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock

from ledger import db
from shared import profiles
from shared.errors import Refusal
from tests.helpers import refused


class ProfileTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.home = Path(temp.name)
        patcher = mock.patch.dict(os.environ, {"TRADE_LEDGER_HOME": str(self.home)})
        patcher.start()
        self.addCleanup(patcher.stop)

    def write(self, name: str, value: dict) -> None:
        (self.home / f"{name}.json").write_text(json.dumps(value))

    def test_markets_and_ledgers_are_told_apart_by_what_they_hold(self):
        ledger = db.LedgerProfile(name="research", database="research", service_root=Path("/srv"), kind="active")
        self.assertEqual(ledger.as_json()["holds"], "research")
        self.write("research", ledger.as_json())
        self.write("market", {"name": "market", "holds": "market", "kind": "active", "root": "/srv/market"})
        self.write("copy", {"name": "copy", "holds": "market", "kind": "isolated", "root": "/srv/copy"})
        self.assertEqual(sorted(db.profiles()), ["research"])
        self.assertEqual(profiles.market(None)["root"], "/srv/market")
        self.assertEqual(profiles.market("copy")["kind"], "isolated")
        self.assertEqual(refused(profiles.market, "research").code, "LEDGER_KIND")

    def test_a_market_profile_in_the_old_format_is_refused_with_its_rewrite(self):
        self.write("market", {"name": "market", "kind": "market", "role": "active", "root": "/srv/market"})
        with self.assertRaises(Refusal) as raised:
            profiles.market("market")
        self.assertEqual(raised.exception.code, "LEDGER_KIND")
        self.assertIn('"holds": "market"', str(raised.exception))
        with self.assertRaises(Refusal):  # nor is it the active market
            profiles.market(None)
