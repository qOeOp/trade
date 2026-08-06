import pytest

from vibe_trader.indicators import BookImbalanceRatio
from vibe_trader.model import Quantity


@pytest.fixture
def imbalance():
    return BookImbalanceRatio()


def test_name(imbalance: BookImbalanceRatio) -> None:
    assert imbalance.name == "BookImbalanceRatio"


def test_str_repr_returns_expected_string(imbalance: BookImbalanceRatio) -> None:
    # Arrange, Act, Assert
    assert str(imbalance) == "BookImbalanceRatio()"
    assert repr(imbalance) == "BookImbalanceRatio()"


def test_initialized_without_inputs_returns_false(imbalance: BookImbalanceRatio) -> None:
    # Arrange, Act, Assert
    assert not imbalance.initialized


def test_initialized_with_required_inputs(imbalance: BookImbalanceRatio) -> None:
    # Arrange
    imbalance.update(Quantity.from_int(100), Quantity.from_int(100))

    # Act, Assert
    assert imbalance.initialized
    assert imbalance.has_inputs
    assert imbalance.count == 1
    assert imbalance.value == 1.0


def test_reset(imbalance: BookImbalanceRatio) -> None:
    # Arrange
    imbalance.update(Quantity.from_int(100), Quantity.from_int(100))
    imbalance.reset()

    # Act, Assert
    assert not imbalance.initialized
    assert not imbalance.has_inputs
    assert imbalance.count == 0
    assert imbalance.value == 0.0


def test_multiple_inputs_with_bid_imbalance(imbalance: BookImbalanceRatio) -> None:
    # Arrange
    imbalance.update(Quantity.from_int(200), Quantity.from_int(100))
    imbalance.update(Quantity.from_int(200), Quantity.from_int(100))
    imbalance.update(Quantity.from_int(200), Quantity.from_int(100))

    # Act, Assert
    assert imbalance.initialized
    assert imbalance.has_inputs
    assert imbalance.count == 3
    assert imbalance.value == 0.5


def test_multiple_inputs_with_ask_imbalance(imbalance: BookImbalanceRatio) -> None:
    # Arrange
    imbalance.update(Quantity.from_int(100), Quantity.from_int(200))
    imbalance.update(Quantity.from_int(100), Quantity.from_int(200))
    imbalance.update(Quantity.from_int(100), Quantity.from_int(200))

    # Act, Assert
    assert imbalance.initialized
    assert imbalance.has_inputs
    assert imbalance.count == 3
    assert imbalance.value == 0.5
