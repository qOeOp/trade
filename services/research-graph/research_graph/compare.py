"""Compare two research graphs of one line (normally ledger vs session) up to a cutoff time.

Returns structured differences; classifying each one (missing record, not meant to be stored,
extraction miss) is the reader's job, guided by the research-graph skill.
"""
from __future__ import annotations

from collections import Counter

from .layout import research_runs, seconds

MEASURES = ("annual_return", "max_drawdown", "sharpe", "win_rate")
FIELDS = ("change", "source", "hypothesis", "duties", "registration", "control_trial", "interpretation")


def _within(graph: dict, cutoff: float | None) -> dict[str, dict]:
    return {c["id"]: c for c in graph["candidates"]
            if cutoff is None or not c.get("created_at") or seconds(c["created_at"]) <= cutoff}


def _verdicts(c: dict) -> Counter:
    return Counter(r.get("verdict") for r in c.get("reviews") or [])


def _outcomes(c: dict) -> Counter:
    return Counter(p.get("outcome") or "unjudged" for p in c.get("predictions") or [])


def compare(a: dict, b: dict, cutoff: str | None = None, tolerance: float = 5e-4) -> dict:
    """Differences between graph `a` and graph `b` (named by their `source`)."""
    limit = seconds(cutoff) if cutoff else None
    ca, cb = _within(a, limit), _within(b, limit)
    both = sorted(set(ca) & set(cb))
    out: dict = {"a": a["source"], "b": b["source"], "cutoff": cutoff,
                 "only_a": sorted(set(ca) - set(cb)), "only_b": sorted(set(cb) - set(ca)),
                 "parent": [], "runs_missing": [], "measures": [], "eligibility": [], "predictions": [],
                 "reviews": [], "status": [], "source": [], "fields": {}}
    for i in both:
        x, y = ca[i], cb[i]
        if x.get("parent") != y.get("parent"):
            out["parent"].append({"id": i, "a": x.get("parent"), "b": y.get("parent")})
        rx = {t["trial_id"]: t for t in research_runs(x)}
        ry = {t["trial_id"]: t for t in research_runs(y)}
        for t in sorted(set(rx) ^ set(ry)):
            source = rx.get(t) or ry[t]
            if limit is None or not source.get("at") or seconds(source["at"]) <= limit:
                out["runs_missing"].append({"id": i, "trial_id": t, "missing_in": "b" if t in rx else "a"})
        for t in sorted(set(rx) & set(ry)):
            for m in MEASURES:
                va, vb = rx[t].get(m), ry[t].get(m)
                if va is not None and vb is not None and abs(va - vb) > tolerance:
                    out["measures"].append({"id": i, "trial_id": t, "measure": m, "a": va, "b": vb})
            ea, eb = rx[t].get("eligible"), ry[t].get("eligible")
            if ea is not None and eb is not None and ea != eb:
                out["eligibility"].append({"id": i, "trial_id": t, "a": ea, "b": eb})
        if _outcomes(x) != _outcomes(y):
            out["predictions"].append({"id": i, "a": dict(_outcomes(x)), "b": dict(_outcomes(y))})
        if _verdicts(x) != _verdicts(y):
            out["reviews"].append({"id": i, "a": dict(_verdicts(x)), "b": dict(_verdicts(y))})
        if x.get("status") != y.get("status"):
            out["status"].append({"id": i, "a": x.get("status"), "b": y.get("status")})
        if x.get("source") is not None and y.get("source") is not None and x["source"] != y["source"]:
            out["source"].append(i)
    for f in FIELDS:
        out["fields"][f] = {"both": sum(1 for i in both if ca[i].get(f) and cb[i].get(f)),
                            "only_a": [i for i in both if ca[i].get(f) and not cb[i].get(f)],
                            "only_b": [i for i in both if cb[i].get(f) and not ca[i].get(f)]}

    def recs(g: dict) -> dict:
        return {e.get("ref"): e.get("recommends") for e in g["events"]
                if e["kind"] == "recommendation" and e.get("at") and (limit is None or seconds(e["at"]) <= limit)}

    ra, rb = recs(a), recs(b)
    out["recommendations"] = {"a": len(ra), "b": len(rb),
                              "differ": [{"ref": k, "a": ra[k], "b": rb[k]} for k in sorted(set(ra) & set(rb), key=str)
                                         if ra[k] != rb[k]]}

    def kinds(g: dict) -> dict:
        return dict(Counter(e["kind"] for e in g["events"]
                            if e.get("at") and (limit is None or seconds(e["at"]) <= limit)))

    out["events"] = {"a": kinds(a), "b": kinds(b)}
    out["gaps"] = {"a": a["gaps"], "b": b["gaps"]}
    return out


def markdown(diff: dict) -> str:
    """A readable report of compare()'s result."""
    a, b = diff["a"], diff["b"]
    lines = [f"# {a} vs {b}" + (f" (up to {diff['cutoff']})" if diff["cutoff"] else ""), ""]

    def section(title: str, items: list, show) -> None:
        lines.append(f"## {title} ({len(items)})")
        lines.extend(f"- {show(item)}" for item in items) if items else lines.append("- none")
        lines.append("")

    section(f"Candidates only in {a}", diff["only_a"], str)
    section(f"Candidates only in {b}", diff["only_b"], str)
    section("Parent differs", diff["parent"], lambda d: f"{d['id']}: {a} {d['a']} / {b} {d['b']}")
    section("Research runs missing", diff["runs_missing"],
            lambda d: f"{d['id']} trial {d['trial_id']} missing in {a if d['missing_in'] == 'a' else b}")
    section("Measures differ", diff["measures"],
            lambda d: f"{d['id']} trial {d['trial_id']} {d['measure']}: {a} {d['a']} / {b} {d['b']}")
    section("Eligibility differs", diff["eligibility"], lambda d: f"{d['id']} trial {d['trial_id']}: {d['a']} / {d['b']}")
    section("Predictions differ", diff["predictions"], lambda d: f"{d['id']}: {a} {d['a']} / {b} {d['b']}")
    section("Source reviews differ", diff["reviews"], lambda d: f"{d['id']}: {a} {d['a']} / {b} {d['b']}")
    section("Status differs", diff["status"], lambda d: f"{d['id']}: {a} {d['a']} / {b} {d['b']}")
    section("Source differs", diff["source"], str)
    lines.append("## Field coverage")
    for f, v in diff["fields"].items():
        lines.append(f"- {f}: both {v['both']}, only {a} {len(v['only_a'])}, only {b} {len(v['only_b'])}")
    r = diff["recommendations"]
    lines += ["", f"## Recommendations: {a} {r['a']} / {b} {r['b']}"]
    lines += [f"- {d['ref']}: {a} {d['a']} / {b} {d['b']}" for d in r["differ"]] or ["- same where both have the judgment"]
    lines += ["", f"## Event kinds: {a} {diff['events']['a']} / {b} {diff['events']['b']}", ""]
    for side in ("a", "b"):
        lines.append(f"## Gaps reported by {diff[side]}")
        lines += [f"- {g}" for g in diff["gaps"][side]] or ["- none"]
        lines.append("")
    return "\n".join(lines)
