"""Freeze one native R1 replay and keep its bytes in a local artifact directory.

This is custody for research evidence, not a backtest engine or strategy gate.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import os
import re
import shutil
import stat
import subprocess
import sys
import uuid
from datetime import datetime
from pathlib import Path, PurePosixPath

from research.records.common import ROOT
from research.records.common import RecordError
from research.records.common import _is_temporary_path
from research.records.common import _read_json
from research.records.common import _validator


RUN_ID = re.compile(r"^[A-Za-z0-9-]+$")
IDENTITY_ALGORITHM = (
    "SHA-256 over each sorted relative POSIX path as 4-byte big-endian "
    "length + path UTF-8 + SHA-256 of file bytes; tree digest is SHA-256 "
    "of concatenated records"
)
REPORTS = (
    "summary.json",
    "orders.csv",
    "fills.csv",
    "positions.csv",
    "account.csv",
    "returns_series.csv",
)
SOURCE_DIGEST_FILES = {
    "strategy_source_sha256": "strategy.py",
    "staged_strategy_source_sha256": "r1s_strategy.py",
    "trendline_strategy_source_sha256": "trendline_strategy.py",
    "retracement_strategy_source_sha256": "retracement_strategy.py",
    "tiered_strategy_source_sha256": "tiered_retracement_strategy.py",
    "broad_swing_signal_source_sha256": "broad_swing_signal.py",
    "runner_source_sha256": "run_portfolio.py",
}
LEGACY_RUNNER = "strategies/r1/run_portfolio.py"
LEGACY_AUDIT = "strategies/r1/audit_tiered_native.py"
MODULE_RUNNER = "backtest/r1/run_portfolio.py"
MODULE_AUDIT = "backtest/r1/checks/audit_tiered_native.py"
MODULE_DIGEST_FILES = {
    **{field: f"research/r1_variants/{name}" for field, name in SOURCE_DIGEST_FILES.items()
       if field not in {"strategy_source_sha256", "runner_source_sha256"}},
    **{f"{name}_strategy_source_sha256": f"research/r1_variants/{name}_strategy.py"
       for name in ("brooks_confirmed", "failed_range_breakout", "gap_runner", "structural_support")},
    **{f"{name}_source_sha256": f"backtest/r1/{name}.py"
       for name in ("native_node", "node_strategy", "replay_inputs", "replay_util", "stop_entry")},
    "runner_source_sha256": MODULE_RUNNER,
}


class ArtifactError(Exception):
    pass


def _private_root(root: Path) -> Path:
    if root.is_symlink():
        raise ArtifactError(f"artifact root must not be a symlink: {root}")
    if root.resolve().is_relative_to(ROOT.resolve()) or _is_temporary_path(root):
        raise ArtifactError("artifact root must be outside Git and /tmp or the system temp directory")
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    info = root.stat()
    mode = stat.S_IMODE(info.st_mode)
    if info.st_uid != os.geteuid() or mode != 0o700:
        raise ArtifactError(
            f"artifact root must be owned by this user and private (0700): {root}"
        )
    return root.resolve()


def _private_tree(root: Path) -> None:
    for path in root.rglob("*"):
        if path.is_symlink():
            raise ArtifactError(f"artifact symlink is forbidden: {path}")
        path.chmod(0o700 if path.is_dir() else 0o600)
    root.chmod(0o700)


def _sha(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _tree(root: Path) -> tuple[str, int, int]:
    if not root.is_dir():
        raise ArtifactError(f"missing input Catalog: {root}")
    digest = hashlib.sha256()
    count = size = 0
    for path in sorted(root.rglob("*")):
        if path.is_symlink():
            raise ArtifactError(f"input Catalog has a symlink: {path}")
        if not path.is_file():
            continue
        name = path.relative_to(root).as_posix().encode()
        digest.update(len(name).to_bytes(4, "big"))
        digest.update(name)
        digest.update(bytes.fromhex(_sha(path)))
        count += 1
        size += path.stat().st_size
    return digest.hexdigest(), count, size


def _runner_inputs(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--catalog-root", type=Path, required=True)
    parser.add_argument("--daily-root", type=Path, required=True)
    parser.add_argument("--quantity-csv", type=Path, required=True)
    parser.add_argument("--coins", nargs="+", required=True)
    parser.add_argument("--signal-variant", default="daily-pivot")
    if "--output" in argv:
        raise ArtifactError("the custody command owns --output")
    args, _ = parser.parse_known_args(argv)
    if len(args.coins) != len(set(args.coins)):
        raise ArtifactError("duplicate replay coins")
    return args


def _check_inputs(identity: dict, replay: argparse.Namespace) -> dict:
    if identity.get("digest_algorithm") != IDENTITY_ALGORITHM:
        raise ArtifactError("unsupported input identity algorithm")
    if _sha(replay.quantity_csv) != identity["quantity_csv_sha256"]:
        raise ArtifactError("quantity CSV differs from input identity")
    coins = {row["coin"]: row for row in identity["coins"]}
    checked = {}
    for coin in replay.coins:
        if coin not in coins:
            raise ArtifactError(f"{coin}: missing from input identity")
        checked[coin] = {}
        for label, root, leaf in (
            ("minute_catalog", replay.catalog_root, "minute"),
            ("daily_catalog", replay.daily_root, "daily"),
        ):
            actual = _tree(root / coin / leaf)
            expected = coins[coin][label]
            if actual != (expected["sha256"], expected["files"], expected["bytes"]):
                raise ArtifactError(f"{coin}: {label} bytes differ from input identity")
            checked[coin][label] = expected["sha256"]
    return checked


def create_input_identity(
    *,
    catalog_root: Path,
    daily_root: Path,
    quantity_csv: Path,
    coins: list[str],
    output: Path,
) -> dict:
    if output.exists():
        raise ArtifactError(f"input identity already exists: {output}")
    if not coins or len(coins) != len(set(coins)):
        raise ArtifactError("input identity needs unique coins")
    rows = []
    for coin in coins:
        row = {"coin": coin}
        for label, root, leaf in (
            ("minute_catalog", catalog_root, "minute"),
            ("daily_catalog", daily_root, "daily"),
        ):
            digest, count, size = _tree(root / coin / leaf)
            row[label] = {"sha256": digest, "files": count, "bytes": size}
        rows.append(row)
    identity = {
        "digest_algorithm": IDENTITY_ALGORITHM,
        "minute_catalog_root": str(catalog_root.resolve()),
        "daily_catalog_root": str(daily_root.resolve()),
        "quantity_csv_sha256": _sha(quantity_csv),
        "coins": rows,
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    _write_json(output, identity, exclusive=True)
    return {"path": str(output), "sha256": _sha(output), "coins": len(rows)}


def _git(*args: str) -> bytes:
    result = subprocess.run(["git", *args], cwd=ROOT, capture_output=True, check=False)
    if result.returncode:
        raise ArtifactError(f"git {args[0]} failed: {result.stderr.decode().strip()}")
    return result.stdout


def _safe_source_path(value: str) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9_./-]+", value):
        raise ArtifactError(f"unsafe frozen source path: {value!r}")
    path = PurePosixPath(value)
    if path.is_absolute() or any(part in {".", ".."} for part in path.parts) or path.as_posix() != value:
        raise ArtifactError(f"unsafe frozen source path: {value!r}")
    return value


def _source_layout(paths: set[str]) -> str:
    legacy = LEGACY_RUNNER in paths
    module = MODULE_RUNNER in paths
    if legacy and module:
        raise ArtifactError("frozen source contains conflicting native R1 layouts")
    if module:
        if "strategies/r1.py" not in paths:
            raise ArtifactError("module R1 layout has no standalone strategy source")
        return "module"
    if legacy:
        return "legacy"
    raise ArtifactError("source commit has no native R1 runner")


def _snapshot_source(ref: str, stage: Path) -> str:
    """Capture the known R1 source layout and dependency pins from one commit."""
    commit = _git("rev-parse", "--verify", f"{ref}^{{commit}}").decode().strip()
    entries = {}
    for record in _git("ls-tree", "-r", "-z", commit).split(b"\0"):
        if record:
            metadata, name = record.decode().split("\t", 1)
            entries[name] = metadata.split()[0]
    layout = _source_layout(set(entries))
    roots = ("backtest/r1/", "research/r1_variants/") if layout == "module" else ("strategies/r1/",)
    paths = set()
    for root in roots:
        found = {name for name in entries if name.startswith(root) and name.endswith(".py")}
        if not found:
            raise ArtifactError(f"source commit has no R1 Python source root: {root}")
        paths.update(found)
    if layout == "module":
        paths.add("strategies/r1.py")
        if MODULE_AUDIT not in entries:
            raise ArtifactError("module R1 layout has no native audit source")
        paths.update(name for name in ("backtest/__init__.py", "research/__init__.py", "strategies/__init__.py")
                     if name in entries)
    paths.update(("pyproject.toml", "uv.lock"))
    for name in sorted(paths):
        _safe_source_path(name)
        if entries.get(name) not in {"100644", "100755"}:
            raise ArtifactError(f"frozen source is not a regular Git file: {name}")
        target = stage / "source" / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(_git("show", f"{commit}:{name}"))
    return commit


def _source_command(source: Path, *, audit: bool = False) -> list[str]:
    paths = {path.relative_to(source).as_posix() for path in source.rglob("*.py")}
    if _source_layout(paths) == "module":
        module = "backtest.r1.checks.audit_tiered_native" if audit else "backtest.r1.run_portfolio"
        return [sys.executable, "-m", module]
    return [sys.executable, str(source / (LEGACY_AUDIT if audit else LEGACY_RUNNER))]


def _absolute_runner_args(argv: list[str]) -> list[str]:
    """Retain input locations when executing from the frozen source directory."""
    options = {"--catalog-root", "--daily-root", "--quantity-csv", "--mark-root"}
    result = list(argv)
    for index, value in enumerate(argv):
        if value in options and index + 1 < len(argv):
            result[index + 1] = str(Path(argv[index + 1]).resolve())
        elif value.split("=", 1)[0] in options and "=" in value:
            option, path = value.split("=", 1)
            result[index] = option + "=" + str(Path(path).resolve())
    return result


def _summary_source_files(
    stage: Path, summary: dict | None, runner_args: list[str] | None = None,
) -> dict[str, str]:
    source = stage / "source"
    if summary is None:
        if (source / MODULE_RUNNER).is_file():
            # A failure before summary still has a frozen source identity.
            # Record captured modules; no claim about executed rules is made.
            paths = {path.relative_to(source).as_posix() for path in source.rglob("*.py")}
            _source_layout(paths)
            if runner_args is None:
                raise ArtifactError("failed module R1 seal has no frozen runner arguments")
            parser = argparse.ArgumentParser(add_help=False)
            parser.add_argument("--signal-variant", default="daily-pivot")
            requested, _ = parser.parse_known_args(runner_args)
            strategy = "strategies/r1.py" if requested.signal_variant == "support-broad-two-tier-4h" else "research/r1_variants/strategy.py"
            if strategy not in paths:
                raise ArtifactError(f"failed module R1 seal has no requested strategy source: {strategy}")
            files = {"strategy_source_sha256": strategy, **MODULE_DIGEST_FILES}
            return {field: name for field, name in files.items() if name in paths}
        # Preserve partial failed legacy seals used by historical registration.
        return {field: f"strategies/r1/{name}" for field, name in SOURCE_DIGEST_FILES.items()
                if (source / "strategies" / "r1" / name).is_file()}
    if "source_file_paths" not in summary:
        if (source / MODULE_RUNNER).is_file() or (source / "strategies/r1.py").is_file():
            raise ArtifactError("module R1 summary has no source_file_paths")
        return {field: f"strategies/r1/{name}" for field, name in SOURCE_DIGEST_FILES.items()
                if summary.get(field) is not None}
    paths = {path.relative_to(source).as_posix() for path in source.rglob("*.py")}
    if _source_layout(paths) != "module":
        raise ArtifactError("source_file_paths disagrees with frozen source layout")
    files = summary["source_file_paths"]
    fields = {field for field, value in summary.items()
              if field.endswith("_source_sha256") and value is not None}
    if not isinstance(files, dict) or set(files) != fields:
        raise ArtifactError("source_file_paths must name every non-null source digest exactly once")
    if not {"strategy_source_sha256", "runner_source_sha256"}.issubset(fields):
        raise ArtifactError("module R1 summary has no strategy or runner source digest")
    if files.get("runner_source_sha256") != MODULE_RUNNER:
        raise ArtifactError("source_file_paths differs from frozen native runner")
    for field, name in files.items():
        name = _safe_source_path(name)
        if name not in paths or not (name == "strategies/r1.py" or name.startswith(("backtest/r1/", "research/r1_variants/"))):
            raise ArtifactError(f"source_file_paths has no frozen R1 Python source: {field}: {name}")
        allowed = {"strategies/r1.py", "research/r1_variants/strategy.py"} if field == "strategy_source_sha256" else {MODULE_DIGEST_FILES.get(field)}
        if name not in allowed:
            raise ArtifactError(f"source_file_paths disagrees with digest field: {field}: {name}")
    return dict(files)


def _check_source_summary(stage: Path, summary: dict) -> None:
    if (stage / "source" / "binding.json").is_file():
        _check_dolt_summary(stage, summary)
        return
    for field, name in _summary_source_files(stage, summary).items():
        path = stage / "source" / name
        if not path.is_file() or path.is_symlink() or _sha(path) != summary[field]:
            raise ArtifactError(f"native summary differs from frozen {name}")


def _config_sha(value: dict) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"),
                                     ensure_ascii=False, allow_nan=False).encode()).hexdigest()


def _check_dolt_summary(stage: Path, summary: dict) -> None:
    binding = _read_json(stage / "source" / "binding.json")
    execution = _read_json(stage / "source" / "execution.json")
    probe = _read_json(stage / "runtime-inspection.json")
    path = stage / "source" / "strategy.py"
    if path.is_symlink() or not path.is_file() or _sha(path) != binding["source_sha256"]:
        raise ArtifactError("frozen strategy bytes differ from Dolt binding")
    expected = {"strategy_source_sha256": binding["source_sha256"], **probe["source_files_sha256"]}
    actual = {field: digest for field, digest in summary.items()
              if field.endswith("_source_sha256") and digest is not None}
    if actual != expected:
        raise ArtifactError("native summary differs from frozen strategy or observed image code hashes")
    if summary.get("source_file_paths") != probe["source_file_paths"]:
        raise ArtifactError("native runtime source paths differ from observed image")
    if summary.get("strategy_binding") != binding:
        raise ArtifactError("native summary differs from frozen Dolt strategy binding")
    if summary.get("runtime_identity") != execution["runtime_identity"]:
        raise ArtifactError("native summary differs from pinned OCI runtime identity")
    if summary.get("effective_config_sha256") != execution["effective_config_sha256"]:
        raise ArtifactError("native summary differs from frozen effective configuration")
    config = execution["effective_config"]
    if _config_sha(config) != execution["effective_config_sha256"]:
        raise ArtifactError("frozen effective configuration hash mismatch")
    for field, key in (("input_start_utc", "start"), ("period_start_utc", "trade_start"),
                       ("period_end_utc", "end")):
        if field in summary and key in config and datetime.fromisoformat(summary[field]) != datetime.fromisoformat(config[key]):
            raise ArtifactError(f"native summary differs from effective configuration: {key}")


def _container_runner_args(argv: list[str], replay: argparse.Namespace) -> tuple[list[str], list[tuple[Path, str, bool]]]:
    replacements = {"--catalog-root": (replay.catalog_root, "/inputs/catalog"),
                    "--daily-root": (replay.daily_root, "/inputs/daily"),
                    "--quantity-csv": (replay.quantity_csv, "/inputs/quantity.csv")}
    denied = {"--strategy-file", "--strategy-class", "--strategy-sha256", "--strategy-binding", "--execution-binding", "--output"}
    result = list(argv)
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--mark-root", type=Path)
    args, _ = parser.parse_known_args(argv)
    if args.mark_root is not None:
        replacements["--mark-root"] = (args.mark_root, "/inputs/mark")
    for index, value in enumerate(argv):
        option = value.split("=", 1)[0]
        if option in denied:
            raise ArtifactError(f"the custody command owns {option}")
        if option in replacements:
            target = replacements[option][1]
            if "=" in value:
                result[index] = option + "=" + target
            elif index + 1 < len(result):
                result[index + 1] = target
    return result, [(path, target, True) for path, target in replacements.values()]


def _dolt_source(strategy_id: str, revision: int, at: str, runtime: Path,
                 runner_args: list[str], replay: argparse.Namespace) -> tuple[dict, bytes, dict, dict, list[str], list]:
    from research.records.store import open_store
    from research.records.strategies import resolve
    from research.records.runtime import inspect_runtime, validate_identity
    store = open_store()
    if not hasattr(store, "adapter"):
        raise ArtifactError("strategy custody requires the Dolt source owner")
    resolved = resolve(store.adapter, strategy_id, revision, at)
    binding = resolved["binding"]
    identity = validate_identity(_read_json(runtime))
    if binding["runtime_contract"] != identity["runtime_contract"]:
        raise ArtifactError("strategy and image runtime contracts differ")
    argv, mounts = _container_runner_args(runner_args, replay)
    observed = inspect_runtime(identity, argv)
    return binding, resolved["source_bytes"], identity, observed, argv, mounts


def _files(stage: Path) -> dict[str, dict]:
    result = {}
    for path in sorted(stage.rglob("*")):
        if path.is_symlink():
            raise ArtifactError(f"artifact symlink is forbidden: {path}")
        if not path.is_file() or path == stage / "manifest.json":
            continue
        result[path.relative_to(stage).as_posix()] = {
            "sha256": _sha(path),
            "bytes": path.stat().st_size,
        }
    return result


def _write_json(path: Path, value: dict, *, exclusive: bool = False) -> None:
    with path.open("x" if exclusive else "w", encoding="utf-8") as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())


def _sync_tree(root: Path) -> None:
    for path in root.rglob("*"):
        if path.is_file():
            with path.open("rb") as stream:
                os.fsync(stream.fileno())
    for path in sorted((p for p in root.rglob("*") if p.is_dir()), reverse=True):
        fd = os.open(path, os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    fd = os.open(root, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def _attempt_snapshot(attempt_id: str, binding=None):
    from research.records.store import open_store
    store = open_store()
    if not hasattr(store, "registration_snapshot"):
        raise ArtifactError("registered native custody requires the Dolt metadata owner")
    try:
        return store.registration_snapshot(attempt_id, binding)
    except RecordError as exc:
        raise ArtifactError(str(exc)) from exc


def _attempt(attempt_id: str) -> dict:
    return _attempt_snapshot(attempt_id)[0]


def run(
    *,
    root: Path,
    run_id: str,
    attempt_id: str,
    source_ref: str | None = None,
    strategy_id: str | None = None,
    strategy_revision: int | None = None,
    source_at: str | None = None,
    runtime: Path | None = None,
    input_identity: Path,
    runner_argv: list[str],
) -> dict:
    if not RUN_ID.fullmatch(run_id):
        raise ArtifactError("run ID must use letters, digits and hyphens")
    modern = strategy_id is not None
    if bool(source_ref) == modern:
        raise ArtifactError("choose exactly one Git source_ref or Dolt strategy_id")
    if modern and (strategy_revision is None or source_at is None or runtime is None):
        raise ArtifactError("Dolt strategy run requires strategy_revision, source_at and runtime")
    if not modern and any(value is not None for value in (strategy_revision, source_at, runtime)):
        raise ArtifactError("Git source_ref cannot be combined with Dolt or OCI arguments")
    attempt, record_binding = _attempt_snapshot(attempt_id)
    replay = _runner_inputs(runner_argv)
    prepared = _dolt_source(strategy_id, strategy_revision, source_at, runtime, runner_argv, replay) if modern else None
    if modern and attempt.get("strategy_binding") != prepared[0]:
        raise ArtifactError("preregistered attempt does not bind the requested frozen strategy")
    identity = _read_json(input_identity)
    identity_digest = _sha(input_identity)
    checked_before = _check_inputs(identity, replay)
    root = root.absolute()
    root = _private_root(root)
    target = root / run_id
    if target.exists():
        raise ArtifactError(f"run ID already sealed: {run_id}")
    locks = root / ".locks"
    staging = root / ".staging"
    locks.mkdir(mode=0o700, exist_ok=True)
    staging.mkdir(mode=0o700, exist_ok=True)
    lock = locks / run_id
    try:
        lock.mkdir(mode=0o700)
    except FileExistsError as exc:
        raise ArtifactError(f"run ID is already in progress: {run_id}") from exc
    stage = staging / f"{run_id}-{uuid.uuid4().hex}"
    stage.mkdir(mode=0o700)
    try:
        if modern:
            from research.records.runtime import container_command
            strategy_binding, source_bytes, runtime_identity, runtime_inspection, effective_args, mounts = prepared
            frozen_source = stage / "source"
            frozen_source.mkdir()
            (frozen_source / "strategy.py").write_bytes(source_bytes)
            if _sha(frozen_source / "strategy.py") != strategy_binding["source_sha256"]:
                raise ArtifactError("resolved strategy bytes differ from Dolt binding")
            _write_json(frozen_source / "binding.json", strategy_binding)
            effective_config = runtime_inspection["effective_config"]
            execution = {"runtime_identity": runtime_identity, "effective_config": effective_config,
                         "effective_config_sha256": _config_sha(effective_config)}
            _write_json(frozen_source / "execution.json", execution)
            _write_json(stage / "runtime-inspection.json", runtime_inspection)
        else:
            commit = _snapshot_source(source_ref, stage)
        shutil.copyfile(input_identity, stage / "input-identity.json")
        if _sha(stage / "input-identity.json") != identity_digest:
            raise ArtifactError("input identity changed during source capture")
        (stage / "reports").mkdir()
        frozen_source = stage / "source"
        if modern:
            mounts += [(frozen_source, "/strategy", True), (stage / "reports", "/reports", False)]
            native_command = container_command(runtime_identity, mounts, "backtest.r1.run_portfolio", [
                *effective_args, "--strategy-file", "/strategy/strategy.py", "--strategy-class", strategy_binding["entry_class"],
                "--strategy-sha256", strategy_binding["source_sha256"], "--strategy-binding", "/strategy/binding.json",
                "--execution-binding", "/strategy/execution.json", "--output", "/reports",
            ])
        else:
            native_command = [*_source_command(frozen_source), *_absolute_runner_args(runner_argv),
                              "--output", str(stage / "reports")]
        with (
            (stage / "native.stdout.txt").open("wb") as out,
            (stage / "native.stderr.txt").open("wb") as err,
        ):
            try:
                native = subprocess.run(native_command, cwd=frozen_source, stdout=out, stderr=err)
            except OSError as exc:
                err.write(str(exc).encode())
                native = subprocess.CompletedProcess(native_command, 127)
        audit_exit = None
        if (modern or replay.signal_variant.startswith(
            ("support-three-tier", "support-deep-two-tier", "support-broad-two-tier")
        )) and all((stage / "reports" / name).is_file() for name in REPORTS):
            if modern:
                audit_command = container_command(runtime_identity, mounts, "backtest.r1.checks.audit_tiered_native", [
                    "--run", "/reports", "--catalog-root", "/inputs/catalog", "--output", "/reports/audit.json",
                ])
            else:
                audit_command = [*_source_command(frozen_source, audit=True), "--run", str(stage / "reports"),
                                 "--catalog-root", str(replay.catalog_root.resolve()), "--output", str(stage / "reports" / "audit.json")]
            with (
                (stage / "audit.stdout.txt").open("wb") as out,
                (stage / "audit.stderr.txt").open("wb") as err,
            ):
                try:
                    audit_exit = subprocess.run(audit_command, cwd=frozen_source, stdout=out, stderr=err).returncode
                except OSError as exc:
                    err.write(str(exc).encode())
                    audit_exit = 127
        problems = []
        try:
            checked_after = _check_inputs(identity, replay)
            if checked_after != checked_before:
                problems.append("inputs changed during replay")
        except (ArtifactError, OSError, KeyError) as exc:
            problems.append(str(exc))
        summary_path = stage / "reports" / "summary.json"
        try:
            summary = _read_json(summary_path) if summary_path.is_file() else None
        except RecordError as exc:
            summary = None
            problems.append(str(exc))
        if summary is None:
            problems.append("native summary missing")
        else:
            try:
                _check_source_summary(stage, summary)
            except (ArtifactError, KeyError, ValueError, TypeError) as exc:
                problems.append(str(exc))
            if not summary.get("integrity_passed"):
                problems.append("native runner integrity failed")
        if native.returncode:
            problems.append(f"native runner exited {native.returncode}")
        if audit_exit is None:
            problems.append("independent native audit unavailable")
        elif audit_exit:
            problems.append(f"independent native audit exited {audit_exit}")
        audit_path = stage / "reports" / "audit.json"
        if audit_path.is_file():
            try:
                audit = _read_json(audit_path)
                if not audit.get("passed") or audit.get("findings"):
                    problems.append("independent native audit found problems")
            except RecordError as exc:
                problems.append(str(exc))
        else:
            problems.append("independent native audit report missing")
        manifest = {
            "schema_version": 1,
            "run_id": run_id,
            "attempt_id": attempt_id,
            "record_binding": record_binding,
            "status": "passed" if not problems else "failed",
            "problems": problems,
            "nautilus_version": runtime_inspection["nautilus_version"] if modern else importlib.metadata.version("nautilus_trader"),
            "python_version": runtime_inspection["python_version"] if modern else sys.version.split()[0],
            "dependency_lock_sha256": runtime_inspection["dependency_lock_sha256"] if modern else _sha(stage / "source" / "uv.lock"),
            "input_identity_sha256": _sha(stage / "input-identity.json"),
            "input_catalogs_checked": checked_before,
            "runner_args": runner_argv,
            "native_exit_code": native.returncode,
            "audit_exit_code": audit_exit,
            "files": _files(stage),
        }
        if modern:
            manifest.update(schema_version=2, strategy_binding=strategy_binding, runtime_identity=runtime_identity,
                            effective_runner_args=effective_args, effective_config=effective_config,
                            effective_config_sha256=execution["effective_config_sha256"])
        else:
            manifest["source_commit"] = commit
        _write_json(stage / "manifest.json", manifest)
        _private_tree(stage)
        _sync_tree(stage)
        if target.exists():
            raise ArtifactError(f"run ID already sealed: {run_id}")
        os.rename(stage, target)
        fd = os.open(root, os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
        return {
            "run_id": run_id,
            "status": manifest["status"],
            "problems": problems,
            "manifest_sha256": _sha(target / "manifest.json"),
            "path": str(target),
        }
    finally:
        if stage.exists():
            quarantine = root / ".quarantine"
            quarantine.mkdir(mode=0o700, exist_ok=True)
            os.rename(stage, quarantine / stage.name)
        lock.rmdir()


def verify(root: Path, run_id: str) -> dict:
    if not RUN_ID.fullmatch(run_id):
        raise ArtifactError("invalid run ID")
    path = root.resolve() / run_id
    manifest = _read_json(path / "manifest.json")
    if manifest.get("run_id") != run_id or manifest.get("schema_version") not in {1, 2}:
        raise ArtifactError("manifest identity mismatch")
    actual = _files(path)
    if actual != manifest["files"]:
        raise ArtifactError("sealed file set or SHA-256 differs from manifest")
    if manifest["schema_version"] == 2:
        from research.records.runtime import SOURCE_PATHS, validate_identity
        binding = _read_json(path / "source/binding.json")
        errors = list(_validator("strategy_binding").iter_errors(binding))
        if errors or binding != manifest.get("strategy_binding"):
            raise ArtifactError("sealed Dolt strategy binding mismatch")
        if _sha(path / "source/strategy.py") != binding["source_sha256"]:
            raise ArtifactError("sealed strategy bytes differ from Dolt binding")
        runtime = validate_identity(manifest["runtime_identity"])
        execution = _read_json(path / "source/execution.json")
        inspection = _read_json(path / "runtime-inspection.json")
        if "source_commit" in manifest:
            raise ArtifactError("Dolt/OCI seal must not invent a Git source commit")
        expected = {"runtime_identity": runtime, "effective_config": manifest["effective_config"],
                    "effective_config_sha256": manifest["effective_config_sha256"]}
        if execution != expected or _config_sha(execution["effective_config"]) != execution["effective_config_sha256"]:
            raise ArtifactError("sealed effective configuration mismatch")
        if inspection["effective_config"] != execution["effective_config"] or inspection["platform"] != runtime["platform"]:
            raise ArtifactError("sealed image probe differs from execution contract")
        if binding["runtime_contract"] != runtime["runtime_contract"] or inspection["runtime_contract"] != runtime["runtime_contract"]:
            raise ArtifactError("sealed strategy and image contracts differ")
        if inspection["source_file_paths"] != SOURCE_PATHS or set(inspection["source_files_sha256"]) != set(SOURCE_PATHS):
            raise ArtifactError("sealed image probe omits native runtime source identities")
        if any(not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{64}", value)
               for value in [*inspection["source_files_sha256"].values(), inspection["audit_source_sha256"]]):
            raise ArtifactError("sealed image probe has invalid source hashes")
        for field in ("nautilus_version", "python_version", "dependency_lock_sha256"):
            if manifest[field] != inspection[field]:
                raise ArtifactError(f"sealed runtime metadata differs from image probe: {field}")
    summary_path = path / "reports" / "summary.json"
    if summary_path.is_file():
        _check_source_summary(path, _read_json(summary_path))
    if manifest["status"] == "passed":
        if not all((path / "reports" / name).is_file() for name in REPORTS):
            raise ArtifactError("passed seal is missing a native report")
        if not _read_json(summary_path).get("integrity_passed"):
            raise ArtifactError("passed seal disagrees with native integrity")
        audit = _read_json(path / "reports" / "audit.json")
        if not audit.get("passed") or audit.get("findings"):
            raise ArtifactError("passed seal disagrees with independent audit")
        if manifest["native_exit_code"] or manifest["audit_exit_code"]:
            raise ArtifactError("passed seal contains a failed process exit")
    elif manifest["status"] != "failed":
        raise ArtifactError("unknown seal status")
    return {
        "run_id": run_id,
        "status": manifest["status"],
        "files": len(actual),
        "manifest_sha256": _sha(path / "manifest.json"),
        "verified": True,
    }


def restore(root: Path, run_id: str, destination: Path) -> dict:
    checked = verify(root, run_id)
    destination = destination.resolve()
    if destination.exists():
        raise ArtifactError(f"restore destination already exists: {destination}")
    source = root.resolve() / run_id / "reports"
    if not source.is_dir():
        raise ArtifactError("sealed run has no native reports")
    stage = destination.parent / f".{destination.name}-{uuid.uuid4().hex}.restore"
    destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    try:
        stage.mkdir(mode=0o700)
        shutil.copytree(source, stage, dirs_exist_ok=True)
        expected = _read_json(root.resolve() / run_id / "manifest.json")["files"]
        for file in stage.rglob("*"):
            if file.is_file():
                name = "reports/" + file.relative_to(stage).as_posix()
                if name not in expected or _sha(file) != expected[name]["sha256"]:
                    raise ArtifactError(f"restored report differs from seal: {name}")
        _private_tree(stage)
        os.rename(stage, destination)
    finally:
        if stage.exists():
            shutil.rmtree(stage)
    return {**checked, "restored_to": str(destination)}


def backup(root: Path, run_id: str, backup_root: Path) -> dict:
    checked = verify(root, run_id)
    source = root.resolve() / run_id
    backup_root = backup_root.absolute()
    if backup_root.resolve() == root.resolve() or backup_root.resolve().is_relative_to(
        root.resolve()
    ):
        raise ArtifactError("backup root must differ from the primary root")
    backup_root = _private_root(backup_root)
    target = backup_root / run_id
    if target.exists():
        raise ArtifactError(f"backup run ID already exists: {run_id}")
    stage = backup_root / f".{run_id}-{uuid.uuid4().hex}.stage"
    try:
        shutil.copytree(source, stage)
        if _sha(stage / "manifest.json") != checked["manifest_sha256"] or _files(
            stage
        ) != _files(source):
            raise ArtifactError("backup bytes differ from primary")
        _private_tree(stage)
        _sync_tree(stage)
        os.rename(stage, target)
        fd = os.open(backup_root, os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    finally:
        if stage.exists():
            shutil.rmtree(stage)
    return {
        **verify(backup_root, run_id),
        "backup_path": str(target),
        "same_device_as_primary": root.resolve().stat().st_dev
        == backup_root.stat().st_dev,
    }


def register(
    *,
    root: Path,
    run_id: str,
    role: str,
    cost_model: str,
    control_run_id: str | None,
    evidence_grade: str,
) -> dict:
    checked = verify(root, run_id)
    archive = root.resolve() / run_id
    manifest = _read_json(archive / "manifest.json")
    attempt_id = manifest["attempt_id"]
    from research.records.store import open_store
    store = open_store()
    if not hasattr(store, "adapter"):
        raise ArtifactError("run registration requires the Dolt write owner")
    binding = manifest.get("record_binding")
    if binding is None:
        raise ArtifactError("seal has no start-time Dolt registration binding")
    if not isinstance(binding, dict) or binding.get("id") != "attempt:" + attempt_id:
        raise ArtifactError("seal record binding differs from its attempt")
    _attempt_snapshot(attempt_id, binding)
    summary_path = archive / "reports" / "summary.json"
    summary = _read_json(summary_path) if summary_path.is_file() else None
    modern = manifest["schema_version"] == 2
    files = {} if modern else _summary_source_files(archive, summary, manifest.get("runner_args"))
    record = {
        "schema_version": 1,
        "run_id": run_id,
        "attempt_id": attempt_id,
        "role": role,
        "nautilus_version": manifest.get("nautilus_version")
        or importlib.metadata.version("nautilus_trader"),
        "input_identity_sha256": manifest["input_identity_sha256"],
        "source_files_sha256": {
            field: (
                summary[field]
                if summary is not None
                else _sha(archive / "source" / path)
            )
            for field, path in files.items()
        },
        "cost_model": cost_model,
        "artifact_manifest_ref": {
            "path": f"artifact://{run_id}/manifest.json",
            "sha256": checked["manifest_sha256"],
        },
        "integrity": checked["status"],
        "evidence_grade": evidence_grade,
        "raw_reports": "sealed_local",
        "control_run_id": control_run_id,
    }
    if modern:
        from research.records.strategies import validate_binding
        validate_binding(store.adapter, manifest["strategy_binding"])
        inspection = _read_json(archive / "runtime-inspection.json")
        record.update(strategy_binding=manifest["strategy_binding"], runtime_identity=manifest["runtime_identity"],
                      effective_config_sha256=manifest["effective_config_sha256"],
                      source_files_sha256={"strategy_source_sha256": manifest["strategy_binding"]["source_sha256"],
                                           **inspection["source_files_sha256"]})
    else:
        record["source_revision"] = {"commit": manifest["source_commit"], "files": files}
    if checked["status"] == "passed":
        if summary is None:
            raise ArtifactError("passed seal has no native summary")
        record["window"] = {
            "input_start_utc": summary["input_start_utc"],
            "trade_start_utc": summary["period_start_utc"],
            "end_utc": summary["period_end_utc"],
            "bar_minutes": summary["data_interval_minutes"],
        }
        record["account"] = {
            "model": summary["account_model"],
            "starting_balance_usdt": summary["starting_balance_usdt"],
            "sizing": summary["sizing"],
        }
    else:
        record["failure_reasons"] = manifest["problems"]
    for kind in ("summary", "audit"):
        name = f"reports/{kind}.json"
        if name in manifest["files"]:
            record[f"{kind}_ref"] = {
                "path": f"artifact://{run_id}/{name}",
                "sha256": manifest["files"][name]["sha256"],
            }
    errors = list(_validator("run").iter_errors(record))
    if errors:
        raise ArtifactError(f"generated run record is invalid: {errors[0].message}")
    publication = store.publish_record(
        "run", record, operation_id=f"register:{run_id}:{checked['manifest_sha256']}",
        expected_version=store.adapter.status()["version"],
        provenance={"origin": "sealed_native_artifact", "manifest_sha256": checked["manifest_sha256"],
                    "record_binding": binding, "binding_origin": "sealed_start"},
        endpoint_revisions={binding["id"]: binding["revision"]},
    )
    return {"run_id": run_id, "record": f"run:{run_id}", **checked, "publication": publication}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    replay = commands.add_parser(
        "run", help="execute frozen R1 source and seal evidence"
    )
    replay.add_argument("--root", type=Path, required=True)
    replay.add_argument("--run-id", required=True)
    replay.add_argument("--attempt-id", required=True)
    source = replay.add_mutually_exclusive_group(required=True)
    source.add_argument("--source-ref", help="explicit historical frozen Git source reader")
    source.add_argument("--strategy-id", help="published Dolt strategy identity")
    replay.add_argument("--strategy-revision", type=int)
    replay.add_argument("--source-at", help="exact Dolt commit containing the source revision")
    replay.add_argument("--runtime", type=Path, help="immutable OCI runtime identity JSON")
    replay.add_argument("--input-identity", type=Path, required=True)
    replay.add_argument("runner_args", nargs=argparse.REMAINDER)
    check = commands.add_parser("verify", help="rehash one sealed run")
    check.add_argument("--root", type=Path, required=True)
    check.add_argument("--run-id", required=True)
    recovery = commands.add_parser("restore", help="restore native reports")
    recovery.add_argument("--root", type=Path, required=True)
    recovery.add_argument("--run-id", required=True)
    recovery.add_argument("--destination", type=Path, required=True)
    copy = commands.add_parser("backup", help="copy and verify a sealed run")
    copy.add_argument("--root", type=Path, required=True)
    copy.add_argument("--run-id", required=True)
    copy.add_argument("--backup-root", type=Path, required=True)
    record = commands.add_parser("register", help="publish a Dolt run record for a seal")
    record.add_argument("--root", type=Path, required=True)
    record.add_argument("--run-id", required=True)
    record.add_argument(
        "--role", choices=("candidate", "control", "diagnostic"), required=True
    )
    record.add_argument("--cost-model", required=True)
    record.add_argument("--control-run-id")
    record.add_argument(
        "--evidence-grade",
        choices=("development_exposed", "unknown"),
        default="development_exposed",
    )
    identity = commands.add_parser(
        "input-identity", help="hash prepared Catalog inputs"
    )
    identity.add_argument("--catalog-root", type=Path, required=True)
    identity.add_argument("--daily-root", type=Path, required=True)
    identity.add_argument("--quantity-csv", type=Path, required=True)
    identity.add_argument("--coins", nargs="+", required=True)
    identity.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        if args.command == "run":
            runner_args = args.runner_args
            if runner_args and runner_args[0] == "--":
                runner_args = runner_args[1:]
            result = run(
                root=args.root,
                run_id=args.run_id,
                attempt_id=args.attempt_id,
                source_ref=args.source_ref,
                strategy_id=args.strategy_id,
                strategy_revision=args.strategy_revision,
                source_at=args.source_at,
                runtime=args.runtime,
                input_identity=args.input_identity,
                runner_argv=runner_args,
            )
        elif args.command == "verify":
            result = verify(args.root, args.run_id)
        elif args.command == "register":
            result = register(
                root=args.root,
                run_id=args.run_id,
                role=args.role,
                cost_model=args.cost_model,
                control_run_id=args.control_run_id,
                evidence_grade=args.evidence_grade,
            )
        elif args.command == "backup":
            result = backup(args.root, args.run_id, args.backup_root)
        elif args.command == "input-identity":
            result = create_input_identity(
                catalog_root=args.catalog_root,
                daily_root=args.daily_root,
                quantity_csv=args.quantity_csv,
                coins=args.coins,
                output=args.output,
            )
        else:
            result = restore(args.root, args.run_id, args.destination)
    except (ArtifactError, RecordError, OSError, KeyError, ValueError) as exc:
        parser.exit(2, f"artifact custody error: {exc}\n")
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 1 if args.command == "run" and result["status"] != "passed" else 0


if __name__ == "__main__":
    raise SystemExit(main())
