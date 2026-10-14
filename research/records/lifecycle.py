"""Read original lifecycle inputs from execution custody, without storing a second fact."""
import json

from research.records.common import RecordError


def events(coverage, summary):
    """Local directory facts only; ledger callers additionally verify original execution identity."""
    from backtest.load import lifecycle_events
    try:
        return lifecycle_events(coverage, summary)
    except (KeyError, TypeError, ValueError, ArithmeticError) as error:
        raise RecordError(str(error), code='EXECUTION_IDENTITY') from error


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
    files = execution._bundle(conn, f'trial-{trial_id}-execution', {'input-coverage.json'})
    if 'input-coverage.json' not in files:
        raise RecordError('lifecycle run lacks original input coverage', code='EXECUTION_IDENTITY')
    coverage = json.loads(files['input-coverage.json'])
    if coverage.get('input_identity') != input_identity:
        raise RecordError('lifecycle capture differs from stored input identity', code='EXECUTION_IDENTITY')
    return events(coverage, summary)
