"""Input coverage at ingest (`ledger.verify_coverage`, `ledger.original_coverage`).

Before a replay starts, its coverage receipt (input-coverage.json: export receipts, input
identity, effective configuration) is fixed and sealed with the execution. At ingest only the
receipt and native summary of the trial's original capture count: they must agree in format,
input interval, market commit and instrument set, and the lifecycle events rebuilt from them are
checked against the native counts. Coverage facts (gaps, zero-volume minutes) pass through and
never make a run invalid. Nothing here writes.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
import json

from ledger import db, execution
from ledger.refusals import refuse


FORMAT = "execution-input-coverage-v1"
SUMMARY = "reports/summary.json"
LIFECYCLE_COUNTS = ("instrument_close", "instrument_status")


def _instant(value):
    from ledger.metrics import utc_ns
    try:
        return utc_ns(value)
    except (TypeError, ValueError):
        return None


def _no_lifecycle(coverage: Mapping, summary: Mapping) -> tuple[dict, ...]:
    """engine.lifecycle_events for inputs without a lifecycle bundle: every native count must be zero.

    Seam: the engine package of a later phase replaces this (and builds events from a bundle).
    """
    seen, nonzero = set(), []
    for coin in summary.get("per_coin") or ():
        instrument = coin.get("instrument") if isinstance(coin, Mapping) else None
        counts = (coin.get("counts") or {}) if isinstance(coin, Mapping) else {}
        values = [counts.get(key, 0) for key in LIFECYCLE_COUNTS]
        if instrument in seen or any(not isinstance(value, int) or value < 0 for value in values):
            raise refuse("LIFECYCLE_NATIVE_COUNT_INVALID", f"the native lifecycle counts of {instrument} are not "
                                                           "nonnegative integers of one instance",
                         missing=(str(instrument),))
        seen.add(instrument)
        if any(values):
            nonzero.append(str(instrument))
    if (coverage.get("input_identity") or {}).get("lifecycle_bundle"):
        raise NotImplementedError("lifecycle events from a lifecycle bundle arrive with the engine package")
    if nonzero:
        raise refuse("LIFECYCLE_BUNDLE_MISSING", "instruments with native lifecycle events but no lifecycle bundle: "
                     + ", ".join(sorted(nonzero)), missing=tuple(sorted(nonzero)))
    return ()


# The engine's lifecycle check; replaced (not monkeypatched) when the engine package arrives.
lifecycle_events: Callable[[Mapping, Mapping], tuple[dict, ...]] = _no_lifecycle


def verify_coverage(coverage, summary, window: tuple[str, str] | None = None) -> tuple[dict, ...]:
    """The lifecycle events of a replay once its coverage receipt agrees with its native summary."""
    identity = coverage.get("input_identity") if isinstance(coverage, Mapping) else None
    symbols = identity.get("symbols") if isinstance(identity, Mapping) else None
    receipts = coverage.get("export_receipts") if isinstance(coverage, Mapping) else None
    if (not isinstance(coverage, Mapping) or coverage.get("format") != FORMAT or not isinstance(identity, Mapping)
            or not identity.get("market_commit") or not isinstance(symbols, list) or not symbols
            or not isinstance(receipts, Mapping)
            or any(not isinstance(receipts.get(symbol), Mapping) or receipts[symbol].get("status") == "missing"
                   or not receipts[symbol].get("instrument_id") for symbol in symbols)):
        raise refuse("COVERAGE_RECEIPT_INVALID", "the coverage receipt is not an execution-input-coverage-v1 "
                                                 "receipt with a market commit, instruments and a receipt for each",
                     expected=FORMAT)
    if not isinstance(summary, Mapping):
        raise refuse("COVERAGE_MISMATCH", "there is no native summary to check the coverage receipt against",
                     missing=("summary",))
    covered = {receipts[symbol]["instrument_id"] for symbol in symbols}
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
