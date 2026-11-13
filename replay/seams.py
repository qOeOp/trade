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
import threading

from ledger.execution import IDENTITY_FIELDS
from runtime import container, image


def _container_command(identity: Mapping, mounts: list[tuple[Path, str, bool]], module: str, argv: list[str],
                       name: str) -> list[str]:
    """runtime.container_command, the container named `name` so an interrupt can stop it."""
    identity = {key: identity[key] for key in IDENTITY_FIELDS}
    return container.container_command(identity, [(Path(host), target, readonly) for host, target, readonly in mounts],
                                       module, list(argv), name)


def _copy(pipe, sink) -> None:
    for chunk in iter(lambda: pipe.read1(1 << 16), b""):
        sink.write(chunk)


class MemoryLimit(Exception):
    """The kernel killed a stage's container at its memory limit (runtime.container.STAGE_MEMORY)."""

    def __init__(self, exit_code: int):
        super().__init__(f"killed at its memory limit, exit code {exit_code}")
        self.exit_code = exit_code


def _name(command: list[str]) -> str | None:
    """The container a `docker run` command names and keeps after it exits (no --rm); None otherwise."""
    if "--rm" in command or "--name" not in command:
        return None
    return command[command.index("--name") + 1]


def _remove(name: str) -> bool:
    """Whether the kernel killed the named container at its memory limit; it is removed (stopped if running). A
    Docker client that fails or hangs reads as no: the stage's own exit code or exception stands."""
    try:
        state = subprocess.run(["docker", "inspect", "--format", "{{.State.OOMKilled}}", name], capture_output=True,
                               text=True, check=False, timeout=60)
    except (OSError, subprocess.TimeoutExpired):
        state = None
    try:
        subprocess.run(["docker", "rm", "--force", name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                       check=False, timeout=60)
    except (OSError, subprocess.TimeoutExpired):
        pass
    return state is not None and state.returncode == 0 and state.stdout.strip() == "true"


def _run(command: list[str], stdout, stderr, timeout: float | None) -> int:
    """Run one container to its end, handing its output to `stdout` and `stderr` (each with write(bytes)) as
    it arrives; subprocess.TimeoutExpired once `timeout` seconds pass, and any exception kills the client. A
    container the command keeps is removed afterwards, and MemoryLimit raised when it ended at its memory limit."""
    name, code = _name(command), None
    try:
        with subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE) as process:
            copies = [threading.Thread(target=_copy, args=pair, daemon=True)
                      for pair in ((process.stdout, stdout), (process.stderr, stderr))]
            for copy in copies:
                copy.start()
            try:
                code = process.wait(timeout)
            except BaseException:
                process.kill()
                raise
            finally:
                for copy in copies:
                    copy.join()
    finally:
        killed = name is not None and _remove(name)
    if killed:
        raise MemoryLimit(code)
    return code


def _stop(name: str) -> None:
    """Stop (kill) the named container; killing the docker client alone leaves it running."""
    subprocess.run(["docker", "kill", name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False,
                   timeout=60)


def _build_revision(identity: Mapping) -> str | None:
    """The image's build source revision (runtime.resolve's build_revision); None without one."""
    return identity.get("build_revision")


@dataclass(frozen=True)
class Seams:
    layout: Callable[[str], dict]
    container_command: Callable[[Mapping, list, str, list[str], str], list[str]]
    run: Callable[[list[str], object, object, float | None], int]
    stop: Callable[[str], None]
    build_revision: Callable[[Mapping], str | None]


DEFAULT = Seams(layout=image.layout, container_command=_container_command, run=_run, stop=_stop,
                build_revision=_build_revision)
current = DEFAULT


@contextmanager
def use(**overrides) -> Iterator[Seams]:
    """Replace some implementations for the duration of the block (tests)."""
    global current
    previous = current
    current = replace(current, **overrides)
    try:
        yield current
    finally:
        current = previous
