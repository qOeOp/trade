"""Current views agree without mutating original audit verdicts or imposing economics gates."""
import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from research.records import availability, db, records, ledger, execution, prechecks, hypotheses, trials
from research.records.analysis import load_dir
from research.records.common import RecordError
from tests.records.dolt import BINARY, SKIP, TemporaryLedger
from tests.records.fixtures import reports
from tests.records.test_artifacts import IDENTITY, probe
from tests.records.test_hypotheses import DESIGN
from tests.records.test_ledger import SOURCE, goal


class NativeCompletenessTests(unittest.TestCase):
    def test_zero_fills_vs_real_zero_cost_losing_activity(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            reports.write(root/'zero', plans=0, trade_days=4)
            self.assertTrue(availability.native_reasons(load_dir(root/'zero')))
            reports.write(root/'filled', plans=1, wins=0)
            native=load_dir(root/'filled')
            self.assertEqual(availability.native_reasons(native), [])
            native.orders=[]
            self.assertTrue(availability.native_reasons(native))


@unittest.skipUnless(BINARY, SKIP)
class CurrentViewsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixture=TemporaryLedger('availability-test'); cls.profile=cls.fixture.profile; cls.count=0
    @classmethod
    def tearDownClass(cls): cls.fixture.close()
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup); self.root=Path(self.temp.name)
        type(self).count+=1
        self.window=reports.write(self.root/'native', plans=0, trade_days=4)
        ledger.open_round(self.profile, goal('AV'+str(self.count), self.window))
        self.addCleanup(ledger.close_round,self.profile)
        self.source=records.publish_strategy(self.profile, source=SOURCE+str(self.count).encode(), strategy_id='root',entry_class='Fixture',description='engineering',parent=None,difference=None,op=None)
        self.inspection=probe(self.window)
        self.inputs={'market_commit':'c'*32}
        (self.root/'note.md').write_text('synthetic engineering mechanism conjecture')
        records.add_evidence(self.profile,'note',[self.root/'note.md'],None)
        self.plan={'parent':None,'control_run':None,'change':'root','rationale':'synthetic','prediction':'diagnostic only','sources':['note'],'metric':'annual_return','grid':[{'strategy':'root@1','parameters':'fixed'}],'conditions':'engineering','comparison':DESIGN}
        self.binding={'runtime':IDENTITY,'effective_config':self.inspection['effective_config'],'input_identity':self.inputs}
    def precheck(self, *, failed=False, phase='source-precheck'):
        sha=self.source['source_sha256']
        context={'source_sha256':sha,'image_ref':IDENTITY['image_ref'],'phase':phase,'runtime_contract':'r1-native-v7','workdir':str(self.root),'effective_config':self.inspection['effective_config']}
        trial=records.report_trial(self.profile,mode='explore',source_sha256=sha,image_ref=IDENTITY['image_ref'],coins=['AAAUSDT','BBBUSDT'],start=self.window['start'],trade_start=self.window['trade_start'],end=self.window['end'],op=db.op_id('engineering',context),execution_start=context)['trial_id']
        (self.root/'reports').mkdir(exist_ok=True)
        for name in ('native.stdout.txt','native.stderr.txt','audit.stdout.txt','audit.stderr.txt'): (self.root/name).write_bytes(b'')
        execution.capture(self.profile,trial_id=trial,workdir=self.root,phases={'native':{'exit_code':1 if failed else 0},'audit':{'exit_code':0}},outcome='completed',precheck=True)
        return trial
    def review(self,trial):
        prechecks.review(self.profile,bundle='check',body={'trial_id':trial,**{k:{'status':'no_opportunity' if k=='activity' else 'passed','note':'Agent engineering source inspection; no opportunity is not proof of all reachable paths'} for k in ('api','causal','activity','readiness')}})
        self.plan['prechecks']={'root@1':'check'}
    def register(self):
        fake={'identity':self.inputs,'root':self.root,'pool_file':self.root/'unused','symbols':['AAA','BBB']}
        with patch('research.records.artifacts.market_inputs',return_value=fake), patch('research.records.artifacts._cleanup'),patch('research.records.runtime.resolve',return_value=IDENTITY),patch('research.records.runtime.inspect_runtime',return_value=self.inspection):
            return hypotheses.register(self.profile,bundle='H0',body=self.plan,runtime=None,market={},at='c'*32,runner_argv=['--symbols','AAA','BBB','--start',self.window['start'],'--end',self.window['end']])
    def test_precheck_required_failed_native_and_arbitrary_exploration_not_exempt(self):
        with self.assertRaises(RecordError) as caught:self.register()
        self.assertEqual(caught.exception.code,'SOURCE_PRECHECK_REQUIRED')
        trial=self.precheck(failed=True); self.review(trial)
        with self.assertRaises(RecordError) as caught:self.register()
        self.assertEqual(caught.exception.code,'SOURCE_PRECHECK_FAILED')
    def test_zero_activity_all_views_and_consumption_keep_original_verdict(self):
        trial=self.precheck(); self.review(trial); self.register()
        attempt=records.report_trial(self.profile,mode='sealed',source_sha256=self.source['source_sha256'],image_ref=IDENTITY['image_ref'],coins=['AAAUSDT','BBBUSDT'],start=self.window['start'],trade_start=self.window['trade_start'],end=self.window['end'],op='research',registration={'bundle':'H0','execution':self.binding})['trial_id']
        stored=trials.hand_off_run(self.profile,trial_id=attempt,reports=load_dir(self.root/'native'),problems=[],inspection=self.inspection,image_revision='a'*40,effective_config=self.inspection['effective_config'],input_identity=self.inputs)
        output=records.run_report(self.profile,stored['run_id'])
        self.assertEqual(output['status'],'passed');self.assertIsNone(output['annual_return'])
        self.assertFalse(hypotheses.candidates(self.profile)['candidates'][0]['valid_evidence'])
        status=records.round_status(self.profile)
        self.assertEqual((status['audit_passed_research_runs'],status['valid_research_runs'],status['diagnostic_only_research_runs']),(1,0,1))
        with db.reading(self.profile) as conn:
            with self.assertRaises(RecordError) as caught: availability.require(conn,records._run_with_trial(conn,stored['run_id']))
            self.assertEqual(caught.exception.code,'ECONOMIC_EVIDENCE_UNAVAILABLE')
            logs=execution.read(conn,trial)
            self.assertEqual(logs['files']['native.stderr.txt']['state'],'captured-empty')
            self.assertEqual(execution.read(conn,attempt)['status'],'missing')
        with self.assertRaises(RecordError): records.add_evidence(self.profile,f'trial-{trial}-execution',[self.root/'note.md'],None)
