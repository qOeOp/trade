#!/usr/bin/env python3
from __future__ import annotations

import asyncio

from _common import default_stock_contracts
from _common import env_int
from _common import instrument_provider_config
from _common import resolve_ib_endpoint

from vibe_trader.adapters import interactive_brokers


async def main() -> None:
    ib = interactive_brokers
    host, port = resolve_ib_endpoint()
    provider_config = instrument_provider_config()
    provider = ib.InteractiveBrokersInstrumentProvider(provider_config)
    client = ib.HistoricalInteractiveBrokersClient(
        provider,
        ib.InteractiveBrokersDataClientConfig(
            host=host,
            port=port,
            client_id=env_int("IB_V2_CONTRACT_CLIENT_ID", 181),
            connection_timeout=env_int("IB_V2_CONNECTION_TIMEOUT", 10),
            request_timeout=env_int("IB_V2_REQUEST_TIMEOUT", 30),
            instrument_provider=provider_config,
        ),
    )

    print("Requesting contracts...", flush=True)
    instruments = await client.request_instruments(contracts=default_stock_contracts())
    print(f"Loaded {len(instruments)} instrument(s)", flush=True)
    for instrument in instruments:
        print(instrument.id, flush=True)


if __name__ == "__main__":
    asyncio.run(main())
