"""The runner seals the observed exposure rows reproducibly and refuses an incomplete observation."""

import csv
import gzip
import io
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from backtest.report import EXPOSURE_COLUMNS, capital_findings, exposure_stream, write_exposures


ROWS = [(1_767_225_899_999_000_000, "AAAUSDT-PERP.BINANCE-R1-AAA", "100.00000000 USDT", "-1.00000000 USDT")]


class CapitalExposureTests(unittest.TestCase):
    def test_stream_write_failure_remains_a_failed_observation_after_native_callback_catches_it(self):
        from backtest.run import CapitalObserver, CapitalObserverConfig
        from nautilus_trader.model import InstrumentId
        with tempfile.TemporaryDirectory() as temp:
            observer = CapitalObserver(CapitalObserverConfig((), str(Path(temp) / 'exposures.gz')))
            iid = InstrumentId.from_str('AAA.BINANCE')
            observer._marks[iid] = object()
            position = SimpleNamespace(instrument_id=iid, ts_last=0, id='native-position',
                                       notional_value=lambda _: '100 USDT', unrealized_pnl=lambda _: '0 USDT')
            cache = SimpleNamespace(positions_open=lambda: [position])
            try:
                with patch.object(observer, '_exposure_writer') as writer:
                    writer.writerow.side_effect = OSError('disk write failure')
                    with self.assertRaises(OSError):
                        observer._value(1, cache)
                self.assertEqual(observer.timestamps, 1)
                self.assertTrue(capital_findings(observer, 1))
            finally:
                observer.finish(cache)

    def test_stream_close_failure_propagates_from_finish(self):
        from backtest.run import CapitalObserver, CapitalObserverConfig
        with tempfile.TemporaryDirectory() as temp:
            observer = CapitalObserver(CapitalObserverConfig((), str(Path(temp) / 'exposures.gz')))
            real = observer._exposure_stream
            try:
                with patch.object(observer, '_exposure_stream') as stream:
                    stream.__exit__.side_effect = OSError('flush failure')
                    with self.assertRaises(OSError):
                        observer.finish(None)
            finally:
                real.__exit__(None, None, None)

    def test_incremental_native_rows_have_identical_complete_report_bytes(self):
        with tempfile.TemporaryDirectory() as temp:
            reference, streamed = Path(temp) / 'reference.gz', Path(temp) / 'streamed.gz'
            values = ROWS * 20_000
            write_exposures(values, reference)
            with exposure_stream(streamed) as writer:
                for row in values:
                    writer.writerow(row)
            self.assertEqual(reference.read_bytes(), streamed.read_bytes())
            empty = Path(temp) / 'empty.gz'
            with exposure_stream(empty):
                pass
            self.assertEqual(list(csv.reader(io.StringIO(gzip.decompress(empty.read_bytes()).decode()))),
                             [list(EXPOSURE_COLUMNS)])

    def test_mark_timestamp_union_keeps_actual_overlap_gaps_and_disjoint_inputs(self):
        import pyarrow as arrow
        import pyarrow.parquet as parquet
        from backtest.load import mark_timestamps
        with tempfile.TemporaryDirectory() as temp:
            rows = []
            for index, values in enumerate(([1, 3, 3, 5], [3, 5, 8], [13])):
                root = Path(temp) / str(index)
                path = root / 'data' / 'mark_prices' / 'instrument'
                path.mkdir(parents=True)
                parquet.write_table(arrow.table({'ts_event': values}), path / 'test.parquet')
                rows.append({'catalog_path': root})
            self.assertEqual(mark_timestamps(rows), 5)
            self.assertEqual(mark_timestamps([]), 0)

    def test_exposure_report_bytes_repeat_and_read_back(self):
        with tempfile.TemporaryDirectory() as temp:
            first, second = Path(temp) / "a.csv.gz", Path(temp) / "b.csv.gz"
            write_exposures(ROWS, first)
            write_exposures(ROWS, second)
            self.assertEqual(first.read_bytes(), second.read_bytes())
            rows = list(csv.reader(io.StringIO(gzip.decompress(first.read_bytes()).decode())))
        self.assertEqual(rows, [list(EXPOSURE_COLUMNS), [str(value) for value in ROWS[0]]])

    def test_missed_timestamps_and_unvalued_positions_fail_the_run(self):
        complete = SimpleNamespace(timestamps=3, findings=[])
        self.assertEqual(capital_findings(complete, 3), [])
        missed = SimpleNamespace(timestamps=2, findings=["capital observation cannot value X at 1", "capital observation cannot value X at 1"])
        self.assertEqual(capital_findings(missed, 3), [
            "capital observation cannot value X at 1", "capital observation valued 2 of 3 input timestamps"])


if __name__ == "__main__":
    unittest.main()
