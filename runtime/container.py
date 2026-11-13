"""The isolated container of every replay stage and of the identity probe (`runtime.container_command`),
and the Paper and Live runs' containers (`runtime.paper_command`, `runtime.live_command`).

Digest-pinned, never pulled, no network, read-only root, every capability dropped, no privilege
escalation, a process limit, the current user and a private /tmp. Only declared inputs are mounted,
read-only; a replay stage's single writable mount is its own output directory at /reports. A replay stage
also has a memory limit (STAGE_MEMORY) and is kept after it exits, so replay.seams can read whether the kernel
killed it at that limit before removing it. A Paper or Live container differs in its network (a named Docker
network, never the host's), its own memory limit, labels, and running detached.
"""

from __future__ import annotations

import os
from pathlib import Path
import posixpath
import re

from shared.refusals import refuse
from runtime import image


PIDS_LIMIT = 256  # example value, not calibrated
# Each replay stage's memory limit, swap included (user decision 2026-11-11): a stage over it is killed and its run
# refused STAGE_MEMORY_LIMIT instead of exhausting the Docker VM. Measured 2026-11-11 on the image with the indexed
# audit and streaming fingerprint: the native stage peaks highest, at about 0.7 GiB for 3 years of the pool plus
# 45 KB per fill (8.5 GiB at 186k fills), so 16 GiB admits about 350k fills over 3 years and three stages at once
# leave about 14 GiB of the 62.7 GiB Docker VM (docs/plans/line-close-history-test-20261110.zh.md, 7).
STAGE_MEMORY = "16g"
NETWORK = re.compile(r"[a-z0-9][a-z0-9_.-]{0,62}\Z")
REPORTS = "/reports"
# SIGTERM to SIGKILL when Docker stops a paper container, `paper stop` or a Docker or host restart: Docker's
# default 10 s cut the runner off while it cancelled its orders and wrote its summary (paper run 4, 2026-10-31).
PAPER_STOP_SECONDS = 30
LIVE_STOP_SECONDS = 120  # a Live runner is never force-stopped early (live.host)
# The docker client's own variables; nothing else of the host's environment reaches a Paper or Live docker call.
DOCKER_ENV = ("PATH", "HOME", "TMPDIR", "USER", "LANG", "DOCKER_HOST", "DOCKER_CONFIG", "DOCKER_CONTEXT",
              "DOCKER_CERT_PATH", "DOCKER_TLS_VERIFY")
# A stage mount may not cover the root, the container's scratch space or the image's own code.
PROTECTED_TARGETS = ("/tmp", "/opt/trade")


def _covers(target: str, protected: str) -> bool:
    """`target` is `protected`, lies under it, or lies over it (an ancestor directory)."""
    return (target == protected or target.startswith(protected + "/")
            or protected.startswith(target.rstrip("/") + "/"))


def _modules(identity: dict) -> set[str]:
    found = image.layout(identity["runtime_contract"])
    return {found[key] for key in ("runner_module", "audit_module", "fingerprint_module")}


def _execution_modules(identity: dict, keys: tuple[str, ...]) -> set[str]:
    found = image.execution_modules(identity["runtime_contract"])
    return {found[key] for key in keys}


def _check_mounts(mounts: list[tuple[Path, str, bool]], require_reports: bool) -> list[tuple[Path, str, bool]]:
    targets, writable, normalized = [], [], []
    for host, target, readonly in mounts:
        if not Path(host).is_absolute() or not Path(host).exists():
            raise refuse("MOUNT_HOST_PATH_INVALID", f"mount source {host} is not an existing absolute path",
                         missing=(str(host),))
        # normpath keeps a leading "//" (POSIX leaves it implementation-defined); Docker reads it as "/".
        normal = "/" + posixpath.normpath(target).lstrip("/") if isinstance(target, str) else None
        if (normal is None or not target.startswith("/") or normal in targets or normal == "/"
                or "," in normal or "," in str(host)
                or any(_covers(normal, protected) for protected in PROTECTED_TARGETS)):
            raise refuse("MOUNT_TARGET_INVALID", f"mount target {target!r} is not absolute, repeats, is the root, or "
                                                 "lies over or under /tmp or the image's code", missing=(str(target),))
        targets.append(normal)
        if not readonly:
            writable.append(normal)
        normalized.append((Path(host), normal, readonly))
    if any(target != REPORTS for target in writable) or len(writable) > 1:
        raise refuse("MOUNT_WRITABLE_NOT_REPORTS", f"writable mounts {writable}: only /reports may be writable",
                     missing=tuple(writable))
    if require_reports and not writable:
        raise refuse("REPORTS_MOUNT_MISSING", "the stage has no writable /reports mount", missing=(REPORTS,))
    return normalized


def _run(identity: dict, mounts: list[tuple[Path, str, bool]], module: str, argv: list[str], modules: set[str],
         require_reports: bool, run_options: list[str]) -> list[str]:
    if module not in modules:
        raise refuse("MODULE_NOT_IN_LAYOUT", f"{module!r} is not a module the {identity['runtime_contract']} layout "
                                             "declares", missing=(str(module),))
    checked = _check_mounts(list(mounts), require_reports)
    if any(not isinstance(value, str) for value in argv):
        raise refuse("ARGV_INVALID", "every container argument must be a string")
    result = ["docker", "run", *run_options, "--pull", "never",
              "--platform", identity["platform"], "--read-only", "--cap-drop", "ALL",
              "--security-opt", "no-new-privileges", "--pids-limit", str(PIDS_LIMIT),
              "--user", f"{os.geteuid()}:{os.getegid()}", "--tmpfs", "/tmp:rw,nosuid,noexec,size=1073741824",
              "--env", "PYTHONDONTWRITEBYTECODE=1", "--entrypoint", "python"]
    for host, target, readonly in checked:
        value = f"type=bind,source={host.resolve()},target={target}"
        result += ["--mount", value + (",readonly" if readonly else "")]
    return [*result, identity["image_ref"], "-m", module, *argv]


def command(identity: dict, mounts: list[tuple[Path, str, bool]], module: str, argv: list[str], *,
            name: str) -> list[str]:
    """The identity probe's docker run argument list: the checks of `container_command` without requiring
    /reports (the probe writes nothing), removed on exit."""
    identity = image.validate_identity(identity)
    return _run(identity, mounts, module, argv, _modules(identity), False,
                ["--name", name, "--rm", "--network", "none"])


def container_command(identity: dict, mounts: list[tuple[Path, str, bool]], module: str, argv: list[str],
                      name: str) -> list[str]:
    """One replay stage's command: a module the contract's layout declares, existing absolute host
    paths, distinct normalized absolute targets clear of /, /tmp and the image's code, and exactly one
    writable mount, /reports. `name` names the container so an interrupt can stop it and its exit state can be
    read; it has STAGE_MEMORY and no swap, and is not removed on exit (replay.seams removes it)."""
    identity = image.validate_identity(identity)
    return _run(identity, mounts, module, argv, _modules(identity), True,
                ["--name", name, "--network", "none", "--memory", STAGE_MEMORY, "--memory-swap", STAGE_MEMORY])


def _detached(identity: dict, mounts: list[tuple[Path, str, bool]], module: str, argv: list[str],
              modules: tuple[str, ...], *, name: str, network: str, memory: str, labels: dict[str, str],
              stop_seconds: int, cpus: str | None = None) -> list[str]:
    """A detached Paper or Live container: one of the contract's `modules` (execution_modules), on one named
    Docker network (never `host`, `bridge` or `none`: the caller creates it), with a memory limit (and a CPU limit
    when given), `stop_seconds` to stop, string labels, and the stage checks of `container_command`. It is kept
    after it exits, so its exit code and log stay readable until the caller removes it."""
    if not NETWORK.fullmatch(network) or network in ("host", "bridge", "none", "default"):
        raise refuse("ARGV_INVALID", f"network {network!r} is not a named Docker network")
    if not re.fullmatch(r"[1-9][0-9]{0,5}[mg]", memory):
        raise refuse("ARGV_INVALID", f"memory limit {memory!r} is not a size such as 4g")
    if not NETWORK.fullmatch(name) or any(not isinstance(key, str) or not isinstance(value, str) or "=" in key
                                          or "\n" in key + value for key, value in labels.items()):
        raise refuse("ARGV_INVALID", "the container name or labels are malformed")
    options = ["--detach", "--name", name, "--network", network, "--memory", memory, "--memory-swap", memory,
               "--log-driver", "json-file", "--log-opt", "max-size=10m", "--log-opt", "max-file=3",
               "--stop-timeout", str(stop_seconds)]
    if cpus is not None:
        if not re.fullmatch(r"(0\.[0-9]{1,2}|[1-9][0-9]?(\.[0-9]{1,2})?)", cpus):
            raise refuse("ARGV_INVALID", f"cpu limit {cpus!r} is not a number of CPUs such as 0.5")
        options += ["--cpus", cpus]
    for key, value in sorted(labels.items()):
        options += ["--label", f"{key}={value}"]
    return _run(identity, mounts, module, argv, _execution_modules(identity, modules), True, options)


def paper_command(identity: dict, mounts: list[tuple[Path, str, bool]], module: str, argv: list[str], *,
                  name: str, network: str, memory: str, labels: dict[str, str],
                  cpus: str | None = None) -> list[str]:
    """A paper container's command: the contract layout's paper runner or egress proxy (`_detached`), with
    PAPER_STOP_SECONDS to stop."""
    identity = image.validate_identity(identity)
    return _detached(identity, mounts, module, argv, ("paper_module", "egress_module"), name=name, network=network,
                     memory=memory, labels=labels, stop_seconds=PAPER_STOP_SECONDS, cpus=cpus)


def live_command(identity: dict, mounts: list[tuple[Path, str, bool]], module: str, argv: list[str], *,
                 name: str, network: str, memory: str, labels: dict[str, str]) -> list[str]:
    """A separate private Live runner or egress container (`_detached`), with LIVE_STOP_SECONDS to stop.

    A trading credential is a read-only file mounted at one fixed path. No host environment
    values are forwarded. A runner is never force-stopped; containers stay until the run has ended.
    """
    identity = image.validate_identity(identity)
    secrets = [(path, target, readonly) for path, target, readonly in mounts if target == "/run/secrets/binance.json"]
    if module == "engine.live" and (len(secrets) != 1 or not secrets[0][2] or not secrets[0][0].is_file()):
        raise refuse("ARGV_INVALID", "Live requires one read-only Binance credential file mount")
    if module == "engine.egress" and secrets:
        raise refuse("ARGV_INVALID", "the Live egress proxy cannot mount exchange credentials")
    return _detached(identity, mounts, module, argv, ("live_module", "egress_module"), name=name, network=network,
                     memory=memory, labels=labels, stop_seconds=LIVE_STOP_SECONDS)
