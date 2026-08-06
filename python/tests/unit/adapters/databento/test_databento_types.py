from pathlib import Path

from vibe_trader.adapters.databento import DatabentoDataLoader
from vibe_trader.adapters.databento import DatabentoImbalance
from vibe_trader.adapters.databento import DatabentoStatistics
from vibe_trader.model import InstrumentId


TEST_DATA_DIR = Path(__file__).resolve().parents[5] / "crates/adapters/databento/test_data"
PUBLISHERS_FILE = TEST_DATA_DIR.parent / "publishers.json"


def test_databento_imbalance_python_roundtrip() -> None:
    loader = DatabentoDataLoader(PUBLISHERS_FILE)
    loader.set_price_precision("SPOT", 2)
    data = loader.load_imbalance(TEST_DATA_DIR / "test_data.imbalance.dbn.zst")

    assert len(data) == 2
    for original in data:
        restored = DatabentoImbalance.from_dict(original.to_dict())

        assert restored.instrument_id == original.instrument_id
        assert restored.ref_price == original.ref_price
        assert restored.cont_book_clr_price == original.cont_book_clr_price
        assert restored.auct_interest_clr_price == original.auct_interest_clr_price
        assert restored.paired_qty == original.paired_qty
        assert restored.total_imbalance_qty == original.total_imbalance_qty
        assert restored.side == original.side
        assert restored.significant_imbalance == original.significant_imbalance
        assert restored.ts_event == original.ts_event
        assert restored.ts_recv == original.ts_recv
        assert restored.ts_init == original.ts_init
        assert restored == original


def test_databento_statistics_python_roundtrip() -> None:
    loader = DatabentoDataLoader(PUBLISHERS_FILE)
    loader.set_price_precision("ESM4", 2)
    instrument_id = InstrumentId.from_str("ESM4.GLBX")
    data = loader.load_statistics(
        TEST_DATA_DIR / "test_data.statistics.dbn.zst",
        instrument_id=instrument_id,
    )

    assert len(data) == 2
    for original in data:
        restored = DatabentoStatistics.from_dict(original.to_dict())

        assert restored.instrument_id == original.instrument_id
        assert restored.stat_type == original.stat_type
        assert restored.update_action == original.update_action
        assert restored.price == original.price
        assert restored.quantity == original.quantity
        assert restored.channel_id == original.channel_id
        assert restored.stat_flags == original.stat_flags
        assert restored.sequence == original.sequence
        assert restored.ts_ref == original.ts_ref
        assert restored.ts_in_delta == original.ts_in_delta
        assert restored.ts_event == original.ts_event
        assert restored.ts_recv == original.ts_recv
        assert restored.ts_init == original.ts_init
        assert restored == original
