"""A validation replay against a retry of its registration written between its capture and its run: the whole
replay entry with a stand-in runtime, the registrations and the witness on a local authority. And a reseal of an attempt already retried."""

from __future__ import annotations

import contextlib
from datetime import UTC, datetime, timedelta
import io
import os
import time
import unittest
from unittest.mock import patch

from engine import config as engine_config
from ledger import execution, metrics, witness
from registration import availability, register, seams as registration_seams, validation
from replay import entry, reproduce
from report import comparison
from tests.helpers import refused, tempdir
from tests.ledger.dolt import BINARY, MARKET_DAY, SKIP, source
from tests.ledger.tsa import LocalAuthority
from tests.registration.test_validation import GIT_ENV, checkout, decided
from tests.registration.world import DESIGN, MONTHS, RUNNER_ARGV, months_rows
from tests.replay.world import ReplayWorld, inspect


def probe(identity, runner_argv, inputs) -> dict:
    """The stand-in probe with the replay's own window."""
    found = inspect(identity, runner_argv, inputs)
    window = {name: runner_argv[runner_argv.index(f"--{name.replace('_', '-')}") + 1]
              for name in ("start", "trade_start", "end")}
    config = {**found["effective_config"], **window}
    return {**found, "effective_config": config, "effective_config_sha256": engine_config.config_sha256(config)}


@unittest.skipUnless(BINARY, SKIP)
class ValidationIngestTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.world = world = ReplayWorld("validation-ingest")
        cls.addClassCleanup(world.close)
        now = datetime.now(UTC)
        months = {f"{now + timedelta(days=31 * k):%Y-%m}" for k in range(-3, 2)}
        world.market.market_days[MARKET_DAY] = months_rows(sorted(months | set(MONTHS)))
        _, product = checkout(tempdir(cls.addClassCleanup, prefix="product-", dir="/tmp"))
        authority = LocalAuthority()
        cls.addClassCleanup(authority.close)
        cls.enterClassContext(patch.dict(os.environ, GIT_ENV))
        cls.enterClassContext(patch.object(witness, "_post", side_effect=authority.respond))
        cls.enterClassContext(patch.object(witness, "_roots", return_value=authority.roots))
        cls.enterClassContext(registration_seams.use(checkout=lambda: product, inspect_runtime=probe,
                                                     require_main_build=lambda identity, inspection: "a" * 40))
        review = world.prechecked(source("root"))  # the candidate's research run: the account terms to keep
        registered = world.register(world.body(["rsi@1"], {"rsi@1": review}))["registration_id"]
        entry.run(world.profile, world.market, None, "rsi@1", None, RUNNER_ARGV, registration=registered)
        # Each window opens seconds after its witness and has passed before the replay.
        cls.windows, cls.registered = {}, {}
        closed = datetime.now(UTC).replace(microsecond=0)
        for label in ("passed", "invalid", "no-evidence", "resealed", "lost"):
            start = max(closed, datetime.now(UTC).replace(microsecond=0) + timedelta(seconds=4))
            closed = start + timedelta(seconds=1)
            cls.windows[label] = (start, closed)
            cls.registered[label] = cls.register(label, label)
        time.sleep(max(0.0, (cls.windows["lost"][1] - datetime.now(UTC)).total_seconds()) + 1.2)

    @classmethod
    def register(cls, label: str, op: str, retry_of: int | None = None) -> int:
        start, end = cls.windows[label]
        return validation.validation_register(
            cls.world.profile, "rsi@1", start, end, "usdt-perp-listed30d-v1", MARKET_DAY, DESIGN, retry_of,
            f"validation:{op}", market_profile=cls.world.market, unfalsified=decided)["registration_id"]

    def replay(self, label: str, registration: int | None = None) -> dict:
        opens, closes = self.windows[label]  # inputs start on a whole minute
        warm, start, end = (f"{moment:%Y-%m-%dT%H:%M:%SZ}" for moment in (opens.replace(second=0), opens, closes))
        return entry.run(self.world.profile, self.world.market, MARKET_DAY, "rsi@1", None,
                         ["--start", warm, "--trade-start", start, "--end", end, "--universe", "pool"],
                         validation=registration or self.registered[label])

    @contextlib.contextmanager
    def retried_after_capture(self, label: str):
        """Another writer registers a retry once the capture is sealed, before the run is ingested; its ID."""
        seal, found = execution.seal_capture, []

        def sealed(*args, **kwargs):
            result = seal(*args, **kwargs)
            found.append(self.register(label, f"{label}-retry", self.registered[label]))
            return result

        with patch.object(entry.execution, "seal_capture", sealed), contextlib.redirect_stderr(io.StringIO()):
            yield found

    def attempt(self, registration: int) -> list[tuple]:
        return self.world.conn.rows("SELECT t.trial_id, r.status FROM trial t LEFT JOIN run r ON r.trial_id = "
                                    "t.trial_id WHERE t.validation_registration_id = %s", (registration,))

    def test_a_passed_run_is_not_ingested_once_a_retry_is_registered(self):
        with self.retried_after_capture("passed") as retry:
            caught = refused(self.replay, "passed")
        self.assertEqual((caught.code, caught.missing[1:]), ("RETRY_NOT_ALLOWED", (str(retry[0]),)))
        ((trial_id, status),) = self.attempt(self.registered["passed"])
        self.assertIsNone(status, "the retried attempt stays captured without a run")
        self.assertTrue(register.retryable(self.world.conn, trial_id))
        self.assertEqual(self.replay("passed", retry[0])["status"], "passed", "the retry is the attempt that counts")
        found = comparison.validation_report(self.world.profile, retry[0])
        self.assertEqual([item["latest_attempt"] for item in found["family"]["members"]], retry)

    def test_an_invalid_run_is_ingested_beside_its_retry(self):
        self.world.scenario = {"audit_passed": False, "findings": ["order O-2 naked: no stop"]}
        self.addCleanup(setattr, self.world, "scenario", {})
        with self.retried_after_capture("invalid"):
            self.assertEqual(self.replay("invalid")["status"], "invalid")

    def test_a_passed_run_without_evidence_is_ingested_beside_its_retry(self):
        # The stand-in's return series does not compound over a window inside one minute (RETURN_SERIES_UNUSABLE);
        # the criterion itself reads it, inside the write.
        with registration_seams.use(qualification_assess=None), self.retried_after_capture("no-evidence"):
            stored = self.replay("no-evidence")
        self.assertEqual(stored["status"], "passed")
        self.assertEqual(availability.assess(self.world.conn, stored)["reasons"][0].split(":")[0],
                         "RETURN_SERIES_UNUSABLE")

    def test_a_retried_attempt_is_not_resealed_into_one_that_counts(self):
        compute = metrics.metrics

        def computing(passed: bool):
            """Metrics code at another commit, that reads the one-minute window's returns as compounding or not."""
            def report(reports):
                found = compute(reports)
                fact = {"passed": passed, "code": None if passed else "RETURN_SERIES_UNUSABLE"}
                return {**found, "activity": {**found["activity"], "returns_compound_to_equity": fact}}
            return patch.multiple(metrics, metrics=report, product_commit=lambda checkout=None: "ed"[passed] * 40)

        def reseal(name: str) -> dict:
            return reproduce.reseal(first, self.world.output(name), ledger=self.world.profile, market=self.world.market)

        def reading() -> list[tuple]:
            return self.world.conn.rows("SELECT report, product_commit FROM run_reading WHERE trial_id = %s", (first,))

        with registration_seams.use(qualification_assess=None):
            with computing(False):
                first = self.replay("resealed")["trial_id"]
            retry = self.register("resealed", "resealed-retry", self.registered["resealed"])
            with computing(True):
                second = self.replay("resealed", retry)["trial_id"]
                self.assertEqual([register.retryable(self.world.conn, item) for item in (first, second)], [True, False])
                sealed = reading()
                caught = refused(reseal, "gains-evidence")
            self.assertEqual((caught.code, caught.missing, caught.write_status),
                             ("RETRY_NOT_ALLOWED", (str(self.registered["resealed"]), str(retry)), "written"))
            self.assertEqual(reading(), sealed, "the refused reseal leaves the reading")
            self.assertTrue(register.retryable(self.world.conn, first))
            with computing(False), patch.object(metrics, "product_commit", return_value="f" * 40):
                self.assertTrue(reseal("no-evidence-still")["resealed"], "a reading that does not count is replaced")

    def test_a_failed_ingestion_is_retried_and_a_stored_run_is_not(self):
        with patch.object(entry.trials, "ingest_run", side_effect=RuntimeError("host lost the ledger")), \
                contextlib.redirect_stderr(io.StringIO()), self.assertRaises(RuntimeError):
            self.replay("lost")
        retry = self.register("lost", "lost-retry", self.registered["lost"])
        self.assertEqual(self.replay("lost", retry)["status"], "passed")
        self.assertEqual(refused(self.register, "lost", "lost-again", retry).code, "RETRY_NOT_ALLOWED")


if __name__ == "__main__":
    unittest.main()
