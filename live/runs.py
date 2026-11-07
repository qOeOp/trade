"""Host lifecycle for one private Live account slot, with retained originals.

No command writes to research or Paper. An ambiguous launch owns the account slot
until the native runner reconciles it flat, or every runner it started is proven to
have exited without arming. A dead container is never flat evidence.
"""

from __future__ import annotations

from decimal import Decimal, InvalidOperation
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess

from engine.config import Refusal as EngineRefusal
from engine.live_venue import read_credentials
from ledger import db, strategies
from runtime import container, image
from live import state


LABEL = "trade.live"
DOCKER_ENV = ("PATH", "HOME", "TMPDIR", "USER", "LANG", "DOCKER_HOST", "DOCKER_CONFIG", "DOCKER_CONTEXT",
              "DOCKER_CERT_PATH", "DOCKER_TLS_VERIFY")


def _docker(*argv: str, timeout: float = 60) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(["docker", *argv], capture_output=True, text=True, check=False, timeout=timeout,
                              env={key: os.environ[key] for key in DOCKER_ENV if key in os.environ})
    except subprocess.TimeoutExpired as exc:
        raise state.fail("LIVE_DOCKER_UNAVAILABLE", "Docker did not answer; account custody remains unresolved") from exc


def _checked(*argv: str) -> str:
    result = _docker(*argv)
    if result.returncode:
        # Docker output can include deployment paths; logs are read by a separate bounded command.
        raise state.fail("LIVE_DOCKER_UNAVAILABLE", f"Docker {argv[0]} failed; retained execution needs inspection")
    return result.stdout.strip()


def _names(root: Path, run_id: str) -> dict[str, str]:
    key = hashlib.sha256(str(root).encode()).hexdigest()[:10]
    base = f"trade-live-{key}-{run_id}"
    return {"network": base, "egress": base + "-egress"}


def _inspect(kind: str, name: str) -> dict | None:
    result = _docker(kind, "inspect", name)
    if result.returncode:
        missing = (f"No such {kind}: {name}", f"No such object: {name}", f"network {name} not found")
        if any(line in result.stderr for line in missing):
            return None
        raise state.fail("LIVE_DOCKER_UNAVAILABLE", f"Docker cannot establish the {kind} identity")
    try:
        rows = json.loads(result.stdout)
        if not isinstance(rows, list) or len(rows) != 1 or not isinstance(rows[0], dict):
            raise ValueError
        return rows[0]
    except (ValueError, TypeError) as exc:
        raise state.fail("LIVE_DOCKER_UNAVAILABLE", "Docker returned no unique resource identity") from exc


def _network_identity(name: str, run_id: str | None, expected_id: str | None = None) -> dict | None:
    found = _inspect("network", name)
    if found is not None and (found.get("Name") != name or found.get("Driver") != "bridge"
                              or found.get("Internal") is not (run_id is not None)
                              or run_id is not None and found.get("Labels", {}).get(f"{LABEL}.run") != run_id
                              or not found.get("Id") or expected_id is not None and found.get("Id") != expected_id):
        raise state.fail("LIVE_IDENTITY_CHANGED", "the retained network does not match its declared identity")
    return found


def _runner_args(mode: str) -> list[str]:
    return ["--manifest", "/inputs/manifest.json", "--credentials-file", "/run/secrets/binance.json",
            "--output", "/reports", "--mode", mode]


def _container(root: Path, run_id: str, directory: Path, manifest: dict, name: str, role: str, *,
               mode: str | None = None, credentials_path: str | None = None,
               container_id: str | None = None) -> dict | None:
    """Verify the full retained resource before reading it or issuing a lifecycle action."""
    found = _inspect("container", name)
    if found is None:
        return None
    names = _names(root, run_id)
    pinned = _inspect("image", manifest["runtime"]["image_ref"])
    network_created = next((row for row in reversed(_host_events(directory))
                            if row["event"] == "network_created"), None)
    network_id = network_created.get("network_id") if network_created else None
    expected_networks = {names["network"]: _network_identity(names["network"], run_id, network_id)}
    if role == "egress":
        expected_networks["bridge"] = _network_identity("bridge", None)
        expected_mounts = {"/reports": (str((directory / "egress").resolve()), True)}
        expected_command = ["-m", "engine.egress", "--port", "3128", "--log", "/reports/egress.log"]
    else:
        if role != "runner" or mode not in ("preflight", "run", "reconcile") or not credentials_path:
            raise state.fail("LIVE_IDENTITY_CHANGED", "the retained launch lacks its complete execution binding")
        expected_mounts = {"/inputs": (str((directory / "inputs").resolve()), False),
                           "/reports": (str((directory / "out").resolve()), True),
                           "/run/secrets/binance.json": (credentials_path, False)}
        expected_command = ["-m", "engine.live", *_runner_args(mode)]
    config, host = found.get("Config") or {}, found.get("HostConfig") or {}
    labels = config.get("Labels") or {}
    networks = (found.get("NetworkSettings") or {}).get("Networks") or {}
    mounts = found.get("Mounts") or []
    binds = {item.get("Destination"): (item.get("Source"), item.get("RW"))
             for item in mounts if item.get("Type") == "bind"}
    extra_mounts = [item for item in mounts if item.get("Type") != "bind"
                    and not (item.get("Type") == "tmpfs" and item.get("Destination") == "/tmp")]
    expected_env = dict(item.partition("=")[::2] for item in ((pinned or {}).get("Config") or {}).get("Env", []))
    expected_env["PYTHONDONTWRITEBYTECODE"] = "1"
    actual_env = dict(item.partition("=")[::2] for item in config.get("Env", []))
    memory = "256m" if role == "egress" else manifest["config"]["memory"]
    memory_bytes = int(memory[:-1]) * (1024 ** (2 if memory[-1] == "m" else 3))
    if (found.get("Name") != "/" + name or not found.get("Id")
            or container_id is not None and found.get("Id") != container_id
            or pinned is None or not pinned.get("Id") or found.get("Image") != pinned["Id"]
            or manifest["runtime"]["image_ref"] not in (pinned.get("RepoDigests") or [])
            or f"{pinned.get('Os')}/{pinned.get('Architecture')}" != manifest["runtime"]["platform"]
            or config.get("Image") != manifest["runtime"]["image_ref"]
            or labels.get(f"{LABEL}.run") != run_id or labels.get(f"{LABEL}.role") != role
            or config.get("Entrypoint") != ["python"] or config.get("Cmd") != expected_command
            or config.get("User") != f"{os.geteuid()}:{os.getegid()}"
            or actual_env != expected_env or len(actual_env) != len(config.get("Env", []))
            or binds != expected_mounts or len(binds) != sum(item.get("Type") == "bind" for item in mounts)
            or extra_mounts or set(networks) != set(expected_networks)
            or any(expected is None or networks[key].get("NetworkID") != expected["Id"]
                   for key, expected in expected_networks.items())
            or host.get("NetworkMode") != names["network"] or host.get("Privileged") is not False
            or host.get("ReadonlyRootfs") is not True or host.get("CapDrop") != ["ALL"]
            or host.get("SecurityOpt") != ["no-new-privileges"]
            or host.get("CapAdd") or host.get("PortBindings") or host.get("Devices")
            or host.get("Memory") != memory_bytes or host.get("MemorySwap") != memory_bytes
            or host.get("PidsLimit") != container.PIDS_LIMIT
            or host.get("Tmpfs") != {"/tmp": "rw,nosuid,noexec,size=1073741824"}
            or not isinstance(found.get("State"), dict)):
        raise state.fail("LIVE_IDENTITY_CHANGED", "the retained container does not match its declared execution identity")
    return found


def _runner(root: Path, run_id: str, directory: Path, manifest: dict, launch: dict) -> dict | None:
    started = next((row for row in reversed(_host_events(directory))
                    if row["event"] == "container_started" and row.get("container") == launch["container"]), None)
    return _container(root, run_id, directory, manifest, launch["container"], "runner", mode=launch["mode"],
                      credentials_path=launch.get("credentials_path"),
                      container_id=started.get("container_id") if started else None)


def _manifest(root: Path, run_id: str) -> tuple[Path, dict]:
    directory = state.directory(root, run_id)
    manifest = state.read(directory / "inputs" / "manifest.json")
    if manifest.get("run_id") != run_id or manifest.get("format") != "live-run-v1":
        raise state.fail("LIVE_IDENTITY_CHANGED", "the private manifest does not identify this run")
    for filename, digest in (("strategy.py", manifest["source"]["source_sha256"]),
                             ("universe.json", manifest["universe_sha256"])):
        path = directory / "inputs" / filename
        if path.is_symlink() or hashlib.sha256(path.read_bytes()).hexdigest() != digest:
            raise state.fail("LIVE_IDENTITY_CHANGED", "the declared Live inputs have changed")
    return directory, manifest


def _host_events(directory: Path) -> list[dict]:
    return state.events(directory / "lifecycle.jsonl")


def _latest_launch(directory: Path) -> dict | None:
    return next((row for row in reversed(_host_events(directory)) if row["event"] == "launch_requested"), None)


def _clean(directory: Path, run_id: str) -> bool:
    launch = _latest_launch(directory)
    if launch is None:
        return False
    return any(row.get("event") in ("clean_stop", "reconciled_flat") and row.get("run_id") == run_id
               and row.get("observed_ns", row.get("ts_ns", 0)) >= launch["observed_ns"]
               for row in state.events(directory / "out" / "events.jsonl"))


def _active(root: Path) -> str | None:
    rows = state.events(root / "account.jsonl")
    active = None
    for row in rows:
        if row["event"] == "reserved":
            active = row["run_id"]
        elif row["event"] == "released" and row["run_id"] == active:
            active = None
    return active


def _never_armed(root: Path, run_id: str, directory: Path, manifest: dict) -> bool:
    """A runner constructs its source only after arming, so an exited unarmed runner placed no order."""
    # Containers first: a runner still alive could arm between the file check and its inspection.
    for launch in _host_events(directory):
        if launch["event"] == "launch_requested" and launch["mode"] != "preflight":
            # Every launch: a timed-out `docker run` can stay alive behind a later one, and a missing
            # container proves nothing.
            actual = _runner(root, run_id, directory, manifest, launch)
            if actual is None or actual["State"].get("Status") != "exited":
                return False
    output = directory / "out"
    return (not os.path.lexists(output / "armed.json")
            and not any(row.get("event") == "connecting" for row in state.events(output / "events.jsonl")))


def _release_if_resolved(root: Path, run_id: str, directory: Path) -> None:
    launch = _latest_launch(directory)
    _, manifest = _manifest(root, run_id)
    actual = _runner(root, run_id, directory, manifest, launch) if launch else None
    if _active(root) != run_id:
        return
    if actual and not actual["State"].get("Running") and actual["State"].get("ExitCode") == 0 \
            and _clean(directory, run_id):
        state.append(root / "account.jsonl", "released", run_id, reason="native_and_venue_flat")
    elif _never_armed(root, run_id, directory, manifest):
        state.append(root / "account.jsonl", "released", run_id, reason="never_armed")


def _released_unarmed(root: Path, run_id: str) -> bool:
    return any(row["event"] == "released" and row["run_id"] == run_id and row.get("reason") == "never_armed"
               for row in state.events(root / "account.jsonl"))


def _credentials(path: Path, binding: str | None = None) -> str:
    try:
        found = read_credentials(path)
    except EngineRefusal as exc:
        raise state.fail(exc.code, str(exc)) from None
    if binding is not None and found.binding != binding:
        raise state.fail("LIVE_ACCOUNT_CHANGED", "this run cannot use a different API key")
    return found.binding


def _positive(value: str, name: str) -> str:
    try:
        amount = Decimal(value)
        if not amount.is_finite() or amount <= 0:
            raise ValueError
        return str(amount)
    except (InvalidOperation, ValueError) as exc:
        raise state.fail("LIVE_CONFIG", f"{name} must be a finite positive decimal") from exc


def prepare(root: Path, run_id: str, research: db.LedgerProfile, research_at: str, candidate: str,
            symbols: list[str], universe: Path, credentials: Path, runtime: str | None, *,
            budget_usdt: str, max_notional_per_order: str, duration_seconds: int, memory: str,
            single_order_source_reviewed: bool, strategy_file: Path | None = None,
            strategy_class: str | None = None) -> dict:
    """Capture immutable source inputs using the reader, before any account effect."""
    with state.serialized(root) as root:
        directory = state.directory(root, run_id)
        binding = _credentials(credentials)
        if not db.COMMIT_HASH.fullmatch(research_at):
            raise state.fail("LIVE_RESEARCH_COMMIT", "Live requires the exact full research commit")
        if (not symbols or len(set(symbols)) != len(symbols)
                or any(not re.fullmatch(r"[A-Z0-9]+USDT", symbol) for symbol in symbols)):
            raise state.fail("LIVE_SYMBOLS", "Live requires distinct explicit USD-M symbols")
        if isinstance(duration_seconds, bool) or not isinstance(duration_seconds, int) or duration_seconds < 1:
            raise state.fail("LIVE_CONFIG", "duration-seconds must be a positive integer")
        config = {"budget_usdt": _positive(budget_usdt, "budget-usdt"),
                  "max_notional_per_order": _positive(max_notional_per_order, "max-notional-per-order"),
                  "duration_seconds": duration_seconds, "memory": memory,
                  "single_order_source_reviewed": bool(single_order_source_reviewed),
                  "proxy_url": f"http://{_names(root, run_id)['egress']}:3128"}
        if (strategy_file is None) != (strategy_class is None):
            raise state.fail("LIVE_CONFIG", "an adapted source needs both strategy-file and strategy-class")
        actual_source = None
        if strategy_file is not None:
            from engine.load import read_regular_file, load_strategy
            try:
                actual_source = read_regular_file(strategy_file)
                actual_hash = hashlib.sha256(actual_source).hexdigest()
                load_strategy(strategy_file, str(strategy_class), actual_hash)
            except EngineRefusal as exc:
                raise state.fail("LIVE_SOURCE_UNSUPPORTED", str(exc)) from None
        if directory.exists():
            _, prior = _manifest(root, run_id)
            source_ref = f"{prior['origin_candidate']['strategy_id']}@{prior['origin_candidate']['revision']}"
            if (source_ref != candidate or prior["symbols"] != symbols or prior["config"] != config
                    or prior["credential_binding"] != binding
                    or universe.is_symlink()
                    or hashlib.sha256(universe.read_bytes()).hexdigest() != prior["universe_sha256"]
                    or actual_source is not None and (prior["source"]["source_sha256"] != actual_hash
                                                     or prior["source"]["entry_class"] != strategy_class)
                    or runtime is not None and "@" in runtime and runtime != prior["runtime"]["image_ref"]):
                raise state.fail("LIVE_RUN_CONFLICT", "run-id already binds different inputs, settings or credentials")
            return prior
        with db.read_as_of(research, research_at) as reader:
            found = strategies.read_candidate(reader, candidate)
        if universe.is_symlink():
            raise state.fail("LIVE_UNIVERSE", "the universe must be a regular file")
        universe_bytes = universe.read_bytes()
        from engine.load import read_universe
        try:
            read_universe(universe, symbols)
        except EngineRefusal as exc:
            raise state.fail("LIVE_UNIVERSE", str(exc)) from None
        identity = image.resolve(runtime)
        inspection = image.inspect_runtime(identity, ["--market-root", "/unused", "--market-commit", "live",
                                                       "--symbols", *symbols, "--start", "2026-01-01T00:00:00Z",
                                                       "--end", "2026-01-02T00:00:00Z"])
        image.require_main_build(identity, inspection)
        if found["runtime_contract"] != identity["runtime_contract"]:
            raise state.fail("LIVE_IDENTITY_CHANGED", "the source and fixed runtime contracts differ")
        source_bytes = found["source"] if actual_source is None else actual_source
        key = hashlib.sha256(run_id.encode()).hexdigest()[:12]
        manifest = {"format": "live-run-v1", "run_id": run_id,
                    "origin_candidate": {name: found[name] for name in ("strategy_id", "revision", "source_sha256")},
                    "source": {"entry_class": strategy_class or found["entry_class"],
                               "source_sha256": hashlib.sha256(source_bytes).hexdigest()},
                    "runtime": identity, "symbols": symbols, "config": config, "credential_binding": binding,
                    "trader_id": f"LIVE-{key}", "account_id": f"BINANCE-LIVE-{key}",
                    "strategy_file": "/inputs/strategy.py", "universe_file": "/inputs/universe.json",
                    "universe_sha256": hashlib.sha256(universe_bytes).hexdigest()}
        for part in (directory, directory / "inputs", directory / "out", directory / "egress"):
            state.private_directory(part)
        state.write_new(directory / "inputs" / "strategy.py", source_bytes)
        state.write_new(directory / "inputs" / "universe.json", universe_bytes)
        state.write_new(directory / "inputs" / "manifest.json", state.encode(manifest))
        state.append(directory / "lifecycle.jsonl", "prepared", run_id)
        return manifest


def _network(root: Path, run_id: str, directory: Path, manifest: dict) -> dict:
    names = _names(root, run_id)
    network_created = next((row for row in reversed(_host_events(directory))
                            if row["event"] == "network_created"), None)
    network_id = network_created.get("network_id") if network_created else None
    network = _network_identity(names["network"], run_id, network_id)
    if network is None:
        if network_created:
            raise state.fail("LIVE_IDENTITY_CHANGED", "the original private network is missing; no replacement is created")
        _checked("network", "create", "--internal", "--label", f"{LABEL}.run={run_id}", names["network"])
        network = _network_identity(names["network"], run_id)
        if network is None:
            raise state.fail("LIVE_DOCKER_UNAVAILABLE", "the created private network cannot be verified")
        state.append(directory / "lifecycle.jsonl", "network_created", run_id, network_id=network["Id"])
    created = next((row for row in reversed(_host_events(directory)) if row["event"] == "egress_created"), None)
    actual = _container(root, run_id, directory, manifest, names["egress"], "egress",
                        container_id=created.get("container_id") if created else None)
    if actual is None:
        if created:
            raise state.fail("LIVE_IDENTITY_CHANGED", "the original egress container is missing; no replacement is created")
        command = container.live_command(manifest["runtime"], [(directory / "egress", "/reports", False)],
                                         "engine.egress", ["--port", "3128", "--log", "/reports/egress.log"],
                                         name=names["egress"], network=names["network"], memory="256m",
                                         labels={f"{LABEL}.run": run_id, f"{LABEL}.role": "egress"})
        identifier = _checked(*command[1:])
        if not re.fullmatch(r"[0-9a-f]{64}", identifier):
            raise state.fail("LIVE_DOCKER_UNAVAILABLE", "Docker did not return the created egress identity")
        _checked("network", "connect", "bridge", names["egress"])
        if _container(root, run_id, directory, manifest, names["egress"], "egress", container_id=identifier) is None:
            raise state.fail("LIVE_DOCKER_UNAVAILABLE", "the created egress container cannot be verified")
        state.append(directory / "lifecycle.jsonl", "egress_created", run_id, container_id=identifier)
    elif not actual["State"].get("Running"):
        _checked("start", actual["Id"])
    return names


def launch(root: Path, run_id: str, credentials: Path, mode: str, *, strategy_file: Path | None = None,
           strategy_class: str | None = None) -> dict:
    if mode not in ("preflight", "run", "reconcile"):
        raise state.fail("LIVE_MODE", "unknown Live operation")
    with state.serialized(root) as root:
        directory, manifest = _manifest(root, run_id)
        if (strategy_file is None) != (strategy_class is None):
            raise state.fail("LIVE_CONFIG", "source verification needs both strategy-file and strategy-class")
        if strategy_file is not None:
            from engine.load import read_regular_file
            try:
                actual_hash = hashlib.sha256(read_regular_file(strategy_file)).hexdigest()
            except EngineRefusal as exc:
                raise state.fail("LIVE_SOURCE_MISSING", str(exc)) from None
            if actual_hash != manifest["source"]["source_sha256"] or strategy_class != manifest["source"]["entry_class"]:
                raise state.fail("LIVE_IDENTITY_CHANGED", "start cannot replace the already prepared source")
        _credentials(credentials, manifest["credential_binding"])
        active = _active(root)
        if active and active != run_id:
            other, _ = _manifest(root, active)
            _release_if_resolved(root, active, other)
            if _active(root):
                raise state.fail("LIVE_ACCOUNT_OWNED", f"run {active} still owns this account slot")
        latest = _latest_launch(directory)
        if latest:
            actual = _runner(root, run_id, directory, manifest, latest)
            if actual and actual["State"].get("Running"):
                if latest["mode"] == mode:
                    return {"run_id": run_id, "mode": mode, "state": "running", "write_status": "replayed"}
                raise state.fail("LIVE_RUNNING", "the previous Live process must end before another mode starts")
            if mode == "run" and any(row.get("mode") == "run" for row in _host_events(directory)):
                raise state.fail("LIVE_RESTART_REQUIRES_RECONCILIATION",
                                 "an attempted Live run cannot cold restart; after not_armed, prepare a new run-id")
        if mode == "reconcile" and not os.path.lexists(directory / "out" / "armed.json"):
            # Checked here too: a released run must not take the slot back only to be refused by its runner.
            raise state.fail("LIVE_RUN_MISSING", "reconciliation needs the original armed execution")
        if mode != "preflight" and _active(root) is None:
            state.append(root / "account.jsonl", "reserved", run_id)
        names = _network(root, run_id, directory, manifest)
        attempt = sum(row["event"] == "launch_requested" for row in _host_events(directory)) + 1
        runner = names["network"] + f"-{mode}-{attempt}"
        command = container.live_command(
            manifest["runtime"], [(directory / "inputs", "/inputs", True), (directory / "out", "/reports", False),
                                  (credentials.absolute(), "/run/secrets/binance.json", True)],
            "engine.live", _runner_args(mode),
            name=runner, network=names["network"], memory=manifest["config"]["memory"],
            labels={f"{LABEL}.run": run_id, f"{LABEL}.role": "runner"})
        credentials_path = str(credentials.resolve())
        state.append(directory / "lifecycle.jsonl", "launch_requested", run_id, mode=mode, container=runner,
                     credentials_path=credentials_path)
        try:
            identifier = _checked(*command[1:])
            if not re.fullmatch(r"[0-9a-f]{64}", identifier):
                raise state.fail("LIVE_DOCKER_UNAVAILABLE", "Docker did not return the launched runner identity")
            if _container(root, run_id, directory, manifest, runner, "runner", mode=mode,
                          credentials_path=credentials_path, container_id=identifier) is None:
                raise state.fail("LIVE_DOCKER_UNAVAILABLE", "the launched runner cannot be verified")
        except Exception:
            state.append(directory / "lifecycle.jsonl", "launch_unresolved", run_id, mode=mode)
            raise
        state.append(directory / "lifecycle.jsonl", "container_started", run_id, mode=mode, container=runner,
                     container_id=identifier)
        return {"run_id": run_id, "mode": mode, "state": "starting", "write_status": "written",
                "directory": str(directory), "container": runner}


def status(root: Path, run_id: str) -> dict:
    with state.serialized(root) as root:
        directory, manifest = _manifest(root, run_id)
        launch = _latest_launch(directory)
        actual = _runner(root, run_id, directory, manifest, launch) if launch else None
        _release_if_resolved(root, run_id, directory)
        clean = bool(launch and actual and actual["State"].get("ExitCode") == 0 and _clean(directory, run_id))
        running = bool(actual and actual["State"].get("Running"))
        result = ("running" if running else "clean_stopped" if clean and actual
                  else "not_armed" if launch and _released_unarmed(root, run_id)
                  else "unresolved" if launch else "prepared")
        if result == "clean_stopped" and launch and launch["mode"] == "reconcile":
            result = "reconciled_flat"
        if launch and launch["mode"] == "preflight" and actual and not running:
            result = "preflight_complete" if actual["State"].get("ExitCode") == 0 else "preflight_failed"
        return {"run_id": run_id, "state": result, "mode": launch["mode"] if launch else None,
                "account_owned": _active(root) == run_id, "container": launch["container"] if launch else None,
                "origin_candidate": manifest["origin_candidate"], "source": manifest["source"],
                "symbols": manifest["symbols"],
                "exit_code": actual["State"].get("ExitCode") if actual else None}


def stop(root: Path, run_id: str) -> dict:
    with state.serialized(root) as root:
        directory, _ = _manifest(root, run_id)
        target = directory / "out" / "STOP"
        if not target.exists():
            state.write_new(target, b"operator stop\n")
            state.append(directory / "lifecycle.jsonl", "stop_requested", run_id)
        return {"run_id": run_id, "state": "stop_requested", "write_status": "written",
                "note": "The runner must confirm flat; no process is killed and no external order is canceled."}


def logs(root: Path, run_id: str, tail: int = 200) -> dict:
    if not 1 <= tail <= 2000:
        raise state.fail("LIVE_LOG_LIMIT", "tail must be between 1 and 2000 lines")
    with state.serialized(root) as root:
        directory, manifest = _manifest(root, run_id)
        launch = _latest_launch(directory)
        if not launch:
            return {"run_id": run_id, "lines": []}
        actual = _runner(root, run_id, directory, manifest, launch)
        if actual is None:
            raise state.fail("LIVE_DOCKER_UNAVAILABLE", "the retained Live container is unavailable")
        result = _docker("logs", "--tail", str(tail), actual["Id"])
        if result.returncode:
            raise state.fail("LIVE_DOCKER_UNAVAILABLE", "the retained Live log is unavailable")
        return {"run_id": run_id, "lines": (result.stdout + result.stderr)[-131072:].splitlines()[-tail:]}
