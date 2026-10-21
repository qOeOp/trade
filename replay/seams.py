"""The places replay reaches the runtime package and the report package: the runtime layout, the
isolated container command, running and stopping a named container, the build revision of an image
and the unverified directory report.

`current` holds the implementations in force: `runtime.image`, `runtime.container` and
`report.runs`. Tests swap them with `use(...)` (stand-in containers). The fingerprint stage runs
the in-image semantic fingerprint (engine.compare) the layout names.
"""

from __future__ import annotations

from collections.abc import Callable, Iterator, Mapping
from contextlib import contextmanager
from dataclasses import dataclass, replace
from pathlib import Path
import subprocess

from ledger.errors import Refusal
from runtime import container, image


def _layout(runtime_contract: str) -> dict:
    """runtime.layout: the runner, auditor, probe and fingerprint modules of a runtime contract."""
    return image.layout(runtime_contract)


def _container_command(identity: Mapping, mounts: list[tuple[Path, str, bool]], module: str, argv: list[str],
                       name: str) -> list[str]:
    """runtime.container_command, the container named `name` so an interrupt can stop it."""
    identity = {key: identity[key] for key in image.REQUIRED}
    return container.container_command(identity, [(Path(host), target, readonly) for host, target, readonly in mounts],
                                       module, list(argv), name)


def _run(command: list[str], stdout, stderr, timeout: float | None) -> int:
    """Run one container to its end; subprocess.TimeoutExpired once `timeout` seconds pass."""
    return subprocess.run(command, stdout=stdout, stderr=stderr, check=False, timeout=timeout).returncode


def _stop(name: str) -> None:
    """Stop (kill) the named container; killing the docker client alone leaves it running."""
    subprocess.run(["docker", "kill", name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False,
                   timeout=60)


def _build_revision(identity: Mapping) -> str | None:
    """The image's build source revision (runtime.resolve's build_revision); None without one."""
    return identity.get("build_revision")


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
    layout: Callable[[str], dict]
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
