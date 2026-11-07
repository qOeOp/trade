"""Run the six frozen pairs only on an isolated AMD64 worker; all ledger writes use CLI."""
import argparse
import json
import os
from pathlib import Path
import platform
import re
import subprocess
import sys

from generator import generate_sources, input_manifest, seed_market, sha, verify_baseline, write_json

IMAGE = re.compile(r"ghcr\.io/qoeop/trade-runtime@sha256:[0-9a-f]{64}\Z")
REVISION = re.compile(r"[0-9a-f]{40}\Z")


def clean_environment(work):
    for directory in ("profiles", "docker-config"):
        (work / directory).mkdir()
    dolt = os.environ.get("RESEARCH_DOLT_BINARY")
    if not dolt or not Path(dolt).is_file():
        raise ValueError("explicit RESEARCH_DOLT_BINARY is required")
    return {"PATH": os.environ["PATH"], "HOME": os.environ["HOME"],
            # CLI temporary-path checks must admit both work/ and evidence/ on GitHub's non-/tmp RUNNER_TEMP.
            "TMPDIR": str(work.parent), "TRADE_LEDGER_HOME": str(work / "profiles"),
            "DOCKER_CONFIG": str(work / "docker-config"), "DOCKER_HOST": "unix:///var/run/docker.sock",
            "RESEARCH_DOLT_BINARY": dolt, "PYTHONDONTWRITEBYTECODE": "1", "PYTHONUTF8": "1"}


def validate_arguments(args):
    if platform.system() != "Linux" or platform.machine() not in ("x86_64", "amd64"):
        raise ValueError("exact deployment digest pairing requires a native Linux AMD64 worker")
    for value in (args.old_runtime, args.new_runtime):
        if not IMAGE.fullmatch(value):
            raise ValueError("runtime must be an explicit immutable public trade-runtime digest")
    if args.old_runtime == args.new_runtime:
        raise ValueError("reference and candidate image must differ")
    for value in (args.old_revision, args.new_revision):
        if not REVISION.fullmatch(value):
            raise ValueError("actual CI OCI revisions must be full Git SHAs")
    if args.output.exists() or not args.output.resolve().is_relative_to(Path("/tmp").resolve()) and not (
            os.environ.get("RUNNER_TEMP") and args.output.resolve().is_relative_to(Path(os.environ["RUNNER_TEMP"]).resolve())):
        raise ValueError("output must be new and under /tmp or this ephemeral runner's RUNNER_TEMP")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for key in ("repo", "output"):
        parser.add_argument("--" + key, type=Path, required=True)
    for key in ("old-runtime", "new-runtime", "old-revision", "new-revision"):
        parser.add_argument("--" + key, required=True)
    args = parser.parse_args()
    args.repo, args.output = args.repo.resolve(), args.output.absolute()
    validate_arguments(args)
    baseline = verify_baseline(args.repo)
    from verify_pair import verify_native_bar_schema
    verify_native_bar_schema()
    host = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=args.repo, text=True).strip()
    if host != args.new_revision:
        raise ValueError("host checkout must be the actual candidate CI build revision")
    dirty = subprocess.check_output(["git", "status", "--porcelain", "--untracked-files=no"], cwd=args.repo, text=True)
    if dirty:
        raise ValueError("candidate tracked checkout is not clean")
    args.output.mkdir(parents=True, mode=0o700)
    work, evidence = args.output / "work", args.output / "evidence"
    work.mkdir(mode=0o700)
    evidence.mkdir(mode=0o700)
    write_json(evidence / "baseline.json", baseline)
    env = clean_environment(work)
    ledger = None
    sequence = 0
    run_manifest = {"host_revision": host, "old_runtime": args.old_runtime, "new_runtime": args.new_runtime,
                    "old_revision": args.old_revision, "new_revision": args.new_revision,
                    "platform": "linux/amd64", "pairs": [], "status": "preparing"}
    write_json(evidence / "suite.json", run_manifest)

    def cli(*argv, public_log=True):
        nonlocal sequence
        sequence += 1
        command = [sys.executable, "-m", "cli.main", *map(str, argv)]
        # No inherited credentials, Docker selector/context or default ledger profile.
        result = subprocess.run(command, cwd=args.repo, env=env, text=True, capture_output=True, check=False)
        directory = evidence / "commands" if public_log else work / "commands"
        directory.mkdir(exist_ok=True)
        stem = directory / f"{sequence:03d}"
        stem.with_suffix(".stdout.txt").write_text(result.stdout)
        stem.with_suffix(".stderr.txt").write_text(result.stderr)
        write_json(stem.with_suffix(".json"), {"argv": command, "exit_code": result.returncode})
        if result.returncode:
            raise RuntimeError(f"CLI stage {sequence} exited {result.returncode}; retained output: {stem.name}")
        return json.loads(result.stdout)

    try:
        sources = generate_sources(args.repo, evidence / "sources")
        created = cli("ledger", "temp", "--root", work / "ledger", public_log=False)
        ledger = created["profile"]
        if not Path(ledger).resolve().is_relative_to(work.resolve()):
            raise ValueError("temporary ledger profile escaped its isolated workspace")
        profiles = {}
        for kind in sources["sources"]:
            market = cli("market", "init", "--name", kind, "--kind", "isolated", "--root", work / (kind + "-market"),
                         public_log=False)
            profile_path = Path(market["profile"])
            if not profile_path.resolve().is_relative_to(work.resolve()):
                raise ValueError("market profile escaped isolated workspace")
            profile = json.loads(profile_path.read_text())
            if profile.get("role") != "isolated" or not Path(profile["root"]).resolve().is_relative_to(work.resolve()):
                raise ValueError("not the newly created isolated market")
            commit = seed_market(kind, profile)
            profiles[kind] = (profile_path, commit)
            write_json(evidence / (kind + "-inputs.json"), {"commit": commit, "files": input_manifest(profile)})
        run_manifest["status"] = "running"
        for kind, source in sources["sources"].items():
            for symbols in sources["groups"]:
                pair_name = kind + "-" + "-".join(symbols)
                pair = {"name": pair_name, "kind": kind, "symbols": symbols, "source": source, "sides": {}}
                run_manifest["pairs"].append(pair)
                write_json(evidence / "suite.json", run_manifest)
                for side, runtime, revision in (("reference", args.old_runtime, args.old_revision),
                                                ("candidate", args.new_runtime, args.new_revision)):
                    dest = evidence / pair_name / side
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    profile_path, commit = profiles[kind]
                    result = cli("replay", "explore", "--ledger", ledger, "--market", profile_path, "--at", commit,
                                 "--runtime", runtime, "--strategy-file", evidence / "sources" / source["file"],
                                 "--strategy-class", source["class"], "--output", dest,
                                 "--", "--symbols", *symbols, "--start", source["start"],
                                 "--trade-start", source["trade_start"], "--end", source["end"], "--execution", "bars")
                    write_json(dest / "cli-result.json", result)
                    if result.get("status") != "passed":
                        raise ValueError(f"native CLI result failed for {pair_name}/{side}")
                    exported = cli("evidence", "export", "--ledger", ledger,
                                   "--bundle", f"trial-{result['trial_id']}-execution-start", "--output", dest / "start-receipt")
                    receipt = json.loads((Path(exported["path"]) / "execution.json").read_text())
                    expected = {"image_ref": runtime, "image_digest": runtime.rsplit("@", 1)[1],
                                "platform": "linux/amd64", "runtime_contract": "replay-contract@v7", "build_revision": revision}
                    if receipt["runtime_identity"] != expected:
                        raise ValueError(f"native image provenance mismatch for {pair_name}/{side}")
                    pair["sides"][side] = {"directory": str(dest.relative_to(evidence)), "runtime": expected,
                                          "trial_id": result["trial_id"]}
                    write_json(evidence / "suite.json", run_manifest)
        from verify_pair import verify_suite
        report = verify_suite(evidence)
        write_json(evidence / "verification.json", report)
        run_manifest["status"] = "passed" if report["passed"] else "failed"
        if not report["passed"]:
            raise ValueError("paired semantic acceptance failed; inspect verification.json")
    except BaseException as exc:
        run_manifest["status"] = "failed"
        run_manifest["error"] = {"type": type(exc).__name__, "message": str(exc)}
        raise
    finally:
        if ledger is not None:
            try:
                cli("ledger", "service", "stop", "--ledger", ledger, public_log=False)
                run_manifest["own_temporary_ledger_stopped"] = True
            except Exception as exc:
                run_manifest["own_temporary_ledger_stopped"] = False
                run_manifest["cleanup_error"] = type(exc).__name__
        write_json(evidence / "suite.json", run_manifest)
        # Explicit evidence allowlist: no work/, profile file, service.json, DB or Docker config.
        write_json(evidence / "artifact-hashes.json", {str(p.relative_to(evidence)): sha(p)
                   for p in sorted(evidence.rglob("*")) if p.is_file() and p.name != "artifact-hashes.json"})
    if run_manifest.get("own_temporary_ledger_stopped") is not True:
        raise RuntimeError("the harness's temporary service did not stop; retained evidence records this")
    print(json.dumps({"passed": True, "evidence": str(evidence), "pairs": len(run_manifest["pairs"])}))


if __name__ == "__main__":
    main()
