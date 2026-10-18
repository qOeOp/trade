"""The one replay entry (`replay.explore`, `replay.precheck`, `replay.run`, `replay.seal`, `replay.execute`,
`replay.input_coverage`, `replay.audit_problems`, `replay.summary_problems`).

Every replay goes the same way: resolve the pinned runtime image, export the market inputs of one
market commit and compute their identity, probe the image for its effective configuration, write the
coverage receipt, then write the trial, its binding and its start receipt in one transaction; only
after that commit does the runner start, followed by the independent auditor in the same image, and
the execution capture is sealed whatever the outcome. Explorations and prechecks keep their reports
in a new temporary directory; research and validation replays are stored as runs and their working
directory deleted (kept, and printed, when anything fails).
"""

from __future__ import annotations

from collections.abc import Mapping
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile

from ledger import db, execution, paths, strategies, trials
from ledger.errors import Refusal
from ledger.refusals import refuse
from registration import comparability, inputs as registration_inputs, register, seams as registration_seams
from registration import validation as registration_validation
from replay import seams


COVERAGE_FORMAT = "execution-input-coverage-v1"
COVERAGE = execution.COVERAGE
REPORTS, AUDIT, SOURCE = "reports", "audit", "source"
STRATEGY_DIR, REPORTS_MOUNT, NATIVE_MOUNT = "/strategy", "/reports", "/native"
COVERAGE_MOUNT = "/inputs/" + COVERAGE
INSPECTION = "runtime-inspection.json"
HOST_ERROR = execution.HOST_ERROR
FAILURE_FIELDS = ("stage", "exception_type")
WORK_ROOT = "/tmp"  # sealed replays work in a new directory here (docker shares it by default)
PRECHECK_SCOPE = "engineering evidence only; interface, causality, activity and readiness are an independent Agent's review"


# Small helpers

def _write_json(path: Path, value) -> None:
    with path.open("w", encoding="utf-8") as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2, sort_keys=True, default=str)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())


def _read_json(path: Path):
    try:
        return json.loads(path.read_bytes().decode("utf-8")) if path.is_file() and not path.is_symlink() else None
    except (OSError, UnicodeDecodeError, ValueError):
        return None


def _identity4(identity: Mapping) -> dict:
    return {key: identity[key] for key in ("image_ref", "image_digest", "platform", "runtime_contract")}


def _reserved(runner_argv: list[str]) -> None:
    reserved = registration_seams.reserved_options(list(runner_argv))
    if reserved:
        raise refuse("RUNNER_OPTION_RESERVED", "the replay entry writes " + ", ".join(reserved) + " itself",
                     missing=tuple(reserved))


def _resolve(runtime: str | None) -> dict:
    """runtime.resolve: the pinned identity with the image's build revision (None without a label)."""
    identity = dict(registration_seams.current.resolve_runtime(runtime))
    identity["build_revision"] = seams.current.build_revision(identity)
    return identity


def _cleanup(inputs: Mapping | None) -> None:
    if not inputs:
        return
    shutil.rmtree(Path(inputs["membership_file"]).parent, ignore_errors=True)
    if inputs.get("fresh"):
        shutil.rmtree(inputs["root"], ignore_errors=True)


def _export(market, at: str | None, runner_argv: list[str], fresh: bool, research) -> tuple[dict, dict]:
    """(runner inputs {window, selection, lifecycle_bundle}, exported inputs) of one replay."""
    runner = registration_seams.current.runner_inputs(list(runner_argv))
    return runner, registration_inputs.market_inputs(market, at, runner["window"], runner["selection"],
                                                     runner.get("lifecycle_bundle"), fresh, research)


def _prepare(workdir: Path, source: bytes, inspection: Mapping, inputs: Mapping) -> bytes:
    """Create source/, reports/ and audit/ with the source bytes, the inspection and the coverage receipt."""
    workdir.mkdir(mode=0o700, parents=True, exist_ok=True)
    for name in (SOURCE, REPORTS, AUDIT):
        (workdir / name).mkdir(mode=0o700, exist_ok=True)
    (workdir / SOURCE / "strategy.py").write_bytes(source)
    _write_json(workdir / INSPECTION, inspection)
    return input_coverage(workdir, inputs, inspection).read_bytes()


def _mounts(workdir: Path, inputs: Mapping, runner_argv: list[str]) -> tuple[list[str], list[tuple[Path, str, bool]]]:
    argv, mounts = registration_seams.container_runner_args(list(runner_argv), inputs)
    return argv, [*mounts, (workdir / COVERAGE, COVERAGE_MOUNT, True), (workdir / SOURCE, STRATEGY_DIR, True),
                  (workdir / REPORTS, REPORTS_MOUNT, False)]


def _start_context(workdir: Path, argv: list[str], mounts: list, source: bytes) -> dict:
    return {"argv": list(argv), "mounts": [[str(host), target, not readonly] for host, target, readonly in mounts],
            "workdir": str(workdir), "source_bytes": source}


def _trial_runtime(identity: Mapping, inspection: Mapping) -> dict:
    return {**_identity4(identity), **({"build_revision": identity["build_revision"]}
                                       if identity.get("build_revision") else {}), "inspection": dict(inspection)}


# Coverage, problems and execution

def input_coverage(workdir: Path, inputs: Mapping, inspection: Mapping) -> Path:
    """Write input-coverage.json (export receipts, input identity, effective configuration, membership)."""
    workdir = Path(workdir)
    receipts = {}
    for symbol in inputs["symbols"]:
        found = _read_json(Path(inputs["root"]) / symbol / registration_inputs.RECEIPT)
        receipts[symbol] = found if isinstance(found, dict) else {"status": "missing"}
    config = inspection.get("effective_config") if isinstance(inspection.get("effective_config"), Mapping) else {}
    value = {"format": COVERAGE_FORMAT, "input_identity": inputs["identity"], "effective_config": config,
             "membership": _read_json(Path(inputs["membership_file"])), "export_receipts": receipts,
             "scope": {"start": config.get("start"), "trade_start": config.get("trade_start"), "end": config.get("end"),
                       "covers": "the warm-up, trading and possible holding interval; indicator readiness is the "
                                 "source's and the Agent's evidence"}}
    path = workdir / COVERAGE
    _write_json(path, value)
    return path


def audit_problems(workdir: Path, native_exit: int, audit_exit: int | None) -> tuple[list[dict], dict | None]:
    """Invalidity reasons from the exit codes, the audit result and the structured runtime failures."""
    workdir = Path(workdir)
    reasons = []

    def reason(code, message, locator=None):
        reasons.append({"code": code, "message": message, "locator": locator})

    if native_exit:
        reason("NATIVE_EXIT_NONZERO", f"the native runner exited {native_exit}", "native")
    if audit_exit is None:
        reason("AUDIT_NOT_RUN", "the independent audit did not run", "audit")
    elif audit_exit:
        reason("AUDIT_EXIT_NONZERO", f"the independent audit exited {audit_exit}", "audit")
    path, audit = workdir / execution.AUDIT_RESULT, None
    if not path.is_file():
        reason("AUDIT_RESULT_MISSING", "the audit result is missing", execution.AUDIT_RESULT)
    else:
        try:
            audit = json.loads(path.read_bytes().decode("utf-8"))
            if not isinstance(audit, dict):
                raise ValueError("the audit result is not a JSON object")
        except (OSError, UnicodeDecodeError, ValueError) as exc:
            audit = None
            reason("AUDIT_RESULT_UNREADABLE", f"the audit result is unreadable: {exc}", execution.AUDIT_RESULT)
        else:
            findings = audit.get("findings") if isinstance(audit.get("findings"), list) else []
            for finding in findings:
                reason("AUDIT_FINDINGS", "the independent audit found a problem", finding)
            if audit.get("passed") is not True and not findings:
                reason("AUDIT_FINDINGS", "the independent audit did not pass", execution.AUDIT_RESULT)
    failures = workdir / execution.RUNTIME_ERRORS
    if failures.is_file():
        try:
            lines = [json.loads(line) for line in failures.read_bytes().decode("utf-8").splitlines() if line.strip()]
        except (OSError, UnicodeDecodeError, ValueError) as exc:
            reason("RUNTIME_FAILURE_UNREADABLE", f"the runtime failure receipts are unreadable: {exc}",
                   execution.RUNTIME_ERRORS)
        else:
            if any(not isinstance(item, dict) or any(not isinstance(item.get(key), str) for key in FAILURE_FIELDS)
                   for item in lines):
                reason("RUNTIME_FAILURE_MALFORMED", "a runtime failure receipt is not structured",
                       execution.RUNTIME_ERRORS)
            else:
                for item in lines:
                    reason("RUNTIME_FAILURE_RECORDED", f"{item['exception_type']} in {item['stage']}",
                           f"{item['stage']}:{item.get('instrument_id') or 'unconstructed'}")
    return reasons, audit


def summary_problems(summary: Mapping | None, source_sha256: str, identity: Mapping, config_sha256: str) -> list[dict]:
    """The native summary checked against the trial's identity: source, runtime, configuration, integrity."""
    if summary is None:
        return [{"code": "SUMMARY_MISSING", "message": "the native summary is missing", "locator": "reports/summary.json"}]
    reasons = []
    if summary.get("source_sha256") != source_sha256:
        reasons.append({"code": "SOURCE_MISMATCH", "message": "the native summary names another source",
                        "locator": "source_sha256"})
    recorded = summary.get("runtime_identity")
    if not isinstance(recorded, Mapping) or dict(recorded) != dict(identity):
        fields = sorted(key for key in set(identity) | set(recorded or {})
                        if not isinstance(recorded, Mapping) or recorded.get(key) != identity.get(key))
        reasons.append({"code": "RUNTIME_MISMATCH", "message": "the native summary names another runtime identity",
                        "locator": ",".join(fields) or "runtime_identity"})
    if summary.get("effective_config_sha256") != config_sha256:
        reasons.append({"code": "CONFIG_MISMATCH", "message": "the native summary names another effective "
                                                              "configuration", "locator": "effective_config_sha256"})
    if summary.get("integrity_passed") is not True:
        reasons.append({"code": "RUNNER_INTEGRITY_FAILED", "message": "the runner's integrity checks failed",
                        "locator": "; ".join(str(item) for item in summary.get("integrity_findings") or ()) or None})
    return reasons


def _reports_complete(workdir: Path) -> bool:
    return all((workdir / REPORTS / name).is_file() and (workdir / REPORTS / name).stat().st_size > 0
               for name in execution.NATIVE_REPORTS)


def execute(ledger: db.LedgerProfile, trial_id: int, identity: Mapping, mounts: list[tuple[Path, str, bool]],
            workdir: Path, runner_args: list[str], conn: db.LedgerConnection | None, purpose: str) -> tuple:
    """Run the runner, then (with every report present) the auditor, in one image; seal whatever happened."""
    workdir = Path(workdir)
    layout = seams.current.layout(identity["runtime_contract"])
    stages: dict = {"native": None, "audit": None}
    process = {"trial_id": trial_id, "purpose": purpose, "stages": stages, "commands": {}}
    outcome = {"kind": "completed", "detail": None}
    native_exit, audit_exit = None, None

    def record():
        _write_json(workdir / execution.PROCESS, process)

    def run(name: str, command: list[str]) -> int:
        process["commands"][name] = command
        stages[name] = {"state": "started", "exit_code": None}
        record()
        with (workdir / f"{name}.stdout.txt").open("wb") as out, (workdir / f"{name}.stderr.txt").open("wb") as err:
            try:
                code = seams.current.run(command, out, err)
            except OSError as exc:
                err.write(str(exc).encode("utf-8", errors="replace"))
                code = 127
        stages[name] = {"state": "exited", "exit_code": code}
        record()
        return code

    failed = False
    try:
        native_exit = run("native", seams.current.container_command(identity, mounts, layout["runner_module"],
                                                                     list(runner_args)))
        if _reports_complete(workdir):
            audit_mounts = [(workdir / REPORTS, NATIVE_MOUNT, True), (workdir / COVERAGE, COVERAGE_MOUNT, True),
                            (workdir / AUDIT, REPORTS_MOUNT, False)]
            audit_exit = run("audit", seams.current.container_command(identity, audit_mounts, layout["audit_module"], [
                "--run", NATIVE_MOUNT, *layout["audit_args"], "--output", f"{REPORTS_MOUNT}/audit.json"]))
    except BaseException as exc:
        failed = True
        interrupted = isinstance(exc, (KeyboardInterrupt, SystemExit))
        outcome = {"kind": "interrupted" if interrupted else "host_failure", "detail": f"{type(exc).__name__}: {exc}"}
        raise
    finally:
        try:
            execution.seal_capture(ledger, trial_id, workdir, stages, outcome, conn)
        except Refusal as refusal:
            if refusal.code == "EXECUTION_CAPTURE_LIMIT":
                _write_json(workdir / HOST_ERROR, refusal.as_dict())
            if not failed:
                raise
            print(f"execution capture of trial {trial_id} was refused ({refusal.code}): {refusal.message}",
                  file=sys.stderr)
    return native_exit, audit_exit


# Explorations and prechecks

def explore(ledger: db.LedgerProfile, market, at: str | None, strategy_file: Path, strategy_class: str, output: Path,
            runtime: str | None, runner_argv: list[str]) -> dict:
    """Replay an unpublished strategy file into a new temporary directory; the ledger keeps the trial,
    its start receipt and its execution capture."""
    output = paths.temporary_path(output)
    if not isinstance(strategy_class, str) or not strategy_class.isidentifier():
        raise refuse("ENTRY_CLASS_INVALID", f"{strategy_class!r} is not one Python class name")
    _reserved(runner_argv)
    source = Path(strategy_file).read_bytes()
    source_sha256 = hashlib.sha256(source).hexdigest()
    identity = _resolve(runtime)
    exported = None
    try:
        runner, exported = _export(market, at, runner_argv, False, ledger)
        inspection = registration_seams.current.inspect_runtime(identity, list(runner_argv), exported)
        coverage = _prepare(output, source, inspection, exported)
        argv, mounts = _mounts(output, exported, runner_argv)
        argv += ["--strategy-file", f"{STRATEGY_DIR}/strategy.py", "--strategy-class", strategy_class,
                 "--strategy-sha256", source_sha256, "--output", REPORTS_MOUNT]
        with db.connect(ledger, "writer") as conn:
            opened = trials.open_trial(conn, "explore", source_sha256, _trial_runtime(identity, inspection),
                                       {"identity": exported["identity"], "input_coverage": coverage}, runner["window"],
                                       _start_context(output, argv, mounts, source))
            native_exit, audit_exit = execute(ledger, opened["trial_id"], identity, mounts, output, argv, conn,
                                              "explore")
        problems, _ = audit_problems(output, native_exit, audit_exit)
        status = "passed" if not problems else "invalid"
        return {"purpose": "explore", "status": status, "problems": problems, "path": str(output),
                "trial_id": opened["trial_id"], "image_ref": identity["image_ref"], "market": exported["identity"],
                "metrics": seams.current.directory_report(output)}
    finally:
        _cleanup(exported)


def precheck(ledger: db.LedgerProfile, market, at: str, candidate: str, runtime: str, runner_argv: list[str],
             output: Path) -> dict:
    """A declared native precheck of a published candidate; nothing starts before its trial commits."""
    with db.connect(ledger, "reader") as conn:
        revision = strategies.read_candidate(conn, candidate)
    output = paths.temporary_path(output)
    _reserved(runner_argv)
    identity = _resolve(runtime)
    if not identity.get("build_revision"):
        raise refuse("RUNTIME_NOT_CI_BUILT", f"{identity['image_ref']} carries no build source revision label",
                     missing=("org.opencontainers.image.revision",))
    if revision["runtime_contract"] != identity["runtime_contract"]:
        raise refuse("RUNTIME_CONTRACT_MISMATCH", f"{candidate} needs contract {revision['runtime_contract']}, the "
                                                  f"image is {identity['runtime_contract']}",
                     expected=revision["runtime_contract"])
    exported = None
    try:
        runner, exported = _export(market, at, runner_argv, True, ledger)
        input_key = comparability.input_key(exported["identity"])
        inspection = registration_seams.current.inspect_runtime(identity, list(runner_argv), exported)
        config_key = comparability.config_key(inspection.get("effective_config"))
        coverage = _prepare(output, revision["source"], inspection, exported)
        argv, mounts = _mounts(output, exported, runner_argv)
        argv += ["--strategy-file", f"{STRATEGY_DIR}/strategy.py", "--strategy-class", revision["entry_class"],
                 "--strategy-sha256", revision["source_sha256"], "--output", REPORTS_MOUNT]
        with db.connect(ledger, "writer") as conn:
            opened = trials.open_trial(conn, "precheck", revision["source_sha256"], _trial_runtime(identity, inspection),
                                       {"identity": exported["identity"], "input_coverage": coverage}, runner["window"],
                                       _start_context(output, argv, mounts, revision["source"]))
            native_exit, audit_exit = execute(ledger, opened["trial_id"], identity, mounts, output, argv, conn,
                                              "precheck")
        problems, _ = audit_problems(output, native_exit, audit_exit)
        return {"purpose": "precheck", "trial_id": opened["trial_id"],
                "execution_bundle": f"trial-{opened['trial_id']}-execution", "source_sha256": revision["source_sha256"],
                "image_ref": identity["image_ref"], "input_key": input_key, "config_key": config_key,
                "status": "passed" if not problems else "failed", "problems": problems, "path": str(output),
                "metrics": seams.current.directory_report(output), "scope": PRECHECK_SCOPE}
    finally:
        _cleanup(exported)


# Sealed research and validation replays

def run(ledger: db.LedgerProfile, market, at: str | None, strategy: str, runtime: str | None, runner_argv: list[str],
        hypothesis: str | None = None, validation: int | None = None) -> dict:
    """A sealed research (hypothesis) or validation replay of a published candidate, stored as a run."""
    if (hypothesis is None) == (validation is None):
        raise refuse("REGISTRATION_REQUIRED", "give exactly one of a registration bundle or a validation registration",
                     expected="hypothesis xor validation")
    _reserved(runner_argv)
    if validation is not None:
        registration_validation.require_fresh(registration_seams.current.checkout())
    with db.connect(ledger, "writer") as conn:
        revision = strategies.read_candidate(conn, strategy)
        exported = None
        try:
            _, exported = _export(market, at, runner_argv, True, ledger)
            sealed = seal(ledger, conn, revision, runtime, exported, runner_argv, hypothesis, validation, market=market)
        finally:
            _cleanup(exported)
    return {"purpose": "research" if hypothesis is not None else "validation", "strategy": strategy, **sealed}


def seal(ledger: db.LedgerProfile, conn: db.LedgerConnection, revision: Mapping, runtime: str | None, inputs: Mapping,
         runner_argv: list[str], hypothesis: str | None, validation: int | None, *, market=None) -> dict:
    """Bind, execute, check and store one sealed replay; the working directory is deleted once stored."""
    if (hypothesis is None) == (validation is None):
        raise refuse("REGISTRATION_REQUIRED", "give exactly one of a registration bundle or a validation registration",
                     expected="hypothesis xor validation")
    head = db.head_commit(conn)
    identity = _resolve(runtime)
    if revision["runtime_contract"] != identity["runtime_contract"]:
        raise refuse("RUNTIME_CONTRACT_MISMATCH", f"the candidate needs contract {revision['runtime_contract']}, the "
                                                  f"image is {identity['runtime_contract']}",
                     expected=revision["runtime_contract"])
    inspection = registration_seams.current.inspect_runtime(identity, list(runner_argv), inputs)
    effective = comparability.config_key(inspection.get("effective_config"))
    semantic = registration_inputs.export_fingerprint(inputs, semantic=True)["export_content_sha256"]
    if semantic != inputs["identity"].get("export_content_sha256"):
        raise refuse("EXPORT_CHANGED_BEFORE_EXECUTION", "the exported inputs changed after their identity was taken",
                     missing=("export_content_sha256",))
    raw_before = registration_inputs.export_fingerprint(inputs, semantic=False)["export_content_sha256"]
    runner = registration_seams.current.runner_inputs(list(runner_argv))
    workdir = Path(tempfile.mkdtemp(prefix="replay-run-", dir=WORK_ROOT))
    try:
        source_sha256 = revision["source_sha256"]
        coverage = _prepare(workdir, revision["source"], inspection, inputs)
        _write_json(workdir / SOURCE / "binding.json", {
            "database": ledger.database, "commit": head, "strategy_id": revision["strategy_id"],
            "revision": revision["revision"], "source_sha256": source_sha256, "entry_class": revision["entry_class"],
            "runtime_contract": revision["runtime_contract"]})
        native = inspection.get("native_effective_config", inspection.get("effective_config"))
        _write_json(workdir / SOURCE / "execution.json", {
            "runtime_identity": _identity4(identity), "effective_config": native,
            "effective_config_sha256": inspection.get("effective_config_sha256")})
        argv, mounts = _mounts(workdir, inputs, runner_argv)
        argv += ["--strategy-file", f"{STRATEGY_DIR}/strategy.py", "--strategy-class", revision["entry_class"],
                 "--strategy-sha256", source_sha256, "--strategy-binding", f"{STRATEGY_DIR}/binding.json",
                 "--execution-binding", f"{STRATEGY_DIR}/execution.json", "--output", REPORTS_MOUNT]
        if hypothesis is not None:
            purpose, binder = "research", register.binder(hypothesis, source_sha256)
        else:
            purpose = "validation"
            binder = registration_validation.validation_binder(validation, source_sha256, _identity4(identity),
                                                               inspection, market=market)
        opened = trials.open_trial(conn, purpose, source_sha256, _trial_runtime(identity, inspection),
                                   {"identity": inputs["identity"], "input_coverage": coverage}, runner["window"],
                                   _start_context(workdir, argv, mounts, revision["source"]), binder)
        trial_id = opened["trial_id"]
        native_exit, audit_exit = execute(ledger, trial_id, identity, mounts, workdir, argv, conn, purpose)
        reasons = []
        if registration_inputs.export_fingerprint(inputs, semantic=False)["export_content_sha256"] != raw_before:
            reasons.append({"code": "INPUTS_CHANGED", "message": "exported inputs changed during the replay",
                            "locator": "export_content_sha256"})
        summary_path = workdir / REPORTS / "summary.json"
        summary = _read_json(summary_path)
        if summary_path.is_file() and not isinstance(summary, dict):
            reasons.append({"code": "NATIVE_REPORT_UNREADABLE", "message": "the native summary is unreadable",
                            "locator": "reports/summary.json"})
            summary = None
        reasons += summary_problems(seams.current.native_summary(summary), source_sha256, _identity4(identity),
                                    inspection.get("effective_config_sha256"))
        reasons += audit_problems(workdir, native_exit, audit_exit)[0]
        unique = list({(item["code"], json.dumps(item["locator"], sort_keys=True, default=str)): item
                       for item in reasons}.values())
        fingerprints = seams.current.report_fingerprint(identity, workdir / REPORTS) if not unique else None
        stored = trials.ingest_run(conn, trial_id, workdir, unique, inspection, effective, inputs["identity"],
                                   fingerprints)
    except BaseException:
        print(f"replay directory kept for diagnosis: {workdir}", file=sys.stderr)
        raise
    shutil.rmtree(workdir, ignore_errors=True)
    return {"trial_id": trial_id, "run_id": stored["run_id"], "status": stored["status"], "failure_reasons": unique,
            "image_ref": identity["image_ref"]}
