"""The one place replay reaches code of later phases beyond registration's seams: the runtime layout
and isolated container command, running a container, the build revision of an image, the native
summary's field names, the in-image semantic fingerprint and the unverified directory report.

`current` holds the implementations in force; the defaults adapt today's code
(`research/records/runtime.py`, the native summary of `backtest/run.py`). The engine, runtime and
report packages of later phases replace them here. Tests swap them with `use(...)`. Where today's
image has no code (engine.report_fingerprint), the default returns None: the fingerprint is absent.
"""

from __future__ import annotations

from collections.abc import Callable, Iterator, Mapping
from contextlib import contextmanager
from dataclasses import dataclass, replace
from pathlib import Path
import subprocess

from ledger.errors import Refusal
from ledger.refusals import refuse


def _layout(runtime_contract: str) -> dict:
    """runtime.layout: the runner, auditor and probe modules of a runtime contract inside its image."""
    from research.records.runtime import LAYOUTS
    found = LAYOUTS.get(runtime_contract)
    if found is None:
        raise refuse("RUNTIME_PROBE_INVALID", f"runtime contract {runtime_contract!r} has no image layout",
                     missing=(str(runtime_contract),))
    return {"runner_module": found["runner"], "audit_module": found["audit"], "audit_args": list(found["audit_args"]),
            "probe_module": found["probe"]}


def _identity(identity: Mapping) -> dict:
    return {key: identity[key] for key in ("image_ref", "image_digest", "platform", "runtime_contract")}


def _container_command(identity: Mapping, mounts: list[tuple[Path, str, bool]], module: str,
                       argv: list[str]) -> list[str]:
    """runtime.container_command: digest-pinned, no pull, no network, read-only root, one writable /reports."""
    from research.records import runtime
    from research.records.common import RecordError
    try:
        return runtime.container_command(_identity(identity), [(Path(host), target, readonly)
                                                               for host, target, readonly in mounts], module, argv)
    except RecordError as exc:
        raise refuse("RUNTIME_PROBE_INVALID", str(exc)) from exc


def _run(command: list[str], stdout, stderr) -> int:
    return subprocess.run(command, stdout=stdout, stderr=stderr, check=False).returncode


def _build_revision(identity: Mapping) -> str | None:
    """The image's build source revision label (runtime.resolve's build_revision); None without one."""
    from research.records import runtime
    from research.records.common import RecordError
    try:
        return runtime.image_revision(_identity(identity))
    except RecordError as exc:
        raise refuse("RUNTIME_UNAVAILABLE", str(exc)) from exc


# Today's runner names the source hash `strategy_source_sha256`; the engine design calls it `source_sha256`.
CURRENT_SUMMARY_KEYS = {"strategy_source_sha256": "source_sha256"}


def _native_summary(summary: Mapping | None) -> dict | None:
    if not isinstance(summary, Mapping):
        return None
    found = dict(summary)
    for current, design in CURRENT_SUMMARY_KEYS.items():
        if design not in found and current in found:
            found[design] = found[current]
    return found


def _report_fingerprint(identity: Mapping, reports: Path) -> dict | None:
    """engine.report_fingerprint runs inside the runtime image; today's image has no such entry."""
    return None


def _directory_report(directory: Path) -> dict:
    """report.directory_report (a later phase): the sealed-run metrics read from an unsealed directory,
    marked unverified; no qualification masking yet."""
    from ledger import metrics
    try:
        values = metrics.metrics(metrics.load_directory(directory))
    except Refusal as exc:
        return {"directory": str(directory), "exploration": True, "metrics": None,
                "availability": ["unsealed, source unverified, not evidence", f"{exc.code}: {exc.message}"]}
    return {"directory": str(directory), "exploration": True, "metrics": values,
            "availability": ["unsealed, source unverified, not evidence"]}


@dataclass(frozen=True)
class Seams:
    layout: Callable[[str], dict]
    container_command: Callable[[Mapping, list, str, list[str]], list[str]]
    run: Callable[[list[str], object, object], int]
    build_revision: Callable[[Mapping], str | None]
    native_summary: Callable[[Mapping | None], dict | None]
    report_fingerprint: Callable[[Mapping, Path], dict | None]
    directory_report: Callable[[Path], dict]


DEFAULT = Seams(layout=_layout, container_command=_container_command, run=_run, build_revision=_build_revision,
                native_summary=_native_summary, report_fingerprint=_report_fingerprint,
                directory_report=_directory_report)
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
