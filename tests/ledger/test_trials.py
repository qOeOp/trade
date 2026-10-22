"""Trials: the trial row, its binding and its start receipt land in one commit or not at all."""

from __future__ import annotations

import json
import unittest

from ledger import db, evidence, execution, strategies, trials
from ledger.errors import Refusal
from ledger.refusals import refuse
from tests.ledger.dolt import (BINARY, IDENTITY, RUNTIME, SKIP, Service, attempt_binder, context, inputs,
                               product_bundle, sha, source, window)


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
            for index in range(1, 6):
                plan = {"research-plan.json": json.dumps({"grid": index}).encode()}
                product_bundle(conn, f"registration-{index}", plan)

    def setUp(self):
        self.conn = db.connect(self.profile, "writer")
        self.addCleanup(self.conn.close)

    def open(self, purpose="explore", data=None, binder=None, **overrides):
        data = data if data is not None else source("published")
        arguments = {"purpose": purpose, "source_sha256": sha(data), "runtime_identity": RUNTIME,
                     "inputs": inputs(), "window": window(), "start_context": context(data, self.id()),
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

    def test_an_exploration_writes_its_trial_and_start_receipt_in_one_commit(self):
        data = source("unpublished exploration")
        opened = self.open("explore", data=data)
        trial = self.service.sql(self.profile, f"SELECT purpose, source_sha256, {db.IMAGE_DIGEST}, instruments, "
                                               "trade_start FROM trial WHERE trial_id = %s", (opened["trial_id"],))[0]
        self.assertEqual(trial[:3], ("explore", sha(data), IDENTITY["image_digest"]))
        self.assertEqual(json.loads(trial[3]), inputs()["identity"]["symbols"])
        self.assertEqual(trial[4].isoformat(), "2026-01-02T00:00:00")
        receipt = evidence.load_bundle(self.conn, opened["execution_bundle"])
        manifest = json.loads(receipt["files"]["execution.json"])
        self.assertEqual((manifest["format"], manifest["trial_id"], manifest["purpose"], manifest["runtime_identity"]),
                         ("execution_start_v1", opened["trial_id"], "explore", IDENTITY))
        self.assertEqual(manifest["input_identity"], inputs()["identity"])
        self.assertEqual(receipt["files"]["strategy.py"], data)
        commits = {commit for (commit,) in self.service.sql(
            self.profile, "SELECT to_commit FROM dolt_diff_trial WHERE to_trial_id = %s UNION ALL SELECT to_commit "
                          "FROM dolt_diff_evidence_bundle WHERE to_bundle = %s",
            (opened["trial_id"], opened["execution_bundle"]))}
        self.assertEqual(commits, {opened["ledger_commit"]})
        again = self.open("explore", data=data)
        self.assertEqual((again["trial_id"], again["replayed"]), (opened["trial_id"], True))
        retry = self.open("explore", data=data, start_context=context(data, "/tmp/replay-new"))
        self.assertNotEqual(retry["trial_id"], opened["trial_id"])

    def test_a_research_trial_consumes_its_grid_point_in_the_same_commit(self):
        opened = self.open("research", binder=attempt_binder("registration-1", self.published))
        rows = self.service.sql(self.profile, "SELECT registration_bundle, run_status FROM v_trials WHERE trial_id = %s",
                                (opened["trial_id"],))
        self.assertEqual(rows, [("registration-1", None)])

    def test_a_trial_inside_the_callers_write_lands_with_it(self):
        def insert(conn, op):
            opened = self.open("precheck", start_context=context(source("published"), "/tmp/joined"))
            conn.rows("INSERT INTO evidence_bundle (bundle, op_id, created_at) VALUES ('joined-note', %s, NOW())",
                      (op,))
            conn.rows("INSERT INTO evidence_content (content) VALUES ('b')")
            conn.rows("INSERT INTO evidence (bundle, path, sha256) VALUES ('joined-note', 'a', SHA2('b', 256))")
            return opened

        written = db.write(self.conn, "replay", {"joined": True}, "evidence_bundle", insert)
        self.assertIsNone(written["record"]["ledger_commit"])
        trial_commit, = self.service.sql(self.profile, "SELECT to_commit FROM dolt_diff_trial WHERE to_trial_id = %s",
                                         (written["record"]["trial_id"],))[0]
        self.assertEqual(trial_commit, written["commit"])

    def test_purpose_and_binder_refusals(self):
        binder = attempt_binder("registration-2", self.published)
        self.assertEqual(self.code(purpose="explore", binder=binder), "BINDING_NOT_ALLOWED")
        self.assertEqual(self.code(purpose="precheck", binder=binder), "BINDING_NOT_ALLOWED")
        self.assertEqual(self.code(purpose="research"), "BINDING_REQUIRED")
        self.assertEqual(self.code(purpose="validation"), "BINDING_REQUIRED")
        self.assertEqual(self.code(purpose="precheck", data=source("never published")), "SOURCE_NOT_PUBLISHED")
        self.assertEqual(self.code(purpose="research", data=source("never published"), binder=binder),
                         "SOURCE_NOT_PUBLISHED")

    def test_runtime_and_input_refusals(self):
        for runtime in ({**RUNTIME, "image_ref": "ghcr.io/qoeop/trade-runtime:main"},
                        {**RUNTIME, "image_digest": "sha256:" + "c" * 64}, {**IDENTITY}, {**RUNTIME, "inspection": {}}):
            with self.subTest(runtime=runtime):
                self.assertEqual(self.code(runtime_identity=runtime), "RUNTIME_NOT_PINNED")
        for field in ("market_commit", "universe_rule", "symbols", "export_content_sha256"):
            incomplete = inputs()
            del incomplete["identity"][field]
            with self.subTest(field=field):
                self.assertEqual(self.code(inputs=incomplete), "TRIAL_INPUT_INCOMPLETE")
        self.assertEqual(self.code(inputs={**inputs(), "input_coverage": b""}), "TRIAL_INPUT_INCOMPLETE")
        self.assertEqual(self.code(window={"start": 0, "end": 1}), "TRIAL_INPUT_INCOMPLETE")
        late = window()
        for broken in ({**late, "start": late["trade_start"] + 1}, {**late, "end": late["trade_start"]},
                       {**late, "start": late["start"] + 1_000_000_000}):
            with self.subTest(window=broken):
                self.assertEqual(self.code(window=broken), "WINDOW_INVALID")

    def test_any_refusal_inside_the_transaction_rolls_everything_back(self):
        trials_before = self.service.sql(self.profile, "SELECT COUNT(*) FROM trial")

        def too_late(conn, trial_id):
            conn.rows("INSERT INTO registration_attempt VALUES ('registration-3', %s, %s)", (self.published, trial_id))
            raise refuse("REGISTRATION_TOO_LATE", "the registration is not older than the trial")

        self.assertEqual(self.code(purpose="research", binder=too_late), "REGISTRATION_TOO_LATE")
        self.assertEqual(self.code(start_context=context(source("not the executed bytes"))), "EXECUTION_IDENTITY")
        unbound = lambda conn, trial_id: None  # noqa: E731 - a validation binder that forgets its binding row
        self.assertEqual(self.code(purpose="validation", binder=unbound), "COMMIT_CHECK_FAILED")
        consumed = attempt_binder("registration-4", self.published)
        self.open("research", binder=consumed)
        self.assertEqual(self.code(purpose="research", binder=consumed,
                                   start_context=context(source("published"), "/tmp/second")), "DOLT_SQL_ERROR")
        self.assertEqual(self.service.sql(self.profile, "SELECT COUNT(*) FROM trial")[0][0], trials_before[0][0] + 1)
        self.assertEqual(self.service.sql(self.profile, "SELECT COUNT(*) FROM registration_attempt "
                                                        "WHERE registration_bundle = 'registration-3'"), [(0,)])

    def test_start_receipt_refusals(self):
        def insert(conn, op):
            return execution.start_receipt(conn, 999_999, {}, op)

        with self.assertRaises(Refusal) as caught:
            db.write(self.conn, "probe", {"receipt": 1}, "evidence_bundle", insert)
        self.assertEqual(caught.exception.code, "TRIAL_NOT_FOUND")
        opened = self.open("explore", data=source("receipt"), start_context=context(source("receipt"), "/tmp/r"))

        def twice(conn, op):
            return execution.start_receipt(conn, opened["trial_id"], {
                "source_sha256": sha(source("receipt")), "runtime_identity": IDENTITY,
                "source_bytes": source("receipt"), "input_coverage": b"{}", "workdir": "/tmp/other"}, "other-op")

        with self.assertRaises(Refusal) as caught:
            db.write(self.conn, "probe", {"receipt": 2}, "evidence_bundle", twice)
        self.assertEqual(caught.exception.code, "BUNDLE_EXISTS")


if __name__ == "__main__":
    unittest.main()
