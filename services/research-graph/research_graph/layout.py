"""Graph to view model (research-graph-view/1): what to draw and where, in research units, no pixels.

The view is a manifest (line, targets, counts) and a list of widgets. Each widget has an id, a
versioned type (summary/1, lineage/1, scatter/1, notes/1, candidate-detail/1) and a slot (top, main or side) and is
self-contained, so a renderer draws each type on its own and a widget can travel as its own document.

x is research progress in trial numbers: a candidate sits at its first trial, and a timed event is
placed by interpolating between trials whose times are known. Rows follow the lineage depth first,
children in order of their first trial. A renderer maps these units to its own pixels and colours.
"""
from __future__ import annotations

from bisect import bisect_left
from datetime import datetime, timezone

VIEW_FORMAT = "research-graph-view/1"
LANES = ("recommendation", "user_message", "agent_question", "eligibility_change", "goal")


def seconds(value: str) -> float:
    """Epoch seconds; a time without an offset is UTC (the ledger stores UTC without a zone)."""
    moment = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return (moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)).timestamp()


def first_trial(candidate: dict) -> int | None:
    ids = [t["trial_id"] for t in candidate.get("trials") or []]
    return min(ids) if ids else None


def research_runs(candidate: dict) -> list[dict]:
    return [t for t in candidate.get("trials") or [] if t["purpose"] == "research"]


def status(candidate: dict, targets: dict) -> str:
    """recommended | masked | precheck_failed | unrun | meets_targets | below_targets."""
    if candidate.get("status") == "recommended":
        return "recommended"
    runs = research_runs(candidate)
    last = runs[-1] if runs else None
    if candidate.get("status") == "masked" or (last and last.get("eligible") is False):
        return "masked"
    if candidate.get("status") == "precheck_failed":
        return "precheck_failed"
    if not last or last.get("annual_return") is None:
        return "unrun"
    meets = ((targets.get("annual_return") is None or last["annual_return"] >= targets["annual_return"])
             and (targets.get("max_drawdown") is None or (last.get("max_drawdown") is not None
                                                          and last["max_drawdown"] <= targets["max_drawdown"])))
    return "meets_targets" if meets else "below_targets"


def prediction(candidate: dict) -> str:
    """held | failed | mixed | none, over predictions with a held or failed outcome."""
    outcomes = [p.get("outcome") for p in candidate.get("predictions") or [] if p.get("outcome") in ("held", "failed")]
    if not outcomes:
        return "none"
    return "held" if set(outcomes) == {"held"} else "failed" if set(outcomes) == {"failed"} else "mixed"


class Clock:
    """Maps a time to a trial position from (time, trial) anchors that rise together."""

    def __init__(self, candidates: list[dict]):
        anchors = []
        for c in candidates:
            anchors += [(seconds(t["at"]), t["trial_id"]) for t in c.get("trials") or [] if t.get("at")]
            trial = first_trial(c)
            if c.get("created_at") and trial is not None:
                anchors.append((seconds(c["created_at"]), trial - 0.5))
        self.points: list[tuple[float, float]] = []
        for when, trial in sorted(anchors):
            if not self.points or (when > self.points[-1][0] and trial >= self.points[-1][1]):
                self.points.append((when, trial))

    def __call__(self, at: str) -> float | None:
        if not self.points:
            return None
        when = seconds(at)
        times = [p[0] for p in self.points]
        i = bisect_left(times, when)
        if i == 0:
            return self.points[0][1]
        if i == len(self.points):
            return self.points[-1][1] + 0.5
        (a, ta), (b, tb) = self.points[i - 1], self.points[i]
        return ta + (tb - ta) * (when - a) / ((b - a) or 1)


def rows(candidates: list[dict]) -> dict[str, int]:
    known = {c["id"] for c in candidates}
    children: dict[str | None, list[dict]] = {}
    for c in candidates:
        children.setdefault(c.get("parent") if c.get("parent") in known else None, []).append(c)
    for group in children.values():
        group.sort(key=lambda c: (first_trial(c) is None, first_trial(c) or 0, c["id"]))
    order: dict[str, int] = {}
    stack = list(reversed(children.get(None, [])))
    while stack:
        c = stack.pop()
        if c["id"] in order:
            continue
        order[c["id"]] = len(order)
        stack += reversed(children.get(c["id"], []))
    for c in candidates:
        order.setdefault(c["id"], len(order))
    return order


def build_view(graph: dict) -> dict:
    candidates = graph["candidates"]
    targets = (graph["line"].get("targets") or {})
    clock = Clock(candidates)
    row = rows(candidates)

    def x_of(c: dict) -> float | None:
        trial = first_trial(c)
        return float(trial) if trial is not None else (clock(c["created_at"]) if c.get("created_at") else None)

    nodes = []
    for c in candidates:
        runs = research_runs(c)
        last = runs[-1] if runs else {}
        nodes.append({"id": c["id"], "row": row[c["id"]], "x": x_of(c), "status": status(c, targets),
                      "change": c.get("change"),
                      "prediction": prediction(c),
                      "reading": {"annual_return": last.get("annual_return"), "max_drawdown": last.get("max_drawdown")}})
    events = [e for e in graph["events"] if e.get("at")]
    lanes: dict[str, list[dict]] = {kind: [] for kind in LANES}
    for e in events:
        kind = "goal" if e["kind"] == "line_change" else e["kind"]
        if kind in lanes:
            lanes[kind].append({"x": clock(e["at"]), "at": e["at"], "ref": e.get("ref"), "text": e.get("text"),
                                "recommends": e.get("recommends")})
    recs = sorted((e for e in events if e["kind"] == "recommendation" and e.get("recommends") in row),
                  key=lambda e: seconds(e["at"]))
    xs = [n["x"] for n in nodes if n["x"] is not None] + [e["x"] for lane in lanes.values() for e in lane if e["x"] is not None]
    lo, hi = (min(xs) - 1, max(xs) + 1) if xs else (0.0, 1.0)
    bands = [{"candidate": a["recommends"], "row": row[a["recommends"]], "x0": clock(a["at"]),
              "x1": clock(b["at"]) if b else hi, "ref": a.get("ref")} for a, b in zip(recs, [*recs[1:], None], strict=True)]
    start = (graph.get("scope") or {}).get("start")
    status_of = {n["id"]: n["status"] for n in nodes}
    current = recs[-1]["recommends"] if recs else None
    streak = len(recs)
    while streak > 0 and recs[streak - 1]["recommends"] == current:
        streak -= 1
    held_since = clock(recs[streak]["at"]) if recs else None
    runs = [t for c in candidates for t in research_runs(c)]
    best = research_runs(next(c for c in candidates if c["id"] == current))[-1:] if current else []
    prediction_of = {n["id"]: n["prediction"] for n in nodes}
    widgets = [
        {"id": "summary", "type": "summary/1", "slot": "top", "targets": targets,
         "recommended": current, "reading": {k: best[0].get(k) for k in ("annual_return", "max_drawdown", "sharpe", "win_rate")}
         if best else None, "status": status_of.get(current) if current else None,
         "recommendations": len(recs), "recommendations_unchanged": len(recs) - streak,
         "runs_since_recommendation_changed": sum(1 for r in runs if held_since is not None and r["trial_id"] > held_since),
         "versions": len(candidates), "research_runs": len(runs),
         "masked_runs": sum(1 for r in runs if r.get("eligible") is False),
         "meeting_targets": sum(1 for n in nodes if n["status"] in ("meets_targets", "recommended")
                                and n["reading"]["annual_return"] is not None
                                and (targets.get("annual_return") is None or n["reading"]["annual_return"] >= targets["annual_return"])
                                and (targets.get("max_drawdown") is None or (n["reading"]["max_drawdown"] or 1) <= targets["max_drawdown"]))},
        {"id": "lineage", "type": "lineage/1", "slot": "main", "title": "策略谱系 · 按试验编号推进", "targets": targets,
         "axis": {"min": lo, "max": hi, "ticks": list(range(int(lo // 10 + 1) * 10, int(hi) + 1, 10)),
                  "scope_start": clock(start) if start else None},
         "rows": [{"id": i, "row": r} for i, r in sorted(row.items(), key=lambda item: item[1])],
         "nodes": nodes,
         "edges": [{"from": c["parent"], "to": c["id"]} for c in candidates if c.get("parent") in row],
         "bands": bands,
         "lanes": [{"kind": kind, "events": lanes[kind]} for kind in LANES]},
        {"id": "readings", "type": "scatter/1", "slot": "main", "title": "回放读数：年化 vs 最大回撤（研究运行）",
         "targets": targets,
         "points": [{"id": c["id"], "trial_id": t["trial_id"], "annual_return": t["annual_return"],
                     "max_drawdown": t["max_drawdown"], "eligible": t.get("eligible"), "status": status_of[c["id"]]}
                    for c in candidates for t in research_runs(c)
                    if t.get("annual_return") is not None and t.get("max_drawdown") is not None]},
        {"id": "gaps", "type": "notes/1", "slot": "main", "title": "这份数据缺什么", "items": graph["gaps"]},
        {"id": "details", "type": "candidate-detail/1", "slot": "side",
         "default": recs[-1]["recommends"] if recs else (candidates[0]["id"] if candidates else None),
         "items": [{**c, "status_class": status_of[c["id"]], "prediction_class": prediction_of[c["id"]]}
                   for c in candidates]},
    ]
    return {"format": VIEW_FORMAT, "source": graph["source"], "line": graph["line"], "targets": targets,
            "counts": {"candidates": len(candidates), "research_runs": sum(len(research_runs(c)) for c in candidates)},
            "widgets": widgets}
