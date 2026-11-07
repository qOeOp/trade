"""Host lifecycle for one private Live account slot, with retained originals.

No command writes to research or Paper. An ambiguous launch owns the account slot
until the runner observes it flat (natively, or the whole account at Binance), or every
runner it started is proven to have exited without arming. A dead container is never flat evidence. An ended run gives
up its containers and network; its directory remains the execution record.
"""

from __future__ import annotations

from decimal import Decimal, InvalidOperation
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
from typing import TYPE_CHECKING

from engine.config import Refusal as EngineRefusal
from engine.live_errors import LiveRefusal
from engine.live_venue import MANIFEST_FORMAT, read_credentials
from ledger import db, strategies
from runtime import container, image
from live import key, requests, state

if TYPE_CHECKING:
    from live.authority import Authority


LABEL = "trade.live"
VALIDATION_NOTE = ("status is the bound run's audit status (unbound, bound, passed, invalid), no verdict on returns: "
                   "read validation report <registration_id>. A registration covers the origin candidate on its "
                   "universe_rule, never a rewritten source.")
RETAINED_FORMATS = ("live-run-v1", "live-run-v2", "live-run-v3", "live-run-v4")  # readable and reconcilable, never started: their images lack later checks
# The runner's flat events and the states they end a run in; venue_flat is the whole account at Binance only.
FLAT = {"clean_stop": "clean_stopped", "reconciled_flat": "reconciled_flat", "venue_flat": "venue_flat"}
ENDED = {*FLAT.values(), "not_armed", "preflight_complete", "preflight_failed"}
UNRESOLVED_NOTE = ("Exposure may remain at Binance and nothing will close it: follow 'Unresolved Live runs' in "
                   "engine/README.md now (live stop, close and cancel at Binance, then live reconcile).")
REPEATABLE = {"preflight_complete", "preflight_failed"}  # no slot and no order: this run may still start
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
    if manifest.get("run_id") != run_id or manifest.get("format") not in (MANIFEST_FORMAT, *RETAINED_FORMATS):
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


def _flat(directory: Path, run_id: str) -> str | None:
    """The state a flat event of the latest launch ends the run in."""
    launch = _latest_launch(directory)
    if launch is None:
        return None
    return next((FLAT[row["event"]] for row in state.events(directory / "out" / "events.jsonl")
                 if row.get("event") in FLAT and row.get("run_id") == run_id
                 and row.get("observed_ns", row.get("ts_ns", 0)) >= launch["observed_ns"]), None)


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
    flat = _flat(directory, run_id)
    if actual and not actual["State"].get("Running") and actual["State"].get("ExitCode") == 0 and flat:
        state.append(root / "account.jsonl", "released", run_id,
                     reason="venue_flat" if flat == "venue_flat" else "native_and_venue_flat")
    elif _never_armed(root, run_id, directory, manifest):
        state.append(root / "account.jsonl", "released", run_id, reason="never_armed")


def _released_unarmed(root: Path, run_id: str) -> bool:
    return any(row["event"] == "released" and row["run_id"] == run_id and row.get("reason") == "never_armed"
               for row in state.events(root / "account.jsonl"))


def _since_removal(directory: Path) -> list[dict]:
    events = _host_events(directory)
    last = max((index for index, row in enumerate(events) if row["event"] == "recycled"), default=-1)
    return events[last + 1:]


def _recycled(directory: Path) -> dict | None:
    """The record of a removal that still describes the run; a later launch starts over."""
    for row in reversed(_host_events(directory)):
        if row["event"] == "launch_requested":
            return None
        if row["event"] == "recycled":
            return row
    return None


def _settled(root: Path, run_id: str, launch: dict | None) -> str | None:
    """A release after the latest launch already decided the run, so no container has to be read."""
    if launch is None or _active(root) == run_id:
        return None
    reason = next((row.get("reason") for row in reversed(state.events(root / "account.jsonl"))
                   if row["event"] == "released" and row["run_id"] == run_id
                   and row["observed_ns"] >= launch["observed_ns"]), None)
    if reason == "never_armed":
        return "not_armed"
    if reason == "native_and_venue_flat":
        return "reconciled_flat" if launch["mode"] == "reconcile" else "clean_stopped"
    return "venue_flat" if reason == "venue_flat" else None


def _log_file(directory: Path, container: str) -> Path:
    return directory / "containers" / (container + ".log")


def _owned_containers(root: Path, run_id: str) -> list[dict]:
    listed = _checked("ps", "-a", "--no-trunc", "--filter", f"label={LABEL}.run={run_id}", "--format", "{{.ID}}")
    prefix = "/" + _names(root, run_id)["network"]
    found = [_inspect("container", identifier) for identifier in listed.split()]
    return [item for item in found if item and item.get("Name", "").startswith(prefix)]


def _remove_resources(root: Path, run_id: str, containers: list[dict]) -> None:
    """Only the egress can still be running here; a runner that has not exited stops the removal earlier.

    The egress holds no state and ignores SIGTERM, so it gets a short stop rather than the 120 second default.
    """
    for item in containers:
        if item["Config"]["Labels"].get(f"{LABEL}.role") == "egress" and item["State"].get("Running"):
            _checked("stop", "--time", "5", item["Id"])
        _checked("rm", item["Id"])
    name = _names(root, run_id)["network"]
    if _network_identity(name, run_id) is not None:
        _checked("network", "rm", name)


def _recycle(root: Path, run_id: str, directory: Path, result: str, launch: dict) -> None:
    """Give up an ended run's resources, keeping what `live logs` reads. Never changes the run's result."""
    try:
        recorded = _recycled(directory)
        containers = _owned_containers(root, run_id)
        if recorded is None:
            if any(item["Config"]["Labels"].get(f"{LABEL}.role") != "egress"
                   and item["State"].get("Status") != "exited" for item in containers):
                return  # A runner from an earlier launch that timed out could still be alive.
            state.private_directory(directory / "containers")
            exit_code = 0 if result in FLAT.values() else None
            for item in containers:
                name = item["Name"].removeprefix("/")
                if name == launch["container"]:
                    exit_code = item["State"].get("ExitCode")
                output = _docker("logs", item["Id"])
                if output.returncode:
                    return
                # Whole or absent: the container is removed on the strength of this file.
                path = _log_file(directory, name)
                pending = path.with_suffix(".pending")
                pending.unlink(missing_ok=True)
                state.write_new(pending, (output.stdout + output.stderr).encode())
                os.replace(pending, path)
                state.fsync_parent(path)
            # Recorded first: a removal cut short is finished later and never leaves a run that looks unended.
            state.append(directory / "lifecycle.jsonl", "recycled", run_id, state=result, exit_code=exit_code)
        elif _since_removal(directory):
            # Resources made by a start that never launched: without a new record they would look still present.
            state.append(directory / "lifecycle.jsonl", "recycled", run_id, state=recorded["state"],
                         exit_code=recorded["exit_code"])
        _remove_resources(root, run_id, containers)
    except (LiveRefusal, OSError):
        return


def _recycle_others(root: Path, current: str) -> None:
    """Runs nobody asks about again would otherwise keep their proxy until the host is rebuilt."""
    try:
        template = f'{{{{.Label "{LABEL}.run"}}}}'
        found = _checked("ps", "-a", "--no-trunc", "--filter", f"label={LABEL}.run", "--format", template)
        found += "\n" + _checked("network", "ls", "--filter", f"label={LABEL}.run", "--format", template)
    except (LiveRefusal, OSError):
        return
    for run_id in sorted(set(found.split()) - {current}):
        try:
            directory, manifest = _manifest(root, run_id)
            launch = _latest_launch(directory)
            if launch is None or _active(root) == run_id:
                continue
            recorded = _recycled(directory)
            result = (recorded["state"] if recorded else _settled(root, run_id, launch)
                      or _outcome(root, run_id, directory, manifest, launch)[0])
            if result in ENDED:
                _recycle(root, run_id, directory, result, launch)
        except (LiveRefusal, OSError, KeyError):
            continue


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


def _bound_credential(root: Path, run_id: str, directory: Path, path: Path, mode: str,
                      request_id: str | None) -> dict | None:
    """Managed versions are the same boundary for the web and the legacy operator CLI."""
    prepared = next((row for row in _host_events(directory) if row.get("event") == "prepared"), None)
    if prepared is None or prepared.get("credential_ref") is None:
        return None  # Retained pre-management runs keep their original operator path.
    from live import credentials as credential_store
    expected = credential_store.run_path_locked(root, run_id, mode, request_id=request_id)
    if path.resolve() != expected.resolve():
        raise state.fail("LIVE_CREDENTIAL_CHANGED", "the prepared run requires its original credential version file")
    return prepared


def _candidate_source(research: db.LedgerProfile, research_at: str, candidate: str) -> tuple[str, str]:
    with db.read_as_of(research, research_at) as reader:
        found = strategies.read_candidate(reader, candidate)
    return found["source_sha256"], found["entry_class"]



def prepare(root: Path, run_id: str, research: db.LedgerProfile, research_at: str, candidate: str,
            symbols: list[str], universe: Path, credentials: Path, runtime: str | None, *,
            budget_usdt: str, max_notional_per_order: str, max_loss_usdt: str, duration_seconds: int, memory: str,
            single_order_source_reviewed: bool, scope: Authority, strategy_file: Path | None = None,
            strategy_class: str | None = None) -> dict:
    """Capture immutable source inputs using the installed account authority."""
    with scope.serialized(root) as root:
        scope.admit_locked(root)
        return _prepare_locked(root, run_id, research, research_at, candidate, symbols, universe, credentials, runtime,
                               budget_usdt=budget_usdt, max_notional_per_order=max_notional_per_order,
                               max_loss_usdt=max_loss_usdt, duration_seconds=duration_seconds, memory=memory,
                               single_order_source_reviewed=single_order_source_reviewed,
                               strategy_file=strategy_file, strategy_class=strategy_class)


def _prepare_locked(root: Path, run_id: str, research: db.LedgerProfile, research_at: str, candidate: str,
                    symbols: list[str], universe: Path, credentials: Path, runtime: str | None, *,
                    budget_usdt: str, max_notional_per_order: str, max_loss_usdt: str, duration_seconds: int, memory: str,
                    single_order_source_reviewed: bool, strategy_file: Path | None = None,
                    strategy_class: str | None = None, request_id: str | None = None,
                    credential_ref: str | None = None, recover_partial: bool = False) -> dict:
    """Capture immutable source inputs using the reader, before any account effect."""
    requests.require_clear(root, request_id)
    directory = state.directory(root, run_id)
    bound_prepared = _bound_credential(root, run_id, directory, credentials, "preflight", request_id)
    binding = _credentials(credentials)
    if not db.COMMIT_HASH.fullmatch(research_at):
        raise state.fail("LIVE_RESEARCH_COMMIT", "Live requires the exact full research commit")
    if (not symbols or len(set(symbols)) != len(symbols)
            or any(not re.fullmatch(r"[A-Z0-9]+USDT", symbol) for symbol in symbols)):
        raise state.fail("LIVE_SYMBOLS", "Live requires distinct explicit USD-M symbols")
    if isinstance(duration_seconds, bool) or not isinstance(duration_seconds, int) or duration_seconds < 1:
        raise state.fail("LIVE_CONFIG", "duration-seconds must be a positive integer")
    budget, max_loss = _positive(budget_usdt, "budget-usdt"), _positive(max_loss_usdt, "max-loss-usdt")
    if Decimal(max_loss) > Decimal(budget):
        raise state.fail("LIVE_CONFIG", "max-loss-usdt cannot exceed budget-usdt")
    config = {"budget_usdt": budget,
              "max_notional_per_order": _positive(max_notional_per_order, "max-notional-per-order"),
              "max_loss_usdt": max_loss,
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
    if directory.exists() and not recover_partial:
        _, prior = _manifest(root, run_id)
        if prior["format"] != MANIFEST_FORMAT:
            raise state.fail("LIVE_RUN_FORMAT", "this run predates current Live checks; prepare a new run-id")
        source_ref = f"{prior['origin_candidate']['strategy_id']}@{prior['origin_candidate']['revision']}"
        if (source_ref != candidate or prior["symbols"] != symbols or prior["config"] != config
                or prior["credential_binding"] != binding
                or universe.is_symlink()
                or hashlib.sha256(universe.read_bytes()).hexdigest() != prior["universe_sha256"]
                or runtime is not None and "@" in runtime and runtime != prior["runtime"]["image_ref"]
                # Last, so the candidate is read only when everything else matches: without a file this
                # call binds the candidate's own source and class, which an adapted run does not hold.
                or (prior["source"]["source_sha256"], prior["source"]["entry_class"])
                != ((actual_hash, strategy_class) if actual_source is not None
                    else _candidate_source(research, research_at, candidate))):
            raise state.fail("LIVE_RUN_CONFLICT", "run-id already binds different inputs, settings or credentials")
        if bound_prepared and request_id is None:
            original_id = bound_prepared.get("request_id")
            if not original_id:
                raise state.fail("LIVE_RUN_CONFLICT", "the prepared run's original research snapshot is unavailable")
            _require_frozen_prepare(root, original_id, prior, research_at, candidate,
                                    bound_prepared["credential_ref"])
        if request_id is not None:
            prepared = next((row for row in _host_events(directory) if row.get("event") == "prepared"), None)
            original = requests.read_locked(root, prepared["request_id"]) if prepared and prepared.get("request_id") else None
            current = requests.read_locked(root, request_id)
            if (not prepared or prepared.get("credential_ref") != credential_ref or not original or not current
                    or requests.is_closed(original) or requests.is_closed(current)):
                raise state.fail("LIVE_RUN_CONFLICT", "a prepared run retains its original request and research snapshot")
            if current["command"]["action"] == "preflight" and current["command"]["target"].get("run_id") == run_id:
                _require_frozen_prepare(root, original["request_id"], prior, research_at, candidate, credential_ref)
            else:
                _require_frozen_prepare(root, request_id, prior, research_at, candidate, credential_ref)
                if not requests.same_command(original["command"], current["command"]):
                    raise state.fail("LIVE_RUN_CONFLICT", "a prepared run retains its original request and research snapshot")
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
    manifest = {"format": MANIFEST_FORMAT, "run_id": run_id,
                "origin_candidate": {name: found[name] for name in ("strategy_id", "revision", "source_sha256")},
                "source": {"entry_class": strategy_class or found["entry_class"],
                           "source_sha256": hashlib.sha256(source_bytes).hexdigest()},
                "runtime": identity, "symbols": symbols, "config": config, "credential_binding": binding,
                "trader_id": f"LIVE-{key}", "account_id": f"BINANCE-LIVE-{key}",
                "strategy_file": "/inputs/strategy.py", "universe_file": "/inputs/universe.json",
                "universe_sha256": hashlib.sha256(universe_bytes).hexdigest()}
    if request_id is not None:
        _require_frozen_prepare(root, request_id, manifest, research_at, candidate, credential_ref)
    elif recover_partial:
        raise state.fail("LIVE_RUN_CONFLICT", "partial preparation needs its original fixed request")
    files = ((directory / "inputs" / "strategy.py", source_bytes),
             (directory / "inputs" / "universe.json", universe_bytes),
             (directory / "inputs" / "manifest.json", state.encode(manifest)))
    prior_events = _host_events(directory) if recover_partial else []
    if recover_partial:
        # A local-only recovery may fill missing inputs, never overwrite a partial or different write.
        if any(row.get("event") != "prepared" or row.get("request_id") != request_id
               or row.get("credential_ref") != credential_ref for row in prior_events):
            raise state.fail("LIVE_RUN_CONFLICT", "partial preparation has other retained lifecycle effects")
        for path, data in files:
            if os.path.lexists(path) and (path.is_symlink() or not path.is_file() or path.read_bytes() != data):
                raise state.fail("LIVE_RUN_CONFLICT", "partial preparation contains different retained bytes")
    for part in (directory, directory / "inputs", directory / "out", directory / "egress"):
        state.private_directory(part)
    for path, data in files:
        if not recover_partial or not os.path.lexists(path):
            state.write_new(path, data)
    if not prior_events:
        state.append(directory / "lifecycle.jsonl", "prepared", run_id,
                     **({"request_id": request_id} if request_id is not None else {}),
                     **({"credential_ref": credential_ref} if credential_ref is not None else {}))
    return manifest


def _require_frozen_prepare(root: Path, request_id: str, manifest: dict, research_at: str, candidate: str,
                            credential_ref: str | None) -> None:
    claim = requests.read_locked(root, request_id)
    command = claim["command"] if claim and not requests.is_closed(claim) else {}
    inputs = command.get("inputs", {})
    wanted = {"research_at": research_at, "candidate": candidate, "symbols": manifest["symbols"],
              "source_sha256": manifest["source"]["source_sha256"], "entry_class": manifest["source"]["entry_class"],
              "universe_sha256": manifest["universe_sha256"], "runtime": manifest["runtime"]["image_ref"],
              "config": {name: manifest["config"][name] for name in (
                  "budget_usdt", "max_notional_per_order", "max_loss_usdt", "duration_seconds", "memory",
                  "single_order_source_reviewed")}}
    if (command.get("action") != "prepare" or claim is None or claim["disposition"] is not None
            or command.get("target") != {"run_id": manifest["run_id"], "credential_ref": credential_ref}
            or type(inputs.get("config", {}).get("single_order_source_reviewed")) is not bool
            or any(inputs.get(name) != value for name, value in wanted.items())):
        raise state.fail("LIVE_RUN_CONFLICT", "preparation differs from its original immutable request")


def review(research: db.LedgerProfile, research_at: str, manifest: dict) -> dict:
    """What the operator reads before start: the pinned source and image and the facts at this commit, no gate and no
    conclusion. An absent candidate is refused, so an empty list means no registration."""
    from registration import validation
    origin, source = manifest["origin_candidate"], manifest["source"]
    with db.read_as_of(research, research_at) as reader:
        found = strategies.read_candidate(reader, f"{origin['strategy_id']}@{origin['revision']}")
        registrations = validation.candidate_registrations(reader, origin["strategy_id"], origin["revision"])
    return {"research_at": research_at, "origin_candidate": origin, "source_sha256": source["source_sha256"],
            "entry_class": source["entry_class"], "image_ref": manifest["runtime"]["image_ref"],
            "rewritten": (source["source_sha256"], source["entry_class"]) != (found["source_sha256"], found["entry_class"]),
            "origin_candidate_validations": registrations, "validation_note": VALIDATION_NOTE}


def require_confirmed(root: Path, run_id: str, source_sha256: str, *, scope: Authority) -> None:
    """Start names the source that will place real orders, so no default can start one. Not a secret: it asks for intent."""
    with state.reading(root) as root:
        scope.admit_locked(root, inventory=False)
        _require_confirmed_locked(root, run_id, source_sha256)


def _require_confirmed_locked(root: Path, run_id: str, source_sha256: str) -> None:
    _, manifest = _manifest(root, run_id)
    if source_sha256 != manifest["source"]["source_sha256"]:
        raise state.fail("LIVE_IDENTITY_CHANGED", "--confirm-real-orders must be the source_sha256 this run's "
                                                  "preflight or status shows; nothing was started")


def _network(root: Path, run_id: str, directory: Path, manifest: dict) -> dict:
    names = _names(root, run_id)
    events = _since_removal(directory)
    network_created = next((row for row in reversed(events) if row["event"] == "network_created"), None)
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
    created = next((row for row in reversed(events) if row["event"] == "egress_created"), None)
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


def launch(root: Path, run_id: str, credentials: Path, mode: str, *, scope: Authority, strategy_file: Path | None = None,
           strategy_class: str | None = None) -> dict:
    with scope.serialized(root) as root:
        scope.admit_locked(root)
        return _launch_locked(root, run_id, credentials, mode, strategy_file=strategy_file,
                              strategy_class=strategy_class)


def _launch_locked(root: Path, run_id: str, credentials: Path, mode: str, *, strategy_file: Path | None = None,
           strategy_class: str | None = None, request_id: str | None = None) -> dict:
    if mode not in ("preflight", "run", "reconcile"):
        raise state.fail("LIVE_MODE", "unknown Live operation")
    requests.require_clear(root, request_id)
    directory, manifest = _manifest(root, run_id)
    if manifest["format"] != MANIFEST_FORMAT and mode != "reconcile":
        raise state.fail("LIVE_RUN_FORMAT", "this run predates current Live checks; prepare a new run-id")
    _bound_credential(root, run_id, directory, credentials, mode, request_id)
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
    recorded = _recycled(directory)
    if recorded and recorded["state"] not in REPEATABLE and mode != "run":
        # Before the slot: its original network and egress are gone, so nothing could run.
        raise state.fail("LIVE_RUN_MISSING", "this run has ended and given up its containers; prepare a new run-id")
    if recorded and recorded["state"] in REPEATABLE and not _since_removal(directory):
        # A removal cut short must not leave old resources for this launch to adopt unrecorded.
        _remove_resources(root, run_id, _owned_containers(root, run_id))
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
                return {"run_id": run_id, "mode": mode, "state": "running", "write_status": "replayed", "warnings": []}
            raise state.fail("LIVE_RUNNING", "the previous Live process must end before another mode starts")
        if mode == "run" and any(row.get("mode") == "run" for row in _host_events(directory)):
            raise state.fail("LIVE_RESTART_REQUIRES_RECONCILIATION",
                             "an attempted Live run cannot cold restart; after not_armed, prepare a new run-id")
    if mode == "reconcile" and not os.path.lexists(directory / "out" / "armed.json"):
        # Checked here too: a released run must not take the slot back only to be refused by its runner.
        raise state.fail("LIVE_RUN_MISSING", "reconciliation needs the original armed execution")
    warnings = [] if mode == "reconcile" else key.require_limits(credentials)
    _recycle_others(root, run_id)
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
                 credentials_path=credentials_path,
                 **({"request_id": request_id} if request_id is not None else {}))
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
            "directory": str(directory), "container": runner, "warnings": warnings}


def _outcome(root: Path, run_id: str, directory: Path, manifest: dict, launch: dict | None, *,
             release: bool = True) -> tuple[str, int | None]:
    actual = _runner(root, run_id, directory, manifest, launch) if launch else None
    if release:
        _release_if_resolved(root, run_id, directory)
    flat = _flat(directory, run_id) if launch and actual and actual["State"].get("ExitCode") == 0 else None
    running = bool(actual and actual["State"].get("Running"))
    result = ("running" if running else flat if flat
              else "not_armed" if launch and _released_unarmed(root, run_id)
              else "unresolved" if launch else "prepared")
    if launch and launch["mode"] == "preflight" and actual and not running:
        result = "preflight_complete" if actual["State"].get("ExitCode") == 0 else "preflight_failed"
    return result, actual["State"].get("ExitCode") if actual else None


def _stop_reason(directory: Path) -> str | None:
    """The first stop is the run's cause; a later reconcile writes its own. A damaged journal must not hide the state."""
    try:
        rows = state.events(directory / "out" / "events.jsonl")
    except LiveRefusal:
        return None
    return next((row.get("reason") for row in rows if row.get("event") == "stopping"), None)


def status(root: Path, run_id: str) -> dict:
    with state.serialized(root) as root:
        return _status_view(root, run_id, maintain=True)


def observe(root: Path, run_id: str) -> dict:
    """Inspect existing host evidence without release, archive, cleanup, or venue access.

    This is the host view, not an HTTP-safe response: the web projection must select
    safe fields and must not pass through arbitrary source stop reasons.
    """
    with state.reading(root) as root:
        return _status_view(root, run_id, maintain=False)


def _status_view(root: Path, run_id: str, *, maintain: bool) -> dict:
    directory, manifest = _manifest(root, run_id)
    launch = _latest_launch(directory)
    # A slot taken after the record belongs to a start that never launched, and needs its release check.
    recorded = _recycled(directory) if _active(root) != run_id else None
    settled = _settled(root, run_id, launch)
    if recorded:
        result, exit_code = recorded["state"], recorded["exit_code"]
    elif settled:
        result, exit_code = settled, 0 if settled != "not_armed" else None
    elif maintain:
        result, exit_code = _outcome(root, run_id, directory, manifest, launch)
    else:
        result, exit_code = _outcome(root, run_id, directory, manifest, launch, release=False)
    if maintain and launch and result in ENDED and _active(root) != run_id:
        _recycle(root, run_id, directory, result, launch)
    return {"run_id": run_id, "state": result, "mode": launch["mode"] if launch else None,
            "account_owned": _active(root) == run_id, "container": launch["container"] if launch else None,
            "origin_candidate": manifest["origin_candidate"], "source": manifest["source"],
            "image_ref": manifest["runtime"]["image_ref"], "symbols": manifest["symbols"], "exit_code": exit_code,
            "stop_reason": _stop_reason(directory),
            **({"note": UNRESOLVED_NOTE} if result == "unresolved" else {})}


def stop(root: Path, run_id: str) -> dict:
    with state.serialized(root) as root:
        return _stop_locked(root, run_id)


def _stop_locked(root: Path, run_id: str) -> dict:
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
    with state.reading(root) as root:
        directory, manifest = _manifest(root, run_id)
        launch = _latest_launch(directory)
        if not launch:
            return {"run_id": run_id, "lines": []}
        if _recycled(directory):
            try:
                text = _log_file(directory, launch["container"]).read_text(errors="replace")
            except OSError as exc:
                raise state.fail("LIVE_DOCKER_UNAVAILABLE", "the retained Live log is unavailable") from exc
            return {"run_id": run_id, "lines": text[-131072:].splitlines()[-tail:]}
        actual = _runner(root, run_id, directory, manifest, launch)
        if actual is None:
            raise state.fail("LIVE_DOCKER_UNAVAILABLE", "the retained Live container is unavailable")
        result = _docker("logs", "--tail", str(tail), actual["Id"])
        if result.returncode:
            raise state.fail("LIVE_DOCKER_UNAVAILABLE", "the retained Live log is unavailable")
        return {"run_id": run_id, "lines": (result.stdout + result.stderr)[-131072:].splitlines()[-tail:]}
