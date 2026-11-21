"""What Paper's and Live's native nodes share: the replay's data engine, the warm-up Catalog, the Binance USD-M
public data client, and the market rows each records for its comparison with a replay (Paper in its journal, Live in
its evidence pack). Each side adds its own cache, execution client, risk engine and actors."""
from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Callable

from nautilus_trader.adapters.binance import (
    BinanceDataClientConfig, BinanceDataClientFactory, BinanceEnvironment, BinanceInstrumentProviderConfig,
    BinanceProductType,
)
from nautilus_trader.common import Environment, LoggerConfig, LogLevel
from nautilus_trader.live import LiveDataEngineConfig, LiveNode, LiveNodeConfig
from nautilus_trader.model import FundingRateUpdate, TraderId
from nautilus_trader.persistence import DataCatalogConfig

from engine import history, metrics
from engine.config import ACCOUNT_CONTRACT


def node_base(name: str, trader_id: str, environment: Environment, catalog: Path | None, instrument_ids: list[str],
              proxy_url: str | None, binance: BinanceEnvironment = BinanceEnvironment.LIVE):
    """A LiveNode builder with the data engine a replay builds (ACCOUNT_CONTRACT), the run's Catalog when given (the
    warm-ups are requested from it, which they fill at T: engine.history), warnings-only logging and the public data
    client of `instrument_ids` in the `binance` environment, reached through `proxy_url`."""
    account = ACCOUNT_CONTRACT
    data = LiveDataEngineConfig(
        time_bars_timestamp_on_close=account["time_bars_timestamp_on_close"],
        time_bars_skip_first_non_full_bar=account["time_bars_skip_first_non_full_bar"],
        validate_data_sequence=account["validate_data_sequence"], time_bars_build_delay=history.BUILD_DELAY_US)
    builder = LiveNode.builder(name, TraderId(trader_id), environment)
    if catalog is not None:
        builder = builder.from_config(name, LiveNodeConfig(environment=environment, trader_id=TraderId(trader_id),
                                                           data_engine=data,
                                                           catalogs=[DataCatalogConfig(path=str(catalog))]))
    builder.with_logging(LoggerConfig(stdout_level=LogLevel.WARNING, print_config=False))
    builder.with_data_engine_config(data)
    builder.add_data_client(account["venue"], BinanceDataClientFactory(), BinanceDataClientConfig(
        product_type=BinanceProductType.USD_M, environment=binance, proxy_url=proxy_url,
        instrument_provider=BinanceInstrumentProviderConfig(load_all=False, load_ids=instrument_ids)))
    return builder


MINUTE_BAR = "1-MINUTE-LAST-EXTERNAL"


def warmup_digest(history_rows: list) -> dict:
    """A history the source received (engine.history), as a `warmup` row records it: bars, or funding settlements
    (`bars` then counts the settlements), in the order they were delivered."""
    text = "\n".join(f"{item.ts_event},{item.rate}" if isinstance(item, FundingRateUpdate) else
                     f"{item.ts_event},{item.open},{item.high},{item.low},{item.close},{item.volume}"
                     for item in history_rows)
    return {"bars": len(history_rows), "first_ts_event": history_rows[0].ts_event if history_rows else None,
            "last_ts_event": history_rows[-1].ts_event if history_rows else None,
            "sha256": hashlib.sha256(text.encode()).hexdigest()}


class MarketRows:
    """The market rows a run records for replay.comparison, one format for Paper's journal and Live's evidence pack.
    `write(kind, **fields)` appends one row; the writer stamps its `wall_ns`.

    - ``bar``: a one-minute bar (MINUTE_BAR) as it arrived; other bar types are aggregated from it and not recorded.
    - ``warmup``: per contract and period, the digest of the history the source received at its warm-up's T
      (warmup_digest; period FUNDING for the funding settlements).
    - ``metrics``: an open interest and long/short ratio row the source was handed (engine.metrics), values as text or
      null; ``metrics_unsubscribed``: the source stopped following a contract's metrics.
    - ``kline_event``: Binance's event time of a closed one-minute kline; ``kline_socket``: the side connection's state
      (engine.kline_events)."""

    def __init__(self, write: Callable[..., None]):
        self._write = write

    def bar(self, bar) -> None:
        iid = str(bar.bar_type.instrument_id)
        if str(bar.bar_type) == f"{iid}-{MINUTE_BAR}":
            self._write("bar", instrument_id=iid, ts_event=bar.ts_event, ts_init=bar.ts_init, open=str(bar.open),
                        high=str(bar.high), low=str(bar.low), close=str(bar.close), volume=str(bar.volume))

    def warmup(self, instrument_id, delivered: dict[str, list]) -> None:
        for period, history_rows in delivered.items():
            self._write("warmup", instrument_id=str(instrument_id), period=period, **warmup_digest(history_rows))

    def metrics(self, row) -> None:
        self._write("metrics", instrument_id=str(row.instrument_id), ts_event=row.ts_event,
                    **{name: None if (value := getattr(row, name)) is None else str(value)
                       for name in metrics.ENDPOINTS})

    def metrics_unsubscribed(self, instrument_id) -> None:
        self._write("metrics_unsubscribed", instrument_id=str(instrument_id))

    def kline_events(self, klines) -> None:
        """The side connection's state changes and closed klines' event times `klines` (engine.kline_events.
        KlineEvents) read since the last call."""
        for state, at, reason in klines.drain_states():
            self._write("kline_socket", state=state, at_ns=at, **({"reason": reason} if reason else {}))
        for iid, close, sent in klines.drain():
            self._write("kline_event", instrument_id=iid, ts_event=close, event_ns=sent)
