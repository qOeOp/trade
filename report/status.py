"""Research facts, the research state and runs affected by an identity change (`report.research_status`,
`report.research_state`, `report.affected_runs`).

Counts are read from the ledger at an exact version, never from what an Agent remembers; the state
puts the current judgments beside read-time facts and the trials no review has covered yet. Nothing
carries a stop flag, target, score, ranking or eligibility mark; nothing is written. A run whose
stored records do not verify counts as diagnostic only, with its reason; it does not stop a count.
"""

from __future__ import annotations

from collections.abc import Mapping
import hashlib
import json
import re

from ledger import db, execution, lines, problems, witness
from ledger.errors import Refusal
from ledger.refusals import refuse
from qualification import availability
from registration import comparability, register
from report import candidates as report_candidates, measures, runs


SINGLE_KINDS = ("recommendation", "priority", "review_cadence")
MANY_KINDS = ("interpretation", "search_exposure")
DIMENSIONS = ("runtime", "effective_config", "input")
RUNTIME_KEYS = ("image_digest", "runtime_contract", "engine_version", "dependency_lock_sha256")
TRIAL_MANIFEST = re.compile(r"trial-([0-9]+)-(execution|execution-start)\Z")


def _manifests(conn: db.LedgerConnection) -> tuple[dict[int, dict], dict[int, dict]]:
    """(start receipt, final capture) execution.json of every trial by trial ID, each hash checked:
    one primary-key range read of the trial-* namespace, no blob of the captures."""
    starts: dict[int, dict] = {}
    captures: dict[int, dict] = {}
    for bundle, content, stored in conn.rows("SELECT bundle, content, sha256 FROM evidence WHERE bundle LIKE %s AND "
                                             "path = %s", ("trial-%", execution.MANIFEST)):
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
    trials = conn.dicts("SELECT t.trial_id, t.purpose, t.source_sha256, t.image_digest, t.instruments, t.input_start, "
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
            found = conn.rows("SELECT content, sha256 FROM evidence WHERE bundle = %s AND path = %s",
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


def research_status(ledger, at: str | None = None) -> dict:
    """Research fact counts at a ledger version: trials, versions, registration attempts by outcome and
    out-of-sample registrations; only counts, versions and the checker identity. The trial counts
    (`trials`, `distinct_sources`, `by_development_window`, the multiple-testing counts) leave out
    reproductions and trials stopped before the strategy ran, listed in `excluded_trials`."""
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
    return {"ledger_commit": commit, "trials": trials, "distinct_sources": sources, "by_development_window": windows,
            "excluded_trials": excluded,
            "research_attempts": len(attempts), "audit_passed_research_runs": counted["passed"],
            "valid_research_runs": counted["valid"], "diagnostic_only_research_runs": counted["diagnostic"],
            "invalid_research_runs": counted["invalid"], "unfinished_research_attempts": counted["unfinished"],
            "validation": {"registered": registered, "bound": bound, "unbound": registered - bound,
                           "unwitnessed": unwitnessed},
            "unverified_runs": unverified, "availability_checker": checker,
            "metrics_revision": checker["metrics_revision"]}


def _stamp(conn: db.LedgerConnection, commit: str):
    try:
        return witness.stamped_at(conn, commit)
    except Refusal:
        return None


# The research state

def _judgments(conn: db.LedgerConnection, line: str) -> dict[str, list[dict]]:
    found: dict[str, list[dict]] = {kind: [] for kind in (*SINGLE_KINDS, *MANY_KINDS)}
    rows = conn.dicts("SELECT judgment_id, kind, based_on_commit, cadence_trials, body, created_at FROM judgment j WHERE "
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
            derived = measures.derive_measures(measures.run_facts(conn, trial["run_id"]),
                                               market={"error": "MARKET_RETURNS_UNAVAILABLE: not read for the state"})
            headline = {measures.key(name): derived[measures.key(name)] for name in measures.HEADLINE}
        return {"trial": trial, "availability": value, "headline": headline}
    return {"registration_bundle": subject.get("registration_bundle")}


def research_state(conn: db.LedgerConnection, line_bundle: str | None = None, at: str | None = None) -> dict:
    """The current judgments of a research line with read-time facts, the trials since the last
    recommendation, the trial count of the line and the gates the next registration would meet. On
    a ledger without a research line: `line` null with the facts and `line select` as the next step."""
    checker = availability.check_identity()
    with db.read_as_of(conn.profile, at) as pinned:
        commit = db.head_commit(pinned)
        records = availability.review_records(pinned)
        line = line_bundle or (lines.current_line(pinned) or {}).get("bundle")
        if line is None:  # a new ledger: the facts the user chooses a line from, and the one next step
            needed = [{"code": "RESEARCH_LINE_REQUIRED", "message": "the ledger has no research line record",
                       "missing": ["research-line"]}]
            return {"at": commit, "line": None, **{kind: None for kind in SINGLE_KINDS}, "interpretations": [],
                    "search_exposures": [], "unreviewed_trials": [], "trials_on_line": 0,
                    "gates": {"root": needed, "derived": needed},
                    "facts": {"candidates": report_candidates.candidates(conn.profile, commit)["candidates"],
                              "counts": research_status(conn.profile, commit)},
                    "next_actions": ["Select the user's research line with `line select`."]}
        on_line = lines.line_trials(pinned, line)  # LINE_UNKNOWN for a line that does not exist
        judged = _judgments(pinned, line)
        recommendation = judged["recommendation"][-1] if judged["recommendation"] else None
        unreviewed = (lines.line_trials(pinned, line, since_commit=recommendation["based_on_commit"])["trials"]
                      if recommendation else on_line["trials"])
        for kind in judged:
            for item in judged[kind]:
                item["facts"] = [_subject_facts(pinned, subject, checker, records) for subject in item["subjects"]]
        gates: dict[str, list[dict]] = {}
        for name, derived in (("root", False), ("derived", True)):
            try:
                register.require_line_records(pinned, line, derived)
                gates[name] = []
            except Refusal as exc:
                gates[name] = [{"code": exc.code, "message": exc.message, "missing": list(exc.missing)}]
    return {"at": commit, "line": line, **{kind: (judged[kind][-1] if judged[kind] else None) for kind in SINGLE_KINDS},
            "interpretations": judged["interpretation"], "search_exposures": judged["search_exposure"],
            "unreviewed_trials": unreviewed, "trials_on_line": on_line["count"], "gates": gates,
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
        for row in conn.dicts("SELECT r.run_id, r.trial_id, r.status, t.image_digest FROM run r JOIN trial t ON "
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
