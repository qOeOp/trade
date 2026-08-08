#!/usr/bin/env python3
import asyncio
import datetime
import os

from vibe_trader.adapters.interactive_brokers.common import IBContract
from vibe_trader.adapters.interactive_brokers.config import DockerizedIBGatewayConfig
from vibe_trader.adapters.interactive_brokers.gateway import DockerizedIBGateway
from vibe_trader.adapters.interactive_brokers.historical import HistoricInteractiveBrokersClient
from vibe_trader.core.correctness import PyCondition
from vibe_trader.examples.interactive_brokers import resolve_ib_endpoint
from vibe_trader.persistence.catalog import ParquetDataCatalog


async def main(
    host: str | None = None,
    port: int | None = None,
    dockerized_gateway: DockerizedIBGatewayConfig | None = None,
) -> None:
    if dockerized_gateway:
        PyCondition.none(host, "Ensure `host` is set to None when using DockerizedIBGatewayConfig.")
        PyCondition.none(port, "Ensure `port` is set to None when using DockerizedIBGatewayConfig.")
        PyCondition.type(dockerized_gateway, DockerizedIBGatewayConfig, "dockerized_gateway")
        gateway = DockerizedIBGateway(config=dockerized_gateway)
        gateway.start(dockerized_gateway.timeout)
        host = gateway.host
        port = gateway.port
    else:
        gateway = None
        default_host, default_port = resolve_ib_endpoint("IB_EXAMPLE_HOST", "IB_EXAMPLE_PORT")
        host = host or default_host
        port = port or default_port
        PyCondition.not_none(
            host,
            "Please provide the `host` IP address for the IB TWS or Gateway.",
        )
        PyCondition.not_none(port, "Please provide the `port` for the IB TWS or Gateway.")

    contract = IBContract(
        secType="STK",
        symbol="AAPL",
        exchange="SMART",
        primaryExchange="NASDAQ",
    )
    instrument_id = "TSLA.NASDAQ"

    client = HistoricInteractiveBrokersClient(host=host, port=port, client_id=5)
    await client.connect()
    await asyncio.sleep(2)

    instruments = await client.request_instruments(
        contracts=[contract],
        instrument_ids=[instrument_id],
    )

    bars = await client.request_bars(
        bar_specifications=["1-HOUR-LAST", "30-MINUTE-MID"],
        start_date_time=datetime.datetime(2025, 11, 6, 9, 30),
        end_date_time=datetime.datetime(2025, 11, 6, 16, 30),
        tz_name="America/New_York",
        contracts=[contract],
        instrument_ids=[instrument_id],
    )

    trade_ticks = await client.request_ticks(
        tick_type="TRADES",
        start_date_time=datetime.datetime(2025, 11, 6, 10, 0),
        end_date_time=datetime.datetime(2025, 11, 6, 10, 1),
        tz_name="America/New_York",
        contracts=[contract],
        instrument_ids=[instrument_id],
    )

    quote_ticks = await client.request_ticks(
        tick_type="BID_ASK",
        start_date_time=datetime.datetime(2025, 11, 6, 10, 0),
        end_date_time=datetime.datetime(2025, 11, 6, 10, 1),
        tz_name="America/New_York",
        contracts=[contract],
        instrument_ids=[instrument_id],
    )

    if gateway:
        gateway.stop()

    catalog = ParquetDataCatalog("./catalog")
    catalog.write_data(instruments)
    catalog.write_data(bars)
    catalog.write_data(trade_ticks)
    catalog.write_data(quote_ticks)


if __name__ == "__main__":
    use_dockerized_gateway = os.getenv("IB_EXAMPLE_USE_DOCKERIZED_GATEWAY", "0") == "1"

    if use_dockerized_gateway and os.getenv("TWS_USERNAME") and os.getenv("TWS_PASSWORD"):
        gateway_config = DockerizedIBGatewayConfig(
            username=os.environ["TWS_USERNAME"],
            password=os.environ["TWS_PASSWORD"],
            trading_mode="paper",
        )
        asyncio.run(main(dockerized_gateway=gateway_config))
    else:
        asyncio.run(main())

    # To connect to an existing TWS or Gateway instance without the use of automated dockerized gateway,
    # follow this format:
    # asyncio.run(main(host="127.0.0.1", port=7497))
