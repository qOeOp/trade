"""Continuous candidate custody on an isolated ledger; economics cannot gate lineage."""
import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import numpy as np

from research.records import db, records, ledger, hypotheses, trials, comparison
from research.records.analysis import load_dir, _rows
from research.records.audit import audit
from research.records.common import RecordError
from tests.records.dolt import BINARY, SKIP, TemporaryLedger
from tests.records.fixtures import reports
from tests.records.test_artifacts import IDENTITY, probe
from tests.records.test_ledger import goal, SOURCE

DESIGN = {'method': comparison.METHOD, 'block_days': 7, 'resamples': 999, 'inner_resamples': 99,
          'seed': 42, 'alpha': .015, 'minimum_effect': .005, 'design_reason': 'synthetic engineering conditions, no adoption'}


class PairedEvidenceTests(unittest.TestCase):
    def test_effect_and_non_significance_do_not_form_a_verdict(self):
        noise = np.random.default_rng(77).normal(0, .003, 84)
        result = comparison.paired(np.zeros(84), noise + .00015, DESIGN, 1)
        self.assertGreater(result['p_one_sided'], .015)
        self.assertIsNotNone(result['mean_log_studentized_interval'])
        self.assertNotIn('result', result)
        self.assertNotIn('adopted', result)
        self.assertEqual(result, comparison.paired(np.zeros(84), noise + .00015, DESIGN, 1))

    def test_paired_grid_correction_and_degenerate_uncertainty(self):
        a = np.zeros(28)
        same = comparison.paired(a, a, DESIGN, 5)
        self.assertIsNone(same['p_one_sided'])
        self.assertIsNone(same['mean_log_studentized_interval'])
        diff = np.random.default_rng(5).normal(.001, .004, 28)
        one = comparison.paired(a, diff, DESIGN, 1)
        five = comparison.paired(a, diff, DESIGN, 5)
        self.assertEqual(five['p_bonferroni'], min(1, one['p_one_sided'] * 5))
        self.assertLess(five['interval_coverage_grid_adjusted'], 1)
        for series in (np.ones(28) * float('nan'), np.ones(28) * -1):
            with self.assertRaises(RecordError):
                comparison.paired(a, series, DESIGN, 1)

    def test_large_native_row_is_parsed_without_truncation(self):
        content = b'events\n"' + b'x' * 200000 + b'"\n'
        self.assertEqual(len(_rows(content)[0]['events']), 200000)


@unittest.skipUnless(BINARY, SKIP)
class RegistrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixture = TemporaryLedger('candidate-test')
        cls.profile = cls.fixture.profile
        cls.count = 0

    @classmethod
    def tearDownClass(cls):
        cls.fixture.close()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        type(self).count += 1
        self.window = reports.write(self.root / 'native', plans=1, wins=0)
        ledger.open_round(self.profile, goal('C' + str(self.count), self.window))
        self.addCleanup(ledger.close_round, self.profile)
        self.inspection = probe(self.window)
        self.input_identity = {'market_database': 'market', 'market_commit': 'c' * 32,
                               'export_content_sha256': 'd' * 64, 'exporter_source_sha256': 'e' * 64}
        self.execution = {'runtime': IDENTITY, 'effective_config': self.inspection['effective_config'],
                          'input_identity': self.input_identity}
        source = self.root / 'source.md'; source.write_text('synthetic mechanism conjecture')
        records.add_evidence(self.profile, 'source', [source], None)
        self.publish('root')
        self.plan = {'parent': None, 'control_run': None, 'change': 'root template', 'rationale': 'synthetic',
                     'prediction': 'facts/repair decide different actions', 'sources': ['source'], 'metric': 'annual_return',
                     'grid': [{'strategy': 'root@1', 'parameters': 'fixed'}], 'conditions': 'engineering', 'comparison': DESIGN}

    def publish(self, name, parent=None, difference=None):
        return records.publish_strategy(self.profile, source=SOURCE + ('# ' + name).encode(), strategy_id=name,
                    entry_class='Fixture', description='engineering source', parent=parent, difference=difference, op=None)

    def register(self, name, body=None):
        # Actual production registration/write protocol; only the external image/input probe is stubbed.
        fake = {'identity': self.input_identity, 'root': self.root, 'pool_file': self.root / 'unused', 'symbols': ['AAA', 'BBB']}
        with patch('research.records.artifacts.market_inputs', return_value=fake), \
             patch('research.records.artifacts._cleanup'), \
             patch('research.records.runtime.resolve', return_value=IDENTITY), \
             patch('research.records.runtime.inspect_runtime', return_value=self.inspection):
            return hypotheses.register(self.profile, bundle=name, body=body or self.plan, runtime=None, market={}, at='c'*32,
                                       runner_argv=['--symbols', 'AAA', 'BBB', '--start', self.window['start'], '--end', self.window['end']])

    def attempt(self, bundle, source, *, invalid=False, execution=None, store=True):
        binding = {'bundle': bundle, 'execution': execution or self.execution}
        written = records.report_trial(self.profile, mode='sealed', source_sha256=source, image_ref=IDENTITY['image_ref'],
                    coins=['AAAUSDT', 'BBBUSDT'], start=self.window['start'], trade_start=self.window['trade_start'],
                    end=self.window['end'], op=db.op_id('trial-fixture', {'bundle': bundle, 'source': source, 'execution': binding}),
                    registration=binding)
        if not store:
            return written
        return trials.hand_off_run(self.profile, trial_id=written['trial_id'], reports=load_dir(self.root / 'native'),
                    problems=['intentional invalid fixture'] if invalid else [], inspection=self.inspection,
                    image_revision='a'*40, effective_config=self.inspection['effective_config'], input_identity=self.input_identity)

    def test_valid_losing_candidate_can_derive_and_control_is_separate(self):
        sha = hashlib.sha256(SOURCE + b'# root').hexdigest()
        self.register('H0')
        root_run = self.attempt('H0', sha)['run_id']
        with db.reading(self.profile) as conn:
            native = records._run_with_trial(conn, root_run)
            self.assertFalse(all(x['passed'] for x in records.gates(records.read_goal(conn), native, development=True).values()))
        child = self.publish('child', 'root@1', 'new exit rule')
        body = dict(self.plan, parent='root@1', control_run=root_run, change='new exit rule',
                    grid=[{'strategy': 'child@1', 'parameters': 'exit setting'}])
        self.register('H1', body)
        self.attempt('H1', child['source_sha256'])
        grand = self.publish('grand', 'child@1', 'change entry')
        body = dict(body, parent='child@1', change='change entry', grid=[{'strategy':'grand@1', 'parameters':'entry setting'}])
        self.register('H2', body)  # control stays root, research parent is child
        self.attempt('H2', grand['source_sha256'])
        status = records.round_status(self.profile)
        self.assertEqual((status['research_attempts'], status['valid_research_runs']), (3, 3))
        self.assertNotIn('progress_check_due', status)
        forest = hypotheses.candidates(self.profile)
        self.assertTrue(all(c['valid_evidence'] for c in forest['candidates']))
        self.assertTrue(audit(self.profile, None)['ok'])

    def test_registration_order_identity_and_consumption(self):
        sha = hashlib.sha256(SOURCE + b'# root').hexdigest()
        with self.assertRaises(RecordError) as caught:
            self.attempt('missing', sha)
        self.assertEqual(caught.exception.code, 'REGISTRATION_REQUIRED')
        with db.reading(self.profile) as conn:
            self.assertEqual(db.rows(conn, 'SELECT COUNT(*) FROM trial'), [(0,)])
        first = self.register('H0')
        self.assertTrue(self.register('H0')['replayed'])
        changed = copy.deepcopy(self.execution); changed['runtime']['image_ref'] = IDENTITY['image_ref'].replace('b', 'a')
        with self.assertRaises(RecordError) as caught:
            self.attempt('H0', sha, execution=changed)
        self.assertEqual(caught.exception.code, 'EXECUTION_MISMATCH')
        self.attempt('H0', sha, invalid=True)
        with self.assertRaises(RecordError) as caught:
            # Different operation ID cannot replay a consumed registration cell.
            records.report_trial(self.profile, mode='sealed', source_sha256=sha, image_ref=IDENTITY['image_ref'],
                    coins=['AAA'], start=self.window['start'], trade_start=self.window['trade_start'], end=self.window['end'],
                    op='different-trial', registration={'bundle': 'H0', 'execution': self.execution})
        self.assertEqual(caught.exception.code, 'GRID_ALREADY_ATTEMPTED')
        child = self.publish('child', 'root@1', 'fix')
        with self.assertRaises(RecordError) as caught:
            self.register('H1', dict(self.plan, parent='root@1', control_run=1, change='fix',
                                    grid=[{'strategy':'child@1', 'parameters':'fixed'}]))
        self.assertEqual(caught.exception.code, 'PARENT_NOT_VALID')
        self.register('repair', dict(self.plan, retry_of='H0', conditions='repeat invalid attempt, not independent'))
        self.assertEqual(first['files'].keys(), {'research-plan.json'})

    def test_unfinished_and_invalid_are_counted_separately(self):
        self.register('H0')
        sha = hashlib.sha256(SOURCE + b'# root').hexdigest()
        self.attempt('H0', sha, store=False)
        status = records.round_status(self.profile)
        self.assertEqual((status['research_attempts'], status['unfinished_research_attempts'], status['valid_research_runs']), (1,1,0))
        self.assertFalse(hypotheses.candidates(self.profile)['candidates'][0]['valid_evidence'])
