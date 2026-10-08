"""
Decode the existing funding Parquet rows into upstream Nautilus data objects.

Upstream 2.0.0rc3 reads the shared instrument and bar Catalog files but lacks this
fork's funding query binding. Nautilus still performs the settlement.

"""

from pathlib import Path

import pyarrow.parquet as parquet
from nautilus_trader.model import FundingRateUpdate
from nautilus_trader.model import InstrumentId


def query_funding_rate_updates(
    catalog_path: Path,
    instrument_ids: list[str],
    start: int | None = None,
    end: int | None = None,
) -> list[FundingRateUpdate]:
    updates = []
    for instrument in instrument_ids:
        folder = catalog_path / "data" / "funding_rate_update" / instrument
        files = sorted(folder.glob("*.parquet"))
        if not files:
            raise FileNotFoundError(f"funding data missing for {instrument}: {folder}")
        for file in files:
            for row in parquet.read_table(file).to_pylist():
                ts_event = row["ts_event"]
                if start is not None and ts_event < start:
                    continue
                if end is not None and ts_event > end:
                    continue
                if row["instrument_id"] != instrument:
                    raise ValueError(f"funding instrument mismatch in {file}")
                updates.append(
                    FundingRateUpdate(
                        instrument_id=InstrumentId.from_str(instrument),
                        rate=row["rate"],
                        interval=row["interval"],
                        next_funding_ns=row["next_funding_ns"],
                        ts_event=ts_event,
                        ts_init=row["ts_init"],
                    ),
                )
    return sorted(updates, key=lambda update: update.ts_event)
