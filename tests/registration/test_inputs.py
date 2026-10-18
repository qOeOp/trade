"""Input identity: path-free export fingerprints, market input export AS OF the pinned commit, and
lifecycle evidence read from the ledger."""

from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

from ledger import evidence
from ledger.errors import Refusal
from registration import inputs, seams
from tests.ledger.dolt import BINARY, MARKET_COMMIT, SKIP
from tests.registration.world import LINE_WINDOW, FakeMarket, World, months_rows, product_write


class FingerprintTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="fp-", dir="/tmp"))
        self.addCleanup(shutil.rmtree, self.root, ignore_errors=True)

    def export(self, name: str, seconds: float) -> dict:
        root = self.root / name / "export"
        (root / "AAAUSDT").mkdir(parents=True)
        (root / "AAAUSDT" / "bars.parquet").write_bytes(b"bars")
        (root / "AAAUSDT" / "export.json").write_text(json.dumps({"symbol": "AAAUSDT", "seconds": seconds}, indent=1))
        membership = self.root / name / "membership.json"
        membership.write_text('{"membership": {}}')
        return {"root": root, "membership_file": membership}

    def test_the_semantic_identity_ignores_location_and_export_time(self):
        first, second = self.export("a", 1.5), self.export("b", 9.0)
        semantic = inputs.export_fingerprint(first, semantic=True)
        self.assertEqual(semantic, inputs.export_fingerprint(second, semantic=True))
        self.assertNotEqual(inputs.export_fingerprint(first, semantic=False)["export_content_sha256"],
                            inputs.export_fingerprint(second, semantic=False)["export_content_sha256"])
        (second["root"] / "AAAUSDT" / "bars.parquet").write_bytes(b"other bars")
        self.assertNotEqual(semantic, inputs.export_fingerprint(second, semantic=True))
        second["membership_file"].write_text('{"membership": {"BBBUSDT": []}}')
        self.assertNotEqual(inputs.export_fingerprint(first, semantic=True),
                            inputs.export_fingerprint({**first, "membership_file": second["membership_file"]},
                                                      semantic=True))

    def test_links_and_a_missing_membership_file_are_refused(self):
        linked = self.export("linked", 1.0)
        os.symlink(linked["root"] / "AAAUSDT" / "bars.parquet", linked["root"] / "AAAUSDT" / "alias.parquet")
        missing = self.export("missing", 1.0)
        missing["membership_file"].unlink()
        moved = self.export("moved", 1.0)
        os.symlink(moved["membership_file"], self.root / "moved" / "link.json")
        for value in (linked, missing, {**moved, "membership_file": self.root / "moved" / "link.json"}):
            with self.subTest(value=value), self.assertRaises(Refusal) as caught:
                inputs.export_fingerprint(value, semantic=True)
            self.assertEqual(caught.exception.code, "EXPORT_CONTENT_INVALID")


class MarketInputTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="mi-", dir="/tmp"))
        self.addCleanup(shutil.rmtree, self.root, ignore_errors=True)
        patcher = patch.object(tempfile, "tempdir", str(self.root))
        patcher.start()
        self.addCleanup(patcher.stop)
        self.market = FakeMarket({MARKET_COMMIT: months_rows(), "e" * 32: [],
                                  "o" * 32: months_rows(months=["2025-06"], symbols=["OLDUSDT"])})

    def call(self, market=None, at=MARKET_COMMIT, selection=None, lifecycle_bundle=None, window=LINE_WINDOW):
        with seams.use(market=lambda profile: profile):
            return inputs.market_inputs(market or self.market, at, window,
                                        {"universe": True} if selection is None else selection,
                                        lifecycle_bundle, True, None)

    def code(self, **kwargs) -> str:
        with self.assertRaises(Refusal) as caught:
            self.call(**kwargs)
        return caught.exception.code

    def test_the_universe_selection_takes_every_member_intersecting_the_trading_window(self):
        exported = self.call()
        identity = exported["identity"]
        self.assertEqual((identity["market_commit"], identity["universe_rule"], identity["symbols"]),
                         (MARKET_COMMIT, "pool-v1", ["AAAUSDT", "BBBUSDT"]))
        self.assertEqual(set(identity["membership"]), {"AAAUSDT", "BBBUSDT"})
        self.assertEqual(json.loads(exported["membership_file"].read_text())["membership"], identity["membership"])
        again = self.call()
        self.assertEqual(again["identity"], identity)
        chosen = self.call(selection={"symbols": ["BBBUSDT"]})["identity"]
        self.assertEqual((chosen["symbols"], list(chosen["membership"])), (["BBBUSDT"], ["BBBUSDT"]))
        self.assertNotEqual(chosen["export_content_sha256"], identity["export_content_sha256"])

    def test_selection_universe_timeframe_and_commit_refusals(self):
        for selection in ({"universe": True, "symbols": ["AAAUSDT"]}, {}, {"symbols": ["AAAUSDT", "AAAUSDT"]},
                          {"symbols": []}, {"universe": False}):
            with self.subTest(selection=selection):
                self.assertEqual(self.code(selection=selection), "SYMBOL_SELECTION_INVALID")
        self.assertEqual(self.code(at="e" * 32), "UNIVERSE_EMPTY")
        self.assertEqual(self.code(at="o" * 32), "UNIVERSE_EMPTY")
        self.assertEqual(self.code(at="x" * 32), "MARKET_COMMIT_UNRESOLVED")
        self.assertEqual(self.code(market=FakeMarket({MARKET_COMMIT: months_rows()}, timeframe="5m")),
                         "EXPORT_TIMEFRAME")


@unittest.skipUnless(BINARY, SKIP)
class LifecycleTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.world = World("lifecycle")
        cls.addClassCleanup(cls.world.close)
        manifest = {"market_commit": MARKET_COMMIT, "episodes": {"AAAUSDT": [{"symbol": "AAAUSDT"}]}}
        product_write(cls.world.conn, "lifecycle_fixture", "lifecycle-" + MARKET_COMMIT,
                      {"lifecycle.json": json.dumps(manifest).encode(), "sources/delisting.html": b"<p>delisted</p>"})
        product_write(cls.world.conn, "lifecycle_fixture", "lifecycle-" + "n" * 32,
                      {"notes.txt": b"no manifest"})
        product_write(cls.world.conn, "lifecycle_fixture", "lifecycle-" + "q" * 32,  # names another commit
                      {"lifecycle.json": json.dumps(manifest).encode()})

    def test_a_lifecycle_bundle_is_validated_against_the_pinned_commit_and_exported(self):
        world = self.world
        episodes, files = inputs.load_lifecycle(world.profile, "lifecycle-" + MARKET_COMMIT, MARKET_COMMIT,
                                                market=world.market)
        self.assertEqual(episodes, {"AAAUSDT": [{"symbol": "AAAUSDT"}]})
        self.assertEqual(files["sources/delisting.html"], b"<p>delisted</p>")
        exported = inputs.market_inputs(world.market, MARKET_COMMIT, LINE_WINDOW, {"universe": True},
                                        "lifecycle-" + MARKET_COMMIT, True, world.profile)
        self.assertEqual(exported["identity"]["lifecycle_bundle"], "lifecycle-" + MARKET_COMMIT)
        self.assertTrue((Path(exported["root"]) / "lifecycle-evidence" / "sources" / "delisting.html").is_file())
        plain = inputs.market_inputs(world.market, MARKET_COMMIT, LINE_WINDOW, {"universe": True}, None, True, None)
        self.assertNotEqual(plain["identity"]["export_content_sha256"], exported["identity"]["export_content_sha256"])

    def test_missing_unbound_or_damaged_lifecycle_evidence_is_refused(self):
        world = self.world
        cases = [("lifecycle-" + "z" * 32, MARKET_COMMIT), ("lifecycle-" + "n" * 32, MARKET_COMMIT),
                 ("lifecycle-" + MARKET_COMMIT, "n" * 32), ("lifecycle-" + "q" * 32, MARKET_COMMIT)]
        for bundle, commit in cases:
            with self.subTest(bundle=bundle, commit=commit), self.assertRaises(Refusal) as caught:
                inputs.load_lifecycle(world.profile.name, bundle, commit, market=world.market)
            self.assertEqual(caught.exception.code, "LIFECYCLE_INPUT")
        real = evidence._fetch

        def altered(conn, bundle, clause):
            head, rows = real(conn, bundle, clause)
            return head, [(path, content + b" ", stored) for path, content, stored in rows]

        with patch.object(evidence, "_fetch", altered), self.assertRaises(Refusal) as caught:
            inputs.load_lifecycle(world.profile, "lifecycle-" + MARKET_COMMIT, MARKET_COMMIT, market=world.market)
        self.assertEqual(caught.exception.code, "LIFECYCLE_INPUT")
        with self.assertRaises(Refusal) as caught:
            inputs.market_inputs(world.market, MARKET_COMMIT, LINE_WINDOW, {"universe": True},
                                 "lifecycle-" + "n" * 32, True, world.profile)
        self.assertEqual(caught.exception.code, "LIFECYCLE_INPUT")


if __name__ == "__main__":
    unittest.main()
