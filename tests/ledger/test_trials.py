"""Trials: the trial row, its instruments, binding and start bundle land in one commit or not at all."""

from __future__ import annotations

from datetime import date
from decimal import Decimal
import json
from pathlib import Path
import shutil
import tempfile
import unittest

from ledger import db, evidence, execution, problems, strategies, trials
from shared.errors import Refusal
from shared.refusals import refuse
from tests.ledger.dolt import (BINARY, IDENTITY, RUNTIME, SKIP, SYMBOLS, Service, binder, context, coverage,
                               grid_point, select_line, sha, source, window)
from tests.helpers import refused


@unittest.skipUnless(BINARY, SKIP)
class OpenTrialTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.service = Service()
        cls.addClassCleanup(cls.service.close)
        cls.profile = cls.service.ledger("trials")
        strategies.publish_candidate(cls.profile, source("published"), "published", "Fixture", "root")
        cls.published = sha(source("published"))
        with db.connect(cls.profile, "writer") as conn:
            cls.line = select_line(conn, "published@1", "published-root", source("published"))["line_id"]
            cls.registrations = [grid_point(conn, cls.line, source("published"), coverage(export_content_sha256=c * 64))
                                 for c in "123"]

    def setUp(self):
        self.conn = db.connect(self.profile, "writer")
        self.addCleanup(self.conn.close)

    def directory(self) -> str:
        path = tempfile.mkdtemp(prefix="lt-", dir="/tmp")
        self.addCleanup(shutil.rmtree, path, ignore_errors=True)
        return path

    def open(self, purpose="explore", data=None, binder=None, **overrides):
        data = data if data is not None else source("published")
        arguments = {"purpose": purpose, "source_sha256": sha(data), "runtime_identity": RUNTIME,
                     "input_coverage": coverage(), "window": window(), "start_context": context(data),
                     "binder": binder, **overrides}
        return trials.open_trial(self.conn, **arguments)

    def code(self, **kwargs) -> str:
        seq = self.seq()
        with self.assertRaises(Refusal) as caught:
            self.open(**kwargs)
        self.assertEqual(self.seq(), seq)
        return caught.exception.code

    def seq(self) -> int:
        return self.service.sql(self.profile, "SELECT seq FROM ledger_head")[0][0]

    def research(self, index: int):
        """The binder and coverage receipt of the grid point of registration `index`."""
        return binder(self.line, self.registrations[index]), coverage(export_content_sha256=str(index + 1) * 64)

    def test_an_exploration_writes_its_trial_instruments_and_start_bundle_in_one_commit(self):
        data = source("unpublished exploration")
        workdir = self.directory()
        opened = self.open("explore", data=data, start_context=context(data, workdir))
        trial = self.service.sql(self.profile, f"SELECT purpose, source_sha256, {db.IMAGE_DIGEST}, platform, "
                                               "runtime_contract, market_day, universe_rule, export_sha256, "
                                               "execution, starting_balance, trade_start, runner_argv, line_id "
                                               "FROM trial WHERE trial_id = %s", (opened["trial_id"],))[0]
        self.assertEqual(trial[:10], ("explore", sha(data), IDENTITY["image_digest"], IDENTITY["platform"],
                                      IDENTITY["runtime_contract"], date(2026, 3, 1), "pool-v1", "e" * 64, "bars",
                                      Decimal("100000")))
        self.assertEqual(trial[10].isoformat(), "2026-01-02T00:00:00")
        self.assertEqual((json.loads(trial[11]), trial[12]), (context(data)["argv"], None))
        self.assertEqual([row[0] for row in self.service.sql(
            self.profile, "SELECT instrument_id FROM trial_instrument WHERE trial_id = %s ORDER BY instrument_id",
            (opened["trial_id"],))], sorted(SYMBOLS))
        self.assertEqual(opened["start_bundle"], f"trial-{opened['trial_id']}-start")
        start = evidence.load_bundle(self.conn, opened["start_bundle"])
        self.assertEqual((start["kind"], start["trial_id"]), ("start", opened["trial_id"]))
        self.assertEqual(start["files"], {problems.COVERAGE: coverage(), execution.SOURCE: data})
        commits = {commit for (commit,) in self.service.sql(
            self.profile, "SELECT to_commit FROM dolt_diff_trial WHERE to_trial_id = %s UNION ALL SELECT to_commit "
                          "FROM dolt_diff_trial_instrument WHERE to_trial_id = %s UNION ALL SELECT to_commit "
                          "FROM dolt_diff_evidence_bundle WHERE to_bundle = %s",
            (opened["trial_id"], opened["trial_id"], opened["start_bundle"]))}
        self.assertEqual(commits, {opened["ledger_commit"]})
        marker = json.loads((Path(workdir) / execution.WORKDIR_MARKER).read_bytes())
        self.assertEqual(marker["trial_id"], opened["trial_id"])
        again = self.open("explore", data=data, start_context=context(data, workdir))
        self.assertEqual((again["trial_id"], again["replayed"]), (opened["trial_id"], True))
        retry = self.open("explore", data=data, start_context=context(data, self.directory()))
        self.assertNotEqual(retry["trial_id"], opened["trial_id"])

    def test_a_published_source_is_not_stored_again_in_its_start_bundle(self):
        opened = self.open("precheck", window=window(1))
        files = evidence.load_bundle(self.conn, opened["start_bundle"])["files"]
        self.assertEqual(set(files), {problems.COVERAGE})

    def test_a_research_trial_names_its_line_and_registration(self):
        bind, receipt = self.research(0)
        opened = self.open("research", binder=bind, input_coverage=receipt)
        rows = self.service.sql(self.profile, "SELECT line_id, research_registration_id, validation_registration_id "
                                              "FROM trial WHERE trial_id = %s", (opened["trial_id"],))
        self.assertEqual(rows, [(self.line, self.registrations[0], None)])

    def test_a_research_trial_must_share_its_registrations_execution_identity_and_grid_point(self):
        bind, _ = self.research(1)
        for receipt in (coverage(export_content_sha256="9" * 64), coverage("n" * 32, export_content_sha256="2" * 64),
                        coverage(export_content_sha256="2" * 64, universe_rule="pool-v2")):
            with self.subTest(receipt=json.loads(receipt)["input_identity"]):
                self.assertEqual(self.code(purpose="research", binder=bind, input_coverage=receipt), "DOLT_SQL_ERROR")
        self.assertEqual(self.code(purpose="research", binder=bind, input_coverage=self.research(1)[1],
                                   runtime_identity={**RUNTIME, "image_ref": "ghcr.io/qoeop/other@" +
                                                     IDENTITY["image_digest"]}), "DOLT_SQL_ERROR")
        strategies.publish_candidate(self.profile, source("off the grid"), "offgrid", "Fixture", "root")
        self.assertEqual(self.code(purpose="research", binder=bind, input_coverage=self.research(1)[1],
                                   data=source("off the grid")), "DOLT_SQL_ERROR")
        self.assertEqual(self.code(purpose="research", binder=binder(self.line + 1000, self.registrations[1]),
                                   input_coverage=self.research(1)[1]), "DOLT_SQL_ERROR")

    def test_a_trial_inside_the_callers_write_lands_with_it(self):
        def insert(conn, op):
            opened = self.open("precheck", window=window(2))
            evidence.write_files(conn, "joined-note", {"a": b"b"}, kind="agent", op_id=op)
            return opened

        written = db.write(self.conn, "replay", {"joined": True}, "evidence_bundle", insert)
        self.assertIsNone(written["record"]["ledger_commit"])
        trial_commit, = self.service.sql(self.profile, "SELECT to_commit FROM dolt_diff_trial WHERE to_trial_id = %s",
                                         (written["record"]["trial_id"],))[0]
        self.assertEqual(trial_commit, written["commit"])

    def test_purpose_and_binder_refusals(self):
        bind, receipt = self.research(1)
        self.assertEqual(self.code(purpose="explore", binder=bind), "BINDING_NOT_ALLOWED")
        self.assertEqual(self.code(purpose="precheck", binder=bind), "BINDING_NOT_ALLOWED")
        self.assertEqual(self.code(purpose="research"), "BINDING_REQUIRED")
        self.assertEqual(self.code(purpose="validation"), "BINDING_REQUIRED")
        self.assertEqual(self.code(purpose="precheck", data=source("never published")), "SOURCE_NOT_PUBLISHED")
        self.assertEqual(self.code(purpose="research", data=source("never published"), binder=bind,
                                   input_coverage=receipt), "SOURCE_NOT_PUBLISHED")
        with self.assertRaises(ValueError):
            self.open("research", binder=lambda conn, row: {"line_id": self.line, "purpose": "explore"},
                      input_coverage=receipt)

    def test_runtime_and_input_refusals(self):
        for runtime in ({**RUNTIME, "image_ref": "ghcr.io/qoeop/trade-runtime:main"},
                        {**RUNTIME, "image_digest": "sha256:" + "c" * 64}, {**IDENTITY}, {**RUNTIME, "inspection": {}}):
            with self.subTest(runtime=runtime):
                self.assertEqual(self.code(runtime_identity=runtime), "RUNTIME_NOT_PINNED")
        for field in ("market_day", "universe_rule", "symbols", "export_content_sha256"):
            incomplete = json.loads(coverage())
            del incomplete["input_identity"][field]
            with self.subTest(field=field):
                self.assertEqual(self.code(input_coverage=json.dumps(incomplete).encode()), "TRIAL_INPUT_INCOMPLETE")
        for account in ({**json.loads(coverage())["effective_config"]["account"], "execution": "ticks"},
                        {**json.loads(coverage())["effective_config"]["account"], "starting_balance_usdt": "0"}):
            receipt = json.loads(coverage())
            receipt["effective_config"]["account"] = account
            with self.subTest(account=account):
                self.assertEqual(self.code(input_coverage=json.dumps(receipt).encode()), "TRIAL_INPUT_INCOMPLETE")
        self.assertEqual(self.code(input_coverage=b""), "TRIAL_INPUT_INCOMPLETE")
        self.assertEqual(self.code(input_coverage=b"not json"), "TRIAL_INPUT_INCOMPLETE")
        self.assertEqual(self.code(window={"start": 0, "end": 1}), "TRIAL_INPUT_INCOMPLETE")
        late = window()
        for broken in ({**late, "start": late["trade_start"] + 1}, {**late, "end": late["trade_start"]},
                       {**late, "start": late["start"] + 1_000_000_000}):
            with self.subTest(window=broken):
                self.assertEqual(self.code(window=broken), "WINDOW_INVALID")

    def test_any_refusal_inside_the_transaction_rolls_everything_back(self):
        trials_before = self.service.sql(self.profile, "SELECT COUNT(*) FROM trial")[0][0]
        bundles_before = self.service.sql(self.profile, "SELECT COUNT(*) FROM evidence_bundle")[0][0]
        _, receipt = self.research(2)

        def too_late(conn, row):
            conn.rows("INSERT INTO evidence_content (content) VALUES ('binder side effect')")
            raise refuse("REGISTRATION_TOO_LATE", "the registration is not older than the trial")

        self.assertEqual(self.code(purpose="research", binder=too_late, input_coverage=receipt),
                         "REGISTRATION_TOO_LATE")
        self.assertEqual(self.code(start_context=context(source("not the executed bytes"))), "EXECUTION_IDENTITY")
        unbound = lambda conn, row: {}  # a validation binder that forgets its registration
        self.assertEqual(self.code(purpose="validation", binder=unbound), "DOLT_SQL_ERROR")
        consumed = binder(self.line, self.registrations[2])
        self.open("research", binder=consumed, input_coverage=receipt)
        self.assertEqual(self.code(purpose="research", binder=consumed, input_coverage=receipt, window=window(3)),
                         "DOLT_SQL_ERROR")
        self.assertEqual(self.service.sql(self.profile, "SELECT COUNT(*) FROM trial")[0][0], trials_before + 1)
        self.assertEqual(self.service.sql(self.profile, "SELECT COUNT(*) FROM evidence_bundle")[0][0],
                         bundles_before + 1)
        self.assertEqual(self.service.sql(self.profile, "SELECT COUNT(*) FROM evidence_content WHERE content = "
                                                        "'binder side effect'"), [(0,)])

    def test_a_trial_has_one_start_bundle(self):
        opened = self.open("explore", data=source("start"), start_context=context(source("start")), window=window(4))

        def again(conn, op):
            return execution.start_bundle(conn, opened["trial_id"], b"{\"other\": 1}", source("start"))

        self.assertEqual(refused(db.write, self.conn, "probe", {"start": opened["trial_id"]}, "evidence_bundle",
                                 again).code, "BUNDLE_EXISTS")
