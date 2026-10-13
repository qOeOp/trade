"""Preregistration and atomic replay custody; research reasoning stays with the Agent.

Registration uses existing immutable evidence, lineage uses strategy_revision. Only the
execution relation is new: which registered source was consumed by which attempted replay.
No significance, target, recommendation or economic exclusion confers candidate identity.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

from research.records import db, records
from research.records.common import RecordError

PLAN_PATH = 'research-plan.json'
FORMAT = 'research-plan-v1'
FIELDS = {'parent', 'control_run', 'change', 'rationale', 'prediction', 'sources', 'metric', 'grid',
          'conditions', 'comparison'}


def refuse(message, code='REGISTRATION_INVALID'):
    return RecordError(message, code=code, write_status='not_written')


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False).encode()


def require_schema(conn):
    row = db.one(conn, 'SELECT version FROM ledger_schema')
    if row is None or row['version'] != 2:
        raise refuse('continuous research needs a newly initialized isolated schema-v2 ledger; old ledgers are unchanged',
                     'RESEARCH_SCHEMA_REQUIRED')


def input_key(value):
    """Content identity independent of host paths; include MARK identity if the contract gains it."""
    return {key: item for key, item in value.items() if not key.endswith('_root') and key != 'checked'}


def config_key(value):
    return {key: item for key, item in value.items() if key not in
            {'catalog_root', 'daily_root', 'quantity_csv', 'mark_root', 'market_root', 'pool'}}


def validate(conn, body, execution, *, before_replay=False):
    require_schema(conn)
    if not isinstance(body, dict) or set(body) not in (FIELDS, FIELDS | {'retry_of'}):
        raise refuse(f'plan has exactly {sorted(FIELDS)}')
    for key in ('change', 'rationale', 'prediction', 'conditions'):
        records._note(body[key])
    if body['metric'] != 'annual_return':
        raise refuse('only annual_return paired inference is defined; other metric tests require an explicit design',
                     'METRIC_UNSUPPORTED')
    from research.records.comparison import validate_design
    validate_design(body['comparison'])
    if not isinstance(body['sources'], list) or not body['sources']:
        raise refuse('sources names at least one retained evidence bundle (mechanism conjecture may be stated there)')
    for bundle in body['sources']:
        records._id(bundle, 'source bundle', records.BUNDLE)
        if not db.one(conn, 'SELECT bundle FROM evidence_bundle WHERE bundle = %s', (bundle,)):
            raise refuse(f'unknown source evidence {bundle}')
    grid = body['grid']
    if not isinstance(grid, list) or not 1 <= len(grid) <= 5:
        raise refuse('grid needs one to five fixed source revisions')
    parent = records.strategy(conn, body['parent']) if body['parent'] is not None else None
    if (parent is None) != (body['control_run'] is None):
        raise refuse('root has neither parent nor control; a derived experiment names both independently')
    goal = records.read_goal(conn)
    config = execution['effective_config']
    if (records._utc(config['trade_start'], 'trade_start'), records._utc(config['end'], 'end')) != (
            goal['window_start'], goal['window_end']):
        raise refuse('registration must cover the fixed development window', 'WINDOW_MISMATCH')
    if parent:
        if not db.one(conn, 'SELECT r.run_id FROM run r JOIN trial t ON t.trial_id = r.trial_id '
                    'JOIN research_execution e ON e.trial_id = t.trial_id '
                    "WHERE t.strategy_source_sha256 = %s AND r.status = 'passed'",
                    (parent['source_sha256'],)):
            raise refuse('research parent needs a registered replay that passed integrity, regardless of economics',
                         'PARENT_NOT_VALID')
        control = records._run_with_trial(conn, body['control_run'])
        check_comparable(control, execution)
    seen = set()
    for cell in grid:
        if not isinstance(cell, dict) or set(cell) != {'strategy', 'parameters'}:
            raise refuse('each grid cell has strategy and parameters')
        records._note(cell['parameters'])
        row = records.strategy(conn, cell['strategy'])
        lineage = (row['parent_strategy_id'], row['parent_revision'])
        expected = (parent['strategy_id'], parent['revision']) if parent else (None, None)
        if lineage != expected or (parent and row['difference'] != body['change']):
            raise refuse(f"{cell['strategy']}: parent/difference disagrees with the locked rule change", 'LINEAGE_MISMATCH')
        if row['runtime_contract'] != execution['runtime']['runtime_contract']:
            raise refuse('source and runtime contracts differ', 'CONFIG_MISMATCH')
        if row['source_sha256'] in seen:
            raise refuse('duplicate source in grid')
        seen.add(row['source_sha256'])
        if before_replay and db.one(conn, 'SELECT trial_id FROM trial WHERE strategy_source_sha256 = %s',
                                     (row['source_sha256'],)):
            retry = body.get('retry_of')
            if not retry or not db.one(conn, 'SELECT trial_id FROM research_execution WHERE bundle = %s '
                                      'AND strategy_source_sha256 = %s', (retry, row['source_sha256'])):
                raise refuse('exposed source needs explicit retry_of its prior registered attempt; never backfill',
                             'SOURCE_ALREADY_EXPOSED')
    return seen


def check_comparable(run, execution):
    """Fail closed before inference on identity, integrity and full execution conditions."""
    if run['status'] != 'passed' or run['mode'] != 'sealed':
        raise refuse('comparison requires an audited sealed run; invalid has no economic feedback', 'RUN_NOT_PASSED')
    conflicts = []
    if run['image_ref'] != execution['runtime']['image_ref']:
        conflicts.append('runtime image')
    if config_key(json.loads(run['effective_config'])) != config_key(execution['effective_config']):
        conflicts.append('effective configuration/account/window/coins')
    if input_key(json.loads(run['input_identity'])) != input_key(execution['input_identity']):
        conflicts.append('input content identity')
    if conflicts:
        raise refuse('not comparable: ' + ', '.join(conflicts), 'COMPARABILITY_MISMATCH')


def register(profile, *, bundle, body, runtime, market, at, runner_argv):
    """Probe pinned runtime and export immutable market inputs before atomic registration."""
    from research.records.artifacts import _runner_inputs, _container_runner_args, market_inputs, _cleanup
    from research.records.runtime import resolve, inspect_runtime
    records._id(bundle, 'hypothesis bundle', records.BUNDLE)
    replay = _runner_inputs(runner_argv)
    identity = resolve(runtime)
    inputs = market_inputs(market, at, replay, fresh=True)
    try:
        args, _ = _container_runner_args(runner_argv, inputs)
        inspection = inspect_runtime(identity, args)
        execution = {'runtime': identity, 'effective_config': inspection['effective_config'],
                     'input_identity': inputs['identity']}
    finally:
        _cleanup(inputs)
    content = canonical({'format': FORMAT, 'body': body, 'execution': execution,
                         'reader_revision': records.reader_revision()})
    sha = hashlib.sha256(content).hexdigest()
    op = db.op_id('hypothesis', {'bundle': bundle, 'sha': sha})

    def insert(conn):
        validate(conn, body, execution, before_replay=True)
        db.rows(conn, 'INSERT INTO evidence_bundle (bundle, op_id, created_at) VALUES (%s, %s, UTC_TIMESTAMP(6))',
                (bundle, op))
        db.rows(conn, 'INSERT INTO evidence (bundle, path, content) VALUES (%s, %s, %s)', (bundle, PLAN_PATH, content))
        return {'bundle': bundle, 'files': {PLAN_PATH: sha}}

    return db.write(profile, kind='hypothesis', op=op, table='evidence_bundle', insert=insert,
                    replay=lambda c, r: {'bundle': r['bundle'], 'files': {PLAN_PATH: sha}})


def load(conn, bundle):
    require_schema(conn)
    row = db.one(conn, 'SELECT e.content, e.sha256, b.created_at FROM evidence e '
                      'JOIN evidence_bundle b ON b.bundle = e.bundle WHERE e.bundle = %s AND e.path = %s',
                 (bundle, PLAN_PATH))
    if row is None:
        raise refuse(f'unknown hypothesis registration {bundle}', 'REGISTRATION_REQUIRED')
    if hashlib.sha256(row['content']).hexdigest() != row['sha256']:
        raise refuse('registration bytes disagree with stored hash', 'LEDGER_CORRUPT')
    try:
        value = json.loads(row['content'])
        if value['format'] != FORMAT:
            raise ValueError('format')
        validate(conn, value['body'], value['execution'])
    except (KeyError, TypeError, ValueError) as exc:
        raise refuse(f'invalid stored registration: {exc}') from exc
    return value, row['created_at']


def bind(conn, registration, *, source_sha256, trial_id):
    """Called inside the existing trial write transaction, before any native subprocess."""
    bundle = registration['bundle']
    value, registered_at = load(conn, bundle)
    actual = registration['execution']
    if canonical(value['execution']) != canonical(actual):
        raise refuse('replay differs from preregistered runtime, input identity or effective configuration',
                     'EXECUTION_MISMATCH')
    sources = validate(conn, value['body'], actual)
    if source_sha256 not in sources:
        raise refuse('source is outside the registered grid', 'SOURCE_MISMATCH')
    trial = db.one(conn, 'SELECT * FROM trial WHERE trial_id = %s', (trial_id,))
    if trial['created_at'] <= registered_at:
        raise refuse('registration must precede the trial', 'REGISTRATION_TOO_LATE')
    if db.one(conn, 'SELECT trial_id FROM research_execution WHERE bundle = %s AND strategy_source_sha256 = %s',
              (bundle, source_sha256)):
        raise refuse('registered grid source already attempted (invalid and interrupted attempts count)',
                     'GRID_ALREADY_ATTEMPTED')
    db.rows(conn, 'INSERT INTO research_execution (bundle, strategy_source_sha256, trial_id) VALUES (%s, %s, %s)',
            (bundle, source_sha256, trial_id))


def candidates(profile, at=None):
    """Complete source lineage and registered execution custody, without recommendation scores."""
    with db.reading(profile, at) as conn:
        require_schema(conn)
        (commit,), = db.rows(conn, "SELECT DOLT_HASHOF('HEAD')")
        revisions = db.dicts(conn, 'SELECT strategy_id, revision, source_sha256, parent_strategy_id, parent_revision, '
                                  'difference, description FROM strategy_revision ORDER BY strategy_id, revision')
        attempts = db.dicts(conn, 'SELECT e.*, r.run_id, r.status FROM research_execution e '
                                 'LEFT JOIN run r ON r.trial_id = e.trial_id ORDER BY e.trial_id')
    for row in revisions:
        row['attempts'] = [a for a in attempts if a['strategy_source_sha256'] == row['source_sha256']]
        row['valid_evidence'] = any(a['status'] == 'passed' for a in row['attempts'])
    return {'ledger_commit': commit, 'candidates': revisions, 'recommendation': 'Agent appends reasons in evidence bundles'}
