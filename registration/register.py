"""Registration (`registration.plan_schema`, `registration.validate_design`, `registration.register`,
`registration.binder`, `registration.load_registration`, `registration.registrations`,
`registration.require_line_records`, `registration.retryable`, `registration.control_trial`).

A registration locks one hypothesis before any replay of it: the pre-registered text (prediction, changed
duties, rationale, sources, conditions), the control run and comparison design, the registration it retries,
the grid of candidates with the source review of each one's precheck, and the execution identity the product
probed (runtime image, market commit, universe rule, lifecycle bundle, export content, comparable
configuration): one research_registration row on its open line, its grid points and its design. Its parent
and change are its grid candidates' (they share one parent and one published difference); its window is its
line's development window. A research replay binds to one grid point in the transaction that writes its
trial: the registration is checked again, the trial's execution identity must equal it (the trial's foreign
key holds that too), and the grid point is consumed once, whatever the replay's outcome. A closed line binds
no more.
"""

from __future__ import annotations

from collections.abc import Mapping
import copy
import dataclasses
from datetime import date, datetime, time, timedelta
import hashlib
import json
import math
from pathlib import Path

import jsonschema

from ledger import db, evidence, execution as ledger_execution, lines, strategies, trials
from shared.errors import Refusal
from shared.refusals import refuse
from registration import comparability, duties, inputs as registration_inputs, precheck, reproduction, seams


METHOD = "paired-circular-log-mean-v1"
DESIGN_KEYS = ("method", "block_days", "resamples", "inner_resamples", "seed", "alpha", "minimum_effect",
               "design_reason")
DESIGN_MINIMA = {"block_days": 1, "resamples": 999, "inner_resamples": 99, "seed": 0}  # uncalibrated example values
ALPHA_UPPER = 0.5  # uncalibrated example value
TEXT_LIMIT = 8000  # uncalibrated example value
GRID_LIMIT = 5
# Research trials on a line since its last recommendation that stop the next registration until a
# review (a fixed circuit breaker, user decision 2026-10-21; an uncalibrated example value).
REVIEW_EVERY = 5
REQUIRED = ("prediction", "changed_duties", "control_trial_id", "rationale", "sources", "comparison", "grid",
            "prechecks", "conditions")
BODY_KEYS = ("prediction", "conditions", "changed_duties", "rationale", "sources")  # research_registration.body
OUTCOMES = ("improved", "not_significant", "loss", "zero_activity", "invalid")
EPOCH = datetime(1970, 1, 1)

_TEXT = {"type": "string", "pattern": r"\S", "maxLength": TEXT_LIMIT}
_PROSE = {"type": "string", "maxLength": TEXT_LIMIT}
_REF = {"type": "string", "pattern": r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}@[1-9][0-9]*$"}
_BUNDLE = {"type": "string", "pattern": r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,159}$"}
_ID = {"type": "integer", "minimum": 1}


def plan_schema() -> dict:
    """The JSON Schema of a registration body as the caller writes it; every field carries the description
    quoted on refusal. Parent, change and window are not written: the grid candidates and the line give them."""
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "title": "research registration body",
        "type": "object",
        "required": list(REQUIRED),
        "additionalProperties": False,
        "properties": {
            "prediction": {
                "description": "The falsifiable prediction: mechanism lists, for each changed duty, at least one "
                               "{slice, measure, direction (up or down), duty, reason} on the measure catalogue "
                               "(slice null with a reason when no slice measures the duty); outcomes gives one "
                               "next step for each of improved, not_significant, loss, zero_activity and invalid; "
                               "optional interaction {base, a, b} declares a two-by-two of candidate references.",
                "type": "object", "required": ["mechanism", "outcomes"], "additionalProperties": False,
                "properties": {
                    "mechanism": {"type": "array", "items": {
                        "type": "object", "required": ["slice", "measure", "direction", "duty", "reason"],
                        "additionalProperties": False,
                        "properties": {"slice": {"type": ["string", "null"]}, "measure": {"type": ["string", "null"]},
                                       "direction": {"enum": ["up", "down"]}, "duty": {"type": "string"},
                                       "reason": _PROSE}}},
                    "outcomes": {"type": "object", "required": list(OUTCOMES), "additionalProperties": False,
                                 "properties": {name: _TEXT for name in OUTCOMES}},
                    "interaction": {"type": "object", "required": ["base", "a", "b"], "additionalProperties": False,
                                    "properties": {"base": _REF, "a": _REF, "b": _REF}}}},
            "changed_duties": {"description": "The duty IDs (A1 to I2) the one change touches: empty for a root (grid "
                                              "candidates without a parent), at least one for a derived registration.",
                               "type": "array", "items": {"type": "string"}},
            "control_trial_id": {"description": "The trial_id of the comparison control, a passed, sealed, comparable "
                                                "run with economic evidence; null for a root, or for a derived "
                                                "registration whose parent's research runs are each invalid or "
                                                "without fills and whose rationale.local cites that fault or zero "
                                                "activity.",
                                 "anyOf": [_ID, {"type": "null"}]},
            "rationale": {"description": "The economic rationale in three parts: external (others' research, with "
                                         "source bundles), local (facts seen in this line's runs) and conjecture; "
                                         "not all empty.",
                          "type": "object", "required": ["external", "local", "conjecture"],
                          "additionalProperties": False,
                          "properties": {"external": _PROSE, "local": _PROSE, "conjecture": _PROSE},
                          "anyOf": [{"properties": {"external": _TEXT}}, {"properties": {"local": _TEXT}},
                                    {"properties": {"conjecture": _TEXT}}]},
            "sources": {"description": "Names of evidence bundles holding the source originals the rationale "
                                       "cites; each must already be in the ledger.",
                        "type": "array", "items": _BUNDLE},
            "comparison": {"description": "The declared paired test of the annual return against the control: "
                                          "method, block_days, resamples, inner_resamples, seed, alpha, "
                                          "minimum_effect and design_reason (values are uncalibrated examples, "
                                          "locked with the registration); null when control_trial_id is null.",
                           "type": ["object", "null"]},
            "grid": {"description": "One to five published candidates (strategy_id@revision) with one parent and one "
                                    "published difference: the change this registration tests.",
                     "type": "array", "minItems": 1, "maxItems": GRID_LIMIT, "items": _REF},
            "prechecks": {"description": "For each grid candidate (strategy_id@revision), the review_id of the source "
                                         "review of its native precheck on the registered runtime.",
                          "type": "object", "additionalProperties": _ID},
            "conditions": {"description": "Where the conclusion of this trial applies (universe, window, costs).",
                           **_TEXT},
            "retry_of": {"description": "The earlier registration_id that actually consumed a grid source being "
                                        "tried again.", **_ID},
        },
    }


def _invalid(message: str, *missing: str, expected: str | None = None) -> Refusal:
    return refuse("REGISTRATION_INVALID", message, missing=missing, expected=expected)


def _check_shape(body) -> None:
    if not isinstance(body, Mapping):
        raise _invalid("the registration body is not a JSON object", expected="a JSON object")
    try:
        json.dumps(body, allow_nan=False)
    except (TypeError, ValueError) as exc:
        raise _invalid(f"the registration body is not serializable JSON ({type(exc).__name__})") from exc
    schema = plan_schema()
    properties = schema["properties"]
    lacking = [key for key in REQUIRED if key not in body]
    extra = sorted(str(key) for key in body if key not in properties)
    if lacking or extra:
        described = "; ".join(f"{key}: {properties[key]['description']}" for key in lacking)
        raise _invalid("the registration body " + (f"lacks {', '.join(lacking)}" if lacking else "")
                       + (" and " if lacking and extra else "") + (f"has unknown fields {', '.join(extra)}" if extra
                                                                    else "") + (f" ({described})" if described else ""),
                       *lacking, *extra)
    errors = sorted(jsonschema.Draft202012Validator(schema).iter_errors(dict(body)),
                    key=lambda error: [str(part) for part in error.absolute_path])
    if errors:
        error = errors[0]
        field = str(error.absolute_path[0]) if error.absolute_path else ""
        location = "/".join(str(part) for part in error.absolute_path)
        raise _invalid(f"{location or 'body'}: {error.message} ({field}: {properties[field]['description']})"
                       if field in properties else f"{location or 'body'}: {error.message}", field or "body")


def validate_design(value) -> None:
    """Refuse unless the comparison design has exactly its eight fields of the right type and range."""
    def invalid(why: str, field: str):
        return _invalid(f"comparison.{field}: {why}", f"comparison.{field}")
    if not isinstance(value, Mapping):
        raise _invalid("comparison is not an object", "comparison", expected=", ".join(DESIGN_KEYS))
    if set(value) != set(DESIGN_KEYS):
        lacking, extra = sorted(set(DESIGN_KEYS) - set(value)), sorted(map(str, set(value) - set(DESIGN_KEYS)))
        raise _invalid("comparison must hold exactly " + ", ".join(DESIGN_KEYS),
                       *[f"comparison.{key}" for key in lacking + extra])
    if value["method"] != METHOD:
        raise invalid(f"must be {METHOD}", "method")
    for field, minimum in DESIGN_MINIMA.items():
        item = value[field]
        if not isinstance(item, int) or isinstance(item, bool) or item < minimum:
            raise invalid(f"must be an integer >= {minimum}", field)
    alpha = value["alpha"]
    if (not isinstance(alpha, (int, float)) or isinstance(alpha, bool) or not math.isfinite(alpha)
            or not 0 < alpha < ALPHA_UPPER):
        raise invalid(f"must be a finite number in (0, {ALPHA_UPPER})", "alpha")
    effect = value["minimum_effect"]
    if not isinstance(effect, (int, float)) or isinstance(effect, bool) or not math.isfinite(effect) or effect < 0:
        raise invalid("must be a finite number >= 0", "minimum_effect")
    reason = value["design_reason"]
    if not isinstance(reason, str) or not reason.strip() or len(reason) > TEXT_LIMIT:
        raise invalid(f"must be nonempty text of at most {TEXT_LIMIT} characters", "design_reason")


def _bundle_exists(conn: db.LedgerConnection, bundle: str) -> bool:
    return bool(conn.rows("SELECT 1 FROM evidence_bundle WHERE bundle = %s", (bundle,)))


def _candidate(conn: db.LedgerConnection, ref: str, field: str) -> dict:
    try:
        return strategies.read_candidate(conn, ref)
    except Refusal as exc:
        if exc.code in ("UNKNOWN_CANDIDATE", "BAD_REF"):
            raise _invalid(f"{field} {ref!r} is no published candidate", field) from exc
        raise


def _check_duties(body: Mapping, root: bool) -> None:
    changed = body["changed_duties"]
    unknown = [duty for duty in changed if duty not in duties.DUTIES]
    if unknown:
        raise refuse("DUTY_UNKNOWN", "changed_duties names unknown duties: " + ", ".join(unknown), missing=tuple(unknown),
                     expected="duty IDs A1 to I2")
    if root and changed:
        raise refuse("DUTY_UNKNOWN", "a root registration changes no duty", missing=("changed_duties",))
    if not root and not changed:
        raise refuse("DUTY_UNKNOWN", "a derived registration names at least one changed duty",
                     missing=("changed_duties",))


def _check_prediction(body: Mapping, root: bool) -> None:
    catalogue = duties.slice_measures()
    every = frozenset().union(*catalogue.values())
    changed = set(body["changed_duties"])
    allowed = set(duties.DUTIES) if root else changed  # a root changes no duty, predicts any
    predicted = set()
    for index, item in enumerate(body["prediction"]["mechanism"]):
        where = f"prediction.mechanism[{index}]"
        if item["duty"] not in allowed:
            raise refuse("PREDICTION_INVALID", f"{where} predicts duty {item['duty']}, which changed_duties does not "
                                               "name", missing=(where,))
        if item["slice"] is None:
            if not item["reason"].strip():
                raise refuse("PREDICTION_INVALID", f"{where} has no slice and no reason", missing=(where,))
            if item["measure"] is not None and item["measure"] not in every:
                raise refuse("PREDICTION_INVALID", f"{where} names measure {item['measure']} outside the catalogue",
                             missing=(where,))
        elif item["slice"] not in catalogue or item["measure"] not in catalogue[item["slice"]]:
            raise refuse("PREDICTION_INVALID", f"{where} names {item['slice']}/{item['measure']}, which is not in the "
                                               "measure catalogue", missing=(where,))
        predicted.add(item["duty"])
    unpredicted = sorted(changed - predicted)
    if unpredicted:
        raise refuse("PREDICTION_INVALID", "changed duties without a prediction: " + ", ".join(unpredicted),
                     missing=tuple(unpredicted))


def control_trial(conn: db.LedgerConnection, trial_id: int) -> dict:
    """A run joined with its trial's comparable identity and the identities of its reproductions: the
    comparability record."""
    row = conn.one(f"SELECT r.trial_id, r.status, t.*, {db.TRIAL_IMAGE_DIGEST} FROM run r JOIN trial t "
                   "ON t.trial_id = r.trial_id WHERE r.trial_id = %s", (trial_id,))
    if row is None:
        raise refuse("RUN_NOT_PASSED", f"no sealed run {trial_id}", missing=(str(trial_id),))
    return {"trial_id": row["trial_id"], "status": row["status"], "purpose": row["purpose"],
            "source_sha256": row["source_sha256"], "image_digest": row["image_digest"],
            **comparability.comparable_identity(row), "reproductions": reproduction.reproductions(conn, trial_id)}


def _parent_failed(conn: db.LedgerConnection, source_sha256: str) -> bool:
    """Whether the parent's research runs show its fault or zero activity: it has at least one, and
    each is invalid or its reading records no fills (real_fills failed)."""
    runs = conn.rows("SELECT r.trial_id, r.status, g.report FROM run r JOIN trial t ON t.trial_id = r.trial_id "
                     "LEFT JOIN run_reading g ON g.trial_id = r.trial_id "
                     "WHERE t.source_sha256 = %s AND t.purpose = 'research'", (source_sha256,))
    for _, status, report in runs:
        if status == "invalid":
            continue
        report = json.loads(report) if isinstance(report, (str, bytes)) else report
        activity = report.get("activity") if isinstance(report, Mapping) else None
        fills = activity.get("real_fills") if isinstance(activity, Mapping) else None
        if not isinstance(fills, Mapping) or fills.get("passed") is not False:
            return False
    return bool(runs)


def _check_lineage(conn: db.LedgerConnection, plan: Mapping, parent: dict | None, execution: Mapping,
                   before_replay: bool) -> None:
    control = plan["control_trial_id"]
    if parent is None:
        if control is not None:
            raise _invalid("a root registration has no control run", "control_trial_id")
        return
    if control is None:
        # Checked when registering only: a stored registration is not judged again at binding.
        if not before_replay and not _parent_failed(conn, parent["source_sha256"]):
            raise _invalid(f"a derived registration without a control run needs the research runs of "
                           f"{strategies.name(parent)} to show its fault or zero activity (each run invalid or without "
                           "fills); otherwise name a comparable control run, or register a restart (as on a new "
                           "runtime contract) as a root with no parent, control or change", "control_trial_id")
        if not plan["body"]["rationale"]["local"].strip():
            raise _invalid("without a control run, rationale.local cites the parent run's fault or zero activity",
                           "rationale.local")
        return
    run = control_trial(conn, control)
    comparability.check_comparable(run, execution)
    seams.current.qualification_require(conn, run)


def _midnight(value: str) -> datetime:
    return datetime.combine(date.fromisoformat(value), time())


def _check_window(execution: Mapping, line: Mapping) -> None:
    expected = (_midnight(line["dev_start"]), _midnight(line["dev_end"]))
    if (execution["trade_start"], execution["trade_end"]) != expected:
        raise refuse("WINDOW_MISMATCH", f"the trading window {execution['trade_start']} to {execution['trade_end']} is "
                                        f"not the line's development window {line['dev_start']} to {line['dev_end']}",
                     missing=("window",), expected=f"{line['dev_start']} to {line['dev_end']}")


def _check_grid(conn: db.LedgerConnection, grid: list[str], execution: Mapping) -> tuple[list[dict], dict | None]:
    """The grid points {candidate, source_sha256} and their shared parent (None for a root): every grid candidate
    has the first one's parent and published difference, a distinct source and the execution's runtime contract."""
    points, seen, first = [], set(), None
    for index, ref in enumerate(grid):
        row = _candidate(conn, ref, f"grid[{index}]")
        if row["source_sha256"] in seen:
            raise _invalid(f"grid[{index}] repeats a source", f"grid[{index}]")
        seen.add(row["source_sha256"])
        first = first or row
        if row["parent_source_sha256"] != first["parent_source_sha256"]:
            raise refuse("LINEAGE_MISMATCH", f"grid candidate {ref} has another parent than {grid[0]}; a registration "
                                             "has one parent", missing=(ref,))
        if row["difference"] != first["difference"]:
            raise refuse("LINEAGE_MISMATCH", f"grid candidate {ref} was published with another difference than "
                                             f"{grid[0]}; a registration tests one change", missing=(ref,))
        if row["runtime_contract"] != execution.get("runtime_contract"):
            raise refuse("CONFIG_MISMATCH", f"grid candidate {ref} needs runtime contract {row['runtime_contract']}, "
                                            f"the execution has {execution.get('runtime_contract')}", missing=(ref,))
        points.append({"candidate": ref, "source_sha256": row["source_sha256"]})
    assert first is not None  # the schema requires one grid point
    parent = strategies.candidate_by_sha(conn, first["parent_source_sha256"]) if first["parent_source_sha256"] else None
    return points, parent


def _sealing_review_scope(conn: db.LedgerConnection, trial_id: int) -> dict:
    """The source reviews fixed when a run was sealed: the precheck review its registration cited for its source
    (a validation run cites none)."""
    return {"review_ids": [review for (review,) in conn.rows(
        "SELECT g.source_review_id FROM trial t JOIN registration_grid_point g ON g.registration_id = "
        "t.research_registration_id AND g.source_sha256 = t.source_sha256 WHERE t.trial_id = %s", (trial_id,))]}


def retryable(conn: db.LedgerConnection, trial_id: int) -> bool:
    """Whether a consumed attempt may be tried again: it was interrupted (no run, and its original
    capture records an interrupted or host-failure outcome), its run is invalid, or qualification
    finds no economic evidence in it by the facts fixed when it was sealed (its reading and the
    precheck review its registration cited): a later source review does not make a passed attempt retryable."""
    run = conn.one("SELECT trial_id, status FROM run WHERE trial_id = %s", (trial_id,))
    if run is None:
        capture = ledger_execution.read_capture(conn, trial_id)
        outcome = capture.get("outcome")
        outcome = outcome if isinstance(outcome, Mapping) else {}
        return capture["status"] == "captured" and outcome.get("kind") in ("interrupted", "host_failure")
    if run["status"] == "invalid":
        return True
    scope = _sealing_review_scope(conn, trial_id)
    return not seams.current.qualification_assess(conn, run, review_scope=scope)["economic_evidence_available"]


def _retry_chain(conn: db.LedgerConnection, retry_of: int | None) -> list[dict]:
    """The registrations retry_of reaches, nearest first."""
    chain: list[dict] = []
    while retry_of is not None and retry_of not in {item["registration_id"] for item in chain}:
        chain.append(load_registration(conn, retry_of))
        retry_of = chain[-1]["retry_of"]
    return chain


def _runtime_transition(conn: db.LedgerConnection, plan: Mapping, execution: Mapping, prior: Mapping) -> bool:
    """An explicitly linked technical rebuild: only the image, precheck reviews and the equivalent rebuilt
    control may differ. All research declarations, grid, configuration and inputs stay fixed. This recognizes
    continuity, not an independent hypothesis or cross-image economic comparison."""
    previous = prior["execution"]
    if not execution.get("image_digest") or execution["image_digest"] == previous["image_digest"]:
        return False
    if any(execution.get(key) != previous[key] for key in ("comparable_config_sha256", "export_sha256",
                                                           "market_commit", "universe_rule", "lifecycle_bundle")):
        return False
    if (plan["body"] != prior["body"] or plan["comparison"] != prior["comparison"]
            or [point["candidate"] for point in plan["points"]] != [point["candidate"] for point in prior["grid"]]):
        return False
    control, old_control = plan["control_trial_id"], prior["control_trial_id"]
    if control is None or old_control is None:
        return control is old_control
    # _check_lineage has already required the new control to be comparable and economically available.
    current, earlier = control_trial(conn, control), control_trial(conn, old_control)
    return current["source_sha256"] == earlier["source_sha256"]


def _check_retry(conn: db.LedgerConnection, chain: list[dict], plan: Mapping, execution: Mapping) -> list[dict]:
    """Keep failed-attempt retries; additionally admit fixed-question rebuilds on a different image.
    Return only linked transition registrations with consumed grid points for technical exposure checks."""
    sources = {point["source_sha256"] for point in plan["points"]}
    transitions = []
    for prior in chain:
        transition = _runtime_transition(conn, plan, execution, prior)
        consumed = False
        for trial_id, source in conn.rows("SELECT trial_id, source_sha256 FROM trial WHERE research_registration_id = %s "
                                          "ORDER BY trial_id", (prior["registration_id"],)):
            if source not in sources:
                continue
            consumed = True
            run = conn.one("SELECT status FROM run WHERE trial_id = %s", (trial_id,))
            if not retryable(conn, trial_id) and not (transition and run is not None and run["status"] == "passed"):
                raise refuse("RETRY_NOT_ALLOWED", f"trial {trial_id} of registration {prior['registration_id']} was "
                                                  "neither interrupted nor invalid and has economic evidence; "
                                                  "rebuilding it on another image requires the same research "
                                                  "declarations, source grid, configuration and inputs",
                             missing=(str(prior["registration_id"]), f"trial {trial_id}"))
        if transition and consumed:
            transitions.append(prior)
    return transitions


def _check_exposure(conn: db.LedgerConnection, execution: Mapping, points: list[dict], chain: list[dict],
                    exclude: int | None, transitions: list[dict]) -> None:
    """A grid source has already run, and cannot be registered as new, when a trial sealed an economic
    result of it the researcher could read. Not counted: (1) the earlier trials of the registration being
    bound and of its retry chain; (2) a precheck that sealed no result (precheck.sealed_no_result); (3) the
    cited short precheck matching the registration's identity, and the one a linked runtime rebuild cited,
    matched against that rebuild's identity; (4) a verified reproduction (reproduction.matches) of a trial not
    counted by (1) to (3), on any image: it rereads bytes already accounted for."""
    retried = {item["registration_id"] for item in chain} | ({exclude} if exclude is not None else set())
    for point in points:
        source = point["source_sha256"]
        cited: dict[int, list[Mapping]] = {point["precheck_trial"]: [execution]}
        for prior in transitions:
            review = {item["source_sha256"]: item["source_review_id"] for item in prior["grid"]}.get(source)
            if review is not None:
                previous = {**prior["execution"], "symbols": execution["symbols"]}  # the same export content
                cited.setdefault(precheck.require_precheck(conn, review, source, previous), []).append(previous)
        uncounted, counted = [], []
        for trial_id, registration, purpose, trade_start, trade_end in conn.rows(
                "SELECT trial_id, research_registration_id, purpose, trade_start, trade_end FROM trial "
                "WHERE source_sha256 = %s ORDER BY trial_id", (source,)):
            if (registration in retried
                    or (purpose == "precheck" and precheck.sealed_no_result(conn, trial_id, source))
                    or any(precheck.exposure_exempt(conn, trial_id, source, identity)
                           for identity in cited.get(trial_id, ()))):
                uncounted.append(trial_id)
            else:
                counted.append((trial_id, registration, purpose, trade_start, trade_end))
        for trial_id, registration, purpose, trade_start, trade_end in counted:
            if purpose == "explore" and any(reproduction.matches(conn, trial_id, original) for original in uncounted):
                continue
            detail = (f"consumed by registration {registration}" if registration is not None else
                      f"an unregistered {purpose}; no registration consumed it, so retry_of does not apply")
            if purpose == "precheck":
                days = (trade_end - trade_start).total_seconds() / 86_400
                detail += (f"; {days:g} trading days and a sealed result; only the cited precheck of at most "
                           f"{precheck.PRECHECK_MAX_DAYS} days with matching execution identity is not counted")
            raise refuse("SOURCE_ALREADY_EXPOSED", f"grid source of {point['candidate']} already ran in trial "
                                                   f"{trial_id} ({detail})", missing=(point["candidate"],))


def validate(conn: db.LedgerConnection, plan: Mapping, execution: Mapping, before_replay: bool, line: Mapping,
             exclude: int | None = None) -> list[dict]:
    """Every check of a registration `plan` {body, control_trial_id, comparison, retry_of, grid (references),
    prechecks (review_id by reference)} against its execution identity and its line's record; the grid points
    {candidate, source_sha256, review_id, precheck_trial}. Read only. `exclude` is the registration being bound:
    its earlier attempts are not exposures of the grid."""
    body = plan["body"]
    if plan["control_trial_id"] is not None or plan["comparison"] is not None:  # nothing to test without a control
        validate_design(plan["comparison"])
    absent = [bundle for bundle in body["sources"] if not _bundle_exists(conn, bundle)]
    if absent:
        raise _invalid("source bundles are not in the ledger: " + ", ".join(absent), *absent)
    chain = _retry_chain(conn, plan.get("retry_of"))
    points, parent = _check_grid(conn, plan["grid"], execution)
    _check_duties(body, parent is None)
    _check_prediction(body, parent is None)
    _check_lineage(conn, plan, parent, execution, before_replay)
    _check_window(execution, line)
    for point in points:
        review = plan["prechecks"].get(point["candidate"])
        if review is None:
            raise refuse("SOURCE_PRECHECK_REQUIRED", f"grid candidate {point['candidate']} cites no source review",
                         missing=(f"prechecks.{point['candidate']}",))
        point["review_id"] = review
        point["precheck_trial"] = precheck.require_precheck(conn, review, point["source_sha256"], execution)
    transitions = _check_retry(conn, chain, {**plan, "points": points}, execution)
    _check_exposure(conn, execution, points, chain, exclude, transitions)
    return points


def _retried(conn: db.LedgerConnection, line_id: int) -> set[int]:
    """The registrations a stored registration of the line names in retry_of."""
    return {retry for (retry,) in conn.rows("SELECT retry_of FROM research_registration WHERE line_id = %s AND "
                                            "retry_of IS NOT NULL", (line_id,))}


def _line_trial_records(conn: db.LedgerConnection, trial_ids: list[int]
                        ) -> tuple[dict[int, str], dict[int, int], set[int], set[int]]:
    """Of the trials, in one read of each table per execution.BATCH trials: run status and registration by
    trial, the trials an interpretation names (directly or through their registration) and the trials holding
    a recovery bundle."""
    status: dict[int, str] = {}
    registered: dict[int, int] = {}
    covered: set[int] = set()
    recovered: set[int] = set()
    for at in range(0, len(trial_ids), ledger_execution.BATCH):
        chunk = tuple(trial_ids[at:at + ledger_execution.BATCH])
        marks = ", ".join(["%s"] * len(chunk))
        status.update(conn.rows(f"SELECT trial_id, status FROM run WHERE trial_id IN ({marks})", chunk))
        registered.update(conn.rows(f"SELECT trial_id, research_registration_id FROM trial WHERE trial_id IN ({marks})",
                                    chunk))
        covered.update(trial_id for trial_id, in conn.rows(
            "SELECT s.trial_id FROM judgment j JOIN judgment_subject s ON s.judgment_id = j.judgment_id "
            f"WHERE j.kind = 'interpretation' AND s.trial_id IN ({marks}) UNION "
            "SELECT t.trial_id FROM judgment j JOIN judgment_subject s ON s.judgment_id = j.judgment_id "
            "JOIN trial t ON t.research_registration_id = s.research_registration_id "
            f"WHERE j.kind = 'interpretation' AND t.trial_id IN ({marks})", chunk + chunk))
        recovered.update(trial_id for trial_id, in conn.rows(
            f"SELECT DISTINCT trial_id FROM evidence_bundle WHERE kind = 'recovery' AND trial_id IN ({marks})", chunk))
    return status, registered, covered, recovered


def require_line_records(conn: db.LedgerConnection, line_id: int, retry_of: int | None = None) -> None:
    """The gates before the next registration: interpretations and a due review.

    Every completed research trial of the line needs an interpretation, except an invalid run whose
    registration a registration of the line names in retry_of (stored, or `retry_of` of the one being
    written): a failure is repaired and retried, not interpreted."""
    trial_ids = lines.line_trials(conn, line_id)["trials"]
    status, registered, covered, recovered = _line_trial_records(conn, trial_ids)
    uncovered: list[int] = []
    retried: set[int] | None = None
    for trial_id in trial_ids:
        if trial_id not in status and trial_id not in recovered or trial_id in covered:
            continue
        if status.get(trial_id) == "invalid":
            if retried is None:
                retried = _retried(conn, line_id) | {item["registration_id"] for item in _retry_chain(conn, retry_of)}
                if retry_of is not None:
                    retried.add(retry_of)
            if registered.get(trial_id) in retried:
                continue
        uncovered.append(trial_id)
    if uncovered:
        raise refuse("INTERPRETATION_REQUIRED", "completed research trials without an interpretation: "
                     + ", ".join(map(str, uncovered)), missing=tuple(f"trial {item}" for item in uncovered))

    recommendation = conn.one("SELECT based_on_commit FROM judgment j WHERE kind = 'recommendation' AND line_id = %s "
                              "AND NOT EXISTS (SELECT 1 FROM judgment n WHERE n.supersedes = j.judgment_id) "
                              "ORDER BY judgment_id DESC LIMIT 1", (line_id,))
    if recommendation is not None:
        since = recommendation["based_on_commit"]
    else:
        since = conn.rows("SELECT to_commit FROM dolt_diff_research_line WHERE to_line_id = %s AND diff_type = 'added' "
                          "LIMIT 1", (line_id,))[0][0]
    count = lines.line_trials(conn, line_id, since_commit=since)["count"]
    if count >= REVIEW_EVERY:
        raise refuse("REVIEW_DUE", f"{count} research trials since the last recommendation reach the review every "
                                   f"{REVIEW_EVERY}", missing=("recommendation",))


def _source_bundles(source_files: list[Path]) -> list[tuple[str, dict[str, bytes]]]:
    bundles = []
    for path in source_files or ():
        path = Path(path)
        if path.is_symlink() or not path.is_file():
            raise refuse("SOURCES_REQUIRED", f"source original {path} is missing or a link", missing=(str(path),))
        files = {path.name: path.read_bytes()}
        name = "source-" + hashlib.sha256(db.canonical_json(evidence.digests(files)).encode()).hexdigest()
        bundles.append((name, files))
    return bundles


def _utc(ns: int) -> datetime:
    return EPOCH + timedelta(microseconds=ns // 1000)


def write_design(conn: db.LedgerConnection, design: Mapping | None) -> int | None:
    """Inside a write: the design_id of a new comparison_design row holding `design` (validate_design's)."""
    if design is None:
        return None
    conn.rows(f"INSERT INTO comparison_design ({', '.join(DESIGN_KEYS)}) VALUES ({', '.join(['%s'] * len(DESIGN_KEYS))})",
              tuple(design[key] for key in DESIGN_KEYS))
    (design_id,), = conn.rows("SELECT LAST_INSERT_ID()")
    return design_id


def register(profile: db.LedgerProfile, body, runtime_ref: str | None, market, runner_argv: list[str],
             source_files: list[Path] | None = None, line: str | None = None) -> dict:
    """Probe the runtime, export the inputs, compose the execution identity and lock the registration on the
    open line `line` (default: the only open line, ledger.open_line) in one write, which checks again that the
    line is open; the same body and execution identity again is an idempotent replay."""
    _check_shape(body)
    body = copy.deepcopy(dict(body))
    sources = _source_bundles(source_files or [])
    with db.connect(profile, "writer") as conn:
        held = lines.open_line(conn, line)
        identity = seams.current.resolve_runtime(runtime_ref)
        runner = seams.runner_inputs(list(runner_argv))
        exported = registration_inputs.market_inputs(market, held["market_commit"], runner["window"],
                                                     runner["selection"], runner.get("lifecycle_bundle"), True, profile,
                                                     include_quotes=runner["execution"] == "quotes",
                                                     include_trades=runner.get("trade_ticks", False),
                                                     include_metrics=runner.get("metrics", False))
        try:
            inspection = seams.current.inspect_runtime(identity, list(runner_argv), exported)
        finally:  # the identity is taken; the fresh export and its membership file are not kept
            registration_inputs.cleanup(exported)
        inputs = exported["identity"]
        execution = {"image_ref": identity["image_ref"], "image_digest": identity["image_digest"],
                     "runtime_contract": identity["runtime_contract"], "market_commit": inputs["market_commit"],
                     "universe_rule": inputs["universe_rule"], "lifecycle_bundle": inputs.get("lifecycle_bundle"),
                     "export_sha256": inputs["export_content_sha256"],
                     "comparable_config_sha256": trials.comparable_config_sha256(inspection.get("effective_config")),
                     "input_start": _utc(runner["window"]["start"]),
                     "trade_start": _utc(runner["window"]["trade_start"]), "trade_end": _utc(runner["window"]["end"]),
                     "symbols": sorted(set(inputs.get("symbols") or ()))}
        body["sources"] = list(dict.fromkeys([*body["sources"], *(name for name, _ in sources)]))
        if body["rationale"]["external"].strip() and not body["sources"]:
            raise refuse("SOURCES_REQUIRED", "rationale.external cites work without a source original",
                         missing=("sources",))
        plan = {"body": {key: body[key] for key in BODY_KEYS}, "control_trial_id": body["control_trial_id"],
                "comparison": body["comparison"], "retry_of": body.get("retry_of"), "grid": body["grid"],
                "prechecks": body["prechecks"]}
        stored = {key: execution[key] for key in ("image_ref", "market_commit", "universe_rule", "lifecycle_bundle",
                                                   "export_sha256", "comparable_config_sha256")}
        payload = {"line_id": held["line_id"], "plan": plan, "execution": stored}

        def insert(c, op):
            absent = [name for name in body["sources"] if name not in {item for item, _ in sources}
                      and not _bundle_exists(c, name)]
            if absent:
                raise refuse("SOURCES_REQUIRED", "cited source bundles are not in the ledger: " + ", ".join(absent),
                             missing=tuple(absent))
            for name, files in sources:
                if not _bundle_exists(c, name):  # named by its content: an existing one is this one
                    evidence.write_files(c, name, files, kind="source")
            lines.open_line(c, held["line_id"])
            require_line_records(c, held["line_id"], plan["retry_of"])
            points = validate(c, plan, execution, before_replay=False, line=held)
            design_id = write_design(c, plan["comparison"])
            c.rows("INSERT INTO research_registration (line_id, retry_of, control_trial_id, comparison_design_id, "
                   "image_ref, market_commit, universe_rule, lifecycle_bundle, export_sha256, comparable_config_sha256, "
                   "body, op_id) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
                   (held["line_id"], plan["retry_of"], plan["control_trial_id"], design_id, *stored.values(),
                    db.canonical_json(plan["body"]), op))
            (registration_id,), = c.rows("SELECT LAST_INSERT_ID()")
            c.many("INSERT INTO registration_grid_point (registration_id, source_sha256, source_review_id) "
                   "VALUES (%s, %s, %s)", [(registration_id, point["source_sha256"], point["review_id"])
                                           for point in points])
            return {"registration_id": registration_id}

        def replay(c, row):
            return {"registration_id": row["registration_id"]}

        written = db.write(conn, "register", payload, "research_registration", insert, replay,
                           attempts=db.WRITE_ATTEMPTS)
    return {"registration_id": written["record"]["registration_id"], "line": held["name"],
            "execution": {**stored, "image_digest": execution["image_digest"]}, "ledger_commit": written["commit"],
            "replayed": written["replayed"]}


REGISTRATION_COLUMNS = ("registration_id", "line_id", "retry_of", "control_trial_id", "comparison_design_id",
                        "image_ref", "market_commit", "universe_rule", "lifecycle_bundle", "export_sha256",
                        "comparable_config_sha256", "body", "created_at")


def read_design(conn: db.LedgerConnection, design_id: int) -> dict:
    """The DESIGN_KEYS of one comparison_design row."""
    row = conn.one(f"SELECT {', '.join(DESIGN_KEYS)} FROM comparison_design WHERE design_id = %s", (design_id,))
    assert row is not None  # every design_id is a foreign key's
    return row


def registrations(conn: db.LedgerConnection, line_id: int | None = None) -> list[dict]:
    """Every research registration (or those of one line), oldest first: {registration_id, line_id, retry_of,
    control_trial_id, comparison (the design's DESIGN_KEYS, or None), execution {image_ref, image_digest,
    market_commit, universe_rule, lifecycle_bundle, export_sha256, comparable_config_sha256}, body, grid
    [{candidate, source_sha256, source_review_id}], parent (strategy_id@revision or None), change, created_at}."""
    where, args = (" WHERE line_id = %s", (line_id,)) if line_id is not None else ("", ())
    rows = conn.dicts(f"SELECT {', '.join(REGISTRATION_COLUMNS)} FROM research_registration{where} "
                      "ORDER BY registration_id", args)
    if not rows:
        return []
    designs = {row["design_id"]: {key: row[key] for key in DESIGN_KEYS}
               for row in conn.dicts("SELECT * FROM comparison_design WHERE design_id IN (SELECT comparison_design_id "
                                     f"FROM research_registration{where})", args)}
    grid: dict[int, list[dict]] = {}
    for row in conn.dicts("SELECT g.registration_id, g.source_sha256, g.source_review_id, c.strategy_id, c.revision, "
                          "c.parent_source_sha256, c.difference FROM registration_grid_point g JOIN candidate c ON "
                          "c.source_sha256 = g.source_sha256 WHERE g.registration_id IN (SELECT registration_id FROM "
                          f"research_registration{where}) ORDER BY g.registration_id, c.strategy_id, c.revision", args):
        grid.setdefault(row["registration_id"], []).append(row)
    found = []
    for row in rows:
        points = grid.get(row["registration_id"], [])
        first = points[0] if points else {}
        parent = strategies.candidate_by_sha(conn, first["parent_source_sha256"]) \
            if first.get("parent_source_sha256") else None
        body = json.loads(row["body"]) if isinstance(row["body"], (str, bytes)) else row["body"]
        found.append({"registration_id": row["registration_id"], "line_id": row["line_id"], "retry_of": row["retry_of"],
                      "control_trial_id": row["control_trial_id"],
                      "comparison": designs.get(row["comparison_design_id"]),
                      "execution": {**{key: row[key] for key in ("image_ref", "market_commit", "universe_rule",
                                                                 "lifecycle_bundle", "export_sha256",
                                                                 "comparable_config_sha256")},
                                    "image_digest": precheck.digest_of(row["image_ref"])},
                      "body": body,
                      "grid": [{"candidate": f"{point['strategy_id']}@{point['revision']}",
                                "source_sha256": point["source_sha256"], "source_review_id": point["source_review_id"]}
                               for point in points],
                      "parent": strategies.name(parent) if parent is not None else None,
                      "change": first.get("difference"), "created_at": row["created_at"]})
    return found


def load_registration(conn: db.LedgerConnection, registration_id) -> dict:
    """One research registration as `registrations` gives it; REGISTRATION_INVALID when there is none."""
    if not isinstance(registration_id, int) or isinstance(registration_id, bool):
        raise _invalid(f"{registration_id!r} is no registration_id", str(registration_id))
    found = [item for item in registrations(conn) if item["registration_id"] == registration_id] \
        if conn.rows("SELECT 1 FROM research_registration WHERE registration_id = %s", (registration_id,)) else []
    if not found:
        raise _invalid(f"no research registration {registration_id}", str(registration_id))
    return found[0]


def bind(conn: db.LedgerConnection, registration_id: int, source_sha256: str, row: Mapping) -> dict:
    """Inside the trial's write, before its row: check the registration again and consume one grid point.

    `row` is the trial row about to be written (open_trial's binder argument). Its execution identity must
    equal the registration's, its window the line's development window; the grid point must be unconsumed.
    Returns the trial's line and registration columns."""
    registration = load_registration(conn, registration_id)
    line = lines.open_line(conn, registration["line_id"])
    grid = {point["source_sha256"]: point for point in registration["grid"]}
    if row["purpose"] != "research" or source_sha256 not in grid or row["source_sha256"] != source_sha256:
        raise refuse("SOURCE_MISMATCH", f"source {source_sha256} is not in the grid of registration {registration_id}",
                     missing=(str(source_sha256),))
    registered = registration["execution"]
    names = {"image_ref": "runtime_image", "market_commit": "market_commit", "universe_rule": "universe_rule",
             "lifecycle_bundle": "lifecycle_bundle", "export_sha256": "input_identity",
             "comparable_config_sha256": "effective_configuration"}
    conflicts = [name for key, name in names.items() if row[key] != registered[key]]
    if conflicts:
        raise refuse("EXECUTION_MISMATCH", "the trial's execution differs from the registration in "
                     + ", ".join(conflicts), missing=tuple(conflicts))
    if conn.rows("SELECT 1 FROM trial WHERE research_registration_id = %s AND source_sha256 = %s",
                 (registration_id, source_sha256)):
        raise refuse("GRID_ALREADY_ATTEMPTED", f"the grid point {source_sha256} of registration {registration_id} was "
                                               "already consumed", missing=(f"{registration_id}:{source_sha256}",))
    plan = {"body": registration["body"], "control_trial_id": registration["control_trial_id"],
            "comparison": registration["comparison"], "retry_of": registration["retry_of"],
            "grid": [point["candidate"] for point in registration["grid"]],
            "prechecks": {point["candidate"]: point["source_review_id"] for point in registration["grid"]}}
    validate(conn, plan, {**row, "symbols": list(row["instruments"])}, before_replay=True, line=line,
             exclude=registration_id)
    return {"line_id": registration["line_id"], "research_registration_id": registration_id}


@dataclasses.dataclass(frozen=True)
class Binder:
    """The binder ledger.open_trial calls for a research replay of one grid point."""
    registration_id: int
    source_sha256: str

    @property
    def registration(self) -> dict:
        return {"research_registration_id": self.registration_id}

    def __call__(self, conn: db.LedgerConnection, row: Mapping) -> dict:
        return bind(conn, self.registration_id, self.source_sha256, row)


def binder(registration_id: int, source_sha256: str) -> Binder:
    return Binder(registration_id, source_sha256)
