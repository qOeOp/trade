"""Identity-bound Agent source reviews of original native engineering prechecks.

The product verifies custody and prerequisite identity. The Agent supplies causal reasoning;
it never becomes a second signal engine or an account-audit verdict.
"""
import hashlib
import json
from research.records import db, records, execution
from research.records.common import RecordError

PATH = 'source-review.json'


def review(profile, *, bundle, body):
    records._id(bundle, 'source review bundle', records.BUNDLE)
    if execution.RESERVED.fullmatch(bundle):
        raise RecordError('original execution namespace is product-owned', code='EXECUTION_NAMESPACE')
    if set(body) != {'trial_id', 'api', 'causal', 'activity', 'readiness'}:
        raise RecordError('review needs trial_id, api, causal, activity and readiness', code='SOURCE_REVIEW_INVALID')
    for name in ('api', 'causal', 'activity', 'readiness'):
        item = body[name]
        if set(item) != {'status', 'note'} or item['status'] not in ('passed', 'failed', 'unresolved', 'no_opportunity'):
            raise RecordError('review status/note invalid', code='SOURCE_REVIEW_INVALID')
        records._note(item['note'])
    op = db.op_id('source-review', {'bundle':bundle, 'body':body})
    def insert(conn):
        trial = db.one(conn, 'SELECT * FROM trial WHERE trial_id = %s', (body['trial_id'],))
        capture = execution.read(conn, body['trial_id'])
        if trial is None or capture.get('phase') != 'source-precheck':
            raise RecordError('review needs an original source-precheck capture', code='SOURCE_REVIEW_INVALID')
        value = {'format':'source-review-v1', 'source_sha256':trial['strategy_source_sha256'],
                 'image_ref':trial['image_ref'], 'execution_bundle':f"trial-{body['trial_id']}-execution",
                 'authority':'Agent source review; not native account audit', **body}
        execution.append(conn, bundle, {PATH:execution.encoded(value)}, op)
        return {'bundle':bundle, 'source_sha256':value['source_sha256'], 'trial_id':body['trial_id']}
    return db.write(profile, kind='source-review', op=op, table='evidence_bundle', insert=insert,
                    replay=lambda c,r: {'bundle':r['bundle']})


def require(conn, bundle, source_sha, image, input_identity=None):
    row = db.one(conn, 'SELECT content, sha256 FROM evidence WHERE bundle = %s AND path = %s', (bundle, PATH))
    if row is None or hashlib.sha256(row['content']).hexdigest() != row['sha256']:
        raise RecordError('missing or corrupt exact-source precheck review', code='SOURCE_PRECHECK_REQUIRED')
    try:
        value = json.loads(row['content'])
        if not isinstance(value, dict) or any(not isinstance(value.get(name),dict) or value[name].get('status') not in ('passed','failed','unresolved','no_opportunity') for name in ('api','causal','activity','readiness')) or not isinstance(value.get('trial_id'),int):
            raise ValueError('source review structure invalid')
    except (ValueError, TypeError) as exc:
        raise RecordError(f'invalid source precheck review: {exc}', code='SOURCE_PRECHECK_REQUIRED') from exc
    if value.get('format') != 'source-review-v1' or (value.get('source_sha256'),value.get('image_ref')) != (source_sha,image):
        raise RecordError('source review differs from exact source/image', code='SOURCE_PRECHECK_REQUIRED')
    capture = execution.read(conn, value['trial_id'])
    if ((capture.get('source_sha256'),capture.get('image_ref')) != (source_sha,image) or
            capture.get('phase') != 'source-precheck' or capture.get('outcome') != 'completed' or
            capture.get('runtime_failures') or set(capture.get('phases', {})) != {'native','audit'} or
            any(p is None or p.get('exit_code') != 0 for p in capture['phases'].values())):
        raise RecordError('native source precheck failed or is incomplete', code='SOURCE_PRECHECK_FAILED')
    if any(value[name]['status'] not in ('passed','no_opportunity') for name in ('api','causal','activity','readiness')):
        raise RecordError('Agent source review failed or unresolved; repair before research', code='SOURCE_PRECHECK_FAILED')
    if input_identity is not None:
        files = execution._bundle(conn, f"trial-{value['trial_id']}-execution", {'input-coverage.json'})
        try:
            original = json.loads(files.get('input-coverage.json', b'{}')).get('input_identity', {})
            before, after = original.get('lifecycle_bundle'), input_identity.get('lifecycle_bundle')
        except (ValueError, TypeError, AttributeError) as exc:
            raise RecordError('source precheck input identity is invalid', code='SOURCE_PRECHECK_REQUIRED') from exc
        # Different windows are allowed; lifecycle evidence itself is immutable and must be identical.
        if before is not None or after is not None:
            if before != after or original.get('market_commit') != input_identity.get('market_commit'):
                raise RecordError('source precheck differs from lifecycle bundle/fixed market commit',
                                  code='SOURCE_PRECHECK_REQUIRED')
    return value['trial_id']


def original_inputs_match(trial, beginning, files, source_sha):
    if ('strategy.py' not in files or hashlib.sha256(files['strategy.py']).hexdigest() != source_sha
            or 'input-coverage.json' not in files):
        return False
    try:
        coverage = json.loads(files['input-coverage.json'])
        config = coverage['effective_config']
        identity = coverage['input_identity']
        return (coverage.get('format') == 'execution-input-coverage-v1'
                and bool(identity['market_commit'])
                and config == beginning['effective_config']
                and identity['market_commit'] == config['market_commit']
                and config['symbols'] == identity['symbols']
                and identity['symbols'] == json.loads(trial['coins'])
                and all(records._utc(config[key], key) == trial[column] for key, column in
                        (('start', 'input_start'), ('trade_start', 'trade_start'), ('end', 'trade_end'))))
    except (KeyError, TypeError, ValueError, RecordError):
        return False


def engineering_exposure(conn, trial_id, source_sha, recovery_sources=()):
    """Classify a retained original precheck; never erase its engineering/data exposure.

    Failed or repeated prechecks cannot become registered economic attempts. Ordinary
    exploration, sealed runs, consumed cells and uncertain original custody remain exposures
    requiring the existing retry contract.
    """
    trial = db.one(conn, 'SELECT * FROM trial WHERE trial_id = %s', (trial_id,))
    if (trial is None or trial['mode'] != 'explore' or trial['strategy_source_sha256'] != source_sha
            or db.one(conn, 'SELECT trial_id FROM research_execution WHERE trial_id = %s', (trial_id,))):
        return False
    capture = execution.read(conn, trial_id)
    if capture.get('status') == 'missing':
        bundle = f'trial-{trial_id}-recovery-capture-limit'
        if bundle not in recovery_sources:
            return False
        execution.recovery_read(conn, trial_id, bundle)
        return True
    if (capture.get('status') != 'captured' or capture.get('phase') != 'source-precheck'
            or capture.get('start', {}).get('phase') != 'source-precheck'):
        return False
    files = execution._bundle(conn, f'trial-{trial_id}-execution', {'strategy.py', 'input-coverage.json'})
    return original_inputs_match(trial, capture['start'], files, source_sha)
