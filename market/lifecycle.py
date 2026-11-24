"""Lifecycle facts (`market.validate_lifecycle`, `market.derived_episode`, `market.write_lifecycle_events`,
`market.require_native_price`).

A lifecycle manifest (lifecycle.json in the evidence bundle lifecycle-<market day>) lists each
contract's episodes: its native instrument ID, the listing time and the native InstrumentStatus and
InstrumentClose events taken from the exchange's announcements, with the source files the bundle
holds. The exporter writes the events of the replay window into the contract's Catalog with the
Catalog's own writers, and the replay delivers them natively: a PRE_CLOSE status (no new
positions), a CLOSE status (the market closes) and, only when the exchange published a settlement
price, an InstrumentClose of type CONTRACT_EXPIRED that the engine settles at. No price is made up.
A contract no bundle lists whose stored trades stopped gets a derived episode: only a CLOSE status at its last traded
minute's close; one that stopped and traded again inside the window gets one per span of trading.
"""

from __future__ import annotations

from collections.abc import Mapping
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from pathlib import PurePosixPath


from shared.errors import Refusal
from shared.refusals import refuse


FORMAT = "native-lifecycle-v1"
EVENT_TYPES = ("InstrumentStatus", "InstrumentClose")
EPISODE_FIELDS = ("symbol", "instrument_id", "start_ns", "events", "sources")


def _invalid(message: str) -> Refusal:
    """LIFECYCLE_INPUT: the lifecycle evidence does not hold."""
    return refuse("LIFECYCLE_INPUT", message)


def _native(event):
    from nautilus_trader.model import InstrumentClose, InstrumentStatus
    if not isinstance(event, Mapping) or event.get("type") not in EVENT_TYPES:
        raise _invalid(f"event {event!r} is not an InstrumentStatus or InstrumentClose dictionary")
    try:
        built = (InstrumentStatus if event["type"] == "InstrumentStatus" else InstrumentClose).from_dict(dict(event))
    except Exception as exc:
        raise _invalid(f"{event['type']} cannot be built natively: {exc}") from exc
    if built.ts_event != built.ts_init or built.ts_event != event.get("ts_event"):
        raise _invalid(f"{event['type']} of {built.instrument_id} has inconsistent clocks")
    if event["type"] == "InstrumentClose":
        try:
            price = Decimal(str(event["close_price"]))
        except (InvalidOperation, KeyError) as exc:
            raise _invalid(f"InstrumentClose of {built.instrument_id} has no exact price") from exc
        if built.close_type.name != "CONTRACT_EXPIRED" or not price.is_finite() or price <= 0:
            raise _invalid(f"InstrumentClose of {built.instrument_id} is not a positive CONTRACT_EXPIRED close")
    return built


DERIVED_REASON = "data-end"


def derived_episode(symbol: str, instrument_id: str, stop_ns: int | None, start_ns: int = 0) -> dict:
    """market.derived_episode: a contract's termination without evidence, at the close of its last traded minute
    (market.data_end_stops, market.trade_halts): one InstrumentStatus CLOSE, no settlement price, no listing clock and
    no source. Every episode of an evidence bundle cites a source, so an empty `sources` marks a derived one. After a
    halt `start_ns` is the first trade's minute; without `stop_ns` it trades on and has no event."""
    return {"symbol": symbol, "instrument_id": instrument_id, "start_ns": start_ns, "sources": [],
            "events": [] if stop_ns is None else [
        {"type": "InstrumentStatus", "instrument_id": instrument_id, "action": "CLOSE", "ts_event": stop_ns,
         "ts_init": stop_ns, "reason": DERIVED_REASON, "trading_event": None, "is_trading": None, "is_quoting": None,
         "is_short_sell_restricted": None}]}


def termination(episode: Mapping) -> int | None:
    """The clock of the episode's first InstrumentClose or InstrumentStatus CLOSE; None while it trades."""
    for event in episode["events"]:
        if event["type"] == "InstrumentClose" or event.get("action") == "CLOSE":
            return int(event["ts_event"])
    return None


def validate_lifecycle(body: Mapping, market_day: str, files: Mapping[str, bytes]) -> dict[str, list[dict]]:
    """market.validate_lifecycle: {symbol: [episode]} of a manifest bound to the pinned market day."""
    if not isinstance(body, Mapping) or body.get("format") != FORMAT or body.get("market_day") != market_day:
        raise _invalid(f"the manifest is not {FORMAT} of market day {market_day}")
    episodes = body.get("episodes")
    if not isinstance(episodes, list) or not episodes:
        raise _invalid("the manifest lists no episodes")
    grouped: dict[str, list[dict]] = {}
    ended: set[str] = set()
    for episode in sorted(episodes, key=lambda item: (str(item.get("symbol")), item.get("start_ns") or 0)
                          if isinstance(item, Mapping) else ("", 0)):
        if not isinstance(episode, Mapping) or set(episode) != set(EPISODE_FIELDS):
            raise _invalid(f"an episode does not hold exactly {', '.join(EPISODE_FIELDS)}")
        symbol, instrument_id, start = episode["symbol"], episode["instrument_id"], episode["start_ns"]
        if (not isinstance(symbol, str) or not isinstance(instrument_id, str) or type(start) is not int or start < 0
                or not isinstance(episode["events"], list) or not isinstance(episode["sources"], list)
                or not episode["sources"]):
            raise _invalid(f"the episode of {symbol!r} is malformed or cites no source")
        for source in episode["sources"]:
            if (not isinstance(source, str) or PurePosixPath(source).is_absolute()
                    or ".." in PurePosixPath(source).parts or source not in files):
                raise _invalid(f"{symbol}: source {source!r} is not a relative path held by the bundle")
        if instrument_id in ended:
            raise _invalid(f"{instrument_id} terminated and cannot be reused by a later episode")
        previous = grouped.get(symbol, [])
        if previous and (previous[-1]["instrument_id"] == instrument_id or start == previous[-1]["start_ns"]
                         or (ended_at := termination(previous[-1])) is None or start < ended_at):
            raise _invalid(f"{symbol}: a relisting needs a new instrument ID after the earlier episode ended")
        clock, terminated = start, None
        for event in episode["events"]:
            built = _native(event)
            if str(built.instrument_id) != instrument_id:
                raise _invalid(f"{symbol}: an event names {built.instrument_id}, not {instrument_id}")
            if built.ts_event < clock:
                raise _invalid(f"{symbol}: event clocks decrease or precede the listing")
            if terminated is not None and built.ts_event > terminated:
                raise _invalid(f"{symbol}: an event follows the termination of {instrument_id}")
            clock = built.ts_event
            if terminated is None and (event["type"] == "InstrumentClose" or built.action.name == "CLOSE"):
                terminated = built.ts_event
        _require_close_status(episode, symbol)
        if terminated is not None:
            ended.add(instrument_id)
        grouped.setdefault(symbol, []).append({key: episode[key] for key in EPISODE_FIELDS})
    return grouped


def _require_close_status(episode: Mapping, symbol: str) -> None:
    """A settlement closes the market first: a CLOSE status at or before every InstrumentClose, so the
    engine rejects any order after the settlement."""
    closes = [event["ts_event"] for event in episode["events"]
              if event["type"] == "InstrumentStatus" and event.get("action") == "CLOSE"]
    for event in episode["events"]:
        if event["type"] == "InstrumentClose" and not any(at <= event["ts_event"] for at in closes):
            raise _invalid(f"{symbol}: the InstrumentClose at {event['ts_event']} has no CLOSE status at or "
                                 "before it")


def _window(episode: Mapping, start: int, end: int, kind: str) -> list[dict]:
    """The episode's events of one type in the half-open window [start, end)."""
    return [event for event in episode["events"] if event["type"] == kind and start <= event["ts_event"] < end]


def require_native_price(episode: Mapping, instrument, start: int = 0, end: int | None = None) -> None:
    """market.require_native_price: each window settlement price lies on the contract's price grid."""
    increment = instrument.price_increment.as_decimal()
    for event in _window(episode, start, end if end is not None else 2**63, "InstrumentClose"):
        price = Decimal(str(event["close_price"]))
        exponent = price.as_tuple().exponent
        if (price / increment) % 1 or (-exponent if isinstance(exponent, int) else 99) > instrument.price_precision:
            raise _invalid(f"the settlement price {price} of {instrument.id} is not on its price grid "
                                 f"{increment}; neither the price nor the increment may be changed to fit")


def file_name(first: int, last: int) -> str:
    """The engine Catalog's file name for data with ts_init in [first, last]."""
    def stamp(value: int) -> str:
        return datetime.fromtimestamp(value // 1_000_000_000, UTC).strftime("%Y-%m-%dT%H-%M-%S") + \
            f"-{value % 1_000_000_000:09d}Z"
    return f"{stamp(first)}_{stamp(last)}.parquet"


def write_lifecycle_events(catalog, episode: Mapping, start: int, end: int) -> dict:
    """market.write_lifecycle_events: the window's status and close events, written into `catalog` (a
    ParquetDataCatalog) by its own writers.

    Returns {"instrument_close": n, "instrument_status": m}; a type without events writes no file.
    """
    _require_close_status(episode, episode["symbol"])
    status = [_native(event) for event in _window(episode, start, end, "InstrumentStatus")]
    closes = [_native(event) for event in _window(episode, start, end, "InstrumentClose")]
    if status:
        catalog.write_instrument_statuses(status)
    if closes:
        catalog.write_instrument_closes(closes)
    return {"instrument_close": len(closes), "instrument_status": len(status)}
