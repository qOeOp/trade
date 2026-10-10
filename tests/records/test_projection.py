"""Brief reads remain useful and bounded even with detailed replay payloads."""

import copy
import json
import unittest

from research.records.projections import BRIEF_LIMIT, bounded_brief


class BriefProjectionTests(unittest.TestCase):
    def test_event_arrays_and_duplicate_bytes_do_not_leak_into_brief(self):
        payload = {"commit": "fixed", "object": {"id": "evidence:H25a", "revision": 4, "kind": "evidence_json",
                   "body": {"summary": {"return_pct": -2.1, "events": ["event" * 1000] * 1000},
                            "decision": {"scope": "Paired native replay", "next_action": "Reject hypothesis"},
                            "content_base64": "secretbytes" * 100000},
                   "provenance": {"path": "reports/h25a.json", "raw_content_base64": "secretbytes" * 100000,
                                  "original_registration": {"raw_content_base64": "duplicate" * 100000}}},
                   "relations": [{"id": "edge", "kind": "evidence", "from_id": "evidence:H25a", "from_revision": 4,
                                  "to_id": "attempt:H25a", "to_revision": 1,
                                  "body": {"raw_content_base64": "duplicate" * 100000,
                                           "scope": "Native account", "proof": {"sha256": "a" * 64}}}]}
        before = copy.deepcopy(payload)
        result = bounded_brief(payload, at="fixed", identity="evidence:H25a", revision=4)
        encoded = json.dumps(result, ensure_ascii=False, indent=2).encode()
        self.assertLessEqual(len(encoded), BRIEF_LIMIT)
        self.assertNotIn(b"secretbytes", encoded)
        self.assertNotIn(b"duplicate", encoded)
        self.assertEqual(result["object"]["body"]["summary"]["return_pct"], -2.1)
        self.assertEqual(result["object"]["body"]["decision"]["next_action"], "Reject hypothesis")
        self.assertEqual(result["full_read"], {"command": "material show", "at": "fixed", "id": "evidence:H25a", "revision": 4})
        self.assertTrue(result["truncated"])
        self.assertIn("object.body.summary.events", result["omitted_fields"])
        self.assertEqual(payload, before)

    def test_wide_multibyte_summary_still_respects_total_rendered_byte_limit(self):
        payload = {"attempt_id": "H25a", "decision": {"scope": "保持研究范围", "next_action": "继续查询固定证据"},
                   "metrics": {"c" + str(index): "很长的研究指标" * 1000 for index in range(500)}}
        result = bounded_brief(payload, at="fixed", identity="H25a", command="show")
        self.assertLessEqual(len(json.dumps(result, ensure_ascii=False, indent=2).encode()), BRIEF_LIMIT)
        self.assertEqual(result["attempt_id"], "H25a")
        self.assertEqual(result["full_read"]["command"], "show")
        self.assertTrue(result["truncated"])

    def test_native_report_retains_account_economics_and_small_coin_counts(self):
        payload = {"object": {"id": "evidence:native", "revision": 1, "kind": "evidence_json",
                   "provenance": {}, "body": {"period_return_pct": -3.2, "native_sharpe_365": 0.1,
                   "final_equity_usdt": 9680, "per_coin": [
                       {"coin": str(index), "instrument": "X-PERP.BINANCE", "counts": {"closed": 3},
                        "positions": ["event" * 1000] * 20} for index in range(37)]}}}
        result = bounded_brief(payload, at="fixed", identity="evidence:native", revision=1)
        self.assertEqual(result["object"]["body"]["period_return_pct"], -3.2)
        self.assertEqual(len(result["object"]["body"]["per_coin_summary"]), 37)
        self.assertEqual(result["object"]["body"]["per_coin_summary"][0]["counts"], {"closed": 3})
        self.assertNotIn("positions", result["object"]["body"]["per_coin_summary"][0])
        self.assertIn("object.body.per_coin", result["omitted_fields"])

    def test_unknown_nested_list_paths_are_omitted_and_important_decision_survives_budget(self):
        payload = {"attempt_id": "H25a", "decision": {"scope": "scope " * 1000, "next_action": "reject"},
                   "summary": {"positions": [{"time": 1}] * 500, "other_detail": [{"time": 1}] * 500},
                   "metrics": {str(index): "值" * 1000 for index in range(60)}}
        result = bounded_brief(payload, at="fixed", identity="H25a", command="show")
        self.assertLessEqual(len((json.dumps(result, ensure_ascii=False, indent=2) + "\n").encode()), BRIEF_LIMIT)
        self.assertIn("scope", result["decision"])
        self.assertEqual(result["decision"]["next_action"], "reject")
        self.assertIn("summary.positions", result["omitted_fields"])
        self.assertIn("summary.other_detail", result["omitted_fields"])


if __name__ == "__main__":
    unittest.main()
