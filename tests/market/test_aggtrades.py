"""Complete source ingestion in throwaway markets; no active database or real network."""

from datetime import UTC, date, datetime
from decimal import localcontext
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import Mock, patch

import numpy as np

from cli import main
from ledger import admin, db
from market import aggtrades as trades, export, sources, store
from tests.market.dolt import BINARY, SKIP, TemporaryMarket, seed
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
    def test_exact_scale_is_independent_of_decimal_context_and_covers_bigint_boundary(self):
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
        body = b'x' * (trades.DOWNLOAD_BYTES * 2 + 7)
        response = Mock(status=200, headers={}, will_close=False)
        stream = io.BytesIO(body)
        response.read.side_effect = lambda size: stream.read(size)
        connection = Mock()
        connection.getresponse.return_value = response
        checksum = hashlib.sha256(body).hexdigest().encode() + b'  archive.zip\n'
        with tempfile.TemporaryDirectory() as temp, patch.object(sources, '_get', return_value=checksum), \
                patch.object(sources, '_connection', return_value=connection):
            path = trades.fetch_archive(Path(temp), 'test.zip')
            self.assertEqual(path.read_bytes(), body)
            self.assertTrue(all(call.args == (trades.DOWNLOAD_BYTES,) for call in response.read.call_args_list))
            self.assertEqual(trades.fetch_archive(Path(temp), 'test.zip'), path)
            self.assertEqual(connection.request.call_count, 1)
        with tempfile.TemporaryDirectory() as temp, patch.object(sources, '_get', return_value=b'0' * 64), \
                patch.object(trades, '_download', side_effect=lambda url, path: path.write_bytes(body)):
            with self.assertRaises(sources.MarketError) as caught:
                trades.fetch_archive(Path(temp), 'test.zip')
            self.assertEqual(caught.exception.code, 'CHECKSUM_MISMATCH')
            self.assertFalse((Path(temp) / 'test.zip').exists())


@unittest.skipUnless(BINARY, SKIP)
class CompleteImportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixture = TemporaryMarket()
        cls.addClassCleanup(cls.fixture.close)
        cls.temp = tempfile.TemporaryDirectory(prefix='aggtrades-test-')
        cls.addClassCleanup(cls.temp.cleanup)
        cls.cache = Path(cls.temp.name) / 'cache'
        cls.expected = []
        for index, at in enumerate(range(START - store.DAY, day_ms(date(2025, 2, 1)), store.DAY)):
            day = datetime.fromtimestamp(at / 1000, UTC).date().isoformat()
            rows = source_rows(at, 1 + index * 2)
            rows = [(r[0], f'{100 + index}.{offset:02d}', *r[2:]) for offset, r in enumerate(rows)]
            archive(cls.cache, day, rows, header=index % 2 == 0)
            if at >= START:
                for identity, price, quantity, first, last, moment, maker in rows:
                    cls.expected.append(('BTCUSDT', moment, identity, trades.scaled(price, 'price'),
                                         trades.scaled(quantity, 'quantity'), first, last, int(maker)))

    def market(self, size='0.001', suffix=''):
        profile = self.fixture.add('agg_' + self._testMethodName.removeprefix('test_')[:40] + suffix)
        times = START + np.arange(1440, dtype=np.int64) * 60_000
        price = np.full(1440, 100 * 10**8, dtype=np.int64)
        columns = {'ts_open': times, **{name: price for name in ('open', 'high', 'low', 'close')},
                   'volume': np.full(1440, 10000, dtype=np.int64)}
        commit = seed(profile, month='2025-01', through='2025-02-01', scope=['BTCUSDT'],
                      terms=[('BTCUSDT', {'price_increment': '0.01', 'size_increment': size})],
                      bars={('BTCUSDT', 'LAST'): columns, ('BTCUSDT', 'MARK'): {**columns, 'volume': np.zeros(1440, np.int64)}})
        return profile, commit

    def test_complete_month_exact_fidelity_metadata_history_restricted_account_and_cli_publication(self):
        profile, before = self.market()
        with patch.object(main.publication, 'unpublished', return_value=True), \
                patch.object(main.publication, 'publish', return_value={'checked': True}) as publish, \
                patch('sys.stdout', new_callable=io.StringIO) as out, patch('sys.stderr', new_callable=io.StringIO):
            rc = main.main(['market', 'import-trades', '--market', profile['name'], '--month', '2025-01',
                            '--symbols', 'BTCUSDT', '--cache-root', str(self.cache)])
        result = json.loads(out.getvalue())
        self.assertEqual(rc, 0)
        imported, = result['imports']
        self.assertEqual((result['trade_rows'], imported['codec']), (62, trades.CODEC))
        self.assertGreaterEqual(result['publish_seconds'], 0)
        self.assertEqual(publish.call_args.args[2], 'market-import:' + profile['database'])
        with store.connect(profile, 'reader') as conn:
            self.assertEqual(conn.rows('SELECT * FROM agg_trade ORDER BY transact_time,agg_trade_id'), self.expected)
            self.assertEqual(conn.rows(f"SELECT COUNT(*) FROM agg_trade AS OF '{before}'"), [(0,)])
            self.assertEqual(conn.rows('SELECT table_name FROM dolt_status'), [])
            message, = conn.rows('SELECT message FROM dolt_log WHERE commit_hash = %s', (imported['market_commit'],))[0]
            receipt = json.loads(message)
            self.assertEqual(len(receipt['archives']['BTCUSDT']), 32)
            self.assertEqual(sum(x['trades'] for x in receipt['readings']['BTCUSDT'].values()), 62)
            self.assertEqual(conn.rows('SELECT volume_scale FROM market_schema'), [(store.VOLUME_SCALE,)])
        with store.connect(profile, 'import') as conn:
            with self.assertRaises(sources.MarketError):
                conn.execute('UPDATE agg_trade SET quantity = 0')
        with self.assertRaises(sources.MarketError) as caught:
            trades.import_month(profile, JAN, self.cache, ['BTCUSDT'], log=lambda _: None)
        self.assertEqual(caught.exception.code, 'MONTH_EXISTS')

    def test_late_gap_or_precision_failure_rolls_back_all_days_and_import_lock_is_shared(self):
        profile, before = self.market()
        for bad, code in [('gap', 'SEQUENCE_GAP'), ('precision', 'SCALE_LOSS')]:
            with tempfile.TemporaryDirectory() as temp:
                # Hard links are unnecessary: these are tiny, isolated fixture archives.
                import shutil
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
            with store.connect(profile, 'reader') as conn:
                self.assertEqual(store.resolve_commit(conn, 'main'), before)
                self.assertEqual(conn.rows('SELECT COUNT(*) FROM agg_trade'), [(0,)])
                self.assertEqual(conn.rows('SELECT table_name FROM dolt_status'), [])
        with store.connect(profile, 'import') as holder:
            store.lock(holder)
            with self.assertRaises(sources.MarketError) as caught:
                trades.import_month(profile, JAN, self.cache, ['BTCUSDT'])
            self.assertEqual(caught.exception.code, 'CONCURRENT_IMPORT')

    def test_contracts_of_one_month_are_written_at_once_one_commit_each_and_a_refusal_keeps_the_others(self):
        import shutil
        days = list(enumerate(range(START - store.DAY, day_ms(date(2025, 2, 1)), store.DAY)))
        for bad in (False, True):
            profile, before = self.market(suffix='_refused' if bad else '')
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
            with store.connect(profile, 'reader') as conn:
                held = dict(conn.rows('SELECT symbol, COUNT(*) FROM agg_trade GROUP BY symbol'))
                self.assertEqual(conn.rows('SELECT table_name FROM dolt_status'), [])
                if bad:
                    self.assertEqual(caught.exception.code, 'SEQUENCE_GAP')
                    head = store.resolve_commit(conn, 'main')
                    self.assertIn(f'committed meanwhile: BTCUSDT {head}', caught.exception.message)
                    self.assertEqual(held, {'BTCUSDT': 62})
                    continue
                self.assertEqual(held, {'BTCUSDT': 62, 'ETHUSDT': 62})
                self.assertEqual(([item['symbols'] for item in imported['imports']], imported['trade_rows']),
                                 ([['BTCUSDT'], ['ETHUSDT']], 124))
                commits = {item['symbols'][0]: item['market_commit'] for item in imported['imports']}
                history = {commit for commit, in conn.rows('SELECT commit_hash FROM dolt_log')}
                self.assertLessEqual(set(commits.values()) | {before}, history)
                for symbol, commit in commits.items():
                    # Each commit adds its own contract's month to its parent, nothing else.
                    self.assertEqual(conn.rows('SELECT to_symbol, diff_type, COUNT(*) FROM dolt_diff_agg_trade '
                                               'WHERE to_commit = %s GROUP BY to_symbol, diff_type', (commit,)),
                                     [(symbol, 'added', 62)])
                    message, = conn.rows('SELECT message FROM dolt_log WHERE commit_hash = %s', (commit,))[0]
                    self.assertEqual(json.loads(message)['symbols'], [symbol])

    def test_export_gives_each_stored_trade_as_an_exact_trade_tick_only_on_request(self):
        from nautilus_trader.model import AggressorSide
        from nautilus_trader.persistence import ParquetDataCatalog
        low, high = START * 10**6, (START + store.DAY) * 10**6
        profile, _ = self.market(size='0.00000001')
        imported = trades.import_month(profile, JAN, self.cache, ['BTCUSDT'], log=lambda _: None)
        from market import coverage
        held = coverage.diagnose_coverage(profile, None, ['BTCUSDT'], '2024-12-31T00:00:00Z', '2025-02-02T00:00:00Z',
                                          None)['coverage'][0]['trades']
        self.assertEqual(held, {'imports': [{'month': '2025-01', 'through': '2025-02-01', 'codec': trades.CODEC,
                                             'commit': imported['imports'][0]['market_commit'], 'rows': 62}],
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
        coarse, _ = self.market(suffix='_coarse')
        trades.import_month(coarse, JAN, self.cache, ['BTCUSDT'], log=lambda _: None)
        with self.assertRaises(sources.MarketError) as caught:
            export.export_catalogs(coarse, None, ['BTCUSDT'], low, high, fresh=True, root=Path(self.temp.name),
                                   workers=1, include_trades=True)
        self.assertEqual(caught.exception.code, 'TRADE_INEXACT')

    def test_upgrade_and_complete_import_preserve_old_export_files_bytes_receipt_and_backup(self):
        profile, bar_commit = self.market()
        quotes = store.import_quotes(profile, JAN, self.cache, log=lambda _: None, symbols=['BTCUSDT'])
        # Model an old database with no new source table. This is the isolated fixture administrator.
        self.fixture.admin(profile, 'DROP TABLE agg_trade')
        self.fixture.admin(profile, "CALL DOLT_COMMIT('-A','--skip-verification','-m','fixture: before trades table')")
        with store.connect(profile, 'reader') as conn:
            old = store.resolve_commit(conn, 'main')
        low, high = START * 10**6, (START + store.DAY) * 10**6

        def snapshot(commit, episodes=None, evidence=None):
            found = export.export_catalogs(profile, commit, ['BTCUSDT'], low, high, episodes, evidence, fresh=True,
                                           root=Path(self.temp.name), workers=1)
            root = Path(found['root'])
            files = {str(p.relative_to(root)): p.read_bytes() for p in root.rglob('*') if p.is_file()}
            for name in list(files):
                if name.endswith('export.json'):
                    receipt = json.loads(files[name])
                    receipt.pop('seconds')
                    files[name] = json.dumps(receipt, sort_keys=True).encode()
            return files

        from market import lifecycle
        iid = 'BTCUSDT-E1-PERP.BINANCE'
        at = low + 3_600_000_000_000
        body = {'format': lifecycle.FORMAT, 'market_commit': old, 'episodes': [
            {'symbol': 'BTCUSDT', 'instrument_id': iid, 'start_ns': low, 'sources': ['notice.txt'],
             'events': [{'type': 'InstrumentStatus', 'instrument_id': iid, 'action': 'CLOSE',
                         'ts_event': at, 'ts_init': at, 'reason': 'fixture', 'trading_event': None,
                         'is_trading': None, 'is_quoting': None, 'is_short_sell_restricted': None},
                        {'type': 'InstrumentClose', 'instrument_id': iid, 'close_price': '100.01',
                         'close_type': 'CONTRACT_EXPIRED', 'ts_event': at,
                         'ts_init': at}]}]}
        evidence = {'lifecycle.json': json.dumps(body).encode(), 'notice.txt': b'fixture notice'}
        episodes = lifecycle.validate_lifecycle(body, old, evidence)
        baseline = (snapshot(bar_commit), snapshot(old), snapshot(old, episodes, evidence))
        made = db.upgrade_market(profile)
        self.assertEqual(made['created'], ['agg_trade'])
        self.assertEqual(db.upgrade_market(profile)['created'], [])
        trades.import_month(profile, JAN, self.cache, ['BTCUSDT'], log=lambda _: None)
        self.assertEqual((snapshot(bar_commit), snapshot(old), snapshot(old, episodes, evidence)), baseline)
        with store.connect(profile, 'reader') as conn:
            self.assertEqual(conn.rows(f"SELECT COUNT(*) FROM quote AS OF '{quotes['market_commit']}'"), [(31,)])
        profile = {**profile, 'backup': str(Path(self.temp.name) / 'backup')}
        backup = admin.market_backup(profile)
        from report import review
        self.assertTrue(review.market_review(profile)['ok'])
        self.assertIsNotNone(backup['market_commit'])
        restored = Path(self.temp.name) / 'restored'
        environment = {**os.environ, 'DOLT_ROOT_PATH': str(Path(self.temp.name) / 'restore-home'),
                       'DOLT_DISABLE_EVENT_FLUSH': '1'}
        for key, value in [('user.name', 'Isolated restore test'), ('user.email', 'test@example.invalid')]:
            configured = subprocess.run([BINARY, 'config', '--global', '--add', key, value], cwd=self.temp.name,
                                        env=environment, capture_output=True, text=True)
            self.assertEqual(configured.returncode, 0, configured.stderr)
        made = subprocess.run([BINARY, 'backup', 'restore', 'file://' + backup['backup_path'], 'restored'],
                              cwd=self.temp.name, env=environment, capture_output=True, text=True)
        self.assertEqual(made.returncode, 0, made.stderr)
        for table, commit, count in [('agg_trade', backup['market_commit'], 62), ('quote', quotes['market_commit'], 31)]:
            query = f"SELECT COUNT(*) AS n FROM {table} AS OF '{commit}'"
            read = subprocess.run([BINARY, 'sql', '-r', 'json', '-q', query], cwd=restored, env=environment,
                                  capture_output=True, text=True)
            self.assertEqual(read.returncode, 0, read.stderr)
            self.assertEqual(json.loads(read.stdout)['rows'], [{'n': count}])


if __name__ == '__main__':
    unittest.main()
