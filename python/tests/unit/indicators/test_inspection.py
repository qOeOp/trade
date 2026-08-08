import pytest

from vibe_trader.indicators import AdaptiveMovingAverage
from vibe_trader.indicators import DoubleExponentialMovingAverage
from vibe_trader.indicators import ExponentialMovingAverage
from vibe_trader.indicators import HullMovingAverage
from vibe_trader.indicators import SimpleMovingAverage
from vibe_trader.indicators import SpreadAnalyzer
from vibe_trader.indicators import VariableIndexDynamicAverage
from vibe_trader.indicators import WeightedMovingAverage
from vibe_trader.indicators import WilderMovingAverage
from vibe_trader.model import InstrumentId
from vibe_trader.model import PriceType


def test_adaptive_moving_average_inspection_properties() -> None:
    indicator = AdaptiveMovingAverage(
        period_efficiency_ratio=10,
        period_fast=2,
        period_slow=30,
        price_type=PriceType.MID,
    )
    indicator.update_raw(12.5)

    assert indicator.period_efficiency_ratio == 10
    assert indicator.period_fast == 2
    assert indicator.period_slow == 30
    assert indicator.alpha_fast == pytest.approx(2 / 3)
    assert indicator.alpha_slow == pytest.approx(2 / 31)
    assert indicator.alpha_diff == pytest.approx((2 / 3) - (2 / 31))
    assert indicator.price_type == PriceType.MID
    assert indicator.value == 12.5


def test_weighted_moving_average_inspection_properties() -> None:
    indicator = WeightedMovingAverage(
        period=3,
        weights=[0.2, 0.3, 0.5],
        price_type=PriceType.BID,
    )
    indicator.update_raw(12.5)

    assert indicator.price_type == PriceType.BID
    assert indicator.value == 12.5
    assert indicator.weights == [0.2, 0.3, 0.5]


def test_spread_analyzer_instrument_id_readback() -> None:
    instrument_id = InstrumentId.from_str("AUD/USD.SIM")
    indicator = SpreadAnalyzer(instrument_id=instrument_id, capacity=10)

    assert indicator.instrument_id == instrument_id


@pytest.mark.parametrize(
    "indicator_type",
    [
        DoubleExponentialMovingAverage,
        ExponentialMovingAverage,
        HullMovingAverage,
        SimpleMovingAverage,
        VariableIndexDynamicAverage,
        WilderMovingAverage,
    ],
)
def test_moving_average_price_type_readback(indicator_type) -> None:
    indicator = indicator_type(period=10, price_type=PriceType.ASK)

    assert indicator.price_type == PriceType.ASK
