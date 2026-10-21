"""The isolated container of every replay stage and of the identity probe (`runtime.container_command`).

Digest-pinned, never pulled, no network, read-only root, every capability dropped, no privilege
escalation, a process limit, the current user and a private /tmp. Only declared inputs are mounted,
read-only; a replay stage's single writable mount is its own output directory at /reports.
"""

from __future__ import annotations

import os
from pathlib import Path
import posixpath

from ledger.refusals import refuse
from runtime import image


PIDS_LIMIT = 256  # example value, not calibrated
REPORTS = "/reports"
# A stage mount may not cover the root, the container's scratch space or the image's own code.
PROTECTED_TARGETS = ("/tmp", "/opt/trade")


def _covers(target: str, protected: str) -> bool:
    """`target` is `protected`, lies under it, or lies over it (an ancestor directory)."""
    return (target == protected or target.startswith(protected + "/")
            or protected.startswith(target.rstrip("/") + "/"))


def _modules(identity: dict) -> set[str]:
    found = image.layout(identity["runtime_contract"])
    return {found[key] for key in ("runner_module", "audit_module", "fingerprint_module")}


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


def command(identity: dict, mounts: list[tuple[Path, str, bool]], module: str, argv: list[str], *,
            name: str | None = None, require_reports: bool = False) -> list[str]:
    """The docker run argument list; the checks of `container_command` without requiring /reports
    (the identity probe writes nothing)."""
    identity = image.validate_identity(identity)
    if module not in _modules(identity):
        raise refuse("MODULE_NOT_IN_LAYOUT", f"{module!r} is not a module the {identity['runtime_contract']} layout "
                                             "declares", missing=(str(module),))
    checked = _check_mounts(list(mounts), require_reports)
    if any(not isinstance(value, str) for value in argv):
        raise refuse("ARGV_INVALID", "every container argument must be a string")
    result = ["docker", "run", *(["--name", name] if name else []), "--rm", "--pull", "never",
              "--platform", identity["platform"], "--network", "none", "--read-only", "--cap-drop", "ALL",
              "--security-opt", "no-new-privileges", "--pids-limit", str(PIDS_LIMIT),
              "--user", f"{os.geteuid()}:{os.getegid()}", "--tmpfs", "/tmp:rw,nosuid,noexec,size=1073741824",
              "--env", "PYTHONDONTWRITEBYTECODE=1", "--entrypoint", "python"]
    for host, target, readonly in checked:
        value = f"type=bind,source={host.resolve()},target={target}"
        result += ["--mount", value + (",readonly" if readonly else "")]
    return [*result, identity["image_ref"], "-m", module, *argv]


def container_command(identity: dict, mounts: list[tuple[Path, str, bool]], module: str, argv: list[str],
                      name: str | None = None) -> list[str]:
    """One replay stage's command: a module the contract's layout declares, existing absolute host
    paths, distinct normalized absolute targets clear of /, /tmp and the image's code, and exactly one
    writable mount, /reports. `name` names the container so an interrupt can stop it."""
    return command(identity, mounts, module, argv, name=name, require_reports=True)
