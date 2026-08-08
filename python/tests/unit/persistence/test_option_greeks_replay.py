import os

import pytest

from vibe_trader.common import DataActor
from vibe_trader.common import DataActorConfig
from vibe_trader.model import ActorId
from vibe_trader.model import GreeksConvention
from vibe_trader.model import InstrumentId
from vibe_trader.model import OptionGreeks
from vibe_trader.persistence import ParquetDataCatalog


_INSTRUMENT_ID = InstrumentId.from_str("BTC-20240329-50000-C.DERIBIT")


def _make_greeks() -> OptionGreeks:
    return OptionGreeks(
        instrument_id=_INSTRUMENT_ID,
        delta=0.55,
        gamma=0.012,
        vega=3.4,
        theta=-1.2,
        rho=0.01,
        mark_iv=0.64,
        bid_iv=None,
        ask_iv=0.66,
        underlying_price=50_000.0,
        open_interest=None,
        ts_event=1,
        ts_init=2,
        convention=GreeksConvention.PRICE_ADJUSTED,
    )


class _GreeksRecorder(DataActor):
    # PyO3 #[new] maps to __new__, so subclasses must not define __init__,
    # and the `received` list is attached to the instance after construction.
    def on_option_greeks(self, greeks: OptionGreeks) -> None:
        self.received.append(greeks)


@pytest.fixture
def catalog(tmp_path) -> ParquetDataCatalog:
    path = str(tmp_path / "catalog")
    os.makedirs(path, exist_ok=True)
    return ParquetDataCatalog(path)


def test_write_and_query_option_greeks_round_trip(catalog: ParquetDataCatalog) -> None:
    # Arrange
    written = _make_greeks()

    # Act
    catalog.write_option_greeks([written])
    loaded = catalog.query_option_greeks()

    # Assert
    assert len(loaded) == 1
    greeks = loaded[0]
    assert isinstance(greeks, OptionGreeks)
    assert greeks.instrument_id == _INSTRUMENT_ID
    assert greeks.delta == 0.55
    assert greeks.gamma == 0.012
    assert greeks.vega == 3.4
    assert greeks.theta == -1.2
    assert greeks.rho == 0.01
    assert greeks.mark_iv == 0.64
    assert greeks.ask_iv == 0.66
    assert greeks.bid_iv is None
    assert greeks.underlying_price == 50_000.0
    assert greeks.open_interest is None
    assert greeks.ts_event == 1
    assert greeks.ts_init == 2
    assert greeks.convention == GreeksConvention.PRICE_ADJUSTED


def test_catalog_loaded_greeks_reach_on_option_greeks(catalog: ParquetDataCatalog) -> None:
    # Arrange: persist, then load back through the non-FFI catalog query path
    catalog.write_option_greeks([_make_greeks()])
    loaded = catalog.query_option_greeks()
    assert len(loaded) == 1

    recorder = _GreeksRecorder(
        DataActorConfig(
            actor_id=ActorId("GREEKS-RECORDER"),
            log_events=False,
            log_commands=False,
        ),
    )
    recorder.received = []

    # Act: a catalog-loaded greeks object is a valid `on_option_greeks` payload
    recorder.on_option_greeks(loaded[0])

    # Assert
    assert len(recorder.received) == 1
    received = recorder.received[0]
    assert received.instrument_id == _INSTRUMENT_ID
    assert received.delta == 0.55
    assert received.bid_iv is None
    assert received.convention == GreeksConvention.PRICE_ADJUSTED
