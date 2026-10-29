"""The one place registration reaches code of other packages: runtime images (`runtime.image`),
runner arguments, market reads and export (`market`), and economic-evidence qualification.

`current` holds the implementations in force; tests swap them with `use(...)` (stand-in images,
markets and qualification). Nothing here is reimplemented.
"""

from __future__ import annotations

import argparse
from collections.abc import Callable, Iterator, Mapping
from contextlib import contextmanager
from dataclasses import dataclass, replace
from datetime import date, datetime
from pathlib import Path
from typing import Protocol

from ledger import db as ledger_db
from ledger.refusals import refuse


# Runtime (runtime.resolve, runtime.inspect_runtime, runtime.require_main_build)

def _resolve_runtime(reference: str | None) -> dict:
    from runtime import image
    return image.resolve(reference)


# Runner arguments inside the container. The replay entry writes the strategy, execution binding,
# output and market options itself and mounts the inputs at fixed container paths, so registration and
# every replay probe the same effective configuration (no host path enters it).
RESERVED_RUNNER_OPTIONS = ("--strategy-file", "--strategy-class", "--strategy-sha256", "--execution-binding",
                           "--output", "--describe", "--market-root", "--market-commit")
# Read by the entry, not passed to the runner as given: `--universe pool` selects the universe (the entry
# then passes the runner `--universe` with the membership file it wrote), `--symbols` the contracts.
ENTRY_OPTIONS = ("--universe", "--symbols", "--lifecycle-bundle")
MARKET_ROOT, MEMBERSHIP = "/inputs/market", "/inputs/membership.json"


def reserved_options(runner_argv: list[str]) -> list[str]:
    return sorted({value.split("=", 1)[0] for value in runner_argv if value.split("=", 1)[0] in RESERVED_RUNNER_OPTIONS})


def container_runner_args(runner_argv: list[str], inputs: Mapping) -> tuple[list[str], list[tuple[Path, str, bool]]]:
    """(runner arguments with the inputs at their container paths, the read-only input mounts)."""
    reserved = reserved_options(runner_argv)
    if reserved:
        raise refuse("RUNNER_OPTION_RESERVED", "the replay entry writes " + ", ".join(reserved) + " itself",
                     missing=tuple(reserved))
    argv, skipping = [], False
    for value in runner_argv:
        option = value.split("=", 1)[0]
        if option in ENTRY_OPTIONS:
            skipping = "=" not in value
            continue
        if skipping and not value.startswith("--"):
            continue
        skipping = False
        argv.append(value)
    symbols = list(inputs.get("symbols") or (inputs.get("identity") or {}).get("symbols") or ())
    argv += ["--market-root", MARKET_ROOT, "--market-commit", inputs["identity"]["market_commit"],
             "--universe", MEMBERSHIP]
    if symbols:
        argv += ["--symbols", *symbols]
    return argv, [(Path(inputs["root"]), MARKET_ROOT, True), (Path(inputs["membership_file"]), MEMBERSHIP, True)]


def _inspect_runtime(identity: dict, runner_argv: list[str], inputs: Mapping) -> dict:
    """The probe report for the container arguments of these inputs."""
    from runtime import image
    argv, mounts = container_runner_args(list(runner_argv), inputs)
    membership = [mount for mount in mounts if mount[1] == MEMBERSHIP]  # its bytes enter the configuration
    return image.inspect_runtime({key: identity[key] for key in runtime_identity_fields(identity)}, argv, membership)


def runtime_identity_fields(identity: Mapping) -> tuple[str, ...]:
    return ("image_ref", "image_digest", "platform", "runtime_contract")


def _require_main_build(identity: dict, inspection: dict) -> str:
    from runtime import image
    fields = (*runtime_identity_fields(identity), *(("build_revision",) if identity.get("build_revision") else ()))
    return image.require_main_build({key: identity[key] for key in fields}, inspection)


def _checkout() -> Path:
    return ledger_db.REPOSITORY


# Runner arguments (engine.parse_window and the runner's selection flags)

def _ns(text: str) -> int:
    moment = datetime.fromisoformat(text.replace("Z", "+00:00"))
    offset = moment.utcoffset()  # None exactly when the text has no zone
    if offset is None or offset.total_seconds() != 0:
        raise ValueError(f"{text!r} is not a UTC time")
    return int(moment.timestamp()) * 10**9 + moment.microsecond * 1000


class _RunnerParser(argparse.ArgumentParser):
    def error(self, message):
        raise refuse("USAGE_ERROR", f"runner arguments: {message}", missing=("--start", "--end"))


def _runner_inputs(runner_argv: list[str]) -> dict:
    """Window (UTC ns), selection, lifecycle bundle and execution from existing runner flags."""
    parser = _RunnerParser(add_help=False)
    parser.add_argument("--start", required=True)
    parser.add_argument("--trade-start")
    parser.add_argument("--end", required=True)
    parser.add_argument("--symbols", nargs="+")
    parser.add_argument("--lifecycle-bundle")
    parser.add_argument("--execution", default="bars")  # the runtime owns validation of this value
    known, _ = parser.parse_known_args(runner_argv)
    start = _ns(known.start)
    window = {"start": start, "trade_start": _ns(known.trade_start) if known.trade_start else start,
              "end": _ns(known.end)}
    selection: dict[str, list[str] | bool] = {"symbols": list(known.symbols)} if known.symbols else {"universe": True}
    return {"window": window, "selection": selection, "lifecycle_bundle": known.lifecycle_bundle,
            "execution": known.execution}


# Market (market.resolve_commit, market.membership_path, market.export_catalogs, market.validate_lifecycle)

class MarketAdapter(Protocol):
    """What registration reads of a market: Market below, or a test's stand-in."""

    database: str

    def resolve_commit(self, at: str | None) -> str: ...

    def universe_rule(self, commit: str) -> str: ...

    def universe_month(self, commit: str) -> list[tuple[str, str]]: ...

    def membership_path(self, commit: str, window_end: int) -> dict: ...

    def export_catalogs(self, commit: str, symbols: list[str], start_ns: int, end_ns: int, episodes, lifecycle_files,
                        fresh: bool, *, include_quotes: bool = True) -> dict: ...

    def validate_lifecycle(self, body: dict, commit: str, files: Mapping[str, bytes]) -> dict: ...


class Market:
    """The market database behind the registration interface: each method one designed market
    function, its refusals in the registration codes."""

    def __init__(self, profile: dict):
        self.profile = profile
        self.database = profile["database"]

    def resolve_commit(self, at: str | None) -> str:
        from market import store
        try:
            with store.connect(self.profile, "reader") as conn:
                return store.resolve_commit(conn, at)
        except store.MarketError as exc:
            raise refuse("MARKET_COMMIT_UNRESOLVED", f"market reference {at!r} did not resolve ({exc.code})",
                         missing=(str(at),)) from exc

    def universe_rule(self, commit: str) -> str:
        from market import store
        with store.connect(self.profile, "reader") as conn:
            (rule,), = conn.rows(f"SELECT universe_rule FROM market_schema AS OF '{ledger_db.check_ref(commit)}'")
        return rule

    def universe_month(self, commit: str) -> list[tuple[str, str]]:
        from market import store, universe
        with store.connect(self.profile, "reader") as conn:
            found = universe.months_of(conn, ledger_db.check_ref(commit))
        return [(month.isoformat()[:7], symbol) for month, symbol in found]

    def membership_path(self, commit: str, window_end: int) -> dict:
        from market import store, universe
        try:
            with store.connect(self.profile, "reader") as conn:
                return universe.membership_path(conn, commit, window_end)
        except store.MarketError as exc:
            code = "UNIVERSE_EMPTY" if exc.code == "UNIVERSE_EMPTY_AT_COMMIT" else (
                "MARKET_COMMIT_UNRESOLVED" if exc.code == "MARKET_COMMIT_UNRESOLVED" else None)
            if code is None:
                raise
            raise refuse(code, exc.message, missing=exc.missing) from exc

    def export_catalogs(self, commit: str, symbols: list[str], start_ns: int, end_ns: int, episodes, lifecycle_files,
                        fresh: bool, *, include_quotes: bool = True) -> dict:
        from market import export, store
        try:
            done = export.export_catalogs(self.profile, commit, symbols, start_ns, end_ns, episodes, lifecycle_files,
                                          fresh, include_quotes=include_quotes)
        except store.MarketError as exc:
            if exc.code == "LIFECYCLE_INPUT":
                raise refuse("LIFECYCLE_INPUT", exc.message) from exc
            raise
        return {"commit": done["commit"], "root": Path(done["root"]), "exported": done["exported"],
                "reused": done["cached"], "seconds": done["seconds"], "receipts": done["receipts"]}

    def validate_lifecycle(self, body: dict, commit: str, files: Mapping[str, bytes]) -> dict:
        return validate_lifecycle(body, commit, files)


def validate_lifecycle(body: dict, commit: str, files: Mapping[str, bytes]) -> dict:
    """market.validate_lifecycle, its refusal as LIFECYCLE_INPUT."""
    from market import lifecycle
    try:
        return lifecycle.validate_lifecycle(body, commit, files)
    except lifecycle.LifecycleInput as exc:
        raise refuse("LIFECYCLE_INPUT", exc.message) from exc


def _market(profile) -> MarketAdapter:
    return profile if hasattr(profile, "export_catalogs") else Market(profile)


# Qualification (qualification.require, qualification.assess); imported late: qualification reads
# registration's precheck record format.

def _qualification_require(conn, run: Mapping) -> dict:
    from qualification import availability
    return availability.require(conn, run)


def _qualification_assess(conn, run: Mapping, **options) -> dict:
    from qualification import availability
    return availability.assess(conn, run, **options)


@dataclass(frozen=True)
class Seams:
    resolve_runtime: Callable[[str | None], dict]
    inspect_runtime: Callable[[dict, list[str], Mapping], dict]
    require_main_build: Callable[[dict, dict], str]
    checkout: Callable[[], Path]
    runner_inputs: Callable[[list[str]], dict]
    market: Callable[[object], MarketAdapter]
    qualification_require: Callable[[object, Mapping], dict]
    qualification_assess: Callable[..., dict]


DEFAULT = Seams(resolve_runtime=_resolve_runtime, inspect_runtime=_inspect_runtime,
                require_main_build=_require_main_build, checkout=_checkout, runner_inputs=_runner_inputs,
                market=_market, qualification_require=_qualification_require,
                qualification_assess=_qualification_assess)
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


def month_of(moment: datetime | date) -> str:
    return f"{moment.year}-{moment.month:02d}"


def next_month(month: str) -> str:
    year, number = int(month[:4]), int(month[5:7])
    return f"{year + number // 12}-{number % 12 + 1:02d}"
