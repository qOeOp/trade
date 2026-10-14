"""Terminal flatness is native chronology, not final state or strategy self-report."""
import copy
import unittest

import pandas as pd

from backtest.checks.audit import lifecycle_findings


class TerminalFlatnessTests(unittest.TestCase):
    def facts(self):
        terminal = 1_767_571_200_000_000_000
        scope = dict(instrument_id='AIAUSDT-E1-PERP.BINANCE', strategy_id='R1-AIA-E1',
                     account_id='BINANCE-001', position_id='P')
        orders, fills, events = [], [], []
        for oid, side, timestamp in [('ENTRY', 'BUY', terminal-10_000_000_000),
                                      ('EXIT', 'SELL', terminal-2_000_000_000)]:
            init = dict(type='OrderInitialized', client_order_id=oid, event_id=oid+'-init',
                        order_side=side, order_type='MARKET', quantity='2',
                        ts_event=timestamp-1_000_000_000, **scope)
            accepted = dict(type='OrderAccepted', client_order_id=oid, event_id=oid+'-accept',
                            ts_event=timestamp-1_000_000_000, **scope)
            fill = dict(type='OrderFilled', client_order_id=oid, event_id=oid+'-fill', order_side=side,
                        order_type='MARKET', last_qty='2', last_px='1', trade_id=oid+'-trade',
                        ts_event=timestamp, **scope)
            orders.append(dict(client_order_id=oid, status='FILLED', side=side, type='MARKET',
                               quantity='2', filled_qty='2', **scope))
            fills.append({**fill, 'ts_event': str(pd.Timestamp(timestamp, tz='UTC'))})
            events.extend([init, accepted, fill])
        position = dict(events=repr([events[2], events[5]]), quantity='0', side='FLAT', **scope)
        close = dict(type='InstrumentStatus', action='CLOSE', instrument_id=scope['instrument_id'],
                     ts_event=terminal, ts_init=terminal)
        return [close], orders, fills, [position], events

    def test_empty_or_natively_closed_identity_passes(self):
        facts = self.facts(); original = copy.deepcopy(facts)
        self.assertEqual(lifecycle_findings(*facts), [])
        self.assertEqual(facts, original)
        self.assertEqual(lifecycle_findings(facts[0], [], [], [], []), [])

    def test_final_flatness_after_or_at_terminal_does_not_pass(self):
        for lag in [0, 1_000_000_000]:
            facts = self.facts()
            timestamp = facts[0][0]['ts_event']+lag
            facts[4][-1]['ts_event'] = timestamp
            facts[2][-1]['ts_event'] = str(pd.Timestamp(timestamp, tz='UTC'))
            facts[3][0]['events'] = repr([facts[4][2], facts[4][5]])
            self.assertTrue(lifecycle_findings(*facts))

    def test_partial_or_retained_position_fails(self):
        facts = self.facts()
        facts[4][-1]['last_qty'] = facts[2][-1]['last_qty'] = '1'
        facts[1][-1].update(status='PARTIALLY_FILLED', filled_qty='1')
        facts[3][0].update(events=repr([facts[4][2], facts[4][5]]), quantity='1', side='LONG')
        self.assertTrue(lifecycle_findings(*facts))

    def test_dormant_conditional_stop_pending_cancel_and_late_cancellation_fail(self):
        for kind in ['OrderInitialized', 'OrderAccepted', 'OrderEmulated', 'OrderPendingCancel', 'OrderCanceled']:
            facts = self.facts(); terminal = facts[0][0]['ts_event']
            event = {**facts[4][0], 'client_order_id': 'RESIDUAL', 'event_id': 'residual-init',
                     'order_type': 'STOP_MARKET', 'ts_event': terminal-1_000_000_000}
            facts[4].append(event)
            facts[1].append({**facts[1][0], 'client_order_id': 'RESIDUAL', 'type': 'STOP_MARKET',
                             'filled_qty': '0', 'status': 'CANCELED' if kind == 'OrderCanceled' else 'ACCEPTED'})
            if kind != 'OrderInitialized':
                facts[4].append({**event, 'type': kind, 'event_id': 'residual-last',
                                 'ts_event': terminal if kind == 'OrderCanceled' else terminal-1})
            with self.subTest(kind=kind):
                self.assertTrue(lifecycle_findings(*facts))

    def test_missing_capture_or_forged_flat_position_fails(self):
        facts = self.facts()
        self.assertTrue(lifecycle_findings(*facts[:-1], None))
        facts[3][0]['events'] = repr([facts[4][2]])
        self.assertTrue(lifecycle_findings(*facts))

    def test_unacknowledged_request_and_unknown_event_do_not_pass(self):
        for kind in ['OrderPendingCancel', 'OrderPendingUpdate', 'UnknownNativeEvent']:
            facts = self.facts()
            facts[4].append({**facts[4][-1], 'type': kind, 'event_id': 'in-flight',
                             'ts_event': facts[0][0]['ts_event']-1})
            with self.subTest(kind=kind):
                self.assertTrue(lifecycle_findings(*facts))

    def test_priced_native_expiration_keeps_existing_contract(self):
        facts = self.facts()
        facts[0].append(dict(type='InstrumentClose', instrument_id=facts[0][0]['instrument_id'],
                            ts_event=facts[0][0]['ts_event']))
        self.assertEqual(lifecycle_findings(*facts[:-1], None), [])
