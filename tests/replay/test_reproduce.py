"""Reproducing a sealed run: the directory is handed over only when the semantic fingerprint its own
fingerprint stage sealed equals the one recorded at sealing; an absent fingerprint is never taken as
a match. Reading a run names a missing capture or fingerprint."""

from __future__ import annotations

from pathlib import Path
import unittest
from unittest.mock import patch

from engine import config as engine_config
from ledger import execution, metrics, strategies, trials
from registration import reproduction
from shared.errors import Refusal
from shared.refusals import refuse
from registration import comparability, register, seams as registration_seams
from replay import entry, reproduce
from report import runs, status
from tests.ledger.dolt import BINARY, MARKET_COMMIT, RUNTIME, SKIP, context, sha
from tests.registration.world import LINE_WINDOW, RUNNER_ARGV, capture
from tests.replay.world import ReplayWorld, registered_grid
from tests.replay.test_precheck_cache import ARGV


FINGERPRINT = {"fills": {"rows": 2, "sha256": "1" * 64}}
ALL_TABLES = {table: {"rows": 2, "sha256": str(index) * 64} for index, table in enumerate(
    ("fills", "positions", "exposures", "returns_series", "account", "orders", "order_events"))}
NEW_IMAGE = {**RUNTIME, "image_ref": "ghcr.io/qoeop/trade-runtime@sha256:" + "9" * 64, "image_digest": "sha256:" + "9" * 64}


@unittest.skipUnless(BINARY, SKIP)
class ReproduceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.world = world = ReplayWorld("reproduce")
        cls.addClassCleanup(world.close)
        grid, (fingerprinted, unprinted) = registered_grid(world, ["r1", "r2"])
        cls.forged_registration, cls.forged_refs = registered_grid(world, ["f1", "f2"])
        moved_registration, (moved, refused) = registered_grid(world, ["m1", "m2"])

        def run(ref: str, registration: int) -> int:
            return entry.run(world.profile, world.market, MARKET_COMMIT, ref, None, RUNNER_ARGV,
                             registration=registration)["trial_id"]
        world.fingerprint = ALL_TABLES
        cls.moved = run(moved, moved_registration)
        cls.refused = run(refused, moved_registration)
        world.fingerprint = FINGERPRINT
        cls.fingerprinted = run(fingerprinted, grid)
        world.fingerprint = None
        cls.unprinted = run(unprinted, grid)

    def setUp(self):
        self.world = self.__class__.world

    def reproduce(self, trial_id: int, name: str):
        return reproduce.reproduce(trial_id, self.world.output(name), ledger=self.world.profile, market=self.world.market)

    def test_the_recorded_fingerprint_is_the_sealed_fingerprint_stage(self):
        stored = metrics.load_run(self.world.conn, self.fingerprinted)
        self.assertEqual((stored["run"]["fingerprints"], stored["capture"]["stages"]["fingerprint"]["exit_code"],
                          stored["evidence"]["unavailable"]), (FINGERPRINT, 0, []))
        self.assertEqual(stored["capture"]["statuses"]["fingerprint/fingerprint.json"], "hashed",
                         "the run row keeps the fingerprint; the capture its hash")
        unprinted = metrics.load_run(self.world.conn, self.unprinted)
        self.assertEqual((unprinted["capture"]["stages"]["fingerprint"]["exit_code"],
                          unprinted["evidence"]["fingerprints"]),
                         (3, "missing"))
        self.assertEqual((unprinted["run"]["status"], [item["code"] for item in unprinted["run"]["failure_reasons"]]),
                         ("invalid", ["FINGERPRINT_FAILED"]), "a run without a fingerprint is stored invalid")

    def forged(self, ref: str, captured_receipt: str | None = None) -> int:
        """A passed run row stored without any capture, or (`captured_receipt`) with a capture listing that hash
        for the coverage receipt the container read."""
        data = strategies.read_candidate(self.world.conn, ref)["source"]
        trial_id = trials.open_trial(self.world.conn, "research", sha(data), RUNTIME,
                                     self.world.receipt(self.forged_registration), LINE_WINDOW,
                                     context(data, self.world.workdir()),
                                     register.binder(self.forged_registration, sha(data)))["trial_id"]
        if captured_receipt is not None:
            capture(self.world.conn, trial_id, data)
            self.world.service.sql(self.world.profile, "UPDATE trial_file SET sha256 = %s WHERE trial_id = %s AND "
                                   "path = 'input-coverage.json'", (captured_receipt, trial_id))
            self.world.service.sql(self.world.profile, "CALL DOLT_COMMIT('-a', '-m', 'tamper: captured receipt', "
                                                       "'--skip-verification')")
        return self.world.seal_run(trial_id)

    def test_reading_a_run_names_a_missing_capture_and_checks_the_coverage_identity(self):
        stored = metrics.load_run(self.world.conn, self.forged(self.forged_refs[0]))
        self.assertEqual(stored["evidence"]["capture"], "missing")
        self.assertEqual([item.split(":")[0] for item in stored["evidence"]["unavailable"]], ["CAPTURE_MISSING"])
        with self.assertRaises(Refusal) as caught:
            metrics.load_run(self.world.conn, self.forged(self.forged_refs[1], "0" * 64))
        self.assertEqual(caught.exception.code, "EXECUTION_IDENTITY")

    def test_a_matching_fingerprint_hands_over_the_reproduced_reports(self):
        self.world.fingerprint = FINGERPRINT
        done = self.reproduce(self.fingerprinted, "same")
        self.assertEqual((done["trial_id"], done["fingerprints_match"]), (self.fingerprinted, True))
        self.assertTrue((self.world.output("same") / "reports" / "fills.csv").is_file())
        capture = execution.read_capture(self.world.conn, done["reproduction_trial_id"])
        self.assertEqual((capture["status"], capture["purpose"]), ("captured", "explore"))
        self.assertEqual(self.world.service.sql(self.world.profile, "SELECT COUNT(*) FROM run")[0][0], 4,
                         "a reproduction stores no run")

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
class ResealTests(unittest.TestCase):
    """A reading is replaced only from a reproduction equal to every fingerprint table, in one reseal commit."""

    def setUp(self):
        self.world = ReplayWorld("reseal")
        self.addCleanup(self.world.close)
        registration, (ref,) = registered_grid(self.world, ["s1"])
        self.world.fingerprint = FINGERPRINT
        self.trial_id = entry.run(self.world.profile, self.world.market, MARKET_COMMIT, ref, None, RUNNER_ARGV,
                                  registration=registration)["trial_id"]

    def reseal(self, name: str) -> dict:
        return reproduce.reseal(self.trial_id, self.world.output(name), ledger=self.world.profile,
                                market=self.world.market)

    def reading(self) -> tuple:
        return tuple(self.world.service.sql(self.world.profile, "SELECT report, product_commit, op_id FROM run_reading "
                                                                f"WHERE trial_id = {self.trial_id}")[0])

    def test_a_new_metrics_commit_replaces_the_reading_in_one_reseal_commit(self):
        sealed = self.reading()
        unchanged = self.reseal("same-code")
        self.assertEqual((unchanged["resealed"], self.reading()), (False, sealed), "the same code writes nothing")
        with patch.object(metrics, "product_commit", return_value="f" * 40):
            done = self.reseal("new-code")
        self.assertTrue(done["resealed"])
        self.assertEqual(self.reading()[1:], ("f" * 40, done["op_id"]))
        sql = lambda query: self.world.service.sql(self.world.profile, query)  # noqa: E731
        self.assertEqual(sql(f"SELECT message FROM dolt_log WHERE commit_hash = '{done['ledger_commit']}'"),
                         [(f"reseal:{done['op_id']}",)])
        self.assertEqual(sorted(name for (name,) in sql(f"SELECT table_name FROM dolt_diff WHERE commit_hash = "
                                                         f"'{done['ledger_commit']}'")), ["ledger_head", "run_reading"],
                         "a reseal commit writes no commitment row (ledger review's check)")

    def test_a_reproduction_that_differs_leaves_the_reading(self):
        sealed = self.reading()
        self.world.fingerprint = {"fills": {"rows": 3}}
        with patch.object(metrics, "product_commit", return_value="f" * 40), self.assertRaises(Refusal) as caught:
            self.reseal("differs")
        self.assertEqual((caught.exception.code, self.reading()), ("REPRODUCTION_MISMATCH", sealed))


@unittest.skipUnless(BINARY, SKIP)
class AnotherImageTests(unittest.TestCase):
    """A product update: a run replayed on a new main build keeps its result tables, and then holds that identity."""

    @classmethod
    def setUpClass(cls):
        cls.world = world = ReplayWorld("reproduce-image")
        cls.addClassCleanup(world.close)
        registration_id, refs = registered_grid(world, ["a1", "a2", "a3", "a4", "a5"])
        world.fingerprint = ALL_TABLES
        cls.moved, cls.other, cls.unbuilt, cls.third, cls.explored = (
            entry.run(world.profile, world.market, MARKET_COMMIT, ref, None, RUNNER_ARGV,
                      registration=registration_id)["trial_id"] for ref in refs)

    def setUp(self):
        self.world = self.__class__.world
        self.resolved = []

    def resolve(self, ref):
        self.resolved.append(ref)
        return dict(NEW_IMAGE if ref == NEW_IMAGE["image_ref"] else RUNTIME)

    def replay(self, trial_id, name, image=NEW_IMAGE["image_ref"], main_build=lambda identity, inspection: "r"):
        with registration_seams.use(resolve_runtime=self.resolve, require_main_build=main_build):
            return reproduce.reproduce(trial_id, self.world.output(name), ledger=self.world.profile,
                                       market=self.world.market, image=image)

    def test_the_result_tables_decide_and_the_run_then_holds_the_new_identity(self):
        self.world.fingerprint = {**ALL_TABLES, "orders": {"rows": 2, "sha256": "a" * 64},
                                  "account": {"rows": 9, "sha256": "b" * 64},
                                  "fill_volumes": {"rows": 2, "sha256": "c" * 64}}
        done = self.replay(self.moved, "moved")
        self.assertEqual((done["image_ref"], done["tables_differing"]), (NEW_IMAGE["image_ref"], ["account", "orders"]))
        capture = execution.read_capture(self.world.conn, done["reproduction_trial_id"])
        self.assertEqual(capture["table_hashes"]["fills"], ALL_TABLES["fills"]["sha256"])
        record = register.control_trial(self.world.conn, self.moved)
        self.assertEqual([row["image_digest"] for row in record["reproductions"]], [NEW_IMAGE["image_digest"]])
        plan = {**comparability.comparable_identity(record), "image_digest": NEW_IMAGE["image_digest"]}
        comparability.check_comparable(record, plan)
        with self.assertRaises(Refusal) as caught:
            comparability.check_comparable({**record, "reproductions": []}, plan)
        self.assertEqual(caught.exception.code, "COMPARABILITY_MISMATCH")
        runs.verify_reproduction(self.world.conn, Path(done["directory"]), metrics.load_run(self.world.conn, self.moved),
                                 done["reproduction_trial_id"])
        self.assertIn(done["reproduction_trial_id"],
                      status.research_status(self.world.profile)["excluded_trials"]["reproductions"],
                      "moving a run to a new image is no new test")
        self.resolved.clear()
        self.replay(self.moved, "moved-again", image=None)
        self.assertEqual(self.resolved, [NEW_IMAGE["image_ref"]], "later replays use the newest image the run reached")

    def test_a_changed_result_table_refuses_and_adds_no_identity(self):
        for table in ("fills", "positions", "exposures", "returns_series"):
            self.world.fingerprint = {**ALL_TABLES, table: {"rows": 2, "sha256": "d" * 64}}
            with self.subTest(table=table), self.assertRaises(Refusal) as caught:
                self.replay(self.other, f"changed-{table}")
            self.assertEqual((caught.exception.code, caught.exception.write_status), ("REPRODUCTION_MISMATCH", "written"))
            self.assertIn(table, caught.exception.message)
        self.assertEqual(reproduction.reproductions(self.world.conn, self.other), [])

    def test_a_missing_result_table_is_no_match(self):
        self.world.fingerprint = {table: entry for table, entry in ALL_TABLES.items() if table != "exposures"}
        with self.assertRaises(Refusal) as caught:
            self.replay(self.third, "missing-table")
        self.assertEqual(caught.exception.code, "REPRODUCTION_MISMATCH")

    def test_another_image_must_be_a_main_build(self):
        def not_main(identity, inspection):
            raise refuse("RUNTIME_NOT_MAIN", "not on main")
        before = self.world.service.sql(self.world.profile, "SELECT COUNT(*) FROM trial")[0][0]
        with self.assertRaises(Refusal) as caught:
            self.replay(self.unbuilt, "unbuilt", main_build=not_main)
        self.assertEqual(caught.exception.code, "RUNTIME_NOT_MAIN")
        self.assertEqual(self.world.service.sql(self.world.profile, "SELECT COUNT(*) FROM trial")[0][0], before,
                         "nothing is written before the check")

    def test_a_precheck_reproduces_only_on_its_own_image(self):
        """U8 ("全按建议", 2026-11-11): the image, the configuration and the result each have their own code."""
        checked = entry.precheck(self.world.profile, self.world.market, MARKET_COMMIT, "rsi@1", RUNTIME["image_ref"],
                                 list(ARGV), self.world.output("precheck-own-image"))["trial_id"]
        before = self.world.service.sql(self.world.profile, "SELECT COUNT(*) FROM trial")[0][0]
        with self.assertRaises(Refusal) as caught:
            self.replay(checked, "precheck-other-image")
        self.assertEqual((caught.exception.code, caught.exception.write_status),
                         ("REPRODUCTION_IMAGE_DIFFERS", "not_written"))
        self.assertEqual(self.world.service.sql(self.world.profile, "SELECT COUNT(*) FROM trial")[0][0], before)

    def test_on_another_image_the_whole_configuration_must_be_equal(self):
        """B3 / C10 ("全部授权", 2026-11-10): a key only the new image's configuration holds is a difference."""
        real = registration_seams.current.inspect_runtime

        def extra(identity, runner_argv, inputs):
            found = real(identity, runner_argv, inputs)
            return {**found, "effective_config": {**found["effective_config"], "new_setting": "on"}}
        before = self.world.service.sql(self.world.profile, "SELECT COUNT(*) FROM trial")[0][0]
        with registration_seams.use(inspect_runtime=extra), self.assertRaises(Refusal) as caught:
            self.replay(self.unbuilt, "extra-setting")
        self.assertEqual(caught.exception.code, "REPRODUCTION_CONFIG_DIFFERS")
        self.assertIn("effective configuration", caught.exception.message)
        self.assertEqual(self.world.service.sql(self.world.profile, "SELECT COUNT(*) FROM trial")[0][0], before)

    def test_an_explore_without_table_hashes_never_matches_on_another_image(self):
        self.world.fingerprint = ALL_TABLES
        done = self.replay(self.explored, "explored")
        conn = self.world.conn
        self.assertTrue(reproduction.matches(conn, done["reproduction_trial_id"], self.explored))
        real = execution.read_capture
        with patch.object(execution, "read_capture", lambda c, t, *a: {**real(c, t, *a), "table_hashes": None}):
            self.assertFalse(reproduction.matches(conn, done["reproduction_trial_id"], self.explored))


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
            "--describe", "--market-root", str(inputs["root"]), "--market-day", MARKET_COMMIT,
            "--symbols", *inputs["symbols"], *(a for a in runner_argv if a not in registration_seams.ENTRY_FLAGS)])
        effective = engine_config.effective_configuration(config)
        return {"runtime_contract": identity["runtime_contract"], "effective_config": effective.values,
                "effective_config_sha256": effective.digest}

    def checked(self, name, initial=None, maintenance=None, trades=False, metrics=False, balance=None):
        argv = ["--trade-ticks"] * trades + ["--metrics"] * metrics + list(ARGV)
        if balance is not None:
            argv += ["--starting-balance", balance]
        if initial is not None:
            argv += ["--execution", "quotes", "--initial-margin", initial, "--maintenance-margin", maintenance]
        return entry.precheck(self.world.profile, self.world.market, MARKET_COMMIT, "rsi@1", RUNTIME["image_ref"],
                              argv, self.world.output(name))["trial_id"]

    def reproduce(self, trial_id, name):
        return reproduce.reproduce(trial_id, self.world.output(name), ledger=self.world.profile,
                                   market=self.world.market)

    def test_single_execution_and_on_demand_reproduction_restore_the_sealed_environment(self):
        for name, initial, maintenance, balance in (("bars", None, None, None), ("quotes", "0.05", "0.025", None),
                                                    ("other-rates", "0.02", "0.01", None),
                                                    ("small-balance", None, None, "100")):
            with self.subTest(environment=name):
                first = len(self.world.commands)
                trial_id = self.checked(name, initial, maintenance, balance=balance)
                original = execution.read_capture(self.world.conn, trial_id)
                self.assertEqual([row["module"] for row in self.world.commands[first:]],
                                 ["runner", "audit", "fingerprint"], "sealing runs the engine only once")
                done = self.reproduce(trial_id, name + "-rebuilt")
                rebuilt = execution.read_capture(self.world.conn, done["reproduction_trial_id"])
                expected = original["input_coverage"]["effective_config"]
                found = rebuilt["input_coverage"]["effective_config"]
                self.assertEqual(trials.config_key(found), trials.config_key(expected))
                self.assertEqual((found["account"]["execution"], found["account"]["initial_margin_rate"],
                                  found["account"]["maintenance_margin_rate"]),
                                 ("quotes" if initial else "bars", initial or "1", maintenance or "1"))
                self.assertEqual(found["account"]["starting_balance_usdt"], balance or "100000")
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
                                 ("REPRODUCTION_CONFIG_DIFFERS", "not_written"))
                self.assertEqual(self.world.seq(), before)
                self.assertEqual(len(self.world.commands), commands)

    def test_reproduction_exports_trades_only_when_the_original_receipt_counts_them(self):
        with patch.object(self.world.market, "export_catalogs", wraps=self.world.market.export_catalogs) as exported:
            for trades in (False, True):
                with self.subTest(trades=trades):
                    name = "trades" if trades else "no-trades"
                    trial_id = self.checked(name, "0.05", "0.025", trades=trades)
                    self.assertEqual(exported.call_args.kwargs["include_trades"], trades)
                    rebuilt = self.reproduce(trial_id, name + "-rebuilt")
                    self.assertEqual(exported.call_args.kwargs["include_trades"], trades)
                    self.assertTrue(rebuilt["fingerprints_match"])

    def test_reproduction_exports_metrics_and_passes_them_on_only_when_the_original_receipt_counts_them(self):
        with patch.object(self.world.market, "export_catalogs", wraps=self.world.market.export_catalogs) as exported:
            for metrics in (False, True):
                with self.subTest(metrics=metrics):
                    name = "metrics" if metrics else "no-metrics"
                    trial_id = self.checked(name, metrics=metrics)
                    self.assertEqual(exported.call_args.kwargs["include_metrics"], metrics)
                    first = len(self.world.commands)
                    rebuilt = self.reproduce(trial_id, name + "-rebuilt")
                    self.assertEqual(exported.call_args.kwargs["include_metrics"], metrics)
                    runner = next(row for row in self.world.commands[first:] if row["module"] == "runner")
                    self.assertEqual("--metrics" in runner["argv"], metrics)
                    self.assertTrue(rebuilt["fingerprints_match"])

    def test_changed_input_with_the_same_result_is_a_reproduction_on_those_inputs(self):
        trial_id = self.checked("quotes", "0.05", "0.025")
        export = self.world.market.export_catalogs

        def changed_export(*args, **kwargs):
            result = export(*args, **kwargs)
            (result["root"] / "AAAUSDT" / "bars.parquet").write_bytes(b"changed input")
            return result

        conn = self.world.conn
        recorded = execution.read_capture(conn, trial_id)["start"]["input_identity"]
        self.assertEqual(reproduction.reproductions(conn, trial_id), [])
        with patch.object(self.world.market, "export_catalogs", side_effect=changed_export):
            rebuilt = self.reproduce(trial_id, "changed-input")
        self.assertTrue(rebuilt["fingerprints_match"])
        changed = execution.read_capture(conn, rebuilt["reproduction_trial_id"])["start"]["input_identity"]
        self.assertNotEqual(changed["export_content_sha256"], recorded["export_content_sha256"])
        self.assertEqual([row["export_sha256"] for row in reproduction.reproductions(conn, trial_id)],
                         [changed["export_content_sha256"]])
        self.world.fingerprint = {"fills": {"rows": 3}}
        with self.assertRaises(Refusal) as caught:
            self.reproduce(trial_id, "changed-reports")
        self.assertEqual((caught.exception.code, caught.exception.write_status),
                         ("REPRODUCTION_MISMATCH", "written"))
        self.assertTrue((self.world.output("changed-reports") / "reports").is_dir())
        self.assertEqual([row["export_sha256"] for row in reproduction.reproductions(conn, trial_id)],
                         [changed["export_content_sha256"]], "a different result adds no inputs")


if __name__ == "__main__":
    unittest.main()
