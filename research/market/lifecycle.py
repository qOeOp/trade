"""Immutable, source-backed native lifecycle inputs; never infer a venue lifecycle from bars.

Research evidence owns the original facts. This adapter only projects contract episodes and
writes native status/close data. Nautilus alone cancels, fills and settles positions.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

from research.records.common import RecordError


def load(profile, bundle, commit):
    from research.records import db
    from research.records.execution import _bundle
    with db.reading(profile) as conn:
        files = _bundle(conn, bundle)
    if 'lifecycle.json' not in files:
        raise RecordError('lifecycle bundle needs lifecycle.json', code='LIFECYCLE_INPUT')
    body = json.loads(files['lifecycle.json'])
    return validate(body, commit, files), files


def validate(body, commit, files):
    from nautilus_trader.model import InstrumentClose, InstrumentStatus, InstrumentId
    if (not isinstance(body, dict) or set(body) != {'format', 'market_commit', 'episodes'}
            or body['format'] != 'native-lifecycle-v1' or body['market_commit'] != commit
            or not isinstance(body['episodes'], list)):
        raise RecordError('lifecycle manifest differs from its fixed market input', code='LIFECYCLE_INPUT')
    for name in files:
        path = Path(name)
        if path.is_absolute() or '..' in path.parts or path.as_posix() != name:
            raise RecordError('lifecycle evidence paths must be relative files', code='LIFECYCLE_INPUT')
    seen, by_symbol = set(), {}
    for episode in body['episodes']:
        if not isinstance(episode, dict) or set(episode) != {'symbol', 'instrument_id', 'start_ns', 'events', 'sources'}:
            raise RecordError('episode needs symbol, instrument_id, start_ns, events, sources', code='LIFECYCLE_INPUT')
        symbol, iid, start = episode['symbol'], episode['instrument_id'], episode['start_ns']
        if (not isinstance(symbol, str) or not symbol.endswith('USDT') or '/' in symbol or '\\' in symbol
                or not isinstance(iid, str) or iid in seen
                or str(InstrumentId.from_str(iid).venue) != 'BINANCE'
                or (start is not None and (type(start) is not int or start < 0))):
            raise RecordError('invalid or duplicate contract episode identity', code='LIFECYCLE_INPUT')
        seen.add(iid)
        if (not isinstance(episode['sources'], list) or not episode['sources']
                or any(not isinstance(path, str) or path not in files for path in episode['sources'])
                or not isinstance(episode['events'], list)):
            raise RecordError('episode needs retained source originals/notes', code='LIFECYCLE_INPUT')
        previous, closes = -1, []
        for event in episode['events']:
            if not isinstance(event, dict):
                raise RecordError('lifecycle events must be native dictionaries', code='LIFECYCLE_INPUT')
            kind = event.get('type')
            if kind not in ('InstrumentClose', 'InstrumentStatus'):
                raise RecordError('only native lifecycle event dictionaries are supported', code='LIFECYCLE_INPUT')
            native = (InstrumentClose if kind == 'InstrumentClose' else InstrumentStatus).from_dict(event)
            if (str(native.instrument_id) != iid or native.ts_event != native.ts_init
                    or native.ts_event < previous or (start is not None and native.ts_event < start)):
                raise RecordError('lifecycle identity or execution clock differs', code='LIFECYCLE_INPUT')
            previous = native.ts_event
            if kind == 'InstrumentClose':
                if event['close_type'] != 'CONTRACT_EXPIRED' or native.close_price.as_double() <= 0:
                    raise RecordError('settlement requires an exact positive CONTRACT_EXPIRED price', code='LIFECYCLE_INPUT')
                closes.append(native.ts_event)
        if len(closes) > 1 or (closes and any(e['ts_event'] > closes[0] for e in episode['events'])):
            raise RecordError('an expired identity cannot be reused for a later contract', code='LIFECYCLE_INPUT')
        by_symbol.setdefault(symbol, []).append(episode)
    for episodes in by_symbol.values():
        episodes.sort(key=lambda e: e['start_ns'] or 0)
        for index, episode in enumerate(episodes, 1):
            if episode['instrument_id'] != f"{episode['symbol']}-E{index}-PERP.BINANCE":
                raise RecordError('native episode identity must follow its chronological symbol mapping', code='LIFECYCLE_INPUT')
        for old, new in zip(episodes, episodes[1:]):
            ending = end_ns(old)
            if new['start_ns'] is None or ending is None or new['start_ns'] < ending:
                raise RecordError('relisted episodes need separate nonoverlapping authoritative lifetimes', code='LIFECYCLE_INPUT')
    return by_symbol


def end_ns(episode):
    return next((e['ts_event'] for e in episode['events'] if e['type'] == 'InstrumentClose'), None)


def opening_end_ns(episode):
    return next((e['ts_event'] for e in episode['events']
                 if e['type'] == 'InstrumentStatus' and e['action'] == 'PRE_CLOSE'), end_ns(episode))


def project(bars, episode):
    """Only completed minutes belonging to this episode; raw market rows are untouched."""
    if episode is None:
        return bars
    close_ns = (bars['ts_open'] + 60_000 - 1) * 1_000_000
    low, high = episode['start_ns'], end_ns(episode)
    # A minute straddling a listing boundary cannot supply a partial OHLC truthfully.
    keep = (bars['ts_open'] * 1_000_000 >= (low or 0))
    if high is not None:
        keep &= close_ns < high
    return {name: values[keep] for name, values in bars.items()}


def opening_intervals(intervals, episode):
    if episode is None:
        return intervals
    low, high = episode['start_ns'] or 0, opening_end_ns(episode)
    return [(max(a, low), min(b, high) if high is not None else b) for a, b in intervals
            if max(a, low) < (min(b, high) if high is not None else b)]


def write_events(root, episode, start, end):
    """rc3 exposes readers but no Python status/close writer: emit its native Arrow schemas."""
    from nautilus_trader.model import InstrumentClose, InstrumentStatus
    from research.market.export import _ns_name
    counts = {'instrument_close': 0, 'instrument_status': 0}
    if episode is None:
        return counts
    for kind, native_type, directory in (('InstrumentClose', InstrumentClose, 'instrument_closes'),
                                          ('InstrumentStatus', InstrumentStatus, 'instrument_status')):
        values = [native_type.from_dict(e) for e in episode['events'] if e['type'] == kind
                  and start <= e['ts_init'] < end]
        if not values:
            continue
        metadata = {'instrument_id': episode['instrument_id'], 'type': kind}
        if kind == 'InstrumentClose':
            precision = max(v.close_price.precision for v in values)
            metadata['price_precision'] = str(precision)
            schema = pa.schema([pa.field('close_price', pa.binary(16), False),
                                pa.field('close_type', pa.uint8(), False),
                                pa.field('ts_event', pa.uint64(), False), pa.field('ts_init', pa.uint64(), False)],
                               metadata=metadata)
            data = {'close_price': [v.close_price.raw.to_bytes(16, 'little', signed=True) for v in values],
                    'close_type': [int(v.close_type) for v in values],
                    'ts_event': [v.ts_event for v in values], 'ts_init': [v.ts_init for v in values]}
        else:
            # InstrumentStatus is serialized as its native JSON-field Arrow schema in rc3.
            schema = pa.schema([pa.field('instrument_id', pa.string(), False), pa.field('action', pa.string(), False),
                                pa.field('ts_event', pa.uint64(), False), pa.field('ts_init', pa.uint64(), False),
                                pa.field('reason', pa.string()), pa.field('trading_event', pa.string()),
                                pa.field('is_trading', pa.bool_()), pa.field('is_quoting', pa.bool_()),
                                pa.field('is_short_sell_restricted', pa.bool_())], metadata=metadata)
            dictionaries = [v.to_dict() for v in values]
            data = {f.name: [d.get(f.name) for d in dictionaries] for f in schema}
        table = pa.table(data, schema=schema)
        folder = Path(root) / 'data' / directory / episode['instrument_id']
        folder.mkdir(parents=True, exist_ok=True)
        pq.write_table(table, folder / _ns_name(values[0].ts_init, values[-1].ts_init), compression='snappy')
        counts['instrument_close' if kind == 'InstrumentClose' else 'instrument_status'] = len(values)
    return counts


def files_digest(files):
    manifest = {name: hashlib.sha256(data).hexdigest() for name, data in sorted(files.items())}
    return hashlib.sha256(json.dumps(manifest, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
