"""Bounded original execution files in existing evidence rows.

Logical file hashes remain hashes of the exact original bytes. Chunk paths express only
physical order/ownership, not an alternate report, execution result or research record.
"""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path, PurePosixPath

from research.records import db
from research.records.common import RecordError

CHUNK_BYTES = 16 * 1024 * 1024
ENGINEERING_BYTES = 4 * 1024 * 1024 * 1024
ORDINARY_BYTES = 64 * 1024 * 1024
PREFIX = '__execution_parts__/'
MANIFESTS = ('execution.json', 'recovery.json')
FORMATS = ('execution-capture-v2', 'execution-recovery-v1')


def invalid(message):
    return RecordError(message, code='EXECUTION_IDENTITY')


def path_valid(name):
    return (isinstance(name, str) and bool(name) and not PurePosixPath(name).is_absolute()
            and name not in ('.', '..') and '\x00' not in name
            and PurePosixPath(name).as_posix() == name
            and '..' not in PurePosixPath(name).parts and not name.startswith(PREFIX))


def part_path(name, index):
    return f'{PREFIX}{hashlib.sha256(name.encode()).hexdigest()}/{index:08d}'


def describe(names, limit):
    # Refuse oversize before allocating or hashing large files. Recheck bytes during insert.
    total = sum(path.stat().st_size for path in names.values() if path.is_file())
    if total > limit:
        raise RecordError('original capture exceeds evidence bundle limit; keep working directory for diagnosis',
                          code='EXECUTION_CAPTURE_LIMIT')
    entries = {}
    for name, path in names.items():
        if not path_valid(name) or name in MANIFESTS or path.is_symlink():
            raise invalid('invalid original execution file path')
        if not path.is_file():
            entries[name] = {'state': 'missing', 'length': None, 'sha256': None}
            continue
        digest, length = hashlib.sha256(), 0
        with path.open('rb') as stream:
            while data := stream.read(CHUNK_BYTES):
                digest.update(data)
                length += len(data)
                if length > limit:
                    raise RecordError('original capture grew beyond its limit', code='EXECUTION_CAPTURE_LIMIT')
        entries[name] = {'state': 'captured' if length else 'captured-empty',
                         'length': length, 'sha256': digest.hexdigest()}
    if sum(entry['length'] or 0 for entry in entries.values()) > limit:
        raise RecordError('original capture grew beyond its limit', code='EXECUTION_CAPTURE_LIMIT')
    return entries


def insert(conn, bundle, names, entries, *, chunked):
    """Called inside the one existing db.write transaction; no partial bundle is committed."""
    total = 0
    for name, entry in entries.items():
        if entry['state'] not in ('captured', 'captured-empty'):
            if names[name].is_file():
                raise invalid('missing original file appeared after capture inventory')
            continue
        digest, length, parts = hashlib.sha256(), 0, []
        with names[name].open('rb') as stream:
            if chunked:
                while data := stream.read(CHUNK_BYTES):
                    physical = part_path(name, len(parts))
                    parts.append(physical)
                    length += len(data)
                    digest.update(data)
                    if length > entry['length']:
                        raise invalid('original file grew while capturing')
                    db.rows(conn, 'INSERT INTO evidence (bundle, path, content) VALUES (%s, %s, %s)',
                            (bundle, physical, data))
            else:
                data = stream.read(ORDINARY_BYTES + 1)
                length = len(data)
                digest.update(data)
                if length > ORDINARY_BYTES:
                    raise invalid('original file grew while capturing')
                if data:
                    db.rows(conn, 'INSERT INTO evidence (bundle, path, content) VALUES (%s, %s, %s)',
                            (bundle, name, data))
        if length != entry['length'] or digest.hexdigest() != entry['sha256']:
            raise invalid('original execution bytes changed while capturing')
        total += length
        if chunked and parts:
            entry['chunks'] = parts
    return total


def physical_index(conn, bundle):
    return {name: (sha, int(length)) for name, sha, length in db.rows(
        conn, 'SELECT path, sha256, byte_length FROM evidence WHERE bundle = %s', (bundle,))}


def physical_bytes(conn, bundle, name):
    row = db.one(conn, 'SELECT content, sha256 FROM evidence WHERE bundle = %s AND path = %s', (bundle, name))
    if row is None or hashlib.sha256(row['content']).hexdigest() != row['sha256']:
        raise RecordError(f'execution evidence hash differs: {bundle}/{name}', code='LEDGER_CORRUPT')
    return row['content']


def inventory(conn, bundle):
    """Return logical metadata, or None for an unchanged legacy/ordinary evidence bundle."""
    if not re.fullmatch(r'trial-[0-9]+-(?:execution|recovery-capture-limit)', bundle):
        return None
    index = physical_index(conn, bundle)
    for name in MANIFESTS:
        if name not in index:
            continue
        try:
            value = json.loads(physical_bytes(conn, bundle, name))
        except (ValueError, UnicodeError) as exc:
            raise invalid('execution manifest is not valid JSON') from exc
        if not isinstance(value, dict):
            raise invalid('execution manifest is not an object')
        if value.get('format') not in FORMATS:
            continue
        entries = value.get('files')
        if not isinstance(entries, dict):
            raise invalid('chunked execution lacks file inventory')
        expected, total = {name}, 0
        for logical, entry in entries.items():
            if not path_valid(logical) or logical in MANIFESTS or not isinstance(entry, dict):
                raise invalid('invalid logical execution file')
            state, length = entry.get('state'), entry.get('length')
            if state not in ('captured', 'captured-empty', 'missing', 'not-started'):
                raise invalid('unknown execution file state')
            if state == 'captured':
                if not isinstance(length, int) or isinstance(length, bool) or not 0 < length <= ENGINEERING_BYTES:
                    raise invalid('invalid logical execution file length')
                parts = entry.get('chunks')
                count = (length + CHUNK_BYTES - 1) // CHUNK_BYTES
                if parts != [part_path(logical, i) for i in range(count)]:
                    raise invalid('execution chunk order/ownership differs')
                for i, part in enumerate(parts):
                    required = min(CHUNK_BYTES, length - i * CHUNK_BYTES)
                    if part in expected or part not in index or index[part][1] != required:
                        raise invalid('execution chunks are missing, repeated or have wrong length')
                    expected.add(part)
                total += length
            elif entry.get('chunks'):
                raise invalid('noncaptured execution file has chunks')
            elif state == 'captured-empty':
                if length != 0 or entry.get('sha256') != hashlib.sha256(b'').hexdigest():
                    raise invalid('empty execution file differs')
            elif length is not None or entry.get('sha256') is not None:
                raise invalid('missing execution file acquired bytes')
        if set(index) != expected or total > ENGINEERING_BYTES:
            raise invalid('unlisted execution chunks or oversized logical bundle')
        return name, value
    if any(name.startswith(PREFIX) for name in index):
        raise invalid('execution chunks lack their manifest')
    return None


def iter_file(conn, bundle, logical, entry):
    digest, length = hashlib.sha256(), 0
    for physical in entry.get('chunks', [logical]):
        data = physical_bytes(conn, bundle, physical)
        digest.update(data)
        length += len(data)
        yield data
    if length != entry['length'] or digest.hexdigest() != entry['sha256']:
        raise invalid(f'logical execution file differs: {bundle}/{logical}')


def files(conn, bundle, paths=None):
    found = inventory(conn, bundle)
    if found is None:
        index = physical_index(conn, bundle)
        return {name: physical_bytes(conn, bundle, name) for name in index if paths is None or name in paths}
    manifest_name, value = found
    result = {}
    for logical, entry in value['files'].items():
        if entry['state'] == 'captured' and (paths is None or logical in paths):
            result[logical] = b''.join(iter_file(conn, bundle, logical, entry))
    if paths is None or manifest_name in paths:
        result[manifest_name] = physical_bytes(conn, bundle, manifest_name)
    return result


def export(conn, bundle, destination):
    found = inventory(conn, bundle)
    if found is None:
        return None
    name, value = found
    result = {name: hashlib.sha256(physical_bytes(conn, bundle, name)).hexdigest()}
    destination = Path(destination)
    destination.mkdir(parents=True, exist_ok=False)
    (destination / name).write_bytes(physical_bytes(conn, bundle, name))
    for logical, entry in value['files'].items():
        if entry['state'] not in ('captured', 'captured-empty'):
            continue
        target = destination / logical
        target.parent.mkdir(parents=True, exist_ok=True)
        partial = target.with_name(target.name + '.partial')
        with partial.open('xb') as stream:
            if entry['state'] == 'captured':
                for data in iter_file(conn, bundle, logical, entry):
                    stream.write(data)
        partial.replace(target)
        result[logical] = entry['sha256']
    return {'bundle': bundle, 'destination': str(destination), 'files': result}
