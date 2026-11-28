"""Registration's seams: runtime images (`runtime.image`), the product checkout, market reads and export
(`market`), and stand-ins for economic-evidence qualification (`registration.availability` when none is set). What registration and replay
do with them (runner arguments, the checkout's git gates) is `registration.runner`.

`current` holds the implementations in force; tests swap them with `use(...)` (stand-in images, checkouts,
markets and qualification). Nothing here is reimplemented.
"""

from __future__ import annotations

from collections.abc import Callable, Iterator, Mapping
from contextlib import contextmanager
from dataclasses import dataclass, replace
from datetime import date
import functools
from pathlib import Path

from ledger.execution import IDENTITY_FIELDS
from shared import paths
from shared.errors import Refusal
from shared.refusals import refuse


# Runtime (runtime.resolve, runtime.inspect_runtime, runtime.require_ci_build, runtime.require_main_build)


def _resolve_runtime(reference: str | None) -> dict:
    from runtime import image
    return image.resolve(reference)


def _inspect_runtime(identity: dict, runner_argv: list[str], inputs: Mapping) -> dict:
    """The probe report for the container arguments of these inputs."""
    from registration import runner
    from runtime import image
    argv, mounts = runner.container_runner_args(list(runner_argv), inputs)
    # The membership's bytes enter the configuration; the probe reads the market so an unreadable export refuses here.
    return image.inspect_runtime({key: identity[key] for key in IDENTITY_FIELDS}, argv, mounts)


def _build_identity(identity: dict) -> dict:
    fields = (*IDENTITY_FIELDS, *(("build_revision",) if identity.get("build_revision") else ()))
    return {key: identity[key] for key in fields}


def _require_ci_build(identity: dict, inspection: dict) -> str:
    from runtime import image
    return image.require_ci_build(_build_identity(identity), inspection)


def _require_main_build(identity: dict, inspection: dict) -> str:
    from runtime import image
    return image.require_main_build(_build_identity(identity), inspection)


def _checkout() -> Path:
    return paths.REPOSITORY


# Market (market.resolve_day, market.membership_path, market.export_catalogs, market.validate_lifecycle)

class Market:
    """The market directory behind the registration interface, named by its profile's name: each method one
    designed market function, its refusals in the registration codes."""

    def __init__(self, profile: dict):
        self.profile = profile
        self.name = profile["name"]

    def _open(self):
        from market import files
        return files.open_market(self.profile, "reader")

    def resolve_day(self, at: str | None) -> str:
        from market import files
        try:
            return files.resolve_day(self._open(), at)
        except Refusal as exc:
            raise refuse("MARKET_DAY_UNRESOLVED", f"market reference {at!r} did not resolve ({exc.code})",
                         missing=(str(at),)) from exc

    def _freshness(self, market_day: str) -> dict:
        from market import read
        try:
            return read.freshness(self.profile, market_day)
        except Refusal as exc:
            raise refuse("MARKET_DAY_UNRESOLVED", f"market day {market_day} has no complete day ({exc.code})",
                         missing=(str(market_day),)) from exc

    def days(self, market_day: str):
        """(first day of the market's first universe month, latest complete UTC day) at `market_day`."""
        found = self._freshness(market_day)
        return date.fromisoformat(found["universe_months"][0] + "-01"), found["latest_complete_day"]

    def universe_rule(self, market_day: str) -> str:
        from market import universe
        return universe.rule_of(self._open(), market_day)

    def universe_month(self, market_day: str) -> list[tuple[str, str]]:
        from market import universe
        found = universe.months_of(self._open(), market_day)
        return [(month.isoformat()[:7], symbol) for month, symbol in found]

    def track_months(self, market_day: str, table: str) -> list[tuple[str, str]]:
        from market import files
        return files.track_months(self._open(), market_day, table)

    def listed_day(self, market_day: str, symbol: str) -> date | None:
        from market import store
        return store.listed_day(self._open(), market_day, symbol)

    def membership_path(self, market_day: str, window_end: int) -> dict:
        from market import universe
        try:
            return universe.membership_path(self._open(), market_day, window_end)
        except Refusal as exc:
            code = "UNIVERSE_EMPTY" if exc.code == "UNIVERSE_EMPTY_AT_DAY" else (
                "MARKET_DAY_UNRESOLVED" if exc.code == "MARKET_DAY_UNRESOLVED" else None)
            if code is None:
                raise
            raise refuse(code, exc.message, missing=exc.missing) from exc

    def export_catalogs(self, market_day: str, symbols: list[str], start_ns: int, end_ns: int, episodes, lifecycle_files,
                        fresh: bool, *, include_quotes: bool = True, include_trades: bool = False,
                        include_metrics: bool = False, split_halts: bool = True) -> dict:
        """{root, receipts}."""
        from market import export
        done = export.export_catalogs(self.profile, market_day, symbols, start_ns, end_ns, episodes, lifecycle_files,
                                      fresh, include_quotes=include_quotes, include_trades=include_trades,
                                      include_metrics=include_metrics, split_halts=split_halts)
        return {"root": Path(done["root"]), "receipts": done["receipts"]}

    def validate_lifecycle(self, body: dict, market_day: str, files: Mapping[str, bytes]) -> dict:
        """market.validate_lifecycle (LIFECYCLE_INPUT)."""
        from market import lifecycle
        return lifecycle.validate_lifecycle(body, market_day, files)


def coverage(market, market_day: str) -> dict:
    """What ledger.lines.run_covered reads of `market` (a Market) at `market_day`: `members`, its universe
    (YYYY-MM, symbol) rows, `tracks(table)`, the months a contract table holds, and `listed(symbol)`, the first day
    of a contract's trading run into its first universe month (each read once)."""
    return {"members": market.universe_month(market_day),
            "tracks": functools.cache(lambda table: market.track_months(market_day, table)),
            "listed": functools.cache(lambda symbol: market.listed_day(market_day, symbol))}


@dataclass(frozen=True)
class Seams:
    resolve_runtime: Callable[[str | None], dict]
    inspect_runtime: Callable[[dict, list[str], Mapping], dict]
    require_ci_build: Callable[[dict, dict], str]
    require_main_build: Callable[[dict, dict], str]
    checkout: Callable[[], Path]
    market: Callable[[dict], Market]
    # Economic-evidence qualification (registration.require, registration.assess); None is
    # registration.availability's own, which reads this module's checkout and so cannot be named here.
    qualification_require: Callable[[object, Mapping], dict] | None
    qualification_assess: Callable[..., dict] | None


DEFAULT = Seams(resolve_runtime=_resolve_runtime, inspect_runtime=_inspect_runtime,
                require_ci_build=_require_ci_build, require_main_build=_require_main_build, checkout=_checkout,
                market=Market, qualification_require=None, qualification_assess=None)
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
