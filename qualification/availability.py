"""Economic evidence availability (`qualification.assess`, `qualification.require`, `qualification.mask`,
`qualification.native_reasons`, `qualification.source_reviews`, `qualification.check_identity`), with
`review_records` (every source review read once per call) and `report_revision` (the product checkout's
HEAD revision every read-time report names).

A run is economic evidence when, by the current criterion, it is a passed run whose audit ran, whose
original execution capture is complete and clean, whose sealed facts show real activity that
reconciles with its native records, whose semantic fingerprint is recorded, and whose bound source
reviews did not fail. The criterion is applied when a run is read, never written back: the same run
can read differently under another check identity, which the identity explains. Native reports are
not read; a fact the sealing did not record is named not evaluated (the caller reproduces the run
through replay.reproduce to evaluate it), never passed or failed silently.
"""

from __future__ import annotations

from collections.abc import Mapping
import functools
import hashlib
import json
from pathlib import Path

from ledger import db, evidence, metrics, problems, review_activity
from ledger.refusals import refuse
from registration.precheck import REVIEW_FILE, REVIEW_FORMAT


CHECK = "economic_evidence_v2"
COMPARABLE_PURPOSES = ("research", "validation")
# The sealed facts the criterion reads, by the reason a failing one gives (economic_evidence_v2).
REQUIRED_FACTS = {
    "real_fills@1": "zero fills: no real activity",
    "fills_match_orders@1": "fills without matching orders, or filled orders without fills",
    "cycles_cover_fills@1": "position cycles do not cover every fill exactly once",
    "returns_compound_to_equity@1": "daily returns do not compound to the final equity",
    "account_endpoints_match@2": "account endpoints differ from the starting balance or the audited final balance",
    "cycles_reconcile_audit@1": "position cycles do not reconcile with the audited account economics",
}
REVIEW_FIELDS = ("trial_id", "source_sha256", "image_digest", "verdict", "authority")
REVIEW_SCOPE = "the Agent's causal duty; a passed audit does not make the source valid"
LIMITATION = (f"Economic evidence is a read-time view under check {CHECK}; it rewrites no stored run status or audit "
              "result")
NOT_EVALUATED = ("{fact} was not recorded when the run was sealed; reproduce the run (replay.reproduce) to evaluate it "
                 "under this criterion")
# Every performance key a report reader may carry; mask empties all of them for a run without evidence.
PERFORMANCE_KEYS = ("headline", "measures", "slices", "closed_by_year", "drawdown", "capital", "cost_basis",
                    "metrics", "single", "exposures_table", "account")
# What a masked run keeps of each sealed activity fact: whether it held, why not, and its counts.
MASKED_FACT_KEYS = ("passed", "code", "count", "rows")


@functools.cache
def _checker_source() -> str:
    """Fingerprint this checker and its shared activity-review policy."""
    return hashlib.sha256(Path(__file__).read_bytes() + b"\0"
                          + Path(review_activity.__file__).read_bytes()).hexdigest()


def report_revision() -> str:
    """The metrics revision a read-time report computes with: the product checkout's HEAD, whatever
    its work tree holds. The checkout is the registration seam's (`registration.seams.current.checkout`)."""
    from registration import seams
    return metrics.metrics_revision(seams.current.checkout())


def check_identity() -> dict:
    """{check, metrics_revision, checker_source_sha256}: the criterion, the metrics code and this checker."""
    return {"check": CHECK, "metrics_revision": report_revision(), "checker_source_sha256": _checker_source()}


def native_reasons(reports: Mapping | None) -> list[str]:
    """Unavailability reasons from the qualification facts of a sealed report (`ledger.metrics`
    output): one `CODE: detail` per failing fact, `NOT_EVALUATED: fact` for a fact it does not hold."""
    activity = (reports or {}).get("activity") if isinstance(reports, Mapping) else None
    if not isinstance(activity, Mapping):
        return ["SEALED_RESULT_MISSING: the run has no sealed result with qualification facts"]
    found = []
    for fact, meaning in REQUIRED_FACTS.items():
        value = activity.get(fact)
        if not isinstance(value, Mapping) or not isinstance(value.get("passed"), bool):
            found.append(f"NOT_EVALUATED: {fact}")
        elif not value["passed"]:
            found.append(f"{value.get('code') or 'FACT_FAILED'}: {fact} ({meaning})")
    return found


def _stage_failures(capture: Mapping) -> list[str]:
    stages = capture.get("stages")
    if not isinstance(stages, Mapping):
        stages = {}
    failed = []
    for name, stage in sorted(stages.items()):
        if not isinstance(stage, Mapping):
            continue
        if stage.get("state") != "exited" or stage.get("exit_code") != 0:
            failed.append(name)
    return failed


def _capture_view(capture: Mapping) -> dict:
    if capture.get("status") != "captured":
        return {"status": capture.get("status"), "purpose": (capture.get("start") or {}).get("purpose"),
                "failed_stages": [], "failures": [], "original_missing": True}
    return {"status": "captured", "purpose": capture.get("purpose"), "failed_stages": _stage_failures(capture),
            "failures": problems.failure_groups(capture.get("runtime_failures") or []), "original_missing": False,
            "outcome": (capture.get("outcome") or {}).get("kind")}


def _counts(fingerprints) -> dict:
    """Activity counts for diagnosis: the native row counts the fingerprint records (a passed run's)."""
    rows = {}
    if isinstance(fingerprints, Mapping):
        for name in ("orders", "fills", "positions", "account"):
            item = fingerprints.get(name)
            rows[name] = item.get("rows") if isinstance(item, Mapping) else None
    return {"orders": rows.get("orders"), "fills": rows.get("fills"), "positions": rows.get("positions"),
            "account_rows": rows.get("account")}


def assess(conn: db.LedgerConnection, run: Mapping, *, checker: Mapping | None = None, records: list | None = None,
           review_scope: Mapping | None = None) -> dict:
    """The economic evidence availability of one run under the current criterion; writes nothing.

    `checker` (check_identity) and `records` (review_records) are what a caller assessing many runs
    reads once; `review_scope` restricts the source reviews counted (source_reviews)."""
    loaded = metrics.load_run(conn, run["trial_id"])
    row, trial, capture = loaded["run"], loaded["trial"], loaded["capture"]
    reasons, limitations = [], [LIMITATION]
    if row["status"] != "passed":
        codes = [item.get("code") for item in row.get("failure_reasons") or [] if isinstance(item, Mapping)]
        reasons.append("RUN_INVALID: " + (", ".join(dict.fromkeys(code for code in codes if code)) or "invalid"))
    audit = row.get("audit") if isinstance(row.get("audit"), Mapping) else {}
    if row["status"] == "passed" and not audit.get("ran"):
        reasons.append("AUDIT_NOT_RUN: the stored audit did not run")
    reasons += loaded["evidence"]["unavailable"]
    view = _capture_view(capture)
    if not view["original_missing"] and (view["failed_stages"] or view["failures"] or view["outcome"] != "completed"):
        reasons.append("CAPTURE_FAILED: " + ", ".join(
            [*(f"stage {name}" for name in view["failed_stages"]), *(["runtime failures"] if view["failures"] else []),
             *([f"outcome {view['outcome']}"] if view["outcome"] != "completed" else [])]))
    sealed = metrics.latest_sealed(conn, row["trial_id"], loaded["sealed"]) if row["status"] == "passed" else None
    if row["status"] == "passed":
        for item in native_reasons(sealed):
            reasons.append(item)
            if item.startswith("NOT_EVALUATED: "):
                limitations.append(NOT_EVALUATED.format(fact=item.removeprefix("NOT_EVALUATED: ")))
    reviewed = source_reviews(conn, {"trial_id": row["trial_id"], "source_sha256": trial["source_sha256"],
                                     "image_digest": trial["image_digest"]}, records=records, scope=review_scope)
    if reviewed["status"] == "failed":
        reasons.append("SOURCE_REVIEW_FAILED: " + ", ".join(item["bundle"] for item in reviewed["reviews"]
                                                            if item["verdict"] == "failed"))
    comparable = trial["purpose"] in COMPARABLE_PURPOSES
    if not comparable:
        reasons.append(f"PURPOSE_NOT_COMPARABLE: a {trial['purpose']} trial is no run")
    return {"economic_evidence_available": not reasons, "reasons": reasons,
            "activity": _counts(row.get("fingerprints")), "stored_audit_status": row["status"],
            "source_check": reviewed, "execution_capture": view,
            "checker": dict(checker) if checker is not None else check_identity(),
            "applicability": {"purpose": trial["purpose"], "comparable_purpose": comparable,
                              "sealed_metrics_revision": (sealed or {}).get("metrics_revision")},
            "limitations": list(dict.fromkeys(limitations))}


def require(conn: db.LedgerConnection, run: Mapping, **options) -> dict:
    """The availability of a run that has economic evidence; ECONOMIC_EVIDENCE_UNAVAILABLE otherwise.
    The refusal carries every reason (and the whole view as `availability`); `options` are assess's."""
    value = assess(conn, run, **options)
    if not value["economic_evidence_available"]:
        exc = refuse("ECONOMIC_EVIDENCE_UNAVAILABLE", f"run {run['trial_id']} has no economic evidence: "
                     + "; ".join(value["reasons"]), missing=(str(run["trial_id"]), *value["reasons"]))
        exc.availability = value  # type: ignore[attr-defined]  # ledger.Refusal declares no view field
        raise exc
    return value


def mask(output: dict, value: dict) -> dict:
    """Attach the availability; without economic evidence every performance key is emptied and each
    activity fact is reduced to whether it held, its code and its counts (no money value leaves)."""
    output["availability"] = value
    if not value.get("economic_evidence_available"):
        for key in PERFORMANCE_KEYS:
            if key in output:
                output[key] = None
        if isinstance(output.get("activity"), Mapping):
            output["activity"] = {fact: ({key: item[key] for key in MASKED_FACT_KEYS if key in item}
                                         if isinstance(item, Mapping) else None)
                                  for fact, item in output["activity"].items()}
    return output


REVIEW_PREFIX = "source-review-"  # the namespace only registration.record_review writes
REVIEW_WRITE = "record_review"  # its ledger.write kind; the commit message is `<kind>:<op_id>`


def _added_commit(conn: db.LedgerConnection, bundle: str) -> str | None:
    found = conn.rows("SELECT to_commit FROM dolt_diff_evidence_bundle WHERE to_bundle = %s AND diff_type = 'added' "
                      "LIMIT 1", (bundle,))
    return found[0][0] if found else None


def _review_commits(conn: db.LedgerConnection) -> dict[str, str]:
    """The commit of every record_review write by its operation ID, read from the commit log once
    (ledger.write commits each write as `<kind>:<op_id>`) instead of diffing every commit per review."""
    return {message[len(REVIEW_WRITE) + 1:]: commit for commit, message in conn.rows(
        "SELECT commit_hash, message FROM dolt_log WHERE message LIKE %s", (REVIEW_WRITE + ":%",))
        if message.startswith(REVIEW_WRITE + ":")}


def review_records(conn: db.LedgerConnection) -> list[dict]:
    """Every stored source-review file of the product namespace (source-review-*), read and checked
    once: {bundle, sha256, record, ledger_commit, ignored}; `ignored` names why a file is no product
    review of its precheck trial (else None). LEDGER_CORRUPT when a stored file differs from its
    content hash. Both reads are primary-key ranges of that namespace."""
    found: list[dict] = []
    rows = conn.rows(f"SELECT e.bundle, c.content, e.sha256 FROM {evidence.files_from()} WHERE e.bundle LIKE %s "
                     "AND e.path = %s ORDER BY e.bundle", (REVIEW_PREFIX + "%", REVIEW_FILE))
    if not rows:
        return found
    operations = dict(conn.rows("SELECT bundle, op_id FROM evidence_bundle WHERE bundle LIKE %s",
                                (REVIEW_PREFIX + "%",)))
    commits = _review_commits(conn)
    for bundle, content, stored in rows:
        content = bytes(content)
        if hashlib.sha256(content).hexdigest() != stored:
            raise refuse("LEDGER_CORRUPT", f"stored file {bundle}/{REVIEW_FILE} differs from its content hash",
                         missing=(f"{bundle}/{REVIEW_FILE}",))
        item = {"bundle": bundle, "sha256": stored, "record": None, "ledger_commit": None, "ignored": None}
        found.append(item)
        try:
            record = json.loads(content.decode("utf-8"))
        except (UnicodeDecodeError, ValueError):
            record = None
        if (not isinstance(record, dict) or record.get("format") != REVIEW_FORMAT
                or any(record.get(field) is None for field in REVIEW_FIELDS)):
            item["ignored"] = f"not a complete {REVIEW_FORMAT} record"
            continue
        item["record"] = record
        op_id = operations.get(bundle)
        commit = commits.get(op_id) if op_id is not None else None
        if commit is None or not _recorded_by(conn, bundle, commit):
            commit = _added_commit(conn, bundle)  # not written by record_review: the history says when
        item["ledger_commit"] = commit
        trial = None
        if commit is not None and isinstance(record["trial_id"], int):
            trial = conn.one(f"SELECT trial_id, purpose, source_sha256, {db.IMAGE_DIGEST} FROM trial AS OF "
                             f"'{db.check_ref(commit)}' WHERE trial_id = %s", (record["trial_id"],))
        if (trial is None or trial["purpose"] != "precheck" or trial["source_sha256"] != record["source_sha256"]
                or trial["image_digest"] != record["image_digest"]):
            item["ignored"] = "the review's identity differs from its precheck trial at the commit that wrote it"
    return found


def _recorded_by(conn: db.LedgerConnection, bundle: str, commit: str) -> bool:
    """Whether the bundle was already in the ledger at `commit`."""
    return bool(conn.rows(f"SELECT 1 FROM evidence_bundle AS OF '{db.check_ref(commit)}' WHERE bundle = %s", (bundle,)))


def source_reviews(conn: db.LedgerConnection, run: Mapping, *, records: list | None = None,
                   scope: Mapping | None = None) -> dict:
    """The independent source reviews bound to this run's source hash and image digest.

    `records` are review_records already read for this call; `scope` {bundles, recorded_by} counts
    only the named review bundles that were in the ledger at the commit `recorded_by` (the facts
    fixed when a run was sealed). Resolved zero-activity failures are derived only from this
    filtered set, using the same three conditions as line selection."""
    reviews, ignored, eligible = [], [], []
    for item in records if records is not None else review_records(conn):
        record = item["record"]
        if record is None or item["ignored"] is not None:
            if record is None or (record["source_sha256"] == run["source_sha256"]
                                  and record["image_digest"] == run["image_digest"]):
                ignored.append({"bundle": item["bundle"], "reason": item["ignored"]})
            continue
        if record["source_sha256"] != run["source_sha256"] or record["image_digest"] != run["image_digest"]:
            continue  # another candidate's or runtime's review
        if scope is not None and (item["bundle"] not in scope.get("bundles", ()) or scope.get("recorded_by") is None
                                  or not _recorded_by(conn, item["bundle"], scope["recorded_by"])):
            ignored.append({"bundle": item["bundle"], "reason": "not a review fixed when the run was sealed"})
            continue
        eligible.append(item)
    reviewed = [item["record"] for item in eligible]
    for item in eligible:
        record = item["record"]
        if review_activity.resolved(conn, record, reviewed):
            ignored.append({"bundle": item["bundle"], "reason": "zero-fill, zero-position activity failure resolved "
                            "by a later traded precheck with passed reviews and no failed review"})
            continue
        reviews.append({"bundle": item["bundle"], "sha256": item["sha256"], "verdict": record["verdict"],
                        "reviewer": record["authority"], "ledger_commit": item["ledger_commit"]})
    verdicts = {item["verdict"] for item in reviews}
    status = "failed" if "failed" in verdicts else "passed" if "passed" in verdicts else "unreviewed"
    return {"status": status, "reviews": reviews, "ignored": ignored, "scope": REVIEW_SCOPE}
