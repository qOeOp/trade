import pytest

from vibe_trader.model import AccountType
from vibe_trader.model import BookType
from vibe_trader.model import InstrumentClass
from vibe_trader.model import MarketStatus
from vibe_trader.model import OmsType
from vibe_trader.model import OrderSide
from vibe_trader.model import OrderType
from vibe_trader.model import OtoTriggerMode
from vibe_trader.model import PoolLiquidityUpdateType
from vibe_trader.model import TradingState


def test_model_enum_variants_are_iterable():
    variants = list(AccountType.variants())
    assert AccountType.CASH in variants
    assert AccountType.MARGIN in variants


@pytest.mark.parametrize(
    ("enum_type", "member", "name"),
    [
        (InstrumentClass, InstrumentClass.SPOT, "SPOT"),
        (MarketStatus, MarketStatus.OPEN, "OPEN"),
        (OmsType, OmsType.NETTING, "NETTING"),
        (OtoTriggerMode, OtoTriggerMode.FULL, "FULL"),
        (TradingState, TradingState.ACTIVE, "ACTIVE"),
    ],
)
def test_model_enums_from_str(enum_type, member, name):
    assert enum_type.from_str(name) == member
    assert member.name == name
    assert isinstance(hash(member), int)


def test_pool_liquidity_update_type_from_str():
    assert PoolLiquidityUpdateType.from_str("Mint") == PoolLiquidityUpdateType.MINT


@pytest.mark.parametrize("enum_type", [BookType, OrderSide, OrderType])
def test_workflow_enums_reject_malformed_values(enum_type):
    with pytest.raises(ValueError, match="Matching variant not found"):
        enum_type.from_str("NOT_A_VARIANT")
