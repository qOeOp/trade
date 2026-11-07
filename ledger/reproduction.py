"""Derive reproductions from existing trial identities and sealed execution facts.

No cache registry or reproduction marker is stored. A new execution remains an explore trial;
only a complete execution with the same result can be treated as a reproduction of an earlier trial.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from functools import lru_cache
import json

from ledger import db, execution, problems
from ledger.errors import Refusal
from registration import comparability


IDENTITY = ("source_sha256", "instruments", "input_start", "trade_start", "trade_end")
# What must agree across images: fees are in the fills, the equity path in the daily returns. Account and order
# tables change their representation between Nautilus versions while these stay the same.
RESULT_TABLES = ("fills", "positions", "exposures", "returns_series")
NOT_COMPARED_ACROSS_IMAGES = ("runtime_contract",)


def trial_record(conn: db.LedgerConnection, trial_id: int) -> dict | None:
    return conn.one(f"SELECT trial_id, purpose, source_sha256, image_ref, {db.IMAGE_DIGEST}, instruments, input_start, trade_start, "
                    "trade_end FROM trial WHERE trial_id = %s", (trial_id,))


def reproductions(conn: db.LedgerConnection, trial_id: int) -> list[dict]:
    """The execution identity of each explore trial reproducing `trial_id`, oldest first: {image_ref, image_digest,
    effective_config, input_identity}. A run counts each as its own too: the same result under that identity."""
    original = trial_record(conn, trial_id)
    if original is None:
        return []
    found = []
    for (later,) in conn.rows("SELECT trial_id FROM trial WHERE purpose = 'explore' AND source_sha256 = %s "
                              "AND trial_id > %s ORDER BY trial_id", (original["source_sha256"], trial_id)):
        if matches(conn, later, trial_id):
            capture, record = execution.read_capture(conn, later), trial_record(conn, later) or {}
            found.append({"image_ref": record["image_ref"], "image_digest": record["image_digest"],
                          "effective_config": (capture.get("input_coverage") or {}).get("effective_config"),
                          "input_identity": capture["start"].get("input_identity")})
    return found


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


def shared_equal(one: Mapping, other: Mapping) -> bool:
    """Whether every key both configurations hold agrees; a newer contract states what an older one left implicit."""
    for key in one.keys() & other.keys():
        if key in NOT_COMPARED_ACROSS_IMAGES:
            continue
        both = isinstance(one[key], Mapping) and isinstance(other[key], Mapping)
        if not (shared_equal(one[key], other[key]) if both else one[key] == other[key]):
            return False
    return True


def _recorded_tables(conn: db.LedgerConnection, trial_id: int) -> Mapping | None:
    row = conn.one("SELECT fingerprints FROM run WHERE trial_id = %s", (trial_id,))
    stored = None if row is None else row["fingerprints"]
    return json.loads(stored) if isinstance(stored, (str, bytes)) else stored


def differing_tables(hashes: Mapping, recorded: Mapping) -> list[str]:
    """The tables both hold whose hashes differ; a table only one side has is not compared."""
    return sorted(table for table in hashes.keys() & recorded.keys()
                  if hashes[table] != (recorded[table] or {}).get("sha256"))


def matcher(conn: db.LedgerConnection) -> Callable[[int, int], bool]:
    """`matches` for one read of many pairs: each trial's record and capture are read once."""
    record = lru_cache(maxsize=None)(lambda trial_id: trial_record(conn, trial_id))
    capture = lru_cache(maxsize=None)(lambda trial_id: execution.read_capture(conn, trial_id))
    return lambda reproduction_trial_id, original_trial_id: matches(
        conn, reproduction_trial_id, original_trial_id, record=record, capture=capture)


def matches(conn: db.LedgerConnection, reproduction_trial_id: int, original_trial_id: int, *,
            record: Callable[[int], Mapping | None] | None = None,
            capture: Callable[[int], Mapping] | None = None) -> bool:
    """A successful explore with the earlier trial's source, contracts, window and result, whatever its inputs.

    On the same image: the same configuration and the same whole fingerprint. On another image, for a sealed run and
    a reproduction that recorded its table hashes (only `replay reproduce` does, on a main build): the configuration
    keys both hold and the semantic hashes of RESULT_TABLES.

    Callers decide which original trials are eligible anchors (for example the precheck actually
    cited by a registration). Equal hashes alone never grant a general exposure exemption.
    """
    if original_trial_id >= reproduction_trial_id:
        return False
    record = record or (lambda trial_id: trial_record(conn, trial_id))
    capture = capture or (lambda trial_id: execution.read_capture(conn, trial_id))
    current = record(reproduction_trial_id)
    original = record(original_trial_id)
    if (current is None or original is None or current["purpose"] != "explore"
            or original["purpose"] not in ("precheck", "research", "validation")
            or any(current[key] != original[key] for key in IDENTITY)):
        return False
    try:
        captured = capture(reproduction_trial_id)
        anchor = capture(original_trial_id)
        fingerprint, anchored = fingerprint_hash(captured), fingerprint_hash(anchor)
        if not fingerprint or not anchored:
            return False
        config = comparability.config_key((captured.get("input_coverage") or {}).get("effective_config"))
        expected = comparability.config_key((anchor.get("input_coverage") or {}).get("effective_config"))
        if current["image_digest"] == original["image_digest"]:
            return fingerprint == anchored and config == expected
        hashes, recorded = captured.get("table_hashes"), _recorded_tables(conn, original_trial_id)
        if not isinstance(hashes, Mapping) or not isinstance(recorded, Mapping) or not shared_equal(config, expected):
            return False
        return (all(table in hashes and table in recorded for table in RESULT_TABLES)
                and not set(differing_tables(hashes, recorded)) & set(RESULT_TABLES))
    except Refusal as exc:
        if exc.code in ("EXECUTION_IDENTITY", "IDENTITY_MALFORMED"):
            return False
        raise
