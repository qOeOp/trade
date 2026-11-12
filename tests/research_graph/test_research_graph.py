"""If these fail, research graphs no longer check their contract, place versions by research
progress, serve a current page, or report the differences between a ledger and a session graph."""

import copy
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "ide"))

from research_graph import compare, contract, layout  # noqa: E402
from research_graph import render as render_web  # noqa: E402

GRAPH = {
    "format": "research-graph@3", "source": "ledger",
    "scope": {"start": "2026-01-01T10:00:00Z"},
    "line": {"bundle": "research-line-20260101-x", "start": "root@1", "window": ["2025-01-01", "2026-01-01"],
             "targets": {"max_drawdown": 0.15, "annual_return": 0.2}},
    "candidates": [
        {"id": "root@1", "parent": None, "created_at": "2026-01-01T09:00:00", "source": "class Root:\n    pass\n",
         "trials": [{"trial_id": 1, "purpose": "precheck"},
                    {"trial_id": 2, "purpose": "research", "annual_return": 0.1, "max_drawdown": 0.2, "eligible": False,
                     "ineligible_reason": "SOURCE_REVIEW_FAILED", "at": "2026-01-01T09:30:00"}]},
        {"id": "a@1", "parent": "root@1", "created_at": "2026-01-01T11:00:00", "source": "class A:\n    pass\n",
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
    def test_versions_sit_at_their_first_research_run_in_lineage_rows(self):
        view = layout.build_view(GRAPH)
        widgets = {w["id"]: w for w in view["widgets"]}
        self.assertEqual([(w["type"], w["slot"]) for w in view["widgets"]],
                         [("summary", "top"), ("lineage", "main"), ("progress", "main"), ("scatter", "main"), ("table", "main"), ("notes", "main"),
                          ("candidate-detail", "side"), ("sources", "side")])
        tree = widgets["lineage"]
        nodes = {n["id"]: n for n in tree["nodes"]}
        self.assertEqual([n["trials"] for n in tree["nodes"]][-1], [5], "the palette finds a version by its trial")
        self.assertEqual([r["id"] for r in tree["rows"]], ["root@1", "a@1", "b@1"])
        self.assertEqual((nodes["root@1"]["x"], nodes["a@1"]["x"], nodes["b@1"]["x"]), (2.0, 4.0, 5.0),
                         "a version sits at its first research run, over its bar")
        self.assertEqual({i: n["status"] for i, n in nodes.items()},
                         {"root@1": "masked", "a@1": "recommended", "b@1": "below_targets"})
        self.assertEqual((nodes["a@1"]["prediction"], nodes["b@1"]["prediction"], nodes["root@1"]["prediction"]),
                         ("held", "mixed", "none"))
        segment, = tree["trail"]
        self.assertEqual((segment["candidate"], segment["x1"]), ("a@1", tree["axis"]["max"]))
        self.assertEqual(segment["x0"], 4.5, "a timed event sits halfway through the gap after its last trial")
        self.assertEqual([(t["trial_id"], t["candidate"]) for t in tree["trials"]],
                         [(1, "root@1"), (2, "root@1"), (3, "a@1"), (4, "a@1"), (5, "b@1")])
        progress = widgets["progress"]
        self.assertEqual(progress["recommended"], ["a@1"])
        self.assertEqual([p["eligible"] for p in progress["points"]], [False, True, True])
        self.assertEqual(progress["axis"]["max"], tree["axis"]["max"], "the same x as the lineage")
        self.assertEqual(len(widgets["readings"]["points"]), 3)
        self.assertEqual(widgets["details"]["default"], "a@1")
        self.assertFalse(any("source" in c for c in widgets["details"]["items"]), "the source travels once, in sources")
        self.assertEqual([(s["id"], s["parent"], s["source"]) for s in widgets["sources"]["items"]],
                         [("a@1", "root@1", "class A:\n    pass\n"), ("b@1", "a@1", None), ("root@1", None, "class Root:\n    pass\n")])
        self.assertEqual({r["id"]: (r["role"], r["runs"], r["annual_return"]) for r in widgets["versions"]["rows"]},
                         {"root@1": (None, 1, 0.1), "a@1": ("recommended", 1, 0.25), "b@1": (None, 1, 0.18)})
        summary = widgets["summary"]
        self.assertEqual((summary["recommended"], summary["runs_since_recommendation_changed"], summary["masked_runs"]),
                         ("a@1", 1, 1), "one research run (trial 5) since a@1 became the recommendation")

    def test_a_recommendation_that_lost_its_evidence_is_shown_apart_from_its_eligibility(self):
        graph = copy.deepcopy(GRAPH)
        graph["candidates"][1]["trials"][1].update(eligible=False, ineligible_reason="SOURCE_REVIEW_FAILED")
        widgets = {w["id"]: w for w in layout.build_view(graph)["widgets"]}
        nodes = {n["id"]: n for n in widgets["lineage"]["nodes"]}
        self.assertEqual(nodes["a@1"]["status"], "masked", "CF-08: eligibility before the recommendation")
        summary = widgets["summary"]
        self.assertEqual((summary["recommended"], summary["status"]), ("a@1", "masked"),
                         "the latest recommendation still names it; its status says it is ineligible now")

    def test_other_lines_trials_take_no_room_on_the_axis(self):
        graph = copy.deepcopy(GRAPH)
        numbers = iter([10, 20, 103, 140, 250])  # trials 1-5 renumbered as if other lines ran in between
        for c in graph["candidates"]:
            for t in c["trials"]:
                t["trial_id"] = next(numbers)
        widgets = {w["id"]: w for w in layout.build_view(graph)["widgets"]}
        tree = widgets["lineage"]
        self.assertEqual([n["x"] for n in tree["nodes"]], [2.0, 4.0, 5.0], "the line's 2nd, 4th and 5th trials")
        self.assertEqual([(t["trial_id"], t["x"]) for t in tree["trials"]], [(10, 1), (20, 2), (103, 3), (140, 4), (250, 5)])
        self.assertEqual([(p["trial_id"], p["x"]) for p in widgets["progress"]["points"]], [(20, 2), (140, 4), (250, 5)])
        self.assertEqual((tree["trail"][0]["x0"], tree["axis"]["max"]), (4.5, 6.0))
        self.assertEqual(widgets["summary"]["runs_since_recommendation_changed"], 1)

    def test_the_summary_keeps_the_line_own_runs_beside_the_trials_behind_them(self):
        graph = copy.deepcopy(GRAPH)
        graph["line"]["trial_counts"] = {"research_trials": 546, "all_purpose_trials": 1181}
        self.assertEqual(contract.check_graph(graph), [])
        summary = next(w for w in layout.build_view(graph)["widgets"] if w["id"] == "summary")
        self.assertEqual((summary["research_runs"], summary["trial_counts"]["research_trials"]), (3, 546))
        self.assertIsNone(next(w for w in layout.build_view(GRAPH)["widgets"] if w["id"] == "summary")["trial_counts"])

    def test_the_summary_names_the_latest_priority_the_axis_leaves_out(self):
        graph = copy.deepcopy(GRAPH)
        graph["events"][1:1] = [{"at": "2026-01-01T11:50:00Z", "kind": "priority", "ref": "judgment 8", "text": "first", "recommends": None},
                                {"at": "2026-01-01T12:05:00Z", "kind": "priority", "ref": "judgment 9", "text": "next: widen the stop", "recommends": None}]
        self.assertEqual(contract.check_graph(graph), [])
        summary = next(w for w in layout.build_view(graph)["widgets"] if w["id"] == "summary")
        self.assertEqual(summary["priority"], {"at": "2026-01-01T12:05:00Z", "ref": "judgment 9", "text": "next: widen the stop"})
        self.assertIsNone(next(w for w in layout.build_view(GRAPH)["widgets"] if w["id"] == "summary")["priority"])

    def test_decisions_made_for_the_user_sit_on_the_axis_and_count_as_priorities(self):
        graph = copy.deepcopy(GRAPH)
        graph["events"][1:1] = [
            {"at": "2026-01-01T09:40:00Z", "kind": "priority", "ref": "judgment 5", "text": "next: widen the stop", "recommends": None},
            {"at": "2026-01-01T11:50:00Z", "kind": "approach_change", "ref": "judgment 8",
             "text": "Change of approach. Chosen by the Agent: trend filter", "recommends": None},
            {"at": "2026-01-01T12:05:00Z", "kind": "line_decision", "ref": "judgment 10",
             "text": "Line decision. The user delegated the stop", "recommends": None}]
        self.assertEqual(contract.check_graph(graph), [])
        widgets = {w["id"]: w for w in layout.build_view(graph)["widgets"]}
        self.assertEqual([(d["kind"], d["ref"], d["x"]) for d in widgets["lineage"]["decisions"]],
                         [("approach_change", "judgment 8", 4.5), ("line_decision", "judgment 10", 4.5)])
        self.assertEqual(widgets["summary"]["priority"]["ref"], "judgment 10")
        self.assertEqual(next(w for w in layout.build_view(GRAPH)["widgets"] if w["id"] == "lineage")["decisions"], [])

    def test_a_fix_published_as_a_new_root_links_to_the_revision_it_fixes(self):
        graph = copy.deepcopy(GRAPH)
        graph["candidates"] += [
            {"id": "root@2", "parent": None, "created_at": "2026-01-01T13:00:00",
             "trials": [{"trial_id": 6, "purpose": "research", "annual_return": 0.1, "max_drawdown": 0.1, "eligible": True,
                         "at": "2026-01-01T13:30:00"}]},
            {"id": "a@2", "parent": "root@2", "created_at": "2026-01-01T14:00:00",
             "trials": [{"trial_id": 7, "purpose": "precheck"}]}]
        tree = next(w for w in layout.build_view(graph)["widgets"] if w["id"] == "lineage")
        self.assertEqual(tree["revisions"], [{"from": "root@1", "to": "root@2"}],
                         "a@2 has its parent drawn, so only the parentless fix links to its earlier revision")
        self.assertEqual(len(tree["edges"]), 3, "parent edges stay as they are")


class WebRenderTests(unittest.TestCase):
    def setUp(self):
        """A stand-in web/ whose page is already built from its current sources."""
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        web = Path(tmp.name) / "web"
        (web / "src").mkdir(parents=True)
        (web / "src/App.tsx").write_text("export {}")
        (web / "package-lock.json").write_text("{}")
        page = web / "dist/index.html"
        page.parent.mkdir()
        page.write_text("<html></html>")
        saved = render_web.WEB, render_web.PAGE
        self.addCleanup(lambda: (setattr(render_web, "WEB", saved[0]), setattr(render_web, "PAGE", saved[1])))
        render_web.WEB, render_web.PAGE = web, page
        (page.parent / render_web.BUILT_FROM).write_text(render_web.digest(render_web.sources()))
        self.web = web

    def test_a_page_built_from_its_current_sources_is_served(self):
        self.assertEqual(render_web.built_page(), "<html></html>")

    def test_a_page_older_than_its_sources_is_never_served(self):
        (self.web / "src/App.tsx").write_text("export const changed = 1")
        with mock.patch.object(render_web.shutil, "which", return_value=None), \
                self.assertRaisesRegex(RuntimeError, "stale"):
            render_web.built_page()


class CompareTests(unittest.TestCase):
    def test_differences_up_to_the_cutoff_are_listed(self):
        session = copy.deepcopy(GRAPH)
        session["source"] = "session"
        session["candidates"][2]["parent"] = "root@1"
        session["candidates"][1]["trials"][1]["annual_return"] = 0.2504
        session["candidates"][1]["trials"][1]["max_drawdown"] = 0.12
        session["candidates"][1]["predictions"] = []
        session["candidates"][1]["source"] = "class A:\n    pass  # edited\n"
        session["candidates"][0]["source"] = None
        session["candidates"].append({"id": "late@1", "parent": "a@1", "created_at": "2026-01-02T00:00:00Z"})
        diff = compare.compare(GRAPH, session, "2026-01-01T23:00:00Z")
        self.assertEqual(diff["only_b"], [], "a candidate after the cutoff is out of scope")
        self.assertEqual(diff["parent"], [{"id": "b@1", "a": "a@1", "b": "root@1"}])
        self.assertEqual([(d["measure"], d["b"]) for d in diff["measures"]], [("max_drawdown", 0.12)],
                         "a reading within the tolerance is not a difference")
        self.assertEqual(diff["predictions"], [{"id": "a@1", "a": {"held": 1}, "b": {}}])
        self.assertEqual(diff["source"], ["a@1"], "a source one graph lacks is coverage, not a difference")
        self.assertEqual(diff["fields"]["source"]["only_a"], ["root@1"])
        self.assertEqual(diff["events"]["a"], diff["events"]["b"])
        self.assertIn("## Parent differs (1)", compare.markdown(diff))


if __name__ == "__main__":
    unittest.main()
