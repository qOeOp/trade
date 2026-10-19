"""Lifecycle facts (`market.validate_lifecycle`, `market.write_lifecycle_events`, `market.require_native_price`).

A lifecycle manifest (lifecycle.json in the evidence bundle lifecycle-<market commit>) lists each
contract's episodes: its native instrument ID, the listing time and the native InstrumentStatus and
InstrumentClose events taken from the exchange's announcements, with the source files the bundle
holds. The exporter writes the events of the replay window into the contract's Catalog in the
engine's own Arrow layout, so BacktestNode delivers them natively: a PRE_CLOSE status (no new
positions), a CLOSE status (the market closes) and, only when the exchange published a settlement
price, an InstrumentClose of type CONTRACT_EXPIRED that the engine settles at. No price is made up.
"""

from __future__ import annotations

from collections.abc import Mapping
from decimal import Decimal, InvalidOperation
from pathlib import Path, PurePosixPath

import pyarrow as pa
import pyarrow.parquet as pq


FORMAT = "native-lifecycle-v1"
EVENT_TYPES = ("InstrumentStatus", "InstrumentClose")
NAUTILUS_SCALE = 16
EPISODE_FIELDS = ("symbol", "instrument_id", "start_ns", "events", "sources")


class LifecycleInput(ValueError):
    """LIFECYCLE_INPUT: the lifecycle evidence does not hold."""

    code = "LIFECYCLE_INPUT"

    def __init__(self, message: str):
        super().__init__(f"LIFECYCLE_INPUT: {message}")


def _native(event):
    from nautilus_trader.model import InstrumentClose, InstrumentStatus
    if not isinstance(event, Mapping) or event.get("type") not in EVENT_TYPES:
        raise LifecycleInput(f"event {event!r} is not an InstrumentStatus or InstrumentClose dictionary")
    try:
        built = (InstrumentStatus if event["type"] == "InstrumentStatus" else InstrumentClose).from_dict(dict(event))
    except Exception as exc:
        raise LifecycleInput(f"{event['type']} cannot be built natively: {exc}") from exc
    if built.ts_event != built.ts_init or built.ts_event != event.get("ts_event"):
        raise LifecycleInput(f"{event['type']} of {built.instrument_id} has inconsistent clocks")
    if event["type"] == "InstrumentClose":
        try:
            price = Decimal(str(event["close_price"]))
        except (InvalidOperation, KeyError) as exc:
            raise LifecycleInput(f"InstrumentClose of {built.instrument_id} has no exact price") from exc
        if built.close_type.name != "CONTRACT_EXPIRED" or not price.is_finite() or price <= 0:
            raise LifecycleInput(f"InstrumentClose of {built.instrument_id} is not a positive CONTRACT_EXPIRED close")
    return built


def termination(episode: Mapping) -> int | None:
    """The clock of the episode's first InstrumentClose or InstrumentStatus CLOSE; None while it trades."""
    for event in episode["events"]:
        if event["type"] == "InstrumentClose" or event.get("action") == "CLOSE":
            return int(event["ts_event"])
    return None


def validate_lifecycle(body: Mapping, commit: str, files: Mapping[str, bytes]) -> dict[str, list[dict]]:
    """market.validate_lifecycle: {symbol: [episode]} of a manifest bound to the pinned market commit."""
    if not isinstance(body, Mapping) or body.get("format") != FORMAT or body.get("market_commit") != commit:
        raise LifecycleInput(f"the manifest is not {FORMAT} of market commit {commit}")
    episodes = body.get("episodes")
    if not isinstance(episodes, list) or not episodes:
        raise LifecycleInput("the manifest lists no episodes")
    grouped: dict[str, list[dict]] = {}
    ended: set[str] = set()
    for episode in sorted(episodes, key=lambda item: (str(item.get("symbol")), item.get("start_ns") or 0)
                          if isinstance(item, Mapping) else ("", 0)):
        if not isinstance(episode, Mapping) or set(episode) != set(EPISODE_FIELDS):
            raise LifecycleInput(f"an episode does not hold exactly {', '.join(EPISODE_FIELDS)}")
        symbol, instrument_id, start = episode["symbol"], episode["instrument_id"], episode["start_ns"]
        if (not isinstance(symbol, str) or not isinstance(instrument_id, str) or type(start) is not int or start < 0
                or not isinstance(episode["events"], list) or not isinstance(episode["sources"], list)
                or not episode["sources"]):
            raise LifecycleInput(f"the episode of {symbol!r} is malformed or cites no source")
        for source in episode["sources"]:
            if (not isinstance(source, str) or PurePosixPath(source).is_absolute()
                    or ".." in PurePosixPath(source).parts or source not in files):
                raise LifecycleInput(f"{symbol}: source {source!r} is not a relative path held by the bundle")
        if instrument_id in ended:
            raise LifecycleInput(f"{instrument_id} terminated and cannot be reused by a later episode")
        previous = grouped.get(symbol, [])
        if previous and (previous[-1]["instrument_id"] == instrument_id or termination(previous[-1]) is None
                         or start < termination(previous[-1])):
            raise LifecycleInput(f"{symbol}: a relisting needs a new instrument ID after the earlier episode ended")
        clock, terminated = start, None
        for event in episode["events"]:
            built = _native(event)
            if str(built.instrument_id) != instrument_id:
                raise LifecycleInput(f"{symbol}: an event names {built.instrument_id}, not {instrument_id}")
            if built.ts_event < clock:
                raise LifecycleInput(f"{symbol}: event clocks decrease or precede the listing")
            if terminated is not None and built.ts_event > terminated:
                raise LifecycleInput(f"{symbol}: an event follows the termination of {instrument_id}")
            clock = built.ts_event
            if terminated is None and (event["type"] == "InstrumentClose" or built.action.name == "CLOSE"):
                terminated = built.ts_event
        if terminated is not None:
            ended.add(instrument_id)
        grouped.setdefault(symbol, []).append({key: episode[key] for key in EPISODE_FIELDS})
    return grouped


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
            raise LifecycleInput(f"the settlement price {price} of {instrument.id} is not on its price grid "
                                 f"{increment}; neither the price nor the increment may be changed to fit")


def _file_name(first: int, last: int) -> str:
    from market.export import _ns_name
    return _ns_name(first, last)


def write_lifecycle_events(root: Path, episode: Mapping, start: int, end: int, price_precision: int) -> dict:
    """market.write_lifecycle_events: the window's status and close events in the engine's Arrow layout.

    Returns {"instrument_close": n, "instrument_status": m}; a type without events writes no file.
    """
    instrument_id = episode["instrument_id"]
    counts = {"instrument_close": 0, "instrument_status": 0}
    status = [_native(event) for event in _window(episode, start, end, "InstrumentStatus")]
    if status:
        rows = [event.to_dict() for event in status]
        fields = [pa.field("instrument_id", pa.string(), False), pa.field("action", pa.string(), False),
                  pa.field("ts_event", pa.uint64(), False), pa.field("ts_init", pa.uint64(), False),
                  pa.field("reason", pa.string()), pa.field("trading_event", pa.string()),
                  pa.field("is_trading", pa.bool_()), pa.field("is_quoting", pa.bool_()),
                  pa.field("is_short_sell_restricted", pa.bool_())]
        table = pa.table({field.name: pa.array([row[field.name] for row in rows], field.type) for field in fields},
                         schema=pa.schema(fields, metadata={"type": "InstrumentStatus", "instrument_id": instrument_id}))
        directory = root / "data" / "instrument_status" / instrument_id
        directory.mkdir(parents=True, exist_ok=True)
        pq.write_table(table, directory / _file_name(status[0].ts_event, status[-1].ts_event), compression="snappy")
        counts["instrument_status"] = len(status)
    closes = [_native(event) for event in _window(episode, start, end, "InstrumentClose")]
    if closes:
        raws = []
        for event in closes:
            raw = int(event.close_price.as_decimal().scaleb(NAUTILUS_SCALE))
            raws.append(raw.to_bytes(16, "little", signed=True))
        fields = [pa.field("close_price", pa.binary(16), False), pa.field("close_type", pa.uint8(), False),
                  pa.field("ts_event", pa.uint64(), False), pa.field("ts_init", pa.uint64(), False)]
        table = pa.table({"close_price": pa.array(raws, pa.binary(16)),
                          "close_type": pa.array([int(event.close_type.value) for event in closes], pa.uint8()),
                          "ts_event": pa.array([event.ts_event for event in closes], pa.uint64()),
                          "ts_init": pa.array([event.ts_init for event in closes], pa.uint64())},
                         schema=pa.schema(fields, metadata={"instrument_id": instrument_id,
                                                            "price_precision": str(price_precision)}))
        directory = root / "data" / "instrument_closes" / instrument_id
        directory.mkdir(parents=True, exist_ok=True)
        pq.write_table(table, directory / _file_name(closes[0].ts_event, closes[-1].ts_event), compression="snappy")
        counts["instrument_close"] = len(closes)
    return counts
