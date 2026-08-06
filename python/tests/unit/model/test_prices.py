import pickle

from vibe_trader.model import IndexPriceUpdate
from vibe_trader.model import MarkPriceUpdate
from vibe_trader.model import Price


def test_mark_price_update_construction(audusd_id):
    mark = MarkPriceUpdate(
        instrument_id=audusd_id,
        value=Price.from_str("50000.00"),
        ts_event=1_000_000_000,
        ts_init=1_000_000_001,
    )

    assert mark.instrument_id == audusd_id
    assert mark.value == Price.from_str("50000.00")
    assert mark.ts_event == 1_000_000_000
    assert mark.ts_init == 1_000_000_001


def test_mark_price_update_equality(audusd_id):
    m1 = MarkPriceUpdate(audusd_id, Price.from_str("50000.00"), 0, 0)
    m2 = MarkPriceUpdate(audusd_id, Price.from_str("50000.00"), 0, 0)

    assert m1 == m2


def test_mark_price_update_hash(audusd_id):
    m1 = MarkPriceUpdate(audusd_id, Price.from_str("50000.00"), 0, 0)
    m2 = MarkPriceUpdate(audusd_id, Price.from_str("50000.00"), 0, 0)

    assert hash(m1) == hash(m2)


def test_mark_price_update_str_and_repr(audusd_id):
    mark = MarkPriceUpdate(audusd_id, Price.from_str("50000.00"), 0, 0)

    assert "50000.00" in str(mark)
    assert "MarkPriceUpdate" in repr(mark)


def test_mark_price_update_to_dict_and_from_dict_roundtrip(audusd_id):
    mark = MarkPriceUpdate(
        instrument_id=audusd_id,
        value=Price.from_str("50000.00"),
        ts_event=1_000_000_000,
        ts_init=1_000_000_001,
    )

    d = MarkPriceUpdate.to_dict(mark)
    restored = MarkPriceUpdate.from_dict(d)

    assert d["type"] == "MarkPriceUpdate"
    assert restored == mark


def test_mark_price_update_fully_qualified_name():
    assert MarkPriceUpdate.fully_qualified_name() == "vibe_trader.model:MarkPriceUpdate"


def test_mark_price_update_pickle_roundtrip(audusd_id):
    mark = MarkPriceUpdate(audusd_id, Price.from_str("50000.00"), 0, 0)

    pickled = pickle.dumps(mark)
    unpickled = pickle.loads(pickled)  # noqa: S301

    assert unpickled == mark


def test_mark_price_update_json_roundtrip(audusd_id):
    mark = MarkPriceUpdate(audusd_id, Price.from_str("50000.00"), 0, 0)

    json_bytes = mark.to_json_bytes()
    restored = MarkPriceUpdate.from_json(json_bytes)

    assert restored == mark


def test_mark_price_update_msgpack_roundtrip(audusd_id):
    mark = MarkPriceUpdate(audusd_id, Price.from_str("50000.00"), 0, 0)

    msgpack_bytes = mark.to_msgpack_bytes()
    restored = MarkPriceUpdate.from_msgpack(msgpack_bytes)

    assert restored == mark


def test_mark_price_update_get_metadata(audusd_id):
    metadata = MarkPriceUpdate.get_metadata(audusd_id, 2)

    assert metadata["instrument_id"] == "AUD/USD.SIM"


def test_mark_price_update_get_fields():
    fields = MarkPriceUpdate.get_fields()

    assert "value" in fields
    assert "ts_event" in fields
    assert "ts_init" in fields


def test_index_price_update_construction(audusd_id):
    index_price = IndexPriceUpdate(
        instrument_id=audusd_id,
        value=Price.from_str("50000.00"),
        ts_event=1_000_000_000,
        ts_init=1_000_000_001,
    )

    assert index_price.instrument_id == audusd_id
    assert index_price.value == Price.from_str("50000.00")
    assert index_price.ts_event == 1_000_000_000
    assert index_price.ts_init == 1_000_000_001


def test_index_price_update_equality(audusd_id):
    i1 = IndexPriceUpdate(audusd_id, Price.from_str("50000.00"), 0, 0)
    i2 = IndexPriceUpdate(audusd_id, Price.from_str("50000.00"), 0, 0)

    assert i1 == i2


def test_index_price_update_hash(audusd_id):
    i1 = IndexPriceUpdate(audusd_id, Price.from_str("50000.00"), 0, 0)
    i2 = IndexPriceUpdate(audusd_id, Price.from_str("50000.00"), 0, 0)

    assert hash(i1) == hash(i2)


def test_index_price_update_str_and_repr(audusd_id):
    index_price = IndexPriceUpdate(audusd_id, Price.from_str("50000.00"), 0, 0)

    assert "50000.00" in str(index_price)
    assert "IndexPriceUpdate" in repr(index_price)


def test_index_price_update_to_dict_and_from_dict_roundtrip(audusd_id):
    index_price = IndexPriceUpdate(
        instrument_id=audusd_id,
        value=Price.from_str("50000.00"),
        ts_event=1_000_000_000,
        ts_init=1_000_000_001,
    )

    d = index_price.to_dict()
    restored = IndexPriceUpdate.from_dict(d)

    assert d["type"] == "IndexPriceUpdate"
    assert restored == index_price


def test_index_price_update_fully_qualified_name():
    assert IndexPriceUpdate.fully_qualified_name() == "vibe_trader.model:IndexPriceUpdate"


def test_index_price_update_pickle_roundtrip(audusd_id):
    index_price = IndexPriceUpdate(audusd_id, Price.from_str("50000.00"), 0, 0)

    pickled = pickle.dumps(index_price)
    unpickled = pickle.loads(pickled)  # noqa: S301

    assert unpickled == index_price


def test_index_price_update_json_roundtrip(audusd_id):
    index_price = IndexPriceUpdate(audusd_id, Price.from_str("50000.00"), 0, 0)

    json_bytes = index_price.to_json_bytes()
    restored = IndexPriceUpdate.from_json(json_bytes)

    assert restored == index_price


def test_index_price_update_msgpack_roundtrip(audusd_id):
    index_price = IndexPriceUpdate(audusd_id, Price.from_str("50000.00"), 0, 0)

    msgpack_bytes = index_price.to_msgpack_bytes()
    restored = IndexPriceUpdate.from_msgpack(msgpack_bytes)

    assert restored == index_price


def test_index_price_update_get_metadata(audusd_id):
    metadata = IndexPriceUpdate.get_metadata(audusd_id, 2)

    assert metadata["instrument_id"] == "AUD/USD.SIM"


def test_index_price_update_get_fields():
    fields = IndexPriceUpdate.get_fields()

    assert "value" in fields
    assert "ts_event" in fields
    assert "ts_init" in fields
