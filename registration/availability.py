"""Economic evidence availability (`registration.assess`, `registration.require`, `registration.mask`,
`registration.native_reasons`, `registration.source_reviews`, `registration.check_identity`), with
`report_revision` (the product checkout's
HEAD commit every read-time report names).

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
from pathlib import Path

from ledger import db, metrics, problems, review_activity
from shared.refusals import refuse
from registration import precheck
from registration.comparability import COMPARABLE_PURPOSES


CHECK = "economic_evidence_v2"
# The sealed facts the criterion reads, by the reason a failing one gives (economic_evidence_v2).
REQUIRED_FACTS = {
    "real_fills": "zero fills: no real activity",
    "fills_match_orders": "fills without matching orders, or filled orders without fills",
    "cycles_cover_fills": "position cycles do not cover every fill exactly once",
    "returns_compound_to_equity": "daily returns do not compound to the final equity",
    "account_endpoints_match": "account endpoints differ from the starting balance or the audited final balance",
    "cycles_reconcile_audit": "position cycles do not reconcile with the audited account economics",
}
REVIEW_SCOPE = "the Agent's causal duty; a passed audit does not make the source valid"
LIMITATION = (f"Economic evidence is a read-time view under check {CHECK}; it rewrites no stored run status or audit "
              "result")
NOT_EVALUATED = ("{fact} was not recorded when the run was sealed; reproduce the run (replay.reproduce) to evaluate it "
                 "under this criterion")
# Every performance key a report reader may carry; mask empties all of them for a run without evidence.
PERFORMANCE_KEYS = ("headline", "measures", "slices", "closed_by_year", "drawdown", "capital", "cost_basis",
                    "metrics", "single", "exposures_table", "account")
# What a masked run keeps of each sealed activity fact: whether it held, why not, and its count.
MASKED_FACT_KEYS = ("passed", "code", "count")


@functools.cache
def _checker_source() -> str:
    """Fingerprint this checker and its shared activity-review policy."""
    return hashlib.sha256(Path(__file__).read_bytes() + b"\0"
                          + Path(review_activity.__file__).read_bytes()).hexdigest()


def report_revision() -> str:
    """The product commit a read-time report computes with: the product checkout's HEAD, whatever
    its work tree holds. The checkout is the registration seam's (`registration.seams.current.checkout`)."""
    from registration import seams
    return metrics.product_commit(seams.current.checkout())


def check_identity() -> dict:
    """{check, product_commit, checker_source_sha256}: the criterion, the metrics code and this checker."""
    return {"check": CHECK, "product_commit": report_revision(), "checker_source_sha256": _checker_source()}


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
           review_scope: Mapping | None = None, loaded: Mapping | None = None) -> dict:
    """The economic evidence availability of one run under the current criterion; writes nothing.

    `checker` (check_identity), `records` (precheck.review_records) and `loaded` (the run's metrics.load_runs entry, a
    listing read will do) are what a caller assessing many runs reads once; `review_scope` restricts the source reviews
    counted (source_reviews). A passed run's audit ran: its fingerprints are stored only then."""
    loaded = metrics.load_run(conn, run["trial_id"]) if loaded is None else loaded
    row, trial, capture = loaded["run"], loaded["trial"], loaded["capture"]
    reasons, limitations = [], [LIMITATION]
    if row["status"] != "passed":
        codes = [item.get("code") for item in row.get("failure_reasons") or [] if isinstance(item, Mapping)]
        reasons.append("RUN_INVALID: " + (", ".join(dict.fromkeys(code for code in codes if code)) or "invalid"))
    reasons += loaded["evidence"]["unavailable"]
    view = _capture_view(capture)
    if not view["original_missing"] and (view["failed_stages"] or view["failures"] or view["outcome"] != "completed"):
        reasons.append("CAPTURE_FAILED: " + ", ".join(
            [*(f"stage {name}" for name in view["failed_stages"]), *(["runtime failures"] if view["failures"] else []),
             *([f"outcome {view['outcome']}"] if view["outcome"] != "completed" else [])]))
    sealed = loaded["sealed"] if row["status"] == "passed" else None
    if row["status"] == "passed":
        for item in native_reasons(sealed):
            reasons.append(item)
            if item.startswith("NOT_EVALUATED: "):
                limitations.append(NOT_EVALUATED.format(fact=item.removeprefix("NOT_EVALUATED: ")))
    reviewed = source_reviews(conn, {"trial_id": row["trial_id"], "source_sha256": trial["source_sha256"],
                                     "image_digest": trial["image_digest"]}, records=records, scope=review_scope)
    if reviewed["status"] == "failed":
        reasons.append("SOURCE_REVIEW_FAILED: " + ", ".join(str(item["review_id"]) for item in reviewed["reviews"]
                                                            if item["verdict"] == "failed"))
    comparable = trial["purpose"] in COMPARABLE_PURPOSES
    if not comparable:
        reasons.append(f"PURPOSE_NOT_COMPARABLE: a {trial['purpose']} trial is no run")
    return {"economic_evidence_available": not reasons, "reasons": reasons,
            "activity": _counts(row.get("fingerprints")), "stored_audit_status": row["status"],
            "source_check": reviewed, "execution_capture": view,
            "checker": dict(checker) if checker is not None else check_identity(),
            "applicability": {"purpose": trial["purpose"], "comparable_purpose": comparable,
                              "sealed_product_commit": (sealed or {}).get("product_commit")},
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


def source_reviews(conn: db.LedgerConnection, run: Mapping, *, records: list | None = None,
                   scope: Mapping | None = None) -> dict:
    """The independent source reviews bound to this run's source hash and image digest.

    `records` are precheck.review_records already read for this call; `scope` {review_ids} counts only the named
    reviews (the facts fixed when a run was sealed: the reviews its registration cited, which existed
    before it). Resolved zero-activity failures are derived only from this filtered set, using the same
    three conditions as line selection."""
    reviews, ignored, eligible = [], [], []
    for record in records if records is not None else precheck.review_records(conn, run["source_sha256"]):
        if record["source_sha256"] != run["source_sha256"] or record["image_digest"] != run["image_digest"]:
            continue  # another candidate's or runtime's review
        if scope is not None and record["review_id"] not in scope.get("review_ids", ()):
            ignored.append({"review_id": record["review_id"], "reason": "not a review fixed when the run was sealed"})
            continue
        eligible.append(record)
    for record in eligible:
        if review_activity.resolved(conn, record, eligible):
            ignored.append({"review_id": record["review_id"], "reason": "zero-fill, zero-position activity failure "
                            "resolved by a later traded precheck with passed reviews and no failed review"})
            continue
        reviews.append({"review_id": record["review_id"], "trial_id": record["trial_id"], "verdict": record["verdict"],
                        "reviewer": record["reviewer"], "created_at": record["created_at"]})
    verdicts = {item["verdict"] for item in reviews}
    status = "failed" if "failed" in verdicts else "passed" if "passed" in verdicts else "unreviewed"
    return {"status": status, "reviews": reviews, "ignored": ignored, "scope": REVIEW_SCOPE}
