import pytest

from tests.stubs import TestDataProviderPyo3
from vibe_trader.indicators import EfficiencyRatio


@pytest.fixture
def er() -> EfficiencyRatio:
    return EfficiencyRatio(10)


def test_er(er: EfficiencyRatio) -> None:
    assert er.name == "EfficiencyRatio"


def test_str_repr_returns_expected_string(er: EfficiencyRatio) -> None:
    # Arrange, Act, Assert
    assert str(er) == "EfficiencyRatio(10)"
    assert repr(er) == "EfficiencyRatio(10)"


def test_period_returns_expected_value(er: EfficiencyRatio) -> None:
    # Arrange, Act, Assert
    assert er.period == 10


def test_initialized_without_inputs_returns_false(er: EfficiencyRatio) -> None:
    # Arrange, Act, Assert
    assert not er.initialized


def test_initialized_with_required_inputs_returns_true(er: EfficiencyRatio) -> None:
    # Arrange, Act
    for _ in range(10):
        er.update_raw(1.00000)

    # Assert
    assert er.initialized


def test_handle_bar_updates_indicator(er: EfficiencyRatio) -> None:
    # Arrange
    er = EfficiencyRatio(10)

    bar = TestDataProviderPyo3.bar_5decimal()

    # Act
    er.handle_bar(bar)

    # Assert
    assert er.has_inputs
    assert er.value == 0


def test_value_with_one_input(er: EfficiencyRatio) -> None:
    # Arrange
    er.update_raw(1.00000)

    # Act, Assert
    assert er.value == 0.0


def test_value_with_efficient_higher_inputs(er: EfficiencyRatio) -> None:
    # Arrange
    initial_price = 1.00000

    # Act
    for _ in range(10):
        initial_price += 0.00001
        er.update_raw(initial_price)

    # Assert
    assert er.value == 1.0


def test_value_with_efficient_lower_inputs(er: EfficiencyRatio) -> None:
    # Arrange
    initial_price = 1.00000

    # Act
    for _ in range(10):
        initial_price -= 0.00001
        er.update_raw(initial_price)

    # Assert
    assert er.value == 1.0


def test_value_with_oscillating_inputs_returns_zero(er: EfficiencyRatio) -> None:
    # Arrange
    er.update_raw(1.00000)
    er.update_raw(1.00010)
    er.update_raw(1.00000)
    er.update_raw(0.99990)
    er.update_raw(1.00000)

    # Act, Assert
    assert er.value == 0.0


def test_value_with_half_oscillating_inputs_returns_zero(er: EfficiencyRatio) -> None:
    # Arrange
    er.update_raw(1.00000)
    er.update_raw(1.00020)
    er.update_raw(1.00010)
    er.update_raw(1.00030)
    er.update_raw(1.00020)

    # Act, Assert
    assert er.value == 0.3333333333333333


def test_value_with_noisy_inputs(er: EfficiencyRatio) -> None:
    # Arrange
    er.update_raw(1.00000)
    er.update_raw(1.00010)
    er.update_raw(1.00008)
    er.update_raw(1.00007)
    er.update_raw(1.00012)
    er.update_raw(1.00005)
    er.update_raw(1.00015)

    # Act, Assert
    assert er.value == 0.42857142857215363


def test_reset_successfully_returns_indicator_to_fresh_state(er: EfficiencyRatio) -> None:
    # Arrange
    for _ in range(10):
        er.update_raw(1.00000)

    # Act
    er.reset()

    # Assert
    assert not er.initialized
    assert er.value == 0
