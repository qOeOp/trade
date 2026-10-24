"""If these fail, research graphs no longer check their contract, place versions by research
progress, render a current page, or report the differences between a ledger and a session graph."""

import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "services/research-graph"))

from research_graph import cli, compare, contract, layout  # noqa: E402
from research_graph.renderers.web import render as render_web  # noqa: E402

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
               {"at": "2026-01-01T12:10:00Z", "kind": "line_change", "text": "line selected"}],
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
                         [("summary/1", "top"), ("lineage/2", "main"), ("progress/1", "main"), ("scatter/1", "main"), ("table/1", "main"), ("notes/1", "main"),
                          ("candidate-detail/1", "side")])
        tree = widgets["lineage"]
        nodes = {n["id"]: n for n in tree["nodes"]}
        self.assertEqual([r["id"] for r in tree["rows"]], ["root@1", "a@1", "b@1"])
        self.assertEqual((nodes["root@1"]["x"], nodes["a@1"]["x"], nodes["b@1"]["x"]), (1.0, 3.0, 5.0))
        self.assertEqual({i: n["status"] for i, n in nodes.items()},
                         {"root@1": "masked", "a@1": "recommended", "b@1": "below_targets"})
        self.assertEqual((nodes["a@1"]["prediction"], nodes["b@1"]["prediction"], nodes["root@1"]["prediction"]),
                         ("held", "mixed", "none"))
        segment, = tree["trail"]
        self.assertEqual((segment["candidate"], segment["x1"]), ("a@1", tree["axis"]["max"]))
        self.assertEqual(segment["x0"], 4.5, "a timed event sits halfway through the gap after its last trial")
        progress = widgets["progress"]
        self.assertEqual(progress["recommended"], ["a@1"])
        self.assertEqual([p["eligible"] for p in progress["points"]], [False, True, True])
        self.assertEqual(progress["axis"]["max"], tree["axis"]["max"], "the same x as the lineage")
        self.assertEqual(len(widgets["readings"]["points"]), 3)
        self.assertEqual(widgets["details"]["default"], "a@1")
        self.assertEqual({r["id"]: (r["role"], r["runs"], r["annual_return"]) for r in widgets["versions"]["rows"]},
                         {"root@1": (None, 1, 0.1), "a@1": ("recommended", 1, 0.25), "b@1": (None, 1, 0.18)})
        summary = widgets["summary"]
        self.assertEqual((summary["recommended"], summary["runs_since_recommendation_changed"], summary["masked_runs"]),
                         ("a@1", 1, 1), "one research run (trial 5) since a@1 became the recommendation")


class WebRenderTests(unittest.TestCase):
    def setUp(self):
        """A stand-in web/ whose page is already built from its current sources."""
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.tmp = Path(tmp.name)
        web = self.tmp / "web"
        (web / "src").mkdir(parents=True)
        (web / "src/App.tsx").write_text("export {}")
        (web / "package-lock.json").write_text("{}")
        page = web / "dist/index.html"
        page.parent.mkdir()
        page.write_text('<script id="research-graph-view" type="application/json">__RESEARCH_GRAPH_VIEW__</script>')
        saved = render_web.WEB, render_web.PAGE
        self.addCleanup(lambda: (setattr(render_web, "WEB", saved[0]), setattr(render_web, "PAGE", saved[1])))
        render_web.WEB, render_web.PAGE = web, page
        (page.parent / render_web.BUILT_FROM).write_text(render_web.digest(render_web.sources()))
        self.web, self.page = web, page

    def test_the_view_is_injected_once_and_cannot_close_its_script(self):
        graph = self.tmp / "graph.json"
        graph.write_text(json.dumps(GRAPH))
        out = self.tmp / "out"
        cli.run_render(str(graph), str(out), "web")
        self.assertEqual(json.loads((out / "view.json").read_text())["format"], layout.VIEW_FORMAT)
        view = layout.build_view(GRAPH)
        view["widgets"][0]["note"] = "</script><script>alert(1)</script>"
        page = render_web.render(view, out).read_text()
        self.assertNotIn("__RESEARCH_GRAPH_VIEW__", page)
        self.assertEqual(page.count("</script>"), 1, "the injected view never closes the data script")
        payload = page.split('type="application/json">', 1)[1].rsplit("</script>", 1)[0]
        self.assertEqual(json.loads(payload)["format"], layout.VIEW_FORMAT)
        self.page.write_text("no placeholder")
        (self.page.parent / render_web.BUILT_FROM).write_text(render_web.digest(render_web.sources()))
        with self.assertRaises(RuntimeError):
            render_web.render(view, out)

    def test_a_page_older_than_its_sources_is_never_served(self):
        (self.web / "src/App.tsx").write_text("export const changed = 1")
        with mock.patch.object(render_web.shutil, "which", return_value=None), \
                self.assertRaisesRegex(RuntimeError, "stale"):
            render_web.render(layout.build_view(GRAPH), self.tmp / "out")


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
