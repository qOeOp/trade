"""Complete source aggTrades imported into throwaway market directories, and the exports and coverage that
read them. No active market or real network."""

from collections import Counter
from datetime import UTC, date, datetime
from decimal import Decimal, localcontext
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import Mock, patch

import numpy as np

from cli import main
from market import aggtrades as trades, export, files, sources, store
from tests.market.directory import directory, read, seed
from tests.market.exchange import aggtrades_csv, day_ms, zipped


JAN = date(2025, 1, 1)
START = day_ms(JAN)


def archive(root, day, rows, header=True, symbol='BTCUSDT'):
    text = aggtrades_csv(rows)
    if not header:
        text = text.split('\n', 1)[1]
    key = sources.aggtrades_key(symbol, day)
    target = Path(root) / key
    target.parent.mkdir(parents=True, exist_ok=True)
    body = zipped(Path(key).name.removesuffix('.zip') + '.csv', text)
    target.write_bytes(body)
    target.with_name(target.name + '.CHECKSUM').write_text(hashlib.sha256(body).hexdigest() + '  archive.zip\n')
    return target


def source_rows(at, identity):
    return [(identity, '100.00000001', '0.12345678', identity * 2, identity * 2 + 1, at + 10, True),
            (identity + 1, '100.01000000', '0.10000001', identity * 2 + 2, identity * 2 + 2, at + 10, False)]


class CodecTests(unittest.TestCase):
    def test_exact_scale_is_independent_of_decimal_context_and_covers_int64_boundary(self):
        with localcontext() as context:
            context.prec = 2
            self.assertEqual(trades.scaled('92233720368.54775807', 'price'), (1 << 63) - 1)
            self.assertEqual(trades.scaled('0.0000000100000000', 'quantity'), 1)
            self.assertEqual(trades.scaled('12345.12345678', 'price'), 1234512345678)
        for text in ('0.000000001', '92233720368.54775808', '100000000000000000000000000000.00000001',
                     '1E+1000000000', '1E-1000000000'):
            with self.subTest(text=text), self.assertRaises(sources.MarketError) as caught:
                trades.scaled(text, 'price')
            self.assertEqual(caught.exception.code, 'SCALE_LOSS')
        for text in ('NaN', 'Infinity', '-1', '0', 'oops'):
            with self.subTest(text=text), self.assertRaises(sources.MarketError) as caught:
                trades.scaled(text, 'quantity')
            self.assertEqual(caught.exception.code, 'SOURCE_SHAPE')

    def test_stream_retains_every_field_equal_timestamps_headers_and_no_header(self):
        with tempfile.TemporaryDirectory() as temp:
            for header in (True, False):
                path = archive(temp, '2025-01-01', source_rows(START, 7), header)
                readings, state = {}, trades.State()
                chunks = list(trades.batches(path, 'BTCUSDT', '2025-01-01', state, readings, size=1))
                self.assertEqual(chunks, [[('BTCUSDT', START + 10, 7, 10000000001, 12345678, 14, 15, True)],
                                          [('BTCUSDT', START + 10, 8, 10001000000, 10000001, 16, 16, False)]])
                self.assertEqual((state.last_id, readings['trades']), (8, 2))

    def test_gap_duplicate_time_reversal_and_wrong_day_across_batches_or_days_refuse(self):
        with tempfile.TemporaryDirectory() as temp:
            for identities, times, code in [((1, 3), (10, 11), 'SEQUENCE_GAP'),
                                            ((1, 1), (10, 11), 'SEQUENCE_GAP'),
                                            ((1, 2), (11, 10), 'SOURCE_SHAPE'),
                                            ((1, 2), (10, -1), 'SOURCE_SHAPE')]:
                rows = [(i, '100', '0.1', i, i, START + t, True) for i, t in zip(identities, times, strict=True)]
                path = archive(temp, '2025-01-01', rows)
                with self.subTest(identities=identities, times=times), self.assertRaises(sources.MarketError) as caught:
                    list(trades.batches(path, 'BTCUSDT', '2025-01-01', trades.State(), {}, size=1))
                self.assertEqual(caught.exception.code, code)
            path = archive(temp, '2025-01-01', source_rows(START, 7))
            with self.assertRaises(sources.MarketError) as caught:
                list(trades.batches(path, 'BTCUSDT', '2025-01-01', trades.State(5, START - 1), {}, size=1))
            self.assertEqual(caught.exception.code, 'SEQUENCE_GAP')

    def test_repeated_id_imports_a_later_distinct_trade_and_refuses_any_other_repeat(self):
        with tempfile.TemporaryDirectory() as temp:
            rows = [(1, '100', '0.1', 1, 1, START + 10, True), (1, '101', '0.2', 3, 3, START + 11, False),
                    (2, '102', '0.3', 4, 4, START + 12, True)]
            path = archive(temp, '2025-01-01', rows)
            readings, state = {}, trades.State()
            chunks = list(trades.batches(path, 'BTCUSDT', '2025-01-01', state, readings, size=1))
            self.assertEqual([chunk[0][1:3] for chunk in chunks], [(START + 10, 1), (START + 11, 1), (START + 12, 2)])
            self.assertEqual((state.last_id, state.last_trade, readings['trades']), (2, 4, 3))
            for second in [(1, '100', '0.1', 1, 1, START + 10, True), (1, '101', '0.2', 3, 3, START + 10, False),
                           (1, '101', '0.2', 1, 1, START + 11, False)]:
                path = archive(temp, '2025-01-01', [rows[0], second])
                with self.subTest(second=second), self.assertRaises(sources.MarketError) as caught:
                    list(trades.batches(path, 'BTCUSDT', '2025-01-01', trades.State(), {}, size=1))
                self.assertEqual(caught.exception.code, 'SEQUENCE_GAP')

    def test_bounded_download_verifies_checksum_before_promoting_cache(self):
        body = b'x' * (sources.DOWNLOAD_BYTES * 2 + 7)
        checksum = hashlib.sha256(body).hexdigest().encode() + b'  archive.zip\n'

        def reply(data):
            stream = io.BytesIO(data)
            return Mock(status=200, headers={}, will_close=False, read=Mock(side_effect=stream.read))

        replies = reply(checksum), reply(body)
        connection = Mock()
        connection.getresponse.side_effect = replies
        with tempfile.TemporaryDirectory() as temp, patch.object(sources, '_connection', return_value=connection):
            path = sources.fetch_archive(Path(temp), 'test.zip')
            self.assertEqual(path.read_bytes(), body)
            self.assertTrue(all(call.args == (sources.DOWNLOAD_BYTES,) for call in replies[1].read.call_args_list))
            self.assertEqual(sources.fetch_archive(Path(temp), 'test.zip'), path)
            self.assertEqual(connection.request.call_count, 2)


def fixture_archives(cache: Path) -> list[tuple]:
    """Two trades a day of BTCUSDT from the eve through January, in `cache`; January's stored rows."""
    expected = []
    for index, at in enumerate(range(START - store.DAY, day_ms(date(2025, 2, 1)), store.DAY)):
        day = datetime.fromtimestamp(at / 1000, UTC).date().isoformat()
        rows = source_rows(at, 1 + index * 2)
        rows = [(r[0], f'{100 + index}.{offset:02d}', *r[2:]) for offset, r in enumerate(rows)]
        archive(cache, day, rows, header=index % 2 == 0)
        if at >= START:
            for identity, price, quantity, first, last, moment, maker in rows:
                expected.append(('BTCUSDT', moment, identity, trades.scaled(price, 'price'),
                                 trades.scaled(quantity, 'quantity'), first, last, maker))
    return expected


def bars_market(cleanup, size='0.001') -> dict:
    """A market directory holding BTCUSDT's January bars."""
    profile = directory(cleanup)
    count = 31 * 1440
    times = START + np.arange(count, dtype=np.int64) * 60_000
    price = np.full(count, 100 * 10**8, dtype=np.int64)
    columns = {'ts_open': times, **{name: price for name in ('open', 'high', 'low', 'close')},
               'volume': np.full(count, 10000, dtype=np.int64)}
    seed(profile, month='2025-01', through='2025-02-01',
         terms=[('BTCUSDT', {'price_increment': '0.01', 'size_increment': size})],
         bars={('BTCUSDT', 'LAST'): columns, ('BTCUSDT', 'MARK'): {**columns, 'volume': np.zeros(count, np.int64)}},
         funding={'BTCUSDT': [(START + 8 * 3_600_000 * i, Decimal('0.0001')) for i in range(31 * 3)]},
         members=[(date(2025, 2, 1), 'BTCUSDT')])  # January's last day waits for them
    return profile


def stored(profile: dict, market_day: str | None = None) -> list[tuple]:
    return [tuple(row.values()) for row in read(profile, 'agg_trade', market_day=market_day).to_pylist()]


def trade_files(profile: dict) -> list[str]:
    """Every file under the table's directory, an abandoned temporary file included."""
    root = Path(profile['root']) / 'agg_trade'
    return sorted(path.relative_to(root).as_posix() for path in root.rglob('*') if path.is_file())


class CompleteImportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix='aggtrades-test-')
        cls.addClassCleanup(cls.temp.cleanup)
        cls.cache = Path(cls.temp.name) / 'cache'
        cls.expected = fixture_archives(cls.cache)

    def market(self, size='0.001'):
        return bars_market(self.addCleanup, size)

    def test_complete_month_exact_fidelity_metadata_and_the_cli(self):
        profile = self.market()
        home = Path(self.temp.name) / ('home-' + self._testMethodName)
        with patch.dict(os.environ, {'TRADE_LEDGER_HOME': str(home)}):
            empty = directory(self.addCleanup)
            made = files.init_market('agg', Path(empty['root']), 'isolated')
            self.assertEqual(json.loads(Path(made['profile']).read_text()),
                             {'name': 'agg', 'holds': 'market', 'kind': 'isolated', 'root': empty['root']})
            shutil.copytree(profile['root'], empty['root'], dirs_exist_ok=True)
            with patch('sys.stdout', new_callable=io.StringIO) as out, patch('sys.stderr', new_callable=io.StringIO):
                rc = main.main(['market', 'import-trades', '--market', made['profile'], '--month', '2025-01',
                                '--symbols', 'BTCUSDT', '--cache-root', str(self.cache)])
        result = json.loads(out.getvalue())
        self.assertEqual(rc, 0)
        imported, = result['imports']
        self.assertEqual((result['trade_rows'], imported['codec']), (62, trades.CODEC))
        profile = empty
        self.assertEqual(stored(profile), self.expected)
        self.assertEqual(stored(profile, JAN.isoformat()), [row for row in self.expected if row[1] < START + store.DAY])
        self.assertEqual(trade_files(profile), ['2025-01/BTCUSDT.parquet'])
        with self.assertRaises(sources.MarketError) as caught:
            trades.import_month(profile, JAN, self.cache, ['BTCUSDT'], log=lambda _: None)
        self.assertEqual(caught.exception.code, 'MONTH_EXISTS')

    def test_late_gap_or_precision_failure_writes_nothing_and_the_import_lock_is_shared(self):
        profile = self.market()
        for bad, code in [('gap', 'SEQUENCE_GAP'), ('precision', 'SCALE_LOSS')]:
            with tempfile.TemporaryDirectory() as temp:
                shutil.copytree(self.cache, temp, dirs_exist_ok=True)
                at = START + 30 * store.DAY
                rows = source_rows(at, 63)
                if bad == 'gap':
                    rows[1] = (99, *rows[1][1:])
                else:
                    rows[1] = (rows[1][0], rows[1][1], '0.000000001', *rows[1][3:])
                archive(temp, '2025-01-31', rows)
                with self.subTest(bad=bad), self.assertRaises(sources.MarketError) as caught:
                    trades.import_month(profile, JAN, Path(temp), ['BTCUSDT'], log=lambda _: None)
                self.assertEqual(caught.exception.code, code)
            self.assertEqual(trade_files(profile), [])
        with files.lock(files.open_market(profile, 'import')):
            with self.assertRaises(sources.MarketError) as caught:
                trades.import_month(profile, JAN, self.cache, ['BTCUSDT'])
            self.assertEqual(caught.exception.code, 'CONCURRENT_IMPORT')

    def test_contracts_of_one_month_are_written_at_once_one_file_each_and_a_refusal_keeps_the_others(self):
        days = list(enumerate(range(START - store.DAY, day_ms(date(2025, 2, 1)), store.DAY)))
        for bad in (False, True):
            profile = self.market()
            with tempfile.TemporaryDirectory() as temp:
                shutil.copytree(self.cache, temp, dirs_exist_ok=True)
                for index, at in days:
                    rows = source_rows(at, 1 + index * 2)
                    if bad and index == len(days) - 1:
                        rows[1] = (99, *rows[1][1:])
                    archive(temp, datetime.fromtimestamp(at / 1000, UTC).date().isoformat(), rows, symbol='ETHUSDT')
                if bad:
                    with self.assertRaises(sources.MarketError) as caught:
                        trades.import_month(profile, JAN, Path(temp), ['ETHUSDT', 'BTCUSDT'], log=lambda _: None)
                else:
                    imported = trades.import_month(profile, JAN, Path(temp), ['ETHUSDT', 'BTCUSDT'], log=lambda _: None)
            held = Counter(row[0] for row in stored(profile))
            if bad:
                self.assertEqual(caught.exception.code, 'SEQUENCE_GAP')
                self.assertIn('written meanwhile: BTCUSDT', caught.exception.message)
                self.assertEqual(held, {'BTCUSDT': 62})
                self.assertEqual(trade_files(profile), ['2025-01/BTCUSDT.parquet'])
                continue
            self.assertEqual(held, {'BTCUSDT': 62, 'ETHUSDT': 62})
            self.assertEqual(([item['symbols'] for item in imported['imports']], imported['trade_rows']),
                             ([['BTCUSDT'], ['ETHUSDT']], 124))
            self.assertEqual(trade_files(profile), ['2025-01/BTCUSDT.parquet', '2025-01/ETHUSDT.parquet'])

    def test_a_contract_already_holding_the_month_refuses_alone(self):
        profile = self.market()
        trades.import_month(profile, JAN, self.cache, ['BTCUSDT'], log=lambda _: None)
        with tempfile.TemporaryDirectory() as temp:
            shutil.copytree(self.cache, temp, dirs_exist_ok=True)
            for index, at in enumerate(range(START - store.DAY, day_ms(date(2025, 2, 1)), store.DAY)):
                archive(temp, datetime.fromtimestamp(at / 1000, UTC).date().isoformat(), source_rows(at, 1 + index * 2),
                        symbol='ETHUSDT')
            with self.assertRaises(sources.MarketError) as caught:
                trades.import_month(profile, JAN, Path(temp), ['ETHUSDT', 'BTCUSDT'], log=lambda _: None)
        self.assertEqual(caught.exception.code, 'MONTH_EXISTS')
        self.assertIn('written meanwhile: ETHUSDT', caught.exception.message)
        self.assertEqual(Counter(row[0] for row in stored(profile)), {'BTCUSDT': 62, 'ETHUSDT': 62})


class StoredTradeExportTests(unittest.TestCase):
    """Exports and coverage of imported trades."""

    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix='aggtrades-test-')
        cls.addClassCleanup(cls.temp.cleanup)
        cls.cache = Path(cls.temp.name) / 'cache'
        cls.expected = fixture_archives(cls.cache)

    def imported(self, size: str) -> dict:
        """A market with January's trades."""
        profile = bars_market(self.addCleanup, size)
        trades.import_month(profile, JAN, self.cache, ['BTCUSDT'], log=lambda _: None)
        return profile

    def test_export_gives_each_stored_trade_as_an_exact_trade_tick_only_on_request(self):
        from nautilus_trader.model import AggressorSide
        from nautilus_trader.persistence import ParquetDataCatalog
        low, high = START * 10**6, (START + store.DAY) * 10**6
        profile = self.imported('0.00000001')
        from market import coverage
        held = coverage.diagnose_coverage(profile, None, ['BTCUSDT'], '2024-12-31T00:00:00Z', '2025-02-02T00:00:00Z',
                                          None)['coverage'][0]['trades']
        self.assertEqual(held, {'months': [{'month': '2025-01', 'rows': 62}],
                                'first_ms': self.expected[0][1], 'last_ms': self.expected[-1][1],
                                'uncovered_intervals_ms': [[START - store.DAY, START],
                                                           [day_ms(date(2025, 2, 1)), day_ms(date(2025, 2, 2))]]})
        found = export.export_catalogs(profile, None, ['BTCUSDT'], low, high, fresh=True, root=Path(self.temp.name),
                                       workers=1, include_trades=True)
        self.assertEqual(found['receipts']['BTCUSDT']['pieces'][0]['counts']['trade'], 2)
        ticks = ParquetDataCatalog(str(Path(found['root']) / 'BTCUSDT')).query_trade_ticks()
        expected = [row for row in self.expected if START <= row[1] < START + store.DAY]
        self.assertEqual([(t.ts_init, int(t.trade_id.value), str(t.price), str(t.size), t.aggressor_side)
                          for t in ticks],
                         [(moment * 10**6, identity, f'{price / 10**8:.2f}', f'{quantity / 10**8:.8f}',
                           AggressorSide.SELL if maker else AggressorSide.BUY)
                          for _, moment, identity, price, quantity, _, _, maker in expected])
        plain = export.export_catalogs(profile, None, ['BTCUSDT'], low, high, fresh=True, root=Path(self.temp.name),
                                       workers=1)
        self.assertNotIn('trade', plain['receipts']['BTCUSDT']['pieces'][0]['counts'])
        self.assertFalse(list(Path(plain['root']).rglob('trades')))
        coarse = self.imported('0.001')
        with self.assertRaises(sources.MarketError) as caught:
            export.export_catalogs(coarse, None, ['BTCUSDT'], low, high, fresh=True, root=Path(self.temp.name),
                                   workers=1, include_trades=True)
        self.assertEqual(caught.exception.code, 'TRADE_INEXACT')

if __name__ == '__main__':
    unittest.main()
