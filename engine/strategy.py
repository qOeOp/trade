"""Shared native strategy construction and evidence boundaries for Replay, Paper and Live.

This module owns the existing process-local source registry and failure receipts.
It does not own execution, scheduling, orders, positions, or mode-specific inputs.
"""

from __future__ import annotations

import functools
import json
import os
import re
import traceback
from pathlib import Path
from typing import Any

from nautilus_trader.trading import Strategy

from engine.config import Refusal
from engine.load import LoadedStrategy


STRATEGIES: dict[str, Strategy] = {}


# What a source may subscribe to (docs/plans/r1-runtime-contract-20261110.zh.md, 4): one-minute LAST EXTERNAL bars and
# their native LAST aggregations to periods Binance also publishes, MARK, funding, instrument status and close, and the
# custom trades and metrics a replay streams. Quotes, books, index prices, option data and native trades exist in
# none of replay, Paper and Live alike, so the run is refused once the current chunk (replay) or tick (Paper) ends,
# or at once (Live). Trades and metrics reach a strategy only as custom data (trade_data_type, metrics_data_type) of
# a contract whose export counts them (the entry's --trade-ticks or --metrics); Paper and Live stream neither.
NOT_SERVED = {"TradeTick": "TRADES_NOT_SERVED", "Metrics": "METRICS_NOT_SERVED"}
SERVED: dict[str, set[str]] = {kind: set() for kind in NOT_SERVED}  # the instrument IDs this run streams it for
OUTSIDE = "SUBSCRIPTION_OUTSIDE_CONTRACT"
BREACHES: list[tuple[str, str]] = []  # (refusal code, what the source did)
MINUTE_BARS = re.compile(r"(?P<iid>.+)-1-MINUTE-LAST-EXTERNAL")
AGGREGATED_BARS = re.compile(r"(?P<iid>.+)-(?P<step>\d+)-(?P<unit>MINUTE|HOUR|DAY)-LAST-INTERNAL@1-MINUTE-EXTERNAL")
PERIODS = {("3", "MINUTE"), ("5", "MINUTE"), ("15", "MINUTE"), ("30", "MINUTE"), ("1", "HOUR"), ("2", "HOUR"),
           ("4", "HOUR"), ("6", "HOUR"), ("8", "HOUR"), ("12", "HOUR"), ("1", "DAY")}  # Binance kline intervals
UNSERVED_SUBSCRIPTIONS = ("subscribe_quotes", "subscribe_index_prices", "subscribe_book_at_interval",
                          "subscribe_book_deltas", "subscribe_book_depth", "subscribe_option_chain",
                          "subscribe_option_greeks", "subscribe_queue_state")


def contract_bar_type(bar_type) -> bool:
    text = str(bar_type)
    if MINUTE_BARS.fullmatch(text):
        return True
    found = AGGREGATED_BARS.fullmatch(text)
    return found is not None and (found["step"], found["unit"]) in PERIODS


def _refused(name: str):
    def subscribe(self, *args, **kwargs):
        return self._breach(OUTSIDE, f"{self.strategy_id}: {name} {args[0] if args else ''}; no run serves it")
    subscribe.__name__ = name
    return subscribe


class Subscriptions:
    """Refuses every subscription outside the contract; the rest go on as asked. `_breach(code, text)` is the
    runner's: it records (replay, Paper) or raises (Live)."""

    def _breach(self, code: str, text: str):
        BREACHES.append((code, text))

    def subscribe_bars(self, bar_type, *args, **kwargs):
        if not contract_bar_type(bar_type):
            return self._breach(OUTSIDE, f"{self.strategy_id}: subscribe_bars {bar_type}; bars are 1-MINUTE-LAST-"
                                         "EXTERNAL or its LAST-INTERNAL aggregation to a Binance kline period")
        return super().subscribe_bars(bar_type, *args, **kwargs)  # type: ignore[misc]

    def subscribe_data(self, data_type, *args, **kwargs):
        kind = data_type.type_name
        if kind in NOT_SERVED:
            served = (data_type.metadata or {}).get("instrument_id")
            if served not in SERVED[kind]:
                return self._breach(NOT_SERVED[kind], f"{self.strategy_id}: subscribe_data {kind} for {served}, "
                                                      "which this run does not stream")
        return super().subscribe_data(data_type, *args, **kwargs)  # type: ignore[misc]

    def subscribe_trades(self, instrument_id, *args, **kwargs):
        return self._breach("TRADES_NOT_SERVED", f"{self.strategy_id}: subscribe_trades {instrument_id}; trades "
                                                 "arrive only through subscribe_data(DataType(\"TradeTick\", "
                                                 "metadata={\"instrument_id\": ...}))")


for _name in UNSERVED_SUBSCRIPTIONS:
    setattr(Subscriptions, _name, _refused(_name))


def breaches() -> tuple[str, list[str]] | None:
    """(refusal code, what the sources did) of the first kind of contract breach in the run, or None."""
    if not BREACHES:
        return None
    code = BREACHES[0][0]
    return code, [text for found, text in BREACHES if found == code]


def allocate_strategy(cls, allocator, args: tuple, kwargs: dict):
    """Forward source allocation without passing runner inputs to the native default."""
    instance = allocator(cls) if allocator is Strategy.__new__ else allocator(cls, *args, **kwargs)
    if type(instance) is not cls:
        raise TypeError("source allocation must preserve the configured strategy class")
    instance._source_constructor_args = (args, kwargs)
    return instance


# Structured runtime failures (engine.execution_failure): a strategy's constructor or callback that
# raises, and any exception that ends main before its verdict, leaves a receipt in the process and in
# <output>/runtime_failures.jsonl before the exception goes on, so a failure the engine catches still
# fails the run (NATIVE_EXECUTION_FAILED). Each distinct (exception type, stage, instance, message) is
# one record with its count and its first traceback, so a callback failing on every bar stays one line.

FAILURE_FORMAT = "runtime-failure-v2"
FAILURES: list[dict] = []  # the records, in order of first occurrence; `count` grows in place
FAILURE_PATH: Path | None = None  # the receipt file of this process's replay, once main set it
GUARDED_HOOKS = ("replay_diagnostics", "replay_integrity_findings")
MAX_FAILURE_RECORDS = 100  # distinct records kept; later new ones are counted in one overflow record
MAX_FAILURE_TEXT = 4000  # characters of a message, and (x 5) of a traceback, a record keeps
OVERFLOW_STAGE = "receipt_overflow"
OVERFLOW_SIGNATURE = (None, OVERFLOW_STAGE, None, None)
_SIGNATURES: dict[tuple, dict] = {}


def _clip(text: str, limit: int) -> str:
    return text if len(text) <= limit else text[:limit] + f"... ({len(text) - limit} more characters)"


def _overflow() -> dict:
    return {"stage": OVERFLOW_STAGE, "exception_type": "various", "instrument_id": "various", "code": None,
            "message": f"failures beyond the first {MAX_FAILURE_RECORDS} distinct records", "traceback": ""}


def _record(signature: tuple, build) -> dict:
    """The record of `signature` (made by `build` the first time), its count raised by one; once
    MAX_FAILURE_RECORDS records exist, a new signature counts in the one overflow record instead."""
    receipt = _SIGNATURES.get(signature)
    if receipt is None and len(_SIGNATURES) >= MAX_FAILURE_RECORDS:
        signature, build = OVERFLOW_SIGNATURE, _overflow
        receipt = _SIGNATURES.get(signature)
    if receipt is None:
        receipt = {"format": FAILURE_FORMAT, **build(), "count": 0}
        _SIGNATURES[signature] = receipt
        FAILURES.append(receipt)
    receipt["count"] += 1
    return receipt


def write_failures() -> None:
    """Replace the receipt file with the current records (written beside it, then renamed into place)."""
    if FAILURE_PATH is None:
        return
    FAILURE_PATH.parent.mkdir(parents=True, exist_ok=True)
    partial = FAILURE_PATH.with_name("." + FAILURE_PATH.name + ".partial")
    with partial.open("w", encoding="utf-8") as stream:
        for receipt in FAILURES:
            stream.write(json.dumps(receipt, ensure_ascii=False, sort_keys=True) + "\n")
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(partial, FAILURE_PATH)


def execution_failure(stage: str, exc: BaseException, instance) -> None:
    """Record one constructor, callback or runner-stage exception; never raises itself.

    The file is rewritten when a record is new and when its count reaches a power of two (and once
    more when main ends), so a runner killed mid-replay leaves every distinct failure and each count
    at least half its true value."""
    kind = type(exc).__name__
    try:
        instrument = next((key for key, value in STRATEGIES.items() if value is instance), None) or "unconstructed"
        message = str(exc)
        receipt = _record((kind, stage, instrument, message), lambda: {
            "stage": stage, "exception_type": kind, "instrument_id": instrument,
            "code": exc.code if isinstance(exc, Refusal) else None, "message": _clip(message, MAX_FAILURE_TEXT),
            "traceback": _clip("".join(traceback.format_exception(exc)), 5 * MAX_FAILURE_TEXT)})
    except Exception as error:  # an exception that cannot even be described still fails the run
        failure = type(error).__name__  # bound here: `error` is unbound once the except clause ends
        receipt = _record((kind, stage, "unconstructed", None), lambda: {
            "stage": stage, "exception_type": kind, "instrument_id": "unconstructed", "code": None,
            "message": f"the exception could not be described: {failure}", "traceback": ""})
    if receipt["count"] & (receipt["count"] - 1):
        return
    try:
        write_failures()
    except Exception as error:  # the receipt is evidence; failing to write it must not hide the original
        note = f" (receipt not written: {error})"
        if not receipt["message"].endswith(note):
            receipt["message"] += note


def clear_failures() -> None:
    FAILURES.clear()
    _SIGNATURES.clear()


# Data callbacks. An instance whose input starts after the replay's (its daily warm-up first holds
# later) gets no data stamped before its input start: the instance starts there.
DATA_CALLBACKS = ("on_bar", "on_mark_price", "on_funding_rate", "on_index_price", "on_quote", "on_trade",
                  "on_instrument_status", "on_instrument_close", "on_data")


def guard_callback(name: str, method):
    """The source's callback, recording any exception it raises before raising it unchanged."""
    data = name in DATA_CALLBACKS

    @functools.wraps(method)
    def guarded(self, *args, **kwargs):
        if data and args and getattr(args[0], "ts_event", None) is not None and \
                args[0].ts_event < getattr(self, "_replay_input_start_ns", 0):
            return None
        try:
            return method(self, *args, **kwargs)
        except Exception as exc:
            execution_failure(name, exc, self)
            raise
    return guarded


# Clock APIs that register a callback, with the callback's position among their arguments
# (nautilus_trader.common.Clock in the pinned version).
CLOCK_CALLBACK_APIS = {"set_timer": 4, "set_timer_ns": 4, "set_time_alert": 2, "set_time_alert_ns": 2,
                       "register_default_handler": 0}


class GuardedClock:
    """The strategy's native clock, with every callback the source registers on it guarded."""

    def __init__(self, clock, instance):
        self._clock, self._instance = clock, instance

    def __getattr__(self, name):
        found = getattr(self._clock, name)
        if name not in CLOCK_CALLBACK_APIS:
            return found
        index = CLOCK_CALLBACK_APIS[name]

        def register(*args, **kwargs):
            if kwargs.get("callback") is not None:
                kwargs["callback"] = self._guard(name, kwargs["callback"])
            elif len(args) > index and args[index] is not None:
                args = (*args[:index], self._guard(name, args[index]), *args[index + 1:])
            return found(*args, **kwargs)
        return register

    def _guard(self, api: str, callback):
        instance, stage = self._instance, f"{api}:{getattr(callback, '__name__', 'callback')}"

        @functools.wraps(callback)
        def guarded(*args, **kwargs):
            try:
                return callback(*args, **kwargs)
            except Exception as exc:
                execution_failure(stage, exc, instance)
                raise
        return guarded


def _guarded_clock(self) -> GuardedClock:
    return GuardedClock(Strategy.clock.__get__(self, type(self)), self)


# Cache APIs that write (nautilus_trader.common.Cache in the pinned version): the native reports are read
# from the cache after the run, so a source that purged or reset it would erase its own trades.
CACHE_WRITES = ("add", "add_instrument_close", "add_yield_curve", "dispose", "reset", "snapshot_position")


class ReadOnlyCache:
    """The strategy's native cache with every write refused (CACHE_WRITE, raised in the calling callback)."""

    def __init__(self, cache):
        self._cache = cache

    def __getattr__(self, name):
        if name in CACHE_WRITES or name.startswith("purge_"):
            raise Refusal("CACHE_WRITE", f"a strategy cannot call cache.{name}: the native reports are read from "
                                         "the cache")
        return getattr(self._cache, name)


def _read_only_cache(self) -> ReadOnlyCache:
    return ReadOnlyCache(Strategy.cache.__get__(self, type(self)))


def guarded_callbacks(strategy_class: type) -> dict:
    """Every on_ callback and report hook the source's classes define, guarded, the most derived winning,
    a clock whose registered callbacks are guarded too, and a cache that refuses writes."""
    found = {"clock": property(_guarded_clock), "cache": property(_read_only_cache)}
    for cls in strategy_class.__mro__:
        if cls is Strategy:
            break
        for name, value in vars(cls).items():
            if (name.startswith("on_") or name in GUARDED_HOOKS) and callable(value) and name not in found:
                found[name] = guard_callback(name, value)
    return found


def configure_strategy(strategy: LoadedStrategy, inputs: Any, class_of) -> Strategy:
    """engine.configure_strategy: the source's entry class constructed from the runner's inputs alone,
    registered by contract; a constructor that raises leaves a receipt and refuses the replay."""
    try:
        return class_of(strategy)(inputs)
    except Exception as exc:
        execution_failure("constructor", exc, None)
        raise Refusal("STRATEGY_CONSTRUCTION_FAILED", f"{inputs.instrument_id}: {type(exc).__name__}: {exc}") from exc
