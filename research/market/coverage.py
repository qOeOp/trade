"""Read-only coverage facts at one immutable market commit; no eligibility grading.

Input coverage extends across warmup and possible continuing holdings. Missing bars, zero
volume and funding absence are separate facts; listing/delisting cannot be inferred as facts.
"""
import numpy as np
from research.market import store
from research.records import db


def series(bars, start, end):
    times = bars['ts_open']
    gaps = store.missing(times, start, end)
    return {'rows':len(times), 'first_open_ms':int(times[0]) if len(times) else None,
            'last_open_ms':int(times[-1]) if len(times) else None,
            'gap_intervals_ms':[[int(a),int(b)] for a,b in gaps],
            'missing_minutes':sum((int(b)-int(a))//60000 for a,b in gaps),
            'zero_volume_minutes':int(np.count_nonzero(bars['volume'] == 0))}


def facts(conn, commit, symbol, start, end, last, mark, rates):
    bounds = db.dicts(conn, f"SELECT price_type, MIN(ts_open) AS first_open_ms, MAX(ts_open) AS last_open_ms "
        f"FROM bar AS OF '{commit}' WHERE symbol = %s GROUP BY price_type", (symbol,))
    return {'format':'market-coverage-v1', 'commit':commit, 'symbol':symbol,
            'input_interval_ms':[start,end], 'LAST':series(last,start,end), 'MARK':series(mark,start,end),
            'last_mark_unmatched':int(len(np.setxor1d(last['ts_open'],mark['ts_open']))),
            'funding':{'rows':len(rates), 'first_ms':int(rates[0][0]) if rates else None,
                       'last_ms':int(rates[-1][0]) if rates else None,
                       'event_times_ms':[int(r[0]) for r in rates], 'expected_schedule':'not established by this store'},
            'member_months':[str(m) for (m,) in db.rows(conn, f"SELECT month FROM pool AS OF '{commit}' WHERE symbol = %s ORDER BY month", (symbol,))],
            'listing_delisting':{'status':'unproven', 'data_bounds_proxy':bounds,
                                 'reason':'store has observations and bars, no authoritative listing/delisting dates'},
            'indicator_readiness':{'status':'Agent review required', 'reason':'raw input counts do not prove strategy indicator readiness'},
            'interpretation':'facts only; do not silently change symbols/window, synthesize data or treat zero activity as economic failure'}


def diagnose(profile, *, at, symbols, start, end):
    from research.market.export import fetch, funding
    with db.reading(profile, at) as conn:
        commit = store.resolve(conn, at)
        return {'commit':commit, 'scope':'explicit symbols; not full-pool acceptance', 'coverage':[
            facts(conn, commit, symbol, start, end, fetch(conn,commit,symbol,'LAST',start,end),
                  fetch(conn,commit,symbol,'MARK',start,end), funding(conn,commit,symbol,start,end)) for symbol in symbols]}
