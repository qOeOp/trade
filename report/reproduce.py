"""Cross-image engineering consistency (`report.compare_runs`): both runs are replayed by their own
identity through replay.reproduce, each directory handed over only when its semantic fingerprint
equals the recorded one, and the two native report sets go to engine.compare_reports. Read only;
the reproductions' own explore trials are the only ledger rows the replays write.
"""

from __future__ import annotations

from pathlib import Path
import shutil
import tempfile

from ledger import db, execution, metrics, paths
from ledger.refusals import refuse
from registration import comparability, register
from report import runs, seams


def _side(conn: db.LedgerConnection, run_id: int) -> dict:
    loaded = metrics.load_run(conn, run_id)  # UNKNOWN_RUN, EXECUTION_IDENTITY
    run, trial = loaded["run"], loaded["trial"]
    if run["status"] != "passed" or not loaded["sealed"]:
        raise refuse("RUN_INCOMPLETE", f"run {run_id} is not a passed run with a sealed result", missing=(str(run_id),))
    record = register.control_run(conn, run_id)
    start = loaded["capture"].get("start") or {}
    runtime = start.get("runtime_identity") or {}
    return {"run_id": run_id, "source_sha256": trial["source_sha256"], "image_ref": trial["image_ref"],
            "runtime_contract": runtime.get("runtime_contract"), "build_revision": runtime.get("build_revision"),
            "config_key": comparability.config_key(record["effective_config"]),
            "input_key": comparability.input_key(record["input_identity"])}


def compare_runs(profile, reference_run_id: int, candidate_run_id: int, at: str | None = None,
                 work_dir: Path | None = None) -> dict:
    """engine.compare_reports of two reproduced runs of the same source, inputs and configuration
    (the reference on its original image), with both identities and the ledger commit read."""
    if reference_run_id == candidate_run_id:
        raise refuse("SAME_RUN", "the reference and the candidate are the same run", missing=(str(reference_run_id),))
    profile = runs.profile_of(profile)
    with db.read_as_of(profile, at) as conn:
        commit = db.head_commit(conn)
        reference, candidate = _side(conn, reference_run_id), _side(conn, candidate_run_id)
    differs = [name for name in ("source_sha256", "input_key", "config_key") if reference[name] != candidate[name]]
    if differs:
        raise refuse("PAIR_INPUT_MISMATCH", "the two runs differ in " + ", ".join(differs), missing=tuple(differs))
    owned = work_dir is None
    if owned:
        root = Path(tempfile.mkdtemp(prefix=f"compare-runs-{reference_run_id}-{candidate_run_id}-"))
    else:
        root = paths.temporary_path(work_dir)
        root.mkdir(parents=True)
    try:
        directories = {}
        for name, side in (("reference", reference), ("candidate", candidate)):
            target = root / name
            seams.current.reproduce(side["run_id"], target, profile)  # REPRODUCTION_MISMATCH
            reports = target / "reports"
            absent = [report for report in execution.NATIVE_REPORTS if not (reports / report).is_file()]
            if absent:
                raise refuse("EXPORT_INCOMPLETE", f"the reproduction of run {side['run_id']} lacks " + ", ".join(absent),
                             missing=tuple(absent))
            directories[name] = reports
        compared = seams.current.compare_reports(directories["reference"], directories["candidate"])
    finally:
        if owned:
            shutil.rmtree(root, ignore_errors=True)
    identity = ("run_id", "image_ref", "runtime_contract", "build_revision")
    return {**compared, "reference": {key: reference[key] for key in identity},
            "candidate": {key: candidate[key] for key in identity}, "ledger_commit": commit}
