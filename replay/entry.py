"""The one replay entry (`replay.explore`, `replay.precheck`, `replay.run`, `replay.seal`, `replay.execute`,
`replay.input_coverage`, `replay.audit_problems`, `replay.summary_problems`).

Every replay goes the same way: resolve the pinned runtime image, export the market inputs of one
market commit and compute their identity, probe the image for its effective configuration, write the
coverage receipt, then write the trial, its binding and its start receipt in one transaction; only
after that commit does the runner start, followed by the independent auditor and the semantic
fingerprint in the same image (each its own named container), and the execution capture is sealed
whatever the outcome. Explorations and prechecks keep their reports in a new temporary directory;
research and validation replays are stored as runs, invalid whenever the runner's output cannot be
read, and their working directory deleted (kept, and printed, when anything fails after a container
started).
"""

from __future__ import annotations

from collections.abc import Mapping
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time

from ledger import db, execution, metrics, paths, problems, strategies, trials
from ledger.errors import Refusal
from ledger.refusals import refuse
from registration import comparability, inputs as registration_inputs, register, seams as registration_seams
from registration import validation as registration_validation
from replay import seams


COVERAGE_FORMAT = "execution-input-coverage-v1"
COVERAGE = execution.COVERAGE
REPORTS, AUDIT, SOURCE, FINGERPRINT = "reports", "audit", "source", "fingerprint"
STRATEGY_DIR, REPORTS_MOUNT, NATIVE_MOUNT = "/strategy", "/reports", "/native/reports"
COVERAGE_MOUNT = "/inputs/" + COVERAGE
AUDIT_COVERAGE_MOUNT = "/native/" + COVERAGE  # the auditor reads the receipt beside the reports (engine.audit_main)
INSPECTION = "runtime-inspection.json"
EXECUTION_BINDING = "execution.json"  # in source/, mounted read-only at STRATEGY_DIR
HOST_ERROR = execution.HOST_ERROR
WORK_ROOT = "/tmp"  # sealed replays work in a new directory here (docker shares it by default)
PRECHECK_SCOPE = "engineering evidence only; interface, causality, activity and readiness are an independent Agent's review"
# A stage log keeps its first LOG_HEAD and last LOG_TAIL bytes (whole lines): the engine logs every swallowed
# callback exception again, and runtime_failures.jsonl already counts each one. Uncalibrated example values.
LOG_HEAD, LOG_TAIL = 768 * 1024, 256 * 1024


# Small helpers

def bound_log(path: Path) -> None:
    """Cut a stage log longer than LOG_HEAD + LOG_TAIL bytes (and room for the note) to its first and
    last whole lines within those sizes, with one line in between that says how many bytes and lines
    were left out; a log cut once stays as it is."""
    size = path.stat().st_size
    if size <= LOG_HEAD + LOG_TAIL + 256:
        return
    with path.open("rb") as stream:
        head = stream.read(LOG_HEAD)
        stream.seek(size - LOG_TAIL)
        tail = stream.read()
    head = head[:head.rfind(b"\n") + 1]  # empty when the head holds no whole line
    tail = tail[tail.find(b"\n") + 1:]
    with path.open("rb") as stream:
        stream.seek(len(head))
        left = size - len(head) - len(tail)
        lines = sum(stream.read(min(1 << 20, left - done)).count(b"\n") for done in range(0, left, 1 << 20))
    note = f"[replay entry: {left} bytes in {lines} lines left out of this log]\n".encode()
    partial = path.with_name(path.name + ".partial")
    partial.write_bytes(head + note + tail)
    os.replace(partial, path)


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
    registration_inputs.cleanup(inputs)


def _export(market, at: str | None, runner_argv: list[str], fresh: bool, research) -> tuple[dict, dict]:
    """(runner inputs {window, selection, lifecycle_bundle}, exported inputs) of one replay."""
    runner = registration_seams.current.runner_inputs(list(runner_argv))
    return runner, registration_inputs.market_inputs(market, at, runner["window"], runner["selection"],
                                                     runner.get("lifecycle_bundle"), fresh, research)


def _prepare(workdir: Path, source: bytes, inspection: Mapping, inputs: Mapping) -> bytes:
    """Create source/, reports/, audit/ and fingerprint/ with the source bytes, the inspection and the
    coverage receipt."""
    workdir.mkdir(mode=0o700, parents=True, exist_ok=True)
    for name in (SOURCE, REPORTS, AUDIT, FINGERPRINT):
        (workdir / name).mkdir(mode=0o700, exist_ok=True)
    (workdir / SOURCE / "strategy.py").write_bytes(source)
    _write_json(workdir / INSPECTION, inspection)
    return input_coverage(workdir, inputs, inspection).read_bytes()


def _mounts(workdir: Path, inputs: Mapping, runner_argv: list[str]) -> tuple[list[str], list[tuple[Path, str, bool]]]:
    argv, mounts = registration_seams.container_runner_args(list(runner_argv), inputs)
    return argv, [*mounts, (workdir / COVERAGE, COVERAGE_MOUNT, True), (workdir / SOURCE, STRATEGY_DIR, True),
                  (workdir / REPORTS, REPORTS_MOUNT, False)]


def _strategy_argv(workdir: Path, identity: Mapping, inspection: Mapping, entry_class: str,
                   source_sha256: str) -> list[str]:
    """The runner's strategy, execution binding and output options, the same for every replay: write
    source/execution.json (the runtime identity and the effective configuration the probe reported),
    which the runner checks against the configuration it resolves itself (EXECUTION_BINDING_MISMATCH),
    so a precheck loads exactly as a sealed replay does."""
    _write_json(workdir / SOURCE / EXECUTION_BINDING, {
        "runtime_identity": _identity4(identity), "effective_config": inspection.get("effective_config"),
        "effective_config_sha256": inspection.get("effective_config_sha256")})
    return ["--strategy-file", f"{STRATEGY_DIR}/strategy.py", "--strategy-class", entry_class,
            "--strategy-sha256", source_sha256, "--execution-binding", f"{STRATEGY_DIR}/{EXECUTION_BINDING}",
            "--output", REPORTS_MOUNT]


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
    config = inspection.get("effective_config")
    if not isinstance(config, Mapping):
        config = {}
    value = {"format": COVERAGE_FORMAT, "input_identity": inputs["identity"], "effective_config": config,
             "membership": _read_json(Path(inputs["membership_file"])), "export_receipts": receipts,
             "scope": {"start": config.get("start"), "trade_start": config.get("trade_start"), "end": config.get("end"),
                       "covers": "the warm-up, trading and possible holding interval; indicator readiness is the "
                                 "source's and the Agent's evidence"}}
    path = workdir / COVERAGE
    _write_json(path, value)
    return path


def _regular(path: Path) -> bytes | None:
    try:
        return path.read_bytes() if path.is_file() and not path.is_symlink() else None
    except OSError:
        return None


def audit_problems(workdir: Path, native_exit: int | None, audit_exit: int | None) -> tuple[list[dict], dict | None]:
    """Invalidity reasons from the exit codes, the audit result and the structured runtime failures
    of a working directory (ledger.audit_problems on its regular files)."""
    workdir = Path(workdir)
    return problems.audit_problems(native_exit, audit_exit, _regular(workdir / execution.AUDIT_RESULT),
                                   _regular(workdir / execution.RUNTIME_ERRORS))


def summary_problems(summary: Mapping | None, source_sha256: str, identity: Mapping, config_sha256: str) -> list[dict]:
    """The native summary checked against the trial's identity: source, runtime, configuration, integrity."""
    return problems.summary_problems(summary, source_sha256, identity, config_sha256)


def _reports_complete(workdir: Path) -> bool:
    return all((workdir / REPORTS / name).is_file() and (workdir / REPORTS / name).stat().st_size > 0
               for name in execution.NATIVE_REPORTS)


class ReplayTimeout(Exception):
    """The replay's timeout expired; the replay ends as interrupted."""


def container_name(ledger: db.LedgerProfile, trial_id: int, stage: str) -> str:
    """The container name of one stage of one trial (stopped by this name on an interrupt)."""
    return re.sub(r"[^A-Za-z0-9_.-]", "-", f"replay-{ledger.database}-trial-{trial_id}-{stage}")


def _stop(name: str) -> None:
    try:
        seams.current.stop(name)
    except Exception as exc:  # the interrupt or failure that called this is what the caller must see
        print(f"container {name} could not be stopped: {type(exc).__name__}: {exc}", file=sys.stderr)


def execute(ledger: db.LedgerProfile, trial_id: int, identity: Mapping, mounts: list[tuple[Path, str, bool]],
            workdir: Path, runner_args: list[str], conn: db.LedgerConnection | None, purpose: str,
            timeout: float | None = None) -> tuple:
    """Run the runner, then (with every report present) the auditor and the fingerprint, each in its
    own named container of one image; seal whatever happened.

    An interrupt, or `timeout` seconds passing (ReplayTimeout), stops the running container and is
    sealed as interrupted. A research or validation capture refused for size is stored as an invalid
    run with its recovery material before the refusal is raised.
    """
    workdir = Path(workdir)
    layout = seams.current.layout(identity["runtime_contract"])
    deadline = None if timeout is None else time.monotonic() + timeout
    stages: dict = {"native": None, "audit": None, "fingerprint": None}
    process: dict = {"trial_id": trial_id, "purpose": purpose, "stages": stages, "commands": {}}
    outcome = {"kind": "completed", "detail": None}
    native_exit, audit_exit = None, None

    def record():
        _write_json(workdir / execution.PROCESS, process)

    def remaining(name: str) -> float | None:
        if deadline is None:
            return None
        left = deadline - time.monotonic()
        if left <= 0:
            raise ReplayTimeout(f"the replay exceeded its timeout of {timeout} s before stage {name}")
        return left

    def run(name: str, module: str, stage_mounts: list, argv: list[str]) -> int:
        left = remaining(name)
        container = container_name(ledger, trial_id, name)
        command = seams.current.container_command(identity, stage_mounts, module, list(argv), container)
        process["commands"][name] = command
        stages[name] = {"state": "started", "exit_code": None}
        record()
        logs = workdir / f"{name}.stdout.txt", workdir / f"{name}.stderr.txt"
        try:
            with logs[0].open("wb") as out, logs[1].open("wb") as err:
                try:
                    code = seams.current.run(command, out, err, left)
                except OSError as exc:
                    err.write(str(exc).encode("utf-8", errors="replace"))
                    code = 127
                except subprocess.TimeoutExpired as exc:
                    _stop(container)
                    raise ReplayTimeout(f"the replay exceeded its timeout of {timeout} s in stage {name}") from exc
                except BaseException:
                    _stop(container)
                    raise
        finally:
            for log in logs:
                if log.is_file():
                    bound_log(log)
        stages[name] = {"state": "exited", "exit_code": code}
        record()
        return code

    failed = False
    try:
        native_exit = run("native", layout["runner_module"], mounts, list(runner_args))
        if _reports_complete(workdir):
            audit_exit = run("audit", layout["audit_module"], [
                (workdir / REPORTS, NATIVE_MOUNT, True), (workdir / COVERAGE, AUDIT_COVERAGE_MOUNT, True),
                (workdir / AUDIT, REPORTS_MOUNT, False)],
                ["--run", NATIVE_MOUNT, "--output", f"{REPORTS_MOUNT}/audit.json"])
            run("fingerprint", layout["fingerprint_module"], [
                (workdir / REPORTS, NATIVE_MOUNT, True), (workdir / FINGERPRINT, REPORTS_MOUNT, False)],
                ["--run", NATIVE_MOUNT, "--output", f"{REPORTS_MOUNT}/fingerprint.json"])
    except BaseException as exc:
        failed = True
        interrupted = isinstance(exc, (KeyboardInterrupt, SystemExit, ReplayTimeout))
        outcome = {"kind": "interrupted" if interrupted else "host_failure", "detail": f"{type(exc).__name__}: {exc}"}
        raise
    finally:
        try:
            execution.seal_capture(ledger, trial_id, workdir, stages, outcome, conn)
        except Refusal as refusal:
            if refusal.code == "EXECUTION_CAPTURE_LIMIT":
                _write_json(workdir / HOST_ERROR, refusal.as_dict())
                if purpose in trials.RUN_PURPOSES:
                    _store_capture_refusal(ledger, conn, trial_id, workdir, refusal)
            if not failed:
                raise
            print(f"execution capture of trial {trial_id} was refused ({refusal.code}): {refusal.message}",
                  file=sys.stderr)
    return native_exit, audit_exit


def _store_capture_refusal(ledger: db.LedgerProfile, conn: db.LedgerConnection | None, trial_id: int, workdir: Path,
                           refusal: Refusal) -> None:
    if conn is None:
        with db.connect(ledger, "writer") as own:
            trials.ingest_capture_refusal(own, trial_id, workdir, refusal.as_dict())
        return
    trials.ingest_capture_refusal(conn, trial_id, workdir, refusal.as_dict())


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
        argv += _strategy_argv(output, identity, inspection, strategy_class, source_sha256)
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
        argv += _strategy_argv(output, identity, inspection, revision["entry_class"], revision["source_sha256"])
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
         runner_argv: list[str], hypothesis: str | None, validation: int | None, *, market=None,
         timeout: float | None = None) -> dict:
    """Bind, execute and store one sealed replay; the working directory is deleted once stored.

    The ledger derives the run's status from the sealed capture (ledger.ingest_run); this entry adds
    only what the host saw outside it (inputs changed during the replay).
    """
    if (hypothesis is None) == (validation is None):
        raise refuse("REGISTRATION_REQUIRED", "give exactly one of a registration bundle or a validation registration",
                     expected="hypothesis xor validation")
    checkout = registration_seams.current.checkout()
    metrics.metrics_revision(checkout)  # a passed run records it; outside a checkout this raises before any trial
    identity = _resolve(runtime)
    if revision["runtime_contract"] != identity["runtime_contract"]:
        raise refuse("RUNTIME_CONTRACT_MISMATCH", f"the candidate needs contract {revision['runtime_contract']}, the "
                                                  f"image is {identity['runtime_contract']}",
                     expected=revision["runtime_contract"])
    inspection = registration_seams.current.inspect_runtime(identity, list(runner_argv), inputs)
    comparability.config_key(inspection.get("effective_config"))  # a malformed configuration refuses before any trial
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
        argv, mounts = _mounts(workdir, inputs, runner_argv)
        argv += _strategy_argv(workdir, identity, inspection, revision["entry_class"], source_sha256)
        if hypothesis is not None:
            purpose, binder = "research", register.binder(hypothesis, source_sha256)
        else:
            assert validation is not None  # REGISTRATION_REQUIRED above refuses neither or both
            purpose = "validation"
            binder = registration_validation.validation_binder(validation, source_sha256, _identity4(identity),
                                                               inspection, market=market)
        opened = trials.open_trial(conn, purpose, source_sha256, _trial_runtime(identity, inspection),
                                   {"identity": inputs["identity"], "input_coverage": coverage}, runner["window"],
                                   _start_context(workdir, argv, mounts, revision["source"]), binder)
        trial_id = opened["trial_id"]
        try:
            execute(ledger, trial_id, identity, mounts, workdir, argv, conn, purpose, timeout)
        except Refusal as exc:
            stored = conn.one("SELECT run_id, status, failure_reasons FROM run WHERE trial_id = %s", (trial_id,))
            if exc.code != "EXECUTION_CAPTURE_LIMIT" or stored is None:
                raise
            print(f"replay directory kept for diagnosis (capture refused for size): {workdir}", file=sys.stderr)
            return {"trial_id": trial_id, "image_ref": identity["image_ref"], **trials.run_record(stored)}
        host = []
        if registration_inputs.export_fingerprint(inputs, semantic=False)["export_content_sha256"] != raw_before:
            host.append(problems.reason("INPUTS_CHANGED", "exported inputs changed during the replay",
                                        "export_content_sha256"))
        stored = trials.ingest_run(conn, trial_id, workdir, inputs["identity"], host_reasons=host, checkout=checkout)
    except BaseException:
        if (workdir / execution.PROCESS).exists():
            print(f"replay directory kept for diagnosis: {workdir}", file=sys.stderr)
        else:  # no container started: nothing in it to diagnose
            shutil.rmtree(workdir, ignore_errors=True)
        raise
    shutil.rmtree(workdir, ignore_errors=True)
    return {"trial_id": trial_id, "run_id": stored["run_id"], "status": stored["status"],
            "failure_reasons": stored["failure_reasons"], "image_ref": identity["image_ref"]}
