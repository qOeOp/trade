"""
Prepare an R-1 catalog through Nautilus's public Binance USD-M data client.

No exchange execution client or credentials are configured. The public adapter loads the
contract definition and serves historical LAST and MARK execution bars and settled
funding. The actor writes native data objects into ParquetDataCatalog without a CSV/REST
parser.

"""

from __future__ import annotations

import argparse
import asyncio
import json
from datetime import UTC
from datetime import datetime
from datetime import timedelta
from itertools import pairwise
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
from vibe_trading.model import FundingRateUpdate
from vibe_trading.model import InstrumentId
from vibe_trading.model import TraderId
from vibe_trading.persistence import ParquetDataCatalog


class DownloadConfig(DataActorConfig):
    def __new__(cls, *args, **kwargs):
        for key in (
            "instrument",
            "catalog",
            "start_ns",
            "end_ns",
            "complete_file",
            "resume_funding",
            "daily_only",
            "initial_counts",
            "bar_minutes",
            "request_pause_ms",
        ):
            kwargs.pop(key, None)
        return super().__new__(cls, *args, **kwargs)

    def __init__(
        self,
        instrument: str,
        catalog: str,
        start_ns: int,
        end_ns: int,
        complete_file: str,
        resume_funding: bool = False,
        daily_only: bool = False,
        initial_counts: dict | None = None,
        bar_minutes: int = 1,
        request_pause_ms: int = 0,
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
        self.resume_funding = resume_funding
        self.daily_only = daily_only
        self.initial_counts = initial_counts or {"last": 0, "mark": 0, "funding": 0}
        self.bar_minutes = int(bar_minutes)
        self.request_pause_ms = int(request_pause_ms)


class DownloadActor(DataActor):
    def __init__(self, config: DownloadConfig):
        super().__init__(config)
        self.bar_types = {
            "last": BarType.from_str(
                f"{config.instrument}-{config.bar_minutes}-MINUTE-LAST-EXTERNAL",
            ),
            "mark": BarType.from_str(
                f"{config.instrument}-{config.bar_minutes}-MINUTE-MARK-EXTERNAL",
            ),
            "daily": BarType.from_str(f"{config.instrument}-1-DAY-LAST-EXTERNAL"),
        }
        self.instrument_id = InstrumentId.from_str(config.instrument)
        self.catalog = ParquetDataCatalog(config.catalog)
        self.phase = (
            "daily" if config.daily_only else "funding" if config.resume_funding else "last"
        )
        self.next_ns = config.start_ns
        self.counts = dict(config.initial_counts)

    def on_start(self) -> None:
        self._request()

    def _request_next(self) -> None:
        if self.config.request_pause_ms:
            self.clock.set_time_alert(
                "next-historical-request",
                self.clock.utc_now() + timedelta(milliseconds=self.config.request_pause_ms),
                callback=lambda _: self._request(),
            )
        else:
            self._request()

    def _request(self) -> None:
        if self.next_ns >= self.config.end_ns:
            if self.phase == "last":
                self.phase = "mark"
                self.next_ns = self.config.start_ns
                self._request()
                return
            if self.phase == "mark":
                self.phase = "funding"
                self.next_ns = self.config.start_ns
                self._request()
                return
            self._complete()
            return
        start = datetime.fromtimestamp(self.next_ns / 1e9, UTC)
        if self.phase == "funding":
            self.request_funding_rates(
                self.instrument_id,
                start=start,
                end=datetime.fromtimestamp(self.config.end_ns / 1e9, UTC),
                limit=1000,
                client_id=ClientId("BINANCE"),
            )
            return
        bar_interval_ns = (
            86_400_000_000_000
            if self.phase == "daily"
            else self.config.bar_minutes * 60_000_000_000
        )
        end_ns = min(self.next_ns + 1_500 * bar_interval_ns, self.config.end_ns)
        end = datetime.fromtimestamp(end_ns / 1e9, UTC)
        self.request_bars(
            self.bar_types[self.phase],
            start=start,
            end=end,
            limit=1500,
            client_id=ClientId("BINANCE"),
        )

    def on_historical_bars(self, bars) -> None:
        bar_type = self.bar_types[self.phase]
        bars = sorted(
            (bar for bar in bars if bar.bar_type == bar_type),
            key=lambda bar: bar.ts_event,
        )
        bars = [bar for bar in bars if self.next_ns <= bar.ts_event < self.config.end_ns]
        if not bars:
            if self.phase == "daily":
                # A contract may have listed after the requested historical
                # start. Advance across empty pre-listing intervals and keep
                # requesting native daily bars until data begins or the
                # requested period is exhausted.
                self.next_ns = min(
                    self.next_ns + 1_500 * 86_400_000_000_000,
                    self.config.end_ns,
                )
                self._request_next()
            else:
                self.shutdown_system(f"no Binance bars returned from {self.next_ns}")
            return
        self.catalog.write_bars(bars)
        self.counts[self.phase] += len(bars)
        # Binance stamps klines at interval close minus 1 ms. Advance to the
        # next exact boundary so the final response completes the range.
        self.next_ns = bars[-1].ts_event + 1_000_000
        self._request_next()

    def on_historical_funding_rates(self, rates) -> None:
        if self.phase != "funding":
            raise RuntimeError("unexpected funding response")
        rows = sorted(
            (rate for rate in rates if self.next_ns <= rate.ts_event < self.config.end_ns),
            key=lambda rate: rate.ts_event,
        )
        if not rows:
            self._complete()
            return
        if any(b.ts_event <= a.ts_event for a, b in pairwise(rows)):
            raise RuntimeError("duplicate or unordered funding settlements")
        # The historical API returns settled rows. Bind each rate to its own
        # settlement time so Nautilus's funding timer charges open positions.
        settled = [
            FundingRateUpdate(
                instrument_id=self.instrument_id,
                rate=rate.rate,
                ts_event=rate.ts_event,
                ts_init=rate.ts_event,
                next_funding_ns=rate.ts_event,
            )
            for rate in rows
        ]
        self.catalog.write_funding_rate_updates(settled)
        self.counts["funding"] += len(settled)
        self.next_ns = settled[-1].ts_event + 1_000_000
        if len(rates) < 1000:
            self._complete()
        else:
            self._request_next()

    def _complete(self) -> None:
        if not all(self.counts.values()):
            self.shutdown_system(f"incomplete Binance inputs: {self.counts}")
            return
        Path(self.config.complete_file).write_text(
            json.dumps(
                {
                    "instrument": str(self.instrument_id),
                    "start_ns": self.config.start_ns,
                    "end_ns": self.config.end_ns,
                    "bar_minutes": self.config.bar_minutes,
                    "counts": self.counts,
                },
            )
            + "\n",
        )
        self.shutdown_system("R-1 historical data complete")


def main() -> None:  # noqa: C901 - CLI coordinates one frozen native download lifecycle.
    parser = argparse.ArgumentParser()
    parser.add_argument("--catalog", type=Path, required=True)
    parser.add_argument("--instrument", default="BTCUSDT-PERP.BINANCE")
    parser.add_argument("--start", required=True)
    parser.add_argument("--end", required=True)
    parser.add_argument("--bar-minutes", type=int, choices=(1, 5), default=1)
    parser.add_argument("--request-pause-ms", type=int, default=0)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--resume-funding", action="store_true")
    mode.add_argument("--daily-only", action="store_true")
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
    required_days = 200 if args.daily_only else 30
    if end_ns - start_ns < required_days * 86_400_000_000_000:
        raise ValueError(f"R-1 needs at least {required_days} days of native history")
    if not args.daily_only and (
        start_ns % (args.bar_minutes * 60_000_000_000)
        or end_ns % (args.bar_minutes * 60_000_000_000)
    ):
        raise ValueError("execution interval must align with bar boundaries")
    if not 0 <= args.request_pause_ms <= 60_000:
        raise ValueError("request-pause-ms must be between 0 and 60000")
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
    catalog = ParquetDataCatalog(str(args.catalog))
    initial_counts = {"daily": 0} if args.daily_only else {"last": 0, "mark": 0, "funding": 0}
    if args.resume_funding:
        if not (args.catalog / "instrument-assumption.json").exists():
            raise RuntimeError("cannot resume without frozen instrument assumption")
        if catalog.query_funding_rate_updates(
            [args.instrument],
            start=start_ns,
            end=end_ns - 1,
        ):
            raise RuntimeError(
                "cannot resume funding into a catalog with existing settlements",
            )
        bars = catalog.query_bars([args.instrument], start=start_ns, end=end_ns)
        interval_ns = args.bar_minutes * 60_000_000_000
        expected = (end_ns - start_ns) // interval_ns
        for price_type, key in (("LAST", "last"), ("MARK", "mark")):
            bar_type = BarType.from_str(
                f"{args.instrument}-{args.bar_minutes}-MINUTE-{price_type}-EXTERNAL",
            )
            series = sorted(
                (bar for bar in bars if bar.bar_type == bar_type),
                key=lambda bar: bar.ts_event,
            )
            if (
                len(series) != expected
                or series[0].ts_event != start_ns + interval_ns - 1_000_000
                or series[-1].ts_event != end_ns - 1_000_000
                or any(b.ts_event - a.ts_event != interval_ns for a, b in pairwise(series))
            ):
                raise RuntimeError(f"cannot resume: incomplete {key} minute coverage")
            initial_counts[key] = len(series)
    else:
        instruments = asyncio.run(load_binance_instruments(data_config))
        instrument = next(
            (item for item in instruments if item.id == instrument_id),
            None,
        )
        if instrument is None:
            raise RuntimeError(f"Binance public adapter did not return {instrument_id}")
        catalog.write_instruments([instrument])
        (args.catalog / "instrument-assumption.json").write_text(
            json.dumps(
                {
                    "instrument": args.instrument,
                    "source": "Binance current public exchangeInfo via native instrument provider",
                    "fetched_at_utc": datetime.now(UTC).isoformat(),
                    "historical_terms": "CURRENT_SNAPSHOT_APPROXIMATION",
                },
                indent=2,
            )
            + "\n",
        )

    complete_file = args.catalog / (
        "r1-daily-download-complete.json" if args.daily_only else "r1-download-complete.json"
    )
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
                "resume_funding": args.resume_funding,
                "daily_only": args.daily_only,
                "initial_counts": initial_counts,
                "bar_minutes": args.bar_minutes,
                "request_pause_ms": args.request_pause_ms,
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
