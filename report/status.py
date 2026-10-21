"""Research facts, the research state and runs affected by an identity change (`report.research_status`,
`report.research_state`, `report.affected_runs`).

Counts are read from the ledger at an exact version, never from what an Agent remembers; the state
puts the current judgments beside read-time facts and the trials no review has covered yet. Nothing
carries a stop flag, target, score, ranking or eligibility mark; nothing is written. A run whose
stored records do not verify counts as diagnostic only, with its reason; it does not stop a count.
"""

from __future__ import annotations

from collections.abc import Mapping
from datetime import date, datetime, time
import hashlib
import json
import re

from ledger import db, evidence, execution, lines, problems, witness
from ledger.errors import Refusal
from ledger.refusals import refuse
from qualification import availability
from registration import comparability, register
from report import candidates as report_candidates, measures, runs


SINGLE_KINDS = ("recommendation", "priority")
MANY_KINDS = ("interpretation", "search_exposure")
DIMENSIONS = ("runtime", "effective_config", "input")
RUNTIME_KEYS = ("image_digest", "runtime_contract", "engine_version", "dependency_lock_sha256")
# The comparison table's measures (the single-run report's), and those where less is better.
TABLE_MEASURES = ("annual_return", "mark_max_drawdown", "sharpe_365", "plan_win_rate")
LOWER_IS_BETTER = ("mark_max_drawdown",)
TRIAL_MANIFEST = re.compile(r"trial-([0-9]+)-(execution|execution-start)\Z")


def _manifests(conn: db.LedgerConnection) -> tuple[dict[int, dict], dict[int, dict]]:
    """(start receipt, final capture) execution.json of every trial by trial ID, each hash checked:
    one primary-key range read of the trial-* namespace, no blob of the captures."""
    starts: dict[int, dict] = {}
    captures: dict[int, dict] = {}
    for bundle, content, stored in conn.rows(f"SELECT e.bundle, c.content, e.sha256 FROM {evidence.files_from()} "
                                             "WHERE e.bundle LIKE %s AND e.path = %s", ("trial-%", execution.MANIFEST)):
        found = TRIAL_MANIFEST.fullmatch(bundle)
        if found is None:
            continue
        content = bytes(content)
        if hashlib.sha256(content).hexdigest() != stored:
            raise refuse("LEDGER_CORRUPT", f"stored file {bundle}/{execution.MANIFEST} differs from its content hash",
                         missing=(f"{bundle}/{execution.MANIFEST}",))
        try:
            value = json.loads(content.decode("utf-8"))
        except (UnicodeDecodeError, ValueError):
            value = None
        if isinstance(value, dict):
            (captures if found.group(2) == "execution" else starts)[int(found.group(1))] = value
    return starts, captures


def failure_stages(data: bytes) -> set[str] | None:
    """The stages of runtime failure receipt bytes; None when a line is no structured receipt."""
    stages = set()
    for line in data.decode("utf-8", errors="replace").splitlines():
        if not line.strip():
            continue
        try:
            item = json.loads(line)
        except ValueError:
            return None
        if not isinstance(item, dict) or not isinstance(item.get("stage"), str):
            return None
        stages.add(item["stage"])
    return stages


def stopped_before_strategy(capture: Mapping | None, failures: bytes | None) -> bool:
    """Whether a sealed capture shows the runner stopped before any strategy result existed: the replay
    completed on the host, the native runner exited nonzero without writing its summary, and every
    runtime failure it recorded (if any) is of a stage before the strategy trades (binding, load,
    inputs: problems.PRE_STRATEGY_STAGES)."""
    if not isinstance(capture, Mapping):
        return False
    files = capture.get("files")
    if not isinstance(files, Mapping):
        files = {}
    recorded = capture.get("stages")
    native = recorded.get("native") if isinstance(recorded, Mapping) else None
    exited = (isinstance(native, Mapping) and native.get("state") == "exited" and isinstance(native.get("exit_code"), int)
              and native["exit_code"] != 0)
    summary = (files.get("reports/summary.json") or {}).get("status")
    if not exited or (capture.get("outcome") or {}).get("kind") != "completed" or summary in ("captured", "hashed"):
        return False
    stages = failure_stages(failures) if failures else set()
    return stages is not None and stages <= problems.PRE_STRATEGY_STAGES


def _input_key(start: Mapping | None):
    try:
        return comparability.input_key((start or {}).get("input_identity"))
    except Refusal:
        return None


def counted_trials(conn: db.LedgerConnection) -> dict:
    """The trials that count as tests of a strategy, and the ones that do not (user decision
    2026-10-20): a reproduction (an explore trial replaying an earlier trial that has a run, with the
    same source, image digest, windows, instruments and inputs, as replay.reproduce writes) and a
    trial the product stopped before the strategy ran (stopped_before_strategy). Derived from the
    stored trial rows and capture manifests; nothing is marked."""
    trials = conn.dicts(f"SELECT t.trial_id, t.purpose, t.source_sha256, {db.TRIAL_IMAGE_DIGEST}, t.instruments, t.input_start, "
                        "t.trade_start, t.trade_end, r.run_id FROM trial t LEFT JOIN run r ON r.trial_id = t.trial_id "
                        "ORDER BY t.trial_id")
    starts, captures = _manifests(conn)
    reproductions, stopped, counted = [], [], []
    for trial in trials:
        trial_id = trial["trial_id"]
        identity = (trial["source_sha256"], trial["image_digest"], str(trial["instruments"]), trial["input_start"],
                    trial["trade_start"], trial["trade_end"])
        if trial["purpose"] == "explore" and any(
                earlier["run_id"] is not None and earlier["trial_id"] < trial_id
                and (earlier["source_sha256"], earlier["image_digest"], str(earlier["instruments"]),
                     earlier["input_start"], earlier["trade_start"], earlier["trade_end"]) == identity
                and _input_key(starts.get(trial_id)) is not None
                and _input_key(starts.get(earlier["trial_id"])) == _input_key(starts.get(trial_id))
                for earlier in trials):
            reproductions.append(trial_id)
            continue
        capture = captures.get(trial_id)
        failures = None
        if isinstance(capture, Mapping) and ((capture.get("files") or {}).get(execution.RUNTIME_ERRORS) or {}).get(
                "status") == "captured":
            found = conn.rows(f"SELECT c.content, e.sha256 FROM {evidence.files_from()} WHERE e.bundle = %s "
                              "AND e.path = %s",
                              (f"trial-{trial_id}-execution", execution.RUNTIME_ERRORS))
            if found and hashlib.sha256(bytes(found[0][0])).hexdigest() == found[0][1]:
                failures = bytes(found[0][0])
            else:
                capture = None  # unreadable receipts: the trial counts
        if stopped_before_strategy(capture, failures):
            stopped.append(trial_id)
            continue
        counted.append(trial)
    return {"counted": counted, "reproductions": reproductions, "stopped_before_strategy": stopped}


def research_status(ledger, at: str | None = None, line_bundle: str | None = None) -> dict:
    """Research fact counts at a ledger version: trials, versions, registration attempts by outcome and
    out-of-sample registrations; only counts, versions and the checker identity. The trial counts
    (`trials`, `distinct_sources`, `by_development_window`, the multiple-testing counts) leave out
    reproductions and trials stopped before the strategy ran, listed in `excluded_trials`.
    `comparison` is the comparison table of `line_bundle` (default: the current line; null without
    one)."""
    checker = availability.check_identity()
    with db.read_as_of(runs.profile_of(ledger), at) as conn:
        commit = db.head_commit(conn)
        records = availability.review_records(conn)
        found = counted_trials(conn)
        trials, sources = len(found["counted"]), len({trial["source_sha256"] for trial in found["counted"]})
        by_window: dict[tuple, list[dict]] = {}
        for trial in found["counted"]:
            by_window.setdefault((trial["trade_start"], trial["trade_end"]), []).append(trial)
        windows = [{"trade_start": start, "trade_end": end, "trials": len(items),
                    "distinct_sources": len({item["source_sha256"] for item in items})}
                   for (start, end), items in sorted(by_window.items())]
        excluded = {"reproductions": found["reproductions"],
                    "stopped_before_strategy": found["stopped_before_strategy"]}
        gaps = [f"run {run_id}" for (run_id,) in conn.rows(
            "SELECT r.run_id FROM run r LEFT JOIN trial t ON t.trial_id = r.trial_id WHERE t.trial_id IS NULL")]
        attempts = conn.dicts("SELECT a.registration_bundle, a.trial_id, t.trial_id AS found_trial, r.run_id, r.status "
                              "FROM registration_attempt a LEFT JOIN trial t ON t.trial_id = a.trial_id LEFT JOIN run r "
                              "ON r.trial_id = a.trial_id ORDER BY a.trial_id")
        gaps += [f"attempt trial {row['trial_id']}" for row in attempts if row["found_trial"] is None]
        if gaps:
            raise refuse("REFERENTIAL_GAP", "references to missing trial rows: " + ", ".join(gaps[:5]),
                         missing=tuple(gaps))
        counted = {"unfinished": 0, "invalid": 0, "passed": 0, "valid": 0, "diagnostic": 0}
        unverified = []
        for row in attempts:
            if row["run_id"] is None:
                counted["unfinished"] += 1
            elif row["status"] == "invalid":
                counted["invalid"] += 1
            else:
                counted["passed"] += 1
                assessed = report_candidates.assess_listed(conn, row["run_id"], checker, records)
                if assessed.get("unverified_records"):
                    unverified.append({"run_id": row["run_id"], "reason": assessed["reasons"][0]})
                counted["valid" if assessed["economic_evidence_available"] else "diagnostic"] += 1
        if counted["unfinished"] + counted["invalid"] + counted["valid"] + counted["diagnostic"] != len(attempts):
            raise refuse("REFERENTIAL_GAP", "the attempt outcomes do not add up to the attempts",
                         missing=("research_attempts",))
        (registered,), = conn.rows("SELECT COUNT(*) FROM validation_registration")
        (bound,), = conn.rows("SELECT COUNT(*) FROM validation_binding")
        unwitnessed = 0
        for commit_hash, count in conn.rows("SELECT to_commit, COUNT(*) FROM dolt_diff_validation_registration WHERE "
                                            "diff_type = 'added' GROUP BY to_commit"):
            if _stamp(conn, commit_hash) is None:
                unwitnessed += count
        line = line_bundle or (lines.current_line(conn) or {}).get("bundle")
        table = comparison_table(conn, line, checker, records) if line is not None else None
    return {"ledger_commit": commit, "trials": trials, "distinct_sources": sources, "by_development_window": windows,
            "excluded_trials": excluded,
            "research_attempts": len(attempts), "audit_passed_research_runs": counted["passed"],
            "valid_research_runs": counted["valid"], "diagnostic_only_research_runs": counted["diagnostic"],
            "invalid_research_runs": counted["invalid"], "unfinished_research_attempts": counted["unfinished"],
            "validation": {"registered": registered, "bound": bound, "unbound": registered - bound,
                           "unwitnessed": unwitnessed},
            "unverified_runs": unverified, "availability_checker": checker,
            "metrics_revision": checker["metrics_revision"], "comparison": table}


def _stamp(conn: db.LedgerConnection, commit: str):
    try:
        return witness.stamped_at(conn, commit)
    except Refusal:
        return None


# The comparison table

def _headline(conn: db.LedgerConnection, run_id: int, names) -> dict:
    """The named measures of one run as its single-run report gives them (report.derive_measures)."""
    derived = measures.derive_measures(measures.run_facts(conn, run_id),
                                       market={"error": "MARKET_RETURNS_UNAVAILABLE: not read for the state"})
    return {measures.key(name): derived[measures.key(name)] for name in names}


def _dominates(better: Mapping, worse: Mapping) -> bool:
    """Whether `better` is at least as good on all four measures and better on one; None never compares."""
    pairs = []
    for name in TABLE_MEASURES:
        mine, theirs = better[measures.key(name)]["value"], worse[measures.key(name)]["value"]
        if mine is None or theirs is None:
            return False
        pairs.append((-mine, -theirs) if name in LOWER_IS_BETTER else (mine, theirs))
    return all(mine >= theirs for mine, theirs in pairs) and any(mine > theirs for mine, theirs in pairs)


def comparison_table(conn: db.LedgerConnection, line_bundle: str, checker: Mapping, records: list) -> dict:
    """Every passed research run with economic evidence whose trading window is the line's development
    window and whose universe rule is the line's (older candidates and other lines included), with
    the four measures of its report and whether another run of the table dominates it on them.
    `non_dominated` is null for a run missing a measure. Nothing is ranked, scored or stored."""
    line = lines.read_line(conn, line_bundle, None)  # LINE_UNKNOWN or LINE_CORRUPT for a bad name
    window = (datetime.combine(date.fromisoformat(line["window_start"]), time()),
              datetime.combine(date.fromisoformat(line["window_end"]), time()))
    starts, _ = _manifests(conn)
    found = []
    for row in conn.dicts("SELECT r.run_id, t.trial_id, t.trade_start, t.trade_end, c.strategy_id, c.revision FROM run r "
                          "JOIN trial t ON t.trial_id = r.trial_id JOIN candidate c ON c.source_sha256 = t.source_sha256 "
                          "WHERE t.purpose = 'research' AND r.status = 'passed' ORDER BY r.run_id"):
        identity = (starts.get(row["trial_id"]) or {}).get("input_identity") or {}
        if (row["trade_start"], row["trade_end"]) != window or identity.get("universe_rule") != line["universe_rule"]:
            continue
        if not report_candidates.assess_listed(conn, row["run_id"], checker, records)["economic_evidence_available"]:
            continue
        found.append({"candidate": f"{row['strategy_id']}@{row['revision']}", "run_id": row["run_id"],
                      "trial_id": row["trial_id"], "measures": _headline(conn, row["run_id"], TABLE_MEASURES)})
    for item in found:
        complete = all(item["measures"][measures.key(name)]["value"] is not None for name in TABLE_MEASURES)
        item["dominated_by"] = [other["run_id"] for other in found if other is not item
                                and _dominates(other["measures"], item["measures"])]
        item["non_dominated"] = (not item["dominated_by"]) if complete else None
    return {"line": line_bundle, "window_start": line["window_start"], "window_end": line["window_end"],
            "universe_rule": line["universe_rule"], "measures": [measures.key(name) for name in TABLE_MEASURES],
            "lower_is_better": [measures.key(name) for name in LOWER_IS_BETTER], "runs": found,
            "candidates": sorted({item["candidate"] for item in found})}


def compared_candidates(profile, line_bundle: str, at: str) -> list[str]:
    """The candidates of the line's comparison table at `at` (what a recommendation must name)."""
    checker = availability.check_identity()
    with db.read_as_of(runs.profile_of(profile), at) as conn:
        return comparison_table(conn, line_bundle, checker, availability.review_records(conn))["candidates"]


# The research state

def _judgment_history(conn: db.LedgerConnection, line: str, include: bool, before: int | None) -> dict:
    """Original judgments, including replaced ones; bounded pages without recomputing old facts."""
    (total, replaced), = conn.rows(
        "SELECT COUNT(*), SUM(CASE WHEN n.judgment_id IS NOT NULL THEN 1 ELSE 0 END) "
        "FROM judgment j LEFT JOIN judgment n ON n.supersedes = j.judgment_id WHERE j.line_bundle = %s", (line,))
    result = {"total": int(total), "superseded": int(replaced or 0), "entries": [], "next_before": None}
    if not include:
        return result
    rows = conn.dicts("SELECT j.judgment_id, j.kind, j.based_on_commit, j.body, j.created_at, j.supersedes, "
                      "n.judgment_id AS superseded_by FROM judgment j LEFT JOIN judgment n "
                      "ON n.supersedes = j.judgment_id WHERE j.line_bundle = %s "
                      "AND (%s IS NULL OR j.judgment_id < %s) ORDER BY j.judgment_id DESC LIMIT 21",
                      (line, before, before))
    page = rows[:20]
    if page:
        ids = [row["judgment_id"] for row in page]
        subjects: dict[int, list[dict]] = {}
        for subject in conn.dicts("SELECT judgment_id, seq, role, strategy_id, revision, trial_id, registration_bundle "
                                  "FROM judgment_subject WHERE judgment_id IN (" + ",".join(["%s"] * len(ids)) + ") "
                                  "ORDER BY judgment_id, seq", tuple(ids)):
            subjects.setdefault(subject.pop("judgment_id"), []).append(subject)
        for row in page:
            row["subjects"] = subjects.get(row["judgment_id"], [])
    return {**result, "entries": page, "next_before": page[-1]["judgment_id"] if len(rows) > 20 else None}


def _judgments(conn: db.LedgerConnection, line: str) -> dict[str, list[dict]]:
    found: dict[str, list[dict]] = {kind: [] for kind in (*SINGLE_KINDS, *MANY_KINDS)}
    rows = conn.dicts("SELECT judgment_id, kind, based_on_commit, body, created_at FROM judgment j WHERE "
                      "line_bundle = %s AND NOT EXISTS (SELECT 1 FROM judgment n WHERE n.supersedes = j.judgment_id) "
                      "ORDER BY judgment_id", (line,))
    subjects: dict[int, list[dict]] = {}
    for row in conn.dicts("SELECT s.judgment_id, s.seq, s.role, s.strategy_id, s.revision, s.trial_id, "
                          "s.registration_bundle FROM judgment_subject s JOIN judgment j ON j.judgment_id = s.judgment_id "
                          "WHERE j.line_bundle = %s ORDER BY s.judgment_id, s.seq", (line,)):
        subjects.setdefault(row.pop("judgment_id"), []).append(row)
    for row in rows:
        found[row["kind"]].append({**row, "subjects": subjects.get(row["judgment_id"], [])})
    for kind in SINGLE_KINDS:
        found[kind] = found[kind][-1:]
    return found


def _subject_facts(conn: db.LedgerConnection, subject: Mapping, checker: Mapping, records: list) -> dict:
    if subject.get("strategy_id") is not None:
        row = conn.one("SELECT strategy_id, revision, source_sha256, parent_strategy_id, parent_revision, difference "
                       "FROM candidate WHERE strategy_id = %s AND revision = %s",
                       (subject["strategy_id"], subject["revision"]))
        return {"candidate": row}
    if subject.get("trial_id") is not None:
        trial = conn.one("SELECT t.trial_id, t.purpose, t.source_sha256, r.run_id, r.status FROM trial t LEFT JOIN run r "
                         "ON r.trial_id = t.trial_id WHERE t.trial_id = %s", (subject["trial_id"],))
        if trial is None or trial["run_id"] is None:
            return {"trial": trial, "availability": None, "headline": None}
        value = report_candidates.assess_listed(conn, trial["run_id"], checker, records)
        headline = None
        if trial["status"] == "passed" and value["economic_evidence_available"]:
            headline = _headline(conn, trial["run_id"], measures.HEADLINE)
        return {"trial": trial, "availability": value, "headline": headline}
    return {"registration_bundle": subject.get("registration_bundle")}


def research_state(conn: db.LedgerConnection, line_bundle: str | None = None, at: str | None = None, *,
                   history: bool = False, history_before: int | None = None) -> dict:
    """The research line's whole record (`line`: bundle, start, window, market commit, universe rule,
    note), its current judgments with read-time facts, the fixed review cadence (`review_every`),
    the trials since the last recommendation, the trial count of the line and the gates the next registration would meet. On
    a ledger without a research line: `line` null with the facts and `line select` as the next step."""
    checker = availability.check_identity()
    with db.read_as_of(conn.profile, at) as pinned:
        commit = db.head_commit(pinned)
        records = availability.review_records(pinned)
        line = line_bundle or (lines.current_line(pinned) or {}).get("bundle")
        if line is None:  # a new ledger: the facts the user chooses a line from, and the one next step
            needed = [{"code": "RESEARCH_LINE_REQUIRED", "message": "the ledger has no research line record",
                       "missing": ["research-line"]}]
            return {"at": commit, "line": None, **{kind: None for kind in SINGLE_KINDS}, "review_every": register.REVIEW_EVERY,
                    "interpretations": [], "search_exposures": [], "unreviewed_trials": [], "trials_on_line": 0,
                    "gates": needed,
                    "judgment_history": {"total": 0, "superseded": 0, "entries": [], "next_before": None},
                    "facts": {"candidates": report_candidates.candidates(conn.profile, commit)["candidates"],
                              "counts": research_status(conn.profile, commit)},
                    "next_actions": ["Select the user's research line with `line select`."]}
        on_line = lines.line_trials(pinned, line)  # LINE_UNKNOWN for a line that does not exist
        record = lines.read_line(pinned, line, None)
        judged = _judgments(pinned, line)
        original = _judgment_history(pinned, line, history or history_before is not None, history_before)
        recommendation = judged["recommendation"][-1] if judged["recommendation"] else None
        unreviewed = (lines.line_trials(pinned, line, since_commit=recommendation["based_on_commit"])["trials"]
                      if recommendation else on_line["trials"])
        for kind in judged:
            for item in judged[kind]:
                item["facts"] = [_subject_facts(pinned, subject, checker, records) for subject in item["subjects"]]
        try:
            register.require_line_records(pinned, line)
            gates: list[dict] = []
        except Refusal as exc:
            gates = [{"code": exc.code, "message": exc.message, "missing": list(exc.missing)}]
    return {"at": commit, "line": record, **{kind: (judged[kind][-1] if judged[kind] else None) for kind in SINGLE_KINDS},
            "review_every": register.REVIEW_EVERY, "interpretations": judged["interpretation"], "search_exposures": judged["search_exposure"],
            "unreviewed_trials": unreviewed, "trials_on_line": on_line["count"], "gates": gates,
            "judgment_history": original,
            "facts": {"candidates": report_candidates.candidates(conn.profile, commit)["candidates"],
                      "counts": research_status(conn.profile, commit)}}


# Runs affected by an identity change

def _check_query(current) -> None:
    if not isinstance(current, Mapping) or not current or set(current) - set(DIMENSIONS):
        raise refuse("INVALID_QUERY", "current names at least one of runtime, effective_config, input and nothing else",
                     expected="{runtime?, effective_config?, input?}")
    runtime = current.get("runtime")
    if "runtime" in current and (not isinstance(runtime, Mapping) or not runtime or set(runtime) - set(RUNTIME_KEYS)):
        raise refuse("INVALID_QUERY", "runtime holds only " + ", ".join(RUNTIME_KEYS), expected=", ".join(RUNTIME_KEYS))


def _retry_chain(conn: db.LedgerConnection, bundle: str) -> list[str]:
    chain, seen = [], {bundle}
    retry = register.load_plan(conn, bundle)[0]["body"].get("retry_of")
    while retry is not None and retry not in seen:
        chain.append(retry)
        seen.add(retry)
        retry = register.load_plan(conn, retry)[0]["body"].get("retry_of")
    return chain


def affected_runs(ledger, current: Mapping, at: str | None = None) -> dict:
    """Sealed runs whose recorded execution identity differs from `current` in a given dimension, with
    the registrations, validations and registration bundles that cite them; no priority or mark.
    Only the dimensions given are compared; a runtime key the ledger does not record is listed in
    `unrecorded` rather than guessed."""
    _check_query(current)
    with db.read_as_of(runs.profile_of(ledger), at) as conn:
        commit = db.head_commit(conn)
        affected, unrecorded = [], set()
        for row in conn.dicts(f"SELECT r.run_id, r.trial_id, r.status, {db.TRIAL_IMAGE_DIGEST} FROM run r JOIN trial t ON "
                              "t.trial_id = r.trial_id ORDER BY r.run_id"):
            record = register.control_run(conn, row["run_id"])
            start = execution.read_capture(conn, row["trial_id"])["start"]
            runtime = start.get("runtime_identity") or {}
            if (row["image_digest"] is None or not isinstance(record.get("effective_config"), Mapping)
                    or not isinstance(record.get("input_identity"), Mapping)):
                raise refuse("RUN_IDENTITY_MISSING", f"run {row['run_id']} lacks its runtime image, effective "
                                                     "configuration or input identity; run the whole review",
                             missing=(f"run {row['run_id']}",))
            recorded = {"image_digest": row["image_digest"], "runtime_contract": runtime.get("runtime_contract"),
                        "engine_version": None, "dependency_lock_sha256": None,
                        "config_key": comparability.config_key(record["effective_config"]),
                        "input_key": comparability.input_key(record["input_identity"])}
            differs = []
            for name, value in (current.get("runtime") or {}).items():
                if recorded[name] is None:
                    unrecorded.add(f"runtime.{name}")
                elif recorded[name] != value:
                    differs.append(f"runtime.{name}")
            if "effective_config" in current and recorded["config_key"] != comparability.config_key(
                    current["effective_config"]):
                differs.append("effective_config")
            if "input" in current and recorded["input_key"] != comparability.input_key(current["input"]):
                differs.append("input")
            if differs:
                affected.append({"run_id": row["run_id"], "trial_id": row["trial_id"], "status": row["status"],
                                 "differs_in": differs, "recorded": recorded})
        trial_ids = [item["trial_id"] for item in affected]
        run_ids = {item["run_id"] for item in affected}
        registrations, validation, cited = [], [], []
        if trial_ids:
            marks = ", ".join(["%s"] * len(trial_ids))
            for bundle, source, trial_id in conn.rows(f"SELECT registration_bundle, source_sha256, trial_id FROM "
                                                      f"registration_attempt WHERE trial_id IN ({marks}) ORDER BY trial_id",
                                                      tuple(trial_ids)):
                registrations.append({"bundle": bundle, "source_sha256": source, "trial_id": trial_id,
                                      "retry_of_chain": _retry_chain(conn, bundle)})
            validation = [{"registration_id": registration_id, "run_id": run_id} for registration_id, run_id in conn.rows(
                f"SELECT b.registration_id, r.run_id FROM validation_binding b JOIN run r ON r.trial_id = b.trial_id WHERE "
                f"b.trial_id IN ({marks}) ORDER BY b.registration_id", tuple(trial_ids))]
            for (bundle,) in conn.rows("SELECT bundle FROM evidence_bundle WHERE bundle LIKE 'registration-%' ORDER BY "
                                       "bundle"):
                if register.load_plan(conn, bundle)[0]["body"].get("control_run") in run_ids:
                    cited.append(bundle)
    return {"ledger_commit": commit, "current": json.loads(json.dumps(current, default=str)), "runs": affected,
            "registrations": registrations, "validation": validation, "evidence_bundles": cited,
            "unrecorded": sorted(unrecorded)}
