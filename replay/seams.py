"""The places replay starts containers: the isolated stage command (`runtime.container_command`) and
running and stopping a named container.

`current` holds the implementations in force; tests swap them with `use(...)` (stand-in containers).
"""

from __future__ import annotations

from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass, replace
import subprocess
import threading

from runtime import container


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


@dataclass(frozen=True)
class Seams:
    container_command: Callable[[dict, list, str, list[str], str], list[str]]
    run: Callable[[list[str], object, object, float | None], int]
    stop: Callable[[str], None]


DEFAULT = Seams(container_command=container.container_command, run=_run, stop=_stop)
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
