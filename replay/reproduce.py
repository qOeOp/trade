"""Reproducing a sealed run (`replay.reproduce`).

A sealed run's native reports are a cache: the ledger keeps the run's identity (source, pinned
image, market commit, instruments, window) and the semantic fingerprint its image computed. To read
native detail, the run is replayed by that identity into a new temporary directory and the
directory is handed over only when the fingerprint its own fingerprint stage sealed equals the
recorded one. A product update moves a run to a new image: replayed there, on a main build, it must
give the same RESULT_TABLES (`reproduction.matches`), and later replays use the newest image it reached. The replay writes one trial (purpose explore: the trial table has no reproduce
purpose) with its start receipt and execution capture; the directory itself is never stored.
"""

from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime
from pathlib import Path

from ledger import db, execution, metrics, paths, problems, strategies, trials
from ledger.refusals import refuse
from registration import comparability, inputs as registration_inputs, reproduction
from replay import entry


def _iso(moment: datetime) -> str:
    return moment.replace(tzinfo=None).isoformat() + "Z"


def reproduce(trial_id: int, output: Path, *, ledger: db.LedgerProfile, market, image: str | None = None) -> dict:
    """Replay a sealed run by its identity into `output` on `image` (default: the newest image it reached); refuse
    unless the results match."""
    output = paths.temporary_path(output)
    with db.connect(ledger, "writer") as conn:
        original = reproduction.trial_record(conn, trial_id)
        if original is not None and original["purpose"] == "precheck":
            captured = execution.read_capture(conn, trial_id)
            expected, _ = problems.capture_fingerprint(captured)
            stored = {"trial": original, "capture": captured}
        else:
            stored = metrics.load_run(conn, trial_id)
            expected = problems.stored_fingerprint(stored["run"]["fingerprints"])
        trial, start = stored["trial"], stored["capture"]["start"]
        found = conn.one("SELECT strategy_id, revision FROM candidate WHERE source_sha256 = %s",
                         (trial["source_sha256"],))
        if found is None:
            raise refuse("UNKNOWN_CANDIDATE", f"the source of run {trial_id} is no published candidate",
                         missing=(trial["source_sha256"],))
        revision = strategies.read_candidate(conn, f"{found['strategy_id']}@{found['revision']}")
        reached = reproduction.reproductions(conn, trial_id)
    recorded = start.get("input_identity") if isinstance(start.get("input_identity"), Mapping) else {}
    window = {"start": metrics.moment_ns(trial["input_start"]), "trade_start": metrics.moment_ns(trial["trade_start"]),
              "end": metrics.moment_ns(trial["trade_end"])}
    selection = recorded["selection"]
    runner_argv = ["--start", _iso(trial["input_start"]), "--trade-start", _iso(trial["trade_start"]), "--end",
                   _iso(trial["trade_end"]), *(["--symbols", *selection["symbols"]] if "symbols" in selection else [])]
    if recorded.get("lifecycle_bundle"):
        runner_argv += ["--lifecycle-bundle", recorded["lifecycle_bundle"]]
    coverage = stored["capture"].get("input_coverage") or {}
    effective = coverage.get("effective_config")
    account = comparability.config_key(effective)["account"]
    include_quotes = account.get("execution") == "quotes"
    # A receipt counts trades exactly when the run exported them (--trade-ticks).
    include_trades = any("trade" in piece.get("counts", {})
                         for receipt in coverage.get("export_receipts", {}).values()
                         for piece in receipt.get("pieces", []))
    # Likewise metrics (--metrics), which the runner is then given again.
    include_metrics = any("metrics" in piece.get("counts", {})
                          for receipt in coverage.get("export_receipts", {}).values()
                          for piece in receipt.get("pieces", []))
    if account.get("execution") == "quotes":
        runner_argv += ["--execution", "quotes", "--initial-margin", account["initial_margin_rate"],
                        "--maintenance-margin", account["maintenance_margin_rate"]]
    if include_metrics:
        runner_argv.append("--metrics")
    from engine.config import ACCOUNT_CONTRACT  # an image without --starting-balance ran on this default
    if account.get("starting_balance_usdt") != ACCOUNT_CONTRACT["starting_balance_usdt"]:
        runner_argv += ["--starting-balance", account["starting_balance_usdt"]]
    identity = entry._resolve(image or (reached[-1]["image_ref"] if reached else trial["image_ref"]))
    same_image = identity["image_digest"] == trial["image_digest"]
    if not same_image and original is not None and original["purpose"] == "precheck":
        raise refuse("REPRODUCTION_MISMATCH", f"precheck {trial_id} reproduces only on its own image",
                     missing=("image",))
    exported = None
    try:
        exported = registration_inputs.market_inputs(market, recorded.get("market_commit"), window,
                                                     dict(selection), recorded.get("lifecycle_bundle"),
                                                     True, ledger, include_quotes=include_quotes,
                                                     include_trades=include_trades,
                                                     include_metrics=include_metrics)
        inspection = entry.registration_seams.current.inspect_runtime(identity, runner_argv, exported)
        config, recorded_config = (comparability.config_key(value) for value in (inspection.get("effective_config"), effective))
        if not (config == recorded_config if same_image else reproduction.shared_equal(config, recorded_config)):
            raise refuse("REPRODUCTION_MISMATCH", f"the effective configuration of trial {trial_id} differs",
                         missing=("effective_config",))
        if not same_image:
            entry.registration_seams.current.require_main_build(dict(identity), dict(inspection))
        coverage = entry._prepare(output, revision["source"], inspection, exported)
        argv, mounts = entry._mounts(output, exported, runner_argv)
        argv += entry._strategy_argv(output, identity, inspection, revision["entry_class"],
                                     revision["source_sha256"])
        with db.connect(ledger, "writer") as conn:
            opened = trials.open_trial(conn, "explore", revision["source_sha256"],
                                       entry._trial_runtime(identity, inspection),
                                       {"identity": exported["identity"], "input_coverage": coverage}, window,
                                       entry._start_context(output, argv, mounts, revision["source"]))
        native_exit, audit_exit = entry.execute(ledger, opened["trial_id"], identity, mounts, output, argv, "explore",
                                                table_hashes=not same_image)
        with db.connect(ledger, "writer") as conn:
            trial_op = conn.one("SELECT op_id FROM trial WHERE trial_id = %s", (opened["trial_id"],))["op_id"]
            fingerprints, _ = problems.capture_fingerprint(execution.read_capture(conn, opened["trial_id"]),
                                                           execution.read_files(output, (execution.FINGERPRINT_RESULT,)))
            identical = reproduction.matches(conn, opened["trial_id"], trial_id)
    finally:
        entry._cleanup(exported)
    differing = reproduction.differing_tables({table: entry_.get("sha256") for table, entry_ in (fingerprints or {}).items()},
                                              expected or {})
    if expected is None or fingerprints is None or not identical or (same_image and fingerprints != expected):
        why = ("the run has no recorded semantic fingerprint" if expected is None else
               "the runtime image computed no semantic fingerprint" if fingerprints is None else
               f"the semantic fingerprints or sealed execution facts differ (tables: {', '.join(differing) or 'none'})")
        # The reproduction's own trial and capture were committed before this check.
        raise refuse("REPRODUCTION_MISMATCH", f"run {trial_id} is not reproduced in {output}: {why} (trial "
                                              f"{opened['trial_id']}, native exit {native_exit}, audit exit "
                                              f"{audit_exit}); the directory is kept", missing=("fingerprints",),
                     write_status="written", operation_id=trial_op)
    return {"directory": str(output), "trial_id": trial_id, "fingerprints_match": True,
            "reproduction_trial_id": opened["trial_id"], "image_ref": identity["image_ref"],
            "tables_differing": differing}
