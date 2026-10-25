"""Registration (`registration.plan_schema`, `registration.validate`, `registration.validate_design`,
`registration.register`, `registration.bind`, `registration.require_line_records`).

A registration locks one hypothesis before any replay of it: the body (prediction, changed duties,
parent and control, change, rationale, sources, comparison design (none without a control), grid,
conditions, window), the execution identity the product probed (runtime image, effective configuration, input
identity) and each grid point's source review, as the immutable bundle research-plan.json. A
research replay binds to one grid point in the transaction that writes its trial: the registration
is checked again, and the grid point is consumed once, whatever the replay's outcome.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
import copy
from datetime import date, datetime, time
import hashlib
import json
import math
from pathlib import Path
import re

import jsonschema

from ledger import db, evidence, execution as ledger_execution, lines, strategies
from ledger import reproduction
from ledger.errors import Refusal
from ledger.refusals import refuse
from registration import comparability, duties, inputs as registration_inputs, precheck, seams


PLAN_FILE = "research-plan.json"
PLAN_FORMAT = "research-plan-v2"
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
REQUIRED = ("prediction", "changed_duties", "parent", "control_trial_id", "change", "rationale", "sources",
            "comparison", "grid", "conditions", "window")
OPTIONAL = ("retry_of", "prechecks")
REGISTRATION_NAME = re.compile(r"registration-.+")
OUTCOMES = ("improved", "not_significant", "loss", "zero_activity", "invalid")

_TEXT = {"type": "string", "pattern": r"\S", "maxLength": TEXT_LIMIT}
_PROSE = {"type": "string", "maxLength": TEXT_LIMIT}
_REF = {"type": "string", "pattern": r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}@[1-9][0-9]*$"}
_BUNDLE = {"type": "string", "pattern": r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,159}$"}


def plan_schema() -> dict:
    """The JSON Schema of a registration body; every field carries the description quoted on refusal."""
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "title": "research-plan body",
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
            "changed_duties": {"description": "The duty IDs (A1 to I2) the one change touches: empty for a root, at "
                                              "least one for a derived registration.",
                               "type": "array", "items": {"type": "string"}},
            "parent": {"description": "The research parent strategy_id@revision the change starts from, or null for "
                                      "a root.", "anyOf": [_REF, {"type": "null"}]},
            "control_trial_id": {"description": "The trial_id of the comparison control, a passed, sealed, comparable run "
                                           "with economic evidence; null for a root, or for a derived registration "
                                           "whose parent's research runs are each invalid or without fills and "
                                           "whose rationale.local cites that fault or zero activity.",
                            "anyOf": [{"type": "integer", "minimum": 1}, {"type": "null"}]},
            "change": {"description": "The one rule change, word for word the difference of every grid candidate; "
                                      "null for a root.", "anyOf": [_TEXT, {"type": "null"}]},
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
            "grid": {"description": "One to five grid points {candidate: strategy_id@revision, params: the "
                                    "parameters described}, each a published candidate whose parent and difference "
                                    "equal parent and change.",
                     "type": "array", "minItems": 1, "maxItems": GRID_LIMIT,
                     "items": {"type": "object", "required": ["candidate", "params"], "additionalProperties": False,
                               "properties": {"candidate": _REF, "params": {"type": "object"}}}},
            "conditions": {"description": "Where the conclusion of this trial applies (universe, window, costs).",
                           **_TEXT},
            "window": {"description": "The trading window {trade_start, trade_end}, exactly the research line's "
                                      "development window (ISO dates).",
                       "type": "object", "required": ["trade_start", "trade_end"], "additionalProperties": False,
                       "properties": {"trade_start": {"type": "string"}, "trade_end": {"type": "string"}}},
            "retry_of": {"description": "The earlier registration bundle that actually consumed a grid source being "
                                        "tried again.", **_BUNDLE},
            "prechecks": {"description": "For each grid candidate (strategy_id@revision), the source-review bundle of "
                                         "its native precheck on the registered runtime.",
                          "type": "object", "additionalProperties": _BUNDLE},
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


def _check_duties(body: Mapping) -> None:
    changed, root = body["changed_duties"], body["parent"] is None
    unknown = [duty for duty in changed if duty not in duties.DUTIES]
    if unknown:
        raise refuse("DUTY_UNKNOWN", "changed_duties names unknown duties: " + ", ".join(unknown), missing=tuple(unknown),
                     expected="duty IDs A1 to I2")
    if root and changed:
        raise refuse("DUTY_UNKNOWN", "a root registration changes no duty", missing=("changed_duties",))
    if not root and not changed:
        raise refuse("DUTY_UNKNOWN", "a derived registration names at least one changed duty",
                     missing=("changed_duties",))


def _check_prediction(body: Mapping) -> None:
    catalogue = duties.slice_measures()
    every = frozenset().union(*catalogue.values())
    changed = set(body["changed_duties"])
    allowed = changed if body["parent"] is not None else set(duties.DUTIES)  # a root changes no duty, predicts any
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
    """A run joined with its trial and the execution identity of its start receipt (input identity in
    execution.json, effective configuration in input-coverage.json): the comparability record."""
    row = conn.one(f"SELECT r.trial_id, r.status, t.purpose, t.source_sha256, {db.TRIAL_IMAGE_DIGEST} FROM run r "
                   "JOIN trial t ON t.trial_id = r.trial_id WHERE r.trial_id = %s", (trial_id,))
    if row is None:
        raise refuse("RUN_NOT_PASSED", f"no sealed run {trial_id}", missing=(str(trial_id),))
    capture = ledger_execution.read_capture(conn, row["trial_id"])
    coverage = capture["input_coverage"] if isinstance(capture["input_coverage"], Mapping) else {}
    return {**row, "effective_config": coverage.get("effective_config"),
            "input_identity": capture["start"].get("input_identity")}


def _parent_failed(conn: db.LedgerConnection, source_sha256: str) -> bool:
    """Whether the parent's research runs show its fault or zero activity: it has at least one, and
    each is invalid or its latest sealed result records no fills (real_fills@1 failed)."""
    runs = conn.rows("SELECT r.trial_id, r.status FROM run r JOIN trial t ON t.trial_id = r.trial_id "
                     "WHERE t.source_sha256 = %s AND t.purpose = 'research'", (source_sha256,))
    for trial_id, status in runs:
        if status == "invalid":
            continue
        found = conn.rows("SELECT report FROM run_sealed WHERE trial_id = %s ORDER BY created_at DESC, "
                          "metrics_revision DESC LIMIT 1", (trial_id,))
        report = found[0][0] if found else None
        report = json.loads(report) if isinstance(report, (str, bytes)) else report
        activity = report.get("activity") if isinstance(report, Mapping) else None
        fills = activity.get("real_fills@1") if isinstance(activity, Mapping) else None
        if not isinstance(fills, Mapping) or fills.get("passed") is not False:
            return False
    return bool(runs)


def _check_lineage(conn: db.LedgerConnection, body: Mapping, execution: Mapping, before_replay: bool) -> None:
    parent, control, change = body["parent"], body["control_trial_id"], body["change"]
    if parent is None:
        if control is not None or change is not None:
            raise _invalid("a root registration has no control run and no change", "control_trial_id", "change")
        return
    if change is None:
        raise _invalid("a derived registration states its one change", "change")
    row = _candidate(conn, parent, "parent")
    if control is None:
        # Checked when registering only: a stored registration is not judged again at binding.
        if not before_replay and not _parent_failed(conn, row["source_sha256"]):
            raise _invalid(f"a derived registration without a control run needs the research runs of {parent} to "
                           "show its fault or zero activity (each run invalid or without fills); otherwise name a "
                           "comparable control run, or register a restart (as on a new runtime contract) as a root "
                           "with no parent, control or change", "control_trial_id")
        if not body["rationale"]["local"].strip():
            raise _invalid("without a control run, rationale.local cites the parent run's fault or zero activity",
                           "rationale.local")
        return
    run = control_trial(conn, control)
    comparability.check_comparable(run, execution)
    seams.current.qualification_require(conn, run)


def _check_window(conn: db.LedgerConnection, body: Mapping) -> dict:
    line = lines.current_line(conn)
    if line is None:
        raise refuse("RESEARCH_LINE_REQUIRED", "the ledger has no research line record", missing=("research-line",))
    expected = {"trade_start": line["window_start"], "trade_end": line["window_end"]}
    if body["window"] != expected:
        raise refuse("WINDOW_MISMATCH", f"the registered window {body['window']} is not the line's {expected}",
                     missing=("window",), expected=json.dumps(expected))
    return line


def _check_grid(conn: db.LedgerConnection, body: Mapping, execution: Mapping) -> list[dict]:
    points, seen = [], set()
    for index, point in enumerate(body["grid"]):
        row = _candidate(conn, point["candidate"], f"grid[{index}].candidate")
        if row["source_sha256"] in seen:
            raise _invalid(f"grid[{index}] repeats a source", f"grid[{index}]")
        seen.add(row["source_sha256"])
        parent = (f"{row['parent_strategy_id']}@{row['parent_revision']}" if row["parent_strategy_id"] is not None
                  else None)
        if parent != body["parent"] or row["difference"] != body["change"]:
            raise refuse("LINEAGE_MISMATCH", f"grid candidate {point['candidate']} has parent {parent} and another "
                                             "difference than the registration", missing=(point["candidate"],))
        if row["runtime_contract"] != execution.get("runtime_contract"):
            raise refuse("CONFIG_MISMATCH", f"grid candidate {point['candidate']} needs runtime contract "
                                            f"{row['runtime_contract']}, the execution has "
                                            f"{execution.get('runtime_contract')}", missing=(point["candidate"],))
        points.append({"candidate": point["candidate"], "source_sha256": row["source_sha256"]})
    return points


def _sealing_review_scope(conn: db.LedgerConnection, trial_id: int) -> dict:
    """The source reviews fixed when a run was sealed: the precheck reviews its registration cited, as
    the ledger held them at the commit that ingested the run (a validation run cites none)."""
    ingested = conn.rows("SELECT to_commit FROM dolt_diff_run WHERE to_trial_id = %s AND diff_type = 'added' LIMIT 1",
                         (trial_id,))
    attempt = conn.one("SELECT registration_bundle FROM registration_attempt WHERE trial_id = %s", (trial_id,))
    cited = []
    if attempt is not None:
        cited = sorted(set((load_plan(conn, attempt["registration_bundle"])[0]["body"].get("prechecks") or {}).values()))
    return {"bundles": cited, "recorded_by": ingested[0][0] if ingested else None}


def retryable(conn: db.LedgerConnection, trial_id: int) -> bool:
    """Whether a consumed attempt may be tried again: it was interrupted (no run, and its original
    capture records an interrupted or host-failure outcome), its run is invalid, or qualification
    finds no economic evidence in it by the facts fixed when it was sealed (its sealed facts and the
    precheck review cited at registration as it stood then): a source review recorded after the run
    was ingested does not make a passed attempt retryable."""
    run = conn.one(f"SELECT r.trial_id, r.status, t.source_sha256, {db.TRIAL_IMAGE_DIGEST} FROM run r JOIN trial t "
                   "ON t.trial_id = r.trial_id WHERE r.trial_id = %s", (trial_id,))
    if run is None:
        capture = ledger_execution.read_capture(conn, trial_id)
        outcome = capture.get("outcome")
        outcome = outcome if isinstance(outcome, Mapping) else {}
        return capture["status"] == "captured" and outcome.get("kind") in ("interrupted", "host_failure")
    if run["status"] == "invalid":
        return True
    scope = _sealing_review_scope(conn, trial_id)
    return not seams.current.qualification_assess(conn, run, review_scope=scope)["economic_evidence_available"]


def _retry_chain(conn: db.LedgerConnection, retry_of) -> list[str]:
    """The registrations retry_of reaches, nearest first."""
    chain = []
    while retry_of is not None and retry_of not in chain:
        chain.append(retry_of)
        retry_of = load_plan(conn, retry_of)[0]["body"].get("retry_of")
    return chain


def _runtime_transition(conn: db.LedgerConnection, body: Mapping, execution: Mapping, prior: Mapping) -> bool:
    """An explicitly linked technical rebuild: only the image, precheck reviews and the equivalent
    rebuilt control may differ. All research declarations, grid, configuration and inputs stay fixed.
    This recognizes continuity, not an independent hypothesis or cross-image economic comparison."""
    old, previous = prior["body"], prior["execution"]
    if not execution.get("image_digest") or execution["image_digest"] == previous.get("image_digest"):
        return False
    if (execution.get("runtime_contract") != previous.get("runtime_contract")
            or comparability.config_key(execution.get("effective_config"))
            != comparability.config_key(previous.get("effective_config"))
            or comparability.input_key(execution.get("input_identity"))
            != comparability.input_key(previous.get("input_identity"))):
        return False
    movable = {"retry_of", "prechecks", "control_trial_id"}
    if {k: v for k, v in body.items() if k not in movable} != {k: v for k, v in old.items() if k not in movable}:
        return False
    control, old_control = body["control_trial_id"], old["control_trial_id"]
    if control is None or old_control is None:
        return control is old_control
    # _check_lineage has already required the new control to be comparable and economically available.
    current, earlier = control_trial(conn, control), control_trial(conn, old_control)
    return current["source_sha256"] == earlier["source_sha256"]


def _check_retry(conn: db.LedgerConnection, chain: list[str], points: list[dict], body: Mapping,
                 execution: Mapping) -> list[dict]:
    """Keep failed-attempt retries; additionally admit fixed-question rebuilds on a different image.
    Return only linked transition plans with consumed grid points for technical exposure checks."""
    sources = {point["source_sha256"] for point in points}
    transitions = []
    for bundle in chain:
        plan, _ = load_plan(conn, bundle)
        transition = _runtime_transition(conn, body, execution, plan)
        consumed = False
        for trial_id, source in conn.rows("SELECT trial_id, source_sha256 FROM registration_attempt WHERE "
                                          "registration_bundle = %s ORDER BY trial_id", (bundle,)):
            if source not in sources:
                continue
            consumed = True
            run = conn.one("SELECT status FROM run WHERE trial_id = %s", (trial_id,))
            if not retryable(conn, trial_id) and not (transition and run is not None and run["status"] == "passed"):
                raise refuse("RETRY_NOT_ALLOWED", f"trial {trial_id} of {bundle} was neither interrupted nor invalid "
                                                  "and has economic evidence; rebuilding it on another image "
                                                  "requires the same research declarations, source grid, "
                                                  "configuration and inputs",
                             missing=(bundle, f"trial {trial_id}"))
        if transition and consumed:
            transitions.append({"bundle": bundle, **plan})
    return transitions


def _verified_reproduction(conn: db.LedgerConnection, trial_id: int, bundles: list[str]) -> bool:
    """A complete explore capture of a linked earlier passed run with identical execution identity
    and the exact fingerprint bytes its original image sealed. No cached report directory is needed."""
    if not bundles:
        return False
    anchors = conn.rows("SELECT t.trial_id FROM trial t JOIN run r ON r.trial_id = t.trial_id "
                        "JOIN registration_attempt a ON a.trial_id = t.trial_id WHERE a.registration_bundle IN ("
                        + ",".join(["%s"] * len(bundles)) + ") AND r.status = 'passed' "
                        "AND r.fingerprints IS NOT NULL AND t.trial_id < %s", (*bundles, trial_id))
    return any(reproduction.matches(conn, trial_id, original) for (original,) in anchors)


def _check_exposure(conn: db.LedgerConnection, execution: Mapping, points: list[dict], chain: list[str],
                    exclude: tuple[str, int] | None, transitions: list[dict]) -> None:
    declared_config = comparability.config_key(execution.get("effective_config"))
    declared_inputs = comparability.input_key(execution.get("input_identity"))
    for point in points:
        cited = {}
        for plan in transitions:
            previous = plan["execution"]
            review = (plan["body"].get("prechecks") or {}).get(point["candidate"])
            if review is not None:
                trial_id = precheck.require_precheck(conn, review, point["source_sha256"], previous["image_ref"],
                                                     comparability.input_key(previous["input_identity"]))
                cited[trial_id] = previous
        found = conn.rows("SELECT t.trial_id, a.registration_bundle, t.purpose, t.trade_start, t.trade_end "
                          "FROM trial t LEFT JOIN registration_attempt a "
                          "ON a.trial_id = t.trial_id WHERE t.source_sha256 = %s ORDER BY t.trial_id",
                          (point["source_sha256"],))
        for trial_id, attempted, purpose, trade_start, trade_end in found:
            if exclude is not None and (trial_id == exclude[1] or attempted == exclude[0]):
                continue
            if attempted is not None and attempted in chain:
                continue
            if trial_id == point["precheck_trial"] and precheck.exposure_exempt(
                    conn, trial_id, point["source_sha256"], execution.get("image_ref"), declared_config,
                    declared_inputs):
                continue
            prior = cited.get(trial_id)
            if prior is not None and precheck.exposure_exempt(
                    conn, trial_id, point["source_sha256"], prior["image_ref"],
                    comparability.config_key(prior["effective_config"]),
                    comparability.input_key(prior["input_identity"])):
                continue
            if purpose == "explore":
                # Reading the cited precheck's identical reports adds no new research exposure.
                # Both the anchor and its regenerated execution must verify; ordinary explorations
                # and failed or changed reproductions remain prior exposure.
                anchors = [(point["precheck_trial"], execution), *cited.items()]
                if any(precheck.exposure_exempt(conn, original, point["source_sha256"],
                                               actual.get("image_ref"),
                                               comparability.config_key(actual.get("effective_config")),
                                               comparability.input_key(actual.get("input_identity")))
                       and reproduction.matches(conn, trial_id, original) for original, actual in anchors):
                    continue
            if transitions and purpose == "explore" and _verified_reproduction(
                    conn, trial_id, [plan["bundle"] for plan in transitions]):
                continue
            detail = (f"consumed by {attempted}" if attempted else
                      f"an unregistered {purpose}; no registration consumed it, so retry_of does not apply")
            if purpose == "precheck":
                days = (trade_end - trade_start).total_seconds() / 86_400
                detail += (f"; {days:g} trading days, exemption maximum {precheck.PRECHECK_MAX_DAYS}; "
                           "only the cited precheck with matching execution identity can be exempt")
            raise refuse("SOURCE_ALREADY_EXPOSED", f"grid source of {point['candidate']} already ran in trial "
                                                   f"{trial_id} ({detail})", missing=(point["candidate"],))


def _validate(conn: db.LedgerConnection, body, execution: Mapping, before_replay: bool,
              exclude: tuple[str, int] | None = None) -> dict:
    _check_shape(body)
    if body["control_trial_id"] is not None or body["comparison"] is not None:  # nothing to test without a control
        validate_design(body["comparison"])
    absent = [bundle for bundle in body["sources"] if not _bundle_exists(conn, bundle)]
    if absent:
        raise _invalid("source bundles are not in the ledger: " + ", ".join(absent), *absent)
    chain = _retry_chain(conn, body.get("retry_of"))
    _check_duties(body)
    _check_prediction(body)
    _check_lineage(conn, body, execution, before_replay)
    line = _check_window(conn, body)
    points = _check_grid(conn, body, execution)
    reviews = body.get("prechecks") or {}
    declared_inputs = comparability.input_key(execution.get("input_identity"))
    for point in points:
        review = reviews.get(point["candidate"])
        if review is None:
            raise refuse("SOURCE_PRECHECK_REQUIRED", f"grid candidate {point['candidate']} cites no source review",
                         missing=(f"prechecks.{point['candidate']}",))
        point["review_bundle"] = review
        point["precheck_trial"] = precheck.require_precheck(conn, review, point["source_sha256"],
                                                            execution.get("image_ref"), declared_inputs)
    transitions = _check_retry(conn, chain, points, body, execution)
    _check_exposure(conn, execution, points, chain, exclude, transitions)
    return {"grid": points, "line": line}


def validate(conn: db.LedgerConnection, body, execution: Mapping, before_replay: bool, *,
             exclude: tuple[str, int] | None = None) -> set[str]:
    """Every check of a registration body against its execution identity; the locked grid's source
    hashes. Read only. `exclude` (bundle, trial_id) is the binding being checked: its own trial and
    earlier attempts of the same registration are not exposures of the grid."""
    return {point["source_sha256"] for point in _validate(conn, body, execution, before_replay, exclude)["grid"]}


def _retried(conn: db.LedgerConnection) -> set[str]:
    """The registration bundles a stored registration names in retry_of."""
    named = set()
    for bundle, content, stored in conn.rows(f"SELECT e.bundle, c.content, e.sha256 FROM {evidence.files_from()} "
                                             "WHERE e.bundle LIKE %s AND e.path = %s", ("registration-%", PLAN_FILE)):
        content = bytes(content)
        if hashlib.sha256(content).hexdigest() != stored:
            raise refuse("LEDGER_CORRUPT", f"stored file {bundle}/{PLAN_FILE} differs from its content hash",
                         missing=(f"{bundle}/{PLAN_FILE}",))
        try:
            retry = json.loads(content.decode("utf-8"))["body"].get("retry_of")
        except (UnicodeDecodeError, ValueError, KeyError, TypeError, AttributeError):
            continue
        if isinstance(retry, str):
            named.add(retry)
    return named


def require_line_records(conn: db.LedgerConnection, line_bundle: str, retry_of: str | None = None) -> None:
    """The gates before the next registration: interpretations and a due review.

    Every completed research trial of the line needs an interpretation, except an invalid run whose
    registration a registration names in retry_of (stored, or `retry_of` of the one being written):
    a failure is repaired and retried, not interpreted."""
    trial_ids = lines.line_trials(conn, line_bundle)["trials"]
    uncovered, retried = [], None
    for trial_id in trial_ids:
        run = conn.one("SELECT status FROM run WHERE trial_id = %s", (trial_id,))
        completed = run is not None or conn.rows(
            "SELECT 1 FROM evidence_bundle WHERE bundle = %s OR bundle LIKE %s LIMIT 1",
            (f"trial-{trial_id}-recovery", f"trial-{trial_id}-recovery-%"))
        if not completed:
            continue
        covered = conn.rows(
            "SELECT 1 FROM judgment j JOIN judgment_subject s ON s.judgment_id = j.judgment_id "
            "WHERE j.kind = 'interpretation' AND (s.trial_id = %s OR s.registration_bundle IN "
            "(SELECT registration_bundle FROM registration_attempt WHERE trial_id = %s)) LIMIT 1", (trial_id, trial_id))
        if covered:
            continue
        if run is not None and run["status"] == "invalid":
            if retried is None:
                retried = _retried(conn) | set(_retry_chain(conn, retry_of))
            attempt = conn.one("SELECT registration_bundle FROM registration_attempt WHERE trial_id = %s", (trial_id,))
            if attempt is not None and attempt["registration_bundle"] in retried:
                continue
        uncovered.append(trial_id)
    if uncovered:
        raise refuse("INTERPRETATION_REQUIRED", "completed research trials without an interpretation: "
                     + ", ".join(map(str, uncovered)), missing=tuple(f"trial {item}" for item in uncovered))

    recommendation = conn.one("SELECT based_on_commit FROM judgment j WHERE kind = 'recommendation' AND line_bundle = %s "
                              "AND NOT EXISTS (SELECT 1 FROM judgment n WHERE n.supersedes = j.judgment_id) "
                              "ORDER BY judgment_id DESC LIMIT 1", (line_bundle,))
    if recommendation is not None:
        since = recommendation["based_on_commit"]
    else:
        since = conn.rows("SELECT to_commit FROM dolt_diff_evidence_bundle WHERE to_bundle = %s AND diff_type = 'added' "
                          "LIMIT 1", (line_bundle,))[0][0]
    count = lines.line_trials(conn, line_bundle, since_commit=since)["count"]
    if count >= REVIEW_EVERY:
        raise refuse("REVIEW_DUE", f"{count} research trials since the last recommendation reach the review every "
                                   f"{REVIEW_EVERY}", missing=("recommendation",))


def _encode(record: Mapping) -> bytes:
    return (json.dumps(record, sort_keys=True, indent=2, ensure_ascii=False) + "\n").encode("utf-8")


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


def register(profile: db.LedgerProfile, bundle: str, body, runtime_ref: str | None, market, runner_argv: list[str],
             source_files: list[Path] | None = None) -> dict:
    """Probe the runtime, export the inputs, compose the execution identity and lock the registration
    as research-plan.json in one write; the same content again is an idempotent replay."""
    evidence.check_name(bundle)
    if not REGISTRATION_NAME.fullmatch(bundle):
        raise refuse("REGISTRATION_BUNDLE_NAME", f"{bundle} is not named registration-*", missing=(bundle,))
    _check_shape(body)
    body = copy.deepcopy(dict(body))
    sources = _source_bundles(source_files or [])
    with db.connect(profile, "writer") as conn:
        line = lines.current_line(conn)
        if line is None:
            raise refuse("RESEARCH_LINE_REQUIRED", "the ledger has no research line record", missing=("research-line",))
        identity = seams.current.resolve_runtime(runtime_ref)
        runner = seams.current.runner_inputs(list(runner_argv))
        exported = registration_inputs.market_inputs(market, line["market_commit"], runner["window"],
                                                     runner["selection"], runner.get("lifecycle_bundle"), True, profile)
        try:
            inspection = seams.current.inspect_runtime(identity, list(runner_argv), exported)
        finally:  # the identity is taken; the fresh export and its membership file are not kept
            registration_inputs.cleanup(exported)
        execution = {"image_ref": identity["image_ref"], "image_digest": identity["image_digest"],
                     "runtime_contract": identity["runtime_contract"],
                     "effective_config": comparability.config_key(inspection.get("effective_config")),
                     "input_identity": exported["identity"]}
        body["sources"] = list(dict.fromkeys([*body["sources"], *(name for name, _ in sources)]))
        if body["rationale"]["external"].strip() and not body["sources"]:
            raise refuse("SOURCES_REQUIRED", "rationale.external cites work without a source original",
                         missing=("sources",))

        content = _encode({"format": PLAN_FORMAT, "body": body, "execution": execution, "runtime_ref": runtime_ref})
        sha = hashlib.sha256(content).hexdigest()

        def insert(c, op):
            if _bundle_exists(c, bundle):
                raise refuse("DUPLICATE_BUNDLE", f"{bundle} already exists with another {PLAN_FILE}", missing=(bundle,))
            absent = [name for name in body["sources"] if name not in {item for item, _ in sources}
                      and not _bundle_exists(c, name)]
            if absent:
                raise refuse("SOURCES_REQUIRED", "cited source bundles are not in the ledger: " + ", ".join(absent),
                             missing=tuple(absent))
            for name, files in sources:
                evidence.write_files(c, name, files, f"registration_source:{name}")
            require_line_records(c, line["bundle"], body.get("retry_of"))
            _validate(c, body, execution, before_replay=False)
            evidence.write_files(c, bundle, {PLAN_FILE: content}, op)
            return {"bundle": bundle}

        def replay(c, row):  # the operation ID derives from the bundle name and the plan's hash
            return {"bundle": row["bundle"]}

        written = db.write(conn, "register", {"bundle": bundle, "sha256": sha}, "evidence_bundle", insert, replay,
                           op_id=db.derive_op_id("register", {"bundle": bundle, "sha256": sha}))
    return {"bundle": bundle, "sha256": sha, "execution": execution, "ledger_commit": written["commit"],
            "replayed": written["replayed"]}


def load_plan(conn: db.LedgerConnection, bundle) -> tuple[dict, object]:
    """(research-plan record, bundle created_at) of a registration bundle, its hash rechecked. Only the
    registration-* namespace, which only register writes, holds registrations."""
    if not isinstance(bundle, str) or not REGISTRATION_NAME.fullmatch(bundle):
        raise _invalid(f"{bundle!r} is not a registration-* bundle", str(bundle))
    try:
        loaded = evidence.load_bundle(conn, bundle)
    except Refusal as exc:
        if exc.code in ("UNKNOWN_BUNDLE", "INVALID_BUNDLE_NAME"):
            raise _invalid(f"no registration bundle {bundle!r}", str(bundle)) from exc
        raise
    data = loaded["files"].get(PLAN_FILE)
    try:
        record = json.loads(data.decode("utf-8")) if data is not None else None
    except (UnicodeDecodeError, ValueError):
        record = None
    if (not isinstance(record, dict) or record.get("format") != PLAN_FORMAT or not isinstance(record.get("body"), dict)
            or not isinstance(record.get("execution"), dict)):
        raise refuse("LEDGER_CORRUPT", f"{bundle}/{PLAN_FILE} is missing or unreadable", missing=(f"{bundle}/{PLAN_FILE}",))
    return record, loaded["created_at"]


def _instant(value) -> datetime | None:
    """An ISO-8601 UTC time of the effective configuration as a naive UTC datetime; None if it is not one."""
    try:
        moment = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (AttributeError, TypeError, ValueError):
        return None
    return moment.replace(tzinfo=None) if moment.utcoffset() is not None and not moment.utcoffset() else None


def _midnight(value) -> datetime | None:
    try:
        return datetime.combine(date.fromisoformat(value), time())
    except (TypeError, ValueError):
        return None


def _same_key(key: Callable[[Mapping], dict], registered, recorded) -> bool:
    try:
        return key(registered) == key(recorded)
    except Refusal as exc:
        if exc.code == "IDENTITY_MALFORMED":
            return False
        raise


def bind(conn: db.LedgerConnection, bundle: str, source_sha256: str, trial_id: int) -> None:
    """Inside the trial's write: check the registration again and consume one grid point for the trial.

    What is compared is what the trial records: its row (purpose, windows, instruments, image) and
    its start receipt (runtime identity, input identity, the effective configuration of
    input-coverage.json), both written earlier in this transaction. Writes one registration_attempt
    row; the caller's transaction commits it with the trial and start receipt.
    """
    plan, registered_at = load_plan(conn, bundle)
    body, registered = plan["body"], plan["execution"]
    details = _validate(conn, body, registered, before_replay=True, exclude=(bundle, trial_id))
    grid = {point["source_sha256"]: point for point in details["grid"]}
    trial = conn.one(f"SELECT trial_id, purpose, source_sha256, image_ref, {db.IMAGE_DIGEST}, instruments, input_start, "
                     "trade_start, trade_end, created_at FROM trial WHERE trial_id = %s", (trial_id,))
    if trial is None:
        raise refuse("TRIAL_NOT_FOUND", f"no trial {trial_id} in this transaction", missing=(str(trial_id),))
    if source_sha256 not in grid or trial["source_sha256"] != source_sha256:
        raise refuse("SOURCE_MISMATCH", f"source {source_sha256} is not in the grid of {bundle}",
                     missing=(str(source_sha256),))
    recorded = ledger_execution.read_capture(conn, trial_id)
    started = recorded["start"]
    runtime = started.get("runtime_identity") or {}
    coverage = recorded["input_coverage"] if isinstance(recorded["input_coverage"], Mapping) else {}
    effective = registered.get("effective_config") if isinstance(registered.get("effective_config"), Mapping) else {}
    instruments = json.loads(trial["instruments"]) if isinstance(trial["instruments"], str) else trial["instruments"]
    window = (trial["input_start"], trial["trade_start"], trial["trade_end"])
    conflicts = []
    if trial["purpose"] != "research":
        conflicts.append("purpose")
    if (window != tuple(_instant(effective.get(key)) for key in ("start", "trade_start", "end"))
            or window[1:] != (_midnight(body["window"]["trade_start"]), _midnight(body["window"]["trade_end"]))):
        conflicts.append("window")
    if instruments != (registered.get("input_identity") or {}).get("symbols"):
        conflicts.append("instruments")
    digest = registered.get("image_digest")
    if not digest or trial["image_digest"] != digest or runtime.get("image_digest") != digest:
        conflicts.append("runtime_image")
    if runtime.get("runtime_contract") != registered.get("runtime_contract"):
        conflicts.append("runtime_contract")
    if not _same_key(comparability.config_key, registered.get("effective_config"), coverage.get("effective_config")):
        conflicts.append("effective_configuration")
    if not _same_key(comparability.input_key, registered.get("input_identity"), started.get("input_identity")):
        conflicts.append("input_identity")
    if conflicts:
        raise refuse("EXECUTION_MISMATCH", "the trial's execution differs from the registration in "
                     + ", ".join(conflicts), missing=tuple(conflicts))
    precheck.require_precheck(conn, grid[source_sha256]["review_bundle"], source_sha256, trial["image_ref"],
                              comparability.input_key(started["input_identity"]))
    if not registered_at < trial["created_at"]:
        raise refuse("REGISTRATION_TOO_LATE", f"{bundle} was recorded at {registered_at}, not before trial "
                                              f"{trial_id} at {trial['created_at']}", missing=(bundle,))
    if conn.rows("SELECT 1 FROM registration_attempt WHERE registration_bundle = %s AND source_sha256 = %s",
                 (bundle, source_sha256)):
        raise refuse("GRID_ALREADY_ATTEMPTED", f"the grid point {source_sha256} of {bundle} was already consumed",
                     missing=(f"{bundle}:{source_sha256}",))
    try:
        conn.rows("INSERT INTO registration_attempt (registration_bundle, source_sha256, trial_id) VALUES (%s, %s, %s)",
                  (bundle, source_sha256, trial_id))
    except Refusal as exc:
        if exc.code == "DOLT_SQL_ERROR":
            raise refuse("GRID_ALREADY_ATTEMPTED", f"the grid point {source_sha256} of {bundle} or trial {trial_id} "
                                                   "is already bound", missing=(f"{bundle}:{source_sha256}",)) from exc
        raise


def binder(bundle: str, source_sha256: str) -> Callable[[db.LedgerConnection, int], None]:
    """The binder ledger.open_trial calls for a research replay of one grid point."""
    return lambda conn, trial_id: bind(conn, bundle, source_sha256, trial_id)
