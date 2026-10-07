"""
Prepare an R-1 catalog through Nautilus's public Binance USD-M data client.

No exchange execution client or credentials are configured. The public adapter loads the
contract definition and serves historical 1-minute bars; the actor writes returned Bar
objects into ParquetDataCatalog without a CSV/REST parser.

"""

from __future__ import annotations

import argparse
import asyncio
import json
from datetime import UTC
from datetime import datetime
from pathlib import Path

from vibe_trading.adapters.binance import BinanceDataClientConfig
from vibe_trading.adapters.binance import BinanceDataClientFactory
from vibe_trading.adapters.binance import BinanceEnvironment
from vibe_trading.adapters.binance import BinanceInstrumentProviderConfig
from vibe_trading.adapters.binance import BinanceProductType
from vibe_trading.adapters.binance import load_binance_instruments
from vibe_trading.common import DataActor
from vibe_trading.common import DataActorConfig
from vibe_trading.common import Environment
from vibe_trading.common import ImportableActorConfig
from vibe_trading.live import LiveNode
from vibe_trading.model import BarType
from vibe_trading.model import ClientId
from vibe_trading.model import InstrumentId
from vibe_trading.model import TraderId
from vibe_trading.persistence import ParquetDataCatalog


class DownloadConfig(DataActorConfig):
    def __new__(cls, *args, **kwargs):
        for key in ("instrument", "catalog", "start_ns", "end_ns", "complete_file"):
            kwargs.pop(key, None)
        return super().__new__(cls, *args, **kwargs)

    def __init__(
        self,
        instrument: str,
        catalog: str,
        start_ns: int,
        end_ns: int,
        complete_file: str,
        **kwargs,
    ):
        self.actor_id = kwargs.get("actor_id")
        self.log_events = kwargs.get("log_events", True)
        self.log_commands = kwargs.get("log_commands", True)
        self.instrument = instrument
        self.catalog = catalog
        self.start_ns = int(start_ns)
        self.end_ns = int(end_ns)
        self.complete_file = complete_file


class DownloadActor(DataActor):
    def __init__(self, config: DownloadConfig):
        super().__init__(config)
        self.bar_type = BarType.from_str(f"{config.instrument}-1-MINUTE-LAST-EXTERNAL")
        self.catalog = ParquetDataCatalog(config.catalog)
        self.next_ns = config.start_ns
        self.count = 0

    def on_start(self) -> None:
        self._request()

    def _request(self) -> None:
        if self.next_ns >= self.config.end_ns:
            Path(self.config.complete_file).write_text(
                json.dumps({"bars": self.count, "last_ns": self.next_ns}) + "\n",
            )
            self.shutdown_system("R-1 historical data complete")
            return
        start = datetime.fromtimestamp(self.next_ns / 1e9, UTC)
        end_ns = min(self.next_ns + 1_500 * 60_000_000_000, self.config.end_ns)
        end = datetime.fromtimestamp(end_ns / 1e9, UTC)
        self.request_bars(
            self.bar_type,
            start=start,
            end=end,
            limit=1500,
            client_id=ClientId("BINANCE"),
        )

    def on_historical_bars(self, bars) -> None:
        bars = sorted(
            (bar for bar in bars if bar.bar_type == self.bar_type),
            key=lambda bar: bar.ts_event,
        )
        bars = [bar for bar in bars if self.next_ns <= bar.ts_event < self.config.end_ns]
        if not bars:
            raise RuntimeError(f"no Binance bars returned from {self.next_ns}")
        if bars[-1].ts_event < self.next_ns:
            raise RuntimeError("historical response did not advance")
        self.catalog.write_bars(bars)
        self.count += len(bars)
        # Binance stamps a 1-minute kline at close minus 1 ms. Advance to the
        # next exact minute boundary so the final response completes the range.
        self.next_ns = bars[-1].ts_event + 1_000_000
        self._request()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--catalog", type=Path, required=True)
    parser.add_argument("--instrument", default="BTCUSDT-PERP.BINANCE")
    parser.add_argument("--start", required=True)
    parser.add_argument("--end", required=True)
    args = parser.parse_args()
    instrument_id = InstrumentId.from_str(args.instrument)
    if not args.instrument.endswith("USDT-PERP.BINANCE"):
        raise ValueError("R-1 preparation requires a Binance USDT perpetual")
    start_ns = int(
        datetime.fromisoformat(args.start).timestamp() * 1e9,
    )
    end_ns = int(
        datetime.fromisoformat(args.end).timestamp() * 1e9,
    )
    if end_ns - start_ns < 30 * 86_400_000_000_000:
        raise ValueError("R-1 needs at least 30 days of native minute history")
    args.catalog.mkdir(parents=True, exist_ok=True)
    provider = BinanceInstrumentProviderConfig(
        load_all=False,
        load_ids=[args.instrument],
    )
    data_config = BinanceDataClientConfig(
        product_type=BinanceProductType.USD_M,
        environment=BinanceEnvironment.LIVE,
        instrument_provider=provider,
    )
    instruments = asyncio.run(load_binance_instruments(data_config))
    instrument = next((item for item in instruments if item.id == instrument_id), None)
    if instrument is None:
        raise RuntimeError(f"Binance public adapter did not return {instrument_id}")
    ParquetDataCatalog(str(args.catalog)).write_instruments([instrument])

    complete_file = args.catalog / "r1-download-complete.json"
    complete_file.unlink(missing_ok=True)
    node = (
        LiveNode.builder(
            "R1-HISTORICAL-DATA-001",
            TraderId("R1-DATA-001"),
            Environment.LIVE,
        )
        .add_data_client(None, BinanceDataClientFactory(), data_config)
        .build()
    )
    node.add_actor_from_config(
        ImportableActorConfig(
            actor_path="prepare:DownloadActor",
            config_path="prepare:DownloadConfig",
            config={
                "instrument": args.instrument,
                "catalog": str(args.catalog),
                "start_ns": start_ns,
                "end_ns": end_ns,
                "complete_file": str(complete_file),
                "log_commands": False,
                "log_events": False,
            },
        ),
    )
    try:
        node.run()
    finally:
        node.dispose()
    if not complete_file.exists():
        raise RuntimeError("native Binance history request ended before completion")
    print(complete_file.read_text())


if __name__ == "__main__":
    main()
