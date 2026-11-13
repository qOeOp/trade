"""Docker transport and full resource identity for Live's existing host lifecycle.

This module has no account-custody, credential-version or request policy. Callers
retain the lock, decide lifecycle actions and write the original receipts.
"""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import subprocess

from runtime import container
from live import state


LABEL = "trade.live"
# The egress container, as egress_command starts it and container_identity verifies it.
EGRESS_ARGV = ("--port", "3128", "--log", "/reports/egress.log")
EGRESS_MEMORY = "256m"


def docker(*argv: str, timeout: float = 60) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(["docker", *argv], capture_output=True, text=True, check=False, timeout=timeout,
                              env={key: os.environ[key] for key in container.DOCKER_ENV if key in os.environ})
    except subprocess.TimeoutExpired as exc:
        raise state.fail("LIVE_DOCKER_UNAVAILABLE", "Docker did not answer; account custody remains unresolved") from exc
    except OSError as exc:
        raise state.fail("LIVE_DOCKER_UNAVAILABLE", "the Docker client cannot run; account custody remains unresolved") from exc



def checked(*argv: str) -> str:
    result = docker(*argv)
    if result.returncode:
        # Docker output can include deployment paths; logs are read by a separate bounded command.
        raise state.fail("LIVE_DOCKER_UNAVAILABLE", f"Docker {argv[0]} failed; retained execution needs inspection")
    return result.stdout.strip()



def resource_names(root: Path, run_id: str) -> dict[str, str]:
    key = hashlib.sha256(str(root).encode()).hexdigest()[:10]
    base = f"trade-live-{key}-{run_id}"
    return {"network": base, "egress": base + "-egress"}



def inspect(kind: str, name: str) -> dict | None:
    result = docker(kind, "inspect", name)
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



def network_identity(name: str, run_id: str | None, expected_id: str | None = None) -> dict | None:
    found = inspect("network", name)
    if found is not None and (found.get("Name") != name or found.get("Driver") != "bridge"
                              or found.get("Internal") is not (run_id is not None)
                              or run_id is not None and found.get("Labels", {}).get(f"{LABEL}.run") != run_id
                              or not found.get("Id") or expected_id is not None and found.get("Id") != expected_id):
        raise state.fail("LIVE_IDENTITY_CHANGED", "the retained network does not match its declared identity")
    return found



def runner_args(mode: str) -> list[str]:
    return ["--manifest", "/inputs/manifest.json", "--credentials-file", "/run/secrets/binance.json",
            "--output", "/reports", "--mode", mode]



def container_identity(root: Path, run_id: str, directory: Path, manifest: dict, name: str, role: str, *,
               mode: str | None = None, credentials_path: str | None = None,
               container_id: str | None = None, runtime: dict | None = None) -> dict | None:
    """Verify the full retained resource before reading it or issuing a lifecycle action. `runtime` is the image the
    runner was launched on (live.runs.launch_runtime); the egress always runs on the manifest's."""
    found = inspect("container", name)
    if found is None:
        return None
    runtime = manifest["runtime"] if runtime is None or role == "egress" else runtime
    names = resource_names(root, run_id)
    pinned = inspect("image", runtime["image_ref"])
    network_created = next((row for row in reversed(state.events(directory / "lifecycle.jsonl"))
                            if row["event"] == "network_created"), None)
    network_id = network_created.get("network_id") if network_created else None
    expected_networks = {names["network"]: network_identity(names["network"], run_id, network_id)}
    if role == "egress":
        expected_networks["bridge"] = network_identity("bridge", None)
        expected_mounts = {"/reports": (str((directory / "egress").resolve()), True)}
        expected_command = ["-m", "engine.egress", *EGRESS_ARGV]
    else:
        if role != "runner" or mode not in ("preflight", "run", "reconcile") or not credentials_path:
            raise state.fail("LIVE_IDENTITY_CHANGED", "the retained launch lacks its complete execution binding")
        expected_mounts = {"/inputs": (str((directory / "inputs").resolve()), False),
                           "/reports": (str((directory / "out").resolve()), True),
                           "/run/secrets/binance.json": (credentials_path, False)}
        expected_command = ["-m", "engine.live", *runner_args(mode)]
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
    memory = EGRESS_MEMORY if role == "egress" else manifest["config"]["memory"]
    memory_bytes = int(memory[:-1]) * (1024 ** (2 if memory[-1] == "m" else 3))
    if (found.get("Name") != "/" + name or not found.get("Id")
            or container_id is not None and found.get("Id") != container_id
            or pinned is None or not pinned.get("Id") or found.get("Image") != pinned["Id"]
            or runtime["image_ref"] not in (pinned.get("RepoDigests") or [])
            or f"{pinned.get('Os')}/{pinned.get('Architecture')}" != runtime["platform"]
            or config.get("Image") != runtime["image_ref"]
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



def owned_containers(root: Path, run_id: str) -> list[dict]:
    listed = checked("ps", "-a", "--no-trunc", "--filter", f"label={LABEL}.run={run_id}", "--format", "{{.ID}}")
    prefix = "/" + resource_names(root, run_id)["network"]
    found = [inspect("container", identifier) for identifier in listed.split()]
    return [item for item in found if item and item.get("Name", "").startswith(prefix)]



def remove_resources(root: Path, run_id: str, containers: list[dict]) -> None:
    """Only the egress can still be running here; a runner that has not exited stops the removal earlier.

    The egress holds no state and ignores SIGTERM, so it gets a short stop rather than the 120 second default.
    """
    for item in containers:
        if item["Config"]["Labels"].get(f"{LABEL}.role") == "egress" and item["State"].get("Running"):
            checked("stop", "--time", "5", item["Id"])
        checked("rm", item["Id"])
    name = resource_names(root, run_id)["network"]
    if network_identity(name, run_id) is not None:
        checked("network", "rm", name)



def egress_command(manifest: dict, directory: Path, run_id: str, names: dict[str, str]) -> list[str]:
    return container.live_command(manifest["runtime"], [(directory / "egress", "/reports", False)],
                                         "engine.egress", list(EGRESS_ARGV),
                                         name=names["egress"], network=names["network"], memory=EGRESS_MEMORY,
                                         labels={f"{LABEL}.run": run_id, f"{LABEL}.role": "egress"})


def runner_command(manifest: dict, directory: Path, run_id: str, credentials: Path, mode: str, runner: str,
                   names: dict[str, str], runtime: dict | None = None) -> list[str]:
    return container.live_command(
        runtime or manifest["runtime"], [(directory / "inputs", "/inputs", True), (directory / "out", "/reports", False),
                              (credentials.absolute(), "/run/secrets/binance.json", True)],
        "engine.live", runner_args(mode),
        name=runner, network=names["network"], memory=manifest["config"]["memory"],
        labels={f"{LABEL}.run": run_id, f"{LABEL}.role": "runner"})
