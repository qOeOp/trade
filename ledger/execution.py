"""Execution starts and captures (`ledger.start_bundle`, `ledger.seal_capture`, `ledger.read_capture`).

Before a replay's container starts, its trial row (with the execution identity the coverage receipt
gives), its instruments and its start bundle trial-<trial_id>-start land in one commit: every attempt has
an identity before it has output. The start bundle holds the coverage receipt, and the source bytes
only when no candidate holds them. The working directory gets a marker naming the trial and its start
operation (`WORKDIR_MARKER`); a capture is sealed only from the directory that holds it. When the replay
ends (completed, interrupted or a host failure), `seal_capture` writes the stages and outcome
(trial_capture), each file's status (trial_file: captured, captured empty, hashed, missing or not started)
and the captured bytes (trial-<trial_id>-capture). The source and the coverage receipt are only hashed
(their bytes are the candidate's or the start bundle's), and so are a sealed run's native reports and
semantic fingerprint (their bytes stay a working copy the ingest checks against; the run row keeps the
fingerprint). `read_capture` reads it back with every hash checked; `precheck_rows` gives the table row
counts a complete precheck capture fingerprints. A trial is sealed once: never again after a capture or
recovery material exists. A capture refused for size leaves no capture; bytes recovered from the kept
directory afterwards go to trial-<trial_id>-recovery (`recover_capture`) and never replace it.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
import hashlib
import json
from pathlib import Path
import re
from typing import TypeGuard

from ledger import db, evidence, metrics, problems
from shared.errors import Refusal
from ledger.metrics import _regular
from shared.refusals import refuse


SOURCE = "strategy.py"
WORKDIR_MARKER = "trial.json"  # {trial_id, op_id} of the start write; outside every container mount
CAPTURED_SOURCE = "source/strategy.py"
FILE_STATUSES = ("captured", "captured_empty", "hashed", "missing", "not_started")
IMAGE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:/-]*@sha256:[0-9a-f]{64}\Z")
DIGEST = re.compile(r"sha256:[0-9a-f]{64}\Z")
REVISION = re.compile(r"[0-9a-f]{40}\Z")
IDENTITY_FIELDS = ("image_ref", "image_digest", "platform", "runtime_contract")
TRIAL_COLUMNS = ("trial_id, purpose, source_sha256, image_ref, runtime_contract, platform, build_revision, "
                 "runner_argv, op_id")


def pinned_identity(value) -> dict | None:
    """The runtime identity's four fields (and build revision) when its image is pinned by digest.

    The shape part of runtime.image.validate_identity (runtime imports the ledger, not the reverse);
    the supported platform and contract sets stay there.
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


def runtime_identity(trial: Mapping) -> dict:
    """The runtime identity a trial row records (the digest read from its image reference)."""
    identity = {"image_ref": trial["image_ref"], "image_digest": trial["image_ref"].rsplit("@", 1)[-1],
                "platform": trial["platform"], "runtime_contract": trial["runtime_contract"]}
    if trial.get("build_revision"):
        identity["build_revision"] = trial["build_revision"]
    return identity


def start_bundle(conn: db.LedgerConnection, trial_id: int, coverage: bytes, source: bytes) -> str:
    """Write trial-<trial_id>-start inside the caller's write: the coverage receipt, and the source bytes
    only when no candidate holds them (an exploration of an unpublished file)."""
    bundle = f"trial-{trial_id}-start"
    files = {problems.COVERAGE: coverage}
    if not conn.rows("SELECT 1 FROM candidate WHERE source_sha256 = %s", (hashlib.sha256(source).hexdigest(),)):
        files[SOURCE] = source
    evidence.write_files(conn, bundle, files, kind="start", trial_id=trial_id)
    return bundle


def write_marker(workdir: Path, trial_id: int, op_id: str) -> None:
    """Mark `workdir` as the working directory of trial `trial_id` (its start write `op_id`)."""
    (Path(workdir) / WORKDIR_MARKER).write_bytes(db.canonical_json({"trial_id": trial_id, "op_id": op_id}).encode())


def require_marker(workdir: Path, trial: Mapping) -> None:
    """Refuse EXECUTION_IDENTITY unless `workdir` holds the marker of this trial's start write."""
    marker = _json(_regular(Path(workdir) / WORKDIR_MARKER))
    if marker != {"trial_id": trial["trial_id"], "op_id": trial["op_id"]}:
        raise refuse("EXECUTION_IDENTITY", f"{workdir} is not the working directory trial {trial['trial_id']} started "
                                           "in", missing=(WORKDIR_MARKER,))


def _json(data: bytes | None):
    try:
        return json.loads(data.decode("utf-8")) if data is not None else None
    except (UnicodeDecodeError, ValueError):
        return None


BATCH = 500  # names in one IN list


def _marks(chunk: Sequence) -> str:
    return ", ".join(["%s"] * len(chunk))


def _bundles(conn: db.LedgerConnection, names: Sequence[str],
             paths: Sequence[str] | None = None) -> dict[str, dict[str, bytes] | Refusal]:
    """Every file of each named bundle (only those at `paths` when given) with its hash recomputed (as
    ledger.load_bundle), by bundle, in one read per BATCH names; a bundle that does not exist is absent, one holding
    a file that fails its hash maps to the refusal."""
    found: dict[str, dict[str, bytes] | Refusal] = {}
    only = "" if paths is None else f" AND e.path IN ({_marks(paths)})"
    for at in range(0, len(names), BATCH):
        chunk = tuple(names[at:at + BATCH])
        for bundle, in conn.rows(f"SELECT bundle FROM evidence_bundle WHERE bundle IN ({_marks(chunk)})", chunk):
            found[bundle] = {}
        for bundle, path, content, stored in conn.rows(f"SELECT e.bundle, e.path, c.content, e.sha256 FROM "
                                                       f"{evidence.FILES_FROM} WHERE e.bundle IN ({_marks(chunk)})"
                                                       f"{only} ORDER BY e.bundle, e.path",
                                                       (*chunk, *(paths or ()))):
            files = found.get(bundle)
            if not isinstance(files, dict):
                continue
            content = bytes(content)
            if hashlib.sha256(content).hexdigest() != stored:
                found[bundle] = refuse("LEDGER_CORRUPT", f"stored file {bundle}/{path} differs from its content hash",
                                       missing=(f"{bundle}/{path}",))
                continue
            files[path] = content
    return found


def _files(bundles: Mapping[str, dict[str, bytes] | Refusal], bundle: str) -> dict[str, bytes] | None:
    found = bundles.get(bundle)
    if isinstance(found, Refusal):
        raise found
    return None if found is None else dict(found)


@db.pinned_read
def read_capture(conn: db.LedgerConnection, trial_id: int) -> dict:
    """The original execution capture of a trial, every file hash checked.

    Always: `start` (the trial's start facts: purpose, runtime_identity, argv and the coverage receipt's
    input_identity), `input_coverage` (the parsed receipt, None when it is not JSON) and
    `input_coverage_bytes`. Without a capture: {status: missing, reason}; recovery bundles are never read.
    With one: {status: captured, purpose, stages, outcome, argv, files (captured bytes by path), statuses
    (status by path), listed (each file: status, sha256, length), runtime_failures, table_hashes}. A hashed
    file's bytes are elsewhere (`listed_sha256` gives the hash its readers check them against). Whether the
    capture makes the run unusable is not decided here.
    """
    found = read_captures(conn, (trial_id,))[trial_id]
    if isinstance(found, Refusal):
        raise found
    return found


# The captured files an availability reading and the derived measures read (the runtime failures and the audit
# result's native economics); with the start receipt, the only bytes a listing reads.
LISTING_FILES = (problems.RUNTIME_ERRORS, problems.AUDIT_RESULT)


def read_captures(conn: db.LedgerConnection, trial_ids: Iterable[int], *,
                  listing: bool = False) -> dict[int, dict | Refusal]:
    """read_capture of each trial, by trial ID, in one read of the rows and of the bundles per BATCH trials; a
    trial read_capture refuses maps to its refusal. A `listing` read reads the bytes of the start receipt and
    LISTING_FILES only: every other captured file is listed by its stored hash (no length) and absent from
    `files`."""
    ids = sorted(set(trial_ids))
    stored: dict[str, dict[str, str]] | None = None
    trials: dict[int, dict] = {}
    captures: dict[int, dict] = {}
    listed: dict[int, dict[str, dict]] = {}
    for at in range(0, len(ids), BATCH):
        chunk = tuple(ids[at:at + BATCH])
        for row in conn.dicts(f"SELECT {TRIAL_COLUMNS} FROM trial WHERE trial_id IN ({_marks(chunk)})", chunk):
            trials[row["trial_id"]] = row
        for row in conn.dicts(f"SELECT * FROM trial_capture WHERE trial_id IN ({_marks(chunk)})", chunk):
            captures[row["trial_id"]] = row
        for row in conn.dicts(f"SELECT * FROM trial_file WHERE trial_id IN ({_marks(chunk)}) ORDER BY trial_id, path",
                              chunk):
            listed.setdefault(row["trial_id"], {})[row["path"]] = row
    names = [f"trial-{trial_id}-{part}" for trial_id in ids for part in ("start", "capture")]
    read = (problems.COVERAGE, *LISTING_FILES)
    bundles = _bundles(conn, names, read if listing else None)
    if listing:
        stored = {}  # the files a listing does not read; one it reads is stored only with its bytes
        for at in range(0, len(names), BATCH):
            part = tuple(names[at:at + BATCH])
            for bundle, path, sha256 in conn.rows(f"SELECT bundle, path, sha256 FROM evidence WHERE bundle IN "
                                                  f"({_marks(part)}) AND path NOT IN ({_marks(read)})", (*part, *read)):
                stored.setdefault(bundle, {})[path] = sha256
    found: dict[int, dict | Refusal] = {}
    for trial_id in ids:
        try:
            found[trial_id] = _capture(trial_id, trials.get(trial_id), captures.get(trial_id),
                                       listed.get(trial_id, {}), bundles, stored)
        except Refusal as exc:
            found[trial_id] = exc
    return found


def _stages_of(row: Mapping) -> dict:
    return {name: None if row[f"{name}_state"] is None else {"state": row[f"{name}_state"],
                                                             "exit_code": row[f"{name}_exit_code"]}
            for name in STAGES}


def _capture(trial_id: int, trial: dict | None, row: dict | None, rows: Mapping[str, dict],
             bundles: Mapping[str, dict[str, bytes] | Refusal], stored: Mapping[str, dict[str, str]] | None) -> dict:
    if trial is None:
        raise refuse("TRIAL_NOT_FOUND", f"no trial {trial_id} on this ledger version", missing=(str(trial_id),))
    start_files = _files(bundles, f"trial-{trial_id}-start")
    if start_files is None or problems.COVERAGE not in start_files:
        raise refuse("EXECUTION_IDENTITY", f"the start bundle of trial {trial_id} is missing",
                     missing=(f"trial-{trial_id}-start/{problems.COVERAGE}",))
    coverage_bytes = start_files[problems.COVERAGE]
    coverage = _json(coverage_bytes)
    argv = json.loads(trial["runner_argv"]) if isinstance(trial["runner_argv"], (str, bytes)) else trial["runner_argv"]
    start = {"purpose": trial["purpose"], "runtime_identity": runtime_identity(trial), "argv": argv,
             "input_identity": coverage.get("input_identity") if isinstance(coverage, dict) else None}
    common = {"start": start, "input_coverage": coverage, "input_coverage_bytes": coverage_bytes}
    if row is None:
        return {"status": "missing", **common,
                "reason": "the original final capture is missing; later probes cannot replace it"}
    bundle = f"trial-{trial_id}-capture"
    files = _files(bundles, bundle) or {}
    hashes = {} if stored is None else stored.get(bundle, {})  # a listing read's files without their bytes
    if (set(files) | set(hashes)) - {path for path, entry in rows.items() if entry["status"] == "captured"}:
        raise refuse("LEDGER_CORRUPT", f"the capture of trial {trial_id} holds files it does not list as captured",
                     missing=(bundle,))
    captured, statuses, listed = {}, {}, {}
    for path, entry in sorted(rows.items()):
        status = entry["status"]
        if status == "captured":
            if path in files:
                captured[path] = files[path]
                listed[path] = {"status": status, "sha256": hashlib.sha256(files[path]).hexdigest(),
                                "length": len(files[path])}
            elif path in hashes:
                listed[path] = {"status": status, "sha256": hashes[path]}
            else:
                raise refuse("LEDGER_CORRUPT", f"{bundle}/{path} is listed captured but not stored",
                             missing=(f"{bundle}/{path}",))
        elif status == "hashed":
            listed[path] = {"status": status, "sha256": entry["sha256"], "length": entry["length"]}
        else:
            listed[path] = {"status": status}
        statuses[path] = status
    source = listed.get(CAPTURED_SOURCE)
    if source is not None and source["status"] != "missing" and (
            source["status"] != "hashed" or source["sha256"] != trial["source_sha256"]):
        raise refuse("EXECUTION_IDENTITY", f"the sealed source of trial {trial_id} is stored or is not the trial's "
                                           "source", missing=(f"{bundle}/{CAPTURED_SOURCE}",))
    failures = []
    for line in captured.get(problems.RUNTIME_ERRORS, b"").decode("utf-8", errors="replace").splitlines():
        if line.strip():
            parsed = _json(line.encode("utf-8"))
            failures.append(parsed if parsed is not None else {"unparsed": line})
    tables = row["table_hashes"]
    return {"status": "captured", "purpose": trial["purpose"], "stages": _stages_of(row),
            "outcome": {"kind": row["outcome_kind"], "detail": row["outcome_detail"]}, "argv": argv,
            "files": captured, "statuses": statuses, "listed": listed, "runtime_failures": failures,
            "table_hashes": json.loads(tables) if isinstance(tables, (str, bytes)) else tables, **common}


def precheck_rows(conn: db.LedgerConnection, trial_id: int) -> dict[str, int] | None:
    """{table: rows} the complete sealed capture of a precheck fingerprints (`ledger.sealed_rows`); None
    when the capture is missing, malformed, incomplete or not a precheck's."""
    try:
        capture = read_capture(conn, trial_id)
    except Refusal as exc:
        if exc.code == "EXECUTION_IDENTITY":
            return None
        raise
    return problems.sealed_rows(capture) if capture.get("purpose") == "precheck" else None


def listed_sha256(capture: Mapping, path: str) -> str | None:
    """The SHA-256 a read capture records for one file it hashed, else None."""
    entry = (capture.get("listed") or {}).get(path)
    if isinstance(entry, Mapping) and entry.get("status") == "hashed":
        return entry.get("sha256")
    return None


def read_files(workdir: Path, paths) -> dict[str, bytes]:
    """The regular files of `paths` under `workdir` (never through a link); a missing one is left out.
    A reader checks them against the capture's hashes (problems.sealed)."""
    return {path: data for path in paths if (data := _regular(Path(workdir) / path)) is not None}


# Sealing (seal_capture) and recovery (recover_capture, recovery_material)

PROCESS = "process.json"  # the replay entry's record of stages and commands; checked, not stored
CAPTURE_FILES = ("native.stdout.txt", "native.stderr.txt", "audit.stdout.txt", "audit.stderr.txt",
                 "fingerprint.stdout.txt", "fingerprint.stderr.txt", problems.RUNTIME_ERRORS, problems.SUMMARY,
                 problems.AUDIT_RESULT, problems.FINGERPRINT_RESULT)
# Stored once elsewhere, so every capture records only their hash and length: the source (the candidate,
# or the start receipt of an unpublished exploration) and the coverage receipt (the start receipt).
HASHED_INPUTS = (CAPTURED_SOURCE, problems.COVERAGE)
AUDIT_FILES = frozenset({"audit.stdout.txt", "audit.stderr.txt", problems.AUDIT_RESULT})
FINGERPRINT_FILES = frozenset({"fingerprint.stdout.txt", "fingerprint.stderr.txt", problems.FINGERPRINT_RESULT})
STAGE_FILES = {"audit": AUDIT_FILES, "fingerprint": FINGERPRINT_FILES}
STAGES = ("native", "audit", "fingerprint")
# Formal reports and reports of a clean, reproducible precheck stay a working copy. A precheck's
# fingerprint is kept in its capture (it has no run row); formal fingerprints live in the run row.
REPORT_OUTPUTS = tuple(f"reports/{name}" for name in metrics.REPORT_FILES.values())
HASHED_OUTPUTS = (*REPORT_OUTPUTS, problems.FINGERPRINT_RESULT)
# The reports engine.audit_main needs before the auditor runs (engine.write_native_reports writes them).
NATIVE_REPORTS = ("summary.json", "orders.csv", "fills.csv", "positions.csv", "account.csv", "returns_series.csv",
                  "order_events.jsonl.gz")
OUTCOMES = ("completed", "interrupted", "host_failure")
STATES = ("started", "exited")
CAPTURE_LIMIT = 32 * 1024 * 1024  # bytes of one capture; an uncalibrated example value
PRECHECK_CAPTURE_LIMIT = 512 * 1024 * 1024  # failed/nonreproducible prechecks retain originals; unchanged limit
RECOVERY_MANIFEST = "recovery.json"
HOST_ERROR = "host-error.json"
RECOVERY_LIMITATION = ("Recovered from the kept working directory after the original capture was refused; it is not "
                       "the original capture and is no evidence")


def _stage_valid(value, required: bool) -> bool:
    if value is None:
        return not required
    if not isinstance(value, Mapping):
        return False
    if value.get("state") not in STATES:
        return False
    code = value.get("exit_code")
    if value["state"] == "started":
        return code is None
    return isinstance(code, int) and not isinstance(code, bool)


def _stages_valid(stages: object) -> TypeGuard[Mapping]:
    return (isinstance(stages, Mapping) and not set(stages) - set(STAGES)
            and _stage_valid(stages.get("native"), True) and _stage_valid(stages.get("audit"), False)
            and _stage_valid(stages.get("fingerprint"), False))


def _stage_facts(stages: Mapping) -> dict:
    return {name: None if stages.get(name) is None else {"state": stages[name]["state"],
                                                         "exit_code": stages[name]["exit_code"]}
            for name in STAGES}


def _ran(stage) -> bool:
    return isinstance(stage, Mapping) and stage.get("state") in STATES


def _capture_files(workdir: Path, purpose: str, facts: Mapping,
                   outcome: Mapping | None = None) -> tuple[dict, dict[str, bytes]]:
    """(manifest entries, stored bytes) of what exists in the working directory, by the capture rule.

    A clean precheck with a completed fingerprint hashes its regenerable native tables, retaining
    its summary, audit and fingerprint once. Failed, interrupted or nonreproducible prechecks keep
    their original reports. This storage choice does not change precheck admission requirements.
    """
    names = list(CAPTURE_FILES)
    audit = _json(_regular(workdir / problems.AUDIT_RESULT) or b"")
    cacheable = (purpose == "precheck" and (outcome or {}).get("kind") == "completed"
                 and all(isinstance(facts.get(stage), Mapping) and facts[stage].get("state") == "exited"
                         and facts[stage].get("exit_code") == 0 for stage in STAGES)
                 and isinstance(_json(_regular(workdir / problems.FINGERPRINT_RESULT) or b""), dict)
                 and isinstance(audit, dict) and audit.get("passed") is True
                 and not (_regular(workdir / problems.RUNTIME_ERRORS) or b"").strip())
    hashed = HASHED_INPUTS + (REPORT_OUTPUTS if cacheable
                             else () if purpose == "precheck" else HASHED_OUTPUTS)
    reports = workdir / "reports"
    if purpose == "precheck" and reports.is_dir() and not reports.is_symlink():
        for path in sorted(reports.rglob("*")):
            name = path.relative_to(workdir).as_posix()
            if name not in names and not path.is_dir():
                names.append(name)
    not_started = {name for stage, files in STAGE_FILES.items() if not _ran(facts.get(stage)) for name in files}
    listed: dict[str, dict[str, str | int]] = {}
    stored: dict[str, bytes] = {}
    for name in dict.fromkeys([*names, *hashed]):
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


def _start_of(conn: db.LedgerConnection, trial_id: int) -> tuple[dict, bytes]:
    """(trial row, coverage receipt bytes of its start bundle)."""
    trial = conn.one(f"SELECT {TRIAL_COLUMNS} FROM trial WHERE trial_id = %s", (trial_id,))
    files = _files(_bundles(conn, (f"trial-{trial_id}-start",)), f"trial-{trial_id}-start") if trial else None
    if trial is None or files is None or problems.COVERAGE not in files:
        raise refuse("EXECUTION_START_MISSING", f"trial {trial_id} has no trial row or no start bundle",
                     missing=(f"trial-{trial_id}-start",))
    trial["runner_argv"] = json.loads(trial["runner_argv"]) if isinstance(trial["runner_argv"], (str, bytes)) \
        else trial["runner_argv"]
    return trial, files[problems.COVERAGE]


def recovery_bundles(conn: db.LedgerConnection, trial_id: int) -> list[str]:
    """The recovery bundles of a trial."""
    return [bundle for bundle, in conn.rows("SELECT bundle FROM evidence_bundle WHERE kind = 'recovery' AND "
                                            "trial_id = %s ORDER BY bundle", (trial_id,))]


def _require_process(workdir: Path, trial_id: int, argv: list, facts: Mapping) -> None:
    """The stages must be the ones the entry's process record holds, its runner command the trial's argv."""
    process = _json(_regular(workdir / PROCESS) or b"")
    commands = process.get("commands") if isinstance(process, dict) else None
    recorded = process.get("stages") if isinstance(process, dict) else None
    argv = argv if isinstance(argv, list) else []
    ran = {name for name, stage in facts.items() if _ran(stage)}
    if (not isinstance(recorded, Mapping) or not _stages_valid(recorded) or _stage_facts(recorded) != dict(facts)
            or process.get("trial_id") != trial_id or not isinstance(commands, Mapping) or set(commands) != ran
            or any(not isinstance(command, list) or any(not isinstance(item, str) for item in command)
                   for command in commands.values())
            or not argv or list(commands.get("native", []))[-len(argv):] != argv):
        raise refuse("EXECUTION_IDENTITY", f"the stages or commands of trial {trial_id} differ from the process record "
                                           f"{workdir / PROCESS} or the trial's runner argv",
                     missing=(PROCESS,), expected="the stages the replay entry recorded and the trial's runner argv")


def _require_coverage(workdir: Path, trial_id: int, coverage: bytes) -> None:
    if _regular(workdir / problems.COVERAGE) != coverage:
        raise refuse("COVERAGE_MISMATCH", f"the coverage receipt of trial {trial_id} in {workdir} is not the one its "
                                          "start bundle holds", missing=(problems.COVERAGE,))


def _table_hashes(workdir: Path) -> dict[str, str] | None:
    """{table: semantic hash} of the fingerprint in the working directory, None without one."""
    tables = _json(_regular(workdir / problems.FINGERPRINT_RESULT) or b"")
    if not isinstance(tables, dict):
        return None
    return {table: entry["sha256"] for table, entry in tables.items()
            if isinstance(entry, Mapping) and isinstance(entry.get("sha256"), str)}


def _capture_rows(trial_id: int, listed: Mapping[str, Mapping]) -> list[tuple]:
    """trial_file rows: a hashed file keeps its hash and length; a captured file's are its stored bytes'."""
    return [(trial_id, path, entry["status"], entry.get("sha256") if entry["status"] == "hashed" else None,
             entry.get("length") if entry["status"] == "hashed" else None) for path, entry in sorted(listed.items())]


def seal_capture(ledger: db.LedgerProfile, trial_id: int, workdir: Path, stages: Mapping, outcome: Mapping,
                 conn: db.LedgerConnection | None = None, *, table_hashes: bool = False) -> dict:
    """Seal the stages, outcome and files the working directory holds, in one write.

    `stages` {native: {state, exit_code}, audit and fingerprint: same or None (did not run)}, as the
    process record holds them;
    `outcome` {kind: completed | interrupted | host_failure, detail}. The same capture again is an
    idempotent replay; any other capture, or one after recovery material, is refused. `table_hashes`
    (a reproduction on another image) keeps each table's semantic hash: the capture otherwise holds only
    the fingerprint file's hash, which cannot agree across images.
    """
    if conn is None:
        with db.connect(ledger, "writer") as own:
            return seal_capture(ledger, trial_id, workdir, stages, outcome, own, table_hashes=table_hashes)
    trial, coverage = _start_of(conn, trial_id)
    if not _stages_valid(stages) or not isinstance(outcome, Mapping) or outcome.get("kind") not in OUTCOMES:
        raise refuse("EXECUTION_IDENTITY", "the stages or outcome of the capture are malformed",
                     expected="stages {native, audit, fingerprint} of {state: started|exited, exit_code}; outcome "
                              "kind " + "|".join(OUTCOMES))
    bundle = f"trial-{trial_id}-capture"
    recovered = recovery_bundles(conn, trial_id)
    if recovered:
        raise refuse("BUNDLE_EXISTS", f"trial {trial_id} has recovery material {recovered[0]}; its capture stays "
                                      "missing", missing=(bundle,))
    workdir = Path(workdir)
    require_marker(workdir, trial)
    facts = _stage_facts(stages)
    _require_process(workdir, trial_id, trial["runner_argv"], facts)
    _require_coverage(workdir, trial_id, coverage)
    listed, stored = _capture_files(workdir, trial["purpose"], facts, outcome)
    _check_size(stored, trial["purpose"], trial_id)
    detail = outcome.get("detail")
    hashes = _table_hashes(workdir) if table_hashes else None
    head = (trial_id, *(value for name in STAGES for value in (
        (facts[name] or {}).get("state"), (facts[name] or {}).get("exit_code"))),
        outcome["kind"], None if detail is None else str(detail),
        db.canonical_json(hashes) if hashes is not None else None)
    rows = _capture_rows(trial_id, listed)
    digests = evidence.digests(stored)

    def insert(c, op):
        c.rows("INSERT INTO trial_capture (trial_id, native_state, native_exit_code, audit_state, audit_exit_code, "
               "fingerprint_state, fingerprint_exit_code, outcome_kind, outcome_detail, table_hashes, op_id) "
               "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)", (*head, op))
        c.many("INSERT INTO trial_file (trial_id, path, status, sha256, length) VALUES (%s, %s, %s, %s, %s)", rows)
        if stored:
            evidence.write_files(c, bundle, stored, kind="capture", trial_id=trial_id)
        return {"bundle": bundle}

    def replay(c, row):
        stored_head = (row["trial_id"], *(row[f"{name}_{part}"] for name in STAGES for part in ("state", "exit_code")),
                       row["outcome_kind"], row["outcome_detail"])
        same = (stored_head == head[:-1] and c.rows("SELECT trial_id, path, status, sha256, length FROM trial_file WHERE trial_id = %s ORDER BY "
                       "path", (trial_id,)) == [tuple(item) for item in rows]
                and (evidence._stored(c, bundle) or {}) == digests)
        if not same:
            raise refuse("BUNDLE_EXISTS", f"trial {trial_id} already has another execution capture", missing=(bundle,))
        return {"bundle": bundle}

    written = db.write(conn, "seal_capture", {"trial_id": trial_id, "files": rows, "stored": digests},
                       "trial_capture", insert, replay, op_id=f"execution:trial-{trial_id}",
                       attempts=db.WRITE_ATTEMPTS)
    return {"bundle": bundle, "status": "captured", "files": {path: digests[path] for path in stored},
            "ledger_commit": written["commit"], "replayed": written["replayed"]}


def _recovery_start(conn: db.LedgerConnection, trial_id: int, workdir: Path, receipt) -> dict:
    """The trial row of a trial whose original capture is missing and whose working directory and size
    refusal are the ones recorded; refuses otherwise."""
    capture = read_capture(conn, trial_id)
    if capture["status"] != "missing":
        raise refuse("RECOVERY_NOT_APPLICABLE", f"trial {trial_id} has its original capture",
                     missing=(f"trial-{trial_id}-capture",))
    trial, _ = _start_of(conn, trial_id)
    try:
        require_marker(workdir, trial)
    except Refusal as exc:
        raise refuse("RECOVERY_NOT_APPLICABLE", f"{workdir} is not the working directory trial {trial_id} started in",
                     missing=(WORKDIR_MARKER,)) from exc
    if not isinstance(receipt, dict) or receipt.get("code") != "EXECUTION_CAPTURE_LIMIT":
        raise refuse("RECOVERY_INCOMPLETE", "the failure receipt is not the capture-limit refusal of this trial",
                     missing=(HOST_ERROR,))
    return trial


def recovery_material(conn: db.LedgerConnection, trial_id: int, workdir: Path, host_error: Mapping) -> dict:
    """The recovery material of a research or validation trial whose capture was refused for size:
    trial-<trial_id>-recovery holding a manifest (every file's status, hash and length, no report
    bytes) and the host error. `ledger.ingest_capture_refusal` writes it with the trial's invalid run."""
    workdir = Path(workdir)
    trial = _recovery_start(conn, trial_id, workdir, dict(host_error) if isinstance(host_error, Mapping) else None)
    process = _json(_regular(workdir / PROCESS) or b"")
    stages = process.get("stages") if isinstance(process, dict) else None
    facts = _stage_facts(stages) if _stages_valid(stages) else {name: None for name in STAGES}
    listed, stored = _capture_files(workdir, trial["purpose"], facts)
    for name, data in stored.items():  # the bytes stay in the kept directory; only their hashes are recovered
        listed[name] = {"status": "hashed", "sha256": hashlib.sha256(data).hexdigest(), "length": len(data)}
    receipt = db.canonical_json(dict(host_error)).encode("utf-8")
    manifest = {"stages": facts, "files": listed, "host_error": dict(host_error), "limitation": RECOVERY_LIMITATION}
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
                         missing=(str(trial_id),))
        trial = _recovery_start(conn, trial_id, workdir, receipt)
        assert receipt_bytes is not None  # _recovery_start refused a receipt that is not a JSON object
        if conn.rows("SELECT 1 FROM run WHERE trial_id = %s", (trial_id,)) or conn.rows(
                "SELECT 1 FROM registration_grid_point g JOIN source_review r ON r.review_id = g.source_review_id "
                "WHERE r.trial_id = %s", (trial_id,)):
            raise refuse("RECOVERY_NOT_APPLICABLE", f"trial {trial_id} has a run or a registration relies on it",
                         missing=(str(trial_id),))
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
        if (listed.get(CAPTURED_SOURCE) or {}).get("sha256") != trial["source_sha256"]:
            raise refuse("EXECUTION_IDENTITY", f"the recovered source of trial {trial_id} is not the trial's source",
                         missing=(CAPTURED_SOURCE,))
        manifest = {"files": listed, "host_error": receipt, "limitation": RECOVERY_LIMITATION}
        files = {**stored, RECOVERY_MANIFEST: db.canonical_json(manifest).encode("utf-8"), HOST_ERROR: receipt_bytes}
        bundle = f"trial-{trial_id}-recovery"
        digests = evidence.digests(files)

        def insert(c, op):
            evidence.write_files(c, bundle, files, kind="recovery", trial_id=trial_id, op_id=op)
            return {"bundle": bundle}

        written = db.write(conn, "recover_capture", {"trial_id": trial_id, "files": digests}, "evidence_bundle", insert)
    return {"bundle": bundle, "trial_id": trial_id, "status": "recovered", "original_capture": "missing",
            "limitation": RECOVERY_LIMITATION, "ledger_commit": written["commit"]}
