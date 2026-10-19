"""Why a replay is invalid (`ledger.capture_problems`, `ledger.audit_problems`, `ledger.summary_problems`,
`ledger.capture_fingerprint`).

The rules are pure: they read exit codes, stage facts and the bytes of the audit result, the
runtime failure receipts and the native summary, never logs. `replay.audit_problems` and
`replay.summary_problems` apply them to a working directory; `ledger.ingest_run` applies them to
the trial's sealed capture only, so no caller decides whether a sealed run passed. Every reason
code is in `REASONS`, the failure-reason catalogue.
"""

from __future__ import annotations

from collections.abc import Mapping
import json


AUDIT_RESULT = "audit/audit.json"
RUNTIME_ERRORS = "reports/runtime_failures.jsonl"  # engine.execution_failure
SUMMARY = "reports/summary.json"
FINGERPRINT = "fingerprint/fingerprint.json"
FAILURE_FIELDS = ("stage", "exception_type")

REASONS: dict[str, str] = {
    "EXECUTION_NOT_COMPLETED": "The replay was interrupted or failed on the host before it completed.",
    "EXECUTION_CAPTURE_LIMIT": "The execution capture exceeded its size limit; only recovery material was kept.",
    "NATIVE_NOT_EXITED": "The native runner never started or never exited.",
    "NATIVE_EXIT_NONZERO": "The native runner exited nonzero.",
    "AUDIT_NOT_RUN": "The independent audit did not run.",
    "AUDIT_EXIT_NONZERO": "The independent audit exited nonzero.",
    "AUDIT_RESULT_MISSING": "The audit result audit/audit.json is missing.",
    "AUDIT_RESULT_UNREADABLE": "The audit result is not a JSON object.",
    "AUDIT_FINDINGS": "The independent audit found a problem or did not pass.",
    "RUNTIME_FAILURE_UNREADABLE": "The runtime failure receipts are not JSON lines.",
    "RUNTIME_FAILURE_MALFORMED": "A runtime failure receipt lacks its stage or exception type.",
    "RUNTIME_FAILURE_RECORDED": "The runner recorded a runtime failure.",
    "SUMMARY_MISSING": "The native summary is missing.",
    "SUMMARY_INCOMPLETE": "The native summary lacks a field the sealed report needs.",
    "SOURCE_MISMATCH": "The native summary names another source.",
    "RUNTIME_MISMATCH": "The native summary names another runtime identity.",
    "CONFIG_MISMATCH": "The native summary names another effective configuration.",
    "RUNNER_INTEGRITY_FAILED": "The runner's own integrity checks failed.",
    "FINGERPRINT_FAILED": "The in-image semantic fingerprint stage failed or wrote no readable fingerprint.",
    "NATIVE_REPORT_MISSING": "A native report a passed run needs is missing.",
    "NATIVE_REPORT_UNREADABLE": "A native report exists but does not parse.",
    "METRICS_UNREADABLE": "A native value the sealed report needs cannot be read.",
    "INPUTS_CHANGED": "The exported inputs changed during the replay.",
    "INPUT_IDENTITY_MISMATCH": "The sealed coverage receipt names other inputs than the stored input identity.",
    "COVERAGE_RECEIPT_INVALID": "The sealed coverage receipt is malformed.",
    "COVERAGE_MISMATCH": "The coverage receipt and the native summary differ.",
    "LIFECYCLE_NATIVE_COUNT_INVALID": "The native lifecycle counts are malformed.",
    "LIFECYCLE_BUNDLE_MISSING": "Instruments have native lifecycle events but the inputs no lifecycle bundle.",
}


def reason(code: str, message: str, locator=None) -> dict:
    """One failure reason {code, message, locator}; an uncatalogued code is a KeyError."""
    REASONS[code]
    return {"code": code, "message": message, "locator": locator}


def unique(reasons) -> list[dict]:
    """The reasons with repeats (same code and locator) dropped, in order."""
    return list({(item["code"], json.dumps(item.get("locator"), sort_keys=True, default=str)): item
                 for item in reasons}.values())


def json_object(data: bytes | None):
    try:
        value = json.loads(data.decode("utf-8")) if data is not None else None
    except (UnicodeDecodeError, ValueError):
        return None
    return value if isinstance(value, dict) else None


def audit_problems(native_exit: int | None, audit_exit: int | None, audit: bytes | None,
                   failures: bytes | None) -> tuple[list[dict], dict | None]:
    """Reasons from the exit codes, the audit result bytes and the runtime failure receipt bytes
    (None: the file is missing); returns (reasons, parsed audit result or None)."""
    reasons = []
    if native_exit is None:
        reasons.append(reason("NATIVE_NOT_EXITED", "the native runner did not exit", "native"))
    elif native_exit:
        reasons.append(reason("NATIVE_EXIT_NONZERO", f"the native runner exited {native_exit}", "native"))
    if audit_exit is None:
        reasons.append(reason("AUDIT_NOT_RUN", "the independent audit did not run", "audit"))
    elif audit_exit:
        reasons.append(reason("AUDIT_EXIT_NONZERO", f"the independent audit exited {audit_exit}", "audit"))
    parsed = None
    if audit is None:
        reasons.append(reason("AUDIT_RESULT_MISSING", "the audit result is missing", AUDIT_RESULT))
    else:
        parsed = json_object(audit)
        if parsed is None:
            reasons.append(reason("AUDIT_RESULT_UNREADABLE", "the audit result is not a JSON object", AUDIT_RESULT))
        else:
            findings = parsed.get("findings") if isinstance(parsed.get("findings"), list) else []
            for finding in findings:
                reasons.append(reason("AUDIT_FINDINGS", "the independent audit found a problem", finding))
            if parsed.get("passed") is not True and not findings:
                reasons.append(reason("AUDIT_FINDINGS", "the independent audit did not pass", AUDIT_RESULT))
    if failures is not None:
        try:
            lines = [json.loads(line) for line in failures.decode("utf-8").splitlines() if line.strip()]
        except (UnicodeDecodeError, ValueError) as exc:
            reasons.append(reason("RUNTIME_FAILURE_UNREADABLE", f"the runtime failure receipts are unreadable: {exc}",
                                  RUNTIME_ERRORS))
        else:
            if any(not isinstance(item, dict) or any(not isinstance(item.get(key), str) for key in FAILURE_FIELDS)
                   for item in lines):
                reasons.append(reason("RUNTIME_FAILURE_MALFORMED", "a runtime failure receipt is not structured",
                                      RUNTIME_ERRORS))
            else:
                for item in lines:
                    reasons.append(reason("RUNTIME_FAILURE_RECORDED", f"{item['exception_type']} in {item['stage']}",
                                          f"{item['stage']}:{item.get('instrument_id') or 'unconstructed'}"))
    return reasons, parsed


def summary_problems(summary: Mapping | None, source_sha256: str, identity: Mapping, config_sha256: str) -> list[dict]:
    """The native summary checked against the trial's identity: source, runtime, configuration, integrity."""
    if summary is None:
        return [reason("SUMMARY_MISSING", "the native summary is missing", SUMMARY)]
    reasons = []
    if summary.get("source_sha256") != source_sha256:
        reasons.append(reason("SOURCE_MISMATCH", "the native summary names another source", "source_sha256"))
    recorded = summary.get("runtime_identity")
    if not isinstance(recorded, Mapping) or dict(recorded) != dict(identity):
        fields = sorted(key for key in set(identity) | set(recorded if isinstance(recorded, Mapping) else {})
                        if not isinstance(recorded, Mapping) or recorded.get(key) != identity.get(key))
        reasons.append(reason("RUNTIME_MISMATCH", "the native summary names another runtime identity",
                              ",".join(fields) or "runtime_identity"))
    if summary.get("effective_config_sha256") != config_sha256:
        reasons.append(reason("CONFIG_MISMATCH", "the native summary names another effective configuration",
                              "effective_config_sha256"))
    if summary.get("integrity_passed") is not True:
        reasons.append(reason("RUNNER_INTEGRITY_FAILED", "the runner's integrity checks failed",
                              "; ".join(str(item) for item in summary.get("integrity_findings") or ()) or None))
    return reasons


def _exit(stage) -> int | None:
    if isinstance(stage, Mapping) and stage.get("state") == "exited" and isinstance(stage.get("exit_code"), int):
        return stage["exit_code"]
    return None


def sealed(capture: Mapping, path: str) -> bytes | None:
    """The sealed bytes of one captured file (b"" when captured empty), None when it was not captured."""
    status = (capture.get("statuses") or {}).get(path)
    if status == "captured":
        return capture["files"][path]
    return b"" if status == "captured_empty" else None


def capture_problems(capture: Mapping, source_sha256: str, identity: Mapping, config_sha256: str) -> list[dict]:
    """Every invalidity reason the sealed capture of one trial gives: its outcome, stage exits, audit
    result, runtime failures, native summary and fingerprint stage."""
    stages = capture.get("stages") if isinstance(capture.get("stages"), Mapping) else {}
    outcome = capture.get("outcome") if isinstance(capture.get("outcome"), Mapping) else {}
    reasons = []
    if outcome.get("kind") != "completed":
        reasons.append(reason("EXECUTION_NOT_COMPLETED", f"the replay ended {outcome.get('kind')}: "
                                                         f"{outcome.get('detail')}", "outcome"))
    found, _ = audit_problems(_exit(stages.get("native")), _exit(stages.get("audit")), sealed(capture, AUDIT_RESULT),
                              sealed(capture, RUNTIME_ERRORS))
    reasons += found
    summary = sealed(capture, SUMMARY)
    parsed = json_object(summary)
    if summary is not None and parsed is None:
        reasons.append(reason("NATIVE_REPORT_UNREADABLE", "the native summary is not a JSON object", SUMMARY))
    else:
        reasons += summary_problems(parsed, source_sha256, identity, config_sha256)
    reasons += capture_fingerprint(capture)[1]
    return unique(reasons)


def capture_fingerprint(capture: Mapping) -> tuple[dict | None, list[dict]]:
    """(the semantic fingerprint the fingerprint stage sealed, its failure reasons).

    An image without a fingerprint entry records the stage not_available: no fingerprint and no
    reason. A stage that ran must exit 0 and leave a JSON object.
    """
    stage = (capture.get("stages") or {}).get("fingerprint") if isinstance(capture.get("stages"), Mapping) else None
    if not isinstance(stage, Mapping) or stage.get("state") == "not_available":
        return None, []
    if _exit(stage) != 0:
        return None, [reason("FINGERPRINT_FAILED", f"the fingerprint stage ended {stage.get('state')} with exit "
                                                   f"code {stage.get('exit_code')}", "fingerprint")]
    value = json_object(sealed(capture, FINGERPRINT))
    if value is None:
        return None, [reason("FINGERPRINT_FAILED", "the fingerprint stage wrote no JSON object", FINGERPRINT)]
    return value, []
