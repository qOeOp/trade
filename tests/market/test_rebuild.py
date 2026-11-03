"""market rebuild in throwaway market directories: agg_trade, quote and metrics files deleted after their imports
and made again from their receipts. No active market or real network."""

from datetime import timedelta
import hashlib
import io
import json
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

from cli import main
from market import aggtrades as trades, metrics, rebuild, series, sources, store, versions
from tests.market.directory import head, move_head
from tests.market.exchange import zipped
from tests.market.test_aggtrades import JAN, archive, bars_market, fixture_archives, source_rows
from tests.market.test_metrics import day_text


def metrics_archives(cache: Path) -> None:
    """Every January day's metrics archive of BTCUSDT, with its .CHECKSUM, in `cache`."""
    for offset in range(31):
        key = sources.metrics_key('BTCUSDT', (JAN + timedelta(days=offset)).isoformat())
        body = zipped(Path(key).name.removesuffix('.zip') + '.csv', day_text(JAN + timedelta(days=offset)))
        target = cache / key
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(body)
        target.with_name(target.name + '.CHECKSUM').write_text(hashlib.sha256(body).hexdigest() + '  archive.zip\n')


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class RebuildTests(unittest.TestCase):
    def setUp(self):
        self.temp = Path(tempfile.mkdtemp(prefix='rebuild-test-'))
        self.addCleanup(shutil.rmtree, self.temp, True)
        self.cache = self.temp / 'cache'
        fixture_archives(self.cache)
        metrics_archives(self.cache)
        self.profile, _ = bars_market(self.addCleanup)
        self.root = Path(self.profile['root'])

    def imported(self) -> dict[str, dict]:
        """BTCUSDT's January trades, quotes and metrics imported; each table's entry."""
        quiet = lambda _: None  # noqa: E731
        trades.import_month(self.profile, JAN, self.cache, ['BTCUSDT'], log=quiet)
        store.import_quotes(self.profile, JAN, self.cache, 1, ['BTCUSDT'], log=quiet)
        metrics.import_month(self.profile, JAN, self.cache, ['BTCUSDT'], log=quiet)
        listed = versions.open_market(self.profile, 'reader').version['files']
        return {entry['table']: entry for entry in listed if entry['table'] in rebuild.KINDS}

    def path(self, entry: dict) -> Path:
        return self.root / 'files' / f"{entry['sha256']}.parquet"

    def refused(self, code: str, *args, **kwargs) -> sources.MarketError:
        with self.assertRaises(sources.MarketError) as caught:
            rebuild.rebuild(self.profile, self.cache, *args, log=lambda _: None, **kwargs)
        self.assertEqual(caught.exception.code, code)
        return caught.exception

    def test_missing_files_are_made_again_byte_for_byte_and_nothing_else_changes(self):
        entries = self.imported()
        before = head(self.profile)
        versions_before = sorted(path.name for path in (self.root / 'versions').iterdir())
        for entry in entries.values():
            self.path(entry).unlink()
        with self.assertRaises(sources.MarketError) as caught, versions.lock(versions.open_market(self.profile, 'import')):
            pass
        self.assertEqual(caught.exception.code, 'HEAD_INCOMPLETE')  # an import waits for the rebuild
        (self.root / 'files' / '.rebuild-killed').mkdir()  # left by a rebuild killed midway
        self.refused('IMPORT_SCOPE', ['bar'])
        done = rebuild.rebuild(self.profile, self.cache, ['metrics'], log=lambda _: None)
        self.assertEqual(done['rebuilt'], [entries['metrics']['sha256']])
        self.assertFalse(self.path(entries['quote']).exists())
        profile = self.temp / 'market.json'
        profile.write_text(json.dumps({'name': 'rebuild', 'kind': 'market', 'role': 'isolated', **self.profile}))
        with patch('sys.stdout', new_callable=io.StringIO) as out, patch('sys.stderr', new_callable=io.StringIO):
            rc = main.main(['market', 'rebuild', '--market', str(profile), '--symbols', 'BTCUSDT',
                            '--cache-root', str(self.cache)])
        self.assertEqual(rc, 0)
        self.assertEqual(sorted(json.loads(out.getvalue())['rebuilt']),
                         sorted(entries[table]['sha256'] for table in ('agg_trade', 'quote')))
        for entry in entries.values():
            self.assertEqual(sha(self.path(entry)), entry['sha256'])
        self.assertEqual((head(self.profile), sorted(path.name for path in (self.root / 'versions').iterdir())),
                         (before, versions_before))
        self.assertEqual(list((self.root / 'files').glob('.*')), [])
        self.assertEqual(rebuild.rebuild(self.profile, self.cache, log=lambda _: None)['rebuilt'], [])
        with versions.lock(versions.open_market(self.profile, 'import')):
            pass  # complete again

    def test_an_archive_changed_since_the_import_refuses_its_files_and_keeps_none(self):
        entries = self.imported()
        for entry in entries.values():
            self.path(entry).unlink()
        day = '2025-01-05'
        archive(self.cache, day, source_rows(series._day_ms(JAN + timedelta(days=4)), 9))  # republished
        error = self.refused('ARCHIVE_CHANGED')
        self.assertIn('2 of 3 files were not rebuilt (1 were)', error.message)
        self.assertIn(f'BTCUSDT-aggTrades-{day}.zip has SHA-256', error.message)
        self.assertEqual([self.path(entries[table]).exists() for table in ('agg_trade', 'quote', 'metrics')],
                         [False, False, True])
        self.assertEqual(list((self.root / 'files').glob('.*')), [])
        key = sources.metrics_key('BTCUSDT', '2025-01-01')
        (self.cache / key).unlink()
        self.path(entries['metrics']).unlink()
        with patch.object(sources, '_get', side_effect=sources._NotPublished(key)):  # withdrawn
            error = self.refused('ARCHIVE_CHANGED', ['metrics'])
        self.assertIn('which the receipt records, is no longer published', error.message)

    def test_an_eve_published_after_the_import_refuses(self):
        eve = (JAN - timedelta(days=1)).isoformat()
        withdrawn = self.cache / sources.aggtrades_key('BTCUSDT', eve)
        kept = withdrawn.read_bytes()
        withdrawn.unlink()
        with patch.object(sources, '_get', side_effect=sources._NotPublished(eve)):
            entry = self.imported()['agg_trade']
        market = versions.open_market(self.profile, 'reader')
        self.assertNotIn(eve, versions.receipts(market, market.head, trades.IMPORT)[0]['archives']['BTCUSDT'])
        self.path(entry).unlink()
        with patch.object(sources, '_get', side_effect=sources._NotPublished(eve)):
            self.assertEqual(rebuild.rebuild(self.profile, self.cache, ['agg_trade'], log=lambda _: None)['rebuilt'],
                             [entry['sha256']])
        self.path(entry).unlink()
        withdrawn.write_bytes(kept)
        error = self.refused('ARCHIVE_CHANGED', ['agg_trade'])
        self.assertIn('was not published when the import ran and is now', error.message)

    def test_a_file_the_current_code_makes_otherwise_names_the_image_of_its_writer(self):
        writer = 'a' * 40
        with patch.object(versions, 'writer', return_value=writer):
            entry = self.imported()['agg_trade']
        self.path(entry).unlink()
        with patch.object(versions, 'ROW_GROUP', 10):  # this code lays the rows out otherwise
            with patch.object(versions, 'writer', return_value='b' * 40):
                error = self.refused('REBUILD_DIFFERS', ['agg_trade'])
            self.assertIn(f'the version lists {entry["sha256"]}; the receipt differs in nothing', error.message)
            self.assertIn(f'in {rebuild.IMAGE.format(writer)}, `python -m cli.main market rebuild --tables agg_trade '
                          '--symbols BTCUSDT`', error.message)
            with patch.object(versions, 'writer', return_value=writer):
                self.assertIn(f'this code ({writer}) wrote it', self.refused('REBUILD_DIFFERS', ['agg_trade']).message)
        self.assertFalse(self.path(entry).exists())
        self.assertEqual(rebuild.rebuild(self.profile, self.cache, ['agg_trade'], log=lambda _: None)['rebuilt'],
                         [entry['sha256']])

    def test_a_replaced_file_is_not_rebuilt_and_its_replacement_comes_from_its_own_receipt(self):
        old = self.imported()['agg_trade']
        market = versions.open_market(self.profile, 'import')
        parent = market.version
        # The 5th's archive republished, and the month imported again: a base without the old file, as
        # `market replace` writes it.
        archive(self.cache, '2025-01-05', source_rows(series._day_ms(JAN + timedelta(days=4)), 11))
        with versions.lock(market):
            job = store.contract_job(market, 'agg_trade', 'BTCUSDT', cache=str(self.cache), start=old['start_ms'],
                                     end=old['end_ms'], held=False, earlier=False)
            job['files'] = []
            made = trades.trade_month(job)
        receipt = versions.canonical({**made['receipt'], 'writer': None})
        receipt_sha = hashlib.sha256(receipt).hexdigest()
        (self.root / 'files' / f'{receipt_sha}.json').write_bytes(receipt)
        replaced = {'market_schema': parent['market_schema'], 'parent': market.head,
                    'files': [entry for entry in parent['files'] if entry != old] + [made['entry']],
                    'receipts': parent['receipts'] + [receipt_sha]}
        commit = versions.version_id(replaced)
        (self.root / 'versions' / f'{commit}.json').write_bytes(versions.canonical(replaced))
        move_head(self.profile, commit)
        self.assertEqual(versions.own(versions.open_market(self.profile, 'reader'), commit),
                         {'files': [made['entry']], 'receipts': [receipt_sha]})
        self.path(old).unlink()
        self.path(made['entry']).unlink()
        done = rebuild.rebuild(self.profile, self.cache, log=lambda _: None)
        self.assertEqual(done['rebuilt'], [made['entry']['sha256']])
        self.assertEqual(sha(self.path(made['entry'])), made['entry']['sha256'])
        self.assertFalse(self.path(old).exists())


if __name__ == '__main__':
    unittest.main()
