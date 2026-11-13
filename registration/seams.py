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

from ledger.execution import IDENTITY_FIELDS
from shared import paths
from shared.refusals import refuse


# Runtime (runtime.resolve, runtime.inspect_runtime, runtime.require_ci_build, runtime.require_main_build)


def _resolve_runtime(reference: str | None) -> dict:
    from runtime import image
    return image.resolve(reference)


# Runner arguments inside the container. The replay entry writes the strategy, execution binding,
# output and market options itself and mounts the inputs at fixed container paths, so registration and
# every replay probe the same effective configuration (no host path enters it).
RESERVED_RUNNER_OPTIONS = ("--strategy-file", "--strategy-class", "--strategy-sha256", "--execution-binding",
                           "--output", "--describe", "--market-root", "--market-day")
# Read by the entry, not passed to the runner as given: `--universe pool` selects the universe (the entry
# then passes the runner `--universe` with the membership file it wrote), `--symbols` the contracts.
ENTRY_OPTIONS = ("--universe", "--symbols", "--lifecycle-bundle")
# Read by the entry and never passed on: `--trade-ticks` exports the stored aggregate trades as TradeTicks, which
# the runner streams for every contract whose receipt counts them. `--metrics` is read by the entry (it exports
# the stored metrics) and passed on: the runner then requires them, and an image without it refuses the option.
ENTRY_FLAGS = ("--trade-ticks",)
MARKET_ROOT, MEMBERSHIP = "/inputs/market", "/inputs/membership.json"


def require_unreserved(runner_argv: list[str]) -> None:
    """RUNNER_OPTION_RESERVED when the runner arguments name an option the replay entry writes itself."""
    reserved = sorted({option for value in runner_argv if (option := value.split("=", 1)[0]) in RESERVED_RUNNER_OPTIONS})
    if reserved:
        raise refuse("RUNNER_OPTION_RESERVED", "the replay entry writes " + ", ".join(reserved) + " itself",
                     missing=tuple(reserved))


def container_runner_args(runner_argv: list[str], inputs: Mapping) -> tuple[list[str], list[tuple[Path, str, bool]]]:
    """(runner arguments with the inputs at their container paths, the read-only input mounts)."""
    require_unreserved(runner_argv)
    argv, skipping = [], False
    for value in runner_argv:
        option = value.split("=", 1)[0]
        if value in ENTRY_FLAGS:
            skipping = False
            continue
        if option in ENTRY_OPTIONS:
            skipping = "=" not in value
            continue
        if skipping and not value.startswith("--"):
            continue
        skipping = False
        argv.append(value)
    symbols = list(inputs.get("symbols") or (inputs.get("identity") or {}).get("symbols") or ())
    argv += ["--market-root", MARKET_ROOT, "--market-day", inputs["identity"]["market_day"],
             "--universe", MEMBERSHIP]
    if symbols:
        argv += ["--symbols", *symbols]
    return argv, [(Path(inputs["root"]), MARKET_ROOT, True), (Path(inputs["membership_file"]), MEMBERSHIP, True)]


def _inspect_runtime(identity: dict, runner_argv: list[str], inputs: Mapping) -> dict:
    """The probe report for the container arguments of these inputs."""
    from runtime import image
    argv, mounts = container_runner_args(list(runner_argv), inputs)
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


def runner_inputs(runner_argv: list[str]) -> dict:
    """Window (UTC ns), selection, lifecycle bundle and execution from existing runner flags."""
    parser = _RunnerParser(add_help=False)
    parser.add_argument("--start", required=True)
    parser.add_argument("--trade-start")
    parser.add_argument("--end", required=True)
    parser.add_argument("--symbols", nargs="+")
    parser.add_argument("--lifecycle-bundle")
    parser.add_argument("--execution", default="bars")  # the runtime owns validation of this value
    parser.add_argument("--trade-ticks", action="store_true")
    parser.add_argument("--metrics", action="store_true")
    known, _ = parser.parse_known_args(runner_argv)
    if known.trade_ticks and known.execution != "quotes":
        # In the bar environment a market order fills at once at the previous bar's close, so an order a trade
        # prompts mid-minute would fill at a price up to 59 seconds older than the trade.
        raise refuse("TRADE_TICKS_NEED_QUOTES", "--trade-ticks needs --execution quotes", missing=("--execution",))
    start = _ns(known.start)
    window = {"start": start, "trade_start": _ns(known.trade_start) if known.trade_start else start,
              "end": _ns(known.end)}
    selection: dict[str, list[str] | bool] = {"symbols": list(known.symbols)} if known.symbols else {"universe": True}
    return {"window": window, "selection": selection, "lifecycle_bundle": known.lifecycle_bundle,
            "execution": known.execution, "trade_ticks": known.trade_ticks, "metrics": known.metrics}


# Market (market.resolve_day, market.membership_path, market.export_catalogs, market.validate_lifecycle)

class Market:
    """The market directory behind the registration interface, named by its profile's name: each method one
    designed market function, its refusals in the registration codes."""

    def __init__(self, profile: dict):
        self.profile = profile
        self.database = profile["name"]

    def _open(self):
        from market import files
        return files.open_market(self.profile, "reader")

    def resolve_day(self, at: str | None) -> str:
        from market import files
        from market.sources import MarketError
        try:
            return files.resolve_day(self._open(), at)
        except MarketError as exc:
            raise refuse("MARKET_DAY_UNRESOLVED", f"market reference {at!r} did not resolve ({exc.code})",
                         missing=(str(at),)) from exc

    def _freshness(self, market_day: str) -> dict:
        from market import store
        from market.sources import MarketError
        try:
            return store.freshness(self.profile, market_day)
        except MarketError as exc:
            raise refuse("MARKET_DAY_UNRESOLVED", f"market day {market_day} has no complete day ({exc.code})",
                         missing=(str(market_day),)) from exc

    def latest_complete_day(self, market_day: str):
        """market.freshness's latest complete UTC day at `market_day`."""
        return self._freshness(market_day)["latest_complete_day"]

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

    def membership_path(self, market_day: str, window_end: int) -> dict:
        from market import universe
        from market.sources import MarketError
        try:
            return universe.membership_path(self._open(), market_day, window_end)
        except MarketError as exc:
            code = "UNIVERSE_EMPTY" if exc.code == "UNIVERSE_EMPTY_AT_DAY" else (
                "MARKET_DAY_UNRESOLVED" if exc.code == "MARKET_DAY_UNRESOLVED" else None)
            if code is None:
                raise
            raise refuse(code, exc.message, missing=exc.missing) from exc

    def export_catalogs(self, market_day: str, symbols: list[str], start_ns: int, end_ns: int, episodes, lifecycle_files,
                        fresh: bool, *, include_quotes: bool = True, include_trades: bool = False,
                        include_metrics: bool = False) -> dict:
        """{market_day, root, exported, reused, receipts}."""
        from market import export
        from market.sources import MarketError
        try:
            done = export.export_catalogs(self.profile, market_day, symbols, start_ns, end_ns, episodes, lifecycle_files,
                                          fresh, include_quotes=include_quotes, include_trades=include_trades,
                                          include_metrics=include_metrics)
        except MarketError as exc:
            if exc.code == "LIFECYCLE_INPUT":
                raise refuse("LIFECYCLE_INPUT", exc.message) from exc
            raise
        return {"market_day": done["market_day"], "root": Path(done["root"]), "exported": done["exported"],
                "reused": done["cached"], "receipts": done["receipts"]}

    def validate_lifecycle(self, body: dict, market_day: str, files: Mapping[str, bytes]) -> dict:
        """market.validate_lifecycle, its refusal as LIFECYCLE_INPUT."""
        from market import lifecycle
        try:
            return lifecycle.validate_lifecycle(body, market_day, files)
        except lifecycle.LifecycleInput as exc:
            raise refuse("LIFECYCLE_INPUT", exc.message) from exc


# Economic-evidence qualification (registration.require, registration.assess); imported late because
# availability reads this module.

def _qualification_require(conn, run: Mapping) -> dict:
    from registration import availability
    return availability.require(conn, run)


def _qualification_assess(conn, run: Mapping, **options) -> dict:
    from registration import availability
    return availability.assess(conn, run, **options)


@dataclass(frozen=True)
class Seams:
    resolve_runtime: Callable[[str | None], dict]
    inspect_runtime: Callable[[dict, list[str], Mapping], dict]
    require_ci_build: Callable[[dict, dict], str]
    require_main_build: Callable[[dict, dict], str]
    checkout: Callable[[], Path]
    market: Callable[[dict], Market]
    qualification_require: Callable[[object, Mapping], dict]
    qualification_assess: Callable[..., dict]


DEFAULT = Seams(resolve_runtime=_resolve_runtime, inspect_runtime=_inspect_runtime,
                require_ci_build=_require_ci_build, require_main_build=_require_main_build, checkout=_checkout,
                market=Market, qualification_require=_qualification_require,
                qualification_assess=_qualification_assess)
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


def month_of(moment: datetime | date) -> str:
    return f"{moment.year}-{moment.month:02d}"


def next_month(month: str) -> str:
    year, number = int(month[:4]), int(month[5:7])
    return f"{year + number // 12}-{number % 12 + 1:02d}"
