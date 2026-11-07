"""Production System.observe regression with finite, in-memory Docker responses.

The owning Agent getter is loaded from the frozen reviewed bundle. Only command
boundaries are fake; System.observe, agent(), and Upgrade.protected run unchanged.
"""
import copy
import json
from pathlib import Path
import unittest
from unittest.mock import patch

import test_upgrade as fixtures
import upgrade as u

HERE = Path(__file__).resolve().parent


class AgentObservationTests(unittest.TestCase):
    setUpFixture = fixtures.UpgradeTests.setUp
    swap = fixtures.UpgradeTests.swap
    cold = fixtures.UpgradeTests.cold

    def setUp(self):
        self.setUpFixture()
        self.state_patch = patch.object(u, 'STATE', self.state)
        self.state_patch.start()
        self.addCleanup(self.state_patch.stop)
        self.web_revision, self.agent_revision = 'a' * 40, 'b' * 40
        self.web, self.control = ('trade-release-web-' + self.web_revision,
                                  'trade-release-live-' + self.web_revision)
        self.agent_name = 'trade-release-agent-' + self.agent_revision
        self.service = 'ghcr.io/qoeop/trade-service@sha256:' + 'c' * 64
        self.baseline.update(service_image=self.service, routers={'trade-ide-ide-router-1': 'ide'})
        self.rows = {key * 64: self.row(key * 64, name, revision) for key, name, revision in (
            ('1', self.web, self.web_revision), ('2', self.control, self.web_revision),
            ('3', self.agent_name, self.agent_revision))}
        snapshot = self.state / 'live' / self.web_revision / 'configuration.json'
        self.rows['2' * 64]['mounts'] = [
            {'source': str(path), 'destination': str(path), 'rw': writable}
            for path, writable in ((self.root, True), (self.state, False), (snapshot.parent / 'socket', True))]
        self.route = [{'dial': self.web + ':8765'}]
        route_file = self.state / 'router/active.json'
        route_file.parent.mkdir()
        u.new_file(route_file, json.dumps({'apps': {'http': {'servers': {'ide': {'routes': [
            {'handle': [{'upstreams': self.route}]}]}}}}}).encode())
        owner_code = u.bundle(HERE / 'bundle.json')[1]['release_host.py']
        self.adapter = u.System(self.baseline, self.work / 'never-used-docker-config', owner_code)
        self.commands, self.docker_calls = [], []
        self.adapter.command, self.adapter.docker = self.command, self.docker
        self.no_real_process = patch.object(u.subprocess, 'run', side_effect=AssertionError('real external process forbidden'))
        self.no_real_process.start()
        self.addCleanup(self.no_real_process.stop)

    def row(self, identifier, name, revision):
        return {'id': identifier, 'name': '/' + name, 'image_id': 'sha256:' + 'd' * 64,
                'image': self.service, 'running': True, 'status': 'running', 'started': 'fixed-start',
                'restarts': 0, 'revision': revision, 'source': u.SOURCE, 'run': None, 'role': None, 'mounts': []}

    def command(self, argv, timeout=30):
        self.commands.append((argv, timeout))
        self.assertEqual(argv, ['/usr/bin/git', '-c', 'credential.helper=', 'ls-remote',
                                'https://github.com/qOeOp/trade.git', 'refs/heads/main', 'refs/heads/deploy-ready'])
        return self.web_revision + '\trefs/heads/main\n' + self.web_revision + '\trefs/heads/deploy-ready'

    def docker(self, *args, **kwargs):
        self.docker_calls.append(args)
        if args == ('ps', '-aq', '--no-trunc'):
            return '\n'.join(self.rows)
        if args[:3] == ('inspect', '--format', u.CONTAINERS):
            self.assertEqual(len(args), 4)
            return json.dumps(self.rows[args[-1]])
        if args[:3] == ('image', 'inspect', '--format'):
            self.assertEqual(args[3], u.IMAGE)
            self.assertIn(args[-1], (self.service, u.OBSERVER_IMAGE))
            return json.dumps({'id': 'sha256:' + 'e' * 64, 'architecture': 'amd64', 'os': 'linux',
                               'digests': [args[-1]], 'source': u.SOURCE,
                               'revision': u.OBSERVER_REVISION if args[-1] == u.OBSERVER_IMAGE else self.web_revision})
        if args == ('exec', 'trade-ide-ide-router-1', 'wget', '-qO-',
                    'http://127.0.0.1:2019/config/apps/http/servers/ide/routes/0/handle/0/upstreams/'):
            return json.dumps(self.route)
        if len(args) == 4 and args[:2] == ('inspect', '--format'):
            # As in production, only a fixed equality boolean is returned; no Cmd/Env contents.
            snapshot = self.state / 'live' / self.web_revision / 'configuration.json'
            expected = ['python', '-m', 'cli.main', 'live', 'serve', '--configuration', str(snapshot),
                        '--release-state', str(self.state), '--release-web', self.web]
            template = '{{eq (json .Config.Cmd) ' + json.dumps(json.dumps(expected, separators=(',', ':'))) + '}}'
            self.assertEqual(args[2], template)
            self.assertEqual(args[3], '2' * 64)
            return 'true'
        self.fail('unreviewed fake Docker operation: ' + repr(args))

    def test_web_control_a_and_independent_agent_b_are_observed(self):
        observation = self.adapter.observe()
        actual = observation['containers']['3' * 64]
        self.assertEqual(actual['name'], '/' + self.agent_name)
        self.assertEqual(actual['revision'], self.agent_revision)
        self.assertNotEqual(actual['revision'], self.web_revision)
        self.assertEqual(self.adapter.agent(observation['containers']), self.agent_name)
        self.assertEqual(observation['containers']['2' * 64]['revision'], self.web_revision)
        self.assertEqual(len(self.commands), 1)
        self.assertTrue(self.docker_calls)

    def test_multiple_running_standalone_agents_are_refused(self):
        self.rows['4' * 64] = self.row('4' * 64, 'trade-release-agent-' + 'c' * 40, 'c' * 40)
        with self.assertRaisesRegex(RuntimeError, 'multiple Agent writers'):
            self.adapter.observe()

    def test_missing_standalone_agent_is_refused(self):
        del self.rows['3' * 64]
        with self.assertRaisesRegex(RuntimeError, 'standalone Agent is missing'):
            self.adapter.observe()

    def test_embedded_and_standalone_agents_are_refused(self):
        self.rows['4' * 64] = self.row('4' * 64, 'trade-ide-ide-1', self.web_revision)
        with self.assertRaisesRegex(RuntimeError, 'multiple Agent writers'):
            self.adapter.observe()

    def test_agent_name_revision_mismatch_is_refused_by_original_getter(self):
        self.rows['3' * 64]['revision'] = 'c' * 40
        with self.assertRaisesRegex(RuntimeError, 'container identity mismatch'):
            self.adapter.observe()

    def test_stopped_only_agent_is_refused(self):
        self.rows['3' * 64].update(running=False, status='exited')
        with self.assertRaisesRegex(RuntimeError, 'standalone Agent is missing'):
            self.adapter.observe()

    def test_agent_source_mismatch_is_refused(self):
        self.rows['3' * 64]['source'] = 'https://example.invalid/not-reviewed'
        with self.assertRaisesRegex(RuntimeError, 'standalone Agent provenance differs'):
            self.adapter.observe()

    def protect_then_change(self, change):
        self.baseline['observations'] = self.adapter.observe()
        original = copy.deepcopy(self.baseline['observations'])
        # Actual production observer feeds protected(); fake units and helpers are retained.
        self.system.observe = self.adapter.observe
        change()
        # The changed object remains individually valid; baseline identity is the failing fact.
        self.assertNotEqual(self.adapter.observe(), original)
        with self.assertRaisesRegex(RuntimeError, 'routes, pair, candidates or protected objects changed'):
            self.runner.run()
        self.assertEqual(self.baseline['observations'], original)
        self.assertEqual(self.calls, [])
        self.assertNotIn('canonical', self.system.events)
        self.assertNotIn('foreign', self.system.events)
        self.assertEqual(self.system.actions, [('timer', 'stop')])

    def test_actual_agent_id_change_is_refused_by_protected_baseline(self):
        def change():
            row = self.rows.pop('3' * 64)
            row['id'] = '4' * 64
            self.rows['4' * 64] = row
        self.protect_then_change(change)

    def test_valid_actual_agent_revision_change_is_refused_by_protected_baseline(self):
        def change():
            self.rows['3' * 64].update(name='/trade-release-agent-' + 'c' * 40, revision='c' * 40)
        self.protect_then_change(change)


if __name__ == '__main__':
    unittest.main()
