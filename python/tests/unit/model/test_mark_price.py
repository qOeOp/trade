from vibe_trader.model import InstrumentId
from vibe_trader.model import MarkPriceUpdate
from vibe_trader.model import Price


BTCUSDT_BINANCE = InstrumentId.from_str("BTCUSDT.BINANCE")


def test_fully_qualified_name():
    assert MarkPriceUpdate.fully_qualified_name() == "vibe_trader.model:MarkPriceUpdate"


def test_hash_str_and_repr():
    update = MarkPriceUpdate(
        instrument_id=BTCUSDT_BINANCE,
        value=Price.from_str("100000.00"),
        ts_event=1,
        ts_init=2,
    )

    assert isinstance(hash(update), int)
    assert str(update) == "BTCUSDT.BINANCE,100000.00,1,2"
    assert repr(update) == "MarkPriceUpdate(BTCUSDT.BINANCE,100000.00,1,2)"


def test_to_dict():
    update = MarkPriceUpdate(
        instrument_id=BTCUSDT_BINANCE,
        value=Price.from_str("100000.00"),
        ts_event=1,
        ts_init=2,
    )

    result = MarkPriceUpdate.to_dict(update)

    assert result == {
        "type": "MarkPriceUpdate",
        "instrument_id": "BTCUSDT.BINANCE",
        "value": "100000.00",
        "ts_event": 1,
        "ts_init": 2,
    }


def test_from_dict_roundtrip():
    update = MarkPriceUpdate(
        instrument_id=BTCUSDT_BINANCE,
        value=Price.from_str("100000.00"),
        ts_event=1,
        ts_init=2,
    )

    result = MarkPriceUpdate.from_dict(MarkPriceUpdate.to_dict(update))

    assert result == update


def test_equality():
    update1 = MarkPriceUpdate(
        instrument_id=BTCUSDT_BINANCE,
        value=Price.from_str("100000.00"),
        ts_event=1,
        ts_init=2,
    )
    update2 = MarkPriceUpdate(
        instrument_id=BTCUSDT_BINANCE,
        value=Price.from_str("100000.00"),
        ts_event=1,
        ts_init=2,
    )

    assert update1 == update2
