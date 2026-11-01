"""The isolated container of every replay stage and of the identity probe (`runtime.container_command`),
and the paper run's containers (`runtime.paper_command`).

Digest-pinned, never pulled, no network, read-only root, every capability dropped, no privilege
escalation, a process limit, the current user and a private /tmp. Only declared inputs are mounted,
read-only; a replay stage's single writable mount is its own output directory at /reports. A paper
container differs only in its network (a named Docker network, never the host's), a memory limit, and
running detached.
"""

from __future__ import annotations

import os
from pathlib import Path
import posixpath
import re

from ledger.refusals import refuse
from runtime import image


PIDS_LIMIT = 256  # example value, not calibrated
NETWORK = re.compile(r"[a-z0-9][a-z0-9_.-]{0,62}\Z")
REPORTS = "/reports"
# SIGTERM to SIGKILL when Docker stops a paper container, `paper stop` or a Docker or host restart: Docker's
# default 10 s cut the runner off while it cancelled its orders and wrote its summary (paper run 4, 2026-10-31).
PAPER_STOP_SECONDS = 30
# A stage mount may not cover the root, the container's scratch space or the image's own code.
PROTECTED_TARGETS = ("/tmp", "/opt/trade")


def _covers(target: str, protected: str) -> bool:
    """`target` is `protected`, lies under it, or lies over it (an ancestor directory)."""
    return (target == protected or target.startswith(protected + "/")
            or protected.startswith(target.rstrip("/") + "/"))


def _modules(identity: dict, keys=("runner_module", "audit_module", "fingerprint_module")) -> set[str]:
    found = image.layout(identity["runtime_contract"])
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
            name: str | None = None, require_reports: bool = False) -> list[str]:
    """The docker run argument list; the checks of `container_command` without requiring /reports
    (the identity probe writes nothing)."""
    identity = image.validate_identity(identity)
    return _run(identity, mounts, module, argv, _modules(identity), require_reports,
                [*(["--name", name] if name else []), "--rm", "--network", "none"])


def container_command(identity: dict, mounts: list[tuple[Path, str, bool]], module: str, argv: list[str],
                      name: str | None = None) -> list[str]:
    """One replay stage's command: a module the contract's layout declares, existing absolute host
    paths, distinct normalized absolute targets clear of /, /tmp and the image's code, and exactly one
    writable mount, /reports. `name` names the container so an interrupt can stop it."""
    return command(identity, mounts, module, argv, name=name, require_reports=True)


def paper_command(identity: dict, mounts: list[tuple[Path, str, bool]], module: str, argv: list[str], *,
                  name: str, network: str, memory: str, labels: dict[str, str]) -> list[str]:
    """A paper container's command: the contract layout's paper runner or egress proxy, started detached
    on one named Docker network (never `host`, `bridge` or `none`: the caller creates it) with a memory
    limit and PAPER_STOP_SECONDS to stop, and the stage checks of `container_command`. It is kept after it exits, so its exit code and
    log stay readable until the caller removes it."""
    identity = image.validate_identity(identity)
    if not NETWORK.fullmatch(network) or network in ("host", "bridge", "none", "default"):
        raise refuse("ARGV_INVALID", f"paper network {network!r} is not a named Docker network")
    if not re.fullmatch(r"[1-9][0-9]{0,5}[mg]", memory):
        raise refuse("ARGV_INVALID", f"memory limit {memory!r} is not a size such as 4g")
    if not NETWORK.fullmatch(name) or any(not isinstance(value, str) or "\n" in value or "=" in key
                                          for key, value in labels.items()):
        raise refuse("ARGV_INVALID", "the paper container name or labels are malformed")
    options = ["--detach", "--name", name, "--network", network, "--memory", memory, "--memory-swap", memory,
               "--stop-timeout", str(PAPER_STOP_SECONDS)]
    for key, value in sorted(labels.items()):
        options += ["--label", f"{key}={value}"]
    return _run(identity, mounts, module, argv, _modules(identity, ("paper_module", "egress_module")), True,
                options)
