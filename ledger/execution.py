"""Execution start receipts (`ledger.start_receipt`).

Before a replay's container starts, its trial row, binding and start receipt land in one commit:
every attempt has an identity before it has output. The receipt is the product-reserved bundle
trial-<trial_id>-execution-start. When the replay ends (completed, interrupted or a host failure),
`seal_capture` stores the bytes that exist in its working directory as trial-<trial_id>-execution,
each file captured, captured empty, missing or not started; the native reports of a sealed run are
only hashed (their bytes stay a working copy the ingest checks against). `read_capture` reads it
back with every identity and hash checked. A trial is sealed once: never again after a capture or
recovery material exists. A capture refused for size leaves no capture; bytes recovered from the
kept directory afterwards go to trial-<trial_id>-recovery (`recover_capture`) and never replace it.
"""

from __future__ import annotations

from collections.abc import Mapping
import hashlib
import json
from pathlib import Path
import re

from ledger import db, evidence, metrics
from ledger.refusals import refuse


FORMAT = "execution_start_v1"
MANIFEST = "execution.json"
SOURCE = "strategy.py"
COVERAGE = "input-coverage.json"
CAPTURE_FORMAT = "execution_capture_v1"
CAPTURED_SOURCE = "source/strategy.py"
RUNTIME_ERRORS = "reports/runtime_failures.jsonl"  # engine.execution_failure
FILE_STATUSES = ("captured", "captured_empty", "hashed", "missing", "not_started")
SHA256 = re.compile(r"[0-9a-f]{64}\Z")
IMAGE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:/-]*@sha256:[0-9a-f]{64}\Z")
DIGEST = re.compile(r"sha256:[0-9a-f]{64}\Z")
REVISION = re.compile(r"[0-9a-f]{40}\Z")
IDENTITY_FIELDS = ("image_ref", "image_digest", "platform", "runtime_contract")


def pinned_identity(value) -> dict | None:
    """The runtime identity's four fields (and build revision) when its image is pinned by digest.

    Seam: the shape part of runtime.validate_identity; the supported platform and contract sets
    stay with the runtime package of a later phase.
    """
    if not isinstance(value, Mapping):
        return None
    if any(not isinstance(value.get(field), str) or not value.get(field) for field in IDENTITY_FIELDS):
        return None
    if (not IMAGE.fullmatch(value["image_ref"]) or not DIGEST.fullmatch(value["image_digest"])
            or value["image_ref"].rsplit("@", 1)[1] != value["image_digest"]):
        return None
    identity = {field: value[field] for field in IDENTITY_FIELDS}
    if value.get("build_revision") is not None:
        if not isinstance(value["build_revision"], str) or not REVISION.fullmatch(value["build_revision"]):
            return None
        identity["build_revision"] = value["build_revision"]
    return identity


def start_receipt(conn: db.LedgerConnection, trial_id: int, context: Mapping, op_id: str) -> dict:
    """Write trial-<trial_id>-execution-start inside the caller's write; returns its manifest hash.

    `context`: source_sha256, runtime_identity, workdir, argv, mounts, input_identity,
    source_bytes and input_coverage (the coverage receipt bytes).
    """
    trial = conn.one("SELECT trial_id, purpose, source_sha256, image_ref FROM trial WHERE trial_id = %s", (trial_id,))
    if trial is None:
        raise refuse("TRIAL_NOT_FOUND", f"no trial {trial_id} in this transaction", missing=(str(trial_id),))
    source = context.get("source_bytes")
    identity = pinned_identity(context.get("runtime_identity"))
    coverage = context.get("input_coverage")
    if (context.get("source_sha256") != trial["source_sha256"] or not isinstance(source, bytes)
            or hashlib.sha256(source).hexdigest() != trial["source_sha256"]):
        raise refuse("EXECUTION_IDENTITY", "the source bytes or hash differ from the trial row",
                     missing=("source_sha256",))
    if identity is None or identity["image_ref"] != trial["image_ref"]:
        raise refuse("EXECUTION_IDENTITY", "the runtime identity is malformed or differs from the trial row",
                     missing=("runtime_identity",))
    if not isinstance(coverage, bytes) or not coverage:
        raise refuse("EXECUTION_IDENTITY", "the start context has no input coverage receipt",
                     missing=("input_coverage",))
    manifest = {"format": FORMAT, "trial_id": trial_id, "purpose": trial["purpose"],
                "source_sha256": trial["source_sha256"], "runtime_identity": identity,
                "workdir": context.get("workdir"), "argv": list(context.get("argv") or ()),
                "mounts": list(context.get("mounts") or ()), "input_identity": context.get("input_identity")}
    encoded = db.canonical_json(manifest).encode("utf-8")
    bundle = f"trial-{trial_id}-execution-start"
    evidence.write_files(conn, bundle, {MANIFEST: encoded, SOURCE: source, COVERAGE: coverage},
                         f"execution_start:{op_id}")
    return {"bundle": bundle, "path": MANIFEST, "sha256": hashlib.sha256(encoded).hexdigest()}


def _json(data: bytes):
    try:
        return json.loads(data.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        return None


def _bundle_rows(conn: db.LedgerConnection, bundle: str, clause: str) -> dict[str, bytes] | None:
    """Every file of a bundle with its hash recomputed (as ledger.load_bundle), or None without the bundle."""
    if not conn.rows(f"SELECT 1 FROM evidence_bundle{clause} WHERE bundle = %s", (bundle,)):
        return None
    files = {}
    for path, content, stored in conn.rows(f"SELECT path, content, sha256 FROM evidence{clause} WHERE bundle = %s "
                                           "ORDER BY path", (bundle,)):
        content = bytes(content)
        if hashlib.sha256(content).hexdigest() != stored:
            raise refuse("LEDGER_CORRUPT", f"stored file {bundle}/{path} differs from its content hash",
                         missing=(f"{bundle}/{path}",))
        files[path] = content
    return files


def _identity_matches(manifest: dict, trial: dict) -> bool:
    identity = pinned_identity(manifest.get("runtime_identity"))
    return (manifest.get("trial_id") == trial["trial_id"] and manifest.get("source_sha256") == trial["source_sha256"]
            and identity is not None and identity["image_ref"] == trial["image_ref"])


def read_capture(conn: db.LedgerConnection, trial_id: int, at: str | None = None) -> dict:
    """The original execution capture of a trial, every identity and file hash checked.

    Without a final capture: {status: missing, start, input_coverage, reason}; recovery bundles are
    never read. With one: {status: captured, purpose, stages, outcome, argv, files (captured bytes by
    path), statuses (status by path), listed (each manifest entry: status, sha256, length),
    runtime_failures, start, input_coverage}. `start` is the start receipt's execution.json,
    `input_coverage` its parsed input-coverage.json (None when it is not JSON) and
    `input_coverage_bytes` its bytes. Whether the capture makes the run unusable is not decided here.
    """
    _, clause = db.as_of(conn, at)
    trial = conn.one(f"SELECT trial_id, purpose, source_sha256, image_ref FROM trial{clause} WHERE trial_id = %s",
                     (trial_id,))
    if trial is None:
        raise refuse("TRIAL_NOT_FOUND", f"no trial {trial_id} on this ledger version", missing=(str(trial_id),))
    start_files = _bundle_rows(conn, f"trial-{trial_id}-execution-start", clause)
    start = _json(start_files[MANIFEST]) if start_files and MANIFEST in start_files else None
    if (not isinstance(start, dict) or start.get("format") != FORMAT or not _identity_matches(start, trial)
            or start.get("purpose") != trial["purpose"]):
        raise refuse("EXECUTION_IDENTITY", f"the start receipt of trial {trial_id} is missing or differs from the "
                                           "trial row", missing=(f"trial-{trial_id}-execution-start/{MANIFEST}",))
    coverage_bytes = start_files.get(COVERAGE)
    coverage = _json(coverage_bytes) if coverage_bytes is not None else None
    bundle = f"trial-{trial_id}-execution"
    files = _bundle_rows(conn, bundle, clause)
    if files is None or MANIFEST not in files:
        return {"status": "missing", "start": start, "input_coverage": coverage, "input_coverage_bytes": coverage_bytes,
                "reason": "the original final capture is missing; later probes cannot replace it"}
    manifest = _json(files.pop(MANIFEST))
    listed = manifest.get("files") if isinstance(manifest, dict) else None
    if (not isinstance(manifest, dict) or manifest.get("format") != CAPTURE_FORMAT
            or not _identity_matches(manifest, trial) or manifest.get("purpose") != start["purpose"]
            or not isinstance(listed, dict) or set(files) - set(listed)):
        raise refuse("EXECUTION_IDENTITY", f"the execution capture of trial {trial_id} differs from the trial row "
                                           "or holds files outside its manifest", missing=(f"{bundle}/{MANIFEST}",))
    captured, statuses = {}, {}
    for path, entry in sorted(listed.items()):
        status = entry.get("status") if isinstance(entry, dict) else None
        if status not in FILE_STATUSES:
            raise refuse("EXECUTION_IDENTITY", f"{bundle}/{path} has an unknown capture status",
                         missing=(f"{bundle}/{path}",))
        data = files.get(path)
        if status == "hashed" and (data is not None or not isinstance(entry.get("sha256"), str)
                                   or not SHA256.fullmatch(entry["sha256"])
                                   or not isinstance(entry.get("length"), int)):
            raise refuse("LEDGER_CORRUPT", f"{bundle}/{path} is recorded hashed but holds bytes or no hash",
                         missing=(f"{bundle}/{path}",))
        if status == "captured":
            if data is None or len(data) != entry.get("length") or hashlib.sha256(data).hexdigest() != entry.get(
                    "sha256"):
                raise refuse("LEDGER_CORRUPT", f"{bundle}/{path} differs from its manifest entry",
                             missing=(f"{bundle}/{path}",))
            captured[path] = data
        elif data is not None and status != "hashed":
            raise refuse("LEDGER_CORRUPT", f"{bundle}/{path} is recorded {status} but holds bytes",
                         missing=(f"{bundle}/{path}",))
        statuses[path] = status
    if CAPTURED_SOURCE in captured and hashlib.sha256(captured[CAPTURED_SOURCE]).hexdigest() != trial["source_sha256"]:
        raise refuse("EXECUTION_IDENTITY", f"the sealed source of trial {trial_id} is not the trial's source",
                     missing=(f"{bundle}/{CAPTURED_SOURCE}",))
    failures = []
    for line in captured.get(RUNTIME_ERRORS, b"").decode("utf-8", errors="replace").splitlines():
        if line.strip():
            parsed = _json(line.encode("utf-8"))
            failures.append(parsed if parsed is not None else {"unparsed": line})
    return {"status": "captured", "purpose": manifest["purpose"], "stages": manifest.get("stages"),
            "outcome": manifest.get("outcome"), "argv": manifest.get("argv"), "files": captured,
            "statuses": statuses, "listed": {path: dict(entry) for path, entry in listed.items()},
            "runtime_failures": failures, "start": start, "input_coverage": coverage,
            "input_coverage_bytes": coverage_bytes}


# Sealing (seal_capture) and recovery (recover_capture, recovery_material)

PROCESS = "process.json"
AUDIT_RESULT = "audit/audit.json"
FINGERPRINT_RESULT = "fingerprint/fingerprint.json"
CAPTURE_FILES = (PROCESS, "native.stdout.txt", "native.stderr.txt", "audit.stdout.txt", "audit.stderr.txt",
                 "fingerprint.stdout.txt", "fingerprint.stderr.txt", CAPTURED_SOURCE, COVERAGE, RUNTIME_ERRORS,
                 "reports/summary.json", AUDIT_RESULT, FINGERPRINT_RESULT)
AUDIT_FILES = frozenset({"audit.stdout.txt", "audit.stderr.txt", AUDIT_RESULT})
FINGERPRINT_FILES = frozenset({"fingerprint.stdout.txt", "fingerprint.stderr.txt", FINGERPRINT_RESULT})
STAGE_FILES = {"audit": AUDIT_FILES, "fingerprint": FINGERPRINT_FILES}
STAGES = ("native", "audit", "fingerprint")
# A sealed run's native reports stay a working copy: the capture records their hash and length only.
HASHED_REPORTS = tuple(f"reports/{name}" for name in metrics.REPORT_FILES.values())
# The reports engine.audit_main needs before the auditor runs (engine.write_native_reports writes them).
NATIVE_REPORTS = ("summary.json", "orders.csv", "fills.csv", "positions.csv", "account.csv", "returns_series.csv",
                  "order_events.jsonl.gz")
OUTCOMES = ("completed", "interrupted", "host_failure")
STATES = ("started", "exited")
NOT_AVAILABLE = "not_available"  # the image has no entry for the stage (today: the fingerprint)
CAPTURE_LIMIT = 32 * 1024 * 1024  # bytes of one capture; an uncalibrated example value
PRECHECK_CAPTURE_LIMIT = 512 * 1024 * 1024  # a precheck also keeps every report; an uncalibrated example value
RECOVERY_FORMAT = "execution_recovery_v1"
RECOVERY_MANIFEST = "recovery.json"
HOST_ERROR = "host-error.json"
RECOVERY_LIMITATION = ("Recovered from the kept working directory after the original capture was refused; it is not "
                       "the original capture and is no evidence")


def _stage_valid(value, required: bool, optional_entry: bool = False) -> bool:
    if value is None:
        return not required
    if not isinstance(value, Mapping):
        return False
    if optional_entry and value.get("state") == NOT_AVAILABLE:
        return value.get("exit_code") is None
    if value.get("state") not in STATES:
        return False
    code = value.get("exit_code")
    if value["state"] == "started":
        return code is None
    return isinstance(code, int) and not isinstance(code, bool)


def _stages_valid(stages) -> bool:
    return (isinstance(stages, Mapping) and not set(stages) - set(STAGES)
            and _stage_valid(stages.get("native"), True) and _stage_valid(stages.get("audit"), False)
            and _stage_valid(stages.get("fingerprint"), False, optional_entry=True))


def _stage_facts(stages: Mapping) -> dict:
    return {name: None if stages.get(name) is None else {"state": stages[name]["state"],
                                                         "exit_code": stages[name]["exit_code"]}
            for name in STAGES}


def _ran(stage) -> bool:
    return isinstance(stage, Mapping) and stage.get("state") in STATES


def _regular(path: Path) -> bytes | None:
    """The bytes of a regular file (never through a link), else None."""
    try:
        if path.is_symlink() or not path.is_file():
            return None
        return path.read_bytes()
    except OSError:
        return None


def _capture_files(workdir: Path, purpose: str, facts: Mapping) -> tuple[dict, dict[str, bytes]]:
    """(manifest entries, stored bytes) of what exists in the working directory, by the capture rule.

    A precheck stores every report; any other trial stores none and hashes the native reports.
    """
    names = list(CAPTURE_FILES)
    hashed = () if purpose == "precheck" else HASHED_REPORTS
    reports = workdir / "reports"
    if purpose == "precheck" and reports.is_dir() and not reports.is_symlink():
        for path in sorted(reports.rglob("*")):
            name = path.relative_to(workdir).as_posix()
            if name not in names and not path.is_dir():
                names.append(name)
    not_started = {name for stage, files in STAGE_FILES.items() if not _ran(facts.get(stage)) for name in files}
    listed, stored = {}, {}
    for name in [*names, *hashed]:
        if name in not_started:
            listed[name] = {"status": "not_started"}
            continue
        data = _regular(workdir / name)
        if data is None:
            listed[name] = {"status": "missing"}
        elif name in hashed:
            listed[name] = {"status": "hashed", "sha256": hashlib.sha256(data).hexdigest(), "length": len(data)}
        elif not data:
            listed[name] = {"status": "captured_empty"}
        else:
            listed[name] = {"status": "captured", "sha256": hashlib.sha256(data).hexdigest(), "length": len(data)}
            stored[name] = data
    return listed, stored


def _check_size(stored: dict[str, bytes], purpose: str, trial_id: int) -> None:
    limit = PRECHECK_CAPTURE_LIMIT if purpose == "precheck" else CAPTURE_LIMIT
    total = sum(len(data) for data in stored.values())
    largest = max((len(data) for data in stored.values()), default=0)
    if total > limit or largest > evidence.MAX_FILE_BYTES:
        raise refuse("EXECUTION_CAPTURE_LIMIT", f"the capture of trial {trial_id} holds {total} bytes (largest file "
                                                f"{largest}); the {purpose} limit is {limit} bytes and "
                                                f"{evidence.MAX_FILE_BYTES} per file", missing=(f"trial-{trial_id}",),
                     expected=f"at most {limit} bytes")


def _start_of(conn: db.LedgerConnection, trial_id: int) -> tuple[dict, dict, dict[str, bytes]]:
    trial = conn.one("SELECT trial_id, purpose, source_sha256, image_ref FROM trial WHERE trial_id = %s", (trial_id,))
    files = _bundle_rows(conn, f"trial-{trial_id}-execution-start", "") if trial else None
    start = _json(files[MANIFEST]) if files and MANIFEST in files else None
    if trial is None or not isinstance(start, dict):
        raise refuse("EXECUTION_START_MISSING", f"trial {trial_id} has no trial row or no start receipt",
                     missing=(f"trial-{trial_id}-execution-start",))
    return trial, start, files


def recovery_bundles(conn: db.LedgerConnection, trial_id: int) -> list[str]:
    """The trial-<trial_id>-recovery* bundles of a trial."""
    return [bundle for bundle, in conn.rows("SELECT bundle FROM evidence_bundle WHERE bundle = %s OR bundle LIKE %s "
                                            "ORDER BY bundle", (f"trial-{trial_id}-recovery",
                                                                f"trial-{trial_id}-recovery-%"))]


def _require_process(workdir: Path, trial_id: int, start: Mapping, facts: Mapping) -> None:
    """The stages must be the ones the entry's process record holds, its runner command the start argv."""
    process = _json(_regular(workdir / PROCESS) or b"")
    commands = process.get("commands") if isinstance(process, dict) else None
    recorded = process.get("stages") if isinstance(process, dict) else None
    argv = start.get("argv") if isinstance(start.get("argv"), list) else []
    ran = {name for name, stage in facts.items() if _ran(stage)}
    if (not isinstance(recorded, Mapping) or not _stages_valid(recorded) or _stage_facts(recorded) != dict(facts)
            or process.get("trial_id") != trial_id or not isinstance(commands, Mapping) or set(commands) != ran
            or any(not isinstance(command, list) or any(not isinstance(item, str) for item in command)
                   for command in commands.values())
            or not argv or list(commands.get("native", []))[-len(argv):] != argv):
        raise refuse("EXECUTION_IDENTITY", f"the stages or commands of trial {trial_id} differ from the process record "
                                           f"{workdir / PROCESS} or the start receipt's argv",
                     missing=(PROCESS,), expected="the stages the replay entry recorded and its start argv")


def _require_coverage(workdir: Path, trial_id: int, start: Mapping, start_files: Mapping) -> None:
    data = _regular(workdir / COVERAGE)
    parsed = _json(data) if data is not None else None
    if (data is None or data != start_files.get(COVERAGE) or not isinstance(parsed, dict)
            or parsed.get("input_identity") != start.get("input_identity")):
        raise refuse("COVERAGE_MISMATCH", f"the coverage receipt of trial {trial_id} in {workdir} is not the one its "
                                          "start receipt holds, or names other inputs", missing=(COVERAGE,))


def seal_capture(ledger: db.LedgerProfile, trial_id: int, workdir: Path, stages: Mapping, outcome: Mapping,
                 conn: db.LedgerConnection | None = None) -> dict:
    """Seal the bytes the working directory holds as trial-<trial_id>-execution, in one write.

    `stages` {native: {state, exit_code}, audit: same or None (did not run), fingerprint: same, None
    or {state: not_available} (the image has no entry)}, as the process record holds them;
    `outcome` {kind: completed | interrupted | host_failure, detail}. The same capture again is an
    idempotent replay; any other capture, or one after recovery material, is refused.
    """
    if conn is None:
        with db.connect(ledger, "writer") as own:
            return seal_capture(ledger, trial_id, workdir, stages, outcome, own)
    trial, start, start_files = _start_of(conn, trial_id)
    if not _stages_valid(stages) or not isinstance(outcome, Mapping) or outcome.get("kind") not in OUTCOMES:
        raise refuse("EXECUTION_IDENTITY", "the stages or outcome of the capture are malformed",
                     expected="stages {native, audit, fingerprint} of {state: started|exited, exit_code}; outcome "
                              "kind " + "|".join(OUTCOMES))
    bundle = f"trial-{trial_id}-execution"
    recovered = recovery_bundles(conn, trial_id)
    if recovered:
        raise refuse("BUNDLE_EXISTS", f"trial {trial_id} has recovery material {recovered[0]}; its capture stays "
                                      "missing", missing=(bundle,))
    workdir = Path(workdir)
    facts = _stage_facts(stages)
    _require_process(workdir, trial_id, start, facts)
    _require_coverage(workdir, trial_id, start, start_files)
    listed, stored = _capture_files(workdir, trial["purpose"], facts)
    _check_size(stored, trial["purpose"], trial_id)
    manifest = {"format": CAPTURE_FORMAT, "trial_id": trial_id, "purpose": trial["purpose"],
                "source_sha256": trial["source_sha256"], "runtime_identity": start.get("runtime_identity"),
                "argv": start.get("argv"), "stages": facts,
                "outcome": {"kind": outcome["kind"], "detail": outcome.get("detail")}, "files": listed}
    encoded = db.canonical_json(manifest).encode("utf-8")
    files = {**stored, MANIFEST: encoded}
    digests = evidence.digests(files)

    def insert(c, op):
        evidence.write_files(c, bundle, files, op)
        return {"bundle": bundle}

    def replay(c, row):
        if row["bundle"] != bundle or evidence._stored(c, bundle) != digests:
            raise refuse("BUNDLE_EXISTS", f"trial {trial_id} already has another execution capture", missing=(bundle,))
        return {"bundle": bundle}

    written = db.write(conn, "seal_capture", {"bundle": bundle, "files": digests}, "evidence_bundle", insert, replay,
                       op_id=f"execution:trial-{trial_id}")
    return {"bundle": bundle, "status": "captured", "files": {path: digests[path] for path in stored},
            "manifest_sha256": hashlib.sha256(encoded).hexdigest(), "ledger_commit": written["commit"],
            "replayed": written["replayed"]}


def _recovery_start(conn: db.LedgerConnection, trial_id: int, workdir: Path, receipt) -> tuple[dict, dict]:
    """(trial row, start receipt) of a trial whose original capture is missing and whose working
    directory and size refusal are the ones recorded; refuses otherwise."""
    capture = read_capture(conn, trial_id)
    trial = conn.one("SELECT trial_id, purpose, source_sha256 FROM trial WHERE trial_id = %s", (trial_id,))
    start = capture.get("start") or {}
    if capture["status"] != "missing":
        raise refuse("RECOVERY_NOT_APPLICABLE", f"trial {trial_id} has its original capture",
                     missing=(f"trial-{trial_id}-execution",))
    if not isinstance(start.get("workdir"), str) or Path(start["workdir"]).resolve() != workdir.resolve():
        raise refuse("RECOVERY_NOT_APPLICABLE", f"{workdir} is not the working directory the start receipt "
                                                "records", missing=("workdir",))
    if not isinstance(receipt, dict) or receipt.get("code") != "EXECUTION_CAPTURE_LIMIT":
        raise refuse("RECOVERY_INCOMPLETE", "the failure receipt is not the capture-limit refusal of this trial",
                     missing=(HOST_ERROR,))
    return trial, start


def recovery_material(conn: db.LedgerConnection, trial_id: int, workdir: Path, host_error: Mapping) -> dict:
    """The recovery material of a research or validation trial whose capture was refused for size:
    trial-<trial_id>-recovery holding a manifest (every file's status, hash and length, no report
    bytes) and the host error. `ledger.ingest_capture_refusal` writes it with the trial's invalid run."""
    workdir = Path(workdir)
    trial, start = _recovery_start(conn, trial_id, workdir, dict(host_error) if isinstance(host_error, Mapping)
                                   else None)
    process = _json(_regular(workdir / PROCESS) or b"")
    stages = process.get("stages") if isinstance(process, dict) else None
    facts = _stage_facts(stages) if _stages_valid(stages) else {name: None for name in STAGES}
    listed, stored = _capture_files(workdir, trial["purpose"], facts)
    for name, data in stored.items():  # the bytes stay in the kept directory; only their hashes are recovered
        listed[name] = {"status": "hashed", "sha256": hashlib.sha256(data).hexdigest(), "length": len(data)}
    receipt = db.canonical_json(dict(host_error)).encode("utf-8")
    manifest = {"format": RECOVERY_FORMAT, "trial_id": trial_id, "purpose": trial["purpose"],
                "source_sha256": trial["source_sha256"], "runtime_identity": start.get("runtime_identity"),
                "workdir": start["workdir"], "stages": facts, "files": listed, "host_error": dict(host_error),
                "limitation": RECOVERY_LIMITATION}
    return {"bundle": f"trial-{trial_id}-recovery",
            "files": {RECOVERY_MANIFEST: db.canonical_json(manifest).encode("utf-8"), HOST_ERROR: receipt}}


def recover_capture(ledger: db.LedgerProfile, trial_id: int, workdir: Path, failure_receipt: Path) -> dict:
    """Append bytes recovered from a kept precheck directory whose capture was refused for size.

    Written as trial-<trial_id>-recovery; the original capture stays missing and the recovery never
    makes the trial a passed precheck.
    """
    workdir = Path(workdir)
    with db.connect(ledger, "writer") as conn:
        receipt_bytes = _regular(Path(failure_receipt))
        receipt = _json(receipt_bytes or b"")
        trial = conn.one("SELECT trial_id, purpose FROM trial WHERE trial_id = %s", (trial_id,))
        if trial is not None and trial["purpose"] != "precheck":
            raise refuse("RECOVERY_NOT_APPLICABLE", f"trial {trial_id} is not a precheck; a sealed replay's size "
                                                    "refusal is stored with its invalid run",
                         missing=(f"trial-{trial_id}-execution",))
        trial, start = _recovery_start(conn, trial_id, workdir, receipt)
        if conn.rows("SELECT 1 FROM run WHERE trial_id = %s", (trial_id,)) or conn.rows(
                "SELECT 1 FROM registration_attempt WHERE trial_id = %s", (trial_id,)):
            raise refuse("RECOVERY_NOT_APPLICABLE", f"trial {trial_id} has a run or was consumed by a registration "
                                                    "attempt", missing=(str(trial_id),))
        process = _json(_regular(workdir / PROCESS) or b"")
        stages = process.get("stages") if isinstance(process, dict) else None
        if not _stages_valid(stages):
            raise refuse("RECOVERY_INCOMPLETE", f"{workdir / PROCESS} holds no valid stage facts", missing=(PROCESS,))
        facts = _stage_facts(stages)
        listed, stored = _capture_files(workdir, "precheck", facts)
        required = []
        if stages["native"].get("exit_code") == 0:
            required += [f"reports/{name}" for name in NATIVE_REPORTS]
        if _ran(facts["audit"]):
            required += sorted(AUDIT_FILES)
        absent = [name for name in required if (listed.get(name) or {}).get("status") not in ("captured",
                                                                                              "captured_empty")]
        if absent:
            raise refuse("RECOVERY_INCOMPLETE", "the kept directory lacks " + ", ".join(absent), missing=tuple(absent))
        if CAPTURED_SOURCE not in stored or hashlib.sha256(stored[CAPTURED_SOURCE]).hexdigest() != trial[
                "source_sha256"]:
            raise refuse("EXECUTION_IDENTITY", f"the recovered source of trial {trial_id} is not the trial's source",
                         missing=(CAPTURED_SOURCE,))
        manifest = {"format": RECOVERY_FORMAT, "trial_id": trial_id, "purpose": trial["purpose"],
                    "source_sha256": trial["source_sha256"], "runtime_identity": start.get("runtime_identity"),
                    "workdir": start["workdir"], "files": listed, "host_error": receipt,
                    "limitation": RECOVERY_LIMITATION}
        files = {**stored, RECOVERY_MANIFEST: db.canonical_json(manifest).encode("utf-8"), HOST_ERROR: receipt_bytes}
        bundle = f"trial-{trial_id}-recovery"
        digests = evidence.digests(files)

        def insert(c, op):
            evidence.write_files(c, bundle, files, op)
            return {"bundle": bundle}

        written = db.write(conn, "recover_capture", {"trial_id": trial_id, "files": digests}, "evidence_bundle", insert)
    return {"bundle": bundle, "trial_id": trial_id, "status": "recovered", "original_capture": "missing",
            "limitation": RECOVERY_LIMITATION, "ledger_commit": written["commit"]}
