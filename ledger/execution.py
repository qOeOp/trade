"""Execution start receipts (`ledger.start_receipt`).

Before a replay's container starts, its trial row, binding and start receipt land in one commit:
every attempt has an identity before it has output. The receipt is the product-reserved bundle
trial-<trial_id>-execution-start. When the replay ends (completed, interrupted or a host failure),
`seal_capture` stores the bytes that exist in its working directory as trial-<trial_id>-execution,
each file captured, captured empty, missing or not started; `read_capture` reads it back with
every identity and hash checked. A capture refused for size leaves no row; bytes recovered from the
kept directory afterwards go to trial-<trial_id>-recovery (`recover_capture`) and never replace it.
"""

from __future__ import annotations

from collections.abc import Mapping
import hashlib
import json
from pathlib import Path
import re

from ledger import db, evidence
from ledger.refusals import refuse


FORMAT = "execution_start_v1"
MANIFEST = "execution.json"
SOURCE = "strategy.py"
COVERAGE = "input-coverage.json"
CAPTURE_FORMAT = "execution_capture_v1"
CAPTURED_SOURCE = "source/strategy.py"
RUNTIME_ERRORS = "reports/runtime_failures.jsonl"  # engine.execution_failure
FILE_STATUSES = ("captured", "captured_empty", "missing", "not_started")
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
    path), statuses (status by path), runtime_failures, start, input_coverage}. `start` is the start
    receipt's execution.json and `input_coverage` its parsed input-coverage.json (None when it is not
    JSON). Whether the capture makes the run unusable is not decided here.
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
    coverage = _json(start_files[COVERAGE]) if COVERAGE in start_files else None
    bundle = f"trial-{trial_id}-execution"
    files = _bundle_rows(conn, bundle, clause)
    if files is None or MANIFEST not in files:
        return {"status": "missing", "start": start, "input_coverage": coverage,
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
        if status == "captured":
            if data is None or len(data) != entry.get("length") or hashlib.sha256(data).hexdigest() != entry.get(
                    "sha256"):
                raise refuse("LEDGER_CORRUPT", f"{bundle}/{path} differs from its manifest entry",
                             missing=(f"{bundle}/{path}",))
            captured[path] = data
        elif data is not None:
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
            "statuses": statuses, "runtime_failures": failures, "start": start, "input_coverage": coverage}


# Sealing (seal_capture) and recovery (recover_capture)

PROCESS = "process.json"
AUDIT_RESULT = "audit/audit.json"
CAPTURE_FILES = (PROCESS, "native.stdout.txt", "native.stderr.txt", "audit.stdout.txt", "audit.stderr.txt",
                 CAPTURED_SOURCE, COVERAGE, RUNTIME_ERRORS, "reports/summary.json", AUDIT_RESULT)
AUDIT_FILES = frozenset({"audit.stdout.txt", "audit.stderr.txt", AUDIT_RESULT})
# The reports engine.audit_main needs before the auditor runs (engine.write_native_reports writes them).
NATIVE_REPORTS = ("summary.json", "orders.csv", "fills.csv", "positions.csv", "account.csv", "returns_series.csv",
                  "order_events.jsonl.gz")
OUTCOMES = ("completed", "interrupted", "host_failure")
STATES = ("started", "exited")
CAPTURE_LIMIT = 32 * 1024 * 1024  # bytes of one capture; an uncalibrated example value
PRECHECK_CAPTURE_LIMIT = 512 * 1024 * 1024  # a precheck also keeps every report; an uncalibrated example value
RECOVERY_FORMAT = "execution_recovery_v1"
RECOVERY_MANIFEST = "recovery.json"
HOST_ERROR = "host-error.json"
RECOVERY_LIMITATION = ("Recovered from the kept working directory after the original capture was refused; it is not "
                       "the original capture and is no evidence")


def _stage_valid(value, required: bool) -> bool:
    if value is None:
        return not required
    if not isinstance(value, Mapping) or value.get("state") not in STATES:
        return False
    code = value.get("exit_code")
    if value["state"] == "started":
        return code is None
    return isinstance(code, int) and not isinstance(code, bool)


def _regular(path: Path) -> bytes | None:
    """The bytes of a regular file (never through a link), else None."""
    try:
        if path.is_symlink() or not path.is_file():
            return None
        return path.read_bytes()
    except OSError:
        return None


def _capture_files(workdir: Path, purpose: str, audit_ran: bool) -> tuple[dict, dict[str, bytes]]:
    """(manifest entries, stored bytes) of what exists in the working directory, by the capture rule."""
    names = list(CAPTURE_FILES)
    reports = workdir / "reports"
    if purpose == "precheck" and reports.is_dir() and not reports.is_symlink():
        for path in sorted(reports.rglob("*")):
            name = path.relative_to(workdir).as_posix()
            if name not in names and not path.is_dir():
                names.append(name)
    listed, stored = {}, {}
    for name in names:
        if not audit_ran and name in AUDIT_FILES:
            listed[name] = {"status": "not_started"}
            continue
        data = _regular(workdir / name)
        if data is None:
            listed[name] = {"status": "missing"}
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


def _start_of(conn: db.LedgerConnection, trial_id: int) -> tuple[dict, dict]:
    trial = conn.one("SELECT trial_id, purpose, source_sha256, image_ref FROM trial WHERE trial_id = %s", (trial_id,))
    files = _bundle_rows(conn, f"trial-{trial_id}-execution-start", "") if trial else None
    start = _json(files[MANIFEST]) if files and MANIFEST in files else None
    if trial is None or not isinstance(start, dict):
        raise refuse("EXECUTION_START_MISSING", f"trial {trial_id} has no trial row or no start receipt",
                     missing=(f"trial-{trial_id}-execution-start",))
    return trial, start


def seal_capture(ledger: db.LedgerProfile, trial_id: int, workdir: Path, stages: Mapping, outcome: Mapping,
                 conn: db.LedgerConnection | None = None) -> dict:
    """Seal the bytes the working directory holds as trial-<trial_id>-execution, in one write.

    `stages` {native: {state, exit_code}, audit: same or None (did not run)}; `outcome` {kind:
    completed | interrupted | host_failure, detail}. The same capture again is an idempotent replay.
    """
    if conn is None:
        with db.connect(ledger, "writer") as own:
            return seal_capture(ledger, trial_id, workdir, stages, outcome, own)
    trial, start = _start_of(conn, trial_id)
    if (not isinstance(stages, Mapping) or set(stages) - {"native", "audit"}
            or not _stage_valid(stages.get("native"), True) or not _stage_valid(stages.get("audit"), False)
            or not isinstance(outcome, Mapping) or outcome.get("kind") not in OUTCOMES):
        raise refuse("EXECUTION_IDENTITY", "the stages or outcome of the capture are malformed",
                     expected="stages {native, audit} of {state: started|exited, exit_code}; outcome kind "
                              + "|".join(OUTCOMES))
    workdir = Path(workdir)
    stage_facts = {name: None if stages.get(name) is None else {"state": stages[name]["state"],
                                                                "exit_code": stages[name]["exit_code"]}
                   for name in ("native", "audit")}
    listed, stored = _capture_files(workdir, trial["purpose"], stage_facts["audit"] is not None)
    _check_size(stored, trial["purpose"], trial_id)
    manifest = {"format": CAPTURE_FORMAT, "trial_id": trial_id, "purpose": trial["purpose"],
                "source_sha256": trial["source_sha256"], "runtime_identity": start.get("runtime_identity"),
                "argv": start.get("argv"), "stages": stage_facts,
                "outcome": {"kind": outcome["kind"], "detail": outcome.get("detail")}, "files": listed}
    encoded = db.canonical_json(manifest).encode("utf-8")
    bundle = f"trial-{trial_id}-execution"
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


def recover_capture(ledger: db.LedgerProfile, trial_id: int, workdir: Path, failure_receipt: Path) -> dict:
    """Append bytes recovered from a kept precheck directory whose capture was refused for size.

    Written as trial-<trial_id>-recovery; the original capture stays missing and the recovery never
    makes the trial a passed precheck.
    """
    workdir = Path(workdir)
    with db.connect(ledger, "writer") as conn:
        capture = read_capture(conn, trial_id)
        trial = conn.one("SELECT trial_id, purpose, source_sha256 FROM trial WHERE trial_id = %s", (trial_id,))
        start = capture.get("start") or {}
        if capture["status"] != "missing" or trial["purpose"] != "precheck":
            raise refuse("RECOVERY_NOT_APPLICABLE", f"trial {trial_id} is not a precheck whose original capture is "
                                                    "missing", missing=(f"trial-{trial_id}-execution",))
        if not isinstance(start.get("workdir"), str) or Path(start["workdir"]).resolve() != workdir.resolve():
            raise refuse("RECOVERY_NOT_APPLICABLE", f"{workdir} is not the working directory the start receipt "
                                                    "records", missing=("workdir",))
        if conn.rows("SELECT 1 FROM run WHERE trial_id = %s", (trial_id,)) or conn.rows(
                "SELECT 1 FROM registration_attempt WHERE trial_id = %s", (trial_id,)):
            raise refuse("RECOVERY_NOT_APPLICABLE", f"trial {trial_id} has a run or was consumed by a registration "
                                                    "attempt", missing=(str(trial_id),))
        process = _json(_regular(workdir / PROCESS) or b"")
        receipt_bytes = _regular(Path(failure_receipt))
        receipt = _json(receipt_bytes or b"")
        stages = process.get("stages") if isinstance(process, dict) else None
        if (not isinstance(stages, Mapping) or not _stage_valid(stages.get("native"), True)
                or not _stage_valid(stages.get("audit"), False)):
            raise refuse("RECOVERY_INCOMPLETE", f"{workdir / PROCESS} holds no valid stage facts", missing=(PROCESS,))
        if not isinstance(receipt, dict) or receipt.get("code") != "EXECUTION_CAPTURE_LIMIT":
            raise refuse("RECOVERY_INCOMPLETE", f"{failure_receipt} is not the capture-limit refusal of this trial",
                         missing=(str(failure_receipt),))
        audit_ran = stages.get("audit") is not None
        listed, stored = _capture_files(workdir, "precheck", audit_ran)
        required = []
        if stages["native"].get("exit_code") == 0:
            required += [f"reports/{name}" for name in NATIVE_REPORTS]
        if audit_ran:
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
