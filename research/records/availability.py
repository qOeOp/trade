"""One current, read-only economic-evidence view; never rewrite stored audit verdicts.

Record completeness/activity is not economic quality or candidate identity. Agent causal
reviews are explicitly attributed and remain separate from the native account audit.
"""
from __future__ import annotations
import hashlib
import json
from decimal import Decimal
from pathlib import Path
from research.records import db
from research.records.common import RecordError

ECONOMIC_KEYS = ('final_equity_usdt', 'annual_return', 'max_drawdown', 'return_drawdown', 'plans_closed',
    'plans_won', 'plans_open', 'plan_win_rate', 'closed_positions', 'open_positions', 'realized_pnl_usdt',
    'commissions_usdt', 'funding_usdt', 'price_pnl_usdt', 'unrealized_usdt', 'closed_by_year', 'gates')


def identity():
    from research.records.records import reader_revision
    return {'check': 'economic-evidence-v1', 'reader_revision': reader_revision(),
            'source_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}


def source_reviews(conn, run):
    """Surface identity-bound Agent findings, not a product reconstruction of the signal."""
    reviews = []
    # Legacy explicit causal-failure receipts are existing data, not retroactively created checks.
    found = db.rows(conn, "SELECT bundle, path, content, sha256 FROM evidence "
                         "WHERE path LIKE '%causal-review.json' OR path = 'source-review.json'")
    for bundle, path, content, sha in found:
        if hashlib.sha256(content).hexdigest() != sha:
            raise RecordError('source review content hash differs', code='LEDGER_CORRUPT')
        try:
            item = json.loads(content)
            if item.get('format') == 'source-review-v1':
                if item.get('source_sha256') != run['strategy_source_sha256'] or item.get('image_ref') != run['image_ref']:
                    continue
                status = item['causal']['status']
            elif item.get('run_id') == run['run_id'] and item.get('causal_status') == 'implementation_failure':
                # Resolve the retained receipt's historical run identity, rather than infer
                # source from names or a post-hoc probe. AS OF never writes old branches.
                prior = db.one(conn, 'SELECT t.strategy_source_sha256, t.image_ref FROM run AS OF %s r '
                    'JOIN trial AS OF %s t ON t.trial_id = r.trial_id WHERE r.run_id = %s',
                    (item['ledger_commit'], item['ledger_commit'], run['run_id']))
                if prior is None or (prior['strategy_source_sha256'], prior['image_ref']) != (
                        run['strategy_source_sha256'], run['image_ref']):
                    continue
                status = 'failed'
            else:
                continue
            reviews.append({'bundle': bundle, 'path': path, 'sha256': sha, 'status': status,
                            'authority': 'Agent source review, separate from account audit'})
        except (ValueError, KeyError, TypeError):
            continue
    status = 'failed' if any(r['status'] == 'failed' for r in reviews) else (
        'passed' if any(r['status'] == 'passed' for r in reviews) else 'unreviewed')
    return {'status': status, 'reviews': reviews, 'scope': 'Agent causal responsibility; audit passed is not source validity'}


def native_reasons(reports):
    from research.records.analysis import _cycles, _economics, _returns, TOLERANCE, _Unreconciled
    reasons = []
    counts = {'orders':len(reports.orders), 'fills':len(reports.fills), 'positions':len(reports.positions), 'account_rows':len(reports.account or [])}
    if not counts['fills']:
        reasons.append('No real native fills: diagnostic activity only, not an economic comparison.')
    elif not counts['orders'] or not counts['positions'] or not counts['account_rows']:
        reasons.append('Native activity lacks its expected order, position or account records.')
    if not reasons:
        try:
            if reports.summary is None or not reports.audit or not reports.audit.get('passed'):
                raise ValueError('native summary/audit unavailable')
            native = reports.audit.get('native_economics')
            if native is None:
                raise ValueError('audited native account economics unavailable')
            for label, actual in [('native_orders',counts['orders']),('native_fills',counts['fills']),('native_positions',counts['positions'])]:
                if label in reports.audit and reports.audit[label] != actual:
                    raise ValueError(f'{label} count differs from retained audit')
            orders = {row.get('client_order_id'):row for row in reports.orders}
            if len(orders) != len(reports.orders) or any(not fill.get('client_order_id') or fill['client_order_id'] not in orders for fill in reports.fills):
                raise ValueError('native fills lack matching unique orders')
            cycles = _cycles(reports.positions, reports.fills)
            _economics(cycles, reports.fills, reports.summary, native, [])
            limits = []
            if _returns(reports.returns, reports.summary, limits) is None:
                raise ValueError('; '.join(limits))
            for field in ('total',):
                first = Decimal(reports.account[0][field]); last = Decimal(reports.account[-1][field])
                if abs(first - Decimal(reports.summary['starting_balance_usdt'])) > TOLERANCE or abs(
                        last - Decimal(native['final_balance_usdt'])) > TOLERANCE:
                    raise ValueError('native account rows disagree with audited balances')
        except (IndexError, KeyError, TypeError, ValueError, ArithmeticError, RecordError, _Unreconciled) as exc:
            reasons.append(f'Native activity records do not reconcile: {exc}')
    return reasons


def assess(conn, run):
    from research.records.analysis import load_run
    from research.records.execution import read
    counts = db.one(conn, 'SELECT (SELECT COUNT(*) FROM run_order WHERE run_id = %s) AS orders, '
                         '(SELECT COUNT(*) FROM run_fill WHERE run_id = %s) AS fills, '
                         '(SELECT COUNT(*) FROM run_position WHERE run_id = %s) AS positions, '
                         '(SELECT COUNT(*) FROM run_account WHERE run_id = %s) AS account_rows', (run['run_id'],)*4)
    reasons = []
    capture = read(conn, run['trial_id'])
    source = source_reviews(conn, run)
    if run['status'] != 'passed':
        reasons.append('Stored native audit/run is invalid; no economic feedback.')
    if capture['status'] == 'captured':
        if capture.get('runtime_failures') or capture.get('outcome') != 'completed' or any(
                phase is None or phase.get('exit_code') != 0 for phase in capture.get('phases', {}).values()):
            reasons.append('Original execution capture records a failure or incomplete phase.')
    if source['status'] == 'failed':
        reasons.append('Retained identity-bound Agent source review reports a causal/implementation failure.')
    reasons += native_reasons(load_run(conn, run['run_id'], account=True, exposures=False))
    return {'economic_evidence_available': not reasons, 'reasons': reasons, 'activity': counts,
            'stored_audit_status': run['status'], 'source_check': source,
            'execution_logs': {'status':capture['status'], 'phase':capture.get('phase'),
                               'runtime_failures':capture.get('runtime_failures', []),
                               'original_missing':capture['status']=='missing'},
            'checker': identity(),
            'applicability': 'real fills and matching native records; no frequency/sample/return threshold',
            'limitations': ['Source causal correctness is separately reviewed by the Agent.',
                           'Missing legacy logs remain missing; absence does not prove no callback exception.']}


def require(conn, run):
    value = assess(conn, run)
    if not value['economic_evidence_available']:
        raise RecordError(f"run {run['run_id']}: " + '; '.join(value['reasons']), code='ECONOMIC_EVIDENCE_UNAVAILABLE',
                          write_status='not_written', expected=value)
    return value


def mask(output, value):
    output['availability'] = value
    if not value['economic_evidence_available']:
        for key in ECONOMIC_KEYS:
            if key in output:
                output[key] = None
        output['cost_basis'] = None
    return output


def directory_view(reports):
    reasons = native_reasons(reports)
    return {'economic_evidence_available':not reasons, 'reasons':reasons, 'checker':identity(),
            'applicability':'temporary native reports only; no frequency/sample/return threshold',
            'limitations':['Directory bytes are unsealed; source and original execution custody are not independently verified.']}
