"""Reproducing a sealed run (`replay.reproduce`).

A sealed run's native reports are a cache: the ledger keeps the run's identity (source, pinned
image, market commit, instruments, window) and the semantic fingerprint its image computed. To read
native detail, the run is replayed by that identity into a new temporary directory and the
directory is handed over only when the fingerprint its own fingerprint stage sealed equals the
recorded one. A product update moves a run to a new image: replayed there, on a main build, it must
give the same RESULT_TABLES (`reproduction.matches`), and later replays use the newest image it reached. The replay writes one trial (purpose explore: the trial table has no reproduce
purpose) with its start receipt and execution capture; the directory itself is never stored.

`reseal` replaces a passed run's one reading (L10): from a reproduction whose every fingerprint table equals the
run's, the current metrics code computes the report again, and one `reseal:<op_id>` commit writes it with the
product commit that computed it. The run, its returns and its cycles are commitments and stay as they are.
"""

from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime
import hashlib
import json
from pathlib import Path

from ledger import db, execution, metrics, problems, strategies, trials
from shared import paths
from shared.refusals import refuse
from registration import inputs as registration_inputs, reproduction
from replay import entry


def _iso(moment: datetime) -> str:
    return moment.replace(tzinfo=None).isoformat() + "Z"


def runner_inputs(stored: Mapping, input_start: datetime, trade_start: datetime,
                  trade_end: datetime) -> tuple[dict, list[str], tuple[bool, bool, bool]]:
    """(recorded input identity, runner argv, (quotes, trades, metrics exported)) that replay a stored trial's
    capture (`stored`: its trial and capture) by its identity over another window."""
    start = stored["capture"]["start"]
    recorded = start.get("input_identity") if isinstance(start.get("input_identity"), Mapping) else {}
    selection = recorded["selection"]
    runner_argv = ["--start", _iso(input_start), "--trade-start", _iso(trade_start), "--end", _iso(trade_end),
                   *(["--symbols", *selection["symbols"]] if "symbols" in selection else [])]
    if recorded.get("lifecycle_bundle"):
        runner_argv += ["--lifecycle-bundle", recorded["lifecycle_bundle"]]
    coverage = stored["capture"].get("input_coverage") or {}
    account = trials.config_key(coverage.get("effective_config"))["account"]
    include_quotes = account.get("execution") == "quotes"
    # A receipt counts trades exactly when the run exported them (--trade-ticks).
    include_trades = any("trade" in piece.get("counts", {})
                         for receipt in coverage.get("export_receipts", {}).values()
                         for piece in receipt.get("pieces", []))
    # Likewise metrics (--metrics), which the runner is then given again.
    include_metrics = any("metrics" in piece.get("counts", {})
                          for receipt in coverage.get("export_receipts", {}).values()
                          for piece in receipt.get("pieces", []))
    if include_quotes:
        runner_argv += ["--execution", "quotes", "--initial-margin", account["initial_margin_rate"],
                        "--maintenance-margin", account["maintenance_margin_rate"]]
    if include_metrics:
        runner_argv.append("--metrics")
    runner_argv += ["--starting-balance", account["starting_balance_usdt"], "--leverage", account["default_leverage"]]
    return recorded, runner_argv, (include_quotes, include_trades, include_metrics)


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
            expected = stored["run"]["fingerprints"]
        trial = stored["trial"]
        found = conn.one("SELECT strategy_id, revision FROM candidate WHERE source_sha256 = %s",
                         (trial["source_sha256"],))
        if found is None:
            raise refuse("UNKNOWN_CANDIDATE", f"the source of run {trial_id} is no published candidate",
                         missing=(trial["source_sha256"],))
        revision = strategies.read_candidate(conn, f"{found['strategy_id']}@{found['revision']}")
        reached = reproduction.reproductions(conn, trial_id)
    window = {"start": metrics.moment_ns(trial["input_start"]), "trade_start": metrics.moment_ns(trial["trade_start"]),
              "end": metrics.moment_ns(trial["trade_end"])}
    recorded, runner_argv, flags = runner_inputs(stored, trial["input_start"], trial["trade_start"], trial["trade_end"])
    selection, effective = recorded["selection"], (stored["capture"].get("input_coverage") or {}).get("effective_config")
    include_quotes, include_trades, include_metrics = flags
    identity = entry._resolve(image or (reached[-1]["image_ref"] if reached else trial["image_ref"]))
    same_image = identity["image_digest"] == trial["image_digest"]
    if not same_image and original is not None and original["purpose"] == "precheck":
        raise refuse("REPRODUCTION_IMAGE_DIFFERS", f"precheck {trial_id} reproduces only on its own image",
                     missing=("image",))
    exported = None
    try:
        exported = registration_inputs.market_inputs(market, recorded.get("market_day"), window,
                                                     dict(selection), recorded.get("lifecycle_bundle"),
                                                     True, ledger, include_quotes=include_quotes,
                                                     include_trades=include_trades,
                                                     include_metrics=include_metrics)
        inspection = entry.registration_seams.current.inspect_runtime(identity, runner_argv, exported)
        config, recorded_config = (trials.config_key(value) for value in (inspection.get("effective_config"), effective))
        if config != recorded_config:
            raise refuse("REPRODUCTION_CONFIG_DIFFERS", f"the effective configuration of trial {trial_id} differs",
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
                                       coverage, window,
                                       entry._start_context(output, argv, revision["source"]))
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


def reseal(trial_id: int, output: Path, *, ledger: db.LedgerProfile, market, image: str | None = None) -> dict:
    """Reproduce a passed run into `output` (`reproduce`), require every fingerprint table to equal the run's, and
    replace its reading with the report the current metrics code (the product checkout's HEAD, as a replay seals it)
    computes from the reproduced files, in one `reseal:<op_id>` commit. A reading the current code computes alike is
    left as it is."""
    checkout = entry.registration_seams.current.checkout()
    metrics.product_commit(checkout)  # outside a checkout this raises before the reproduction's trial
    with db.connect(ledger, "writer") as conn:
        stored = metrics.load_run(conn, trial_id)
    if stored["run"]["status"] != "passed" or stored["sealed"] is None:
        raise refuse("RUN_NOT_PASSED", f"trial {trial_id} has no passed run with a reading to reseal",
                     missing=(str(trial_id),))
    done = reproduce(trial_id, output, ledger=ledger, market=market, image=image)
    if done["tables_differing"]:
        raise refuse("REPRODUCTION_MISMATCH", f"run {trial_id} reproduces on {done['image_ref']} with other "
                     f"{', '.join(done['tables_differing'])}; a reading is resealed only from native reports equal to "
                     f"every fingerprint table (trial {done['reproduction_trial_id']}); the directory is kept",
                     missing=tuple(done["tables_differing"]), write_status="written")
    reproduction_id = done["reproduction_trial_id"]
    with db.connect(ledger, "writer") as conn:
        files = trials._verified_files(execution.read_capture(conn, reproduction_id), reproduction_id,
                                       Path(done["directory"]))
        reasons, sealed = trials._sealed_report(conn, trial_id, files, stored["capture"]["start"]["input_identity"],
                                                checkout)
        if reasons:
            raise refuse("REPORT_UNREADABLE", f"the current metrics code cannot read the reproduction of run "
                         f"{trial_id}: " + "; ".join(item["message"] for item in reasons), missing=(str(trial_id),))
        revision, report = sealed[0], sealed[1]
        before = conn.one("SELECT report, product_commit FROM run_reading WHERE trial_id = %s", (trial_id,))
        previous = json.loads(before["report"]) if isinstance(before["report"], (str, bytes)) else before["report"]
        result = {"trial_id": trial_id, "reproduction_trial_id": reproduction_id, "directory": done["directory"],
                  "product_commit": revision, "previous_product_commit": before["product_commit"]}
        # compared as values: the stored JSON comes back as Dolt normalized it (1.0 as 1, for one)
        if revision == before["product_commit"] and json.loads(db.canonical_json(report)) == previous:
            return {**result, "resealed": False, "ledger_commit": None}
        payload = {"trial_id": trial_id, "product_commit": revision,
                   "report_sha256": hashlib.sha256(db.canonical_json(report).encode()).hexdigest()}

        def update(c, op_id):
            c.rows("UPDATE run_reading SET report = %s, product_commit = %s, op_id = %s WHERE trial_id = %s",
                   (db.canonical_json(report), revision, op_id, trial_id))
            return {"trial_id": trial_id}

        written = db.write(conn, "reseal", payload, "run_reading", update, attempts=db.WRITE_ATTEMPTS)
    return {**result, "resealed": True, "ledger_commit": written["commit"], "op_id": written["op_id"]}
