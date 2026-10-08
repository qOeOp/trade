"""Validate the prepared R1 Catalog inputs shared by native replay runners."""

import json
from datetime import datetime
from itertools import pairwise
from pathlib import Path

import pyarrow.parquet as parquet
from nautilus_trader.model import BarType, InstrumentId
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


def warmup_daily_bars(
    daily_root: Path,
    coin: str,
    instrument_id: InstrumentId,
    start: int,
):
    path = daily_root / coin / "daily"
    completion = json.loads((path / "r1-daily-download-complete.json").read_text())
    if (
        completion.get("instrument") != str(instrument_id)
        or completion.get("end_ns", 0) < start
    ):
        raise RuntimeError(f"{coin}: daily warmup identity does not cover replay")
    catalog = ParquetDataCatalog(str(path))
    bar_type = BarType.from_str(f"{instrument_id}-1-DAY-LAST-EXTERNAL")
    bars = sorted(
        (
            bar
            for bar in catalog.query_bars([str(instrument_id)])
            if bar.bar_type == bar_type and bar.ts_event < start
        ),
        key=lambda bar: bar.ts_event,
    )
    if (
        len(bars) < 200
        or bars[-1].ts_event != start - 1_000_000
        or any(b.ts_event - a.ts_event != 86_400_000_000_000 for a, b in pairwise(bars))
    ):
        raise RuntimeError(f"{coin}: daily warmup is not contiguous")
    return bars


def validate_funding_receipt(row: dict, start: int, end: int) -> None:
    """Audit legacy event coverage; BacktestNode itself loads the native data."""
    files = row["catalog"].query_files(
        "funding_rate_update",
        identifiers=[str(row["instrument_id"])],
    )
    timestamps = []
    for relative_path in files:
        table = parquet.read_table(
            row["catalog_path"] / relative_path,
            columns=["ts_event", "next_funding_ns"],
        )
        for event, settlement in zip(
            table["ts_event"].to_pylist(),
            table["next_funding_ns"].to_pylist(),
            strict=True,
        ):
            if event != settlement:
                raise RuntimeError(
                    f"{row['coin']}: funding settlement timestamp mismatch"
                )
            if start <= event < end:
                timestamps.append(event)
    timestamps.sort()
    if (
        len(timestamps) != row["completion"]["counts"]["funding"]
        or not timestamps
        or any(
            b - a > 8 * 3_600_000_000_000 + 1_000_000_000
            for a, b in pairwise(timestamps)
        )
    ):
        raise RuntimeError(f"{row['coin']}: funding settlement coverage mismatch")
