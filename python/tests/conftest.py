import sys
from pathlib import Path

import pytest

from vibe_trader.common import LogLevel
from vibe_trader.common import init_logging
from vibe_trader.core import UUID4
from vibe_trader.model import AccountId
from vibe_trader.model import Currency
from vibe_trader.model import InstrumentId
from vibe_trader.model import StrategyId
from vibe_trader.model import TraderId
from vibe_trader.model import Venue


# Add tests/ to sys.path so test strategies are importable by the engine
_TESTS_DIR = Path(__file__).resolve().parent
if str(_TESTS_DIR) not in sys.path:
    sys.path.insert(0, str(_TESTS_DIR))


@pytest.fixture(scope="session", autouse=True)
def bypass_logging():
    """
    Fixture to bypass logging for all tests.

    `autouse=True` will mean this function is run prior to every test. To disable this
    to debug specific tests, simply comment this out.

    """
    guard = init_logging(
        trader_id=TraderId("TESTER-000"),
        instance_id=UUID4(),
        level_stdout=LogLevel.DEBUG,
        is_bypassed=True,
        print_config=False,
    )
    return guard


@pytest.fixture
def trader_id():
    return TraderId("TRADER-001")


@pytest.fixture
def strategy_id():
    return StrategyId("S-001")


@pytest.fixture
def account_id():
    return AccountId("SIM-000")


@pytest.fixture
def venue():
    return Venue("SIM")


@pytest.fixture
def usd():
    return Currency.from_str("USD")


@pytest.fixture
def btc():
    return Currency.from_str("BTC")


@pytest.fixture
def usdt():
    return Currency.from_str("USDT")


@pytest.fixture
def audusd_id():
    return InstrumentId.from_str("AUD/USD.SIM")


@pytest.fixture
def usdjpy_id():
    return InstrumentId.from_str("USD/JPY.SIM")
