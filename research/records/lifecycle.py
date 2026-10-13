"""Read original lifecycle inputs from execution custody, without storing a second fact."""
import json
from decimal import Decimal

from research.records.common import RecordError


def events(coverage, summary):
    """Local directory facts only; ledger callers additionally verify original execution identity."""
    if not coverage.get('input_identity', {}).get('lifecycle_bundle'):
        return ()
    from backtest.load import ns
    if coverage.get('format') != 'execution-input-coverage-v1' or summary is None:
        raise RecordError('missing lifecycle execution coverage', code='EXECUTION_IDENTITY')
    config = coverage['effective_config']
    start, end = ns(config['start']), ns(config['end'])
    if (ns(summary['input_start_utc']) != start or ns(summary['period_end_utc']) != end
            or summary['market_commit'] != coverage['input_identity']['market_commit']):
        raise RecordError('lifecycle coverage differs from native summary', code='EXECUTION_IDENTITY')
    result = []
    for symbol, receipt in coverage['export_receipts'].items():
        for leaf in receipt.get('episodes', []):
            episode = leaf['episode']
            if episode['symbol'] != symbol or episode['instrument_id'] != leaf['instrument_id']:
                raise RecordError('lifecycle episode differs from its native instrument', code='EXECUTION_IDENTITY')
            supplied = [e for e in episode['events'] if e['type'] == 'InstrumentClose'
                        and start <= e['ts_init'] < end]
            if len(supplied) != leaf['counts']['instrument_close']:
                raise RecordError('lifecycle events differ from actual export count', code='EXECUTION_IDENTITY')
            for e in supplied:
                if (e['instrument_id'] != leaf['instrument_id'] or e['ts_event'] != e['ts_init']
                        or e['close_type'] != 'CONTRACT_EXPIRED' or not Decimal(e['close_price']).is_finite()
                        or Decimal(e['close_price']) <= 0):
                    raise RecordError('unsupported native expiration input', code='EXECUTION_IDENTITY')
            result.extend(supplied)
    keys = [(e['instrument_id'], e['ts_event']) for e in result]
    if len(set(keys)) != len(keys):
        raise RecordError('ambiguous duplicate expiration events', code='EXECUTION_IDENTITY')
    return tuple(result)


def original_events(conn, trial_id, input_identity, summary):
    """Only this trial's original capture can support a stored run; never later evidence."""
    if not input_identity.get('lifecycle_bundle'):
        return ()
    from research.records import db, execution
    capture = execution.read(conn, trial_id)
    if capture.get('status') != 'captured':
        raise RecordError('lifecycle run lacks original execution capture', code='EXECUTION_IDENTITY')
    if (capture.get('phase') != 'replay' or capture.get('outcome') != 'completed'
            or capture.get('runtime_failures') or set(capture.get('phases', {})) != {'native', 'audit'}
            or any(p is None or p.get('exit_code') != 0 for p in capture['phases'].values())):
        raise RecordError('lifecycle run lacks a completed native/audit execution', code='EXECUTION_IDENTITY')
    trial = db.one(conn, 'SELECT strategy_source_sha256, image_ref FROM trial WHERE trial_id = %s', (trial_id,))
    if (capture.get('trial_id') != trial_id or capture.get('source_sha256') != trial['strategy_source_sha256']
            or capture.get('image_ref') != trial['image_ref'] or summary is None
            or summary.get('strategy_source_sha256') != trial['strategy_source_sha256']
            or summary.get('runtime_identity', {}).get('image_ref') != trial['image_ref']):
        raise RecordError('lifecycle capture differs from run/source/runtime', code='EXECUTION_IDENTITY')
    files = execution._bundle(conn, f'trial-{trial_id}-execution')
    if 'input-coverage.json' not in files:
        raise RecordError('lifecycle run lacks original input coverage', code='EXECUTION_IDENTITY')
    coverage = json.loads(files['input-coverage.json'])
    if coverage.get('input_identity') != input_identity:
        raise RecordError('lifecycle capture differs from stored input identity', code='EXECUTION_IDENTITY')
    return events(coverage, summary)
