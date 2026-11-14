"""Live runs a candidate only with a replay of it behind the run (R2, user 2026-11-12): preparation refuses until the
ledger holds a completed, audited replay of that source on Live's instruments in bars, inside a window its research
already saw, by the replay code of the execution image, and records it; the runner then needs one that started near
the USDT wallet. Throwaway Dolt only."""

from decimal import Decimal
import hashlib
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from engine.live_errors import LiveRefusal
from engine.live_venue import EVIDENCE_TOLERANCE, require_evidence
from ledger import db
from live import control, runs, state
from tests.ledger.dolt import BINARY, RUNTIME, SKIP
from tests.live.authority_fixture import install, prepare
from tests.live.test_runs import IDENTITY, LiveFixture
from tests.ledger.dolt import source
from tests.registration.world import World, capture
from tests.helpers import refused

CODE = {"source_files_sha256": {"run_source_sha256": "1" * 64}, "audit_source_sha256": "2" * 64,
        "dependency_lock_sha256": "3" * 64}


def wallet(balance: str) -> dict:
    return {"account": {"assets": [{"asset": "USDT", "walletBalance": balance}]}}


@unittest.skipUnless(BINARY, SKIP)
class ReplayEvidenceTests(LiveFixture):
    PATCH_EVIDENCE = False

    @classmethod
    def setUpClass(cls):
        cls.world = World("live-evidence")
        cls.addClassCleanup(cls.world.close)
        cls.candidate = {"candidate": "rsi@1", "source": source("root")}
        review = cls.world.prechecked(cls.candidate["source"])  # a precheck is no evidence
        registered = cls.world.register(cls.world.body(["rsi@1"], {"rsi@1": review}, comparison=None))
        cls.world.research_trial(registered["registration_id"], cls.candidate["source"])  # trades January 2026

    def prepare(self, run_id: str, evidence_code: dict = CODE) -> dict:
        """Preparation at the ledger's head; the execution image runs CODE, every replay image `evidence_code`."""
        universe = self.root / f"{run_id}-universe.json"
        universe.write_text("{}")
        described = lambda identity, _: CODE if identity["image_ref"] == IDENTITY["image_ref"] else evidence_code
        with patch("engine.load.read_universe"), \
                patch.object(runs.image, "resolve",
                             side_effect=lambda ref: IDENTITY if ref == IDENTITY["image_ref"] else {"image_ref": ref}), \
                patch.object(runs.image, "inspect_runtime", side_effect=described), \
                patch.object(runs.image, "require_main_build"):
            return prepare(self.root, run_id, self.world.profile, db.head_commit(self.world.conn),
                           self.candidate["candidate"], ["AAAUSDT"], universe, self.credentials, IDENTITY["image_ref"],
                           scope=self.scope, drawdown_brake="0.15", duration_seconds=60,
                           memory="2g", leverage="3", market_root=Path("unused"), credential_ref="a" * 32)

    def read_ahead(self) -> list[dict]:
        """runs.replay_evidence, which the page shows before preparing, on the same images as prepare."""
        with patch.object(runs.image, "resolve",
                          side_effect=lambda ref: IDENTITY if ref == IDENTITY["image_ref"] else {"image_ref": ref}), \
                patch.object(runs.image, "inspect_runtime", side_effect=lambda identity, _: CODE):
            return runs.replay_evidence(self.world.profile, db.head_commit(self.world.conn),
                                        hashlib.sha256(self.candidate["source"]).hexdigest(), ["AAAUSDT"], IDENTITY["image_ref"])

    def refused(self, run_id: str, **options) -> str:
        with self.assertRaises(LiveRefusal) as caught:
            self.prepare(run_id, **options)
        self.assertFalse((state.directory(self.root, run_id) / "inputs" / "manifest.json").exists())
        return caught.exception.code

    def explore(self, symbols=("AAAUSDT",), days=2, **capture_options) -> int:
        """An explore trading `days` days from 2026-01-06."""
        data = self.candidate["source"]
        trial_id = self.world.open_precheck(data, {"symbols": list(symbols)}, purpose="explore", days=days)
        capture(self.world.conn, trial_id, data, purpose="explore", fingerprint={"fills": {"sha256": "f" * 64}},
                **capture_options)
        return trial_id

    def test_preflight_is_refused_without_evidence_and_accepted_with_it(self):
        self.assertEqual(self.refused("no-replay"), "LIVE_EVIDENCE_MISSING")
        self.assertEqual(self.read_ahead(), [])
        self.explore(audit_exit=1)  # its audit did not pass
        self.explore(symbols=("BBBUSDT",))  # not Live's instruments
        self.explore(days=40)  # runs past the research window's end: a window research never saw
        self.assertEqual(self.refused("unbacked"), "LIVE_EVIDENCE_MISSING")
        backing = self.explore()
        other_code = {**CODE, "audit_source_sha256": "4" * 64}
        self.assertEqual(self.refused("other-replay-code", evidence_code=other_code), "LIVE_EVIDENCE_MISSING")

        manifest = self.prepare("backed")
        found = {"trial_id": backing, "starting_balance_usdt": "100000", "image_ref": RUNTIME["image_ref"]}
        self.assertEqual(manifest["evidence"], [found])
        self.assertEqual(self.read_ahead(), [found], "the page shows what preparation records")
        review = runs.review(self.world.profile, db.head_commit(self.world.conn), manifest)
        self.assertEqual(review["evidence"], [found])

        # The runner compares that balance with the USDT wallet the venue reports when it starts.
        near = Decimal("100000") * (1 + EVIDENCE_TOLERANCE)
        self.assertEqual(require_evidence(wallet(str(near)), manifest), found)
        self.assertEqual(refused(require_evidence, wallet("90"), manifest,
                                 error=LiveRefusal).code, "LIVE_EVIDENCE_BALANCE")


@unittest.skipUnless(BINARY, SKIP)
class CandidateReadTests(unittest.TestCase):
    """control.candidate: the page's candidate at the research head and its last research replay's contracts, the
    ones Paper offers (ledger.paper.last_research_symbols)."""

    def test_the_page_reads_the_candidate_at_the_head_with_its_last_research_contracts(self):
        world = World("live-candidate")
        self.addCleanup(world.close)
        data = source("root")
        config = SimpleNamespace(research_ledger=None)
        registered = world.register(world.body(["rsi@1"], {"rsi@1": world.prechecked(data)}, comparison=None))
        trial_id = world.research_trial(registered["registration_id"], data)
        with patch.object(control, "_profile", return_value=world.profile):
            self.assertIsNone(control.candidate(config, "rsi@1")["last_symbols"], "a research trial that never ran")
            world.seal_run(trial_id)
            found = control.candidate(config, "rsi@1")
            with self.assertRaises(LiveRefusal) as caught:
                control.candidate(config, "rsi@99")
        self.assertEqual(found, {"candidate": "rsi@1", "research_at": db.head_commit(world.conn),
                                 "source_sha256": hashlib.sha256(data).hexdigest(),
                                 "entry_class": "Fixture", "last_symbols": ["AAAUSDT", "BBBUSDT"]})
        self.assertEqual(caught.exception.code, "LIVE_SOURCE_MISSING")


class EvidenceReadAheadTests(unittest.TestCase):
    """control.Evidence: replay evidence of what the page asked about, read in the background, display only."""

    KEY = ("a" * 32, "b" * 64, ("BTCUSDT",))
    OTHER = ("a" * 32, "b" * 64, ("BTCUSDT", "ETHUSDT"))

    def setUp(self):
        self.root = Path(self.enterContext(__import__("tempfile").TemporaryDirectory()))
        self.config = install(self, self.root).config

    def test_the_listing_names_no_candidate_or_contracts_and_offers_the_run_defaults(self):
        listing = control.listing(self.config)
        self.assertNotIn("sources", listing)
        self.assertEqual(listing["defaults"], {"duration_seconds": None, "leverage": "3", "drawdown_brake": "0.15"})

    def test_only_asked_keys_are_read_checking_then_the_answer_and_only_an_unknown_one_again(self):
        evidence = control.Evidence()
        with patch.object(control, "_profile"), patch.object(runs, "replay_evidence") as read:
            evidence.check(self.config)
        read.assert_not_called()  # nothing asked, nothing read
        self.assertEqual(evidence.view(self.KEY), {"state": "checking", "replays": [], "tolerance": str(EVIDENCE_TOLERANCE)})
        with patch.object(control, "_profile"), \
                patch.object(runs, "replay_evidence", side_effect=RuntimeError("image unreadable")) as read:
            evidence.check(self.config)
            evidence.check(self.config)  # an unknown answer waits before it is read again
        self.assertEqual(read.call_args_list, [unittest.mock.call(unittest.mock.ANY, "a" * 32, "b" * 64, ["BTCUSDT"],
                                                                  self.config.runtime)])
        self.assertEqual(evidence.view(self.KEY)["state"], "unknown")
        self.assertEqual(evidence.view(self.OTHER)["state"], "checking", "other contracts are another key")
        found = [{"trial_id": 7, "starting_balance_usdt": "1000", "image_ref": "ignored"}]
        with patch.object(control, "_profile"), patch.object(control.Evidence, "RETRY_NS", 0), \
                patch.object(runs, "replay_evidence", return_value=found) as read:
            evidence.check(self.config)
            evidence.check(self.config)  # found stays: the research commit and image are fixed
        self.assertEqual([call.args[3] for call in read.call_args_list], [["BTCUSDT"], ["BTCUSDT", "ETHUSDT"]])
        self.assertEqual(evidence.view(self.KEY), {"state": "found", "tolerance": str(EVIDENCE_TOLERANCE),
                                                   "replays": [{"trial_id": 7, "starting_balance_usdt": "1000"}]})

    def test_the_most_recently_asked_keys_are_kept(self):
        evidence = control.Evidence()
        keys = [("a" * 32, "b" * 64, (f"K{index}USDT",)) for index in range(control.Evidence.LIMIT + 1)]
        for key in keys:
            evidence.view(key)
        with patch.object(control, "_profile"), patch.object(runs, "replay_evidence", return_value=[]) as read:
            evidence.check(self.config)
        self.assertEqual(read.call_count, control.Evidence.LIMIT)
        self.assertNotIn(keys[0][2], [tuple(call.args[3]) for call in read.call_args_list])
