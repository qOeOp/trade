"""A research line as a research-graph/2 document, read from the ledger only (`research graph`).

It composes the product's own readers (candidates, the line record, run measures and availability,
registration plans, the comparison, source reviews and judgments) and adds no rule of its own, so
the same ledger commit always gives the same graph. It reads nothing outside the ledger; the
research-graph tool (services/research-graph) checks, lays out, renders and compares the document.
"""
from __future__ import annotations

from collections.abc import Callable, Mapping
import copy

from ledger import db, lines
from ledger.errors import Refusal
from ledger.refusals import refuse
from qualification import availability
from registration import register
from report import candidates as report_candidates
from report import comparison, measures, runs, seams, status

FORMAT = "research-graph/2"
MEASURE_KEYS = {"annual_return": "annual_return", "mark_max_drawdown": "max_drawdown", "sharpe_365": "sharpe",
                "plan_win_rate": "win_rate"}
EVENT_KINDS = {"recommendation": "recommendation", "priority": "priority", "interpretation": "interpretation",
               "search_exposure": "other"}


def _iso(value) -> str | None:
    return value.isoformat() if value is not None else None


def _lineage(rows: list[dict], seeds: set[str]) -> list[dict]:
    """The candidates connected to the seeds (the line's start and the candidates of its research
    trials) through parents or a shared strategy id."""
    by_id = {f"{r['strategy_id']}@{r['revision']}": r for r in rows}
    linked: dict[str, set[str]] = {key: set() for key in by_id}
    by_strategy: dict[str, list[str]] = {}
    for key, row in by_id.items():
        by_strategy.setdefault(row["strategy_id"], []).append(key)
        if row["parent_strategy_id"] is not None:
            parent = f"{row['parent_strategy_id']}@{row['parent_revision']}"
            if parent in by_id:
                linked[key].add(parent)
                linked[parent].add(key)
    for keys in by_strategy.values():
        for key in keys:
            linked[key].update(k for k in keys if k != key)
    seen, todo = set(), [key for key in seeds if key in by_id]
    while todo:
        key = todo.pop()
        if key not in seen:
            seen.add(key)
            todo.extend(linked[key] - seen)
    return sorted((by_id[key] for key in seen), key=lambda r: (r["created_at"], r["strategy_id"], r["revision"]))


def _comparison(profile, bundle: str, trial_id: int, at: str) -> tuple[dict | None, list[dict] | None]:
    """(comparison, predictions with outcomes) from the product comparison, or (None, None) when it refuses."""
    try:
        found = comparison.compare(profile, bundle, trial_id, at)
    except Refusal:
        return None, None
    evidence = found.get("evidence") or None
    attribution = found.get("attribution") or {}
    predictions = [{"measure": f"{p.get('slice')}.{p.get('measure')}" if p.get("slice") else p.get("measure"),
                    "direction": p.get("direction"),
                    "outcome": {True: "held", False: "failed"}.get(p.get("same_sign"), "untestable")}
                   for p in attribution.get("predictions") or []] or None
    if evidence is None:
        return None, predictions
    interval = evidence.get("mean_log_basic_interval") or [None, None]
    crosses = None if None in interval else interval[0] <= 0 <= interval[1]
    return ({"vs_trial": found.get("control_trial_id"), "mean_daily_log_difference": evidence.get("mean_daily_log_difference"),
             "detectable": evidence.get("detectable_mean_log_difference_80pct_normal_approx"),
             "interval_crosses_zero": crosses, "summary": None}, predictions)


def _reusing(read: Callable) -> Callable:
    """`read` (seams.market_returns) answering a repeated window from its first answer: a market commit
    is immutable, so one graph reads each window once instead of once per comparison. Failures are not
    kept; every caller gets its own copy."""
    answers: dict = {}

    def market_returns(*window):
        if window not in answers:
            answers[window] = read(*window)
        return copy.deepcopy(answers[window])
    return market_returns


def research_graph(profile, line_bundle: str | None = None, at: str | None = None, *, since: str | None = None,
                   max_drawdown: float | None = None, annual_return: float | None = None) -> dict:
    """The research-graph/2 document of a line at a ledger version. The targets are the user's, read
    by the caller from the line note; `since` marks where the scope under study starts."""
    with seams.use(market_returns=_reusing(seams.current.market_returns)):
        return _document(profile, line_bundle, at, since, max_drawdown, annual_return)


def _document(profile, line_bundle: str | None, at: str | None, since: str | None, max_drawdown: float | None,
              annual_return: float | None) -> dict:
    profile = runs.profile_of(profile)
    checker = availability.check_identity()
    with db.read_as_of(profile, at) as conn:
        commit = db.head_commit(conn)
        line = line_bundle or (lines.current_line(conn) or {}).get("bundle")
        if line is None:
            raise refuse("RESEARCH_LINE_REQUIRED", "the ledger has no research line record", missing=("research-line",))
        record = lines.read_line(conn, line, None)
        rows = conn.dicts(f"SELECT {', '.join(report_candidates.CANDIDATE_COLUMNS)} FROM candidate")
        on_line = set(lines.line_trials(conn, line)["trials"])
        sources = {row["source_sha256"] for row in conn.dicts("SELECT trial_id, source_sha256 FROM trial WHERE purpose = 'research'")
                   if row["trial_id"] in on_line}
        seeds = {record["start"]} | {f"{r['strategy_id']}@{r['revision']}" for r in rows if r["source_sha256"] in sources}
        members = _lineage(rows, seeds)
        source_of = {f"{r['strategy_id']}@{r['revision']}": r["source_sha256"] for r in members}
        wanted = set(source_of.values())
        text_of = {r["source_sha256"]: bytes(r["source"]).decode()
                   for r in conn.dicts("SELECT source_sha256, source FROM candidate") if r["source_sha256"] in wanted}
        records = availability.review_records(conn)
        bundle_times = {row["bundle"]: row["created_at"] for row in conn.dicts(
            "SELECT bundle, created_at FROM evidence_bundle WHERE bundle LIKE 'source-review-%%' OR bundle LIKE 'research-line-%%'")}
        attempts = {row["trial_id"]: row["registration_bundle"] for row in conn.dicts(
            "SELECT registration_bundle, trial_id FROM registration_attempt")}
        judged = conn.dicts("SELECT judgment_id, kind, body, created_at, supersedes FROM judgment WHERE line_bundle = %s "
                            "ORDER BY judgment_id", (line,))
        subjects: dict[int, list[dict]] = {}
        for row in conn.dicts("SELECT s.judgment_id, s.role, s.strategy_id, s.revision, s.trial_id, s.registration_bundle "
                              "FROM judgment_subject s JOIN judgment j ON j.judgment_id = s.judgment_id "
                              "WHERE j.line_bundle = %s ORDER BY s.judgment_id, s.seq", (line,)):
            subjects.setdefault(row.pop("judgment_id"), []).append(row)
        replaced = {row["supersedes"] for row in judged if row["supersedes"] is not None}
        since_at = None
        if since is not None:
            since_at = conn.one("SELECT date FROM dolt_log WHERE commit_hash = %s", (db.resolve_commit(conn, since),))
        trials_of: dict[str, list[dict]] = {key: [] for key in source_of}
        owner = {sha: key for key, sha in source_of.items()}
        for row in conn.dicts("SELECT t.trial_id, t.purpose, t.source_sha256, t.created_at, r.status FROM trial t "
                              "LEFT JOIN run r ON r.trial_id = t.trial_id ORDER BY t.trial_id"):
            key = owner.get(row["source_sha256"])
            if key is None or (row["purpose"] == "research" and row["trial_id"] not in on_line):
                continue  # a research run on another window or market commit belongs to another line
            trial = {"trial_id": row["trial_id"], "purpose": row["purpose"], "status": row["status"],
                     "annual_return": None, "max_drawdown": None, "sharpe": None, "win_rate": None,
                     "eligible": None, "ineligible_reason": None, "at": _iso(row["created_at"])}
            if row["purpose"] == "research" and row["status"] is not None:
                value = report_candidates.assess_listed(conn, row["trial_id"], checker, records)
                trial["eligible"] = bool(value["economic_evidence_available"])
                if trial["eligible"]:
                    headline = status._headline(conn, row["trial_id"], status.TABLE_MEASURES)
                    for name, field in MEASURE_KEYS.items():
                        trial[field] = headline[measures.key(name)]["value"]
                else:
                    trial["ineligible_reason"] = "; ".join(value["reasons"]) or None
            trials_of[key].append(trial)
        plans = {}
        for key, trials in trials_of.items():
            bundle = next((attempts[t["trial_id"]] for t in trials if t["trial_id"] in attempts), None)
            if bundle is not None:
                plans[key] = (bundle, register.load_plan(conn, bundle)[0]["body"])

    current = [row for row in judged if row["judgment_id"] not in replaced]
    recommendations = [row for row in current if row["kind"] == "recommendation"]
    latest = subjects.get(recommendations[-1]["judgment_id"], []) if recommendations else []
    named = {f"{s['strategy_id']}@{s['revision']}": s["role"] for s in latest if s["strategy_id"] is not None}
    candidates, events = [], []
    for row in members:
        key = f"{row['strategy_id']}@{row['revision']}"
        trials = trials_of[key]
        research = [t for t in trials if t["purpose"] == "research"]
        bundle, body = plans.get(key, (None, {}))
        reviews = []
        for item in records:
            rec = item["record"]
            if item["ignored"] or rec is None or rec["source_sha256"] != source_of[key]:
                continue
            failed = [name for name in ("api", "causal", "activity", "readiness")
                      if isinstance(rec.get(name), Mapping) and rec[name].get("status") == "failed"]
            reviews.append({"bundle": item["bundle"], "verdict": rec["verdict"], "failed_items": failed,
                            "at": _iso(bundle_times.get(item["bundle"])),
                            "note": " ".join(rec[name].get("note") or "" for name in failed).strip() or None})
            if rec["verdict"] == "failed":
                masked = [t["trial_id"] for t in research]
                events.append({"at": _iso(bundle_times.get(item["bundle"])), "kind": "eligibility_change", "ref": item["bundle"],
                               "text": f"failed source review of {key} ({', '.join(failed) or 'unspecified'}); "
                                       f"runs of this source lose economic evidence: {masked or 'none'}",
                               "recommends": None})
        comparison_value, predictions = (None, None)
        if bundle is not None and research and research[-1]["status"] == "passed":
            comparison_value, predictions = _comparison(profile, bundle, research[-1]["trial_id"], commit)
        if predictions is None and isinstance(body.get("prediction"), Mapping):
            predictions = [{"measure": f"{p.get('slice')}.{p.get('measure')}" if p.get("slice") else p.get("measure"),
                            "direction": p.get("direction"), "outcome": None}
                           for p in body["prediction"].get("mechanism") or []] or None
        trial_ids = {t["trial_id"] for t in trials}
        interpretation = next((row["body"] for row in reversed(current) if row["kind"] == "interpretation" and any(
            s["trial_id"] in trial_ids or (bundle is not None and s["registration_bundle"] == bundle)
            for s in subjects.get(row["judgment_id"], []))), None)
        if named.get(key) == "recommended":
            state = "recommended"
        elif research and research[-1]["eligible"] is False:
            state = "masked"
        elif not research:
            state = "precheck_failed" if any(r["verdict"] == "failed" for r in reviews) else "unrun"
        else:
            state = "kept_reference" if key in named else "superseded"
        rationale = body.get("rationale") if isinstance(body.get("rationale"), Mapping) else {}
        candidates.append({
            "id": key, "parent": f"{row['parent_strategy_id']}@{row['parent_revision']}" if row["parent_strategy_id"] else None,
            "created_at": _iso(row["created_at"]), "change": row["difference"] or row["description"],
            "source": text_of[source_of[key]],
            "duties": body.get("changed_duties"), "hypothesis": rationale.get("conjecture"),
            "predictions": predictions, "registration": bundle, "control_trial": body.get("control_trial_id"),
            "trials": trials, "comparison": comparison_value, "reviews": reviews, "interpretation": interpretation,
            "status": state})
    keys = {c["id"] for c in candidates}
    for row in judged:
        recommended = next((f"{s['strategy_id']}@{s['revision']}" for s in subjects.get(row["judgment_id"], [])
                            if s["role"] == "recommended" and s["strategy_id"] is not None), None)
        events.append({"at": _iso(row["created_at"]), "kind": EVENT_KINDS.get(row["kind"], "other"),
                       "ref": f"judgment {row['judgment_id']}", "text": row["body"].split("\n", 1)[0][:300],
                       "recommends": recommended if recommended in keys else None})
    events.append({"at": _iso(bundle_times.get(line)), "kind": "line_change", "ref": line,
                   "text": f"line selected; start {record['start']}", "recommends": None})
    events.sort(key=lambda e: e["at"] or "")
    targets = None if max_drawdown is None and annual_return is None else {"max_drawdown": max_drawdown,
                                                                          "annual_return": annual_return}
    return {
        "format": FORMAT, "source": "ledger",
        "scope": {"ledger_commit": commit, "start": _iso(since_at["date"]) if since_at else None, "end": None},
        "line": {"bundle": line, "start": record["start"], "window": [record["window_start"], record["window_end"]],
                 "market_commit": record["market_commit"], "targets": targets},
        "candidates": candidates, "events": events,
        "gaps": [
            "Runs without economic evidence carry no measures (the product masks them); their reasons are kept.",
            "Status: recommended and kept_reference come from the latest recommendation's subjects; superseded is any "
            "other version with economic evidence; masked, precheck_failed and unrun come from availability and reviews.",
            "Research runs are the line's own (its window and market commit); other trials of a version are kept "
            "by source.",
            "Interpretation is the latest current interpretation judgment naming the version's registration or trials.",
            "Out-of-sample validation registrations and verdicts are not drawn.",
            "Times are the ledger's UTC times without a zone.",
        ] + ([] if targets else ["No targets were given; they live in the line note and are passed by the caller."]),
    }
