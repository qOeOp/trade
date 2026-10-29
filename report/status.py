"""Research facts and the research state (`report.research_status`, `report.research_state`).

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

from ledger import db, evidence, execution, judgments, lines, problems, reproduction, witness
from ledger import targets as line_targets
from ledger.errors import Refusal
from ledger.refusals import refuse
from qualification import availability
from registration import comparability, register
from report import candidates as report_candidates, measures, runs, seams
from runtime import image


SINGLE_KINDS = ("recommendation", "priority")
MANY_KINDS = ("interpretation", "search_exposure")
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


def _identities(conn: db.LedgerConnection, starts: Mapping[int, dict]) -> dict[int, dict | None]:
    """The execution identity of every trial with a start receipt, by trial ID: what
    registration.check_comparable compares (the runtime image digest, the effective configuration
    without host locations, the input identity without host roots, check times and the exporter's
    source hash), read from the receipt's execution.json and input-coverage.json (one range read,
    each hash checked). `key` hashes the three; runs compare only under one key. None when the
    receipt holds no readable identity."""
    coverages: dict[int, object] = {}
    for bundle, content, stored in conn.rows(f"SELECT e.bundle, c.content, e.sha256 FROM {evidence.files_from()} "
                                             "WHERE e.bundle LIKE %s AND e.path = %s",
                                             ("trial-%-execution-start", execution.COVERAGE)):
        found = TRIAL_MANIFEST.fullmatch(bundle)
        if found is None:
            continue
        content = bytes(content)
        if hashlib.sha256(content).hexdigest() != stored:
            raise refuse("LEDGER_CORRUPT", f"stored file {bundle}/{execution.COVERAGE} differs from its content hash",
                         missing=(f"{bundle}/{execution.COVERAGE}",))
        try:
            coverages[int(found.group(1))] = json.loads(content.decode("utf-8"))
        except (UnicodeDecodeError, ValueError):
            pass
    identities: dict[int, dict | None] = {}
    for trial_id, start in starts.items():
        coverage = coverages.get(trial_id)
        recorded = start.get("runtime_identity")
        runtime: Mapping = recorded if isinstance(recorded, Mapping) else {}
        try:
            config = comparability.config_key(coverage.get("effective_config") if isinstance(coverage, Mapping) else None)
            inputs = comparability.input_key(start.get("input_identity"))
        except Refusal:
            identities[trial_id] = None
            continue
        compared = {"image_digest": runtime.get("image_digest"), "effective_config": config, "input_identity": inputs}
        account = config["account"] if isinstance(config["account"], Mapping) else {}
        identities[trial_id] = {"runtime_contract": runtime.get("runtime_contract"), "execution": account.get("execution"),
                                "image_digest": runtime.get("image_digest"),
                                "key": hashlib.sha256(db.canonical_json(compared).encode("utf-8")).hexdigest()}
    return identities


def line_identity(conn: db.LedgerConnection, line_bundle: str, identities: Mapping[int, dict | None]) -> dict | None:
    """The execution identity of a research line: that of its latest research trial added since the
    line was selected (ledger.line_trials), None before the first. A contract or execution change
    ends a line; within one, a rebuilt image replaces the identity (research-round's changes.md)."""
    (selected,), = conn.rows("SELECT to_commit FROM dolt_diff_evidence_bundle WHERE to_bundle = %s "
                             "AND diff_type = 'added' LIMIT 1", (line_bundle,))
    own = [identities.get(trial_id) for trial_id in lines.line_trials(conn, line_bundle, since_commit=selected)["trials"]]
    own = [identity for identity in own if identity is not None]
    return own[-1] if own else None


def _same(identity: Mapping | None, other: Mapping | None) -> bool:
    return identity is not None and other is not None and identity["key"] == other["key"]


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
                        "t.trade_start, t.trade_end, r.status FROM trial t LEFT JOIN run r ON r.trial_id = t.trial_id "
                        "ORDER BY t.trial_id")
    starts, captures = _manifests(conn)
    reproductions, stopped, counted = [], [], []
    for trial in trials:
        trial_id = trial["trial_id"]
        identity = (trial["source_sha256"], trial["image_digest"], str(trial["instruments"]), trial["input_start"],
                    trial["trade_start"], trial["trade_end"])
        if trial["purpose"] == "explore" and any(
                earlier["status"] is not None and earlier["trial_id"] < trial_id
                and (earlier["source_sha256"], earlier["image_digest"], str(earlier["instruments"]),
                     earlier["input_start"], earlier["trade_start"], earlier["trade_end"]) == identity
                and _input_key(starts.get(trial_id)) is not None
                and _input_key(starts.get(earlier["trial_id"])) == _input_key(starts.get(trial_id))
                for earlier in trials):
            reproductions.append(trial_id)
            continue
        if trial["purpose"] == "explore" and any(
                earlier["purpose"] == "precheck"
                and (earlier["source_sha256"], earlier["image_digest"], str(earlier["instruments"]), earlier["input_start"],
                     earlier["trade_start"], earlier["trade_end"]) == identity
                and reproduction.matches(conn, trial_id, earlier["trial_id"])
                for earlier in trials if earlier["trial_id"] < trial_id):
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
    `comparison` is the comparison table of `line_bundle` (default: the only open line; null when no
    line or several lines are open)."""
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
        gaps = [f"run {trial_id}" for (trial_id,) in conn.rows(
            "SELECT r.trial_id FROM run r LEFT JOIN trial t ON t.trial_id = r.trial_id WHERE t.trial_id IS NULL")]
        attempts = conn.dicts("SELECT a.registration_bundle, a.trial_id, t.trial_id AS found_trial, r.status "
                              "FROM registration_attempt a LEFT JOIN trial t ON t.trial_id = a.trial_id LEFT JOIN run r "
                              "ON r.trial_id = a.trial_id ORDER BY a.trial_id")
        gaps += [f"attempt trial {row['trial_id']}" for row in attempts if row["found_trial"] is None]
        if gaps:
            raise refuse("REFERENTIAL_GAP", "references to missing trial rows: " + ", ".join(gaps[:5]),
                         missing=tuple(gaps))
        counted = {"unfinished": 0, "invalid": 0, "passed": 0, "valid": 0, "diagnostic": 0}
        unverified = []
        for row in attempts:
            if row["status"] is None:
                counted["unfinished"] += 1
            elif row["status"] == "invalid":
                counted["invalid"] += 1
            else:
                counted["passed"] += 1
                assessed = report_candidates.assess_listed(conn, row["trial_id"], checker, records)
                if assessed.get("unverified_records"):
                    unverified.append({"trial_id": row["trial_id"], "reason": assessed["reasons"][0]})
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
        opened = lines.open_lines(conn)
        line = line_bundle or (opened[0] if len(opened) == 1 else None)
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

def _headline(conn: db.LedgerConnection, trial_id: int, names) -> dict:
    """The named measures of one run as its single-run report gives them (report.derive_measures)."""
    derived = measures.derive_measures(measures.run_facts(conn, trial_id),
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
    its execution identity (_identities), the four measures of its report and whether another run of
    the same identity dominates it on them. `non_dominated` is null for a run missing a measure or
    without a readable identity. `execution_identity` is the line's (line_identity) and `candidates`
    the candidates with a run of it, which a recommendation must name. Passed runs of that window
    without economic evidence are listed apart with their reasons and no measures. Nothing is
    ranked, scored or stored."""
    line = lines.read_line(conn, line_bundle, None)  # LINE_UNKNOWN or LINE_CORRUPT for a bad name
    window = (datetime.combine(date.fromisoformat(line["window_start"]), time()),
              datetime.combine(date.fromisoformat(line["window_end"]), time()))
    starts, _ = _manifests(conn)
    identities = _identities(conn, starts)
    current = line_identity(conn, line_bundle, identities)
    found, excluded = [], []
    for row in conn.dicts("SELECT r.trial_id, t.trade_start, t.trade_end, c.strategy_id, c.revision FROM run r "
                          "JOIN trial t ON t.trial_id = r.trial_id JOIN candidate c ON c.source_sha256 = t.source_sha256 "
                          "WHERE t.purpose = 'research' AND r.status = 'passed' ORDER BY r.trial_id"):
        identity = (starts.get(row["trial_id"]) or {}).get("input_identity") or {}
        if (row["trade_start"], row["trade_end"]) != window or identity.get("universe_rule") != line["universe_rule"]:
            continue
        assessed = report_candidates.assess_listed(conn, row["trial_id"], checker, records)
        labelled = identities.get(row["trial_id"])
        if not assessed["economic_evidence_available"]:
            excluded.append({"candidate": f"{row['strategy_id']}@{row['revision']}", "trial_id": row["trial_id"],
                             "execution_identity": labelled, "reasons": assessed["reasons"]})
            continue
        found.append({"candidate": f"{row['strategy_id']}@{row['revision']}", "trial_id": row["trial_id"],
                      "execution_identity": labelled, "measures": _headline(conn, row["trial_id"], TABLE_MEASURES)})
    for item in found:
        complete = all(item["measures"][measures.key(name)]["value"] is not None for name in TABLE_MEASURES)
        item["dominated_by"] = [other["trial_id"] for other in found if other is not item
                                and _same(other["execution_identity"], item["execution_identity"])
                                and _dominates(other["measures"], item["measures"])]
        item["non_dominated"] = (not item["dominated_by"]) if complete and item["execution_identity"] else None
    return {"line": line_bundle, "window_start": line["window_start"], "window_end": line["window_end"],
            "universe_rule": line["universe_rule"], "execution_identity": current,
            "measures": [measures.key(name) for name in TABLE_MEASURES],
            "lower_is_better": [measures.key(name) for name in LOWER_IS_BETTER], "runs": found,
            "candidates": sorted({item["candidate"] for item in found if _same(item["execution_identity"], current)}),
            "without_economic_evidence": excluded}


def compared_candidates(profile, line_bundle: str, at: str) -> list[str]:
    """The candidates with a run of the line's execution identity in its comparison table at `at`
    (what a recommendation must name)."""
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
        trial = conn.one("SELECT t.trial_id, t.purpose, t.source_sha256, r.status FROM trial t LEFT JOIN run r "
                         "ON r.trial_id = t.trial_id WHERE t.trial_id = %s", (subject["trial_id"],))
        if trial is None or trial["status"] is None:
            return {"trial": trial, "availability": None, "headline": None}
        value = report_candidates.assess_listed(conn, trial["trial_id"], checker, records)
        headline = None
        if trial["status"] == "passed" and value["economic_evidence_available"]:
            headline = _headline(conn, trial["trial_id"], measures.HEADLINE)
        return {"trial": trial, "availability": value, "headline": headline}
    return {"registration_bundle": subject.get("registration_bundle")}


def _unsupported_contract(conn: db.LedgerConnection, record: Mapping, judged: Mapping) -> list[dict]:
    """A gate when the candidates the line continues from were published for a runtime contract this
    product has no image layout for: the recommended, parent and control candidates of the current
    recommendation and priority, else the line's start. Precheck and sealing hold a run to its
    candidate's contract and a registration to its control's, so the line cannot be replayed or
    compared on the current runtime; a contract change closes the line (user decision 2026-10-25)."""
    named = sorted({(subject["strategy_id"], subject["revision"]) for kind in SINGLE_KINDS for item in judged[kind]
                    for subject in item["subjects"] if subject["role"] in judgments.CANDIDATE_ROLES})
    if not named:
        strategy_id, _, revision = record["start"].rpartition("@")
        named = [(strategy_id, int(revision))]
    rows = conn.rows("SELECT strategy_id, revision, runtime_contract FROM candidate WHERE "
                     + " OR ".join(["(strategy_id = %s AND revision = %s)"] * len(named)),
                     tuple(value for pair in named for value in pair))
    old = sorted((contract, f"{strategy_id}@{revision}") for strategy_id, revision, contract in rows
                 if contract not in image.LAYOUTS)
    if not old:
        return []
    contracts, supported = ", ".join(sorted({contract for contract, _ in old})), ", ".join(sorted(image.LAYOUTS))
    return [{"code": "RUNTIME_UNSUPPORTED",
             "message": f"the line's candidates and their runs are on {contracts}, which this product cannot replay "
                        f"(it runs {supported}); the line can only be closed and research restarted on {supported}",
             "missing": [name for _, name in old]}]


def _unresolved_market(record: Mapping) -> list[dict]:
    """A gate when no branch of the active market database holds the line's pinned market commit: the
    line's next registration is refused MARKET_COMMIT_UNRESOLVED and its runs cannot be replayed until
    that commit is back in the database. Nothing when the market cannot be read."""
    found = seams.current.market_commit(record["market_commit"])
    if found is None or found["commit"] is not None:
        return []
    return [{"code": "MARKET_COMMIT_UNRESOLVED",
             "message": f"the line's market commit {record['market_commit']} is in no branch of the active market "
                        f"database {found['database']}, so the line cannot register or replay until that commit is "
                        "back in it",
             "missing": [record["market_commit"]]}]


def research_state(conn: db.LedgerConnection, line_bundle: str | None = None, at: str | None = None, *,
                   history: bool = False, history_before: int | None = None, full: bool = False) -> dict:
    """The research line's whole record (`line`: bundle, start, window, market commit, universe rule,
    note), its execution identity (`execution_identity`, line_identity), the user's targets in force for it (`targets`: the line's own, else the ledger default, else
    null), the open lines (`open_lines`: bundle, start, window and market commit of each), its current judgments with read-time facts, the fixed review cadence (`review_every`),
    the trials of the line's execution identity since the last recommendation (`unreviewed_trials`), the trial count of
    the line (every identity: the search on the same data) and the gates the next registration would meet
    (with RUNTIME_UNSUPPORTED when the line's candidates are on a contract the product no longer runs, and
    MARKET_COMMIT_UNRESOLVED when no branch of the active market database holds the line's market commit). The
    line is `line_bundle`, else the only open line; with no open line `line` is null with the facts and
    `line select` as the next step (gate RESEARCH_LINE_REQUIRED), with several the gate is LINE_AMBIGUOUS
    and the next step names one with --line.

    By default interpretations and search exposures are those after the current recommendation, with the
    count of earlier ones in `earlier`, and `facts` (candidate list, research status) is left out; `full`
    gives every current judgment and the facts."""
    checker = availability.check_identity()
    with db.read_as_of(conn.profile, at) as pinned:
        commit = db.head_commit(pinned)
        records = availability.review_records(pinned)
        opened = [lines.read_line(pinned, bundle, None) for bundle in lines.open_lines(pinned)]
        open_lines = [{key: item[key] for key in ("bundle", "start", "window_start", "window_end", "market_commit")}
                      for item in opened]
        line = line_bundle or (opened[0]["bundle"] if len(opened) == 1 else None)
        if line is None:  # no open line, or several: the facts the user chooses from, and the one next step
            if opened:
                needed = [{"code": "LINE_AMBIGUOUS", "message": "several research lines are open; name one with "
                           "--line", "missing": [item["bundle"] for item in opened]}]
                step = "Name the line to read with `research state --line` (one of open_lines)."
            else:
                needed = [{"code": "RESEARCH_LINE_REQUIRED", "message": "the ledger has no open research line",
                           "missing": ["research-line"]}]
                step = "Select the user's research line with `line select`."
            return {"ledger_commit": commit, "line": None, "execution_identity": None, "targets": line_targets.targets_for(pinned, None),
                    "open_lines": open_lines, **{kind: None for kind in SINGLE_KINDS},
                    "review_every": register.REVIEW_EVERY,
                    "interpretations": [], "search_exposures": [], "unreviewed_trials": [], "trials_on_line": 0,
                    "gates": needed,
                    "judgment_history": {"total": 0, "superseded": 0, "entries": [], "next_before": None},
                    "earlier": None,
                    "facts": {"candidates": report_candidates.candidates(conn.profile, commit)["candidates"],
                              "counts": research_status(conn.profile, commit)},
                    "next_actions": [step]}
        on_line = lines.line_trials(pinned, line)  # LINE_UNKNOWN for a line that does not exist
        record = lines.read_line(pinned, line, None)
        in_force = line_targets.targets_for(pinned, line)
        judged = _judgments(pinned, line)
        original = _judgment_history(pinned, line, history or history_before is not None, history_before)
        recommendation = judged["recommendation"][-1] if judged["recommendation"] else None
        identities = _identities(pinned, _manifests(pinned)[0])
        current = line_identity(pinned, line, identities)
        unreviewed = [trial_id for trial_id in (
            lines.line_trials(pinned, line, since_commit=recommendation["based_on_commit"])["trials"]
            if recommendation else on_line["trials"]) if _same(identities.get(trial_id), current)]
        earlier = None
        if not full and recommendation is not None:
            earlier = {}
            for kind, name in (("interpretation", "interpretations"), ("search_exposure", "search_exposures")):
                kept = [item for item in judged[kind] if item["judgment_id"] > recommendation["judgment_id"]]
                earlier[name], judged[kind] = len(judged[kind]) - len(kept), kept
        for kind in judged:
            for item in judged[kind]:
                item["facts"] = [_subject_facts(pinned, subject, checker, records) for subject in item["subjects"]]
        try:
            register.require_line_records(pinned, line)
            gates: list[dict] = []
        except Refusal as exc:
            gates = [{"code": exc.code, "message": exc.message, "missing": list(exc.missing)}]
        gates += _unsupported_contract(pinned, record, judged)
        gates += _unresolved_market(record)
    return {"ledger_commit": commit, "line": record, "execution_identity": current, "targets": in_force, "open_lines": open_lines,
            **{kind: (judged[kind][-1] if judged[kind] else None) for kind in SINGLE_KINDS},
            "review_every": register.REVIEW_EVERY, "interpretations": judged["interpretation"], "search_exposures": judged["search_exposure"],
            "unreviewed_trials": unreviewed, "trials_on_line": on_line["count"], "gates": gates,
            "judgment_history": original, "earlier": earlier,
            "facts": {"candidates": report_candidates.candidates(conn.profile, commit)["candidates"],
                      "counts": research_status(conn.profile, commit)} if full else None}
