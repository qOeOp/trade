"""What every command group shares: the JSON output and refusal forms, argument readers, and the parser
and its common options."""

from __future__ import annotations

import argparse
from collections.abc import Mapping
from datetime import date, datetime, timedelta
from decimal import Decimal
import json
from pathlib import Path

from shared import paths
from shared.errors import Refusal
from shared.refusals import CATALOGUE, refuse


# Output

def _jsonable(value):
    if isinstance(value, Mapping):
        return {str(key): _jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set, frozenset)):
        return [_jsonable(item) for item in value]
    if isinstance(value, (bytes, bytearray, memoryview)):
        return {"bytes": len(value)}
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, float) and value != value:
        return None
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    return str(value)


def _print(stream, value) -> None:
    stream.write(json.dumps(_jsonable(value), ensure_ascii=False, indent=2, sort_keys=False) + "\n")
    stream.flush()


def refusal_json(exc: Refusal) -> dict:
    """The printed form of a refusal: its fields and its catalogue repair commands."""
    return {**exc.as_dict(), "next_actions": list(exc.next_actions)}


def _market_refusal(exc) -> Refusal:
    """A market package refusal (market.sources.MarketError) as a ledger refusal with its catalogue repair commands."""
    return Refusal(exc.code, exc.message, missing=exc.missing, next_actions=CATALOGUE[exc.code])


# Small argument helpers

def _regular_file(path: str, code: str = "SOURCE_UNREADABLE") -> bytes:
    found = Path(path)
    try:
        if found.is_symlink() or not found.is_file():
            raise OSError("not a regular file")
        return found.read_bytes()
    except OSError as exc:
        raise refuse(code, f"{path} is not a readable regular file", missing=(str(path),)) from exc


def _json_file(path: str, code: str) -> dict:
    data = _regular_file(path, code)
    try:
        value = json.loads(data.decode("utf-8"))
    except (UnicodeDecodeError, ValueError) as exc:
        raise refuse(code, f"{path} is not UTF-8 JSON: {exc}", missing=(str(path),)) from exc
    if not isinstance(value, dict):
        raise refuse(code, f"{path} is not a JSON object", missing=(str(path),))
    return value


def _utc_time(text: str) -> datetime:
    try:
        moment = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except (AttributeError, ValueError) as exc:
        raise refuse("WINDOW_INVALID", f"{text!r} is not an ISO-8601 time", expected="UTC as YYYY-MM-DDTHH:MM:SSZ") from exc
    if moment.utcoffset() != timedelta(0):
        raise refuse("WINDOW_INVALID", f"{text!r} is not a UTC time", expected="UTC as YYYY-MM-DDTHH:MM:SSZ")
    return moment


def _new_temporary(path: str) -> Path:
    return paths.temporary_path(path, require_new=True)


# Parser and common options

class Parser(argparse.ArgumentParser):
    def error(self, message):
        raise refuse("USAGE_ERROR", message)


def _ledger_option(parser) -> None:
    parser.add_argument("--ledger", help="ledger profile file or name (default: the active ledger)")


def _paper_option(parser) -> None:
    parser.add_argument("--ledger", help="Paper database profile file or name (default: the one Paper database profile)")


def _market_option(parser) -> None:
    parser.add_argument("--market", help="market profile file or name (default: the active market profile in "
                                         "the profile directory)")


def _at(parser) -> None:
    parser.add_argument("--at", help="ledger commit or branch (default: the head)")


def _market_day(parser, required: bool = False) -> None:
    parser.add_argument("--market-day", required=required,
                        help="market day, YYYY-MM-DD, or head for the newest day" + ("" if required else " (default: head)"))


def _count(text: str) -> int:
    if not text.isdigit() or int(text) < 1:
        raise argparse.ArgumentTypeError(f"must be a whole number of at least 1, got {text!r}")
    return int(text)


def _op_id(parser) -> None:
    parser.add_argument("--op-id", help="operation ID; the same ID and content again is a replay (default: derived "
                                        "from the content)")


CANDIDATE_HELP = "candidate as ID@N (strategy ID and revision)"
RUNTIME_HELP = "runtime image tag or digest; a tag resolves to its digest"
RUNTIME_DEFAULT_HELP = RUNTIME_HELP + " (default: the main tag)"
EXECUTION_DEFAULT_HELP = RUNTIME_HELP + " (default: the exec-main tag, the execution image Paper and Live run)"
RUNNER_EPILOG = """runner arguments after -- (engine/README.md):
  --symbols SYMBOL ... | --universe pool   Binance symbols such as BTCUSDT, or every universe member among the
                                           contracts this deployment's market holds (not every listed contract)
  --start T --trade-start T --end T        UTC ISO-8601 with Z on the minute grid, start <= trade-start < end;
                                           --trade-start defaults to --start
  --lifecycle-bundle lifecycle-<day>       optional lifecycle bundle of the market day
  --execution bars|quotes                  the execution environment (default bars); quotes drives matching and
                                           the native liquidation with the exported best bid/ask and needs
  --initial-margin R --maintenance-margin R   decimal rates, 0 < maintenance <= initial < 1
  --starting-balance USDT                  the account's starting balance (default 100000); runs with different
                                           balances are not comparable
  --leverage N                             the account's leverage, an integer from 1 to 125 (default 3); part of
                                           the effective configuration
  --trade-ticks                            quotes only: export every stored aggregate trade as custom data for the
                                           strategy's subscribe_data(DataType("TradeTick", metadata={"instrument_id":
                                           ...})); native subscribe_trades is TRADES_NOT_SERVED (signal input; trades
                                           never match); a trading month without trades is TRADES_MISSING
  --metrics                                export the stored open interest and long/short ratios as custom
                                           data (engine.metrics_data_type, through subscribe_data), each row
                                           10 minutes after its create_time; a trading month without metrics is
                                           METRICS_MISSING, and an image older than the option refuses it"""
