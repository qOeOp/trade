import pytest

from tests.stubs import TestDataProviderPyo3
from vibe_trader.indicators import VolumeWeightedAveragePrice


def test_handle_bar_uses_typical_price() -> None:
    # Arrange
    indicator = VolumeWeightedAveragePrice()
    bar = TestDataProviderPyo3.bar_5decimal()

    # Act
    indicator.handle_bar(bar)

    # Assert
    assert indicator.has_inputs
    assert indicator.value == pytest.approx(1.0000266666666666)
