"""Offline fixture and verifier tests. No BacktestEngine/LiveNode/container/service/replay is started."""
import argparse
import copy
import csv
import gzip
import shutil
from decimal import Decimal
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import generator
import verify_pair

REPO = Path(os.environ["PAIRING_TEST_REPO"]).resolve()
sys.path.insert(0, str(REPO))


def trace_clock(record):
    return record[4] if record[0] in ('bar', 'order') else record[3]


def table(path, values, empty_fields=()):
    fields = sorted({field for row in values for field in row}) if values else list(empty_fields)
    opener = gzip.open if path.suffix == '.gz' else open
    with opener(path, 'wt', newline='') as stream:
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        writer.writerows(values)


def synthetic_suite(root):
    """Fabricated acceptance inputs, not receipts from a runtime or proof a native auditor passed."""
    from engine.compare import report_fingerprint
    from engine.config import config_sha256, execution_account
    from runtime.image import layout
    root.mkdir()
    baseline = generator.verify_baseline(REPO)
    generator.write_json(root / 'baseline.json', baseline)
    sources = generator.generate_sources(REPO, root / 'sources')
    suite = {'old_runtime': 'ghcr.io/qoeop/trade-runtime@sha256:' + 'a' * 64,
             'new_runtime': 'ghcr.io/qoeop/trade-runtime@sha256:' + 'b' * 64,
             'old_revision': 'a' * 40, 'new_revision': 'b' * 40, 'host_revision': 'b' * 40,
             'platform': 'linux/amd64', 'pairs': []}
    minute = verify_pair.MINUTE_NS
    submitted = verify_pair.ns('2026-01-01T07:31:59.999Z')
    partial = verify_pair.ns('2026-01-01T07:33:59.999Z')
    settlement = verify_pair.ns('2026-01-01T08:00:00Z')
    expiry = submitted + 72 * minute
    stopped = verify_pair.ns('2026-01-01T08:48:59.999Z')
    fee_entry, fee_exit, funding = Decimal('.00515'), Decimal('.0123625'), Decimal('-.0026')
    realized = Decimal('.25') * Decimal('-4.10') - fee_entry - fee_exit + funding
    for kind in ('probe', 'protection'):
        for symbols in (['BTCUSDT'], ['ETHUSDT'], ['BTCUSDT', 'ETHUSDT']):
            source = sources['sources'][kind]
            start, trade, end = (verify_pair.ns(source[key]) for key in ('start', 'trade_start', 'end'))
            name = kind + '-' + '-'.join(symbols)
            pair = {'name': name, 'kind': kind, 'symbols': symbols, 'source': source, 'sides': {}}
            suite['pairs'].append(pair)
            orders, fills, positions, events, per_coin, receipts = [], [], [], [], [], {}
            for symbol in symbols:
                iid = symbol + '-PERP.BINANCE'
                local_events = []
                for suffix, direction, type_, status, qty, filled in (
                        ('entry', 'BUY', 'LIMIT', 'EXPIRED', '16.339', '.250'),
                        ('stop', 'SELL', 'STOP_MARKET', 'FILLED', '.250', '.250'),
                        ('target', 'SELL', 'LIMIT', 'CANCELED', '.250', '0')):
                    cid = symbol + '-' + suffix
                    orders.append({'client_order_id': cid, 'instrument_id': iid, 'side': direction, 'type': type_,
                                   'status': status, 'quantity': qty, 'filled_qty': filled, 'ts_init': str(submitted),
                                   'is_reduce_only': str(suffix != 'entry'), 'time_in_force': 'GTD' if suffix == 'entry' else 'GTC',
                                   'expire_time_ns': str(expiry) if suffix == 'entry' else ''})
                    sequence = [('OrderInitialized', submitted), ('OrderSubmitted', submitted), ('OrderAccepted', submitted)]
                    if suffix == 'entry':
                        sequence += [('OrderFilled', partial), ('OrderExpired', expiry)]
                    elif suffix == 'stop':
                        sequence += [('OrderUpdated', partial), ('OrderFilled', stopped)]
                    else:
                        sequence += [('OrderUpdated', partial), ('OrderCanceled', stopped)]
                    for type_name, at in sequence:
                        event = {'client_order_id': cid, 'instrument_id': iid, 'type': type_name,
                                 'ts_event': at, 'ts_init': at}
                        if type_name == 'OrderUpdated':
                            event['quantity'] = '.250'
                        if type_name == 'OrderFilled':
                            event.update(last_qty='.250', trade_id=symbol + '-' + suffix + '-trade')
                        local_events.append(event)
                events.extend(local_events)
                fills.extend({'client_order_id': symbol + '-' + suffix, 'instrument_id': iid, 'last_qty': '.250',
                              'last_px': px, 'commission': str(fee) + ' USDT', 'ts_event': str(at),
                              'trade_id': symbol + '-' + suffix + '-trade'}
                             for suffix, px, fee, at in [('entry', '103.00', fee_entry, partial),
                                                         ('stop', '98.90', fee_exit, stopped)])
                adjustment = {'adjustment_type': 'FUNDING', 'pnl_change': str(funding) + ' USDT',
                              'ts_event': settlement, 'instrument_id': iid}
                positions.append({'instrument_id': iid, 'position_id': symbol + '-position', 'side': 'FLAT', 'quantity': '0',
                                  'opening_order_id': symbol + '-entry', 'closing_order_id': symbol + '-stop',
                                  'ts_opened': str(partial), 'ts_closed': str(stopped),
                                  'realized_pnl': str(realized) + ' USDT', 'adjustments': repr([adjustment])})
                minute_times = list(range(start + minute - 10**6, end, minute))
                period = 8 * 60 * minute
                funding_times = list(range(-(-start // period) * period, end, period))
                trace = [['bar', iid + '-1-MINUTE-LAST-EXTERNAL', at, at, at] for at in minute_times]
                trace += [['mark', at, at, at] for at in minute_times]
                trace += [['funding', at, at, at] for at in funding_times]
                trace += [['order', event['type'], event['ts_event'], event['ts_init'], event['ts_event'], event['client_order_id']]
                          for event in local_events]
                if kind == 'probe':
                    trace += [['bar', iid + '-15-MINUTE-LAST-INTERNAL', at, at, at]
                              for at in range(start + 15 * minute, end, 15 * minute)]
                trace.sort(key=trace_clock)
                counted = [item[2] for item in trace if item[0] == 'bar' and item[2] >= trade]
                if kind == 'probe':
                    horizon = trace_clock(trace[-1])
                    interval = 37 * minute + 13000
                    trace += [['timer', at, start, at, 'T-' + iid] for at in range(start + interval, horizon + 1, interval)]
                    trace += [['timer', at + 90_000_000_007, at, at + 90_000_000_007, f'A-{iid}-{number}']
                              for number, at in enumerate(counted, 1) if number % 41 == 0 and at + 90_000_000_007 <= horizon]
                    trace.sort(key=trace_clock)
                counts = {'last': len(minute_times), 'mark': len(minute_times), 'funding': len(funding_times)}
                per_coin.append({'coin': symbol[:-4], 'instrument': iid, 'seen': trace, 'trace_schema': generator.TRACE_SCHEMA,
                                 'counts': counts, 'bars': len(counted)})
                receipts[symbol] = {'pieces': [{'instrument_id': iid, 'counts': counts,
                                     'first_bar_ns': minute_times[0], 'last_bar_ns': minute_times[-1],
                                     'missing_minutes': 0, 'last_mark_unmatched': 0}]}
            size = len(symbols)
            final = Decimal(100000) + size * realized
            accounts = [{'ts_event': str(at), 'total': str(balance)} for at, balance in (
                (start, Decimal(100000)), (partial, Decimal(100000) - size * fee_entry),
                (settlement, Decimal(100000) - size * fee_entry + size * funding), (stopped, final))]
            effective = {'runtime_contract': verify_pair.CONTRACT, 'symbols': symbols, 'account': execution_account('bars', None),
                         'market_root': '/synthetic/catalog', 'market_commit': 'c' * 32,
                         **{key: source[key] for key in ('start', 'trade_start', 'end')}}
            coverage = {'format': 'execution-input-coverage-v1', 'input_identity': {'market_commit': 'c' * 32},
                        'effective_config': effective, 'export_receipts': receipts}
            for side in ('reference', 'candidate'):
                directory = root / name / side
                for folder in ('reports', 'source', 'start-receipt', 'audit', 'fingerprint'):
                    (directory / folder).mkdir(parents=True)
                reports = directory / 'reports'
                runtime = verify_pair.expected_runtime(suite, side)
                four = {key: value for key, value in runtime.items() if key != 'build_revision'}
                trial = len(suite['pairs']) * 2 + (side == 'candidate')
                pair['sides'][side] = {'directory': str(directory.relative_to(root)), 'runtime': runtime, 'trial_id': trial}
                argv = ['--symbols', *symbols, '--strategy-class', source['class'], '--strategy-sha256', source['sha256'],
                        '--strategy-file', '/strategy/strategy.py', '--execution-binding', '/strategy/execution.json']
                generator.write_json(directory / 'start-receipt/execution.json', {
                    'format': 'execution_start_v1', 'purpose': 'explore', 'trial_id': trial, 'runtime_identity': runtime,
                    'source_sha256': source['sha256'], 'input_identity': coverage['input_identity'], 'argv': argv})
                generator.write_json(directory / 'source/execution.json', {'runtime_identity': four,
                    'effective_config': effective, 'effective_config_sha256': config_sha256(effective)})
                generator.write_json(directory / 'cli-result.json', {'trial_id': trial, 'status': 'passed'})
                generator.write_json(directory / 'process.json', {'trial_id': trial, 'purpose': 'explore',
                    'stages': {stage: {'state': 'exited', 'exit_code': 0} for stage in ('native', 'audit', 'fingerprint')},
                    'commands': {stage: ['docker', 'run', '--platform', 'linux/amd64', '--entrypoint', 'python',
                                        runtime['image_ref'], '-m', module, *(argv if stage == 'native' else [])]
                                 for stage, module in (('native', 'engine.run'), ('audit', 'engine.audit'), ('fingerprint', 'engine.compare'))}})
                for path in ('source/strategy.py', 'start-receipt/strategy.py'):
                    (directory / path).write_bytes((root / 'sources' / source['file']).read_bytes())
                for name_, values in [('orders', orders), ('fills', fills), ('positions', positions), ('account', accounts)]:
                    table(reports / (name_ + '.csv'), values)
                table(reports / 'returns_series.csv', [], ['ts_event_ns', 'native_return'])
                table(reports / 'fill_volumes.csv', [], ['ts_event_ns', 'volume'])
                table(reports / 'exposures.csv.gz', [], ['ts_event_ns', 'position_id', 'unrealized_pnl'])
                with gzip.open(reports / 'order_events.jsonl.gz', 'wt') as stream:
                    stream.writelines(json.dumps(e) + '\n' for e in events)
                summary = {'integrity_passed': True, 'integrity_findings': [], 'denied_orders': 0, 'rejected_orders': 0,
                           'engine_version': '2.0.0rc7', 'execution': 'bars', 'source_sha256': source['sha256'],
                           'strategy_uses_stop_loss': source['uses_stop_loss'], 'per_coin': per_coin,
                           'input_start_utc': source['start'], 'period_end_utc': source['end'], 'final_equity_usdt': str(final),
                           'net_change_usdt': str(final - 100000), 'runtime_identity': four,
                           'effective_config_sha256': config_sha256(effective),
                           'period_return': '0', 'annual_return': '0', 'sharpe_365': '0', 'closed_trades': size, 'winning_trades': 0}
                generator.write_json(reports / 'summary.json', summary)
                generator.write_json(directory / 'audit/audit.json', {'passed': True, 'findings': [],
                    'strategy_uses_stop_loss': source['uses_stop_loss'], 'uncovered_intervals': [],
                    'native_economics': {'fill_commissions_usdt': str(size * (fee_entry + fee_exit)),
                                        'reported_funding_usdt': str(size * funding), 'funding_adjustments': size}})
                paths = layout(verify_pair.CONTRACT)['source_paths']
                generator.write_json(directory / 'runtime-inspection.json', {
                    'dependency_lock_sha256': baseline['files']['uv.lock'], 'audit_source_sha256': baseline['files']['engine/audit.py'],
                    'source_file_paths': paths, 'source_files_sha256': {key: baseline['files'][path] for key, path in paths.items()},
                    'runtime_contract': verify_pair.CONTRACT, 'engine_version': '2.0.0rc7', 'python_version': '3.14.0',
                    'effective_config': effective, 'effective_config_sha256': config_sha256(effective)})
                for path in ('input-coverage.json', 'start-receipt/input-coverage.json'):
                    generator.write_json(directory / path, coverage)
                generator.write_json(directory / 'fingerprint/fingerprint.json', report_fingerprint(reports))
    generator.write_json(root / 'suite.json', suite)
    return suite


class OfflineTests(unittest.TestCase):
    def test_pinned_native_schema_and_original_source_bytes_are_preserved(self):
        schema = verify_pair.verify_native_bar_schema()
        self.assertFalse(schema['equal'])
        self.assertNotIn('@', schema['emitted'])
        self.assertIn('@', schema['subscription'])
        with tempfile.TemporaryDirectory(prefix='pair-v3-source-') as temp:
            manifest = generator.generate_sources(REPO, Path(temp) / 'sources')
            self.assertEqual({kind: item['sha256'] for kind, item in manifest['sources'].items()}, {
                'probe': '3359390d7c02e5fea17ed75bfda3d2a0c1fd23df0ffc210edbaa495c1d1373e9',
                'protection': '726b9800e6b7d1eed2f604e11b8a677521f41d048102f8613738d32d2b5a9bfd'})

    def test_ast_generation_is_deterministic_and_original_source_check_passes(self):
        from engine.load import load_strategy, source_findings
        from engine.run import configure_strategy, StrategyInputs
        with tempfile.TemporaryDirectory(prefix="pair-source-") as temp:
            root = Path(temp)
            a = generator.generate_sources(REPO, root / "one")
            b = generator.generate_sources(REPO, root / "two")
            self.assertEqual(a, b)
            for name, source in a["sources"].items():
                path = root / "one" / source["file"]
                self.assertEqual(source_findings(path.read_bytes()), [])
                loaded = load_strategy(path, source["class"], source["sha256"])
                # Construct only. No registration, on_start, data feed or native engine run.
                instance = configure_strategy(loaded, StrategyInputs(
                    instrument_id="BTCUSDT-PERP.BINANCE", strategy_id="R1-BTC",
                    catalog_path=str(root), input_start_ns=verify_pair.ns(source["start"]),
                    trade_start_ns=verify_pair.ns(source["trade_start"]),
                    universe_membership=((generator.JAN * 10**6, (generator.JAN + 2 * generator.DAY) * 10**6),)))
                self.assertEqual(str(instance.iid), "BTCUSDT-PERP.BINANCE")
                self.assertEqual(loaded.uses_stop_loss, name == "protection")
                self.assertEqual(instance.replay_diagnostics()["seen"], [])

    def test_protection_data_preserves_partial_expiry_stop_and_funding_geometry(self):
        last, mark = generator.columns("protection", 1)
        index = 1440 + 450
        scale = Decimal(10**8)
        def values(i):
            return tuple(Decimal(int(last[key][index + i])) / scale for key in ("open", "high", "low", "close", "volume"))
        self.assertEqual(values(3), (105, 105, Decimal("102.9"), 104, 1))
        self.assertEqual(values(78), (104, 104, Decimal("98.8"), 99, 1000))
        self.assertTrue(all(value == 0 for value in mark["volume"]))
        self.assertTrue(all(last["volume"] > 0))
        start = verify_pair.ns(generator.WINDOWS["protection"]["start"])
        entry, expiry, stop = start + 4 * 60 * 10**9 - 10**6, start + 74 * 60 * 10**9 - 10**6, start + 79 * 60 * 10**9 - 10**6
        funding = verify_pair.ns("2026-01-01T08:00:00Z")
        self.assertLess(entry, funding)
        self.assertLess(funding, expiry)
        self.assertLess(expiry, stop)

    def test_cli_isolated_market_seed_export_no_ledger_or_replay(self):
        from market import coverage, export, files, universe
        manifest = {}
        with tempfile.TemporaryDirectory(prefix="pair-market-") as temp:
            root = Path(temp)
            env = {"PATH": os.environ["PATH"], "HOME": os.environ["HOME"], "TRADE_LEDGER_HOME": str(root / "profiles"),
                   "PYTHONDONTWRITEBYTECODE": "1"}
            for kind in generator.WINDOWS:
                result = subprocess.run([sys.executable, "-m", "cli.main", "market", "init", "--name", kind,
                                         "--kind", "isolated", "--root", str(root / kind)],
                                        cwd=REPO, env=env, capture_output=True, text=True, check=True)
                profile = json.loads(Path(json.loads(result.stdout)["profile"]).read_text())
                self.assertEqual(profile["role"], "isolated")
                commit = generator.seed_market(kind, profile)
                window = generator.WINDOWS[kind]
                start, end = verify_pair.ns(window["start"]), verify_pair.ns(window["end"])
                market = files.open_market(profile, "reader")
                self.assertEqual(set(universe.membership_path(market, commit, end)["membership"]), set(generator.SYMBOLS))
                exported = export.export_catalogs(profile, commit, generator.SYMBOLS, start, end,
                                                   root=root / (kind + "-cache"), include_quotes=False, workers=1)
                self.assertEqual(set(exported["receipts"]), set(generator.SYMBOLS))
                for symbol in generator.SYMBOLS:
                    funding = coverage.read_funding(market, commit, symbol, start // 10**6, end // 10**6)
                    self.assertTrue(funding)
                    if kind == "protection":
                        self.assertEqual(funding, [(generator.JAN + 8 * 60 * generator.MINUTE, Decimal("0.0001"))])
                inputs = generator.input_manifest(profile)
                self.assertTrue(inputs)
                manifest[kind] = {"commit": commit, "input_files_sha256": inputs,
                                  "export_receipts": exported["receipts"]}
        if os.environ.get("PAIRING_OFFLINE_REPORT"):
            generator.write_json(Path(os.environ["PAIRING_OFFLINE_REPORT"]) / 'offline-inputs.json', manifest)

    def test_runtime_and_output_arguments_fail_before_effects(self):
        from run_pair import validate_arguments
        args = argparse.Namespace(old_runtime="ghcr.io/qoeop/trade-runtime@sha256:" + "a" * 64,
                                  new_runtime="ghcr.io/qoeop/trade-runtime@sha256:" + "b" * 64,
                                  old_revision="a" * 40, new_revision="b" * 40, output=Path("/tmp/new-pair-fixture-never-created"))
        with patch("run_pair.platform.system", return_value="Linux"), patch("run_pair.platform.machine", return_value="x86_64"):
            validate_arguments(args)
            args.new_runtime = args.old_runtime
            with self.assertRaises(ValueError):
                validate_arguments(args)
        args.new_runtime = "ghcr.io/qoeop/trade-runtime:main"
        with self.assertRaises(ValueError):
            validate_arguments(args)

    def test_empty_and_duplicate_pairs_cannot_pass(self):
        with tempfile.TemporaryDirectory(prefix="pair-verify-") as temp:
            root = Path(temp)
            generator.write_json(root / "suite.json", {"pairs": []})
            with self.assertRaisesRegex(ValueError, "six requested pairs"):
                verify_pair.verify_suite(root)

    def test_economic_checker_rejects_corrupt_funding_fees_and_equity(self):
        from tests.engine.test_native_audit import reports
        native = reports()
        native["exposures"] = []
        native["returns_series"] = []
        native["summary"]["period_end_utc"] = "2026-01-01T00:11:00Z"
        audit = {"native_economics": {"fill_commissions_usdt": "2", "reported_funding_usdt": "1", "funding_adjustments": 1}}
        with patch.object(verify_pair, "rows", side_effect=lambda directory, name: native[name]):
            observed, _, _ = verify_pair.native_economics(Path("unused"), native["summary"], audit, ["BTCUSDT"])
            self.assertEqual(observed["independent_funding_states"], 1)
            wrong_fee = copy.deepcopy(audit)
            wrong_fee["native_economics"]["fill_commissions_usdt"] = "0"
            with self.assertRaisesRegex(ValueError, "fee sum"):
                verify_pair.native_economics(Path("unused"), native["summary"], wrong_fee, ["BTCUSDT"])
            wrong_equity = {**native["summary"], "final_equity_usdt": "100010"}
            with self.assertRaisesRegex(ValueError, "final MARK equity"):
                verify_pair.native_economics(Path("unused"), wrong_equity, audit, ["BTCUSDT"])
            native["account"][2]["total"] = "100001"
            with self.assertRaisesRegex(ValueError, "funding does not reconcile"):
                verify_pair.native_economics(Path("unused"), native["summary"], audit, ["BTCUSDT"])



    def test_six_pair_control_and_counterexamples_use_real_comparators(self):
        from engine.compare import report_fingerprint
        checks = {
            'same_runtime': 'side runtime differs',
            'missing_traces': 'exactly one complete trace',
            'duplicate_trace': 'exactly one complete trace',
            'missing_symbol': 'exactly one complete trace',
            'future_init': 'noncausal bar callback',
            'future_event': 'noncausal bar callback',
            'callback_regression': 'callback clock moved backwards',
            'missing_minute': 'minute trace does not cover',
            'missing_mark': 'MARK trace does not cover',
            'missing_funding': 'funding trace does not cover',
            'missing_internal': 'internal 15-minute callbacks',
            'missing_timer': 'timer paths not both observed',
            'expired_before_fill': 'event clock moved backwards',
            'expiry_early': 'native GTD expiry/partial event',
            'expiry_late': 'native GTD expiry/partial event',
            'requested_expiry': 'requested GTD deadline',
            'stop_canceled': 'stop became terminal',
            'stop_shrunk': 'stop update lost partial',
            'wrong_trial': 'trial identity differs',
            'wrong_source': 'start receipt source mismatch',
            'wrong_stage_image': 'recorded stage image',
            'wrong_stage_platform': 'recorded stage platform',
            'empty_inspection_paths': 'source path schema',
            'denied_event': 'denied/rejected events',
            'composite_callback': 'unexpected bar trace schema/type',
            'external_only_counter': 'source mixed bar counter differs',
            'internal_head': 'complete input-derived range',
            'internal_tail': 'complete input-derived range',
            'internal_gap': 'complete input-derived range',
            'alert_missing': 'alert names/deadlines differ',
            'alert_deadline': 'alert names/deadlines differ',
            'alert_minute_only': 'alert names/deadlines differ',
            'periodic_missing': 'periodic timer schedule differs',
        }
        with tempfile.TemporaryDirectory(prefix='pair-v3-regressions-') as temp:
            root = Path(temp)
            control = root / 'control'
            suite = synthetic_suite(control)
            positive = verify_pair.verify_suite(control)
            self.assertTrue(positive['passed'], positive)
            self.assertEqual(len(positive['pairs']), 6)
            for pair in suite['pairs']:
                if pair['kind'] == 'probe':
                    summary = json.loads((control / pair['sides']['reference']['directory'] / 'reports/summary.json').read_text())
                    for row in summary['per_coin']:
                        bars = [item for item in row['seen'] if item[0] == 'bar']
                        internal = [item for item in bars if '-15-MINUTE-' in item[1]]
                        self.assertEqual(len(internal), 191)
                        self.assertTrue(all('@' not in item[1] for item in internal))
                        trade = verify_pair.ns(pair['source']['trade_start'])
                        self.assertEqual(row['bars'], sum(item[2] >= trade for item in bars))
                        self.assertEqual(row['bars'], 3066)
            observations = {'synthetic_control': {'passed': True, 'pairs': 6}, 'counterexamples': {},
                            'v2_schema_closures': {'native_standard_internal_type': 'admitted in all three Probe groups',
                                                   'preserved_probe_counter': '3066 mixed callbacks admitted; 2875 external inputs counted separately'}}
            for mutation, expected in checks.items():
                with self.subTest(mutation=mutation):
                    target = root / mutation
                    shutil.copytree(control, target)
                    manifest = copy.deepcopy(suite)
                    for pair in manifest['pairs']:
                        if mutation in ('missing_internal', 'missing_timer') and pair['kind'] != 'probe':
                            continue
                        if mutation in ('composite_callback', 'external_only_counter', 'internal_head', 'internal_tail',
                                        'internal_gap', 'alert_missing', 'alert_deadline', 'alert_minute_only', 'periodic_missing') \
                                and pair['kind'] != 'probe':
                            continue
                        if mutation in ('expired_before_fill', 'expiry_early', 'expiry_late', 'requested_expiry',
                                        'stop_canceled', 'stop_shrunk') and pair['kind'] != 'protection':
                            continue
                        if mutation == 'missing_symbol' and len(pair['symbols']) != 2:
                            continue
                        for side in ('reference', 'candidate'):
                            directory = target / pair['sides'][side]['directory']
                            def edit(path, fn, directory=directory):
                                file = directory / path
                                value = json.loads(file.read_text())
                                fn(value)
                                generator.write_json(file, value)
                            if mutation == 'same_runtime':
                                runtime = verify_pair.expected_runtime(manifest, 'reference')
                                old_ref = pair['sides'][side]['runtime']['image_ref']
                                pair['sides'][side]['runtime'] = runtime
                                edit('start-receipt/execution.json', lambda v, runtime=runtime: v.update(runtime_identity=runtime))
                                four = {k: v for k, v in runtime.items() if k != 'build_revision'}
                                edit('source/execution.json', lambda v, four=four: v.update(runtime_identity=four))
                                edit('reports/summary.json', lambda v, four=four: v.update(runtime_identity=four))
                                edit('process.json', lambda v, runtime=runtime, old_ref=old_ref: v.update(commands={k: [runtime['image_ref'] if a == old_ref else a for a in cmd]
                                                                                 for k, cmd in v['commands'].items()}))
                            elif mutation in ('missing_traces', 'duplicate_trace', 'missing_symbol'):
                                def alter(value, mutation=mutation, pair=pair, side=side):
                                    if mutation == 'missing_traces':
                                        value['per_coin'] = []
                                    elif mutation == 'duplicate_trace':
                                        value['per_coin'].append(copy.deepcopy(value['per_coin'][0]))
                                    else:
                                        value['per_coin'] = value['per_coin'][:-1]
                                edit('reports/summary.json', alter)
                            elif mutation in ('composite_callback', 'external_only_counter', 'internal_head', 'internal_tail',
                                              'internal_gap', 'alert_missing', 'alert_deadline', 'alert_minute_only', 'periodic_missing'):
                                def alter(value, mutation=mutation, pair=pair):
                                    trade = verify_pair.ns(pair['source']['trade_start'])
                                    horizon = verify_pair.ns(pair['source']['end']) - 10**6
                                    for row in value['per_coin']:
                                        trace = row['seen']
                                        internal = [item for item in trace if item[0] == 'bar' and '-15-MINUTE-' in item[1]]
                                        if mutation == 'composite_callback':
                                            for item in internal:
                                                item[1] += '@1-MINUTE-EXTERNAL'
                                        elif mutation == 'external_only_counter':
                                            row['bars'] -= sum(item[2] >= trade for item in internal)
                                        elif mutation.startswith('internal_'):
                                            index = {'internal_head': 0, 'internal_tail': -1, 'internal_gap': len(internal) // 2}[mutation]
                                            trace.remove(internal[index])
                                            # Recompute the dependent counter/alerts, so a deleted edge cannot be rejected
                                            # merely by its stale diagnostics; independent window coverage must catch it.
                                            counted = [item[2] for item in trace if item[0] == 'bar' and item[2] >= trade]
                                            row['bars'] = len(counted)
                                            trace[:] = [item for item in trace if not (item[0] == 'timer' and item[4].startswith('A-'))]
                                            trace += [['timer', at + 90_000_000_007, at, at + 90_000_000_007,
                                                       f'A-{row["instrument"]}-{number}']
                                                      for number, at in enumerate(counted, 1)
                                                      if number % 41 == 0 and at + 90_000_000_007 <= horizon]
                                            trace.sort(key=trace_clock)
                                        elif mutation == 'alert_minute_only':
                                            counted = [item[2] for item in trace if item[0] == 'bar' and '-1-MINUTE-' in item[1] and item[2] >= trade]
                                            trace[:] = [item for item in trace if not (item[0] == 'timer' and item[4].startswith('A-'))]
                                            trace += [['timer', at + 90_000_000_007, at, at + 90_000_000_007,
                                                       f'A-{row["instrument"]}-{number}']
                                                      for number, at in enumerate(counted, 1)
                                                      if number % 41 == 0 and at + 90_000_000_007 <= horizon]
                                            trace.sort(key=trace_clock)
                                        else:
                                            prefix = 'T-' if mutation == 'periodic_missing' else 'A-'
                                            event = next(item for item in trace if item[0] == 'timer' and item[4].startswith(prefix))
                                            if mutation == 'alert_deadline':
                                                event[1] += 1
                                                event[3] += 1
                                                trace.sort(key=trace_clock)
                                            else:
                                                trace.remove(event)
                                edit('reports/summary.json', alter)
                            elif mutation in ('future_init', 'future_event', 'callback_regression', 'missing_minute',
                                              'missing_mark', 'missing_funding', 'missing_internal', 'missing_timer'):
                                def alter(value, mutation=mutation, pair=pair, side=side):
                                    for row in value['per_coin']:
                                        trace = row['seen']
                                        first = next(item for item in trace if item[0] == 'bar')
                                        if mutation in ('future_init', 'future_event'):
                                            first[3 if mutation == 'future_init' else 2] = verify_pair.ns(pair['source']['end']) + 1
                                        elif mutation == 'callback_regression':
                                            # Move a fully causal later minute record in front of an earlier record.
                                            index = next(i for i, item in enumerate(trace) if item[0] == 'bar')
                                            later = next(i for i, item in enumerate(trace) if item[0] == 'bar' and i > index)
                                            trace[index], trace[later] = trace[later], trace[index]
                                        elif mutation == 'missing_minute':
                                            trace.remove(first)
                                        elif mutation in ('missing_mark', 'missing_funding'):
                                            trace.remove(next(item for item in trace if item[0] == mutation.removeprefix('missing_')))
                                        elif mutation == 'missing_internal':
                                            row['seen'] = [item for item in trace if not (item[0] == 'bar' and '-15-MINUTE-' in item[1])]
                                        else:
                                            row['seen'] = [item for item in trace if not (item[0] == 'timer' and item[4].startswith('A-'))]
                                edit('reports/summary.json', alter)
                            elif mutation == 'requested_expiry':
                                data = verify_pair.rows(directory / 'reports', 'orders')
                                for row in data:
                                    if row['side'] == 'BUY':
                                        row['expire_time_ns'] = str(int(row['expire_time_ns']) + 1)
                                table(directory / 'reports/orders.csv', data)
                            elif mutation in ('expired_before_fill', 'expiry_early', 'expiry_late', 'stop_canceled', 'stop_shrunk', 'denied_event'):
                                events = verify_pair.order_events(directory / 'reports')
                                if mutation in ('expired_before_fill', 'expiry_early', 'expiry_late'):
                                    new_time = verify_pair.ns('2026-01-01T07:33:59.999Z') - 1 if mutation == 'expired_before_fill' else (
                                        verify_pair.ns('2026-01-01T08:43:59.999Z') + (-1 if mutation == 'expiry_early' else 1))
                                    for event in events:
                                        if event['type'] == 'OrderExpired':
                                            event['ts_event'] = event['ts_init'] = new_time
                                    edit('reports/summary.json', lambda v, new_time=new_time: [row.update(seen=[
                                        [*item[:2], new_time, new_time, new_time, item[5]]
                                        if item[0] == 'order' and item[1] == 'OrderExpired' else item for item in row['seen']])
                                        for row in v['per_coin']])
                                    # Preserve callback order so the GTD-specific check receives the counterexample.
                                    edit('reports/summary.json', lambda v: [row['seen'].sort(
                                        key=trace_clock) for row in v['per_coin']])
                                elif mutation == 'stop_shrunk':
                                    for event in events:
                                        if event['type'] == 'OrderUpdated' and event['client_order_id'].endswith('-stop'):
                                            event['quantity'] = '.125'
                                else:
                                    event = copy.deepcopy(next(e for e in events if e['type'] == 'OrderUpdated' and e['client_order_id'].endswith('-stop')))
                                    event['type'] = 'OrderDenied' if mutation == 'denied_event' else 'OrderCanceled'
                                    event['reason'] = 'synthetic unexpected refusal'
                                    at = events.index(next(e for e in events if e['client_order_id'] == event['client_order_id'] and e['type'] == 'OrderFilled'))
                                    events.insert(at, event)
                                with gzip.open(directory / 'reports/order_events.jsonl.gz', 'wt') as stream:
                                    stream.writelines(json.dumps(e) + '\n' for e in events)
                            elif mutation == 'wrong_trial':
                                edit('process.json', lambda v: v.update(trial_id=v['trial_id'] + 999))
                            elif mutation == 'wrong_source':
                                edit('start-receipt/execution.json', lambda v: v.update(source_sha256='0' * 64))
                            elif mutation in ('wrong_stage_image', 'wrong_stage_platform'):
                                def alter(value, mutation=mutation, pair=pair, side=side):
                                    cmd = value['commands']['audit']
                                    index = cmd.index(pair['sides'][side]['runtime']['image_ref']) if mutation == 'wrong_stage_image' else cmd.index('--platform') + 1
                                    cmd[index] = 'ghcr.io/qoeop/trade-runtime@sha256:' + 'f' * 64 if mutation == 'wrong_stage_image' else 'linux/arm64'
                                edit('process.json', alter)
                            elif mutation == 'empty_inspection_paths':
                                edit('runtime-inspection.json', lambda v: v.update(source_file_paths={}, source_files_sha256={}))
                            generator.write_json(directory / 'fingerprint/fingerprint.json', report_fingerprint(directory / 'reports'))
                    generator.write_json(target / 'suite.json', manifest)
                    result = verify_pair.verify_suite(target)
                    errors = [item.get('error', '') for item in result['pairs'] if not item['passed']]
                    self.assertFalse(result['passed'], mutation)
                    self.assertTrue(errors and all(expected in error for error in errors), (mutation, errors))
                    observations['counterexamples'][mutation] = {'passed': result['passed'], 'rejected_pairs': len(errors),
                                                                'expected_error': expected, 'errors': errors}
                    if mutation == 'denied_event':
                        failed = [item for item in result['pairs'] if not item['passed']]
                        self.assertTrue(all(item['order_refusals']['reference']['refusal_events'] for item in failed))
            if os.environ.get('PAIRING_OFFLINE_REPORT'):
                generator.write_json(Path(os.environ['PAIRING_OFFLINE_REPORT']) / 'offline-counterexamples.json', observations)


if __name__ == "__main__":
    unittest.main()
