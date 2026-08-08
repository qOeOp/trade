import pytest

from vibe_trader.model import BarType
from vibe_trader.model import ClientId
from vibe_trader.model import InstrumentId
from vibe_trader.model import Quantity
from vibe_trader.model import StrategyId
from vibe_trader.trading import CompositeMarketMakerConfig
from vibe_trader.trading import DeltaNeutralVolConfig
from vibe_trader.trading import EmaCrossConfig
from vibe_trader.trading import GridMarketMakerConfig
from vibe_trader.trading import HurstVpinDirectionalConfig


INSTRUMENT_ID = InstrumentId.from_str("BTCUSDT.BINANCE")
SIGNAL_INSTRUMENT_ID = InstrumentId.from_str("ETHUSDT.BINANCE")
STRATEGY_ID = StrategyId("EXAMPLE-001")
ORDER_ID_TAG = "001"


@pytest.mark.parametrize(
    "config",
    [
        CompositeMarketMakerConfig(
            instrument_id=INSTRUMENT_ID,
            signal_instrument_id=SIGNAL_INSTRUMENT_ID,
            max_position=Quantity.from_str("1"),
            strategy_id=STRATEGY_ID,
            order_id_tag=ORDER_ID_TAG,
        ),
        DeltaNeutralVolConfig(
            option_family="BTC",
            hedge_instrument_id=INSTRUMENT_ID,
            client_id=ClientId("EXEC-001"),
            strategy_id=STRATEGY_ID,
            order_id_tag=ORDER_ID_TAG,
        ),
        EmaCrossConfig(
            instrument_id=INSTRUMENT_ID,
            trade_size=Quantity.from_str("1"),
            strategy_id=STRATEGY_ID,
            order_id_tag=ORDER_ID_TAG,
        ),
        GridMarketMakerConfig(
            instrument_id=INSTRUMENT_ID,
            max_position=Quantity.from_str("1"),
            strategy_id=STRATEGY_ID,
            order_id_tag=ORDER_ID_TAG,
        ),
        HurstVpinDirectionalConfig(
            instrument_id=INSTRUMENT_ID,
            bar_type=BarType.from_str("BTCUSDT.BINANCE-1-MINUTE-LAST-EXTERNAL"),
            trade_size=Quantity.from_str("1"),
            strategy_id=STRATEGY_ID,
            order_id_tag=ORDER_ID_TAG,
        ),
    ],
)
def test_example_strategy_config_base_readback(config) -> None:
    assert config.strategy_id == STRATEGY_ID
    assert config.order_id_tag == ORDER_ID_TAG


def test_delta_neutral_vol_config_iv_param_key_readback() -> None:
    config = DeltaNeutralVolConfig(
        option_family="BTC",
        hedge_instrument_id=INSTRUMENT_ID,
        client_id=ClientId("EXEC-001"),
        iv_param_key="mark_iv",
    )

    assert config.iv_param_key == "mark_iv"
