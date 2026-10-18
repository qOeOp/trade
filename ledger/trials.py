"""Trials (`ledger.open_trial`); storing a sealed run (`ingest_run`) is a later phase.

Every replay writes one trial row before its container starts: purpose, the executed source's
content hash, the pinned runtime image, instruments and windows. The row, the execution start
receipt and the registration binding (written by the injected binder, so the ledger never imports
registration code; it reads the row and the receipt it binds) land in one transaction and one
commit; any refusal rolls all of them back and no container may start. While a validation
registration is unbound, no other trial of its candidate may trade inside its window.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from datetime import datetime, timedelta
import hashlib

from ledger import db, execution, strategies
from ledger.refusals import refuse


PURPOSES = ("explore", "precheck", "research", "validation")
UNBOUND = ("explore", "precheck")
EPOCH = datetime(1970, 1, 1)
MINUTE_NS = 60 * 10**9
INPUT_FIELDS = ("market_commit", "universe_rule", "symbols", "export_content_sha256")
WINDOW_FIELDS = ("start", "trade_start", "end")

Binder = Callable[[db.LedgerConnection, int], None]


def _utc(ns: int) -> datetime:
    return EPOCH + timedelta(microseconds=ns // 1000)


def _require_unreserved(conn: db.LedgerConnection, source_sha256: str, trade_start: datetime,
                        trade_end: datetime) -> None:
    """Refuse a trial trading inside the window of an unbound validation registration of its source.
    Runs after the binder, so the registration a validation trial binds is no longer unbound."""
    reserved = conn.rows("SELECT v.registration_id FROM validation_registration v JOIN candidate c ON "
                         "c.strategy_id = v.strategy_id AND c.revision = v.revision WHERE c.source_sha256 = %s AND "
                         "v.window_start < %s AND %s < v.window_end AND NOT EXISTS (SELECT 1 FROM validation_binding "
                         "b WHERE b.registration_id = v.registration_id) ORDER BY v.registration_id",
                         (source_sha256, trade_end, trade_start))
    if reserved:
        raise refuse("OUT_OF_SAMPLE_RESERVED", f"the trading window overlaps the unbound validation registration "
                                               f"{reserved[0][0]} of this source", missing=(str(reserved[0][0]),))


def open_trial(conn: db.LedgerConnection, purpose: str, source_sha256: str, runtime_identity: Mapping,
               inputs: Mapping, window: Mapping, start_context: Mapping, binder: Binder | None = None) -> dict:
    """Write the trial row, its start receipt and its binding as one write; returns the trial ID.

    `runtime_identity`: image_ref, image_digest, platform, runtime_contract and `inspection`
    (the probe report). `inputs`: `identity` (market_commit, universe_rule, symbols,
    export_content_sha256, ...) and `input_coverage` (coverage receipt bytes). `window`: start,
    trade_start, end in UTC nanoseconds. `start_context`: argv, mounts, workdir, source_bytes.
    Inside the caller's write the trial joins it; otherwise this call commits it.
    """
    if purpose not in PURPOSES:
        raise ValueError(f"purpose must be one of {PURPOSES}")
    if purpose in UNBOUND and binder is not None:
        raise refuse("BINDING_NOT_ALLOWED", f"a {purpose} replay takes no registration binder")
    if purpose not in UNBOUND and binder is None:
        raise refuse("BINDING_REQUIRED", f"a {purpose} replay needs its registration binder", missing=("binder",))
    identity = execution.pinned_identity(runtime_identity)
    if identity is None or not isinstance(runtime_identity.get("inspection"), Mapping) \
            or not runtime_identity["inspection"]:
        raise refuse("RUNTIME_NOT_PINNED", "the runtime image must be pinned by digest and carry its probe inspection",
                     missing=("runtime_identity",))
    input_identity = inputs.get("identity") if isinstance(inputs, Mapping) else None
    missing = [f"inputs.identity.{field}" for field in INPUT_FIELDS
               if not isinstance(input_identity, Mapping) or not input_identity.get(field)]
    if not isinstance(inputs, Mapping) or not isinstance(inputs.get("input_coverage"), bytes) \
            or not inputs["input_coverage"]:
        missing.append("inputs.input_coverage")
    missing += [f"window.{field}" for field in WINDOW_FIELDS
                if not isinstance(window, Mapping) or not isinstance(window.get(field), int)]
    symbols = input_identity.get("symbols") if isinstance(input_identity, Mapping) else None
    if symbols and (not isinstance(symbols, list) or any(not isinstance(item, str) or not item for item in symbols)):
        missing.append("inputs.identity.symbols")
    if missing:
        raise refuse("TRIAL_INPUT_INCOMPLETE", "the input identity or window is incomplete", missing=tuple(missing))
    if not window["start"] <= window["trade_start"] < window["end"] or window["start"] % MINUTE_NS:
        raise refuse("WINDOW_INVALID", "the trial window must satisfy input_start <= trade_start < trade_end with "
                                       "input_start on a whole UTC minute",
                     expected="start <= trade_start < end, start % 60 s == 0")
    source = start_context.get("source_bytes")
    payload = {"purpose": purpose, "source_sha256": source_sha256, "image_ref": identity["image_ref"],
               "instruments": symbols, "window": {field: window[field] for field in WINDOW_FIELDS},
               "input_identity": input_identity,
               "start_context": {"argv": list(start_context.get("argv") or ()),
                                 "mounts": list(start_context.get("mounts") or ()),
                                 "workdir": start_context.get("workdir"),
                                 "source_bytes_sha256": hashlib.sha256(source).hexdigest()
                                 if isinstance(source, bytes) else None}}
    op = db.derive_op_id("trial", payload)

    def insert(c, op_id):
        if purpose != "explore":
            published = c.one("SELECT strategy_id, revision FROM candidate WHERE source_sha256 = %s", (source_sha256,))
            if published is None:
                raise refuse("SOURCE_NOT_PUBLISHED", f"source {source_sha256} is no published candidate",
                             missing=(str(source_sha256),))
            strategies.read_candidate(c, f"{published['strategy_id']}@{published['revision']}")
        c.rows("INSERT INTO trial (purpose, source_sha256, image_ref, instruments, input_start, trade_start, "
               "trade_end, op_id, created_at) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, UTC_TIMESTAMP(6))",
               (purpose, source_sha256, identity["image_ref"], db.canonical_json(symbols), _utc(window["start"]),
                _utc(window["trade_start"]), _utc(window["end"]), op_id))
        (trial_id,), = c.rows("SELECT LAST_INSERT_ID()")
        receipt = execution.start_receipt(c, trial_id, {
            "source_sha256": source_sha256, "runtime_identity": identity, "workdir": start_context.get("workdir"),
            "argv": start_context.get("argv"), "mounts": start_context.get("mounts"),
            "input_identity": input_identity, "source_bytes": source, "input_coverage": inputs["input_coverage"]},
            op_id)
        if binder is not None:
            binder(c, trial_id)
        _require_unreserved(c, source_sha256, _utc(window["trade_start"]), _utc(window["end"]))
        return {"trial_id": trial_id, "execution_bundle": receipt["bundle"]}

    def replay(c, row):
        return {"trial_id": row["trial_id"], "execution_bundle": f"trial-{row['trial_id']}-execution-start"}

    written = db.write(conn, "open_trial", payload, "trial", insert, replay, op_id=op)
    return {**written["record"], "replayed": written["replayed"], "ledger_commit": written["commit"]}
