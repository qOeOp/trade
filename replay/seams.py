"""The one place replay reaches code of later phases beyond registration's seams: the runtime layout
and isolated container command, running and stopping a named container, the build revision of an
image and the unverified directory report.

`current` holds the implementations in force; the defaults adapt today's code
(`research/records/runtime.py`) and the report package's directory report. The engine and runtime
packages of later phases replace them here. Tests swap them with `use(...)`. The fingerprint stage runs the
in-image semantic fingerprint (engine.report_fingerprint) the layout names; a layout naming none
records the stage not_available.
"""

from __future__ import annotations

from collections.abc import Callable, Iterator, Mapping
from contextlib import contextmanager
from dataclasses import dataclass, replace
from pathlib import Path
import subprocess

from ledger.errors import Refusal
from ledger.refusals import refuse


def _modules(found: Mapping) -> dict:
    return {"runner_module": found["runner"], "audit_module": found["audit"], "audit_args": list(found["audit_args"]),
            "probe_module": found["probe"], "fingerprint_module": found.get("fingerprint")}


def _layout(runtime_contract: str, source_file_paths) -> dict:
    """runtime.layout: the runner, auditor, probe and fingerprint modules of the layout an image reported
    (the source paths of its runtime inspection), among its contract's layouts."""
    from research.records.runtime import layout_for
    from research.records.common import RecordError
    try:
        return _modules(layout_for(runtime_contract, source_file_paths))
    except RecordError as exc:
        raise refuse("RUNTIME_PROBE_INVALID", str(exc), missing=(str(runtime_contract),)) from exc


def contract_modules(runtime_contract: str) -> set[str]:
    """Every module some layout of the contract declares."""
    from research.records.runtime import LAYOUTS
    return {module for found in LAYOUTS.get(runtime_contract, ()) for module in _modules(found).values()
            if isinstance(module, str)}


def _identity(identity: Mapping) -> dict:
    return {key: identity[key] for key in ("image_ref", "image_digest", "platform", "runtime_contract")}


def check_stage(identity: Mapping, mounts: list[tuple[Path, str, bool]], module: str, argv: list[str]) -> None:
    """runtime.container_command's checks of one replay stage: a module the contract's layout declares,
    existing absolute host paths, distinct absolute targets outside /tmp, and exactly one writable mount,
    /reports."""
    if module not in contract_modules(identity["runtime_contract"]):
        raise refuse("MODULE_NOT_IN_LAYOUT", f"{module!r} is not a module the {identity['runtime_contract']} layout "
                                             "declares", missing=(str(module),))
    targets, writable = [], []
    for host, target, readonly in mounts:
        if not Path(host).is_absolute() or not Path(host).exists():
            raise refuse("MOUNT_HOST_PATH_INVALID", f"mount source {host} is not an existing absolute path",
                         missing=(str(host),))
        if (not isinstance(target, str) or not target.startswith("/") or target in targets
                or target == "/tmp" or target.startswith("/tmp/")):
            raise refuse("MOUNT_TARGET_INVALID", f"mount target {target!r} is not absolute, repeats or covers /tmp",
                         missing=(str(target),))
        targets.append(target)
        if not readonly:
            writable.append(target)
    if any(target != "/reports" for target in writable) or len(writable) > 1:
        raise refuse("MOUNT_WRITABLE_NOT_REPORTS", f"writable mounts {writable}: only /reports may be writable",
                     missing=tuple(writable))
    if not writable:
        raise refuse("REPORTS_MOUNT_MISSING", "the stage has no writable /reports mount", missing=("/reports",))
    if any(not isinstance(value, str) for value in argv):
        raise refuse("ARGV_INVALID", "every container argument must be a string")


def _container_command(identity: Mapping, mounts: list[tuple[Path, str, bool]], module: str, argv: list[str],
                       name: str) -> list[str]:
    """runtime.container_command: digest-pinned, no pull, no network, read-only root, one writable /reports;
    the container carries `name` so an interrupt can stop it."""
    from research.records import runtime
    from research.records.common import RecordError
    check_stage(identity, mounts, module, argv)
    try:
        command = runtime.container_command(_identity(identity), [(Path(host), target, readonly)
                                                                  for host, target, readonly in mounts], module, argv)
    except RecordError as exc:
        raise refuse("RUNTIME_PROBE_INVALID", str(exc)) from exc
    if command[:2] != ["docker", "run"]:
        raise refuse("RUNTIME_PROBE_INVALID", "the runtime command is not a docker run")
    return [*command[:2], "--name", name, *command[2:]]


def _run(command: list[str], stdout, stderr, timeout: float | None) -> int:
    """Run one container to its end; subprocess.TimeoutExpired once `timeout` seconds pass."""
    return subprocess.run(command, stdout=stdout, stderr=stderr, check=False, timeout=timeout).returncode


def _stop(name: str) -> None:
    """Stop (kill) the named container; killing the docker client alone leaves it running."""
    subprocess.run(["docker", "kill", name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False,
                   timeout=60)


def _build_revision(identity: Mapping) -> str | None:
    """The image's build source revision label (runtime.resolve's build_revision); None without one."""
    from research.records import runtime
    from research.records.common import RecordError
    try:
        return runtime.image_revision(_identity(identity))
    except RecordError as exc:
        raise refuse("RUNTIME_UNAVAILABLE", str(exc)) from exc


def _directory_report(directory: Path) -> dict:
    """report.directory_report: the sealed-run functions and criterion on an unsealed directory, marked
    unverified; a directory whose reports cannot be read reports why instead of refusing the replay."""
    from report import runs
    try:
        return runs.directory_report(directory, account=False)
    except Refusal as exc:
        return {"directory": str(directory), "exploration": True, "headline": None, "slices": None,
                "availability": {"economic_evidence_available": False, "reasons": [f"{exc.code}: {exc.message}"],
                                 "unverified": runs.UNVERIFIED},
                "limitations": [runs.UNVERIFIED]}


@dataclass(frozen=True)
class Seams:
    layout: Callable[[str, object], dict]
    container_command: Callable[[Mapping, list, str, list[str], str], list[str]]
    run: Callable[[list[str], object, object, float | None], int]
    stop: Callable[[str], None]
    build_revision: Callable[[Mapping], str | None]
    directory_report: Callable[[Path], dict]


DEFAULT = Seams(layout=_layout, container_command=_container_command, run=_run, stop=_stop,
                build_revision=_build_revision, directory_report=_directory_report)
current = DEFAULT


@contextmanager
def use(**overrides) -> Iterator[Seams]:
    """Replace some implementations for the duration of the block (tests and later-phase wiring)."""
    global current
    previous = current
    current = replace(current, **overrides)
    try:
        yield current
    finally:
        current = previous
