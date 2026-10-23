"""If these fail, research graphs no longer check their contract, place versions by research
progress, draw without script, or report the differences between a ledger and a session graph."""

import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "services/research-graph"))

from research_graph import cli, compare, contract, layout  # noqa: E402
from research_graph.renderers.static import render as render_static  # noqa: E402

GRAPH = {
    "format": "research-graph/1", "source": "ledger",
    "scope": {"start": "2026-01-01T10:00:00Z"},
    "line": {"bundle": "research-line-20260101-x", "start": "root@1", "window": ["2025-01-01", "2026-01-01"],
             "targets": {"max_drawdown": 0.15, "annual_return": 0.2}},
    "candidates": [
        {"id": "root@1", "parent": None, "created_at": "2026-01-01T09:00:00",
         "trials": [{"trial_id": 1, "purpose": "precheck"},
                    {"trial_id": 2, "purpose": "research", "annual_return": 0.1, "max_drawdown": 0.2, "eligible": False,
                     "ineligible_reason": "SOURCE_REVIEW_FAILED", "at": "2026-01-01T09:30:00"}]},
        {"id": "a@1", "parent": "root@1", "created_at": "2026-01-01T11:00:00",
         "predictions": [{"measure": "m", "direction": "up", "outcome": "held"}],
         "trials": [{"trial_id": 3, "purpose": "precheck"},
                    {"trial_id": 4, "purpose": "research", "annual_return": 0.25, "max_drawdown": 0.1, "eligible": True,
                     "at": "2026-01-01T11:30:00"}], "status": "recommended"},
        {"id": "b@1", "parent": "a@1", "created_at": "2026-01-01T12:00:00",
         "predictions": [{"measure": "m", "direction": "up", "outcome": "held"},
                         {"measure": "n", "direction": "down", "outcome": "failed"}],
         "trials": [{"trial_id": 5, "purpose": "research", "annual_return": 0.18, "max_drawdown": 0.09, "eligible": True,
                     "at": "2026-01-01T12:30:00"}]},
    ],
    "events": [{"at": "2026-01-01T11:45:00Z", "kind": "recommendation", "ref": "judgment 7", "recommends": "a@1"},
               {"at": "2026-01-01T12:10:00Z", "kind": "user_message", "text": "?"}],
    "gaps": [],
}


class ContractTests(unittest.TestCase):
    def test_a_graph_breaking_the_contract_is_reported(self):
        self.assertEqual(contract.check_graph(GRAPH), [])
        broken = copy.deepcopy(GRAPH)
        broken["candidates"][1]["parent"] = "ROOT"
        broken["candidates"][2]["trials"][0]["purpose"] = "rerun"
        found = contract.check_graph(broken)
        self.assertTrue(any("purpose" in p for p in found), found)
        broken["candidates"][2]["trials"][0]["purpose"] = "research"
        self.assertEqual(contract.check_graph(broken), ["$.candidates[1].parent: unknown candidate ROOT"])


class LayoutTests(unittest.TestCase):
    def test_versions_sit_at_their_first_trial_in_lineage_rows(self):
        view = layout.build_view(GRAPH)
        widgets = {w["id"]: w for w in view["widgets"]}
        self.assertEqual([(w["type"], w["slot"]) for w in view["widgets"]],
                         [("summary/1", "top"), ("lineage/1", "main"), ("scatter/1", "main"), ("notes/1", "main"),
                          ("candidate-detail/1", "side")])
        tree = widgets["lineage"]
        nodes = {n["id"]: n for n in tree["nodes"]}
        self.assertEqual([r["id"] for r in tree["rows"]], ["root@1", "a@1", "b@1"])
        self.assertEqual((nodes["root@1"]["x"], nodes["a@1"]["x"], nodes["b@1"]["x"]), (1.0, 3.0, 5.0))
        self.assertEqual({i: n["status"] for i, n in nodes.items()},
                         {"root@1": "masked", "a@1": "recommended", "b@1": "below_targets"})
        self.assertEqual((nodes["a@1"]["prediction"], nodes["b@1"]["prediction"], nodes["root@1"]["prediction"]),
                         ("held", "mixed", "none"))
        band, = tree["bands"]
        self.assertEqual((band["candidate"], band["x1"]), ("a@1", tree["axis"]["max"]))
        self.assertTrue(4 < band["x0"] < 5, "a timed event sits between the trials around its time")
        lanes = {lane["kind"]: lane["events"] for lane in tree["lanes"]}
        self.assertEqual(len(lanes["user_message"]), 1)
        self.assertEqual(len(widgets["readings"]["points"]), 3)
        self.assertEqual(widgets["details"]["default"], "a@1")
        summary = widgets["summary"]
        self.assertEqual((summary["recommended"], summary["runs_since_recommendation_changed"], summary["masked_runs"]),
                         ("a@1", 1, 1), "one research run (trial 5) since a@1 became the recommendation")


class RenderTests(unittest.TestCase):
    def test_the_static_page_draws_every_version_without_script(self):
        with tempfile.TemporaryDirectory() as tmp:
            graph = Path(tmp) / "graph.json"
            graph.write_text(json.dumps(GRAPH))
            page = cli.run_render(str(graph), str(Path(tmp) / "out"), "static").read_text()
            view = json.loads((Path(tmp) / "out/view.json").read_text())
        self.assertNotIn("<script", page)
        self.assertEqual(view["format"], layout.VIEW_FORMAT)
        for cid in ("root@1", "a@1", "b@1"):
            self.assertIn(f'id="c-{cid.replace("@", "_")}"', page)
        self.assertIn('detail default" id="c-a_1"', page, "the current recommendation opens first")
        view["widgets"].append({"id": "future", "type": "heatmap/1", "slot": "main"})
        with tempfile.TemporaryDirectory() as tmp:
            unknown = render_static.render(view, Path(tmp)).read_text()
        self.assertIn("heatmap/1", unknown, "an unknown widget type is named, not dropped silently")


class CompareTests(unittest.TestCase):
    def test_differences_up_to_the_cutoff_are_listed(self):
        session = copy.deepcopy(GRAPH)
        session["source"] = "session"
        session["candidates"][2]["parent"] = "root@1"
        session["candidates"][1]["trials"][1]["annual_return"] = 0.2504
        session["candidates"][1]["trials"][1]["max_drawdown"] = 0.12
        session["candidates"][1]["predictions"] = []
        session["candidates"].append({"id": "late@1", "parent": "a@1", "created_at": "2026-01-02T00:00:00Z"})
        diff = compare.compare(GRAPH, session, "2026-01-01T23:00:00Z")
        self.assertEqual(diff["only_b"], [], "a candidate after the cutoff is out of scope")
        self.assertEqual(diff["parent"], [{"id": "b@1", "a": "a@1", "b": "root@1"}])
        self.assertEqual([(d["measure"], d["b"]) for d in diff["measures"]], [("max_drawdown", 0.12)],
                         "a reading within the tolerance is not a difference")
        self.assertEqual(diff["predictions"], [{"id": "a@1", "a": {"held": 1}, "b": {}}])
        self.assertEqual(diff["events"]["a"], diff["events"]["b"])
        self.assertIn("## Parent differs (1)", compare.markdown(diff))


if __name__ == "__main__":
    unittest.main()
