"""Native prechecks and independent source reviews (`registration.exposure_exempt`,
`registration.sealed_no_result`, `registration.require_precheck`, `registration.record_review`,
`registration.review_records`).

A precheck is a replay declared as such before it starts (trial purpose precheck), on the runtime
image and inputs the registration will use; it never consumes a grid point. It exposes its source
only when it sealed an economic result the researcher could read: the one precheck a registration
cites does not when its trading window is short, nor does a precheck that sealed no result at all
(it stopped before market data reached the strategy, or a short one sealed no fill and no position).
An Agent that did not write the source reviews the sealed precheck capture under four items; the
review is one source_review row of that precheck trial and its source. Passing says the source runs,
not that it is economic evidence; any failed review of the precheck fails it.

What a precheck is compared with is an execution identity: {image_ref, market_day, universe_rule,
lifecycle_bundle, comparable_config_sha256, symbols}, the trial columns a registration fixes (its
window, export content and instruments set aside, since a precheck replays a shorter window).
"""

from __future__ import annotations

from collections.abc import Mapping
from datetime import timedelta

from ledger import db, execution, problems
from shared.errors import Refusal
from shared.refusals import refuse
from registration import reproduction


ITEMS = ("api", "causal", "activity", "readiness")
ITEM_STATUSES = ("passed", "failed", "unresolved", "no_opportunity")
VERDICTS = ("passed", "failed")
PASSING = ("passed", "no_opportunity")
NOTE_LIMIT = 8000  # uncalibrated example value
# Trial columns a precheck shares with the identity it is exempted against, and those it must share to be cited.
EXEMPT_COLUMNS = ("market_day", "universe_rule", "lifecycle_bundle", "comparable_config_sha256")
PRECHECK_COLUMNS = ("market_day", "lifecycle_bundle", "comparable_config_sha256")
# The longest trading window a precheck may replay and stay exempt from exposure; an uncalibrated
# example value. A longer precheck has seen enough of the window to count as a replay of it.
PRECHECK_MAX_DAYS = 7
REVIEW_COLUMNS = ("review_id", "trial_id", "source_sha256", "verdict", "reviewer", "created_at",
                  *(f"{item}_{part}" for item in ITEMS for part in ("status", "note")))


def digest_of(image_ref: object) -> str | None:
    return image_ref.rsplit("@", 1)[1] if isinstance(image_ref, str) and "@sha256:" in image_ref else None


def trial_identity(conn: db.LedgerConnection, trial_id) -> dict:
    """reproduction.trial_record (a trial row with its image digest and its instruments as `symbols`);
    TRIAL_NOT_FOUND otherwise."""
    row = reproduction.trial_record(conn, trial_id) if isinstance(trial_id, int) else None
    if row is None:
        raise refuse("TRIAL_NOT_FOUND", f"no trial {trial_id!r}", missing=(str(trial_id),))
    return row


def _capture(conn: db.LedgerConnection, trial_id: int) -> dict:
    """The original capture of a precheck; a malformed one is no precheck the registration can rely on."""
    try:
        return execution.read_capture(conn, trial_id)
    except Refusal as exc:
        if exc.code == "EXECUTION_IDENTITY":
            raise refuse("SOURCE_PRECHECK_REQUIRED", f"the capture of precheck trial {trial_id} is malformed: "
                         + exc.message, missing=(f"trial {trial_id}",)) from exc
        raise


def exposure_exempt(conn: db.LedgerConnection, trial_id: int, source_sha256: str, identity: Mapping) -> bool:
    """True when the trial is a declared native precheck matching the execution `identity` whose trading
    window is at most PRECHECK_MAX_DAYS long and whose instruments are among the identity's. (Only the
    precheck the registration cites is asked; register decides that.)"""
    trial = trial_identity(conn, trial_id)
    if (trial["purpose"] != "precheck" or trial["source_sha256"] != source_sha256
            or trial["image_digest"] != digest_of(identity.get("image_ref"))
            or trial["trade_end"] - trial["trade_start"] > timedelta(days=PRECHECK_MAX_DAYS)
            or any(trial[key] != identity.get(key) for key in EXEMPT_COLUMNS)
            or not set(trial["symbols"]) <= set(identity.get("symbols") or ())):
        return False
    return _capture(conn, trial_id)["status"] == "captured"


def sealed_no_result(conn: db.LedgerConnection, trial_id: int, source_sha256: str) -> bool:
    """True when the trial is a declared precheck of this source that sealed no economic result to
    choose from (on any image, inputs or window): its runner stopped before market data reached the
    strategy (every runtime failure problems.before_strategy), or it traded at most
    PRECHECK_MAX_DAYS and its complete capture fingerprints 0 fills and 0 positions. Such a precheck
    does not expose the source."""
    trial = trial_identity(conn, trial_id)
    if trial["purpose"] != "precheck" or trial["source_sha256"] != source_sha256:
        return False
    try:
        capture = execution.read_capture(conn, trial_id)
    except Refusal as exc:
        if exc.code == "EXECUTION_IDENTITY":
            return False
        raise
    if capture["status"] != "captured":
        return False
    stages = capture.get("stages")
    native = stages.get("native") if isinstance(stages, Mapping) else None
    native = native if isinstance(native, Mapping) else {}
    failures = capture["runtime_failures"]
    if (native.get("state") == "exited" and native.get("exit_code") not in (0, None) and failures
            and all(problems.before_strategy(failure) for failure in failures)):
        return True
    if trial["trade_end"] - trial["trade_start"] > timedelta(days=PRECHECK_MAX_DAYS):
        return False
    rows = problems.sealed_rows(capture)
    return rows is not None and rows.get("fills") == 0 and rows.get("positions") == 0


def _record(row: Mapping) -> dict:
    """A source_review row as a review record: its items as {status, note}, the image digest of its trial."""
    record = {key: row[key] for key in ("review_id", "trial_id", "source_sha256", "verdict", "reviewer", "created_at")}
    record.update({item: {"status": row[f"{item}_status"], "note": row[f"{item}_note"]} for item in ITEMS})
    record["image_digest"] = row["image_digest"]
    return record


def _reviews(conn: db.LedgerConnection, where: str = "", args: tuple = ()) -> list[dict]:
    columns = ", ".join(f"r.{column}" for column in REVIEW_COLUMNS)
    return [_record(row) for row in conn.dicts(f"SELECT {columns}, {db.TRIAL_IMAGE_DIGEST} FROM source_review r "
                                               f"JOIN trial t ON t.trial_id = r.trial_id{where} ORDER BY r.review_id",
                                               args)]


def review_records(conn: db.LedgerConnection, source_sha256: str | None = None) -> list[dict]:
    """Every source review (or those of one source), oldest first, as review records."""
    return _reviews(conn) if source_sha256 is None else _reviews(conn, " WHERE r.source_sha256 = %s", (source_sha256,))


def read_review(conn: db.LedgerConnection, review_id) -> dict:
    """One source review record; SOURCE_PRECHECK_REQUIRED when there is none."""
    found = _reviews(conn, " WHERE r.review_id = %s", (review_id,)) \
        if isinstance(review_id, int) and not isinstance(review_id, bool) else []
    if not found:
        raise refuse("SOURCE_PRECHECK_REQUIRED", f"no source review {review_id!r}", missing=(str(review_id),))
    return found[0]


def require_precheck(conn: db.LedgerConnection, review_id: int, source_sha256: str, identity: Mapping) -> int:
    """The precheck trial ID when the review and its native capture bind this source, the image, market
    commit, lifecycle and comparable configuration of `identity`, and both passed; any mismatch is a refusal:
    a review of the precheck reviews the configuration it ran."""
    record = read_review(conn, review_id)
    trial = trial_identity(conn, record["trial_id"])
    digest = digest_of(identity.get("image_ref"))
    if record["source_sha256"] != source_sha256 or trial["image_digest"] != digest:
        raise refuse("SOURCE_PRECHECK_REQUIRED", f"source review {review_id} does not review a precheck of this "
                                                 f"source on {digest}", missing=(str(review_id),))
    capture = _capture(conn, trial["trial_id"])
    stages, outcome = capture.get("stages"), capture.get("outcome")
    stages = stages if isinstance(stages, Mapping) else {}
    outcome = outcome if isinstance(outcome, Mapping) else {}
    if (capture["status"] != "captured" or not execution.stage_ok(stages.get("native"))
            or not execution.stage_ok(stages.get("audit")) or outcome.get("kind") != "completed"
            or capture["runtime_failures"]):
        raise refuse("SOURCE_PRECHECK_FAILED", f"precheck trial {trial['trial_id']} did not complete cleanly",
                     missing=(f"trial {trial['trial_id']}",))
    differs = [key for key in PRECHECK_COLUMNS if trial[key] != identity.get(key)]
    if differs:
        raise refuse("SOURCE_PRECHECK_REQUIRED", f"precheck trial {trial['trial_id']} used other inputs or "
                                                 "configuration: " + ", ".join(differs), missing=tuple(differs))
    if record["verdict"] != "passed":
        raise refuse("SOURCE_PRECHECK_FAILED", f"source review {review_id} did not pass: "
                     + ", ".join(item for item in ITEMS if record[item]["status"] not in PASSING),
                     missing=(str(review_id),))
    failed = [str(item["review_id"]) for item in review_records(conn, source_sha256)
              if item["trial_id"] == trial["trial_id"] and item["verdict"] == "failed"]
    if failed:
        raise refuse("SOURCE_PRECHECK_FAILED", f"precheck trial {trial['trial_id']} also has failed reviews: "
                     + ", ".join(failed), missing=tuple(failed))
    return trial["trial_id"]


def _check_body(body) -> None:
    def invalid(why: str, *missing: str):
        return refuse("REVIEW_INVALID", why, missing=missing,
                      expected="{trial_id, verdict, api, causal, activity, readiness}")
    if not isinstance(body, Mapping) or set(body) != {"trial_id", "verdict", *ITEMS}:
        extra = sorted(set(body) - {"trial_id", "verdict", *ITEMS}) if isinstance(body, Mapping) else []
        lacking = sorted({"trial_id", "verdict", *ITEMS} - set(body)) if isinstance(body, Mapping) else []
        raise invalid("the review body must hold exactly six fields", *lacking, *extra)
    if not isinstance(body["trial_id"], int) or isinstance(body["trial_id"], bool):
        raise invalid("trial_id must be an integer", "trial_id")
    if body["verdict"] not in VERDICTS:
        raise invalid("verdict must be passed or failed", "verdict")
    for item in ITEMS:
        value = body[item]
        if (not isinstance(value, Mapping) or set(value) != {"status", "note"} or value["status"] not in ITEM_STATUSES
                or not isinstance(value["note"], str) or not value["note"].strip() or len(value["note"]) > NOTE_LIMIT):
            raise invalid(f"{item} must be {{status, note}} with a status of {ITEM_STATUSES} and a nonempty note", item)
    if (body["verdict"] == "passed") != all(body[item]["status"] in PASSING for item in ITEMS):
        raise invalid("the verdict is passed exactly when every item is passed or no_opportunity", "verdict")


def record_review(ledger: db.LedgerProfile, body: Mapping, reviewer: str) -> dict:
    """Append an independent source review of one precheck trial as a source_review row; one commit."""
    _check_body(body)
    if not isinstance(reviewer, str) or not reviewer.strip() or len(reviewer) > 100:
        raise refuse("REVIEW_INVALID", "the reviewer is a nonempty name of at most 100 characters",
                     missing=("reviewer",))
    trial_id = body["trial_id"]
    payload = {"trial_id": trial_id, "verdict": body["verdict"], **{item: dict(body[item]) for item in ITEMS},
               "reviewer": reviewer}
    with db.connect(ledger, "writer") as conn:
        trial = trial_identity(conn, trial_id)
        if trial["purpose"] != "precheck" or execution.read_capture(conn, trial_id)["status"] != "captured":
            raise refuse("PRECHECK_CAPTURE_MISSING", f"trial {trial_id} has no original precheck capture",
                         missing=(f"trial {trial_id}",))

        def insert(c, op):
            c.rows("INSERT INTO source_review (trial_id, source_sha256, verdict, api_status, api_note, causal_status, "
                   "causal_note, activity_status, activity_note, readiness_status, readiness_note, reviewer, op_id) "
                   "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
                   (trial_id, trial["source_sha256"], body["verdict"],
                    *(body[item][part] for item in ITEMS for part in ("status", "note")), reviewer, op))
            (review_id,), = c.rows("SELECT LAST_INSERT_ID()")
            return {"review_id": review_id}

        written = db.write(conn, "record_review", payload, "source_review", insert)
    return {"review_id": written["record"]["review_id"], "trial_id": trial_id, "source_sha256": trial["source_sha256"],
            "image_digest": trial["image_digest"], "ledger_commit": written["commit"], "replayed": written["replayed"]}
