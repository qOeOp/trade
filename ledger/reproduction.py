"""Derive exact reproductions from existing trial identities and sealed execution facts.

No cache registry or reproduction marker is stored. A new execution remains an explore trial;
only a complete, identical execution can be treated as a reproduction of an earlier trial.
"""

from __future__ import annotations

from collections.abc import Mapping

from ledger import db, execution, problems
from ledger.errors import Refusal
from registration import comparability


IDENTITY = ("source_sha256", "image_digest", "instruments", "input_start", "trade_start", "trade_end")


def trial_record(conn: db.LedgerConnection, trial_id: int) -> dict | None:
    return conn.one(f"SELECT trial_id, purpose, source_sha256, image_ref, {db.IMAGE_DIGEST}, instruments, input_start, trade_start, "
                    "trade_end FROM trial WHERE trial_id = %s", (trial_id,))


def fingerprint_hash(capture: Mapping) -> str | None:
    """The original fingerprint hash only after all execution stages completed cleanly."""
    stages = capture.get("stages") or {}
    audit = problems.json_object(problems.sealed(capture, execution.AUDIT_RESULT))
    if (capture.get("status") != "captured" or (capture.get("outcome") or {}).get("kind") != "completed"
            or capture.get("runtime_failures") or audit is None or audit.get("passed") is not True or any(
                not isinstance(stages.get(stage), Mapping) or stages[stage].get("state") != "exited"
                or stages[stage].get("exit_code") != 0 for stage in execution.STAGES)):
        return None
    entry = (capture.get("listed") or {}).get(execution.FINGERPRINT_RESULT) or {}
    return entry.get("sha256") if entry.get("status") in ("captured", "hashed") else None


def matches(conn: db.LedgerConnection, reproduction_trial_id: int, original_trial_id: int) -> bool:
    """A successful explore with the earlier trial's complete identity and original fingerprint.

Callers decide which original trials are eligible anchors (for example the precheck actually
cited by a registration). Equal hashes alone never grant a general exposure exemption.
"""
    if original_trial_id >= reproduction_trial_id:
        return False
    current = trial_record(conn, reproduction_trial_id)
    original = trial_record(conn, original_trial_id)
    if (current is None or original is None or current["purpose"] != "explore"
            or original["purpose"] not in ("precheck", "research", "validation")
            or any(current[key] != original[key] for key in IDENTITY)):
        return False
    try:
        captured = execution.read_capture(conn, reproduction_trial_id)
        anchor = execution.read_capture(conn, original_trial_id)
        fingerprint = fingerprint_hash(captured)
        if not fingerprint or fingerprint != fingerprint_hash(anchor):
            return False
        return (comparability.config_key((captured.get("input_coverage") or {}).get("effective_config"))
                == comparability.config_key((anchor.get("input_coverage") or {}).get("effective_config"))
                and comparability.input_key(captured["start"].get("input_identity"))
                == comparability.input_key(anchor["start"].get("input_identity")))
    except Refusal as exc:
        if exc.code in ("EXECUTION_IDENTITY", "IDENTITY_MALFORMED"):
            return False
        raise
