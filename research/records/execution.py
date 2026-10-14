"""Append-only original execution custody in existing evidence/trial relations.

Reserved namespaces are product captures, not Agent-provided log assertions. Empty bytes have
an explicit manifest; missing bytes never acquire a hash from a later probe.
"""
from __future__ import annotations
import hashlib
import json
from pathlib import Path
import re
from research.records import db, execution_files
from research.records.common import RecordError

RESERVED = re.compile(r'trial-[0-9]+-(?:execution(?:-start)?|recovery-.+)\Z')
MANIFEST = 'execution.json'
RECOVERY_ORIGINALS = ('native.stdout.txt', 'native.stderr.txt', 'audit.stdout.txt', 'audit.stderr.txt',
                      'strategy.py', 'input-coverage.json', 'process.json', 'runtime-inspection.json',
                      'reports/runtime-errors.jsonl', 'reports/audit.json',
                      *('reports/' + name for name in ('summary.json', 'orders.csv', 'fills.csv', 'positions.csv',
                         'account.csv', 'returns_series.csv', 'order_events.jsonl.gz', 'exposures.csv.gz')))


def recovery_requirements(process):
    """Only original typed phase facts determine which original files must exist."""
    if not isinstance(process, dict) or set(process) != {'native', 'audit'}:
        raise RecordError('recovery lacks original phase facts', code='EXECUTION_IDENTITY')
    required = {'native.stdout.txt', 'native.stderr.txt', 'strategy.py', 'input-coverage.json',
                'process.json', 'runtime-inspection.json', 'host-error.json'}
    for phase in ('native', 'audit'):
        value = process[phase]
        if value is None and phase == 'audit':
            continue
        if (not isinstance(value, dict) or value.get('state') not in ('started', 'exited')
                or (value['state'] == 'started' and value.get('exit_code') is not None)
                or (value['state'] == 'exited' and type(value.get('exit_code')) is not int)):
            raise RecordError('recovery phase facts are invalid', code='EXECUTION_IDENTITY')
        if phase == 'audit':
            required.update(('audit.stdout.txt', 'audit.stderr.txt'))
        if value.get('exit_code') == 0:
            if phase == 'native':
                required.update(name for name in RECOVERY_ORIGINALS if name.startswith('reports/')
                                and name not in ('reports/runtime-errors.jsonl', 'reports/audit.json'))
            else:
                required.add('reports/audit.json')
    return required


def encoded(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode()


def append(conn, bundle, files, op):
    db.rows(conn, 'INSERT INTO evidence_bundle (bundle, op_id, created_at) VALUES (%s, %s, UTC_TIMESTAMP(6))', (bundle, op))
    for name, data in files.items():
        if data:
            db.rows(conn, 'INSERT INTO evidence (bundle, path, content) VALUES (%s, %s, %s)', (bundle, name, data))


def start(conn, trial_id, context, trial_op):
    trial = db.one(conn, 'SELECT * FROM trial WHERE trial_id = %s', (trial_id,))
    if context['source_sha256'] != trial['strategy_source_sha256'] or context['image_ref'] != trial['image_ref']:
        raise RecordError('execution start differs from its trial', code='EXECUTION_IDENTITY', write_status='not_written')
    if context['phase'] not in ('replay', 'source-precheck'):
        raise RecordError('unknown execution phase', code='EXECUTION_IDENTITY', write_status='not_written')
    value = {'format': 'execution-start-v1', 'trial_id': trial_id, **context}
    append(conn, f'trial-{trial_id}-execution-start', {MANIFEST: encoded(value)}, 'execution-start:' + trial_op)


def _bundle(conn, name, paths=None):
    return execution_files.files(conn, name, paths)


def read(conn, trial_id):
    start_files = _bundle(conn, f'trial-{trial_id}-execution-start')
    bundle = f'trial-{trial_id}-execution'
    chunked = execution_files.inventory(conn, bundle)
    # Verify all originals without materializing a multi-gigabyte report bundle.
    if chunked:
        manifest_name, manifest = chunked
        if manifest_name != MANIFEST or manifest['format'] != 'execution-capture-v2':
            raise RecordError('original execution has a recovery manifest', code='EXECUTION_IDENTITY')
        for name, entry in manifest['files'].items():
            if entry['state'] == 'captured':
                for _ in execution_files.iter_file(conn, bundle, name, entry):
                    pass
        files = _bundle(conn, bundle, {MANIFEST, 'strategy.py', 'runtime-errors.jsonl'})
    else:
        files = _bundle(conn, bundle)
    trial = db.one(conn, 'SELECT * FROM trial WHERE trial_id = %s', (trial_id,))
    if MANIFEST in start_files:
        original = json.loads(start_files[MANIFEST])
        if original.get('format') != 'execution-start-v1' or original.get('trial_id') != trial_id or original.get('source_sha256') != trial['strategy_source_sha256'] or original.get('image_ref') != trial['image_ref'] or original.get('phase') not in ('replay','source-precheck'):
            raise RecordError('original execution start identity differs', code='EXECUTION_IDENTITY')
    if MANIFEST not in files:
        return {'status': 'missing', 'start': json.loads(start_files[MANIFEST]) if MANIFEST in start_files else None,
                'reason': 'No original final execution capture; later probes cannot replace it.'}
    value = json.loads(files[MANIFEST])
    beginning = json.loads(start_files[MANIFEST]) if MANIFEST in start_files else None
    if value.get('format') not in ('execution-capture-v1', 'execution-capture-v2') or beginning is None or beginning.get('format') != 'execution-start-v1' or value.get('phase') not in ('replay', 'source-precheck') or value['phase'] != beginning.get('phase'):
        raise RecordError('capture differs from original execution start', code='EXECUTION_IDENTITY')
    if chunked and (value['phase'] != 'source-precheck' or trial['mode'] != 'explore'):
        raise RecordError('chunked original capture is engineering-only', code='EXECUTION_IDENTITY')
    trial = db.one(conn, 'SELECT * FROM trial WHERE trial_id = %s', (trial_id,))
    for key, expected in (('trial_id', trial_id), ('source_sha256', trial['strategy_source_sha256']), ('image_ref', trial['image_ref'])):
        if value.get(key) != expected or beginning.get(key) != expected:
            raise RecordError('execution capture identity differs', code='EXECUTION_IDENTITY')
    if set(files) - {MANIFEST} - set(value['files']):
        raise RecordError('capture contains unlisted files', code='EXECUTION_IDENTITY')
    for path, entry in value['files'].items():
        if entry['state'] not in ('captured', 'captured-empty', 'missing', 'not-started'):
            raise RecordError('unknown capture state', code='EXECUTION_IDENTITY')
        if entry['state'] == 'captured-empty':
            if entry['length'] != 0 or entry['sha256'] != hashlib.sha256(b'').hexdigest() or path in files:
                raise RecordError('empty log attestation differs', code='EXECUTION_IDENTITY')
        elif entry['state'] == 'captured' and not chunked:
            content = files.get(path)
            if content is None or len(content) != entry['length'] or hashlib.sha256(content).hexdigest() != entry['sha256']:
                raise RecordError('execution capture file differs', code='EXECUTION_IDENTITY')
    if 'strategy.py' in files and hashlib.sha256(files['strategy.py']).hexdigest() != trial['strategy_source_sha256']:
        raise RecordError('captured source differs from original trial', code='EXECUTION_IDENTITY')
    value['status'] = 'captured'
    value['start'] = json.loads(start_files[MANIFEST]) if MANIFEST in start_files else None
    value['runtime_failures'] = [json.loads(line) for line in files.get('runtime-errors.jsonl', b'').splitlines() if line.strip()]
    return value


def capture(profile, *, trial_id, workdir, phases, outcome, precheck=False, conn=None):
    """Store exact already-captured bytes, including exception and interruption evidence."""
    workdir = Path(workdir)
    names = {name: workdir / name for name in ('native.stdout.txt', 'native.stderr.txt', 'audit.stdout.txt', 'audit.stderr.txt')}
    names['input-coverage.json'] = workdir / 'input-coverage.json'
    names['strategy.py'] = workdir / 'source' / 'strategy.py'
    names['runtime-errors.jsonl'] = workdir / 'reports' / 'runtime-errors.jsonl'
    names['summary.json'] = workdir / 'reports' / 'summary.json'
    if precheck:
        for path in (workdir / 'reports').glob('*'):
            if path.is_file():
                names[path.name] = path
    def insert(c):
        trial = db.one(c, 'SELECT * FROM trial WHERE trial_id = %s', (trial_id,))
        start_files = _bundle(c, f'trial-{trial_id}-execution-start')
        if trial is None or MANIFEST not in start_files:
            raise RecordError('execution capture needs its original start receipt', code='EXECUTION_IDENTITY')
        beginning = json.loads(start_files[MANIFEST])
        engineering = precheck and beginning['phase'] == 'source-precheck' and trial['mode'] == 'explore'
        limit = execution_files.ENGINEERING_BYTES if engineering else execution_files.ORDINARY_BYTES
        manifest = execution_files.describe(names, limit)
        for name, entry in manifest.items():
            if entry['state'] == 'missing' and name.startswith('audit.') and phases.get('audit') is None:
                entry['state'] = 'not-started'
        chunked = sum(entry['length'] or 0 for entry in manifest.values()) > execution_files.ORDINARY_BYTES
        value = {'format': 'execution-capture-v2' if chunked else 'execution-capture-v1', 'trial_id': trial_id, 'source_sha256': trial['strategy_source_sha256'],
                 'image_ref': trial['image_ref'], 'phase': beginning['phase'], 'phases': phases, 'outcome': outcome, 'files': manifest}
        bundle = f'trial-{trial_id}-execution'
        db.rows(c, 'INSERT INTO evidence_bundle (bundle, op_id, created_at) VALUES (%s, %s, UTC_TIMESTAMP(6))',
                (bundle, f'execution:trial-{trial_id}'))
        execution_files.insert(c, bundle, names, manifest, chunked=chunked)
        content = encoded(value)
        db.rows(c, 'INSERT INTO evidence (bundle, path, content) VALUES (%s, %s, %s)', (bundle, MANIFEST, content))
        return {'bundle': bundle, 'files': {**{p: e['sha256'] for p, e in manifest.items() if e['state'] == 'captured'},
                                            MANIFEST: hashlib.sha256(content).hexdigest()}}
    return db.write(profile, kind='execution', op=f'execution:trial-{trial_id}', table='evidence_bundle',
                    insert=insert, replay=lambda c,r: {'bundle':r['bundle']}, conn=conn)


def recovery_read(conn, trial_id, bundle):
    """Later original-byte recovery never replaces a missing original final capture."""
    if bundle != f'trial-{trial_id}-recovery-capture-limit':
        raise RecordError('recovery bundle differs from target trial', code='EXECUTION_IDENTITY')
    found = execution_files.inventory(conn, bundle)
    if found is None or found[0] != 'recovery.json' or found[1]['format'] != 'execution-recovery-v1':
        raise RecordError('original recovery inventory is missing', code='EXECUTION_IDENTITY')
    value = found[1]
    trial = db.one(conn, 'SELECT * FROM trial WHERE trial_id = %s', (trial_id,))
    beginning = json.loads(_bundle(conn, f'trial-{trial_id}-execution-start')[MANIFEST])
    if (value.get('trial_id') != trial_id or trial['mode'] != 'explore'
            or beginning.get('format') != 'execution-start-v1' or beginning.get('trial_id') != trial_id
            or beginning.get('source_sha256') != trial['strategy_source_sha256']
            or beginning.get('image_ref') != trial['image_ref']
            or beginning.get('phase') != 'source-precheck' or value.get('phase') != 'source-precheck'
            or value.get('source_sha256') != trial['strategy_source_sha256']
            or value.get('image_ref') != trial['image_ref']
            or db.one(conn, 'SELECT trial_id FROM research_execution WHERE trial_id = %s', (trial_id,))
            or execution_files.physical_index(conn, f'trial-{trial_id}-execution')):
        raise RecordError('recovery differs from an unconsumed original engineering start', code='EXECUTION_IDENTITY')
    files = _bundle(conn, bundle, {'strategy.py', 'input-coverage.json', 'host-error.json', 'process.json'})
    try:
        process = json.loads(files['process.json'])
        required = recovery_requirements(process)
    except (KeyError, ValueError, TypeError) as exc:
        raise RecordError('recovery lacks original process facts', code='EXECUTION_IDENTITY') from exc
    if (not set(RECOVERY_ORIGINALS) <= set(value['files']) or any(
            value['files'].get(name, {}).get('state') not in ('captured', 'captured-empty') for name in required)):
        raise RecordError('recovery is missing phase-required original files', code='EXECUTION_IDENTITY')
    for name, entry in value['files'].items():
        if entry['state'] == 'captured':
            for _ in execution_files.iter_file(conn, bundle, name, entry):
                pass
    try:
        failure = json.loads(files['host-error.json'])
        from research.records.prechecks import original_inputs_match
        valid = (failure['error']['code'] == 'EXECUTION_CAPTURE_LIMIT'
                 and sum(e['length'] or 0 for e in value['files'].values()) > execution_files.ORDINARY_BYTES
                 and original_inputs_match(trial, beginning, files, trial['strategy_source_sha256']))
    except (KeyError, ValueError, TypeError):
        valid = False
    if not valid:
        raise RecordError('recovery lacks matching original inputs or capacity failure', code='EXECUTION_IDENTITY')
    return {**value, 'status': 'recovered', 'start': beginning,
            'limitation': 'Later recovery; original final capture remains missing, never a successful precheck.'}


def recover(profile, *, trial_id, workdir, failure_file):
    workdir, failure_file = Path(workdir), Path(failure_file)
    with db.reading(profile) as conn:
        original = read(conn, trial_id)
        if original['status'] != 'missing' or not original.get('start'):
            raise RecordError('recovery requires a missing original final capture', code='EXECUTION_IDENTITY')
        beginning = original['start']
        trial = db.one(conn, 'SELECT * FROM trial WHERE trial_id = %s', (trial_id,))
        if (trial['mode'] != 'explore' or beginning['phase'] != 'source-precheck'
                or Path(beginning['workdir']).resolve() != workdir.resolve()
                or db.one(conn, 'SELECT trial_id FROM research_execution WHERE trial_id = %s', (trial_id,))):
            raise RecordError('only original unconsumed engineering workdir may be recovered', code='EXECUTION_IDENTITY')
    names = {('strategy.py' if p.relative_to(workdir).as_posix() == 'source/strategy.py' else p.relative_to(workdir).as_posix()): p
             for p in workdir.rglob('*') if p.is_file()}
    for name in RECOVERY_ORIGINALS:
        names.setdefault(name, workdir / ('source/strategy.py' if name == 'strategy.py' else name))
    if 'host-error.json' in names:
        raise RecordError('recovery host error collides with original workdir', code='EXECUTION_IDENTITY')
    names['host-error.json'] = failure_file
    entries = execution_files.describe(names, execution_files.ENGINEERING_BYTES)
    try:
        process = json.loads((workdir / 'process.json').read_bytes())
        required = recovery_requirements(process)
    except (OSError, ValueError, TypeError) as exc:
        raise RecordError('recovery needs original process phase facts', code='EXECUTION_IDENTITY') from exc
    if any(entries[name]['state'] not in ('captured', 'captured-empty') for name in required):
        raise RecordError('recovery is missing phase-required original files', code='EXECUTION_IDENTITY')
    if process['audit'] is None:
        for name in ('audit.stdout.txt', 'audit.stderr.txt', 'reports/audit.json'):
            if entries[name]['state'] == 'missing':entries[name]['state'] = 'not-started'
    bundle = f'trial-{trial_id}-recovery-capture-limit'
    op = db.op_id('execution-recovery', {'trial': trial_id, 'files': entries})
    def insert(c):
        if db.one(c, 'SELECT bundle FROM evidence_bundle WHERE bundle = %s', (bundle,)):
            raise RecordError('conflicting original recovery bundle', code='BUNDLE_EXISTS')
        db.rows(c, 'INSERT INTO evidence_bundle (bundle, op_id, created_at) VALUES (%s, %s, UTC_TIMESTAMP(6))', (bundle, op))
        execution_files.insert(c, bundle, names, entries, chunked=True)
        value = {'format': 'execution-recovery-v1', 'trial_id': trial_id, 'phase': 'source-precheck',
                 'source_sha256': trial['strategy_source_sha256'], 'image_ref': trial['image_ref'],
                 'workdir': str(workdir), 'files': entries,
                 'limitation': 'Later original-byte recovery after capacity refusal, not an original final capture.'}
        db.rows(c, 'INSERT INTO evidence (bundle, path, content) VALUES (%s, %s, %s)', (bundle, 'recovery.json', encoded(value)))
        recovery_read(c, trial_id, bundle)
        return {'bundle': bundle, 'trial_id': trial_id, 'status': 'recovered', 'original_capture': 'missing'}
    return db.write(profile, kind='execution-recovery', op=op, table='evidence_bundle', insert=insert,
                    replay=lambda c, r: {'bundle': r['bundle'], 'status': 'recovered', 'original_capture': 'missing'})
