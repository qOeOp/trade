"""Reproducing a sealed run: the directory is handed over only when the semantic fingerprint its own
fingerprint stage sealed equals the one recorded at sealing; an absent fingerprint is never taken as
a match. The run row keeps no per-UTC-day hashes, and a row stored with them still matches.
Reading a run names a missing capture or fingerprint."""

from __future__ import annotations

import json
from pathlib import Path
import unittest
from unittest.mock import patch

from engine import config as engine_config
from ledger import coverage, execution, metrics, problems, strategies, trials
from ledger.errors import Refusal
from registration import comparability, register, seams as registration_seams
from replay import entry, reproduce
from report import runs
from tests.ledger.dolt import BINARY, MARKET_COMMIT, RUNTIME, SKIP, context, sha
from tests.registration.world import LINE_WINDOW, RUNNER_ARGV
from tests.replay.world import ReplayWorld, registered_grid
from tests.replay.test_precheck_cache import ARGV


FINGERPRINT = {"fills": {"rows": 2, "sha256": "1" * 64, "by_utc_day": {"2026-01-01": "2" * 64}}}
STORED = {"fills": {"rows": 2, "sha256": "1" * 64}}


@unittest.skipUnless(BINARY, SKIP)
class ReproduceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.world = world = ReplayWorld("reproduce")
        cls.addClassCleanup(world.close)
        fingerprinted, unprinted = registered_grid(world, ["r1", "r2"])
        cls.forged_refs = registered_grid(world, ["f1", "f2"], "registration-forged")
        (legacy,) = registered_grid(world, ["r3"], "registration-legacy")
        world.fingerprint = FINGERPRINT
        cls.fingerprinted = entry.run(world.profile, world.market, MARKET_COMMIT, fingerprinted, None, RUNNER_ARGV,
                                      hypothesis="registration-grid")["trial_id"]
        with patch.object(problems, "stored_fingerprint", lambda fingerprint: fingerprint):  # the earlier ingest
            cls.legacy = entry.run(world.profile, world.market, MARKET_COMMIT, legacy, None, RUNNER_ARGV,
                                   hypothesis="registration-legacy")["trial_id"]
        world.fingerprint = None
        cls.unprinted = entry.run(world.profile, world.market, MARKET_COMMIT, unprinted, None, RUNNER_ARGV,
                                  hypothesis="registration-grid")["trial_id"]

    def setUp(self):
        self.world = self.__class__.world

    def reproduce(self, trial_id: int, name: str):
        return reproduce.reproduce(trial_id, self.world.output(name), ledger=self.world.profile, market=self.world.market)

    def test_the_recorded_fingerprint_is_the_sealed_fingerprint_stage(self):
        stored = metrics.load_run(self.world.conn, self.fingerprinted)
        self.assertEqual((stored["run"]["fingerprints"], stored["capture"]["stages"]["fingerprint"]["exit_code"],
                          stored["evidence"]["unavailable"]), (STORED, 0, []),
                         "the run row keeps each table's rows and hashes, not the image's per-UTC-day hashes")
        self.assertEqual(stored["capture"]["statuses"]["fingerprint/fingerprint.json"], "hashed",
                         "the run row keeps the fingerprint; the capture its hash")
        self.assertEqual(metrics.load_run(self.world.conn, self.legacy)["run"]["fingerprints"], FINGERPRINT,
                         "a row the earlier ingest stored keeps its day hashes")
        unprinted = metrics.load_run(self.world.conn, self.unprinted)
        self.assertEqual((unprinted["capture"]["stages"]["fingerprint"]["exit_code"],
                          unprinted["evidence"]["fingerprints"]),
                         (3, "missing"))
        self.assertEqual((unprinted["run"]["status"], [item["code"] for item in unprinted["run"]["failure_reasons"]]),
                         ("invalid", ["FINGERPRINT_FAILED"]), "a run without a fingerprint is stored invalid")

    def forged(self, ref: str, receipt_identity: dict | None = None) -> int:
        """A passed run row stored without any capture, its start coverage receipt naming `receipt_identity`."""
        data = strategies.read_candidate(self.world.conn, ref)["source"]
        actual = self.world.plan("registration-forged")["execution"]
        receipt = json.dumps({"format": coverage.FORMAT, "effective_config": actual["effective_config"],
                              "export_receipts": {}, "input_identity": receipt_identity or actual["input_identity"]})
        trial_id = trials.open_trial(self.world.conn, "research", sha(data), RUNTIME,
                                     {"identity": actual["input_identity"], "input_coverage": receipt.encode()},
                                     LINE_WINDOW, context(data, self.world.workdir()),
                                     register.binder("registration-forged", sha(data)))["trial_id"]
        return self.world.seal_run(trial_id)

    def test_reading_a_run_names_a_missing_capture_and_checks_the_coverage_identity(self):
        stored = metrics.load_run(self.world.conn, self.forged(self.forged_refs[0]))
        self.assertEqual(stored["evidence"]["capture"], "missing")
        self.assertEqual([item.split(":")[0] for item in stored["evidence"]["unavailable"]], ["CAPTURE_MISSING"])
        other = {**self.world.plan("registration-forged")["execution"]["input_identity"],
                 "export_content_sha256": "0" * 64}
        with self.assertRaises(Refusal) as caught:
            metrics.load_run(self.world.conn, self.forged(self.forged_refs[1], other))
        self.assertEqual(caught.exception.code, "EXECUTION_IDENTITY")

    def test_a_matching_fingerprint_hands_over_the_reproduced_reports(self):
        self.world.fingerprint = FINGERPRINT
        done = self.reproduce(self.fingerprinted, "same")
        self.assertEqual((done["trial_id"], done["fingerprints_match"]), (self.fingerprinted, True))
        self.assertTrue((self.world.output("same") / "reports" / "fills.csv").is_file())
        capture = execution.read_capture(self.world.conn, done["reproduction_trial_id"])
        self.assertEqual((capture["status"], capture["purpose"]), ("captured", "explore"))
        self.assertEqual(self.world.service.sql(self.world.profile, "SELECT COUNT(*) FROM run")[0][0], 3,
                         "a reproduction stores no run")

    def test_rows_stored_with_or_without_day_hashes_match_and_the_capture_still_holds_every_day(self):
        self.world.fingerprint = FINGERPRINT
        for trial_id, name in ((self.fingerprinted, "new-row"), (self.legacy, "old-row")):
            with self.subTest(name=name):
                done = self.reproduce(trial_id, name)
                self.assertTrue(done["fingerprints_match"])
                runs.verify_reproduction(self.world.conn, Path(done["directory"]),
                                         metrics.load_run(self.world.conn, trial_id), done["reproduction_trial_id"])
        moved = {"fills": {**FINGERPRINT["fills"], "by_utc_day": {"2026-01-02": "3" * 64}}}
        for trial_id, computed, name in ((self.fingerprinted, moved, "new-row-moved"),
                                         (self.legacy, {"fills": {**STORED["fills"], "sha256": "4" * 64}},
                                          "old-row-changed")):
            self.world.fingerprint = computed
            with self.subTest(name=name), self.assertRaises(Refusal) as caught:
                self.reproduce(trial_id, name)
            self.assertEqual(caught.exception.code, "REPRODUCTION_MISMATCH",
                             "the capture's hash of the whole fingerprint file still covers the day hashes")

    def test_a_different_or_absent_fingerprint_refuses_and_keeps_the_directory(self):
        cases = [(self.fingerprinted, {"fills": {"rows": 3}}, "changed"),
                 (self.fingerprinted, None, "stage-failed"),
                 (self.unprinted, None, "never-recorded")]
        for trial_id, computed, name in cases:
            self.world.fingerprint = computed
            with self.subTest(name=name), self.assertRaises(Refusal) as caught:
                self.reproduce(trial_id, name)
            self.assertEqual((caught.exception.code, caught.exception.write_status),
                             ("REPRODUCTION_MISMATCH", "written"), "the reproduction's own trial was committed")
            self.assertTrue((self.world.output(name) / "reports").is_dir())
        with self.assertRaises(Refusal) as caught:
            self.reproduce(9999, "unknown")
        self.assertEqual(caught.exception.code, "UNKNOWN_RUN")


@unittest.skipUnless(BINARY, SKIP)
class ExecutionEnvironmentReproduceTests(unittest.TestCase):
    """Disposable ledger and runtime stand-in; the actual parser resolves the environment."""

    def setUp(self):
        self.world = ReplayWorld("reproduce-environment")
        self.addCleanup(self.world.close)
        probe = registration_seams.use(inspect_runtime=self.inspect)
        probe.__enter__()
        self.addCleanup(probe.__exit__, None, None, None)

    @staticmethod
    def inspect(identity, runner_argv, inputs):
        config = engine_config.parse_configuration([
            "--describe", "--market-root", str(inputs["root"]), "--market-commit", MARKET_COMMIT,
            "--symbols", *inputs["symbols"], *runner_argv])
        effective = engine_config.effective_configuration(config)
        return {"runtime_contract": identity["runtime_contract"], "effective_config": effective.values,
                "effective_config_sha256": effective.digest}

    def checked(self, name, initial=None, maintenance=None):
        argv = list(ARGV)
        if initial is not None:
            argv += ["--execution", "quotes", "--initial-margin", initial, "--maintenance-margin", maintenance]
        return entry.precheck(self.world.profile, self.world.market, MARKET_COMMIT, "rsi@1", RUNTIME["image_ref"],
                              argv, self.world.output(name))["trial_id"]

    def reproduce(self, trial_id, name):
        return reproduce.reproduce(trial_id, self.world.output(name), ledger=self.world.profile,
                                   market=self.world.market)

    def test_single_execution_and_on_demand_reproduction_restore_the_sealed_environment(self):
        for name, initial, maintenance in (("bars", None, None), ("quotes", "0.05", "0.025"),
                                           ("other-rates", "0.02", "0.01")):
            with self.subTest(environment=name):
                first = len(self.world.commands)
                trial_id = self.checked(name, initial, maintenance)
                original = execution.read_capture(self.world.conn, trial_id)
                self.assertEqual([row["module"] for row in self.world.commands[first:]],
                                 ["runner", "audit", "fingerprint"], "sealing runs the engine only once")
                done = self.reproduce(trial_id, name + "-rebuilt")
                rebuilt = execution.read_capture(self.world.conn, done["reproduction_trial_id"])
                expected = original["input_coverage"]["effective_config"]
                found = rebuilt["input_coverage"]["effective_config"]
                self.assertEqual(comparability.config_key(found), comparability.config_key(expected))
                self.assertEqual((found["account"]["execution"], found["account"]["initial_margin_rate"],
                                  found["account"]["maintenance_margin_rate"]),
                                 ("quotes" if initial else "bars", initial, maintenance))
                self.assertTrue(done["fingerprints_match"])
                self.assertEqual(execution.read_capture(self.world.conn, trial_id), original)
                self.assertEqual(self.world.conn.rows("SELECT COUNT(*) FROM run"), [(0,)])
                self.assertEqual([row["module"] for row in self.world.commands[first:]],
                                 ["runner", "audit", "fingerprint"] * 2)

    def test_changed_environment_or_either_margin_rate_refuses_before_starting_a_trial(self):
        trial_id = self.checked("quotes", "0.05", "0.025")
        for field, value in (("execution", "bars"), ("initial_margin_rate", "0.10"),
                             ("maintenance_margin_rate", "0.04")):
            def changed_probe(identity, argv, inputs):
                result = self.inspect(identity, argv, inputs)
                result["effective_config"]["account"][field] = value
                result["effective_config_sha256"] = engine_config.config_sha256(result["effective_config"])
                return result
            before, commands = self.world.seq(), len(self.world.commands)
            with self.subTest(field=field), registration_seams.use(inspect_runtime=changed_probe):
                with self.assertRaises(Refusal) as caught:
                    self.reproduce(trial_id, "changed-" + field)
                self.assertEqual((caught.exception.code, caught.exception.write_status),
                                 ("REPRODUCTION_MISMATCH", "not_written"))
                self.assertEqual(self.world.seq(), before)
                self.assertEqual(len(self.world.commands), commands)

    def test_historical_bars_reproduction_restores_quotes_only_when_the_original_receipt_has_them(self):
        export = self.world.market.export_catalogs
        prepare = reproduce.registration_inputs.market_inputs

        def quote_content(*args, **kwargs):
            result = export(*args, **kwargs)
            for symbol, receipt in result["receipts"].items():
                receipt["pieces"][0]["counts"] = {"quote": int(kwargs.get("include_quotes", True))}
                if kwargs.get("include_quotes", True):
                    (result["root"] / symbol / "quotes.parquet").write_bytes(b"historical quotes")
                (result["root"] / symbol / "export.json").write_text(json.dumps(receipt))
            return result

        def historical_prepare(*args, **kwargs):
            return prepare(*args, **{**kwargs, "include_quotes": True})

        with patch.object(self.world.market, "export_catalogs", side_effect=quote_content) as exported:
            for historical in (False, True):
                name = "historical-bars" if historical else "projected-bars"
                if historical:
                    with patch.object(reproduce.registration_inputs, "market_inputs", side_effect=historical_prepare):
                        trial_id = self.checked(name)
                else:
                    trial_id = self.checked(name)
                original = execution.read_capture(self.world.conn, trial_id)
                before = exported.call_count
                rebuilt = self.reproduce(trial_id, name + "-rebuilt")
                self.assertEqual(exported.call_count, before + 1)
                self.assertEqual(exported.call_args.kwargs["include_quotes"], historical)
                self.assertTrue(rebuilt["fingerprints_match"])
                self.assertEqual(execution.read_capture(self.world.conn, trial_id), original)

    def test_changed_input_or_report_fingerprint_still_refuses_quote_reproduction(self):
        trial_id = self.checked("quotes", "0.05", "0.025")
        export = self.world.market.export_catalogs

        def changed_export(*args, **kwargs):
            result = export(*args, **kwargs)
            (result["root"] / "AAAUSDT" / "bars.parquet").write_bytes(b"changed input")
            return result

        before = self.world.seq()
        with patch.object(self.world.market, "export_catalogs", side_effect=changed_export):
            with self.assertRaises(Refusal) as caught:
                self.reproduce(trial_id, "changed-input")
        self.assertEqual((caught.exception.code, caught.exception.write_status),
                         ("REPRODUCTION_MISMATCH", "not_written"))
        self.assertEqual(self.world.seq(), before)
        self.world.fingerprint = {"fills": {"rows": 3}}
        with self.assertRaises(Refusal) as caught:
            self.reproduce(trial_id, "changed-reports")
        self.assertEqual((caught.exception.code, caught.exception.write_status),
                         ("REPRODUCTION_MISMATCH", "written"))
        self.assertTrue((self.world.output("changed-reports") / "reports").is_dir())


if __name__ == "__main__":
    unittest.main()
