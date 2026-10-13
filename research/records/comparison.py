"""Read-only paired development evidence, never an adoption or research-eligibility decision.

Daily native account returns are paired by exact UTC clock, sampled together in circular
blocks. The null is mean daily log-return difference <= 0. Nested bootstrap studentization
and block-length sensitivity are reported, not used to choose versions or experiments.
"""
from __future__ import annotations

import hashlib
import json
import math
from statistics import NormalDist

import numpy as np

from research.records import db, records
from research.records.hypotheses import load, refuse, check_comparable

METHOD = 'paired-circular-log-mean-v1'
DESIGN_FIELDS = {'method', 'block_days', 'resamples', 'inner_resamples', 'seed', 'alpha',
                 'minimum_effect', 'design_reason'}


def validate_design(value):
    if not isinstance(value, dict) or set(value) != DESIGN_FIELDS or value['method'] != METHOD:
        raise refuse(f'comparison has exactly {sorted(DESIGN_FIELDS)} with method {METHOD}')
    for key, lower in (('block_days', 1), ('resamples', 999), ('inner_resamples', 99), ('seed', 0)):
        if type(value[key]) is not int or value[key] < lower:
            raise refuse(f'{key} must be an integer >= {lower}')
    if not isinstance(value['alpha'], (int, float)) or not 0 < value['alpha'] < 0.5:
        raise refuse('alpha must be a predeclared number in (0, .5)')
    if not isinstance(value['minimum_effect'], (int, float)) or not math.isfinite(value['minimum_effect']) or value['minimum_effect'] < 0:
        raise refuse('minimum_effect is a finite nonnegative annual-return fraction, descriptive only')
    records._note(value['design_reason'])


def _indices(rng, n, block, reps):
    starts = rng.integers(0, n, size=(reps, math.ceil(n / block)))
    return ((starts[:, :, None] + np.arange(block)) % n).reshape(reps, -1)[:, :n]


def paired(left, right, design, grid_points):
    """Arrays contain exactly matched native daily simple returns, control then candidate."""
    validate_design(design)
    a, b = np.asarray(left, dtype=float), np.asarray(right, dtype=float)
    if a.ndim != 1 or a.shape != b.shape or len(a) < 2 * design['block_days']:
        raise refuse('paired inference needs matching daily series with at least two full blocks', 'COMPARISON_UNAVAILABLE')
    if not np.isfinite(a).all() or not np.isfinite(b).all() or (a <= -1).any() or (b <= -1).any():
        raise refuse('daily returns must be finite and greater than -1', 'COMPARISON_UNAVAILABLE')
    logs = np.column_stack((np.log1p(a), np.log1p(b)))
    diff = logs[:, 1] - logs[:, 0]
    observed = float(diff.mean())
    alpha = design['alpha'] / grid_points
    rng = np.random.default_rng(design['seed'])
    idx = _indices(rng, len(a), design['block_days'], design['resamples'])
    means = logs[idx].mean(axis=1)
    sampled = means[:, 1] - means[:, 0]
    centered = sampled - observed
    p = float((1 + np.count_nonzero(centered >= observed)) / (len(sampled) + 1))
    se = float(sampled.std(ddof=1))
    quantiles = np.quantile(centered, [alpha / 2, 1 - alpha / 2])
    basic = [observed - float(quantiles[1]), observed - float(quantiles[0])]
    # The interval for CAGR difference is a separate paired percentile reading, not
    # a reinterpretation of the log-mean p value or of a minimum-effect test.
    annual = np.expm1(means[:, 1] * 365) - np.expm1(means[:, 0] * 365)
    annual_ci = [float(v) for v in np.quantile(annual, [alpha / 2, 1 - alpha / 2])]
    studentized = None
    degeneracies = 0
    if se > 1e-15:
        t = []
        for sample, estimate in zip(diff[idx], sampled, strict=True):
            inner = sample[_indices(rng, len(a), design['block_days'], design['inner_resamples'])].mean(axis=1)
            inner_se = float(inner.std(ddof=1))
            if inner_se <= 1e-15:
                degeneracies += 1
            else:
                t.append((estimate - observed) / inner_se)
        if not degeneracies:
            q = np.quantile(t, [alpha / 2, 1 - alpha / 2])
            studentized = [observed - se * float(q[1]), observed - se * float(q[0])]
    limitations = [
        'Development comparison after adaptive search is not independent validation.',
        'p is a null-model tail probability, never the probability a strategy or mechanism is valid.',
        'Bonferroni covers this registered grid only, not the complete adaptive research history.',
        'Block bootstrap requires adequately sampled, approximately stationary weakly dependent daily differences.',
        'CAGR interval is paired percentile evidence; p tests zero mean log difference, not minimum_effect.',
    ]
    if studentized is None:
        limitations.append('Studentized interval unavailable: degenerate outer or nested standard error; no substitute interval.')
    concentration = float(np.sort(np.abs(diff))[-min(5, len(diff)):].sum() / np.abs(diff).sum()) if np.abs(diff).sum() else 0.0
    sensitivity = []
    for block in sorted({max(1, design['block_days'] // 2), design['block_days'], design['block_days'] * 2}):
        if 2 * block > len(a):
            sensitivity.append({'block_days': block, 'available': False})
            continue
        sample = diff[_indices(np.random.default_rng(design['seed']), len(a), block, design['resamples'])].mean(axis=1)
        q = np.quantile(sample - observed, [alpha / 2, 1 - alpha / 2])
        sensitivity.append({'block_days': block, 'mean_log_interval': [observed - float(q[1]), observed - float(q[0])],
                            'p_one_sided': float((1 + np.count_nonzero(sample - observed >= observed)) / (len(sample) + 1))})
    mde = se * (NormalDist().inv_cdf(1 - alpha) + NormalDist().inv_cdf(.8))
    return {'method': METHOD, 'days': len(a), 'mean_daily_log_difference': observed,
            'mean_log_basic_interval': basic, 'mean_log_studentized_interval': studentized,
            'annual_return_difference': float(np.expm1(logs[:, 1].mean() * 365) - np.expm1(logs[:, 0].mean() * 365)),
            'annual_return_difference_interval': annual_ci, 'interval_coverage_grid_adjusted': 1 - alpha,
            'p_one_sided': p if se > 1e-15 else None, 'p_bonferroni': min(1., p * grid_points) if se > 1e-15 else None,
            'predeclared_alpha': design['alpha'], 'predeclared_minimum_effect': design['minimum_effect'],
            'detectable_mean_log_difference_80pct_normal_approx': mde,
            'top_five_absolute_difference_share': concentration, 'block_sensitivity': sensitivity,
            'degenerate_nested_samples': degeneracies, 'design': design, 'limitations': limitations}


def compare(profile, *, bundle, run_id, at=None):
    from research.records.analysis import load_run, _returns
    with db.reading(profile, at) as conn:
        plan, registered_at = load(conn, bundle)
        body, execution = plan['body'], plan['execution']
        control_id = body['control_run']
        if control_id is None:
            raise refuse('root registration has no comparison control', 'NO_CONTROL')
        candidate = records._run_with_trial(conn, run_id)
        control = records._run_with_trial(conn, control_id)
        binding = db.one(conn, 'SELECT * FROM research_execution WHERE bundle = %s AND trial_id = %s', (bundle, candidate['trial_id']))
        if not binding or binding['strategy_source_sha256'] != candidate['strategy_source_sha256']:
            raise refuse('run is not bound to this preregistered grid', 'REGISTRATION_REQUIRED')
        check_comparable(candidate, execution)
        check_comparable(control, execution)
        from research.records.availability import require
        candidate_availability = require(conn, candidate)
        control_availability = require(conn, control)
        values = []
        for run in (control, candidate):
            reports = load_run(conn, run['run_id'], account=False, exposures=False)
            limitations = []
            series = _returns(reports.returns, reports.summary, limitations)
            if series is None:
                raise refuse('; '.join(limitations), 'COMPARISON_UNAVAILABLE')
            values.append(series)
        clocks = [[ts for ts, _ in rows] for rows in values]
        if clocks[0] != clocks[1] or any(b - a != 86_400_000_000_000 for a, b in zip(clocks[0], clocks[0][1:])):
            raise refuse('daily account clocks must match exactly, with no missing or duplicate days', 'CLOCK_MISMATCH')
        (commit,), = db.rows(conn, "SELECT DOLT_HASHOF('HEAD')")
        result = paired([v for _, v in values[0]], [v for _, v in values[1]], body['comparison'], len(body['grid']))
        # Account output remains the product's recorded economics; bootstrap is a different statistic.
        result['observed_account_annual_return_difference'] = candidate['annual_return'] - control['annual_return']
    return {'bundle': bundle, 'run_id': run_id, 'control_run_id': control_id, 'research_parent': body['parent'],
            'ledger_commit': commit, 'registered_at': registered_at.isoformat() + 'Z',
            'reader_revision': records.reader_revision(),
            'comparison_source_sha256': hashlib.sha256(__import__('pathlib').Path(__file__).read_bytes()).hexdigest(),
            'availability': {'candidate': candidate_availability, 'control': control_availability}, 'evidence': result}
