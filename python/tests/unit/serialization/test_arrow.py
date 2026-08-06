import json

from vibe_trader._libvibe.deribit import DeribitVolatilityIndex
from vibe_trader._libvibe.hyperliquid import HyperliquidAllMids
from vibe_trader.model import AggressorSide
from vibe_trader.model import Bar
from vibe_trader.model import BarAggregation
from vibe_trader.model import BarSpecification
from vibe_trader.model import BarType
from vibe_trader.model import IndexPriceUpdate
from vibe_trader.model import InstrumentClose
from vibe_trader.model import InstrumentCloseType
from vibe_trader.model import InstrumentId
from vibe_trader.model import MarkPriceUpdate
from vibe_trader.model import Price
from vibe_trader.model import PriceType
from vibe_trader.model import Quantity
from vibe_trader.model import QuoteTick
from vibe_trader.model import Symbol
from vibe_trader.model import TradeId
from vibe_trader.model import TradeTick
from vibe_trader.model import Venue
from vibe_trader.serialization import bars_to_arrow_record_batch_bytes
from vibe_trader.serialization import get_arrow_schema_map
from vibe_trader.serialization import index_prices_to_arrow_record_batch_bytes
from vibe_trader.serialization import instrument_closes_to_arrow_record_batch_bytes
from vibe_trader.serialization import mark_prices_to_arrow_record_batch_bytes
from vibe_trader.serialization import quotes_to_arrow_record_batch_bytes
from vibe_trader.serialization import trades_to_arrow_record_batch_bytes


INSTRUMENT_ID = InstrumentId(Symbol("AUD/USD"), Venue("SIM"))


def test_get_arrow_schema_map_quote_tick():
    schema = get_arrow_schema_map(QuoteTick)

    assert isinstance(schema, dict)
    assert len(schema) > 0


def test_get_arrow_schema_map_trade_tick():
    schema = get_arrow_schema_map(TradeTick)

    assert isinstance(schema, dict)
    assert len(schema) > 0


def test_get_arrow_schema_map_bar():
    schema = get_arrow_schema_map(Bar)

    assert isinstance(schema, dict)
    assert len(schema) > 0


def test_deribit_volatility_index_arrow_methods_available():
    dvol = DeribitVolatilityIndex(
        index_name="btc_usd",
        volatility=72.5,
        ts_event=1_000,
        ts_init=1_001,
    )

    assert hasattr(dvol, "encode_record_batch_py")
    assert hasattr(DeribitVolatilityIndex, "decode_record_batch_py")
    assert dvol.index_name == "btc_usd"
    assert dvol.volatility == 72.5
    assert dvol.ts_event == 1_000
    assert dvol.ts_init == 1_001


def test_hyperliquid_all_mids_arrow_methods_available():
    all_mids = HyperliquidAllMids(mids={}, ts_event=1_000, ts_init=1_001)

    assert hasattr(all_mids, "encode_record_batch_py")
    assert hasattr(HyperliquidAllMids, "decode_record_batch_py")
    assert all_mids.mids == {}
    assert all_mids.ts_event == 1_000
    assert all_mids.ts_init == 1_001


def test_hyperliquid_all_mids_from_json_is_classmethod_and_roundtrips():
    original = HyperliquidAllMids(mids={}, ts_event=1_000, ts_init=1_001)
    payload = json.loads(original.to_json())

    restored = HyperliquidAllMids.from_json(payload)

    assert isinstance(restored, HyperliquidAllMids)
    assert restored.mids == original.mids
    assert restored.ts_event == original.ts_event
    assert restored.ts_init == original.ts_init


def test_quotes_to_arrow_record_batch_bytes():
    quotes = [
        QuoteTick(
            instrument_id=INSTRUMENT_ID,
            bid_price=Price.from_str("0.80000"),
            ask_price=Price.from_str("0.80010"),
            bid_size=Quantity.from_int(1_000_000),
            ask_size=Quantity.from_int(1_000_000),
            ts_event=1,
            ts_init=2,
        ),
        QuoteTick(
            instrument_id=INSTRUMENT_ID,
            bid_price=Price.from_str("0.80005"),
            ask_price=Price.from_str("0.80015"),
            bid_size=Quantity.from_int(500_000),
            ask_size=Quantity.from_int(500_000),
            ts_event=3,
            ts_init=4,
        ),
    ]

    result = quotes_to_arrow_record_batch_bytes(quotes)

    assert isinstance(result, bytes)
    assert len(result) > 0


def test_trades_to_arrow_record_batch_bytes():
    trades = [
        TradeTick(
            instrument_id=INSTRUMENT_ID,
            price=Price.from_str("0.80000"),
            size=Quantity.from_int(100_000),
            aggressor_side=AggressorSide.BUYER,
            trade_id=TradeId("T-001"),
            ts_event=1,
            ts_init=2,
        ),
    ]

    result = trades_to_arrow_record_batch_bytes(trades)

    assert isinstance(result, bytes)
    assert len(result) > 0


def test_bars_to_arrow_record_batch_bytes():
    bar_type = BarType(
        instrument_id=INSTRUMENT_ID,
        spec=BarSpecification(
            step=1,
            aggregation=BarAggregation.MINUTE,
            price_type=PriceType.LAST,
        ),
    )
    bars = [
        Bar(
            bar_type=bar_type,
            open=Price.from_str("0.80000"),
            high=Price.from_str("0.80050"),
            low=Price.from_str("0.79950"),
            close=Price.from_str("0.80010"),
            volume=Quantity.from_int(1_000_000),
            ts_event=1,
            ts_init=2,
        ),
    ]

    result = bars_to_arrow_record_batch_bytes(bars)

    assert isinstance(result, bytes)
    assert len(result) > 0


def test_mark_prices_to_arrow_record_batch_bytes():
    marks = [
        MarkPriceUpdate(
            instrument_id=INSTRUMENT_ID,
            value=Price.from_str("0.80000"),
            ts_event=1,
            ts_init=2,
        ),
    ]

    result = mark_prices_to_arrow_record_batch_bytes(marks)

    assert isinstance(result, bytes)
    assert len(result) > 0


def test_index_prices_to_arrow_record_batch_bytes():
    prices = [
        IndexPriceUpdate(
            instrument_id=INSTRUMENT_ID,
            value=Price.from_str("0.80000"),
            ts_event=1,
            ts_init=2,
        ),
    ]

    result = index_prices_to_arrow_record_batch_bytes(prices)

    assert isinstance(result, bytes)
    assert len(result) > 0


def test_instrument_closes_to_arrow_record_batch_bytes():
    closes = [
        InstrumentClose(
            instrument_id=INSTRUMENT_ID,
            close_price=Price.from_str("0.80000"),
            close_type=InstrumentCloseType.END_OF_SESSION,
            ts_event=1,
            ts_init=2,
        ),
    ]

    result = instrument_closes_to_arrow_record_batch_bytes(closes)

    assert isinstance(result, bytes)
    assert len(result) > 0
