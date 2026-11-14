"""The one replay entry (`replay.explore`, `replay.precheck`, `replay.run`, `replay.seal`, `replay.stage_trial`,
`replay.execute`, `replay.replay_unrecorded`, `replay.input_coverage`, `replay.audit_problems`).

Every replay goes the same way: resolve the pinned runtime image, export the market inputs of one
market day and compute their identity, probe the image for its effective configuration, write the
coverage receipt, then write the trial, its binding and its start receipt in one transaction; only
after that commit does the runner start, followed by the independent auditor and the semantic
fingerprint in the same image (each its own named container), and the execution capture is sealed
whatever the outcome. Explorations and prechecks take only a CI image of this repository, from any
branch (runtime.require_ci_build, checked after the probe), and keep their reports in a new temporary
directory; a research run binds the image of its cited precheck. Research and validation replays are stored as runs, invalid whenever the runner's output cannot be
read, and their working directory deleted unless given as `output`, which keeps it as a cache of the
run's native reports (kept, and printed, when anything fails after a container started).
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

from ledger import db, execution, lines, metrics, problems, strategies, trials
from ledger.coverage import FORMAT as COVERAGE_FORMAT
from shared import paths
from shared.errors import Refusal
from shared.refusals import refuse
from registration import inputs as registration_inputs, precheck as source_precheck, register
from registration import seams as registration_seams
from registration import validation as registration_validation
from replay import seams
from runtime import container, image


COVERAGE = problems.COVERAGE
REPORTS, AUDIT, SOURCE, FINGERPRINT = "reports", "audit", "source", "fingerprint"
STRATEGY_DIR, NATIVE_MOUNT = "/strategy", "/native/reports"
COVERAGE_MOUNT = "/inputs/" + COVERAGE
AUDIT_COVERAGE_MOUNT = "/native/" + COVERAGE  # the auditor reads the receipt beside the reports (engine.audit_main)
INSPECTION = "runtime-inspection.json"
EXECUTION_BINDING = "execution.json"  # in source/, mounted read-only at STRATEGY_DIR
WORK_ROOT = "/tmp"  # sealed replays work in a new directory here (docker shares it by default)
PRECHECK_SCOPE = "engineering evidence only; interface, causality, activity and readiness are an independent Agent's review"
# A stage log keeps its first LOG_HEAD and last LOG_TAIL bytes (whole lines): the engine logs every swallowed
# callback exception again, and runtime_failures.jsonl already counts each one. Uncalibrated example values.
LOG_HEAD, LOG_TAIL = 768 * 1024, 256 * 1024


# Small helpers

class StageLog:
    """A stage log written as the container prints it that keeps its first LOG_HEAD and last LOG_TAIL bytes
    (whole lines) and, when it left anything out, one line in between that says how many bytes and lines;
    a log of at most LOG_HEAD + LOG_TAIL bytes and room for the note is kept whole. Nothing beyond those
    bytes ever reaches the disk."""

    def __init__(self, path: Path):
        self.stream = path.open("wb")
        self.head = 0  # bytes written to the file, at most LOG_HEAD
        self.head_lines = 0  # of them, the bytes up to the last newline
        self.tail = bytearray()
        self.dropped = self.dropped_lines = 0

    def write(self, data: bytes) -> None:
        part = data[:LOG_HEAD - self.head]
        if part:
            self.stream.write(part)
            if b"\n" in part:
                self.head_lines = self.head + part.rfind(b"\n") + 1
            self.head += len(part)
        self.tail += data[len(part):]
        extra = len(self.tail) - LOG_TAIL - 256
        if extra > 0:
            self.dropped += extra
            self.dropped_lines += self.tail.count(b"\n", 0, extra)
            del self.tail[:extra]

    def close(self) -> None:
        tail = bytes(self.tail)
        if self.dropped:
            kept = tail[len(tail) - LOG_TAIL:]
            kept = kept[kept.find(b"\n") + 1:]
            left = self.head - self.head_lines + self.dropped + len(tail) - len(kept)
            lines = self.dropped_lines + tail.count(b"\n", 0, len(tail) - len(kept))
            self.stream.truncate(self.head_lines)
            self.stream.seek(self.head_lines)
            tail = f"[replay entry: {left} bytes in {lines} lines left out of this log]\n".encode() + kept
        self.stream.write(tail)
        self.stream.close()


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
    return {key: identity[key] for key in execution.IDENTITY_FIELDS}


def _export(market, at: str | None, runner_argv: list[str], fresh: bool, research) -> tuple[dict, dict]:
    """(runner inputs {window, selection, lifecycle_bundle}, exported inputs) of one replay."""
    runner = registration_seams.runner_inputs(list(runner_argv))
    return runner, registration_inputs.market_inputs(market, at, runner["window"], runner["selection"],
                                                     runner.get("lifecycle_bundle"), fresh, research,
                                                     include_quotes=runner["execution"] == "quotes",
                                                     include_trades=runner.get("trade_ticks", False),
                                                     include_metrics=runner.get("metrics", False))


def _prepare(workdir: Path, source: bytes, entry_class: str, source_sha256: str, identity: Mapping,
             inspection: Mapping, inputs: Mapping, runner_argv: list[str]) -> tuple[bytes, list[str], list]:
    """Create source/, reports/, audit/ and fingerprint/ with the source bytes, the execution binding, the
    inspection and the coverage receipt; returns (coverage receipt bytes, runner argv, runner mounts)."""
    workdir.mkdir(mode=0o700, parents=True, exist_ok=True)
    for name in (SOURCE, REPORTS, AUDIT, FINGERPRINT):
        (workdir / name).mkdir(mode=0o700, exist_ok=True)
    (workdir / SOURCE / "strategy.py").write_bytes(source)
    _write_json(workdir / INSPECTION, inspection)
    coverage = input_coverage(workdir, inputs, inspection).read_bytes()
    argv, mounts = registration_seams.container_runner_args(list(runner_argv), inputs)
    argv += _strategy_argv(workdir, identity, inspection, entry_class, source_sha256)
    return coverage, argv, [*mounts, (workdir / COVERAGE, COVERAGE_MOUNT, True),
                            (workdir / SOURCE, STRATEGY_DIR, True), (workdir / REPORTS, container.REPORTS, False)]


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
            "--output", container.REPORTS]


def stage_trial(ledger: db.LedgerProfile, workdir: Path, purpose: str, revision: Mapping, identity: Mapping,
                inspection: Mapping, inputs: Mapping, runner_argv: list[str], window: Mapping,
                binder: trials.Binder | None = None) -> tuple[int, list[str], list[tuple[Path, str, bool]]]:
    """Stage `workdir` for the source of `revision` (source, entry_class, source_sha256), then write the trial,
    its binding and its start receipt in one commit (ledger.open_trial); returns (trial ID, runner argv, runner
    mounts) for `execute`, which may start only after this returns."""
    coverage, argv, mounts = _prepare(workdir, revision["source"], revision["entry_class"], revision["source_sha256"],
                                      identity, inspection, inputs, runner_argv)
    runtime = {**_identity4(identity), **({"build_revision": identity["build_revision"]}
                                          if identity.get("build_revision") else {}), "inspection": dict(inspection)}
    with db.connect(ledger, "writer") as conn:
        opened = trials.open_trial(conn, purpose, revision["source_sha256"], runtime, coverage, window,
                                   {"argv": list(argv), "workdir": str(workdir), "source_bytes": revision["source"]},
                                   binder)
    return opened["trial_id"], argv, mounts


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
             "membership": _read_json(Path(inputs["membership_file"])), "export_receipts": receipts}
    path = workdir / COVERAGE
    _write_json(path, value)
    return path


def audit_problems(workdir: Path, native_exit: int | None, audit_exit: int | None) -> list[dict]:
    """Invalidity reasons from the exit codes, the audit result and the structured runtime failures
    of a working directory (ledger.audit_problems on its regular files)."""
    workdir = Path(workdir)
    return problems.audit_problems(native_exit, audit_exit, metrics.read_regular(workdir / problems.AUDIT_RESULT),
                                   metrics.read_regular(workdir / problems.RUNTIME_ERRORS))


def _resolve_runtime(revision: Mapping, runtime: str | None) -> dict:
    """The runtime image's identity, refused (RUNTIME_CONTRACT_MISMATCH) unless it is of the candidate's contract."""
    identity = registration_seams.current.resolve_runtime(runtime)
    if revision["runtime_contract"] != identity["runtime_contract"]:
        raise refuse("RUNTIME_CONTRACT_MISMATCH", f"the candidate needs contract {revision['runtime_contract']}, the "
                                                  f"image is {identity['runtime_contract']}",
                     expected=revision["runtime_contract"])
    return identity


def _directory_report(directory: Path) -> dict:
    """report.directory_report: the sealed-run functions and criterion on an unsealed directory, marked
    unverified; a directory whose reports cannot be read reports why instead of refusing the replay."""
    from report import runs
    try:
        return runs.directory_report(directory, account=False)
    except Refusal as exc:
        return {"directory": str(directory), "exploration": True, "headline": None, "slices": None,
                "availability": {"economic_evidence_available": False, "reasons": [f"{exc.code}: {exc.message}"],
                                 "unverified": runs.UNVERIFIED},
                "limitations": [runs.UNVERIFIED]}


def _reports_complete(workdir: Path) -> bool:
    return all((workdir / REPORTS / name).is_file() and (workdir / REPORTS / name).stat().st_size > 0
               for name in execution.NATIVE_REPORTS)


def _memory_refusal(stage: str, exc: seams.MemoryLimit, write_status) -> Refusal:
    return refuse("STAGE_MEMORY_LIMIT", f"the {stage} stage exceeded its memory limit of {container.STAGE_MEMORY} "
                                        f"and was killed (exit code {exc.exit_code})", write_status=write_status)


def container_name(ledger: db.LedgerProfile, trial_id: int, stage: str) -> str:
    """The container name of one stage of one trial (stopped by this name on an interrupt)."""
    return re.sub(r"[^A-Za-z0-9_.-]", "-", f"replay-{ledger.database}-trial-{trial_id}-{stage}")


def _stop(name: str) -> None:
    try:
        seams.current.stop(name)
    except Exception as exc:  # the interrupt or failure that called this is what the caller must see
        print(f"container {name} could not be stopped: {type(exc).__name__}: {exc}", file=sys.stderr)


def _stage(command: list[str], container: str, workdir: Path, name: str, left: float | None,
           timeout: float | None) -> int:
    """Run one stage's container to its end with its logs in `workdir`; an interrupt or the timeout stops it
    (the timeout, which only an unrecorded replay sets, is refused REPLAY_TIMEOUT)."""
    out, err = StageLog(workdir / f"{name}.stdout.txt"), StageLog(workdir / f"{name}.stderr.txt")
    try:
        return seams.current.run(command, out, err, left)
    except seams.MemoryLimit:
        raise  # the container is gone; the caller records the stage's exit
    except OSError as exc:
        err.write(str(exc).encode("utf-8", errors="replace"))
        return 127
    except subprocess.TimeoutExpired as exc:
        _stop(container)
        raise refuse("REPLAY_TIMEOUT", f"the replay exceeded its timeout of {timeout} s in stage {name}",
                     write_status="not_written") from exc
    except BaseException:
        _stop(container)
        raise
    finally:
        out.close()
        err.close()


def _audit_stage(workdir: Path) -> tuple[list[tuple[Path, str, bool]], list[str]]:
    """The auditor's mounts and arguments: the native reports and the coverage receipt in, audit/ out."""
    return ([(workdir / REPORTS, NATIVE_MOUNT, True), (workdir / COVERAGE, AUDIT_COVERAGE_MOUNT, True),
             (workdir / AUDIT, container.REPORTS, False)],
            ["--run", NATIVE_MOUNT, "--output", f"{container.REPORTS}/audit.json"])


def execute(ledger: db.LedgerProfile, trial_id: int, identity: Mapping, mounts: list[tuple[Path, str, bool]],
            workdir: Path, runner_args: list[str], purpose: str, *, table_hashes: bool = False) -> tuple:
    """Run the runner, then (with every report present) the auditor and the fingerprint, each in its
    own named container of one image; seal whatever happened, on a connection of its own: no ledger
    connection spans the containers, so a ledger restart while they run does not stop the seal.

    An interrupt stops the running container and is sealed as interrupted. A research or validation
    capture refused for size is stored as an invalid run with its recovery material before the refusal
    is raised.
    """
    workdir = Path(workdir)
    layout = image.layout(identity["runtime_contract"])
    stages: dict = {"native": None, "audit": None, "fingerprint": None}
    process: dict = {"trial_id": trial_id, "purpose": purpose, "stages": stages, "commands": {}}
    outcome = {"kind": "completed", "detail": None}
    native_exit, audit_exit = None, None

    def record():
        _write_json(workdir / execution.PROCESS, process)

    def run(name: str, module: str, stage_mounts: list, argv: list[str]) -> int:
        named = container_name(ledger, trial_id, name)
        command = seams.current.container_command(dict(identity), stage_mounts, module, list(argv), named)
        process["commands"][name] = command
        stages[name] = {"state": "started", "exit_code": None}
        record()
        try:
            code = _stage(command, named, workdir, name, None, None)
        except seams.MemoryLimit as exc:
            stages[name] = {"state": "exited", "exit_code": exc.exit_code}
            record()
            raise _memory_refusal(name, exc, "written") from exc
        stages[name] = {"state": "exited", "exit_code": code}
        record()
        return code

    failed = False
    try:
        native_exit = run("native", layout["runner_module"], mounts, list(runner_args))
        if _reports_complete(workdir):
            audit_exit = run("audit", layout["audit_module"], *_audit_stage(workdir))
            run("fingerprint", layout["fingerprint_module"], [
                (workdir / REPORTS, NATIVE_MOUNT, True), (workdir / FINGERPRINT, container.REPORTS, False)],
                ["--run", NATIVE_MOUNT, "--output", f"{container.REPORTS}/fingerprint.json"])
    except BaseException as exc:
        failed = True
        interrupted = isinstance(exc, (KeyboardInterrupt, SystemExit))
        detail = f"{exc.code}: {exc.message}" if isinstance(exc, Refusal) else f"{type(exc).__name__}: {exc}"
        outcome = {"kind": "interrupted" if interrupted else "host_failure", "detail": detail}
        raise
    finally:
        try:
            with db.connect(ledger, "writer") as conn:
                execution.seal_capture(conn, trial_id, workdir, stages, outcome, table_hashes=table_hashes)
        except Refusal as refusal:
            if refusal.code == "EXECUTION_CAPTURE_LIMIT":
                _write_json(workdir / execution.HOST_ERROR, refusal.as_dict())
                if purpose in trials.RUN_PURPOSES:
                    with db.connect(ledger, "writer") as conn:
                        trials.ingest_capture_refusal(conn, trial_id, workdir, refusal.as_dict())
            if not failed:
                raise
            print(f"execution capture of trial {trial_id} was refused ({refusal.code}): {refusal.message}",
                  file=sys.stderr)
    return native_exit, audit_exit


# Replays that are no trial

def replay_unrecorded(market, at: str | None, source: bytes, entry_class: str, runtime: str, runner_argv: list[str],
                      output: Path, name: str, timeout: float | None = None) -> dict:
    """Replay a source into `output` (a new temporary directory) as every replay does (pinned image, exported
    inputs, probed configuration, coverage receipt, runner and auditor), but as no trial: nothing reaches a
    ledger. Only replay.comparison calls it (`paper compare`, `live compare` and Live's daily comparison), whose
    source, image, contracts and window come from a Paper or Live run's declaration (user decision 2026-10-26).
    `name` prefixes the stage containers."""
    output = paths.temporary_path(output)
    identity = registration_seams.current.resolve_runtime(runtime)
    exported = None
    try:
        # Fresh, so the export goes with it (registration.inputs.cleanup): on the Paper host the temporary
        # directory persists.
        _, exported = _export(market, at, runner_argv, True, None)
        inspection = registration_seams.current.inspect_runtime(identity, list(runner_argv), exported)
        _, argv, mounts = _prepare(output, source, entry_class, hashlib.sha256(source).hexdigest(), identity,
                                   inspection, exported, runner_argv)
        layout = image.layout(identity["runtime_contract"])
        deadline = None if timeout is None else time.monotonic() + timeout

        def run(stage: str, module: str, stage_mounts: list, stage_argv: list[str]) -> int:
            left = None if deadline is None else max(1.0, deadline - time.monotonic())
            named = re.sub(r"[^A-Za-z0-9_.-]", "-", f"{name}-{stage}")
            command = seams.current.container_command(identity, stage_mounts, module, list(stage_argv), named)
            try:
                return _stage(command, named, output, stage, left, timeout)
            except seams.MemoryLimit as exc:
                raise _memory_refusal(stage, exc, "not_written") from exc

        native_exit = run("native", layout["runner_module"], mounts, argv)
        audit_exit = run("audit", layout["audit_module"], *_audit_stage(output)) if _reports_complete(output) else None
        found = audit_problems(output, native_exit, audit_exit)
        return {"status": "passed" if not found else "invalid", "problems": found, "path": str(output)}
    finally:
        registration_inputs.cleanup(exported)


# Explorations and prechecks

def _check_window(ledger: db.LedgerProfile, market, at: str | None, line: str | None, runner_argv: list[str]) -> None:
    """ledger.lines.check_replay_window for an explore or precheck replay, before anything is exported or written."""
    inputs = registration_seams.runner_inputs(list(runner_argv))
    source = registration_seams.current.market(market)
    market_day = source.resolve_day(at)
    _, latest = source.days(market_day)
    covered = None if line is not None else lines.covered_from(inputs["selection"].get("symbols"),
                                                               source.universe_month(market_day))
    with db.connect(ledger, "reader") as conn:
        lines.check_replay_window(conn, line, inputs["window"]["trade_start"], inputs["window"]["end"], latest,
                                  covered)


def explore(ledger: db.LedgerProfile, market, at: str | None, strategy_file: Path, strategy_class: str, output: Path,
            runtime: str | None, runner_argv: list[str], line: str) -> dict:
    """Replay an unpublished strategy file into a new temporary directory, trading inside the open `line`'s
    development period; the ledger keeps the trial, its start receipt and its execution capture."""
    output = paths.temporary_path(output)
    if not isinstance(strategy_class, str) or not strategy_class.isidentifier():
        raise refuse("ENTRY_CLASS_INVALID", f"{strategy_class!r} is not one Python class name")
    registration_seams.require_unreserved(list(runner_argv))
    _check_window(ledger, market, at, line, runner_argv)
    source = Path(strategy_file).read_bytes()
    revision = {"source": source, "entry_class": strategy_class, "source_sha256": hashlib.sha256(source).hexdigest()}
    identity = registration_seams.current.resolve_runtime(runtime)
    exported = None
    try:
        runner, exported = _export(market, at, runner_argv, False, ledger)
        inspection = registration_seams.current.inspect_runtime(identity, list(runner_argv), exported)
        registration_seams.current.require_ci_build(dict(identity), dict(inspection))
        trial_id, argv, mounts = stage_trial(ledger, output, "explore", revision, identity, inspection, exported,
                                             runner_argv, runner["window"])
        found = audit_problems(output, *execute(ledger, trial_id, identity, mounts, output, argv, "explore"))
        return {"purpose": "explore", "status": "passed" if not found else "invalid", "problems": found,
                "path": str(output), "trial_id": trial_id, "image_ref": identity["image_ref"],
                "market": exported["identity"], "metrics": _directory_report(output)}
    finally:
        registration_inputs.cleanup(exported)


def precheck(ledger: db.LedgerProfile, market, at: str, candidate: str, runtime: str | None, runner_argv: list[str],
             output: Path, line: str | None = None) -> dict:
    """A declared native precheck of a published candidate, trading inside `line`'s development period, or
    without a line (a start candidate's) inside the one a line opened today would get; nothing starts before its
    trial commits."""
    with db.connect(ledger, "reader") as conn:
        revision = strategies.read_candidate(conn, candidate)
    output = paths.temporary_path(output)
    registration_seams.require_unreserved(list(runner_argv))
    _check_window(ledger, market, at, line, runner_argv)
    window = registration_seams.runner_inputs(list(runner_argv))["window"]
    trading_days = (window["end"] - window["trade_start"]) / (86_400 * 10**9)
    if trading_days > source_precheck.PRECHECK_MAX_DAYS:
        raise refuse("PRECHECK_WINDOW_TOO_LONG", f"the trading window is {trading_days:g} days; a precheck trades at "
                                                 f"most {source_precheck.PRECHECK_MAX_DAYS}",
                     missing=("--end",), expected=f"at most {source_precheck.PRECHECK_MAX_DAYS} trading days")
    identity = _resolve_runtime(revision, runtime)
    exported = None
    try:
        runner, exported = _export(market, at, runner_argv, True, ledger)
        exposure = {"trading_days": trading_days, "maximum_exempt_days": source_precheck.PRECHECK_MAX_DAYS,
                    "note": "Only this registration's cited precheck with matching source, runtime, inputs and "
                            "configuration can be exempt; a technical pass alone does not grant exemption."}
        inspection = registration_seams.current.inspect_runtime(identity, list(runner_argv), exported)
        registration_seams.current.require_ci_build(dict(identity), dict(inspection))
        config_sha256 = trials.comparable_config_sha256(inspection.get("effective_config"))
        trial_id, argv, mounts = stage_trial(ledger, output, "precheck", revision, identity, inspection, exported,
                                             runner_argv, runner["window"])
        found = audit_problems(output, *execute(ledger, trial_id, identity, mounts, output, argv, "precheck"))
        return {"purpose": "precheck", "trial_id": trial_id,
                "source_sha256": revision["source_sha256"], "image_ref": identity["image_ref"],
                "export_sha256": exported["identity"]["export_content_sha256"],
                "comparable_config_sha256": config_sha256,
                "status": "passed" if not found else "failed", "problems": found, "path": str(output),
                "metrics": _directory_report(output), "scope": PRECHECK_SCOPE,
                "exposure_exemption": exposure}
    finally:
        registration_inputs.cleanup(exported)


# Sealed research and validation replays

def run(ledger: db.LedgerProfile, market, at: str | None, strategy: str, runtime: str | None, runner_argv: list[str],
        registration: int | None = None, validation: int | None = None, output: Path | None = None) -> dict:
    """A sealed research (`registration`) or validation replay of a published candidate, stored as a run;
    `output` (new, under the temporary root) keeps its working directory as a cache."""
    if (registration is None) == (validation is None):
        raise refuse("REGISTRATION_REQUIRED", "give exactly one of a research or a validation registration",
                     expected="registration xor validation")
    registration_seams.require_unreserved(list(runner_argv))
    if output is not None:
        output = paths.temporary_path(output)
    if validation is not None:
        registration_seams.require_fresh()
    else:
        registration_seams.require_current()
    with db.connect(ledger, "writer") as conn:
        revision = strategies.read_candidate(conn, strategy)
    exported = None
    try:
        _, exported = _export(market, at, runner_argv, True, ledger)
        sealed = seal(ledger, revision, runtime, exported, runner_argv, registration, validation, market=market,
                      output=output)
    finally:
        registration_inputs.cleanup(exported)
    return {"purpose": "research" if registration is not None else "validation", "strategy": strategy, **sealed}


def seal(ledger: db.LedgerProfile, revision: Mapping, runtime: str | None, inputs: Mapping, runner_argv: list[str],
         registration: int | None, validation: int | None, *, market=None, output: Path | None = None,
         history: int | None = None, comparable_config: str | None = None) -> dict:
    """Bind, execute and store one sealed replay: of a research registration, a validation registration or
    the closing history test of the line `history`; the working directory is deleted once stored unless it
    is `output` (new, under the temporary root), kept as a cache that report.tables checks against the
    sealed capture. A history segment gives the comparable configuration hash of the run it replays
    (trials.comparable_config_sha256), which the probed configuration must have.

    The ledger derives the run's status from the sealed capture (ledger.ingest_run); this entry adds
    only what the host saw outside it (inputs changed during the replay).
    """
    if (registration is not None) + (validation is not None) + (history is not None) != 1:
        raise refuse("REGISTRATION_REQUIRED", "give exactly one of a research registration, a validation "
                                              "registration or a history line",
                     expected="registration xor validation xor history")
    checkout = registration_seams.current.checkout()
    metrics.product_commit(checkout)  # a passed run records it; outside a checkout this raises before any trial
    identity = _resolve_runtime(revision, runtime)
    inspection = registration_seams.current.inspect_runtime(identity, list(runner_argv), inputs)
    found_config = trials.comparable_config_sha256(inspection.get("effective_config"))  # malformed: refused here
    if comparable_config is not None and found_config != comparable_config:
        raise refuse("REPRODUCTION_CONFIG_DIFFERS", "the effective configuration differs from the one of the run this "
                                                    "history segment replays", missing=("effective_config",))
    semantic = registration_inputs.export_fingerprint(inputs, semantic=True)["export_content_sha256"]
    if semantic != inputs["identity"].get("export_content_sha256"):
        raise refuse("EXPORT_CHANGED_BEFORE_EXECUTION", "the exported inputs changed after their identity was taken",
                     missing=("export_content_sha256",))
    raw_before = registration_inputs.export_fingerprint(inputs, semantic=False)["export_content_sha256"]
    runner = registration_seams.runner_inputs(list(runner_argv))
    if output is not None:
        workdir = paths.temporary_path(output)
        workdir.mkdir(mode=0o700, parents=True)
    else:
        workdir = Path(tempfile.mkdtemp(prefix="replay-run-", dir=WORK_ROOT))
    try:
        source_sha256 = revision["source_sha256"]
        binder: trials.Binder
        if registration is not None:
            purpose, binder = "research", register.binder(registration, source_sha256)
        elif history is not None:
            purpose, binder = "history", lines.HistoryBinder(history)
        else:
            assert validation is not None  # REGISTRATION_REQUIRED above refuses neither or both
            purpose = "validation"
            binder = registration_validation.validation_binder(validation, source_sha256, _identity4(identity),
                                                               inspection, market=market)
        trial_id, argv, mounts = stage_trial(ledger, workdir, purpose, revision, identity, inspection, inputs,
                                             runner_argv, runner["window"], binder)
        try:
            execute(ledger, trial_id, identity, mounts, workdir, argv, purpose)
        except Refusal as exc:
            with db.connect(ledger, "writer") as conn:
                stored = conn.one("SELECT trial_id, status, failure_reasons FROM run WHERE trial_id = %s", (trial_id,))
            if exc.code != "EXECUTION_CAPTURE_LIMIT" or stored is None:
                raise
            print(f"replay directory kept for diagnosis (capture refused for size): {workdir}", file=sys.stderr)
            return {"trial_id": trial_id, "image_ref": identity["image_ref"], **trials.run_record(stored)}
        host = []
        if registration_inputs.export_fingerprint(inputs, semantic=False)["export_content_sha256"] != raw_before:
            host.append(problems.reason("INPUTS_CHANGED", "exported inputs changed during the replay",
                                        "export_content_sha256"))
        with db.connect(ledger, "writer") as conn:
            stored = trials.ingest_run(conn, trial_id, workdir, inputs["identity"], host_reasons=host,
                                       checkout=checkout)
    except BaseException:
        if (workdir / execution.PROCESS).exists():
            print(f"replay directory kept for diagnosis: {workdir}", file=sys.stderr)
        else:  # no container started: nothing in it to diagnose
            shutil.rmtree(workdir, ignore_errors=True)
        raise
    found = {"trial_id": trial_id, "status": stored["status"],
             "failure_reasons": stored["failure_reasons"], "image_ref": identity["image_ref"]}
    if output is None:
        shutil.rmtree(workdir, ignore_errors=True)
        return found
    return {**found, "path": str(workdir)}
