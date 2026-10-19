"""Economic evidence availability (`qualification.assess`, `qualification.require`, `qualification.mask`,
`qualification.native_reasons`, `qualification.source_reviews`, `qualification.check_identity`).

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

from ledger import db, metrics
from ledger.refusals import refuse
from registration.precheck import REVIEW_FILE, REVIEW_FORMAT


CHECK = "economic_evidence_v1"
COMPARABLE_PURPOSES = ("research", "validation")
# The sealed facts the criterion reads, by the reason a failing one gives (economic_evidence_v1).
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
                    "metrics", "single", "exposures_table")


@functools.cache
def _checker_source() -> str:
    return hashlib.sha256(Path(__file__).read_bytes()).hexdigest()


def check_identity() -> dict:
    """{check, metrics_revision, checker_source_sha256}: the criterion, the metrics code and this checker."""
    return {"check": CHECK, "metrics_revision": metrics.metrics_revision(clean=False),
            "checker_source_sha256": _checker_source()}


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
    stages = capture.get("stages") if isinstance(capture.get("stages"), Mapping) else {}
    failed = []
    for name, stage in sorted(stages.items()):
        if not isinstance(stage, Mapping) or stage.get("state") == "not_available":
            continue
        if stage.get("state") != "exited" or stage.get("exit_code") != 0:
            failed.append(name)
    return failed


def _capture_view(capture: Mapping) -> dict:
    if capture.get("status") != "captured":
        return {"status": capture.get("status"), "purpose": (capture.get("start") or {}).get("purpose"),
                "failed_stages": [], "failures": [], "original_missing": True}
    return {"status": "captured", "purpose": capture.get("purpose"), "failed_stages": _stage_failures(capture),
            "failures": list(capture.get("runtime_failures") or []), "original_missing": False,
            "outcome": (capture.get("outcome") or {}).get("kind")}


def _counts(fingerprints, sealed: Mapping | None) -> dict:
    """Activity counts for diagnosis: native row counts the fingerprint records, else the sealed facts."""
    rows = {}
    if isinstance(fingerprints, Mapping):
        for name in ("orders", "fills", "positions", "account"):
            item = fingerprints.get(name)
            rows[name] = item.get("rows") if isinstance(item, Mapping) else None
    activity = (sealed or {}).get("activity") or {}
    populations = (sealed or {}).get("populations") or {}
    return {"orders": rows.get("orders"),
            "fills": rows.get("fills") if rows.get("fills") is not None else populations.get("fills"),
            "positions": rows.get("positions") if rows.get("positions") is not None else populations.get("cycles"),
            "account_rows": rows.get("account") if rows.get("account") is not None else
            (activity.get("account_endpoints_match@2") or {}).get("rows")}


def assess(conn: db.LedgerConnection, run: Mapping) -> dict:
    """The economic evidence availability of one run under the current criterion; writes nothing."""
    loaded = metrics.load_run(conn, run["run_id"])
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
    sealed = metrics.latest_sealed(conn, row["run_id"], loaded["sealed"]) if row["status"] == "passed" else None
    if row["status"] == "passed":
        for item in native_reasons(sealed):
            reasons.append(item)
            if item.startswith("NOT_EVALUATED: "):
                limitations.append(NOT_EVALUATED.format(fact=item.removeprefix("NOT_EVALUATED: ")))
    reviewed = source_reviews(conn, {"run_id": row["run_id"], "source_sha256": trial["source_sha256"],
                                     "image_digest": trial["image_digest"]})
    if reviewed["status"] == "failed":
        reasons.append("SOURCE_REVIEW_FAILED: " + ", ".join(item["bundle"] for item in reviewed["reviews"]
                                                            if item["verdict"] == "failed"))
    comparable = trial["purpose"] in COMPARABLE_PURPOSES
    if not comparable:
        reasons.append(f"PURPOSE_NOT_COMPARABLE: a {trial['purpose']} trial is no run")
    return {"economic_evidence_available": not reasons, "reasons": reasons,
            "activity": _counts(row.get("fingerprints"), sealed), "stored_audit_status": row["status"],
            "source_check": reviewed, "execution_capture": view, "checker": check_identity(),
            "applicability": {"purpose": trial["purpose"], "comparable_purpose": comparable,
                              "sealed_metrics_revision": (sealed or {}).get("metrics_revision")},
            "limitations": list(dict.fromkeys(limitations))}


def require(conn: db.LedgerConnection, run: Mapping) -> dict:
    """The availability of a run that has economic evidence; ECONOMIC_EVIDENCE_UNAVAILABLE otherwise.
    The refusal carries every reason (and the whole view as `availability`)."""
    value = assess(conn, run)
    if not value["economic_evidence_available"]:
        exc = refuse("ECONOMIC_EVIDENCE_UNAVAILABLE", f"run {run['run_id']} has no economic evidence: "
                     + "; ".join(value["reasons"]), missing=(str(run["run_id"]), *value["reasons"]))
        exc.availability = value
        raise exc
    return value


def mask(output: dict, value: dict) -> dict:
    """Attach the availability; without economic evidence every performance key is emptied."""
    output["availability"] = value
    if not value.get("economic_evidence_available"):
        for key in PERFORMANCE_KEYS:
            if key in output:
                output[key] = None
    return output


def _added_commit(conn: db.LedgerConnection, bundle: str) -> str | None:
    found = conn.rows("SELECT to_commit FROM dolt_diff_evidence_bundle WHERE to_bundle = %s AND diff_type = 'added' "
                      "LIMIT 1", (bundle,))
    return found[0][0] if found else None


def source_reviews(conn: db.LedgerConnection, run: Mapping) -> dict:
    """The independent source reviews bound to this run's source hash and image digest."""
    reviews, ignored = [], []
    for bundle, content, stored in conn.rows("SELECT bundle, content, sha256 FROM evidence WHERE path = %s ORDER BY "
                                             "bundle", (REVIEW_FILE,)):
        content = bytes(content)
        if hashlib.sha256(content).hexdigest() != stored:
            raise refuse("LEDGER_CORRUPT", f"stored file {bundle}/{REVIEW_FILE} differs from its content hash",
                         missing=(f"{bundle}/{REVIEW_FILE}",))
        if not bundle.startswith("source-review-"):
            ignored.append({"bundle": bundle, "reason": "not a product source-review bundle"})
            continue
        try:
            record = json.loads(content.decode("utf-8"))
        except (UnicodeDecodeError, ValueError):
            record = None
        if (not isinstance(record, dict) or record.get("format") != REVIEW_FORMAT
                or any(record.get(field) is None for field in REVIEW_FIELDS)):
            ignored.append({"bundle": bundle, "reason": f"not a complete {REVIEW_FORMAT} record"})
            continue
        if record["source_sha256"] != run["source_sha256"] or record["image_digest"] != run["image_digest"]:
            continue  # another candidate's or runtime's review
        commit = _added_commit(conn, bundle)
        trial = None
        if commit is not None and isinstance(record["trial_id"], int):
            trial = conn.one(f"SELECT trial_id, purpose, source_sha256, image_digest FROM trial AS OF "
                             f"'{db.check_ref(commit)}' WHERE trial_id = %s", (record["trial_id"],))
        if (trial is None or trial["purpose"] != "precheck" or trial["source_sha256"] != record["source_sha256"]
                or trial["image_digest"] != record["image_digest"]):
            ignored.append({"bundle": bundle, "reason": "the review's identity differs from its precheck trial at the "
                                                        "commit that wrote it"})
            continue
        reviews.append({"bundle": bundle, "sha256": stored, "verdict": record["verdict"],
                        "reviewer": record["authority"], "ledger_commit": commit})
    verdicts = {item["verdict"] for item in reviews}
    status = "failed" if "failed" in verdicts else "passed" if "passed" in verdicts else "unreviewed"
    return {"status": status, "reviews": reviews, "ignored": ignored, "scope": REVIEW_SCOPE}
