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
import tempfile
import uuid
from pathlib import Path

from research.records.common import ROOT
from research.records.common import RECORDS
from research.records.common import RecordError
from research.records.common import _check_commit
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


class ArtifactError(Exception):
    pass


def _private_root(root: Path) -> Path:
    if root.is_symlink():
        raise ArtifactError(f"artifact root must not be a symlink: {root}")
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


def _snapshot_source(ref: str, stage: Path) -> str:
    commit = _git("rev-parse", "--verify", f"{ref}^{{commit}}").decode().strip()
    files = _git("ls-tree", "-r", "--name-only", commit, "strategies/r1").decode()
    paths = [name for name in files.splitlines() if name.endswith(".py")]
    if "strategies/r1/run_portfolio.py" not in paths:
        raise ArtifactError("source commit has no native R1 runner")
    for name in paths:
        target = stage / "source" / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(_git("show", f"{commit}:{name}"))
    for name in ("pyproject.toml", "uv.lock"):
        shutil.copyfile(ROOT / name, stage / "source" / name)
    return commit


def _check_source_summary(stage: Path, summary: dict) -> None:
    source = stage / "source" / "strategies" / "r1"
    for field, name in SOURCE_DIGEST_FILES.items():
        expected = summary.get(field)
        if expected is not None and _sha(source / name) != expected:
            raise ArtifactError(f"native summary differs from frozen {name}")


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
    with path.open("x" if exclusive else "w") as stream:
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


def _attempt(attempt_id: str) -> dict:
    path = RECORDS / "attempts" / attempt_id / "attempt.json"
    if not path.is_file():
        raise ArtifactError(f"unknown registered attempt: {attempt_id}")
    attempt = _read_json(path)
    errors = list(_validator("attempt").iter_errors(attempt))
    if errors or attempt["attempt_id"] != attempt_id:
        raise ArtifactError(f"invalid attempt record: {attempt_id}")
    registration = attempt["registration"]
    if (
        registration["status"] != "preregistered"
        or _check_commit(registration.get("original_registration_commit", ""))
        != "present"
    ):
        raise ArtifactError("native custody run requires an existing preregistration")
    return attempt


def run(
    *,
    root: Path,
    run_id: str,
    attempt_id: str,
    source_ref: str,
    input_identity: Path,
    runner_argv: list[str],
) -> dict:
    if not RUN_ID.fullmatch(run_id):
        raise ArtifactError("run ID must use letters, digits and hyphens")
    _attempt(attempt_id)
    replay = _runner_inputs(runner_argv)
    identity = _read_json(input_identity)
    identity_digest = _sha(input_identity)
    checked_before = _check_inputs(identity, replay)
    root = root.absolute()
    if root.resolve().is_relative_to(ROOT) or root.resolve().is_relative_to(
        Path(tempfile.gettempdir()).resolve()
    ):
        raise ArtifactError(
            "artifact root must be outside Git and the system temp directory"
        )
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
        commit = _snapshot_source(source_ref, stage)
        registration_commit = _attempt(attempt_id)["registration"][
            "original_registration_commit"
        ]
        ancestor = subprocess.run(
            ["git", "merge-base", "--is-ancestor", registration_commit, commit],
            cwd=ROOT,
            check=False,
        )
        if ancestor.returncode:
            raise ArtifactError("registration commit is not an ancestor of source")
        shutil.copyfile(input_identity, stage / "input-identity.json")
        if _sha(stage / "input-identity.json") != identity_digest:
            raise ArtifactError("input identity changed during source capture")
        (stage / "reports").mkdir()
        native_command = [
            sys.executable,
            str(stage / "source" / "strategies" / "r1" / "run_portfolio.py"),
            *runner_argv,
            "--output",
            str(stage / "reports"),
        ]
        with (
            (stage / "native.stdout.txt").open("wb") as out,
            (stage / "native.stderr.txt").open("wb") as err,
        ):
            native = subprocess.run(native_command, cwd=ROOT, stdout=out, stderr=err)
        audit_exit = None
        if replay.signal_variant.startswith(
            ("support-three-tier", "support-deep-two-tier", "support-broad-two-tier")
        ) and all((stage / "reports" / name).is_file() for name in REPORTS):
            audit_command = [
                sys.executable,
                str(stage / "source" / "strategies" / "r1" / "audit_tiered_native.py"),
                "--run",
                str(stage / "reports"),
                "--catalog-root",
                str(replay.catalog_root),
                "--output",
                str(stage / "reports" / "audit.json"),
            ]
            with (
                (stage / "audit.stdout.txt").open("wb") as out,
                (stage / "audit.stderr.txt").open("wb") as err,
            ):
                audit_exit = subprocess.run(
                    audit_command, cwd=ROOT, stdout=out, stderr=err
                ).returncode
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
            except ArtifactError as exc:
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
            "status": "passed" if not problems else "failed",
            "problems": problems,
            "source_commit": commit,
            "nautilus_version": importlib.metadata.version("nautilus_trader"),
            "python_version": sys.version.split()[0],
            "dependency_lock_sha256": _sha(stage / "source" / "uv.lock"),
            "input_identity_sha256": _sha(stage / "input-identity.json"),
            "input_catalogs_checked": checked_before,
            "runner_args": runner_argv,
            "native_exit_code": native.returncode,
            "audit_exit_code": audit_exit,
            "files": _files(stage),
        }
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
    if manifest.get("run_id") != run_id or manifest.get("schema_version") != 1:
        raise ArtifactError("manifest identity mismatch")
    actual = _files(path)
    if actual != manifest["files"]:
        raise ArtifactError("sealed file set or SHA-256 differs from manifest")
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
    _attempt(attempt_id)
    summary_path = archive / "reports" / "summary.json"
    summary = _read_json(summary_path) if summary_path.is_file() else None
    files = {
        field: f"strategies/r1/{name}"
        for field, name in SOURCE_DIGEST_FILES.items()
        if (summary is not None and summary.get(field) is not None)
        or (
            summary is None
            and (archive / "source" / "strategies" / "r1" / name).is_file()
        )
    }
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
        "source_revision": {
            "commit": manifest["source_commit"],
            "files": files,
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
    target = RECORDS / "runs" / run_id
    if target.exists():
        raise ArtifactError(f"run record already exists: {run_id}")
    stage = RECORDS / "runs" / f".{run_id}-{uuid.uuid4().hex}.stage"
    stage.mkdir()
    try:
        _write_json(stage / "run.json", record)
        os.rename(stage, target)
    finally:
        if stage.exists():
            shutil.rmtree(stage)
    return {"run_id": run_id, "record": str(target / "run.json"), **checked}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    replay = commands.add_parser(
        "run", help="execute frozen R1 source and seal evidence"
    )
    replay.add_argument("--root", type=Path, required=True)
    replay.add_argument("--run-id", required=True)
    replay.add_argument("--attempt-id", required=True)
    replay.add_argument("--source-ref", required=True)
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
    record = commands.add_parser("register", help="write a Git run record for a seal")
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
