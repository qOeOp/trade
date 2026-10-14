"""Strict expiration ownership from linked native facts; ordinary untagged orders still refuse."""
import copy
import ast
import unittest
from decimal import Decimal
import json
from unittest.mock import patch

from research.records import analysis
from research.records.lifecycle import events, original_events
from research.records.common import RecordError


class ExpirationOwnershipTests(unittest.TestCase):
    def facts(self, short=False):
        iid, pid, sid = 'AIAUSDT-E1-PERP.BINANCE', 'POSITION', 'R1-AIA-E1'
        ts, stamp = 1_767_571_200_000_000_000, '2026-01-05 00:00:00+00:00'
        identity = dict(instrument_id=iid, position_id=pid, strategy_id=sid, trader_id='TRADER', account_id='BINANCE-001')
        oid = 'EXPIRATION-BINANCE-SYNTHETIC'
        opening_side, closing_side = ('SELL', 'BUY') if short else ('BUY', 'SELL')
        entry = dict(type='OrderFilled', event_id='entry-fill', client_order_id='ENTRY', order_side=opening_side, order_type='MARKET',
                     last_qty='2', last_px='1', ts_event=ts-10_000_000_000, ts_init=ts-10_000_000_000, **identity)
        fill = dict(type='OrderFilled', event_id='close-fill', client_order_id=oid, order_side=closing_side,
                    order_type='MARKET', last_qty='2', last_px='0.1234500', ts_event=ts, ts_init=ts,
                    venue_order_id='VENUE-CLOSE', trade_id='TRADE', commission='0.00012345 USDT',
                    currency='USDT', liquidity_side='TAKER', **identity)
        init = dict(type='OrderInitialized', event_id='init', client_order_id=oid, order_side=closing_side,
                    order_type='MARKET', reduce_only=True, tags=['EXPIRATION_BINANCE_CLOSE'], quantity='2',
                    ts_event=ts, ts_init=ts, **identity)
        accepted = dict(type='OrderAccepted', event_id='accepted', client_order_id=oid, venue_order_id='VENUE-CLOSE',
                        ts_event=ts, ts_init=ts, **identity)
        orders = [dict(client_order_id='ENTRY', tags="['plan:P']", status='FILLED', side=opening_side, type='MARKET', ts_init=str(entry['ts_event']),
                       ts_last=str(entry['ts_event']), **identity),
                  dict(client_order_id=oid, tags="['EXPIRATION_BINANCE_CLOSE']", type='MARKET', side=closing_side,
                       status='FILLED', quantity='2', filled_qty='2', is_reduce_only='True', init_id='init',
                       ts_init=str(ts), ts_last=str(ts), venue_order_id='VENUE-CLOSE', **identity)]
        positions = [dict(events=repr([entry, fill]), closing_order_id=oid, ts_closed=stamp, ts_last=str(ts), quantity='0', side='FLAT', **identity)]
        fills = [{**entry, 'ts_event': '2026-01-04 23:59:50+00:00', 'ts_init': '2026-01-04 23:59:50+00:00'},
                 {**fill, 'ts_event': stamp, 'ts_init': stamp}]
        cycles = [dict(closed=True, realized=Decimal('-1'), event_ids=['entry-fill', 'close-fill'])]
        close = dict(type='InstrumentClose', instrument_id=iid, close_type='CONTRACT_EXPIRED', close_price='0.12345',
                     ts_event=ts, ts_init=ts)
        return orders, fills, positions, cycles, [init, accepted, fill, entry], (close,)

    def test_long_and_short_expiration_inherit_unique_plan_without_editing_native_tags(self):
        for short in (False, True):
            facts = self.facts(short); original = copy.deepcopy(facts)
            self.assertEqual(analysis._plans(*facts), dict(closed=1, wins=0, win_rate=0.0, open=0))
            self.assertEqual(facts, original)

    def test_incomplete_or_conflicting_evidence_never_exempts_untagged_order(self):
        cases = []
        def case(edit):
            facts = copy.deepcopy(self.facts()); edit(facts); cases.append(facts)
        case(lambda f: f[4].pop(2))
        case(lambda f: f[5][0].update(close_price='0.12346'))
        case(lambda f: f[5][0].update(ts_event=f[5][0]['ts_event']+1))
        case(lambda f: f[1][-1].update(last_qty='3'))
        case(lambda f: f[1][-1].update(account_id='OTHER'))
        case(lambda f: f[1][-1].update(event_id='ORPHAN'))
        case(lambda f: f[0][-1].update(status='CANCELED', filled_qty='0'))
        case(lambda f: f[0][-1].update(tags='[]'))
        case(lambda f: f[0][-1].update(client_order_id='SOURCE-IMPOSTOR'))
        case(lambda f: f[0][0].update(tags='[]'))
        case(lambda f: f[0][0].update(tags="['plan:P','plan:Q']"))
        case(lambda f: f[2][0].update(quantity='1', side='LONG'))
        def corrupt_close_direction(f):
            f[1][-1]['order_side'] = 'BUY'
            f[4][2]['order_side'] = 'BUY'
            events = ast.literal_eval(f[2][0]['events'])
            events[-1]['order_side'] = 'BUY'
            f[2][0]['events'] = repr(events)
        case(corrupt_close_direction)
        case(lambda f: f[2].append(copy.deepcopy(f[2][0])) or f[3].append(copy.deepcopy(f[3][0])))
        for index, facts in enumerate(cases):
            with self.subTest(index=index), self.assertRaises(analysis._Unreconciled):
                analysis._plans(*facts)
        facts = self.facts()
        with self.assertRaises(analysis._Unreconciled):
            analysis._plans(*facts[:4])
        with self.assertRaises(analysis._Unreconciled):
            analysis._plans(*facts[:5], ())


class LifecycleCustodyTests(unittest.TestCase):
    def facts(self):
        event = ExpirationOwnershipTests().facts()[-1][0]
        identity = {'market_commit': 'fixed', 'lifecycle_bundle': 'life'}
        episode = {'symbol': 'AIAUSDT', 'instrument_id': event['instrument_id'], 'events': [event]}
        leaf = {'episode': episode, 'instrument_id': event['instrument_id'], 'counts': {'instrument_close': 1}}
        coverage = {'format': 'execution-input-coverage-v1', 'input_identity': identity,
                    'effective_config': {'start': '2026-01-04T00:00:00Z', 'end': '2026-01-06T00:00:00Z'},
                    'export_receipts': {'AIAUSDT': {'episodes': [leaf]}}}
        summary = {'input_start_utc': '2026-01-04T00:00:00Z', 'period_end_utc': '2026-01-06T00:00:00Z',
                   'per_coin': [{'instrument': event['instrument_id'], 'counts': leaf['counts'].copy()}],
                   'market_commit': 'fixed', 'strategy_source_sha256': 'source', 'runtime_identity': {'image_ref': 'image'}}
        capture = {'status': 'captured', 'trial_id': 3, 'source_sha256': 'source', 'image_ref': 'image',
                   'phase': 'replay', 'outcome': 'completed', 'runtime_failures': [],
                   'phases': {'native': {'exit_code': 0}, 'audit': {'exit_code': 0}}}
        return identity, coverage, summary, capture

    def test_leaf_event_count_and_identity_reject_duplicate_or_changed_facts(self):
        _, coverage, summary, _ = self.facts()
        self.assertEqual(len(events(coverage, summary)), 1)
        for kind in ('count', 'identity', 'duplicate'):
            value = copy.deepcopy(coverage)
            leaf = value['export_receipts']['AIAUSDT']['episodes'][0]
            if kind == 'count': leaf['counts']['instrument_close'] = 0
            if kind == 'identity': leaf['instrument_id'] = 'OTHER.BINANCE'
            if kind == 'duplicate': value['export_receipts']['AIAUSDT']['episodes'].append(copy.deepcopy(leaf))
            with self.subTest(kind=kind), self.assertRaises(RecordError):
                events(value, summary)

    def test_unpriced_terminal_clock_and_status_count_are_original_input_facts(self):
        from nautilus_trader.model import InstrumentId, InstrumentStatus, MarketStatusAction
        _, coverage, summary, _ = self.facts()
        leaf = coverage['export_receipts']['AIAUSDT']['episodes'][0]
        close = leaf['episode']['events'][0]
        status = InstrumentStatus(InstrumentId.from_str(close['instrument_id']), MarketStatusAction.CLOSE,
                                  close['ts_event'], close['ts_init']).to_dict()
        leaf['episode']['events'] = [status]
        leaf['counts'] = {'instrument_close': 0, 'instrument_status': 1}
        summary['per_coin'][0]['counts'] = leaf['counts'].copy()
        self.assertEqual(events(coverage, summary), (status,))
        leaf['counts']['instrument_status'] = 0
        with self.assertRaises(RecordError):
            events(coverage, summary)

    def test_native_lifecycle_counts_cannot_be_silently_dropped(self):
        _, coverage, summary, _ = self.facts()
        for kind in ('identity', 'episodes', 'native_count', 'native_instrument'):
            value = copy.deepcopy(coverage)
            native = copy.deepcopy(summary)
            if kind == 'identity': value['input_identity'].pop('lifecycle_bundle')
            if kind == 'episodes': value['export_receipts']['AIAUSDT'].pop('episodes')
            if kind == 'native_count': native['per_coin'][0]['counts']['instrument_close'] = 2
            if kind == 'native_instrument': native['per_coin'][0]['instrument'] = 'OTHER.BINANCE'
            with self.subTest(kind=kind), self.assertRaises(RecordError):
                events(value, native)

    def test_original_capture_is_required_and_identity_conflicts_do_not_downgrade_to_empty(self):
        identity, coverage, summary, capture = self.facts()
        def read(value, data, native_summary):
            with patch('research.records.execution.read', return_value=value) as check, \
                 patch('research.records.db.one', return_value={'strategy_source_sha256': 'source', 'image_ref': 'image'}), \
                 patch('research.records.execution._bundle', return_value={'input-coverage.json': json.dumps(data).encode()}):
                result = original_events(None, 3, identity, native_summary)
                check.assert_called_once_with(None, 3)
                return result
        self.assertEqual(len(read(capture, coverage, summary)), 1)
        cases = [({**capture, 'status': 'missing'}, coverage, summary),
                 ({**capture, 'outcome': 'interrupted'}, coverage, summary),
                 (capture, {**coverage, 'input_identity': {**identity, 'lifecycle_bundle': 'other'}}, summary),
                 (capture, coverage, {**summary, 'strategy_source_sha256': 'other'})]
        for index, (value, data, native_summary) in enumerate(cases):
            with self.subTest(index=index), self.assertRaises(RecordError):
                read(value, data, native_summary)
        with patch('research.records.execution.read') as check:
            self.assertEqual(original_events(None, 3, {'market_commit': 'legacy'}, summary), ())
            check.assert_not_called()

