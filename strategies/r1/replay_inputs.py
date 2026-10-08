"""Validate the prepared R1 Catalog inputs shared by native replay runners."""

import json
from datetime import datetime
from pathlib import Path

from nautilus_trader.model import InstrumentId
from nautilus_trader.persistence import ParquetDataCatalog


def month_edges(start: datetime, end: datetime):
    current = start
    while current < end:
        next_month = (
            current.replace(year=current.year + 1, month=1, day=1)
            if current.month == 12
            else current.replace(month=current.month + 1, day=1)
        )
        edge = min(next_month, end)
        yield current, edge
        current = edge


def read_instruments(
    root: Path,
    coins: list[str],
    quantities: dict[str, str],
    start: int,
    end: int,
):
    rows = []
    for coin in coins:
        catalog_path = root / coin / "minute"
        catalog = ParquetDataCatalog(str(catalog_path))
        completion = json.loads(
            (catalog_path / "r1-download-complete.json").read_text()
        )
        if (
            completion.get("start_ns"),
            completion.get("end_ns"),
            completion.get("bar_minutes"),
        ) != (start, end, 5):
            raise RuntimeError(
                f"{coin}: prepared minute interval does not match replay"
            )
        instrument_id = InstrumentId.from_str(completion["instrument"])
        instruments = catalog.instruments(instrument_ids=[str(instrument_id)])
        if len(instruments) != 1 or instruments[0].quote_currency.code != "USDT":
            raise RuntimeError(f"{coin}: one Binance USDT instrument is required")
        assumption = json.loads(
            (catalog_path / "instrument-assumption.json").read_text()
        )
        if assumption.get("historical_terms") != "CURRENT_SNAPSHOT_APPROXIMATION":
            raise RuntimeError(f"{coin}: missing historical instrument assumption")
        rows.append(
            {
                "coin": coin,
                "catalog": catalog,
                "catalog_path": catalog_path,
                "completion": completion,
                "instrument": instruments[0],
                "instrument_id": instrument_id,
                "quantity": quantities[coin],
                "counts": {"last": 0, "mark": 0, "funding": 0},
                "previous_last": None,
                "previous_mark": None,
                "previous_funding": None,
            }
        )
    return rows
