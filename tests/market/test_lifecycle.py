"""Episode isolation and byte-preserving native Catalog input; no account simulator."""
import copy
import tempfile
import unittest

import numpy as np
from nautilus_trader.model import (InstrumentClose, InstrumentCloseType, InstrumentId,
                                   InstrumentStatus, MarketStatusAction, Price)
from nautilus_trader.persistence import ParquetDataCatalog

from backtest.load import episode_active, episode_membership
from research.market import lifecycle
from research.records.common import RecordError


class LifecycleInputsTests(unittest.TestCase):
    def setUp(self):
        iid = InstrumentId.from_str('AIAUSDT-E1-PERP.BINANCE')
        self.status = InstrumentStatus(iid, MarketStatusAction.PRE_CLOSE, 120_000_000_000, 120_000_000_000).to_dict()
        self.close = InstrumentClose(iid, Price.from_str('0.12345678'), InstrumentCloseType.CONTRACT_EXPIRED,
                                     180_000_000_000, 180_000_000_000).to_dict()
        self.episode = dict(symbol='AIAUSDT', instrument_id=str(iid), start_ns=60_000_000_000,
                            events=[self.status, self.close], sources=['original.txt'])
        self.manifest = dict(format='native-lifecycle-v1', market_commit='fixed', episodes=[self.episode])
        self.files = {'lifecycle.json': b'{}', 'original.txt': b'explicit synthetic engineering fixture'}

    def test_pinned_native_catalog_roundtrip_preserves_exact_price_and_events(self):
        with tempfile.TemporaryDirectory() as root:
            self.assertEqual(lifecycle.write_events(root, self.episode, 0, 240_000_000_000),
                             {'instrument_close': 1, 'instrument_status': 1})
            catalog = ParquetDataCatalog(root)
            self.assertEqual([v.to_dict() for v in catalog.query('instrument_closes')], [self.close])
            self.assertEqual([v.to_dict() for v in catalog.query('instrument_status')], [self.status])

    def test_episode_filters_completed_minutes_without_mutating_canonical_rows(self):
        rows = {'ts_open': np.array([0, 60_000, 120_000, 180_000]), 'volume': np.array([1, 2, 3, 4])}
        output = lifecycle.project(rows, self.episode)
        self.assertEqual(output['ts_open'].tolist(), [60_000, 120_000])
        self.assertEqual(rows['ts_open'].tolist(), [0, 60_000, 120_000, 180_000])
        self.assertEqual(episode_membership([(0, 240_000_000_000)], self.episode),
                         ((60_000_000_000, 120_000_000_000),))
        self.assertEqual(episode_membership([(200_000_000_000, 240_000_000_000)], self.episode), ())

    def test_fixed_commit_originals_and_mapping_are_required(self):
        self.assertEqual(lifecycle.validate(self.manifest, 'fixed', self.files), {'AIAUSDT': [self.episode]})
        cases = []
        wrong_commit = copy.deepcopy(self.manifest)
        wrong_commit['market_commit'] = 'other'
        cases.append(wrong_commit)
        wrong_identity = copy.deepcopy(self.manifest)
        wrong_identity['episodes'][0]['instrument_id'] = 'BTCUSDT-PERP.BINANCE'
        cases.append(wrong_identity)
        missing_source = copy.deepcopy(self.manifest)
        missing_source['episodes'][0]['sources'] = ['absent']
        cases.append(missing_source)
        no_price = copy.deepcopy(self.manifest)
        no_price['episodes'][0]['events'][-1]['close_price'] = '0'
        cases.append(no_price)
        for value in cases:
            with self.subTest(value=value), self.assertRaises((RecordError, ValueError)):
                lifecycle.validate(value, 'fixed', self.files)

    def test_relisting_requires_closed_old_identity_and_explicit_new_start(self):
        second = dict(symbol='AIAUSDT', instrument_id='AIAUSDT-E2-PERP.BINANCE',
                      start_ns=240_000_000_000, events=[], sources=['original.txt'])
        manifest = {**self.manifest, 'episodes': [self.episode, second]}
        self.assertEqual(len(lifecycle.validate(manifest, 'fixed', self.files)['AIAUSDT']), 2)
        for start in (None, 170_000_000_000):
            with self.subTest(start=start), self.assertRaises(RecordError):
                lifecycle.validate({**manifest, 'episodes': [self.episode, {**second, 'start_ns': start}]},
                                   'fixed', self.files)
        with self.assertRaises(RecordError):
            lifecycle.validate({**manifest, 'episodes': [{**self.episode, 'events': [self.status]}, second]},
                               'fixed', self.files)

    def test_events_before_window_are_not_replayed_and_expired_identity_is_inactive(self):
        with tempfile.TemporaryDirectory() as root:
            self.assertEqual(lifecycle.write_events(root, self.episode, 200_000_000_000, 300_000_000_000),
                             {'instrument_close': 0, 'instrument_status': 0})
        self.assertEqual(episode_membership([(200_000_000_000, 300_000_000_000)], self.episode), ())
        self.assertFalse(episode_active(self.episode, 200_000_000_000, 300_000_000_000))
        self.assertTrue(episode_active(self.episode, 0, 100_000_000_000))
        self.assertFalse(episode_active(self.episode, 0, 50_000_000_000))
        self.assertTrue(episode_active(None, 0, 50_000_000_000))

    def test_listing_inside_minute_never_imports_prelisting_ohlc(self):
        rows = {'ts_open': np.array([60_000, 120_000]), 'volume': np.array([7, 8])}
        episode = {**self.episode, 'start_ns': 70_000_000_000}
        self.assertEqual(lifecycle.project(rows, episode)['ts_open'].tolist(), [120_000])

    def test_originals_change_input_digest_and_cannot_escape_export_root(self):
        changed = {**self.files, 'original.txt': b'changed'}
        self.assertNotEqual(lifecycle.files_digest(self.files), lifecycle.files_digest(changed))
        with self.assertRaises(RecordError):
            lifecycle.validate(self.manifest, 'fixed', {**self.files, '../outside': b'x'})

