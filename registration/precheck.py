"""Native prechecks and independent source reviews (`registration.exposure_exempt`,
`registration.require_precheck`, `registration.record_review`).

A precheck is a replay declared as such before it starts (trial purpose precheck), on the runtime
image and inputs the registration will use; it never consumes a grid point and does not expose the
source. An Agent that did not write the source reviews the sealed precheck capture under four items;
the review is appended as a product bundle bound to the source hash, the image digest and the
precheck capture. Passing says the source runs, not that it is economic evidence.
"""

from __future__ import annotations

from collections.abc import Mapping
import hashlib
import json

from ledger import db, evidence, execution
from ledger.errors import Refusal
from ledger.refusals import refuse
from registration import comparability


REVIEW_FILE = "source-review.json"
REVIEW_FORMAT = "source-review-v1"
ITEMS = ("api", "causal", "activity", "readiness")
ITEM_STATUSES = ("passed", "failed", "unresolved", "no_opportunity")
VERDICTS = ("passed", "failed")
PASSING = ("passed", "no_opportunity")
NOTE_LIMIT = 8000  # uncalibrated example value
WINDOW_KEYS = ("window_start", "window_end", "trade_start")
# Input facts a precheck's start receipt must share with the registration (input_key keys).
EXEMPT_INPUT_KEYS = ("market_database", "market_commit", "universe_rule", "lifecycle_bundle")
PRECHECK_INPUT_KEYS = ("market_commit", "lifecycle_bundle", "window")


def digest_of(image_ref: str) -> str | None:
    return image_ref.rsplit("@", 1)[1] if isinstance(image_ref, str) and "@sha256:" in image_ref else None


def _trial(conn: db.LedgerConnection, trial_id) -> dict:
    row = conn.one("SELECT trial_id, purpose, source_sha256, image_ref, image_digest, instruments FROM trial "
                   "WHERE trial_id = %s", (trial_id,)) if isinstance(trial_id, int) else None
    if row is None:
        raise refuse("TRIAL_NOT_FOUND", f"no trial {trial_id!r}", missing=(str(trial_id),))
    return row


def exposure_exempt(conn: db.LedgerConnection, trial_id: int, source_sha256: str, image_ref: str, config_key: dict,
                    input_key: dict) -> bool:
    """True when the trial is a declared native precheck matching the registration's identity."""
    trial = _trial(conn, trial_id)
    if trial["purpose"] != "precheck":
        return False
    if trial["source_sha256"] != source_sha256 or trial["image_digest"] != digest_of(image_ref):
        return False
    capture = execution.read_capture(conn, trial_id)
    if capture["status"] != "captured" or capture["purpose"] != "precheck" or capture["start"].get("purpose") != "precheck":
        return False
    started = capture["start"].get("input_identity")
    if not isinstance(started, Mapping):
        return False
    if any(started.get(key) != input_key.get(key) for key in EXEMPT_INPUT_KEYS):
        return False
    symbols = started.get("symbols")
    if not isinstance(symbols, list) or not set(symbols) <= set(input_key.get("symbols") or ()):
        return False
    coverage = capture["input_coverage"] if isinstance(capture["input_coverage"], Mapping) else {}
    try:
        declared = comparability.config_key(coverage.get("effective_config"))
    except Refusal as exc:
        if exc.code == "IDENTITY_MALFORMED":
            return False
        raise
    ignored = set(WINDOW_KEYS) | {"symbols"}
    if ({key: value for key, value in declared.items() if key not in ignored}
            != {key: value for key, value in config_key.items() if key not in ignored}):
        return False
    return not conn.rows("SELECT 1 FROM registration_attempt WHERE trial_id = %s", (trial_id,))


def _review(conn: db.LedgerConnection, review_bundle) -> dict:
    if not (isinstance(review_bundle, str) and review_bundle.startswith("source-review-")):
        # Only record_review writes this namespace; a review under another name is an Agent's own file.
        raise refuse("SOURCE_PRECHECK_REQUIRED", f"{review_bundle!r} is not a source-review-* bundle",
                     missing=(str(review_bundle),))
    try:
        loaded = evidence.load_bundle(conn, review_bundle)
    except Refusal as exc:
        if exc.code in ("UNKNOWN_BUNDLE", "INVALID_BUNDLE_NAME"):
            raise refuse("SOURCE_PRECHECK_REQUIRED", f"no source review bundle {review_bundle!r}",
                         missing=(str(review_bundle),)) from exc
        raise
    data = loaded["files"].get(REVIEW_FILE)
    try:
        record = json.loads(data.decode("utf-8")) if data is not None else None
    except (UnicodeDecodeError, ValueError):
        record = None
    if not isinstance(record, dict) or record.get("format") != REVIEW_FORMAT:
        raise refuse("SOURCE_PRECHECK_REQUIRED", f"{review_bundle} holds no {REVIEW_FORMAT} {REVIEW_FILE}",
                     missing=(f"{review_bundle}/{REVIEW_FILE}",))
    return record


def _stage_ok(stage) -> bool:
    return isinstance(stage, Mapping) and stage.get("state") == "exited" and stage.get("exit_code") == 0


def require_precheck(conn: db.LedgerConnection, review_bundle: str, source_sha256: str, image_ref: str,
                     input_key: Mapping | None) -> int:
    """The precheck trial ID when the review and its native capture bind this source, image and
    inputs and both passed; any mismatch is a refusal."""
    record = _review(conn, review_bundle)
    trial = _trial(conn, record.get("trial_id"))
    digest = digest_of(image_ref)
    if (trial["purpose"] != "precheck" or trial["source_sha256"] != source_sha256
            or record.get("source_sha256") != source_sha256 or trial["image_digest"] != digest
            or record.get("image_digest") != digest):
        raise refuse("SOURCE_PRECHECK_REQUIRED", f"{review_bundle} does not review a precheck of this source on "
                                                 f"{digest}", missing=(str(review_bundle),))
    capture = execution.read_capture(conn, trial["trial_id"])
    stages = capture.get("stages") if isinstance(capture.get("stages"), Mapping) else {}
    outcome = capture.get("outcome") if isinstance(capture.get("outcome"), Mapping) else {}
    if (capture["status"] != "captured" or not _stage_ok(stages.get("native")) or not _stage_ok(stages.get("audit"))
            or outcome.get("kind") != "completed" or capture["runtime_failures"]):
        raise refuse("SOURCE_PRECHECK_FAILED", f"precheck trial {trial['trial_id']} did not complete cleanly",
                     missing=(f"trial-{trial['trial_id']}-execution",))
    if input_key is not None:
        started = capture["start"].get("input_identity") or {}
        differs = [key for key in PRECHECK_INPUT_KEYS if key in input_key and started.get(key) != input_key[key]]
        if differs:
            raise refuse("SOURCE_PRECHECK_REQUIRED", f"precheck trial {trial['trial_id']} used other inputs: "
                                                     + ", ".join(differs), missing=tuple(differs))
    failing = [item for item in ITEMS if (record.get(item) or {}).get("status") not in PASSING]
    if failing:
        raise refuse("SOURCE_PRECHECK_FAILED", f"{review_bundle} did not pass: " + ", ".join(failing),
                     missing=tuple(failing))
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
    if body["verdict"] == "passed" and any(body[item]["status"] in ("failed", "unresolved") for item in ITEMS):
        raise invalid("a passed verdict cannot hold a failed or unresolved item", "verdict")


def record_review(ledger: db.LedgerProfile, body: Mapping, reviewer: str) -> dict:
    """Append an independent source review of one precheck trial as a product bundle; one commit."""
    _check_body(body)
    if not isinstance(reviewer, str) or not reviewer.strip():
        raise ValueError("the reviewer is a nonempty name")
    trial_id = body["trial_id"]
    with db.connect(ledger, "writer") as conn:
        trial = _trial(conn, trial_id)
        capture = execution.read_capture(conn, trial_id)
        if trial["purpose"] != "precheck" or capture["status"] != "captured" or capture["purpose"] != "precheck":
            raise refuse("PRECHECK_CAPTURE_MISSING", f"trial {trial_id} has no original precheck capture",
                         missing=(f"trial-{trial_id}-execution",))
        record = {"format": REVIEW_FORMAT, "trial_id": trial_id, "source_sha256": trial["source_sha256"],
                  "image_digest": trial["image_digest"], "execution_bundle": f"trial-{trial_id}-execution",
                  "verdict": body["verdict"], **{item: dict(body[item]) for item in ITEMS}, "authority": reviewer}
        content = (json.dumps(record, sort_keys=True, indent=2, ensure_ascii=False) + "\n").encode("utf-8")
        sha = hashlib.sha256(content).hexdigest()
        bundle = f"source-review-{trial_id}-{sha[:16]}"
        written = db.write(conn, "record_review", {"bundle": bundle, "sha256": sha}, "evidence_bundle",
                           lambda c, op: evidence.write_files(c, bundle, {REVIEW_FILE: content}, op))
    return {"bundle": bundle, "path": REVIEW_FILE, "trial_id": trial_id, "source_sha256": trial["source_sha256"],
            "image_digest": trial["image_digest"], "sha256": sha, "ledger_commit": written["commit"],
            "replayed": written["replayed"]}
