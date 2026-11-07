"""Offline boundaries only. No Docker, sudo, CI, venue or fixed host path is used."""
import json
import os
import shutil
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import probe as p

IDENTITY = 'c' * 64


class Process:
    def __init__(self, argv, *, result=0, timeout=False, **kwargs):
        self.argv, self.result, self.returncode, self.timeout, self.killed = argv, result, None, timeout, False
        Path(argv[argv.index('--cidfile') + 1]).write_text(IDENTITY)
    def poll(self):
        return self.returncode
    def communicate(self, timeout):
        if self.timeout and not self.killed:
            raise subprocess.TimeoutExpired(self.argv, timeout, output=b'partial-out', stderr=b'partial-error')
        self.returncode = -9 if self.killed else self.result
        return '{"state":"idle"}\n', 'synthetic-diagnostic\n'
    def kill(self):
        self.killed = True
        self.returncode = -9


class ProbeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.u, cls.modules = p.load_installer()

    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='probe-offline-')
        self.addCleanup(temporary.cleanup)
        self.work = Path(temporary.name)
        self.config = self.work / 'empty-config'
        self.config.mkdir(mode=0o700)
        self.out = self.work / 'artifacts'
        self.out.mkdir()
        self.driver = p.Driver(self.out, self.config, 'unique-offline-lane')

    def helpers(self):
        u = self.u
        baseline = {'root': str(u.CANONICAL), 'web': 'trade-release-web-' + p.REVISION,
                    'service_image': p.IMAGE, 'socket_gid': 123, 'identities': {str(u.CANONICAL): {'uid': 1001, 'gid': 1001}},
                    'known_foreign': [str(u.KNOWN_FOREIGN[0])],
                    'foreign': {str(u.KNOWN_FOREIGN[0]): {'root': {'uid': 1001, 'gid': 1001}}}}
        system = u.System(baseline, self.config, self.modules['release_host.py'])
        return [system.inspector_command(u.CANONICAL, u.STATE / 'live' / p.REVISION / 'configuration.json'),
                system.foreign_command(u.KNOWN_FOREIGN[0])]

    def test_default_verifies_frozen_inputs_without_any_external_operation(self):
        with patch.object(sys, 'argv', ['probe.py']), patch('sys.stdout'), \
                patch.object(p, 'environment', side_effect=AssertionError('environment touched')), \
                patch.object(p, 'execute', side_effect=AssertionError('execution attempted')), \
                patch.object(p.subprocess, 'run', side_effect=AssertionError('subprocess attempted')), \
                patch.object(p.subprocess, 'Popen', side_effect=AssertionError('process attempted')):
            p.main()

    def test_changed_frozen_source_is_refused_before_import(self):
        copy = self.work / 'frozen'
        copy.mkdir()
        for name in p.SCRIPT_HASHES:
            shutil.copyfile(p.INSTALLER / name, copy / name)
        with (copy / 'upgrade.py').open('ab') as stream:
            stream.write(b'\n')
        with patch.object(p, 'INSTALLER', copy), patch.object(p.importlib.util, 'spec_from_file_location',
                side_effect=AssertionError('changed code imported')):
            with self.assertRaisesRegex(RuntimeError, 'frozen installer source changed'):
                p.load_installer()

    def test_template_container_is_created_without_start(self):
        with patch.object(self.driver, 'docker', return_value=IDENTITY) as docker:
            name, identity = self.driver.create_dummy(['--network', 'none', p.IMAGE, 'python', '-m', 'cli.main'])
        self.assertEqual(identity, IDENTITY)
        self.assertEqual(docker.call_count, 1)
        self.assertEqual(docker.call_args.args[0], 'create')
        self.assertNotIn('start', docker.call_args.args)
        self.assertEqual(self.driver.created[name]['id'], IDENTITY)

    def test_original_helpers_keep_every_business_argument(self):
        for original, purpose in zip(self.helpers(), ('canonical', 'historical'), strict=True):
            with patch.object(p.subprocess, 'Popen', side_effect=Process) as opened:
                self.assertEqual(self.driver.run(original, purpose), '{"state":"idle"}')
            actual = opened.call_args.args[0]
            self.assertEqual(actual[:6], ['/usr/bin/docker', '--config', str(self.config), '--host',
                                          'unix:///var/run/docker.sock', 'run'])
            self.assertEqual(actual[12:], original[1:])
            self.assertEqual(actual[6:12], ['--name', 'unique-offline-lane-' + purpose, '--label',
                                           p.LABEL + '=unique-offline-lane', '--cidfile', str(self.out / (purpose + '.cid'))])
            self.assertEqual(opened.call_args.kwargs['env'], {'PATH': p.os.defpath, 'LC_ALL': 'C'})
            self.assertEqual(self.driver.created['unique-offline-lane-' + purpose]['id'], IDENTITY)
            self.assertIn('--read-only', actual)
            self.assertEqual(actual[actual.index('--network') + 1], 'none')
            self.assertEqual(actual[actual.index('--memory') + 1], '256m')

    def test_timeout_retains_raw_output_and_only_kills_own_client(self):
        processes = []
        def start(argv, **kwargs):
            process = Process(argv, timeout=True, **kwargs)
            processes.append(process)
            return process
        with patch.object(p.subprocess, 'Popen', side_effect=start):
            with self.assertRaisesRegex(RuntimeError, 'helper timeout'):
                self.driver.run(self.helpers()[0], 'canonical')
        self.assertTrue(processes[0].killed)
        row = self.driver.records[-1]
        self.assertTrue(row['timed_out'])
        self.assertEqual(row['stdout'], '{"state":"idle"}\n')
        self.assertEqual(row['stderr'], 'synthetic-diagnostic\n')
        self.assertEqual(row['exit_code'], -9)
        self.assertEqual(self.driver.created['unique-offline-lane-canonical']['id'], IDENTITY)

    def test_helper_nonzero_and_spawn_failure_preserve_stage_evidence(self):
        with patch.object(p.subprocess, 'Popen', side_effect=lambda argv, **kw: Process(argv, result=42, **kw)):
            with self.assertRaisesRegex(RuntimeError, 'helper failed'):
                self.driver.run(self.helpers()[0], 'canonical')
        self.assertEqual(self.driver.records[-1]['exit_code'], 42)
        self.assertEqual(self.driver.records[-1]['stderr'], 'synthetic-diagnostic\n')
        with patch.object(p.subprocess, 'Popen', side_effect=OSError('synthetic spawn failure')):
            with self.assertRaisesRegex(OSError, 'spawn failure'):
                self.driver.run(self.helpers()[1], 'historical')
        self.assertEqual(self.driver.records[-1]['purpose'], 'historical')
        self.assertEqual(self.driver.records[-1]['error']['type'], 'OSError')

    def test_command_timeout_keeps_original_partial_output(self):
        error = subprocess.TimeoutExpired(['fake'], 1, output=b'raw stdout', stderr=b'raw stderr')
        with patch.object(p.subprocess, 'run', side_effect=error):
            with self.assertRaisesRegex(RuntimeError, 'command timeout'):
                self.driver.command(['fake'], timeout=1)
        self.assertEqual(self.driver.records[-1]['stdout'], 'raw stdout')
        self.assertEqual(self.driver.records[-1]['stderr'], 'raw stderr')
        self.assertTrue((self.out / 'commands.json').exists())

    def test_cleanup_requires_captured_full_id_matching_name_and_label(self):
        name, _ = self.driver.own_options('canonical')
        self.driver.created[name]['id'] = IDENTITY
        for changed in ('id', 'name', 'lane'):
            with self.subTest(changed=changed):
                row = {'id': IDENTITY, 'name': '/' + name, 'lane': self.driver.lane}
                row[changed] = 'unowned'
                with patch.object(self.driver, 'docker', side_effect=[IDENTITY, json.dumps(row)]) as docker:
                    errors = self.driver.cleanup()
                self.assertEqual(len(errors), 1)
                self.assertFalse(any(call.args[0] == 'rm' for call in docker.call_args_list))
        with patch.object(self.driver, 'docker', side_effect=[IDENTITY, json.dumps(
                {'id': IDENTITY, 'name': '/' + name, 'lane': self.driver.lane}), IDENTITY]) as docker:
            self.assertEqual(self.driver.cleanup(), [])
        self.assertEqual(docker.call_args_list[-1].args, ('rm', '-f', '-v', IDENTITY))
        self.assertTrue(self.driver.created[name]['removed'])

    def test_absent_container_is_clean_and_uncaptured_id_is_never_inferred(self):
        name, _ = self.driver.own_options('canonical')
        with patch.object(self.driver, 'docker', side_effect=AssertionError('must not discover by guessed name')):
            self.assertEqual(len(self.driver.cleanup()), 1)
        self.driver.created[name]['id'] = IDENTITY
        with patch.object(self.driver, 'docker', return_value='') as docker:
            self.assertEqual(self.driver.cleanup(), [])
        self.assertEqual(docker.call_count, 1)

    def test_four_resource_limit_and_no_duplicate_attempt(self):
        for name in ('initialize', 'template', 'canonical', 'historical'):
            self.driver.own_options(name)
        with self.assertRaises(RuntimeError):
            self.driver.own_options('canonical')
        self.assertEqual(self.driver.count, 4)

    def test_templates_come_from_original_frozen_assignments(self):
        snapshot = self.u.STATE / 'live' / p.REVISION / 'configuration.json'
        web = 'trade-release-web-' + p.REVISION
        command, yes = p.control_command(self.u, snapshot, web)
        other, no = p.control_command(self.u, snapshot, 'trade-release-web-' + 'f' * 40)
        self.assertEqual(command[:-1], other[:-1])
        self.assertEqual(command[-1], web)
        self.assertIn('{{eq (json .Config.Cmd)', yes)
        self.assertNotEqual(yes, no)
        self.assertNotIn('.Config.Env', self.u.CONTAINERS + self.u.IMAGE + yes)
        compile(p.INITIALIZE, '<offline-syntax-check>', 'exec')

    def test_existing_fixture_stops_before_docker_and_preserves_it(self):
        prior = self.work / 'existing-parent'
        prior.mkdir()
        sentinel = prior / 'sentinel'
        sentinel.write_bytes(b'untouched')
        u = SimpleNamespace(CANONICAL=prior / 'canonical', STATE=self.work / 'state')
        out = self.work / 'rejected-result'
        with patch.object(p, 'environment', return_value=(1001, 1001, 123)), \
                patch.object(p.Driver, 'docker', side_effect=AssertionError('Docker should not be called')):
            with self.assertRaisesRegex(RuntimeError, 'probe failed'):
                p.execute(u, {}, out)
        self.assertEqual(sentinel.read_bytes(), b'untouched')
        self.assertIn('already exists', json.loads((out / 'result.json').read_text())['failure']['message'])

    def test_replaced_fixture_or_unknown_container_never_triggers_tree_removal(self):
        own = self.work / 'own'
        own.mkdir()
        before = p.local_identity(own)
        original = self.work / 'retained-original'
        own.rename(original)
        own.mkdir()
        (own / 'other-owner').write_bytes(b'untouched')
        def command(argv):
            Path(argv[-1]).rmdir()
        errors = p.cleanup_directories({str(own): before}, containers_removed=True, command=command)
        self.assertEqual(len(errors), 1)
        self.assertTrue((own / 'other-owner').exists())
        self.assertTrue(original.exists())
        errors = p.cleanup_directories({str(original): before}, containers_removed=False, command=command)
        self.assertEqual(len(errors), 1)
        self.assertTrue(original.exists())
        self.assertEqual(p.cleanup_directories({str(original): before}, containers_removed=True, command=command), [])
        self.assertFalse(original.exists())

    @unittest.skipIf(os.geteuid() == 0, 'requires an ordinary user to exercise parent permission denial')
    def test_owned_contents_with_nonwritable_parent_use_only_empty_directory_privilege(self):
        parent = self.work / 'nonwritable-system-parent'
        parent.mkdir()
        own = parent / 'owned-fixture'
        own.mkdir()
        original = p.local_identity(own)
        (own / 'old-file').write_bytes(b'fixture')
        parent.chmod(0o555)
        calls = []
        try:
            # The old whole-tree removal really fails on the final rmdir.
            with self.assertRaises(PermissionError):
                p.shutil.rmtree(own)
            self.assertTrue(own.is_dir())
            nested = own / 'new-subtree'
            nested.mkdir()
            (nested / 'file').write_bytes(b'own fixture only')
            def privileged_empty_remove(argv):
                self.assertEqual(argv, ['/usr/bin/sudo', '-n', '/usr/bin/rmdir', '--', str(own)])
                self.assertEqual(p.local_identity(own), original)
                self.assertEqual(list(own.iterdir()), [])
                self.assertEqual(parent.stat().st_mode & 0o777, 0o555)
                calls.append(argv)
                # Simulate only the final privilege; never run sudo in an offline test.
                parent.chmod(0o755)
                own.rmdir()
                parent.chmod(0o555)
            self.assertEqual(p.cleanup_directories({str(own): original}, containers_removed=True,
                                                  command=privileged_empty_remove), [])
            self.assertEqual(len(calls), 1)
            self.assertFalse(own.exists())
        finally:
            parent.chmod(0o755)

    def test_changed_identity_after_content_removal_never_uses_privilege(self):
        own = self.work / 'changed-before-empty-removal'
        own.mkdir()
        original = p.local_identity(own)
        (own / 'own-file').write_bytes(b'fixture')
        changed = original[0], original[1] + 1
        with patch.object(p, 'local_identity', side_effect=[original, changed]), \
                patch.object(self.driver, 'command', side_effect=AssertionError('must not invoke sudo')):
            errors = p.cleanup_directories({str(own): original}, containers_removed=True,
                                          command=self.driver.command)
        self.assertEqual(len(errors), 1)
        self.assertTrue(own.exists())


if __name__ == '__main__':
    unittest.main()
