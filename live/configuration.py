"""The Live control's installed inputs, and the run choices a browser request may name: a candidate, its
contracts and the run settings, never a host path."""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from pathlib import Path
import re

from engine.config import ACCOUNT_CONTRACT, is_leverage
from engine.live_brake import BRAKE_MAX
from live import state


# A candidate reference, strategy_id@revision (ledger.strategies.parse_ref).
CANDIDATE = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,99}@[1-9][0-9]{0,8}\Z")
DIGEST = re.compile(r"[0-9a-f]{64}\Z")
SYMBOL = re.compile(r"[A-Z0-9]+USDT\Z")
# A run's choices: its duration (None: until stopped), the account's Binance leverage and its drawdown brake, which
# defaults to the user's maximum-drawdown target and can only be tighter (engine.live_brake). Its cash floor is a share
# of the wallet at its first arming, not a choice.
CONFIG_KEYS = frozenset({"duration_seconds", "leverage", "drawdown_brake"})
BRAKE_DEFAULT = str(BRAKE_MAX)
DEFAULTS = {"duration_seconds": None, "leverage": ACCOUNT_CONTRACT["default_leverage"], "drawdown_brake": BRAKE_DEFAULT}
RUNNER_MEMORY = "2g"  # each Live runner's container memory


def fail():
    return state.fail("LIVE_CONFIG", "the Live control configuration or request fields are invalid")


def fields(value, names: set | frozenset) -> dict:
    if not isinstance(value, dict) or set(value) != names:
        raise fail()
    return value


def text(value, pattern: re.Pattern) -> str:
    if not isinstance(value, str) or not pattern.fullmatch(value):
        raise fail()
    return value


def absolute(value) -> Path:
    if not isinstance(value, str) or not value or not Path(value).is_absolute():
        raise fail()
    return Path(value)


def run_config(value) -> dict:
    value = fields(value, CONFIG_KEYS)
    result: dict = {}
    item = value["drawdown_brake"]
    try:
        if not isinstance(item, str) or len(item) > 64:
            raise ValueError
        number = Decimal(item)
        if not number.is_finite() or not 0 < number <= Decimal(BRAKE_DEFAULT):
            raise ValueError
    except (InvalidOperation, ValueError):
        raise fail() from None
    result["drawdown_brake"] = str(number)
    duration = value["duration_seconds"]  # None: the run goes on until it is stopped
    if duration is not None and (type(duration) is not int or duration < 1):
        raise fail()
    result["duration_seconds"] = duration
    # The account's Binance leverage: the venue's symbol leverage must equal it (engine.live_venue).
    if not is_leverage(value["leverage"]):
        raise fail()
    result["leverage"] = value["leverage"]
    return result


def symbols(value) -> list[str]:
    """A run's contracts, one strategy instance each: distinct Binance USDT-M symbols."""
    if (not isinstance(value, list) or not value or len(set(map(str, value))) != len(value)
            or any(not isinstance(item, str) or not SYMBOL.fullmatch(item) for item in value)):
        raise state.fail("LIVE_SYMBOLS", "Live requires distinct explicit USD-M symbols")
    return list(value)


@dataclass(frozen=True)
class Configuration:
    root: Path
    socket: Path
    research_ledger: Path  # the reader profile: a run's candidate and evidence are read at the research head
    runtime: str
    market_root: Path  # the market directory, mounted read-only: membership and the contract terms (TERMS_CHANGED)


def parse(value: dict) -> Configuration:
    """The control's installed snapshot, whose fields, format and runtime digest deploy.live_configuration.snapshot
    already checked, as typed values. Its other fields are not read."""
    return Configuration(root=absolute(value["root"]), socket=absolute(value["socket"]),
                         research_ledger=absolute(value["research_ledger"]), runtime=value["runtime"],
                         market_root=absolute(value["market_root"]))
