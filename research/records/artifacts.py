"""Every native replay: explore a draft into /tmp, or run a published revision and store it whole.

Both modes write one trial row before the replay starts. A sealed run replays in a temporary
directory, is audited there, and is then stored in the ledger in one write (`trials.hand_off_run`);
the directory is deleted afterwards. An exploration keeps its reports in the given /tmp directory
and stores nothing else. This is not a backtest engine or a strategy gate.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

from research.records.common import RecordError, _is_temporary_path, _read_json


IDENTITY_ALGORITHM = (
    "SHA-256 over each sorted relative POSIX path as 4-byte big-endian "
    "length + path UTF-8 + SHA-256 of file bytes; tree digest is SHA-256 "
    "of concatenated records"
)
REPORTS = ("summary.json", "orders.csv", "fills.csv", "positions.csv", "account.csv", "returns_series.csv")


class ArtifactError(Exception):
    pass


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


def _container_runner_args(argv: list[str], replay: argparse.Namespace) -> tuple[list[str], list[tuple[Path, str, bool]]]:
    replacements = {"--catalog-root": (replay.catalog_root, "/inputs/catalog"),
                    "--daily-root": (replay.daily_root, "/inputs/daily"),
                    "--quantity-csv": (replay.quantity_csv, "/inputs/quantity.csv")}
    denied = {"--strategy-file", "--strategy-class", "--strategy-sha256", "--strategy-binding", "--execution-binding",
              "--output", "--describe"}
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


def _replay(identity: dict, mounts: list, workdir: Path, runner_args: list[str]) -> tuple[int, int | None]:
    """Run the native replay, then the independent audit once its reports exist, in one pinned image."""
    from research.records.runtime import LAYOUTS, container_command
    layout = LAYOUTS[identity["runtime_contract"]]
    native_command = container_command(identity, mounts, layout["runner"], runner_args)
    with (
        (workdir / "native.stdout.txt").open("wb") as out,
        (workdir / "native.stderr.txt").open("wb") as err,
    ):
        try:
            native = subprocess.run(native_command, cwd=workdir / "source", stdout=out, stderr=err).returncode
        except OSError as exc:
            err.write(str(exc).encode())
            native = 127
    audit_exit = None
    if all((workdir / "reports" / name).is_file() for name in REPORTS):
        audit_command = container_command(identity, mounts, layout["audit"], [
            "--run", "/reports", *layout["audit_args"], "--output", "/reports/audit.json",
        ])
        with (
            (workdir / "audit.stdout.txt").open("wb") as out,
            (workdir / "audit.stderr.txt").open("wb") as err,
        ):
            try:
                audit_exit = subprocess.run(audit_command, cwd=workdir / "source", stdout=out, stderr=err).returncode
            except OSError as exc:
                err.write(str(exc).encode())
                audit_exit = 127
    return native, audit_exit


def _audit_problems(workdir: Path, native_exit: int, audit_exit: int | None) -> tuple[list[str], dict | None]:
    problems, audit = [], None
    if native_exit:
        problems.append(f"native runner exited {native_exit}")
    if audit_exit is None:
        problems.append("independent native audit unavailable")
    elif audit_exit:
        problems.append(f"independent native audit exited {audit_exit}")
    audit_path = workdir / "reports" / "audit.json"
    if audit_path.is_file():
        try:
            audit = _read_json(audit_path)
            if not audit.get("passed") or audit.get("findings"):
                problems.append("independent native audit found problems")
        except RecordError as exc:
            problems.append(str(exc))
    else:
        problems.append("independent native audit report missing")
    return problems, audit


def _write_json(path: Path, value: dict, *, exclusive: bool = False) -> None:
    with path.open("x" if exclusive else "w", encoding="utf-8") as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())


def _config_sha(value: dict) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"),
                                     ensure_ascii=False, allow_nan=False).encode()).hexdigest()


def _summary_problems(summary: dict | None, source_sha256: str, identity: dict, config_sha: str) -> list[str]:
    if summary is None:
        return ["native summary missing"]
    problems = []
    if summary.get("strategy_source_sha256") != source_sha256:
        problems.append("native summary differs from the replayed strategy bytes")
    if summary.get("runtime_identity") not in (None, identity):
        problems.append("native summary differs from the pinned runtime identity")
    if summary.get("effective_config_sha256") not in (None, config_sha):
        problems.append("native summary differs from the effective configuration")
    if not summary.get("integrity_passed"):
        problems.append("native runner integrity failed")
    return problems


def _trial(ledger: dict, mode: str, source_sha256: str, identity: dict, inspection: dict, conn=None) -> int:
    from research.records.trials import report_trial
    config = inspection["effective_config"]
    return report_trial(ledger, mode=mode, strategy_source_sha256=source_sha256, coins=config["coins"],
                        start=config["start"], trade_start=config["trade_start"], end=config["end"],
                        image_ref=identity["image_ref"], conn=conn)


def explore(*, ledger: dict, strategy_file: Path, strategy_class: str, output: Path, runtime: str | None,
            runner_argv: list[str]) -> dict:
    """Replay a draft strategy file in the pinned image into a new /tmp directory; report its trial."""
    from research.records.runtime import inspect_runtime, resolve
    output = output.absolute()
    if not _is_temporary_path(output):
        raise ArtifactError("exploration output must be under /tmp or the system temp directory")
    if output.exists():
        raise ArtifactError(f"exploration output already exists: {output}")
    if not strategy_class.isidentifier():
        raise ArtifactError("strategy class must be one Python class name")
    source = strategy_file.read_bytes()
    source_sha256 = hashlib.sha256(source).hexdigest()
    replay = _runner_inputs(runner_argv)
    identity = resolve(runtime)
    effective_args, mounts = _container_runner_args(runner_argv, replay)
    inspection = inspect_runtime(identity, effective_args)
    trial = _trial(ledger, "explore", source_sha256, identity, inspection)
    output.mkdir(mode=0o700, parents=True)
    (output / "source").mkdir()
    (output / "source" / "strategy.py").write_bytes(source)
    (output / "reports").mkdir()
    _write_json(output / "runtime-inspection.json", inspection)
    mounts += [(output / "source", "/strategy", True), (output / "reports", "/reports", False)]
    native_exit, audit_exit = _replay(identity, mounts, output, [
        *effective_args, "--strategy-file", "/strategy/strategy.py", "--strategy-class", strategy_class,
        "--strategy-sha256", source_sha256, "--output", "/reports",
    ])
    problems, _ = _audit_problems(output, native_exit, audit_exit)
    from research.records.analysis import explored
    status = "passed" if not problems else "failed"
    # Read from the unverified temporary reports: to steer by, never to cite in a decision.
    return {"mode": "explore", "status": status, "problems": problems, "path": str(output),
            "image_ref": identity["image_ref"], "trial_id": trial, "readings": explored(output, status)}


def run(*, ledger: dict, strategy: str, runtime: str | None, input_identity: Path, runner_argv: list[str]) -> dict:
    """Run a published revision in a temporary directory, audit it, store it in the ledger, delete the directory."""
    from research.records import db
    from research.records.records import strategy as read_strategy
    replay = _runner_inputs(runner_argv)
    with db.session(ledger) as conn:
        return _seal(ledger, conn, read_strategy(conn, strategy), strategy, runtime, input_identity, runner_argv, replay)


def _seal(ledger, conn, revision, strategy, runtime, input_identity, runner_argv, replay) -> dict:
    from research.records import db
    from research.records.runtime import image_revision, inspect_runtime, resolve
    from research.records.trials import hand_off_run
    (commit,), = db.rows(conn, "SELECT DOLT_HASHOF('HEAD')")
    identity = resolve(runtime)
    if revision["runtime_contract"] != identity["runtime_contract"]:
        raise ArtifactError("strategy and image runtime contracts differ")
    effective_args, mounts = _container_runner_args(runner_argv, replay)
    inspection = inspect_runtime(identity, effective_args)
    identity_file = json.loads(Path(input_identity).read_text(encoding="utf-8"))
    checked_before = _check_inputs(identity_file, replay)
    workdir = Path(tempfile.mkdtemp(prefix="trade-run-", dir="/tmp"))
    try:
        source = workdir / "source"
        source.mkdir()
        (source / "strategy.py").write_bytes(revision["source"])
        binding = {"database": ledger["database"], "commit": commit, "strategy_id": revision["strategy_id"],
                   "revision": revision["revision"], "source_sha256": revision["source_sha256"],
                   "entry_class": revision["entry_class"], "runtime_contract": revision["runtime_contract"]}
        config = inspection["effective_config"]
        _write_json(source / "binding.json", binding)
        _write_json(source / "execution.json", {"runtime_identity": identity, "effective_config": config,
                                                "effective_config_sha256": _config_sha(config)})
        (workdir / "reports").mkdir()
        trial = _trial(ledger, "sealed", revision["source_sha256"], identity, inspection, conn=conn)
        mounts += [(source, "/strategy", True), (workdir / "reports", "/reports", False)]
        native_exit, audit_exit = _replay(identity, mounts, workdir, [
            *effective_args, "--strategy-file", "/strategy/strategy.py", "--strategy-class", revision["entry_class"],
            "--strategy-sha256", revision["source_sha256"], "--strategy-binding", "/strategy/binding.json",
            "--execution-binding", "/strategy/execution.json", "--output", "/reports",
        ])
        problems = []
        try:
            if _check_inputs(identity_file, replay) != checked_before:
                problems.append("inputs changed during replay")
        except (ArtifactError, OSError, KeyError) as exc:
            problems.append(str(exc))
        from research.records.analysis import load_dir
        reports = load_dir(workdir / "reports")
        problems += _summary_problems(reports.summary, revision["source_sha256"], identity, _config_sha(config))
        audit_problems, _ = _audit_problems(workdir, native_exit, audit_exit)
        problems += [item for item in audit_problems if item not in problems]
        stored = hand_off_run(ledger, trial_id=trial, reports=reports, problems=problems, inspection=inspection,
                              image_revision=image_revision(identity), effective_config=config,
                              input_identity={**identity_file, "checked": checked_before}, conn=conn)
    except BaseException:
        print(f"replay directory kept for diagnosis: {workdir}", file=sys.stderr)
        raise
    shutil.rmtree(workdir)
    return {"mode": "sealed", "strategy": strategy, "trial_id": trial, **stored, "image_ref": identity["image_ref"]}


def report(ledger: dict, run_id: int, at: str | None) -> dict:
    from research.records.records import run_report
    return run_report(ledger, run_id, at)


def report_directory(ledger: dict | None, directory: Path) -> dict:
    """The product readings of an exploration's report directory, with the open goal's gates when there is one."""
    from research.records import db
    from research.records.analysis import load_dir, readings
    from research.records.analysis import flat
    from research.records.records import gates, read_goal
    directory = Path(directory)
    reports = load_dir(directory / "reports" if (directory / "reports").is_dir() else directory)
    if reports.summary is None:
        raise ArtifactError(f"no native summary under {directory}")
    output = {"directory": str(directory), "exploration": True, **flat(reports.summary, readings(reports))}
    if ledger is not None:
        try:
            with db.reading(ledger) as conn:
                output["gates"] = gates(read_goal(conn), output, development=True)
        except RecordError:
            output["gates"] = None
    return output


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ledger", help="named ledger profile (default: the active ledger)")
    commands = parser.add_subparsers(dest="command", required=True)
    replay = commands.add_parser("run", help="every native replay: a published revision, or --explore a draft into /tmp")
    replay.add_argument("--runtime", help="CI runtime image reference (tag or digest); default: the current main image")
    replay.add_argument("--explore", action="store_true", help="replay a draft --strategy-file into a new /tmp --output")
    replay.add_argument("--strategy-file", type=Path)
    replay.add_argument("--strategy-class")
    replay.add_argument("--output", type=Path)
    replay.add_argument("--strategy", help="published revision ID@N")
    replay.add_argument("--input-identity", type=Path)
    replay.add_argument("runner_args", nargs=argparse.REMAINDER)
    reading = commands.add_parser("report", help="a stored run's product readings, or an exploration's (--dir)")
    reading.add_argument("run_id", type=int, nargs="?")
    reading.add_argument("--at", help="branch or closing tag (default: the open round)")
    reading.add_argument("--dir", type=Path, help="an exploration's --output directory instead of a stored run")
    identity = commands.add_parser("input-identity", help="hash prepared Catalog inputs")
    identity.add_argument("--catalog-root", type=Path, required=True)
    identity.add_argument("--daily-root", type=Path, required=True)
    identity.add_argument("--quantity-csv", type=Path, required=True)
    identity.add_argument("--coins", nargs="+", required=True)
    identity.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.command == "run":
        explore_args, seal_args = ("strategy_file", "strategy_class", "output"), ("strategy", "input_identity")
        needed, refused = (explore_args, seal_args) if args.explore else (seal_args, explore_args)
        missing = [name for name in needed if getattr(args, name) is None]
        extra = [name for name in refused if getattr(args, name) is not None]
        if missing or extra:
            parser.error(f"run {'--explore ' if args.explore else ''}needs "
                         + ", ".join("--" + name.replace("_", "-") for name in needed)
                         + " and refuses " + ", ".join("--" + name.replace("_", "-") for name in refused))
    try:
        if args.command == "input-identity":
            result = create_input_identity(catalog_root=args.catalog_root, daily_root=args.daily_root,
                                           quantity_csv=args.quantity_csv, coins=args.coins, output=args.output)
        else:
            from research.records.ledger import profile
            ledger = profile(args.ledger)
            if args.command == "report":
                if (args.run_id is None) == (args.dir is None):
                    parser.error("report needs a RUN-ID or --dir")
                result = report(ledger, args.run_id, args.at) if args.dir is None else report_directory(ledger, args.dir)
            else:
                runner_args = args.runner_args[1:] if args.runner_args[:1] == ["--"] else args.runner_args
                if args.explore:
                    result = explore(ledger=ledger, strategy_file=args.strategy_file, strategy_class=args.strategy_class,
                                     output=args.output, runtime=args.runtime, runner_argv=runner_args)
                else:
                    result = run(ledger=ledger, strategy=args.strategy, runtime=args.runtime,
                                 input_identity=args.input_identity, runner_argv=runner_args)
    except RecordError as exc:
        parser.exit(2, json.dumps({"error": exc.as_dict()}, ensure_ascii=False, default=str) + "\n")
    except (ArtifactError, OSError, KeyError, ValueError) as exc:
        parser.exit(2, f"artifacts error: {exc}\n")
    print(json.dumps(result, ensure_ascii=False, indent=2, default=str))
    if args.command == "run":
        return 0 if result.get("status") == "passed" else 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
