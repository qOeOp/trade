"""Append-only original execution custody in existing evidence/trial relations.

Reserved namespaces are product captures, not Agent-provided log assertions. Empty bytes have
an explicit manifest; missing bytes never acquire a hash from a later probe.
"""
from __future__ import annotations
import hashlib
import json
from pathlib import Path
import re
from research.records import db
from research.records.common import RecordError

RESERVED = re.compile(r'trial-[0-9]+-(?:execution(?:-start)?|recovery-.+)\Z')
MANIFEST = 'execution.json'


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


def _bundle(conn, name):
    rows = db.rows(conn, 'SELECT path, content, sha256 FROM evidence WHERE bundle = %s', (name,))
    files = {}
    for path, content, sha in rows:
        if hashlib.sha256(content).hexdigest() != sha:
            raise RecordError(f'execution evidence hash differs: {name}/{path}', code='LEDGER_CORRUPT')
        files[path] = content
    return files


def read(conn, trial_id):
    start_files = _bundle(conn, f'trial-{trial_id}-execution-start')
    files = _bundle(conn, f'trial-{trial_id}-execution')
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
    if value.get('format') != 'execution-capture-v1' or beginning is None or beginning.get('format') != 'execution-start-v1' or value.get('phase') not in ('replay', 'source-precheck') or value['phase'] != beginning.get('phase'):
        raise RecordError('capture differs from original execution start', code='EXECUTION_IDENTITY')
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
        elif entry['state'] == 'captured':
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
    files, manifest = {}, {}
    for name, path in names.items():
        if path.is_file():
            data = path.read_bytes()
            manifest[name] = {'state': 'captured' if data else 'captured-empty', 'length': len(data),
                              'sha256': hashlib.sha256(data).hexdigest()}
            if data:
                files[name] = data
        else:
            manifest[name] = {'state': 'not-started' if name.startswith('audit.') and phases.get('audit') is None else 'missing',
                              'length': None, 'sha256': None}
    if sum(len(data) for data in files.values()) > 64 * 1024 * 1024:
        raise RecordError('original capture exceeds evidence bundle limit; keep working directory for diagnosis', code='EXECUTION_CAPTURE_LIMIT')
    def insert(c):
        trial = db.one(c, 'SELECT * FROM trial WHERE trial_id = %s', (trial_id,))
        start_files = _bundle(c, f'trial-{trial_id}-execution-start')
        if trial is None or MANIFEST not in start_files:
            raise RecordError('execution capture needs its original start receipt', code='EXECUTION_IDENTITY')
        beginning = json.loads(start_files[MANIFEST])
        value = {'format': 'execution-capture-v1', 'trial_id': trial_id, 'source_sha256': trial['strategy_source_sha256'],
                 'image_ref': trial['image_ref'], 'phase': beginning['phase'], 'phases': phases, 'outcome': outcome, 'files': manifest}
        files[MANIFEST] = encoded(value)
        bundle = f'trial-{trial_id}-execution'
        append(c, bundle, files, f'execution:trial-{trial_id}')
        return {'bundle': bundle, 'files': {p: hashlib.sha256(b).hexdigest() for p, b in files.items()}}
    return db.write(profile, kind='execution', op=f'execution:trial-{trial_id}', table='evidence_bundle',
                    insert=insert, replay=lambda c,r: {'bundle':r['bundle']}, conn=conn)
