"""Execution captures, independent source reviews, precheck admission, the precheck exposure
exemption and the reviewed start of a research line, on a throwaway ledger."""

from __future__ import annotations

import hashlib
import json
import unittest

from ledger import db, evidence, execution, lines, problems, trials
from shared.errors import Refusal
from registration import precheck
from tests.ledger.dolt import (BINARY, IDENTITY, MARKET_COMMIT, RUNTIME, SKIP, coverage, market,
                               product_bundle, sha)
from tests.registration.world import World, capture, config

OTHER_RUNTIME = {**RUNTIME, "image_ref": "ghcr.io/qoeop/trade-runtime@sha256:" + "c" * 64,
                 "image_digest": "sha256:" + "c" * 64}
LIFECYCLE = "lifecycle-" + MARKET_COMMIT


def forge_capture(conn, trial_id: int, listed: list[tuple], stored: dict[str, bytes]) -> None:
    """A completed capture whose trial_file rows are `listed` (path, status, sha256, length) and whose
    capture bundle holds `stored`, as no product write would pair them."""
    def insert(c, op):
        c.rows("INSERT INTO trial_capture (trial_id, native_state, native_exit_code, audit_state, audit_exit_code, "
               "outcome_kind, op_id) VALUES (%s, 'exited', 0, 'exited', 0, 'completed', %s)", (trial_id, op))
        c.many("INSERT INTO trial_file (trial_id, path, status, sha256, length) VALUES (%s, %s, %s, %s, %s)",
               [(trial_id, *row) for row in listed])
        if stored:
            evidence.write_files(c, f"trial-{trial_id}-capture", stored, kind="capture", trial_id=trial_id)
        return {"trial_id": trial_id}
    db.write(conn, "forged_capture", {"trial_id": trial_id}, "trial_capture", insert)


@unittest.skipUnless(BINARY, SKIP)
class PrecheckTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.world = World("precheck")
        cls.addClassCleanup(cls.world.close)
        cls.candidate = cls.world.publish("prechecked")
        cls.data = cls.candidate["source"]
        product_bundle(cls.world.conn, LIFECYCLE, {"lifecycle.json": b"{}"}, kind="lifecycle")

    def setUp(self):
        self.conn = self.world.conn

    def code(self, function, *args, **kwargs) -> str:
        with self.assertRaises(Refusal) as caught:
            function(*args, **kwargs)
        return caught.exception.code

    def sealed(self, data=None, runtime=None, identity=None, **options) -> int:
        data = data or self.data
        trial_id = self.world.open_precheck(data, identity, runtime=runtime)
        capture(self.conn, trial_id, data, **options)
        return trial_id

    def review(self, trial_id: int, verdict="passed", **items) -> int:
        return precheck.record_review(self.world.profile, self.world.review_body(trial_id, verdict, **items),
                                      "reviewer-b")["review_id"]

    def identity(self, effective_config: dict | None = None, **overrides) -> dict:
        """The execution identity a registration over both symbols and January fixes."""
        return {"image_ref": IDENTITY["image_ref"], "market_day": MARKET_COMMIT, "universe_rule": "pool-v1",
                "lifecycle_bundle": None,
                "comparable_config_sha256": trials.comparable_config_sha256(effective_config or config()),
                "symbols": ["AAAUSDT", "BBBUSDT"], **overrides}

    # Captures

    def test_a_capture_is_read_with_every_identity_and_file_checked(self):
        trial_id = self.sealed(runtime_errors=b'{"callback": "on_bar"}\n')
        read = execution.read_capture(self.conn, trial_id)
        self.assertEqual((read["status"], read["purpose"], read["stages"]["native"]["exit_code"]),
                         ("captured", "precheck", 0))
        self.assertEqual(read["listed"]["source/strategy.py"]["sha256"], hashlib.sha256(self.data).hexdigest())
        self.assertEqual(read["statuses"]["native.stderr.txt"], "captured_empty")
        self.assertEqual(read["runtime_failures"], [{"callback": "on_bar"}])
        self.assertEqual(read["input_coverage"]["effective_config"]["symbols"], ["AAAUSDT"])
        unsealed = self.world.open_precheck(self.data)
        self.assertEqual(execution.read_capture(self.conn, unsealed)["status"], "missing")
        self.assertEqual(self.code(execution.read_capture, self.conn, 999_999), "TRIAL_NOT_FOUND")

    def test_a_capture_that_disagrees_with_its_trial_or_listing_is_refused(self):
        def forged(listed, stored) -> str:
            trial_id = self.world.open_precheck(self.data)
            forge_capture(self.conn, trial_id, listed, stored)
            return self.code(execution.read_capture, self.conn, trial_id)

        ran = ("native.stdout.txt", "captured", None, None)
        self.assertEqual(forged([ran], {"native.stdout.txt": b"ran", "extra.txt": b"x"}), "LEDGER_CORRUPT")
        self.assertEqual(forged([ran, ("lost.txt", "captured", None, None)], {"native.stdout.txt": b"ran"}),
                         "LEDGER_CORRUPT")
        self.assertEqual(forged([ran, ("source/strategy.py", "captured", None, None)],
                                {"native.stdout.txt": b"ran", "source/strategy.py": self.data}), "EXECUTION_IDENTITY",
                         "the source is hashed, never stored")
        self.assertEqual(forged([ran, ("source/strategy.py", "hashed", sha(b"other"), 5)], {"native.stdout.txt": b"ran"}),
                         "EXECUTION_IDENTITY")

    # Reviews

    def test_a_review_is_bound_to_the_precheck_and_appended_once(self):
        trial_id = self.sealed()
        recorded = precheck.record_review(self.world.profile, self.world.review_body(trial_id), "reviewer-b")
        self.assertEqual((recorded["trial_id"], recorded["source_sha256"], recorded["image_digest"], recorded["replayed"]),
                         (trial_id, sha(self.data), IDENTITY["image_digest"], False))
        again = precheck.record_review(self.world.profile, self.world.review_body(trial_id), "reviewer-b")
        self.assertEqual((again["review_id"], again["replayed"], again["ledger_commit"]),
                         (recorded["review_id"], True, recorded["ledger_commit"]))
        stored = self.world.service.sql(self.world.profile, "SELECT trial_id, source_sha256, verdict, reviewer FROM "
                                        "source_review WHERE review_id = %s", (recorded["review_id"],))
        self.assertEqual(stored, [(trial_id, sha(self.data), "passed", "reviewer-b")])

    def test_malformed_reviews_and_reviews_without_a_precheck_capture_are_refused(self):
        trial_id = self.sealed()
        body = self.world.review_body(trial_id)
        malformed = [{**body, "extra": 1}, {k: v for k, v in body.items() if k != "api"}, {**body, "trial_id": "1"},
                     {**body, "trial_id": True}, {**body, "verdict": "maybe"},
                     {**body, "api": {"status": "fine", "note": "n"}}, {**body, "api": {"status": "passed", "note": " "}},
                     {**body, "api": {"status": "passed", "note": "n", "score": 1}},
                     {**body, "causal": {"status": "unresolved", "note": "lookahead unclear"}},
                     {**body, "verdict": "failed"}, "not a body"]
        seq = self.world.seq()
        for value in malformed:
            with self.subTest(value=value):
                self.assertEqual(self.code(precheck.record_review, self.world.profile, value, "b"), "REVIEW_INVALID")
        self.assertEqual(self.world.seq(), seq)
        self.assertEqual(self.code(precheck.record_review, self.world.profile,
                                   self.world.review_body(999_999), "b"), "TRIAL_NOT_FOUND")
        unsealed = self.world.open_precheck(self.data)
        explored = trials.open_trial(self.conn, "explore", sha(self.data), RUNTIME,
                                     coverage(effective_config=config(), symbols=["AAAUSDT"]),
                                     {"start": 0, "trade_start": 60 * 10**9, "end": 120 * 10**9},
                                     self.world.start(self.data))["trial_id"]
        capture(self.conn, explored, self.data, purpose="explore")
        seq = self.world.seq()
        for target in (unsealed, explored):
            with self.subTest(target=target):
                self.assertEqual(self.code(precheck.record_review, self.world.profile,
                                           self.world.review_body(target), "b"), "PRECHECK_CAPTURE_MISSING")
        self.assertEqual(self.world.seq(), seq)

    # Admission

    def test_a_passing_review_of_a_clean_precheck_admits_the_source(self):
        trial_id = self.sealed()
        review = self.review(trial_id, api={"status": "no_opportunity", "note": "no signal in three days"})
        self.assertEqual(precheck.require_precheck(self.conn, review, sha(self.data), self.identity()), trial_id)

    def test_a_review_of_another_source_runtime_or_input_is_required_again(self):
        review = self.review(self.sealed())
        other = self.world.publish("other source")
        cases = [(999_999, sha(self.data), self.identity()), (str(review), sha(self.data), self.identity()),
                 (review, sha(other["source"]), self.identity()),
                 (review, sha(self.data), self.identity(image_ref=OTHER_RUNTIME["image_ref"])),
                 (review, sha(self.data), self.identity(market_day="2026-03-02"))]
        for case in cases:
            with self.subTest(case=case):
                self.assertEqual(self.code(precheck.require_precheck, self.conn, *case), "SOURCE_PRECHECK_REQUIRED")

    def test_review_records_are_the_product_reviews_of_a_source(self):
        trial_id = self.sealed()
        recorded = precheck.record_review(self.world.profile, self.world.review_body(trial_id), "reviewer-q")
        found = {item["review_id"]: item for item in precheck.review_records(self.conn, sha(self.data))}
        record = found[recorded["review_id"]]
        self.assertEqual((record["trial_id"], record["verdict"], record["reviewer"], record["image_digest"],
                          record["api"]["status"]), (trial_id, "passed", "reviewer-q", IDENTITY["image_digest"], "passed"))
        self.assertTrue(all(item["source_sha256"] == sha(self.data) for item in found.values()))
        self.assertNotIn(recorded["review_id"], {item["review_id"] for item in precheck.review_records(
            self.conn, sha(self.world.publish("unreviewed")["source"]))})

    def test_lifecycle_inputs_are_compared_both_ways(self):
        with_lifecycle = self.review(self.sealed(identity={"lifecycle_bundle": LIFECYCLE}))
        without = self.review(self.sealed())
        self.assertEqual(self.code(precheck.require_precheck, self.conn, with_lifecycle, sha(self.data),
                                   self.identity()), "SOURCE_PRECHECK_REQUIRED")
        self.assertEqual(self.code(precheck.require_precheck, self.conn, without, sha(self.data),
                                   self.identity(lifecycle_bundle=LIFECYCLE)), "SOURCE_PRECHECK_REQUIRED")
        self.assertIsInstance(precheck.require_precheck(self.conn, with_lifecycle, sha(self.data),
                                                        self.identity(lifecycle_bundle=LIFECYCLE)), int)

    def test_a_review_admits_only_the_configuration_its_precheck_ran(self):
        trial_id = self.sealed()
        review = self.review(trial_id)
        wider = config(symbols=["AAAUSDT", "ZZZUSDT"], start="2024-12-31T00:00:00Z", trade_start="2025-01-01T00:00:00Z",
                       end="2026-02-01T00:00:00Z")
        for effective in (config(), wider):
            with self.subTest(effective=effective):
                self.assertEqual(precheck.require_precheck(self.conn, review, sha(self.data),
                                                           self.identity(effective)), trial_id)
        for effective in ({**config(), "execution_bar_minutes": 5}, config(account={"balance_usdt": "5000"})):
            with self.subTest(effective=effective):
                self.assertEqual(self.code(precheck.require_precheck, self.conn, review, sha(self.data),
                                           self.identity(effective)), "SOURCE_PRECHECK_REQUIRED")

    def test_any_failed_review_of_the_precheck_fails_admission(self):
        trial_id = self.sealed()
        passed = self.review(trial_id)
        self.assertEqual(precheck.require_precheck(self.conn, passed, sha(self.data), self.identity()), trial_id)
        self.review(trial_id, "failed", causal={"status": "failed", "note": "reads the next bar's close"})
        self.assertEqual(self.code(precheck.require_precheck, self.conn, passed, sha(self.data), self.identity()),
                         "SOURCE_PRECHECK_FAILED")

    def test_a_failed_precheck_or_review_item_fails_admission(self):
        cases = [{"native_exit": 1}, {"audit_exit": 2}, {"audit_exit": None}, {"outcome": "interrupted"},
                 {"runtime_errors": b'{"callback": "on_bar", "error": "KeyError"}\n'}]
        for options in cases:
            with self.subTest(options=options):
                review = self.review(self.sealed(**options))
                self.assertEqual(self.code(precheck.require_precheck, self.conn, review, sha(self.data),
                                           self.identity()), "SOURCE_PRECHECK_FAILED")
        for status in ("failed", "unresolved"):
            with self.subTest(status=status):
                review = self.review(self.sealed(), "failed", readiness={"status": status, "note": "indicator cold"})
                self.assertEqual(self.code(precheck.require_precheck, self.conn, review, sha(self.data),
                                           self.identity()), "SOURCE_PRECHECK_FAILED")

    # Exposure exemption

    def test_only_a_matching_declared_precheck_is_exempt_from_exposure(self):
        identity = self.identity()
        exempt = self.sealed()
        self.assertTrue(precheck.exposure_exempt(self.conn, exempt, sha(self.data), identity))
        unsealed = self.world.open_precheck(self.data)
        moved = self.sealed(identity={"market_day": "2026-03-02"})
        wider = self.sealed(identity={"symbols": ["AAAUSDT", "ZZZUSDT"]})
        other_image = self.sealed(runtime=OTHER_RUNTIME)
        lifecycle = self.sealed(identity={"lifecycle_bundle": LIFECYCLE})
        for trial_id in (unsealed, moved, wider, other_image, lifecycle):
            with self.subTest(trial_id=trial_id):
                self.assertFalse(precheck.exposure_exempt(self.conn, trial_id, sha(self.data), identity))
        for effective in ({**config(), "execution_bar_minutes": 5}, config(account={"balance_usdt": "5000"})):
            with self.subTest(effective=effective):
                self.assertFalse(precheck.exposure_exempt(self.conn, exempt, sha(self.data), self.identity(effective)))
        self.assertFalse(precheck.exposure_exempt(self.conn, exempt, sha(self.world.publish("x")["source"]), identity))
        self.assertEqual(self.code(precheck.exposure_exempt, self.conn, 999_999, sha(self.data), identity),
                         "TRIAL_NOT_FOUND")
        ran = ("native.stdout.txt", "captured", None, None)
        damaged = self.world.open_precheck(self.data)
        forge_capture(self.conn, damaged, [ran, ("lost.txt", "captured", None, None)], {"native.stdout.txt": b"ran"})
        self.assertEqual(self.code(precheck.exposure_exempt, self.conn, damaged, sha(self.data), identity),
                         "LEDGER_CORRUPT")
        malformed = self.world.open_precheck(self.data)
        forge_capture(self.conn, malformed, [ran, ("source/strategy.py", "hashed", sha(b"other"), 5)],
                      {"native.stdout.txt": b"ran"})
        self.assertEqual(self.code(precheck.exposure_exempt, self.conn, malformed, sha(self.data), identity),
                         "SOURCE_PRECHECK_REQUIRED")

    def test_a_precheck_longer_than_seven_trading_days_is_not_exempt(self):
        for days, exempt in ((precheck.PRECHECK_MAX_DAYS, True), (precheck.PRECHECK_MAX_DAYS + 1, False)):
            trial_id = self.world.open_precheck(self.data, days=days)
            capture(self.conn, trial_id, self.data)
            with self.subTest(days=days):
                self.assertIs(precheck.exposure_exempt(self.conn, trial_id, sha(self.data), self.identity()), exempt)

    def test_only_a_precheck_that_failed_before_market_data_leaves_the_source_unexposed(self):
        def failures(*stages):
            return b"".join(json.dumps({"stage": stage, "exception_type": "Refusal"}).encode() + b"\n"
                            for stage in stages)
        for stage in sorted(problems.PRE_STRATEGY_STAGES):
            with self.subTest(stage=stage):
                trial_id = self.sealed(runtime=OTHER_RUNTIME, native_exit=1, audit_exit=None,
                                       runtime_errors=failures(stage))
                self.assertTrue(precheck.sealed_no_result(self.conn, trial_id, sha(self.data)))
                self.assertFalse(precheck.sealed_no_result(self.conn, trial_id,
                                                           sha(self.world.publish("other")["source"])))
        cases = {"replay stage": {"native_exit": 1, "runtime_errors": failures("replay")},
                 "a later stage beside it": {"native_exit": 1, "runtime_errors": failures("inputs", "replay")},
                 "no failure receipt": {"native_exit": 1},
                 "native exit zero": {"runtime_errors": failures("inputs")}}
        for label, options in cases.items():
            with self.subTest(label=label):
                self.assertFalse(precheck.sealed_no_result(self.conn, self.sealed(**options), sha(self.data)))
        self.assertFalse(precheck.sealed_no_result(self.conn, self.world.open_precheck(self.data), sha(self.data)))

    def test_a_short_precheck_that_sealed_no_fill_and_no_position_leaves_the_source_unexposed(self):
        def sealed(fills=0, positions=0, days=precheck.PRECHECK_MAX_DAYS, **options) -> int:
            trial_id = self.world.open_precheck(self.data, runtime=OTHER_RUNTIME, days=days)
            capture(self.conn, trial_id, self.data, fingerprint=untraded(fills, positions), **options)
            return trial_id
        quiet = sealed()
        self.assertTrue(precheck.sealed_no_result(self.conn, quiet, sha(self.data)))
        self.assertFalse(precheck.sealed_no_result(self.conn, quiet, sha(self.world.publish("other-quiet")["source"])))
        cases = {"a fill": {"fills": 1}, "a position": {"positions": 1},
                 "a longer window": {"days": precheck.PRECHECK_MAX_DAYS + 1}, "a failed audit": {"audit_exit": 2},
                 "an interrupted run": {"outcome": "interrupted"},
                 "a runtime failure": {"runtime_errors": b'{"stage": "replay", "exception_type": "KeyError"}\n'}}
        for label, options in cases.items():
            with self.subTest(label=label):
                self.assertFalse(precheck.sealed_no_result(self.conn, sealed(**options), sha(self.data)))
        unfingerprinted = self.world.open_precheck(self.data)
        capture(self.conn, unfingerprinted, self.data)
        self.assertFalse(precheck.sealed_no_result(self.conn, unfingerprinted, sha(self.data)))
        self.assertFalse(precheck.sealed_no_result(self.conn, self.world.open_precheck(self.data), sha(self.data)))


def untraded(fills: int = 0, positions: int = 0) -> dict:
    """A sealed fingerprint with `fills` fill rows and `positions` position rows."""
    return {"fills": {"rows": fills, "sha256": "1" * 64}, "orders": {"rows": 1, "sha256": "2" * 64},
            "positions": {"rows": positions, "sha256": "3" * 64}}


@unittest.skipUnless(BINARY, SKIP)
class LineStartTests(unittest.TestCase):
    """line select starts a line only at a revision with a passed source review and no failed one, except
    a failure only of activity on an untraded precheck once a later precheck traded and passed. The lines
    take another window than the world's open line, which holds its own."""

    def test_an_unreviewed_or_failed_start_is_refused_and_a_passed_one_selected(self):
        world = World("line-start")
        self.addCleanup(world.close)

        def select(ref: str) -> dict:
            return lines.select_line(world.conn, MARKET_COMMIT, ref,
                                     slug="passing-start", market=market(), reviews=precheck.review_records)

        def code(ref: str) -> str:
            with self.assertRaises(Refusal) as caught:
                select(ref)
            return caught.exception.code

        self.assertEqual(code(world.publish("unreviewed")["candidate"]), "START_REVIEW_REQUIRED")
        failing = world.publish("failing")
        trial_id = world.open_precheck(failing["source"])
        capture(world.conn, trial_id, failing["source"])
        precheck.record_review(world.profile, world.review_body(
            trial_id, "failed", causal={"status": "failed", "note": "reads the next bar's close"}), "reviewer-b")
        self.assertEqual(code(failing["candidate"]), "START_REVIEW_REQUIRED")
        passing = world.publish("passing")
        world.prechecked(passing["source"])
        selected = select(passing["candidate"])
        self.assertEqual((selected["line"], selected["created"]), ("passing-start", True))

    def test_an_activity_only_failure_of_an_untraded_precheck_yields_to_a_later_traded_pass(self):
        world = World("line-untraded")
        self.addCleanup(world.close)
        quiet = {"status": "unresolved", "note": "no order filled, so activity cannot be judged"}

        def code(ref: str) -> str:
            with self.assertRaises(Refusal) as caught:
                lines.select_line(world.conn, MARKET_COMMIT, ref,
                                  slug="untraded-start", market=market(), reviews=precheck.review_records)
            return caught.exception.code

        def reviewed(data: bytes, fills: int, *verdicts: dict) -> None:
            """One precheck sealing `fills` fills and positions, with a review per items mapping."""
            trial_id = world.open_precheck(data)
            capture(world.conn, trial_id, data, fingerprint=untraded(fills, fills))
            for items in verdicts:
                failed = any(item["status"] in ("failed", "unresolved") for item in items.values())
                precheck.record_review(world.profile, world.review_body(trial_id, "failed" if failed else "passed",
                                                                        **items), "reviewer-b")

        released = world.publish("released")
        reviewed(released["source"], 0, {"activity": quiet})
        self.assertEqual(code(released["candidate"]), "START_REVIEW_REQUIRED")
        reviewed(released["source"], 0, {})
        self.assertEqual(code(released["candidate"]), "START_REVIEW_REQUIRED", "a later pass without fills")
        reviewed(released["source"], 3, {})
        selected = lines.select_line(world.conn, MARKET_COMMIT, released["candidate"], slug="untraded-start", market=market(),
                                     reviews=precheck.review_records)
        self.assertEqual((selected["line"], selected["created"]), ("untraded-start", True))

        passed, thin = ({},), ({}, {"activity": {"status": "failed", "note": "one fill only"}})
        cases = {"a source item failed too": (0, {"activity": quiet, "causal": {"status": "failed",
                                                                                 "note": "reads the next close"}},
                                              passed),
                 "readiness unresolved": (0, {"activity": quiet, "readiness": {"status": "unresolved",
                                                                                "note": "indicator cold"}}, passed),
                 "the failed precheck traded": (2, {"activity": {"status": "failed", "note": "fills off the signal"}},
                                                passed),
                 "the later traded precheck failed too": (0, {"activity": quiet}, thin)}
        for label, (fills, items, later) in cases.items():
            with self.subTest(label=label):
                held = world.publish(label.replace(" ", "-"))
                reviewed(held["source"], fills, items)
                reviewed(held["source"], 3, *later)
                self.assertEqual(code(held["candidate"]), "START_REVIEW_REQUIRED")
        earlier = world.publish("traded-before")
        reviewed(earlier["source"], 3, {})
        reviewed(earlier["source"], 0, {"activity": quiet})
        self.assertEqual(code(earlier["candidate"]), "START_REVIEW_REQUIRED", "the traded pass came first")


if __name__ == "__main__":
    unittest.main()
