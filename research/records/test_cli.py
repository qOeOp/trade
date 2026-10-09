"""Boundary checks for the read-only research record pilot."""

import copy
import unittest

from research.records.cli import (
    RecordError,
    _check_family,
    _check_source_revision,
    _brief,
    _compare,
    _lineage,
    _load_records,
    _show,
)


class ResearchRecordBoundaryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from research.records.store import GitHistoryStore
        cls.attempts, cls.runs = _load_records(GitHistoryStore())

    def test_h13c_lineage_keeps_both_failed_source_gates(self):
        chain = _lineage("H13c", self.attempts)
        self.assertEqual(chain["parents"][0]["record"]["attempt_id"], "H13b")
        self.assertEqual(
            chain["parents"][0]["record"]["parents"][0]["record"]["attempt_id"],
            "H13",
        )
        self.assertEqual(chain["parents"][0]["record"]["decision"]["layer"], "source")

    def test_h18a_reuses_a_failed_source_component_without_inheriting_h08(self):
        chain = _lineage("H18a", self.attempts)
        self.assertEqual(chain["composition_mode"], "dependent")
        self.assertEqual(
            [parent["record"]["attempt_id"] for parent in chain["parents"]], ["H15a"]
        )
        self.assertEqual(chain["mechanism_sources"][0]["attempt_id"], "H08")
        self.assertEqual(
            chain["mechanism_sources"][0]["source_decision"]["layer"], "source"
        )
        self.assertEqual(
            chain["mechanism_sources"][0]["source_decision"]["outcome"], "failed"
        )

    def test_h18a_has_a_paired_account_control(self):
        result = _compare("H18a-2026-10-08", "H15a-paired-2026-10-08", self.runs)
        self.assertEqual(
            result["metrics"]["final_equity_usdt"]["difference"], "741.36172627"
        )
        self.assertEqual(result["evidence_grade"], "development_exposed")

    def test_f01_reads_both_parents_and_four_native_cells(self):
        record = _show("F01", self.attempts, self.runs)
        self.assertEqual(record["lineage"]["composition_mode"], "factorial")
        self.assertEqual(
            {parent["record"]["attempt_id"] for parent in record["lineage"]["parents"]},
            {"H19a", "H18a"},
        )
        self.assertEqual(set(record["comparison_runs"]), {"00", "10", "01", "11"})
        result = _compare("F01-11-20261008", "F01-10-20261008", self.runs)
        self.assertEqual(
            result["metrics"]["final_equity_usdt"]["difference"], "-582.64175047"
        )
        self.assertEqual(result["source_revision_status"], ["verified", "verified"])

    def test_brief_preserves_decision_control_and_evidence_status(self):
        brief = _brief("F01", self.attempts, self.runs)
        self.assertEqual(brief["decision"]["outcome"], "failed")
        self.assertEqual(
            {parent["record"]["attempt_id"] for parent in brief["lineage"]["parents"]},
            {"H19a", "H18a"},
        )
        self.assertEqual(set(brief["comparison_family"]), {"00", "10", "01", "11"})
        self.assertEqual(
            next(run for run in brief["runs"] if run["run_id"] == "F01-11-20261008")[
                "control_run_id"
            ],
            "F01-10-20261008",
        )
        self.assertTrue(
            all(item["status"] == "verified" for item in brief["evidence_status"])
        )
        lineage = _brief("H13c", self.attempts, self.runs)["lineage"]
        self.assertEqual(
            lineage["parents"][0]["record"]["parents"][0]["record"]["attempt_id"],
            "H13",
        )

    def test_four_cell_index_rejects_missing_run(self):
        attempt = self.attempts["F01"]
        family = copy.deepcopy(attempt["comparison_family"])
        family["cells"]["11"] = "missing-run"
        with self.assertRaisesRegex(RecordError, "11 missing"):
            _check_family(attempt, family, self.attempts, self.runs)

    def test_h18a_source_commit_matches_native_run_bytes(self):
        self.assertEqual(
            _check_source_revision(self.runs["H18a-2026-10-08"]), "verified"
        )
        self.assertEqual(
            _check_source_revision(self.runs["H15a-paired-2026-10-08"]), "verified"
        )

    def test_source_commit_mismatch_is_not_recoverable_source(self):
        run = copy.deepcopy(self.runs["H18a-2026-10-08"])
        run["source_files_sha256"]["tiered_strategy_source_sha256"] = "0" * 64
        with self.assertRaisesRegex(RecordError, "source revision hash mismatch"):
            _check_source_revision(run)

    def test_comparison_rejects_account_drift_before_scoring(self):
        runs = copy.deepcopy(self.runs)
        runs["H19a-2026-10-08"]["account"]["starting_balance_usdt"] = "50000"
        with self.assertRaisesRegex(RecordError, "account"):
            _compare("H19a-2026-10-08", "H18a-paired-2026-10-08", runs)

    def test_comparison_requires_the_registered_control(self):
        runs = copy.deepcopy(self.runs)
        runs["H19a-2026-10-08"]["control_run_id"] = None
        with self.assertRaisesRegex(RecordError, "registered control"):
            _compare("H19a-2026-10-08", "H18a-paired-2026-10-08", runs)


if __name__ == "__main__":
    unittest.main()
