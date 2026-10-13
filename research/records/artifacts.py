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


REPORTS = ("summary.json", "orders.csv", "fills.csv", "positions.csv", "account.csv", "returns_series.csv")


class ArtifactError(Exception):
    pass


def _sha(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def market_profile(path: Path | None, name: str | None = None) -> dict:
    from research.records import ledger
    if path is None:
        return ledger.profile(name, of="market")
    if name is not None:
        raise ArtifactError("choose --market-profile or --market-ledger, not both")
    value = _read_json(path)
    if ledger.kind(value) != "market":
        raise ArtifactError("explicit profile must be a market database")
    return value


def exporter_fingerprint() -> str:
    from research.records.common import ROOT
    paths = ("research/market/export.py", "research/market/store.py", "research/market/universe.py",
             "research/records/artifacts.py", "uv.lock")
    manifest = {path: _sha(ROOT / path) for path in paths}
    return hashlib.sha256(json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def export_fingerprint(inputs: dict, *, semantic=True) -> str:
    """Path-independent exported-byte custody. Only elapsed export seconds are volatile."""
    digest = hashlib.sha256()
    paths = sorted(path for path in inputs["root"].rglob("*") if path.is_file() or path.is_symlink())
    paths.append(inputs["pool_file"])
    for path in paths:
        if path.is_symlink():
            raise ArtifactError(f"export contains symlink {path}")
        name = "pool.json" if path == inputs["pool_file"] else path.relative_to(inputs["root"]).as_posix()
        data = path.read_bytes()
        if semantic and path.name == "export.json":
            receipt = json.loads(data)
            receipt.pop("seconds", None)
            data = json.dumps(receipt, sort_keys=True, separators=(",", ":")).encode()
        encoded = name.encode()
        digest.update(len(encoded).to_bytes(4, "big"))
        digest.update(encoded)
        digest.update(hashlib.sha256(data).digest())
    return digest.hexdigest()


def _runner_inputs(argv: list[str]) -> argparse.Namespace:
    """The replay's contracts and window; the market inputs themselves are this command's to supply."""
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--symbols", nargs="+")
    parser.add_argument("--universe", choices=("pool",))
    parser.add_argument("--start", required=True)
    parser.add_argument("--end", required=True)
    parser.add_argument("--trade-start")
    for option in ("--output", "--market-root", "--market-commit", "--pool"):
        if any(value.split("=", 1)[0] == option for value in argv):
            raise ArtifactError(f"the run command owns {option}")
    args, _ = parser.parse_known_args(argv)
    if (args.symbols is None) == (args.universe is None):
        raise ArtifactError("pass --symbols SYMBOL ... or --universe pool")
    if args.symbols and len(args.symbols) != len(set(args.symbols)):
        raise ArtifactError("duplicate replay symbols")
    return args


def _ms(value: str) -> int:
    from backtest.load import ns
    return ns(value) // 1_000_000


def membership(pool_rows: list[tuple], end_month) -> dict[str, list[list[int]]]:
    """Each contract's pool months as merged [start_ns, end_ns) intervals."""
    from research.market import universe
    found: dict[str, list[list[int]]] = {}
    months = sorted({month for month, _ in pool_rows})
    following = {month: (universe.day_ms(nxt) if nxt else universe.day_ms(end_month))
                 for month, nxt in zip(months, [*months[1:], None])}
    for month, symbol in sorted(pool_rows, key=lambda row: (row[1], row[0])):
        start, end = universe.day_ms(month) * 1_000_000, following[month] * 1_000_000
        intervals = found.setdefault(symbol, [])
        if intervals and intervals[-1][1] == start:
            intervals[-1][1] = end
        else:
            intervals.append([start, end])
    return found


def market_inputs(market: dict, at: str | None, replay: argparse.Namespace, *, fresh: bool) -> dict:
    """Export the market commit for the replay window and write its pool membership file."""
    from research.market import export, store, universe
    from research.records import db
    start, end = _ms(replay.start), _ms(replay.end)
    trade_start = _ms(replay.trade_start) if replay.trade_start else start
    conn = db.connect(market, "reader")
    try:
        commit = store.resolve(conn, at)
        rule, = db.rows(conn, f"SELECT pool_rule FROM market_schema AS OF '{commit}'")[0]
        pool_rows = db.rows(conn, f"SELECT month, symbol FROM pool AS OF '{commit}'")
        (last_month,), = db.rows(conn, f"SELECT MAX(month) FROM pool AS OF '{commit}'")
    finally:
        conn.close()
    if not pool_rows:
        raise ArtifactError(f"market commit {commit} holds no pool")
    following = (last_month.replace(year=last_month.year + 1, month=1) if last_month.month == 12
                 else last_month.replace(month=last_month.month + 1))
    members = membership(pool_rows, following)
    if replay.universe == "pool":
        symbols = sorted(symbol for symbol, intervals in members.items()
                         if any(a < end * 1_000_000 and b > trade_start * 1_000_000 for a, b in intervals))
    else:
        symbols = list(replay.symbols)
    exported = export.export(market, at=commit, symbols=symbols, start=start, end=end, timeframe="1m", fresh=fresh)
    root = Path(exported["root"])
    pool_file = Path(tempfile.mkdtemp(prefix="trade-pool-", dir="/tmp")) / "pool.json"
    _write_json(pool_file, {"commit": commit, "pool_rule": rule,
                            "membership": {symbol: members.get(symbol, []) for symbol in symbols}})
    identity = {"market_database": market["database"], "market_commit": commit, "pool_rule": rule,
                "universe": "pool" if replay.universe else "symbols", "symbols": symbols}
    inputs = {"identity": identity, "root": root, "pool_file": pool_file, "fresh": fresh, "symbols": symbols,
              "exported": {key: exported[key] for key in ("exported", "reused", "seconds")}}
    if any(receipt.get("timeframe") != "1m" for receipt in exported["receipts"].values()):
        raise ArtifactError("market export did not produce one-minute inputs")
    identity["export_content_sha256"] = export_fingerprint(inputs)
    identity["exporter_source_sha256"] = exporter_fingerprint()
    return inputs


def _container_runner_args(argv: list[str], inputs: dict) -> tuple[list[str], list[tuple[Path, str, bool]]]:
    """Runner arguments with the market inputs in their container paths, and the read-only mounts."""
    denied = {"--strategy-file", "--strategy-class", "--strategy-sha256", "--strategy-binding", "--execution-binding",
              "--output", "--describe"}
    result, skip = [], False
    for value in argv:
        option = value.split("=", 1)[0]
        if option in denied:
            raise ArtifactError(f"the run command owns {option}")
        if option in ("--universe", "--symbols"):
            skip = "=" not in value
            continue
        if skip and not value.startswith("--"):
            continue
        skip = False
        result.append(value)
    result += ["--market-root", "/inputs/market", "--market-commit", inputs["identity"]["market_commit"],
               "--pool", "/inputs/pool.json", "--symbols", *inputs["symbols"]]
    return result, [(inputs["root"], "/inputs/market", True), (inputs["pool_file"], "/inputs/pool.json", True)]


def _cleanup(inputs: dict) -> None:
    shutil.rmtree(inputs["pool_file"].parent, ignore_errors=True)
    if inputs["fresh"]:
        shutil.rmtree(inputs["root"], ignore_errors=True)


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


def _trial(ledger: dict, mode: str, source_sha256: str, identity: dict, inspection: dict, conn=None, registration=None) -> int:
    from research.records.trials import report_trial
    config = inspection["effective_config"]
    extra = {"registration": registration} if registration is not None else {}
    return report_trial(ledger, mode=mode, strategy_source_sha256=source_sha256, coins=config["symbols"],
                        start=config["start"], trade_start=config["trade_start"], end=config["end"],
                        image_ref=identity["image_ref"], conn=conn, **extra)


def explore(*, ledger: dict, market: dict, at: str | None, strategy_file: Path, strategy_class: str, output: Path,
            runtime: str | None, runner_argv: list[str]) -> dict:
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
    inputs = market_inputs(market, at, replay, fresh=False)
    try:
        return _explore(ledger, identity, inputs, source, source_sha256, strategy_class, output, runner_argv)
    finally:
        _cleanup(inputs)


def _explore(ledger, identity, inputs, source, source_sha256, strategy_class, output, runner_argv) -> dict:
    from research.records.runtime import inspect_runtime
    effective_args, mounts = _container_runner_args(runner_argv, inputs)
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
            "image_ref": identity["image_ref"], "trial_id": trial, "market": inputs["identity"],
            "export": inputs["exported"], "readings": explored(output, status)}


def run(*, ledger: dict, market: dict, at: str | None, strategy: str, runtime: str | None,
        runner_argv: list[str], hypothesis: str | None = None) -> dict:
    """Run a published revision in a temporary directory, audit it, store it in the ledger, delete the directory.

    The market commit is exported afresh into a temporary directory for this run alone; the run's
    input identity is that commit, the pool rule and the contracts.
    """
    from research.records import db
    from research.records.records import strategy as read_strategy
    replay = _runner_inputs(runner_argv)
    with db.session(ledger) as conn:
        revision = read_strategy(conn, strategy)
        inputs = market_inputs(market, at, replay, fresh=True)
        try:
            return _seal(ledger, conn, revision, strategy, runtime, inputs, runner_argv, hypothesis)
        finally:
            _cleanup(inputs)


def _seal(ledger, conn, revision, strategy, runtime, inputs, runner_argv, hypothesis) -> dict:
    from research.records import db
    from research.records.runtime import image_revision, inspect_runtime, resolve
    from research.records.trials import hand_off_run
    (commit,), = db.rows(conn, "SELECT DOLT_HASHOF('HEAD')")
    identity = resolve(runtime)
    if revision["runtime_contract"] != identity["runtime_contract"]:
        raise ArtifactError("strategy and image runtime contracts differ")
    effective_args, mounts = _container_runner_args(runner_argv, inputs)
    inspection = inspect_runtime(identity, effective_args)
    raw_input_hash = export_fingerprint(inputs, semantic=False)
    if export_fingerprint(inputs) != inputs["identity"]["export_content_sha256"]:
        raise ArtifactError("export changed before execution")
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
        registration = None if hypothesis is None else {
            "bundle": hypothesis, "execution": {"runtime": identity, "effective_config": config,
                                                   "input_identity": inputs["identity"]}}
        trial = _trial(ledger, "sealed", revision["source_sha256"], identity, inspection, conn=conn,
                       registration=registration)
        mounts += [(source, "/strategy", True), (workdir / "reports", "/reports", False)]
        native_exit, audit_exit = _replay(identity, mounts, workdir, [
            *effective_args, "--strategy-file", "/strategy/strategy.py", "--strategy-class", revision["entry_class"],
            "--strategy-sha256", revision["source_sha256"], "--strategy-binding", "/strategy/binding.json",
            "--execution-binding", "/strategy/execution.json", "--output", "/reports",
        ])
        problems = []
        if export_fingerprint(inputs, semantic=False) != raw_input_hash:
            problems.append("exported inputs changed during replay")
        from research.records.analysis import load_dir
        reports = load_dir(workdir / "reports")
        problems += _summary_problems(reports.summary, revision["source_sha256"], identity, _config_sha(config))
        audit_problems, _ = _audit_problems(workdir, native_exit, audit_exit)
        problems += [item for item in audit_problems if item not in problems]
        stored = hand_off_run(ledger, trial_id=trial, reports=reports, problems=problems, inspection=inspection,
                              image_revision=image_revision(identity), effective_config=config,
                              input_identity=inputs["identity"], conn=conn)
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
    replay.add_argument("--hypothesis", help="locked preregistration bundle for continuous research")
    replay.add_argument("--market-profile", type=Path, help="explicit market profile JSON, independent of research profile home")
    replay.add_argument("--market", help="market database branch, tag or commit (default: main)")
    replay.add_argument("--market-ledger", help="market profile name (default: the active market database)")
    replay.add_argument("runner_args", nargs=argparse.REMAINDER)
    reading = commands.add_parser("report", help="a stored run's product readings, or an exploration's (--dir)")
    reading.add_argument("run_id", type=int, nargs="?")
    reading.add_argument("--at", help="branch or closing tag (default: the open round)")
    reading.add_argument("--dir", type=Path, help="an exploration's --output directory instead of a stored run")
    args = parser.parse_args()
    if args.command == "run":
        explore_args, seal_args = ("strategy_file", "strategy_class", "output"), ("strategy",)
        needed, refused = (explore_args, (*seal_args, "hypothesis")) if args.explore else (seal_args, explore_args)
        missing = [name for name in needed if getattr(args, name) is None]
        extra = [name for name in refused if getattr(args, name) is not None]
        if missing or extra:
            parser.error(f"run {'--explore ' if args.explore else ''}needs "
                         + ", ".join("--" + name.replace("_", "-") for name in needed)
                         + " and refuses " + ", ".join("--" + name.replace("_", "-") for name in refused))
    try:
        from research.records.ledger import profile
        ledger = profile(args.ledger)
        if args.command == "report":
            if (args.run_id is None) == (args.dir is None):
                parser.error("report needs a RUN-ID or --dir")
            result = report(ledger, args.run_id, args.at) if args.dir is None else report_directory(ledger, args.dir)
        else:
            market = market_profile(args.market_profile, args.market_ledger)
            runner_args = args.runner_args[1:] if args.runner_args[:1] == ["--"] else args.runner_args
            if args.explore:
                result = explore(ledger=ledger, market=market, at=args.market, strategy_file=args.strategy_file,
                                 strategy_class=args.strategy_class, output=args.output, runtime=args.runtime,
                                 runner_argv=runner_args)
            else:
                result = run(ledger=ledger, market=market, at=args.market, strategy=args.strategy,
                             runtime=args.runtime, runner_argv=runner_args, hypothesis=args.hypothesis)
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
