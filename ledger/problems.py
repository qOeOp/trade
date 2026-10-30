"""Why a replay is invalid (`ledger.capture_problems`, `ledger.audit_problems`, `ledger.summary_problems`,
`ledger.capture_fingerprint`, `ledger.stored_fingerprint`, `ledger.sealed_rows`).

The rules are pure: they read exit codes, stage facts and the bytes of the audit result, the
runtime failure receipts and the native summary, never logs. `replay.audit_problems` and
`replay.summary_problems` apply them to a working directory; `ledger.ingest_run` applies them to
the trial's sealed capture only, so no caller decides whether a sealed run passed. Every reason
code is in `REASONS`, the failure-reason catalogue.
"""

from __future__ import annotations

from collections.abc import Mapping
import hashlib
import json

from ledger import db


AUDIT_RESULT = "audit/audit.json"
RUNTIME_ERRORS = "reports/runtime_failures.jsonl"  # engine.execution_failure
SUMMARY = "reports/summary.json"
FINGERPRINT = "fingerprint/fingerprint.json"
DAY_HASHES = "by_utc_day"  # engine.report_fingerprint's per-UTC-day hashes of a table; never stored
FAILURE_FIELDS = ("stage", "exception_type")
FAILURE_TEXT_LIMIT = 300  # characters of a failure message kept in a reason
# engine.main stages that end before any market data reaches the strategy (execution_failure): binding,
# load, inputs. The one definition for counting tests and for exposure (registration.sealed_no_result).
PRE_STRATEGY_STAGES = frozenset({"execution_binding", "load", "inputs"})
OVERFLOW_STAGE = "receipt_overflow"  # engine.run.OVERFLOW_STAGE: the failures beyond the itemised records
# engine.config.HOST_PATH_KEYS: the host paths the effective configuration hash leaves out
HOST_PATH_KEYS = ("market_root", "universe_path")

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
    "RUNNER_REFUSED": "The runner refused before the strategy traded; its refusal code is the cause.",
    "RUNTIME_FAILURES_NOT_ITEMISED": "The runner recorded more distinct failures than it itemises.",
    "SUMMARY_MISSING": "The native summary is missing.",
    "SUMMARY_INCOMPLETE": "The native summary lacks a field the sealed report needs.",
    "SOURCE_MISMATCH": "The native summary names another source.",
    "RUNTIME_MISMATCH": "The native summary names another runtime identity.",
    "CONFIG_MISMATCH": "The native summary names another effective configuration.",
    "RUNNER_INTEGRITY_FAILED": "The runner's own integrity checks failed.",
    "FINGERPRINT_FAILED": "The in-image semantic fingerprint stage failed or wrote no readable fingerprint.",
    "FINGERPRINT_MISSING": "The run has no semantic fingerprint: the stage never ran.",
    "NATIVE_REPORT_MISSING": "A native report a passed run needs is missing.",
    "NATIVE_REPORT_UNREADABLE": "A native report exists but does not parse.",
    "METRICS_UNREADABLE": "A native value the sealed report needs cannot be read.",
    "INPUTS_CHANGED": "The exported inputs changed during the replay.",
    "INPUT_IDENTITY_MISMATCH": "The sealed coverage receipt names other inputs than the stored input identity.",
    "COVERAGE_RECEIPT_INVALID": "The sealed coverage receipt is malformed.",
    "COVERAGE_MISMATCH": "The coverage receipt and the native summary differ.",
    "LIFECYCLE_NATIVE_COUNT_INVALID": "The native lifecycle counts are malformed.",
    "LIFECYCLE_BUNDLE_MISSING": "Instruments have native lifecycle events but the inputs no lifecycle bundle.",
    "LIFECYCLE_COVERAGE_MISMATCH": "The coverage receipt's window, format or market commit differs from the summary.",
    "LIFECYCLE_COUNT_MISMATCH": "Receipt, episode and native lifecycle counts disagree.",
    "LIFECYCLE_EVENT_INVALID": "An exported lifecycle event is not a valid native event.",
    "LIFECYCLE_DUPLICATE_EVENT": "A lifecycle termination repeats.",
}


def reason(code: str, message: str, locator=None) -> dict:
    """One failure reason {code, message, locator}; an uncatalogued code is a KeyError."""
    REASONS[code]
    return {"code": code, "message": message, "locator": locator}


def config_sha256(effective_config: Mapping) -> str:
    """The effective configuration hash by the engine's rule (engine.config.config_sha256): SHA-256 of the
    canonical JSON of the configuration without its host paths. The host derives it from the sealed
    configuration and never takes it from a caller."""
    hashed = {key: value for key, value in effective_config.items() if key not in HOST_PATH_KEYS}
    return hashlib.sha256(db.canonical_json(hashed).encode()).hexdigest()


def unique(reasons) -> list[dict]:
    """The reasons with repeats (same code, locator and message) dropped, in order."""
    return list({(item["code"], json.dumps(item.get("locator"), sort_keys=True, default=str), item.get("message")): item
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
                for group in failure_groups(lines):
                    reasons.append(_failure_reason(group))
    return cause_first(reasons), parsed


def cause_first(reasons: list[dict]) -> list[dict]:
    """The reasons with a runner refusal before the run first: the exit, audit and summary reasons
    that follow from it come after, in their order."""
    return sorted(reasons, key=lambda item: item["code"] != "RUNNER_REFUSED")


def _failure_reason(group: Mapping) -> dict:
    if group["stage"] == OVERFLOW_STAGE:
        return reason("RUNTIME_FAILURES_NOT_ITEMISED", f"{group['count']} more failures not itemised", OVERFLOW_STAGE)
    code, message = group["code"], group["message"]
    if code and group["stage"] in PRE_STRATEGY_STAGES:
        detail = message.removeprefix(f"{code}: ")[:FAILURE_TEXT_LIMIT]
        return reason("RUNNER_REFUSED", f"{code} in {group['stage']}" + (f": {detail}" if detail else ""),
                      f"{group['stage']}:{code}")
    return reason("RUNTIME_FAILURE_RECORDED", _failure_text(group), f"{group['stage']}:{group['instrument_id']}")


def _count(value) -> int:
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= 1 else 1


def failure_groups(items) -> list[dict]:
    """Runtime failure receipts merged by (exception type, stage, instrument, message), in first-seen
    order, each with its total count, its refusal code and its first traceback. A receipt is one
    failure unless it carries a positive `count`; `code` is optional (a runner refusal's code)."""
    groups: dict[tuple, dict] = {}
    for item in items:
        item = item if isinstance(item, Mapping) else {}
        key = (str(item.get("exception_type")), str(item.get("stage")),
               str(item.get("instrument_id") or "unconstructed"), str(item.get("message") or ""))
        group = groups.get(key)
        if group is None:
            group = groups[key] = {"exception_type": key[0], "stage": key[1], "instrument_id": key[2],
                                   "message": key[3], "code": None, "count": 0,
                                   "traceback": str(item.get("traceback") or "")[:FAILURE_TEXT_LIMIT * 10] or None}
        if group["code"] is None and isinstance(item.get("code"), str) and item["code"]:
            group["code"] = item["code"]
        group["count"] += _count(item.get("count"))
    return list(groups.values())


def _failure_text(group: Mapping) -> str:
    code = f" {group['code']}" if group["code"] and not group["message"].startswith(group["code"]) else ""
    message = group["message"][:FAILURE_TEXT_LIMIT]
    times = f" ({group['count']} times)" if group["count"] > 1 else ""
    return f"{group['exception_type']}{code} in {group['stage']}" + (f": {message}" if message else "") + times


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


def sealed(capture: Mapping, path: str, verified: Mapping[str, bytes] | None = None) -> bytes | None:
    """The sealed bytes of one captured file (b"" when captured empty), None when it was not captured.

    A hashed file's bytes are read from `verified` (files of the working directory) only when they
    equal the hash and length the capture records."""
    status = (capture.get("statuses") or {}).get(path)
    if status == "captured":
        return capture["files"][path]
    if status == "hashed" and verified is not None:
        entry = (capture.get("listed") or {}).get(path) or {}
        data = verified.get(path)
        if data is not None and len(data) == entry.get("length") and hashlib.sha256(data).hexdigest() == entry.get(
                "sha256"):
            return data
        return None
    return b"" if status == "captured_empty" else None


def capture_problems(capture: Mapping, source_sha256: str, identity: Mapping, config_sha256: str,
                     verified: Mapping[str, bytes] | None = None) -> list[dict]:
    """Every invalidity reason the sealed capture of one trial gives: its outcome, stage exits, audit
    result, runtime failures, native summary and fingerprint stage (`verified`: as `sealed`)."""
    stages = given if isinstance(given := capture.get("stages"), Mapping) else {}
    outcome = given if isinstance(given := capture.get("outcome"), Mapping) else {}
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
    reasons += capture_fingerprint(capture, verified)[1]
    return cause_first(unique(reasons))


def capture_fingerprint(capture: Mapping, verified: Mapping[str, bytes] | None = None) -> tuple[dict | None, list[dict]]:
    """(the semantic fingerprint the fingerprint stage sealed, in its stored form, its failure reasons).

    Outside a precheck the capture holds only the fingerprint's hash; its bytes come from `verified`
    (the working directory's files, checked against that hash by `sealed`).

    A passed run needs its fingerprint: a stage that never ran is FINGERPRINT_MISSING. A stage that
    ran must exit 0 and leave a JSON object.
    """
    stage = (capture.get("stages") or {}).get("fingerprint") if isinstance(capture.get("stages"), Mapping) else None
    if not isinstance(stage, Mapping):
        return None, [reason("FINGERPRINT_MISSING", "the run has no semantic fingerprint (stage never started)",
                             "fingerprint")]
    if _exit(stage) != 0:
        return None, [reason("FINGERPRINT_FAILED", f"the fingerprint stage ended {stage.get('state')} with exit "
                                                   f"code {stage.get('exit_code')}", "fingerprint")]
    value = json_object(sealed(capture, FINGERPRINT, verified))
    if value is None:
        return None, [reason("FINGERPRINT_FAILED", "the fingerprint stage wrote no JSON object", FINGERPRINT)]
    return stored_fingerprint(value), []


def stored_fingerprint(fingerprint):
    """A semantic fingerprint as a run row keeps it and as two fingerprints are compared: each table's
    rows, whole-table hash and file hash, without the image's per-UTC-day hashes (`DAY_HASHES`), which
    nothing reads. Runs ingested earlier still store them; passing a stored fingerprint through here
    before comparing lets old and new rows match. Anything but a mapping is returned unchanged."""
    if not isinstance(fingerprint, Mapping):
        return fingerprint
    return {name: {key: value for key, value in entry.items() if key != DAY_HASHES}
            if isinstance(entry, Mapping) else entry for name, entry in fingerprint.items()}


def sealed_rows(capture: Mapping) -> dict[str, int] | None:
    """{table: rows} of the fingerprint a complete capture sealed (captured, completed, native, audit and
    fingerprint stages exited 0, no runtime failure); None for any other capture, or when the
    fingerprint's bytes are not in it (only a precheck capture holds them)."""
    stages = given if isinstance(given := capture.get("stages"), Mapping) else {}
    outcome = given if isinstance(given := capture.get("outcome"), Mapping) else {}
    if (capture.get("status") != "captured" or outcome.get("kind") != "completed" or capture.get("runtime_failures")
            or _exit(stages.get("native")) != 0 or _exit(stages.get("audit")) != 0):
        return None
    fingerprint, _ = capture_fingerprint(capture)
    if fingerprint is None:
        return None
    return {name: entry["rows"] for name, entry in fingerprint.items() if isinstance(entry, Mapping)
            and isinstance(entry.get("rows"), int) and not isinstance(entry["rows"], bool)}
