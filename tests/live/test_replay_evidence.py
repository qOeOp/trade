"""Live runs a candidate only with a replay of it behind the run (R2, user 2026-11-12): preparation records each
completed, audited replay of that source on Live's instruments in bars, inside a window its research already saw, by the
replay code of the execution image, and a run that records none is refused at its start; the runner then needs one that
started near the USDT wallet. A run without one may still check the account, so the wallet a replay must start near is
read first (G-69, 2026-11-21). Throwaway Dolt only."""

from decimal import Decimal
import hashlib
from pathlib import Path
from types import SimpleNamespace
import time
import unittest
from unittest.mock import patch

from engine.live_errors import LiveRefusal
from engine.live_venue import EVIDENCE_TOLERANCE, require_evidence
from ledger import db
from live import control, runs, state
from tests.ledger.dolt import BINARY, RUNTIME, SKIP
from tests.live.authority_fixture import install, launch, prepare
from tests.live.test_runs import IDENTITY, LiveFixture
from tests.ledger.dolt import source
from tests.registration.world import ACCOUNT, RUNNER_ARGV, World, capture, config
from report import history
from shared.refusals import refuse
from tests.helpers import refused

UNFALSIFIED = runs.admission.unfalsified  # LiveFixture stands it in; the history test below reads the ledger
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

    def prepare(self, run_id: str, evidence_code: dict = CODE, leverage: str = "3", **options) -> dict:
        """Preparation at the ledger's head; the execution image runs CODE, every replay image `evidence_code`."""
        described = lambda identity, _: CODE if identity["image_ref"] == IDENTITY["image_ref"] else evidence_code
        with patch("engine.load.read_universe"), \
                patch.object(runs.image, "resolve",
                             side_effect=lambda ref: IDENTITY if ref == IDENTITY["image_ref"] else {"image_ref": ref}), \
                patch.object(runs.image, "inspect_runtime", side_effect=described), \
                patch.object(runs.image, "require_main_build"):
            return prepare(self.root, run_id, self.world.profile, db.head_commit(self.world.conn),
                           self.candidate["candidate"], ["AAAUSDT"], b"{}", self.credentials, IDENTITY["image_ref"],
                           scope=self.scope, environment="live", drawdown_brake="0.15", duration_seconds=60, memory="2g", leverage=leverage,
                           market_root=Path("unused"), credential_ref="a" * 32, request_id="prepare-" + run_id,
                           **options)

    def read_ahead(self) -> list[dict]:
        """runs.replay_evidence, which the page shows before preparing, on the same images as prepare."""
        with patch.object(runs.image, "resolve",
                          side_effect=lambda ref: IDENTITY if ref == IDENTITY["image_ref"] else {"image_ref": ref}), \
                patch.object(runs.image, "inspect_runtime", side_effect=lambda identity, _: CODE):
            return runs.replay_evidence(self.world.profile, db.head_commit(self.world.conn),
                                        hashlib.sha256(self.candidate["source"]).hexdigest(), ["AAAUSDT"], IDENTITY["image_ref"])

    def refused(self, run_id: str, **options) -> str:
        caught = refused(lambda: self.prepare(run_id, **options), error=LiveRefusal)
        self.assertFalse((state.directory(self.root, run_id) / "inputs" / "manifest.json").exists())
        return caught.code

    def unbacked(self, run_id: str, **options) -> str:
        """Prepared with no replay recorded, then refused at its start, before any key or container; the runner
        refuses it too. Returns the start's refusal code."""
        manifest = self.prepare(run_id, **options)
        self.assertEqual(manifest["evidence"], [])
        self.assertEqual(refused(require_evidence, wallet("100"), manifest, error=LiveRefusal).code, "LIVE_EVIDENCE_MISSING")
        with patch.object(runs, "_bound_credential", side_effect=AssertionError("key read")):
            return refused(launch, self.root, run_id, self.credentials, "run", scope=self.scope, error=LiveRefusal).code

    def explore(self, symbols=("AAAUSDT",), days=2, **capture_options) -> int:
        """An explore trading `days` days from 2026-01-06."""
        data = self.candidate["source"]
        trial_id = self.world.open_precheck(data, {"symbols": list(symbols)}, purpose="explore", days=days)
        capture(self.world.conn, trial_id, data, purpose="explore", fingerprint={"fills": {"sha256": "f" * 64}},
                **capture_options)
        return trial_id

    def test_a_start_is_refused_without_evidence_and_accepted_with_it(self):
        self.assertEqual(self.unbacked("no-replay"), "LIVE_EVIDENCE_MISSING")
        self.assertEqual(self.read_ahead(), [])
        self.explore(audit_exit=1)  # its audit did not pass
        self.explore(symbols=("BBBUSDT",))  # not Live's instruments
        self.explore(days=40)  # runs past the research window's end: a window research never saw
        self.assertEqual(self.unbacked("unbacked"), "LIVE_EVIDENCE_MISSING")
        backing = self.explore()
        other_code = {**CODE, "audit_source_sha256": "4" * 64}
        self.assertEqual(self.unbacked("other-replay-code", evidence_code=other_code), "LIVE_EVIDENCE_MISSING")
        # The replay traded at leverage 3 (its effective configuration): it backs no run at another leverage.
        self.assertEqual(self.unbacked("other-leverage", leverage="5"), "LIVE_EVIDENCE_MISSING")

        manifest = self.prepare("backed")
        found = {"trial_id": backing, "starting_balance_usdt": "100000", "image_ref": RUNTIME["image_ref"]}
        self.assertEqual(manifest["evidence"], [found])
        self.assertEqual(self.read_ahead(), [found], "the page shows what preparation records")
        self.assertEqual(manifest["research_at"], db.head_commit(self.world.conn))
        review = runs.review(self.world.profile, manifest)
        self.assertEqual(review["evidence"], [found])

        # The runner compares that balance with the USDT wallet the venue reports when it starts.
        near = Decimal("100000") * (1 + EVIDENCE_TOLERANCE)
        self.assertEqual(require_evidence(wallet(str(near)), manifest), found)
        self.assertEqual(refused(require_evidence, wallet("90"), manifest,
                                 error=LiveRefusal).code, "LIVE_EVIDENCE_BALANCE")


    def test_preparation_needs_a_candidate_its_closing_history_test_passed(self):
        """20261120-06 (user 2026-11-21): the check validation registration makes (report.history.require_unfalsified),
        read at the research commit, before the replay evidence."""
        self.explore()  # replay evidence that would back the run
        with patch.object(runs.admission, "unfalsified", UNFALSIFIED):
            self.assertEqual(self.refused("untested"), "LIVE_HISTORY_UNDECIDED", "the line has no history trial")
            falsified = refuse("CANDIDATE_FALSIFIED", "short of the targets", missing=("rsi-root",))
            with patch.object(history, "require_unfalsified", side_effect=falsified):
                self.assertEqual(self.refused("falsified"), "LIVE_CANDIDATE_FALSIFIED")
            with patch.object(history, "require_unfalsified", return_value={"line": "rsi-root", "judged_on": "holdout"}):
                self.assertTrue(self.prepare("passed")["evidence"])
    def test_preparation_needs_a_reconciled_paper_run(self):
        """20261120-06 (user 2026-11-21): the serving control's answer (live.reconcile.require), asked last."""
        asked = []

        def unreconciled(source_sha256, symbols):
            asked.append((source_sha256, symbols))
            raise state.fail("LIVE_PAPER_UNRECONCILED", "no sealed, complete Paper run of this source")
        self.explore()  # replay evidence that backs the run
        self.assertEqual(self.refused("no-paper", reconciled=unreconciled), "LIVE_PAPER_UNRECONCILED")
        self.assertEqual(asked, [(hashlib.sha256(self.candidate["source"]).hexdigest(), ["AAAUSDT"])])
        self.assertTrue(self.prepare("reconciled", reconciled=lambda *_: None)["evidence"])


@unittest.skipUnless(BINARY, SKIP)
class QuoteResearchEvidenceTests(unittest.TestCase):
    """A source researched with quotes (#3492): its research trial gives the windows it saw, and only bars replays
    inside one back a run."""

    def setUp(self):
        self.world = World("live-evidence-quotes")
        self.addCleanup(self.world.close)
        self.source = source("root")
        with patch.dict(ACCOUNT, execution="quotes"):
            review = self.world.prechecked(self.source)
            registered = self.world.register(self.world.body(["rsi@1"], {"rsi@1": review}, comparison=None),
                                             runner_argv=[*RUNNER_ARGV, "--execution", "quotes"])
            self.research = self.world.research_trial(registered["registration_id"], self.source)  # January 2026

    def found(self, symbols=("AAAUSDT",)) -> list[int]:
        with patch.object(runs.admission, "replay_code", return_value=CODE):
            rows = runs._evidence(self.world.profile, db.head_commit(self.world.conn),
                                  hashlib.sha256(self.source).hexdigest(), list(symbols), CODE, [], "3")
        return [row["trial_id"] for row in rows]

    def explore(self, execution: str, days: int = 2) -> int:
        with patch.dict(ACCOUNT, execution=execution):
            trial_id = self.world.open_precheck(self.source, effective_config=config(symbols=["AAAUSDT"]),
                                                purpose="explore", days=days)
        capture(self.world.conn, trial_id, self.source, purpose="explore", fingerprint={"fills": {"sha256": "f" * 64}})
        self.assertEqual(self.world.conn.rows("SELECT execution FROM trial WHERE trial_id = %s", (trial_id,)),
                         [(execution,)])
        return trial_id

    def test_a_bars_explore_inside_the_quote_research_window_backs_a_run_and_one_outside_does_not(self):
        self.assertEqual(self.world.conn.rows("SELECT execution FROM trial WHERE trial_id = %s", (self.research,)),
                         [("quotes",)])
        self.explore("bars", days=40)  # past the research window's end
        self.assertEqual(self.found(), [])
        backing = self.explore("bars")
        self.assertEqual(self.found(), [backing])

    def test_no_quote_replay_backs_a_run(self):
        self.explore("quotes")
        self.assertEqual(self.found(), [], "an audited explore in quotes")
        capture(self.world.conn, self.research, self.source, purpose="research")
        self.world.seal_run(self.research)
        self.assertEqual(self.found(("AAAUSDT", "BBBUSDT")), [], "a passed sealed run in quotes")


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
            before = time.time_ns()
            world.seal_run(trial_id)
            found = control.candidate(config, "rsi@1")
            caught = refused(control.candidate, config, "rsi@99", error=LiveRefusal)
        self.assertEqual(found, {"candidate": "rsi@1", "research_at": db.head_commit(world.conn),
                                 "source_sha256": hashlib.sha256(data).hexdigest(),
                                 "entry_class": "Fixture", "last_symbols": ["AAAUSDT", "BBBUSDT"]})
        self.assertEqual(caught.code, "LIVE_SOURCE_MISSING")
        sha256 = hashlib.sha256(data).hexdigest()  # as of a moment (a Paper retry's declaration): only replays run by then
        self.assertIsNone(control.paper_records.last_research_symbols(world.conn, sha256, before))
        self.assertEqual(control.paper_records.last_research_symbols(world.conn, sha256, time.time_ns())["symbols"],
                         ["AAAUSDT", "BBBUSDT"])


class EvidenceReadAheadTests(unittest.TestCase):
    """control.Evidence: replay evidence of what the page asked about, read in the background, display only."""

    KEY = ("a" * 32, "b" * 64, ("BTCUSDT",))
    OTHER = ("a" * 32, "b" * 64, ("BTCUSDT", "ETHUSDT"))

    def setUp(self):
        self.root = Path(self.enterContext(__import__("tempfile").TemporaryDirectory())) / "live-root"
        self.config = install(self, self.root).config

    def test_the_listing_names_no_candidate_or_contracts_and_offers_the_run_defaults(self):
        listing = control.listing(self.config)
        self.assertNotIn("sources", listing)
        self.assertEqual(listing["defaults"], {"environment": "live", "duration_seconds": None, "leverage": "3", "drawdown_brake": "0.15"})

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
