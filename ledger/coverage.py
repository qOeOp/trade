"""Input coverage at ingest (`ledger.verify_coverage`, `ledger.original_coverage`).

Before a replay starts, its coverage receipt (input-coverage.json: export receipts, input
identity, effective configuration) is fixed and sealed with the execution. At ingest only the
receipt and native summary of the trial's original capture count: they must agree in format,
input interval, market commit and instrument set, and the lifecycle events rebuilt from them are
checked against the native counts. Coverage facts (gaps, zero-volume minutes) pass through and
never make a run invalid. Nothing here writes.
"""

from __future__ import annotations

from collections.abc import Mapping
import json

from ledger import db, execution
from ledger.refusals import refuse


FORMAT = "execution-input-coverage-v1"
SUMMARY = "reports/summary.json"


def _instant(value):
    from ledger.metrics import utc_ns
    try:
        return utc_ns(value)
    except (TypeError, ValueError):
        return None


LIFECYCLE_REFUSALS = ("LIFECYCLE_NATIVE_COUNT_INVALID", "LIFECYCLE_BUNDLE_MISSING", "LIFECYCLE_COVERAGE_MISMATCH",
                      "LIFECYCLE_COUNT_MISMATCH", "LIFECYCLE_EVENT_INVALID", "LIFECYCLE_DUPLICATE_EVENT")


def lifecycle_events(coverage: Mapping, summary: Mapping) -> tuple[dict, ...]:
    """engine.lifecycle_events, the same implementation the auditor runs, its refusals as ledger refusals."""
    from engine.config import Refusal as EngineRefusal
    from engine.load import lifecycle_events as engine_lifecycle_events
    try:
        return engine_lifecycle_events(dict(coverage), dict(summary))
    except EngineRefusal as exc:
        if exc.code not in LIFECYCLE_REFUSALS:
            raise
        raise refuse(exc.code, str(exc).split(": ", 1)[1]) from exc


def _instruments(receipt: Mapping) -> list[str]:
    """The native instrument IDs of a contract's export receipt: one per exported piece."""
    pieces = receipt.get("pieces")
    if not isinstance(pieces, list) or not pieces or any(
            not isinstance(piece, Mapping) or not isinstance(piece.get("instrument_id"), str) for piece in pieces):
        return []
    return [piece["instrument_id"] for piece in pieces]


def verify_coverage(coverage, summary, window: tuple[str, str] | None = None) -> tuple[dict, ...]:
    """The lifecycle events of a replay once its coverage receipt agrees with its native summary."""
    identity = coverage.get("input_identity") if isinstance(coverage, Mapping) else None
    symbols = identity.get("symbols") if isinstance(identity, Mapping) else None
    receipts = coverage.get("export_receipts") if isinstance(coverage, Mapping) else None
    if (not isinstance(coverage, Mapping) or coverage.get("format") != FORMAT or not isinstance(identity, Mapping)
            or not identity.get("market_commit") or not isinstance(symbols, list) or not symbols
            or not isinstance(receipts, Mapping)
            or any(not isinstance(receipts.get(symbol), Mapping) or receipts[symbol].get("status") == "missing"
                   or not _instruments(receipts[symbol]) for symbol in symbols)):
        raise refuse("COVERAGE_RECEIPT_INVALID", "the coverage receipt is not an execution-input-coverage-v1 "
                                                 "receipt with a market commit, instruments and a receipt for each",
                     expected=FORMAT)
    if not isinstance(summary, Mapping):
        raise refuse("COVERAGE_MISMATCH", "there is no native summary to check the coverage receipt against",
                     missing=("summary",))
    covered = {instrument for symbol in symbols for instrument in _instruments(receipts[symbol])}
    native = {coin.get("instrument") for coin in summary.get("per_coin") or () if isinstance(coin, Mapping)}
    config = coverage.get("effective_config") if isinstance(coverage.get("effective_config"), Mapping) else {}
    receipt_bounds = (_instant(config.get("start")), _instant(config.get("end")))
    summary_bounds = (_instant(summary.get("input_start_utc")), _instant(summary.get("period_end_utc")))
    conflicts = []
    if covered != native:
        conflicts.append("instruments")
    if summary.get("market_commit") != identity.get("market_commit"):
        conflicts.append("market_commit")
    if None in receipt_bounds or receipt_bounds != summary_bounds:
        conflicts.append("input_interval")
    if window is not None and tuple(_instant(value) for value in window) != receipt_bounds:
        conflicts.append("window")
    if conflicts:
        raise refuse("COVERAGE_MISMATCH", "the coverage receipt and the native summary differ in "
                     + ", ".join(conflicts), missing=tuple(conflicts))
    return tuple(lifecycle_events(coverage, summary))


def _json(data: bytes | None):
    try:
        return json.loads(data.decode("utf-8")) if data is not None else None
    except (UnicodeDecodeError, ValueError):
        return None


def original_coverage(conn: db.LedgerConnection, trial_id: int, input_identity: Mapping) -> tuple[dict, ...]:
    """Lifecycle events rebuilt only from the trial's original capture; any gap or mismatch refuses."""
    capture = execution.read_capture(conn, trial_id)
    stages = capture.get("stages") if isinstance(capture.get("stages"), Mapping) else {}
    files = capture.get("files") or {}
    if (capture["status"] != "captured" or not isinstance(capture.get("start"), Mapping)
            or not isinstance(stages.get("native"), Mapping) or SUMMARY not in files
            or execution.COVERAGE not in files):
        raise refuse("CAPTURE_INCOMPLETE", f"trial {trial_id} has no complete original capture (start receipt, "
                                           "stages, coverage receipt and native summary)",
                     missing=(f"trial-{trial_id}-execution",))
    for name in ("native", "audit"):
        stage = stages.get(name)
        if not isinstance(stage, Mapping) or stage.get("state") != "exited" or stage.get("exit_code") != 0:
            code = stage.get("exit_code") if isinstance(stage, Mapping) else None
            raise refuse("PHASE_FAILED", f"stage {name} of trial {trial_id} did not exit 0 (exit code {code})",
                         missing=(name,))
    coverage = _json(files[execution.COVERAGE])
    if (files[execution.COVERAGE] != capture.get("input_coverage_bytes") or not isinstance(coverage, Mapping)
            or coverage.get("input_identity") != capture["start"].get("input_identity")):
        raise refuse("COVERAGE_MISMATCH", f"the sealed coverage receipt of trial {trial_id} is not the one its start "
                                          "receipt holds", missing=(execution.COVERAGE,))
    if not isinstance(coverage, Mapping) or coverage.get("input_identity") != input_identity:
        raise refuse("INPUT_IDENTITY_MISMATCH", f"the sealed coverage receipt of trial {trial_id} names other "
                                                "inputs than the stored input identity", missing=("input_identity",))
    return verify_coverage(coverage, _json(files[SUMMARY]))
