"""Derive reproductions from existing trial identities and sealed execution facts.

No cache registry or reproduction marker is stored. A new execution remains an explore trial;
only a complete execution with the same result can be treated as a reproduction of an earlier trial.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
import json

from ledger import db, execution, problems
from ledger.trials import config_key
from shared.errors import Refusal
from registration import comparability


IDENTITY = ("source_sha256", "symbols", "input_start", "trade_start", "trade_end")
# What must agree across images: fees are in the fills, the equity path in the daily returns. Account and order
# tables change their representation between Nautilus versions while these stay the same.
RESULT_TABLES = ("fills", "positions", "exposures", "returns_series")
NOT_COMPARED_ACROSS_IMAGES = ("runtime_contract",)


def _trials(conn: db.LedgerConnection, where: str = "", args: tuple = ()) -> list[dict]:
    """Trial rows with their image digest and instruments (`symbols`), by trial ID."""
    rows = conn.dicts(f"SELECT *, {db.IMAGE_DIGEST} FROM trial{where} ORDER BY trial_id", args)
    symbols: dict[int, list[str]] = {}
    instruments = "SELECT trial_id, instrument_id FROM trial_instrument"
    if where:
        instruments += f" WHERE trial_id IN (SELECT trial_id FROM trial{where})"
    for trial_id, symbol in conn.rows(instruments + " ORDER BY trial_id, instrument_id", args):
        symbols.setdefault(trial_id, []).append(symbol)
    for row in rows:
        row["symbols"] = symbols.get(row["trial_id"], [])
    return rows


@db.pinned_read
def trial_record(conn: db.LedgerConnection, trial_id: int) -> dict | None:
    found = _trials(conn, " WHERE trial_id = %s", (trial_id,))
    return found[0] if found else None


def reproductions(conn: db.LedgerConnection, trial_id: int) -> list[dict]:
    """The comparable identity (comparability.IDENTITY) of each explore trial reproducing `trial_id`, oldest first.
    A run counts each as its own too: the same result under that identity."""
    original = trial_record(conn, trial_id)
    if original is None:
        return []
    found = []
    for (later,) in conn.rows("SELECT trial_id FROM trial WHERE purpose = 'explore' AND source_sha256 = %s "
                              "AND trial_id > %s ORDER BY trial_id", (original["source_sha256"], trial_id)):
        if matches(conn, later, trial_id):
            found.append(comparability.comparable_identity(trial_record(conn, later) or {}))
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


def _recorded_tables_of(conn: db.LedgerConnection, trial_ids: list[int]) -> dict[int, Mapping | None]:
    """_recorded_tables of each trial, by trial ID, in one read per execution.BATCH trials."""
    found: dict[int, Mapping | None] = dict.fromkeys(trial_ids)
    for at in range(0, len(trial_ids), execution.BATCH):
        chunk = tuple(trial_ids[at:at + execution.BATCH])
        for trial_id, stored in conn.rows(f"SELECT trial_id, fingerprints FROM run WHERE trial_id IN "
                                          f"({', '.join(['%s'] * len(chunk))})", chunk):
            found[trial_id] = json.loads(stored) if isinstance(stored, (str, bytes)) else stored
    return found


def differing_tables(hashes: Mapping, recorded: Mapping) -> list[str]:
    """The tables both hold whose hashes differ; a table only one side has is not compared."""
    return sorted(table for table in hashes.keys() & recorded.keys()
                  if hashes[table] != (recorded[table] or {}).get("sha256"))


ANCHORS = ("precheck", "research", "validation")  # the purposes a reproduction can reproduce


def matcher(conn: db.LedgerConnection) -> Callable[[int, int], bool]:
    """`matches` for one read of many pairs. On first use it reads every trial row, then the captures and recorded table
    hashes of every trial that can be in a pair (an explore and the earlier anchors of its identity), a few batched reads
    in place of several per trial."""
    read: dict[str, dict] = {}

    def load() -> dict[str, dict]:
        if not read:
            rows = _trials(conn)
            paired = _pairable(rows)
            read.update(records={row["trial_id"]: row for row in rows}, captures=execution.read_captures(conn, paired),
                        tables=_recorded_tables_of(conn, paired))
        return read

    def capture(trial_id: int) -> Mapping:
        found = load()["captures"].get(trial_id)
        if found is None:
            return execution.read_capture(conn, trial_id)
        if isinstance(found, Refusal):
            raise found
        return found

    def recorded(trial_id: int) -> Mapping | None:
        tables = load()["tables"]
        return tables[trial_id] if trial_id in tables else _recorded_tables(conn, trial_id)

    return lambda reproduction_trial_id, original_trial_id: matches(
        conn, reproduction_trial_id, original_trial_id, record=lambda trial_id: load()["records"].get(trial_id),
        capture=capture, recorded=recorded)


def _pairable(rows: list[dict]) -> list[int]:
    """The trials `matches` can read a capture of: an explore with an earlier anchor of the same IDENTITY, and those
    anchors."""
    groups: dict[tuple, list[dict]] = {}
    for row in rows:
        # Equal values give equal keys; json of a date is its str.
        groups.setdefault(tuple(json.dumps(row[key], sort_keys=True, default=str) for key in IDENTITY), []).append(row)
    paired: set[int] = set()
    for group in groups.values():
        anchors = [row["trial_id"] for row in group if row["purpose"] in ANCHORS]
        for row in group:
            earlier = [trial_id for trial_id in anchors if trial_id < row["trial_id"]]
            if row["purpose"] == "explore" and earlier:
                paired.update(earlier, (row["trial_id"],))
    return sorted(paired)


def matches(conn: db.LedgerConnection, reproduction_trial_id: int, original_trial_id: int, *,
            record: Callable[[int], Mapping | None] | None = None,
            capture: Callable[[int], Mapping] | None = None,
            recorded: Callable[[int], Mapping | None] | None = None) -> bool:
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
            or original["purpose"] not in ANCHORS
            or any(current[key] != original[key] for key in IDENTITY)):
        return False
    try:
        captured = capture(reproduction_trial_id)
        anchor = capture(original_trial_id)
        fingerprint, anchored = fingerprint_hash(captured), fingerprint_hash(anchor)
        if not fingerprint or not anchored:
            return False
        config = config_key((captured.get("input_coverage") or {}).get("effective_config"))
        expected = config_key((anchor.get("input_coverage") or {}).get("effective_config"))
        if current["image_digest"] == original["image_digest"]:
            return fingerprint == anchored and config == expected
        hashes = captured.get("table_hashes")
        tables = (recorded or (lambda trial_id: _recorded_tables(conn, trial_id)))(original_trial_id)
        if not isinstance(hashes, Mapping) or not isinstance(tables, Mapping) or not shared_equal(config, expected):
            return False
        return (all(table in hashes and table in tables for table in RESULT_TABLES)
                and not set(differing_tables(hashes, tables)) & set(RESULT_TABLES))
    except Refusal as exc:
        if exc.code in ("EXECUTION_IDENTITY", "IDENTITY_MALFORMED"):
            return False
        raise
