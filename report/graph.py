"""A research line as a research-graph@3 document, read from the ledger only (`research graph`).

It composes the product's own readers (candidates, the line record, run measures and availability,
registration plans, the comparison, source reviews and judgments) and adds no rule of its own, so
the same ledger commit always gives the same graph. It reads nothing outside the ledger; the
research-graph tool (ide) checks, lays out, renders and compares the document.
"""
from __future__ import annotations

from collections.abc import Callable, Mapping
from concurrent.futures import ProcessPoolExecutor
import copy
import dataclasses
import multiprocessing

from ledger import db, lines
from ledger import targets as line_targets
from ledger.errors import Refusal
from ledger.refusals import refuse
from qualification import availability
from registration import precheck, register
from report import candidates as report_candidates
from report import comparison, measures, runs, seams, status

FORMAT = "research-graph@3"
MEASURE_KEYS = {"annual_return": "annual_return", "mark_max_drawdown": "max_drawdown", "sharpe_365": "sharpe",
                "plan_win_rate": "win_rate"}
EVENT_KINDS = {"recommendation": "recommendation", "priority": "priority", "interpretation": "interpretation",
               "search_exposure": "other"}
# A service the graph reads is down, refuses the account or holds another schema generation.
ENVIRONMENT = frozenset({"LEDGER_UNAVAILABLE", "LEDGER_PERMISSION", "SCHEMA_MISMATCH", "MARKET_UNREACHABLE"})


def _iso(value) -> str | None:
    return value.isoformat() if value is not None else None


def _lineage(rows: list[dict], seeds: set[str], elsewhere: set[str]) -> list[dict]:
    """The candidates connected to the seeds (the line's start and the candidates of its research
    trials) through parents or a shared strategy id, never through a candidate in `elsewhere` (its
    research runs are all another line's): one parent across lines does not draw that line here."""
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
            todo.extend(linked[key] - seen - elsewhere)
    return sorted((by_id[key] for key in seen), key=lambda r: (r["created_at"], r["strategy_id"], r["revision"]))


def _comparison(profile, bundle: str, trial_id: int, at: str) -> tuple[dict | None, list[dict] | None]:
    """(comparison, predictions with outcomes) from the product comparison, or (None, None) when it refuses
    for a comparison fact (no control, not comparable); an environment failure refuses the graph."""
    try:
        found = comparison.compare(profile, bundle, trial_id, at)
    except Refusal as exc:
        failure = _environment_failure(exc)
        if failure is not None:
            raise failure from exc
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
             "detectable": evidence.get("detectable_annual_return_difference_80pct_normal_approx"),
             "interval_crosses_zero": crosses, "summary": None}, predictions)


def _environment_failure(exc: Refusal) -> Refusal | None:
    """The refusal for a service the graph needs being unreachable, refusing the account or holding
    another schema generation (the market's under a MARKET_RETURNS_UNAVAILABLE), else None: a graph
    drawn without it would be wrong, not just incomplete."""
    if exc.code in ENVIRONMENT:
        return exc
    cause = getattr(exc.__cause__, "code", None)
    return refuse(cause, f"{exc.code}: {exc.message}") if cause in ENVIRONMENT else None


def _reusing(read: Callable, failures: list[Refusal]) -> Callable:
    """`read` (seams.market_returns) answering a repeated window from its first answer: a market commit
    is immutable, so one graph reads each window once instead of once per comparison. Failures are not
    kept, but environment failures are noted in `failures`, since the readers turn a refusal into a
    missing measure; every caller gets its own copy."""
    answers: dict = {}

    def market_returns(*window):
        if window not in answers:
            try:
                answers[window] = read(*window)
            except Refusal as exc:
                failure = _environment_failure(exc)
                if failure is not None:
                    failures.append(failure)
                raise
        return copy.deepcopy(answers[window])
    return market_returns


_WORKER_FAILURES: list[Refusal] = []


def _start_worker(base: seams.Seams) -> None:
    seams.current = dataclasses.replace(base, market_returns=_reusing(base.market_returns, _WORKER_FAILURES))


def _worker_comparison(job: tuple) -> tuple:
    _WORKER_FAILURES.clear()
    return _comparison(*job), list(_WORKER_FAILURES)


def _comparisons(profile, jobs: list[tuple[str, int]], at: str, workers: int, base: seams.Seams,
                 failures: list[Refusal]) -> list[tuple[dict | None, list[dict] | None]]:
    """`_comparison` of each (bundle, trial_id) in job order, in `workers` processes when there are more
    than one: each reads a market window once, its environment failures join `failures`, and the first
    refusal in job order refuses the graph, as in one process."""
    if workers <= 1 or len(jobs) <= 1:
        return [_comparison(profile, bundle, trial_id, at) for bundle, trial_id in jobs]
    with ProcessPoolExecutor(min(workers, len(jobs)), mp_context=multiprocessing.get_context("spawn"),
                             initializer=_start_worker, initargs=(base,)) as pool:
        found = []
        for value, noted in pool.map(_worker_comparison, [(profile, bundle, trial_id, at) for bundle, trial_id in jobs]):
            found.append(value)
            failures.extend(noted)
        return found


def research_graph(profile, line_bundle: str | None = None, at: str | None = None, *, since: str | None = None,
                   workers: int = 1) -> dict:
    """The research-graph@3 document of a line at a ledger version, with the user's targets in force for
    the line at that version (ledger.targets); `since` marks where the scope under study starts. When the
    ledger or market service cannot be read as this code expects it refuses rather than drawing a graph
    whose missing comparisons and measures would look like research facts. With `workers` above one the
    comparisons run in that many processes (the seams in force must pickle); the document is the same."""
    failures: list[Refusal] = []
    base = seams.current
    with seams.use(market_returns=_reusing(base.market_returns, failures)):
        document = _document(profile, line_bundle, at, since, workers, base, failures)
    if failures:
        raise failures[0]
    return document


def _document(profile, line_bundle: str | None, at: str | None, since: str | None, workers: int,
              base: seams.Seams, failures: list[Refusal]) -> dict:
    profile = runs.profile_of(profile)
    checker = availability.check_identity()
    with db.read_as_of(profile, at) as conn:
        commit = db.head_commit(conn)
        line = line_bundle or lines.open_line(conn)["bundle"]
        record = lines.read_line(conn, line, None)
        in_force = line_targets.targets_for(conn, line)
        rows = conn.dicts(f"SELECT {', '.join(report_candidates.CANDIDATE_COLUMNS)} FROM candidate")
        on_line = set(lines.line_trials(conn, line)["trials"])
        researched = conn.dicts("SELECT trial_id, source_sha256 FROM trial WHERE purpose = 'research'")
        sources = {row["source_sha256"] for row in researched if row["trial_id"] in on_line}
        seeds = {record["start"]} | {f"{r['strategy_id']}@{r['revision']}" for r in rows if r["source_sha256"] in sources}
        elsewhere = {row["source_sha256"] for row in researched} - sources
        members = _lineage(rows, seeds, {f"{r['strategy_id']}@{r['revision']}" for r in rows
                                         if r["source_sha256"] in elsewhere})
        source_of = {f"{r['strategy_id']}@{r['revision']}": r["source_sha256"] for r in members}
        wanted = sorted(set(source_of.values()))
        text_of = {r["source_sha256"]: bytes(r["source"]).decode() for r in conn.dicts(
            f"SELECT source_sha256, source FROM candidate WHERE source_sha256 IN ({', '.join(['%s'] * len(wanted))})",
            tuple(wanted))} if wanted else {}
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
        source_checks: dict[int, dict] = {}  # a research run's availability source_check, by trial
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
                if value.get("source_check") is not None:
                    source_checks[row["trial_id"]] = value["source_check"]
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
    chosen = {f"{s['strategy_id']}@{s['revision']}" for s in latest
              if s["role"] == "recommended" and s["strategy_id"] is not None}
    candidates: list[dict] = []
    events: list[dict] = []
    bodies: list[Mapping] = []
    jobs: list[tuple[int, str, int]] = []
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
                            "note": "\n\n".join(
                                f"{'API' if name == 'api' else name.title()} ({rec[name]['status']})\n{rec[name]['note']}"
                                for name in precheck.ITEMS if isinstance(rec.get(name), Mapping)) or None})
            if rec["verdict"] == "failed":
                # The consequence is availability's, not re-derived here: the runs it counts this review against,
                # and the runs it names the review ignored for (a resolved zero-activity failure) with its reason.
                checked = [(t["trial_id"], source_checks[t["trial_id"]]) for t in research if t["trial_id"] in source_checks]
                masked = [trial_id for trial_id, check in checked
                          if any(r["bundle"] == item["bundle"] and r["verdict"] == "failed" for r in check["reviews"])]
                kept: dict[str, list[int]] = {}
                for trial_id, check in checked:
                    for skipped in check["ignored"]:
                        if skipped["bundle"] == item["bundle"]:
                            kept.setdefault(skipped["reason"], []).append(trial_id)
                text = (f"failed source review of {key} ({', '.join(failed) or 'unspecified'}); "
                        f"runs of this source without economic evidence by it: {masked or 'none'}")
                text += "".join(f"; not counted for {ids}: {reason}" for reason, ids in kept.items())
                events.append({"at": _iso(bundle_times.get(item["bundle"])), "kind": "eligibility_change", "ref": item["bundle"],
                               "text": text, "recommends": None})
        if bundle is not None and research and research[-1]["status"] == "passed":
            jobs.append((len(candidates), bundle, research[-1]["trial_id"]))
        trial_ids = {t["trial_id"] for t in trials}
        interpretation = next((row["body"] for row in reversed(current) if row["kind"] == "interpretation" and any(
            s["trial_id"] in trial_ids or (bundle is not None and s["registration_bundle"] == bundle)
            for s in subjects.get(row["judgment_id"], []))), None)
        if key in chosen:
            state = "recommended"
        elif research and research[-1]["eligible"] is False:
            state = "masked"
        elif not research:
            state = "precheck_failed" if any(r["verdict"] == "failed" for r in reviews) else "unrun"
        else:
            state = "superseded"
        rationale = body.get("rationale") if isinstance(body.get("rationale"), Mapping) else {}
        candidates.append({
            "id": key, "parent": f"{row['parent_strategy_id']}@{row['parent_revision']}" if row["parent_strategy_id"] else None,
            "created_at": _iso(row["created_at"]), "change": row["difference"] or row["description"],
            "source": text_of[source_of[key]],
            "duties": body.get("changed_duties"), "hypothesis": rationale.get("conjecture"),
            "predictions": None, "registration": bundle, "control_trial": body.get("control_trial_id"),
            "trials": trials, "comparison": None, "reviews": reviews, "interpretation": interpretation,
            "status": state})
        bodies.append(body)
    found = _comparisons(profile, [(bundle, trial_id) for _, bundle, trial_id in jobs], commit, workers, base, failures)
    for (index, _, _), (comparison_value, predictions) in zip(jobs, found, strict=True):
        candidates[index].update(comparison=comparison_value, predictions=predictions)
    for candidate, body in zip(candidates, bodies, strict=True):
        if candidate["predictions"] is None and isinstance(body.get("prediction"), Mapping):
            candidate["predictions"] = [
                {"measure": f"{p.get('slice')}.{p.get('measure')}" if p.get("slice") else p.get("measure"),
                 "direction": p.get("direction"), "outcome": None}
                for p in body["prediction"].get("mechanism") or []] or None
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
    targets = None if in_force is None else {key: in_force[key] for key in ("max_drawdown", "annual_return")}
    return {
        "format": FORMAT, "source": "ledger",
        "scope": {"ledger_commit": commit, "start": _iso(since_at["date"]) if since_at else None, "end": None},
        "line": {"bundle": line, "start": record["start"], "window": [record["window_start"], record["window_end"]],
                 "market_commit": record["market_commit"], "targets": targets},
        "candidates": candidates, "events": events,
        "gaps": [
            "Runs without economic evidence carry no measures (the product masks them); their reasons are kept.",
            "Status: recommended is the latest recommendation's recommended subject; superseded is any other version "
            "with economic evidence, whether or not the recommendation names it; masked, precheck_failed and unrun come "
            "from availability and reviews.",
            "Research runs are the line's own (its window and market commit); other trials of a version are kept "
            "by source. A version whose research runs are all another line's is left out, with what only it links.",
            "Interpretation is the latest current interpretation judgment naming the version's registration or trials.",
            "Out-of-sample validation registrations and verdicts are not drawn.",
            "Times are the ledger's UTC times without a zone.",
        ] + ([] if targets else ["No targets are set for this line or as the ledger default at this version."]),
    }
