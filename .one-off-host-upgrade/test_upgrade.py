"""Offline tests: real disposable files/flock; fake systemctl, Docker and exchange.

The three-rename test exchange is NOT Linux atomic exchange evidence.
"""
import copy
import hashlib
import json
import os
from pathlib import Path
import py_compile
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import upgrade as u

HERE = Path(__file__).resolve().parent


def exchange(left, right):
    temporary = left.parent / 'test-exchange-middle'
    left.rename(temporary)
    right.rename(left)
    temporary.rename(right)


class Clock:
    def __init__(self):
        self.now = 0
    def time(self):
        return self.now
    def sleep(self, amount):
        self.now += amount


class FakeSystem:
    def __init__(self):
        self.values = {name: {key: '' for key in (*u.STATIC, *u.DYNAMIC)} for name in u.UNITS}
        for name, row in self.values.items():
            row.update(FragmentPath='/etc/systemd/system/' + name, ActiveState='inactive', SubState='dead',
                       MainPID='0', ControlPID='0', Job='', UnitFileState='enabled')
        self.values[u.UNITS[0]].update(ActiveState='active', SubState='waiting', Triggers=u.UNITS[1])
        self.values[u.UNITS[1]]['TriggeredBy'] = u.UNITS[0]
        self.actions, self.extra, self.queued, self.events = [], [], [], []
        self.facts = {'containers': {}}
        self.foreign_state, self.canonical_state = {'state': 'idle'}, {'state': 'idle'}
        self.after_inspector = None
        self.draining = 0

    def units(self):
        if self.draining:
            self.draining -= 1
            self.values[u.UNITS[1]].update(ActiveState='activating', SubState='start', MainPID='12')
            if self.draining == 0:
                self.values[u.UNITS[1]].update(ActiveState='inactive', SubState='dead', MainPID='0')
        return copy.deepcopy(self.values)
    def timer(self, action):
        self.actions.append(('timer', action))
        self.values[u.UNITS[0]]['ActiveState'] = 'inactive' if action == 'stop' else 'active'
    def jobs(self):
        return self.queued
    def consumers(self):
        return self.extra
    def observe(self):
        self.events.append('observe')
        return copy.deepcopy(self.facts)
    def foreign_observation(self, root):
        self.events.append('foreign')
        return self.foreign_state
    def inspector(self, root, snapshot):
        self.events.append('canonical')
        if self.after_inspector:
            self.after_inspector()
            self.after_inspector = None
        return self.canonical_state
    def cold_original(self, code, expected):
        assert u.tree(code, expected) == expected
        self.events.append('cold-original')


class UpgradeTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='upgrade-offline-')
        self.addCleanup(temporary.cleanup)
        self.work = Path(temporary.name).resolve()
        self.code, self.state, self.root, self.foreign = [self.work / name for name in ('host/deploy', 'release', 'custody', 'legacy')]
        for path in (self.code, self.state, self.root, self.foreign):
            path.mkdir(parents=True, mode=0o700)
        for path in (self.state / 'lock', self.root / 'account.lock', self.foreign / 'account.lock'):
            u.new_file(path, b'')
        self.declaration = self.state / 'live/configuration.json'
        self.declaration.parent.mkdir(mode=0o700)
        u.new_file(self.declaration, json.dumps({'format': 'live-deployment-v1', 'root': str(self.root)}).encode())
        for name in u.MODULES:
            if name != 'live_configuration.py':
                u.new_file(self.code / name, b'# retained old module\n', 0o644)
        (self.code / 'remote').mkdir(mode=0o755)
        u.new_file(self.code / 'remote/original.compose.yaml', b'services: {}\n', 0o644)
        u.new_file(self.code / 'reviewed-extra.txt', b'retained attachment\n', 0o640)
        (self.code / '__pycache__').mkdir()
        u.new_file(self.code / '__pycache__/original.pyc', b'old cache bytes')
        self.system = FakeSystem()
        paths = [self.code.parent, self.state, self.state / 'lock', self.root, self.root / 'account.lock',
                 self.foreign, self.foreign / 'account.lock', self.declaration]
        self.baseline = {'root': str(self.root), 'web': 'trade-release-web-' + 'a' * 40,
                         'units': self.system.units(), 'identities': {str(p): u.identity(p, contents=p == self.declaration) for p in paths},
                         'deploy_identity': u.identity(self.code), 'deploy_tree': u.tree(self.code, u.metadata_tree(self.code)), 'observations': self.system.observe(),
                         'known_foreign': [str(self.foreign)], 'foreign': {str(self.foreign): {
                             'root': u.identity(self.foreign), 'lock': u.identity(self.foreign / 'account.lock'), 'observation': {'state': 'idle'}}}}
        self.modules = {name: b'# reviewed new module\n' for name in u.MODULES}
        self.imports = []
        self.calls = []
        self.runner = u.Upgrade(self.code, self.state, self.baseline, self.modules, self.system,
                                exchange=self.swap, import_check=self.cold)

    def swap(self, left, right):
        self.calls.append((left, right))
        exchange(left, right)

    def cold(self, code, modules, declaration, snapshot):
        self.imports.append(code)
        self.assertEqual({name: u.read(code / name) for name in u.MODULES}, modules)
        self.assertEqual(u.identity(declaration, contents=True), self.baseline['identities'][str(self.declaration)])

    def test_existing_declaration_and_all_old_assets_survive_complete_exchange(self):
        result = self.runner.run()
        self.assertEqual(result['state'], 'host-package-upgraded')
        old = Path(result['retained_original'])
        self.assertEqual(old.parent, self.code.parent)
        self.assertEqual(u.tree(old, self.baseline['deploy_tree']), self.baseline['deploy_tree'])
        self.assertEqual(u.read(self.code / 'reviewed-extra.txt'), b'retained attachment\n')
        self.assertTrue((self.code / 'remote/original.compose.yaml').exists())
        self.assertFalse((self.code / '__pycache__').exists())
        self.assertEqual(u.identity(self.declaration, contents=True), self.baseline['identities'][str(self.declaration)])
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(self.system.actions, [('timer', 'stop'), ('timer', 'start')])

    def test_unknown_unreviewed_attachment_stops_before_exchange(self):
        u.new_file(self.code / 'unknown.txt', b'unknown')
        with self.assertRaises(RuntimeError):
            self.runner.run()
        self.assertEqual(self.calls, [])
        self.assertEqual(self.system.actions, [('timer', 'stop')])
        self.assertTrue((self.code / 'unknown.txt').exists())

    def test_missing_module_and_different_parent_are_refused(self):
        with self.assertRaises(RuntimeError):
            u.Package(self.code, self.work / 'wrong-parent', self.baseline['deploy_tree'], self.modules)
        with self.assertRaises(RuntimeError):
            u.Package(self.code, self.code.parent / 'stage', self.baseline['deploy_tree'], {k: v for k, v in self.modules.items() if k != 'release.py'})

    def test_duplicate_json_declaration_is_not_rewritten(self):
        data = b'{"root":"one","root":"two"}'
        file = self.work / 'duplicate.json'
        u.new_file(file, data)
        with self.assertRaises(RuntimeError):
            u.obj(file)
        self.assertEqual(u.read(file), data)

    def test_natural_drain_never_stops_service(self):
        clock = Clock()
        window = u.Window(self.system, self.system.units(), clock.time, clock.sleep)
        old_timer = self.system.timer
        def stop(action):
            old_timer(action)
            if action == 'stop':
                self.system.draining = 4
        self.system.timer = stop
        window.pause(timeout=3)
        window.resume()
        self.assertGreater(clock.now, 0)
        self.assertEqual(self.system.actions, [('timer', 'stop'), ('timer', 'start')])

    def test_jobs_or_extra_consumers_expire_without_killing(self):
        for field in ('queued', 'extra'):
            with self.subTest(field=field):
                system, clock = FakeSystem(), Clock()
                setattr(system, field, ['pending'])
                window = u.Window(system, system.units(), clock.time, clock.sleep)
                with self.assertRaisesRegex(RuntimeError, 'timed out'):
                    window.pause(timeout=.5)
                self.assertEqual(system.actions, [('timer', 'stop')])

    def test_replaced_original_release_lock_is_not_recreated(self):
        path = self.state / 'lock'
        path.rename(self.state / 'retained-lock')
        u.new_file(path, b'')
        with self.assertRaises(RuntimeError):
            self.runner.run()
        self.assertEqual(self.calls, [])
        self.assertTrue((self.state / 'retained-lock').exists())

    def test_root_replacement_after_last_helper_preserves_original_lock_but_refuses(self):
        lock = u.identity(self.root / 'account.lock')
        def replace():
            self.root.rename(self.work / 'original-root')
            self.root.mkdir(mode=0o700)
            (self.work / 'original-root/account.lock').rename(self.root / 'account.lock')
        self.system.after_inspector = replace
        with self.assertRaises(RuntimeError):
            self.runner.run()
        self.assertEqual(u.identity(self.root / 'account.lock'), lock)
        self.assertEqual(self.calls, [])
        self.assertEqual(self.system.actions, [('timer', 'stop')])

    def test_rename_success_then_fsync_error_is_recognized_and_reversed_in_same_locks(self):
        def fail_after_swap(left, right):
            self.swap(left, right)
            if len(self.calls) == 1:
                raise OSError('simulated post-rename fsync failure')
        self.runner.exchange = fail_after_swap
        with self.assertRaisesRegex(RuntimeError, 'original package was proved restored'):
            self.runner.run()
        self.assertEqual(len(self.calls), 2)
        self.assertEqual(u.tree(self.code, self.baseline['deploy_tree']), self.baseline['deploy_tree'])
        self.assertEqual(self.system.actions, [('timer', 'stop'), ('timer', 'start')])
        self.assertFalse(self.runner.locks_held)

    def test_pre_exchange_failure_leaves_old_package_and_restores_timer_only_after_proof(self):
        self.runner.import_check = lambda *_: (_ for _ in ()).throw(RuntimeError('stage cold import failed'))
        with self.assertRaisesRegex(RuntimeError, 'original package was proved restored'):
            self.runner.run()
        self.assertEqual(self.calls, [])
        self.assertEqual(u.tree(self.code, self.baseline['deploy_tree']), self.baseline['deploy_tree'])
        self.assertEqual(self.system.actions, [('timer', 'stop'), ('timer', 'start')])

    def test_post_exchange_import_failure_rolls_back_before_handoff(self):
        def failed(code, *args):
            if code == self.code:
                raise RuntimeError('new cold import failed')
        self.runner.import_check = failed
        with self.assertRaisesRegex(RuntimeError, 'original package was proved restored'):
            self.runner.run()
        self.assertEqual(len(self.calls), 2)
        self.assertEqual(u.tree(self.code, self.baseline['deploy_tree']), self.baseline['deploy_tree'])

    def test_foreign_unavailable_is_not_replaced_by_canonical_idle(self):
        self.system.foreign_state = {'state': 'unavailable'}
        with self.assertRaises(RuntimeError):
            self.runner.run()
        self.assertEqual(self.calls, [])
        self.assertNotIn('canonical', self.system.events)

    def test_native_egress_or_orphan_requires_original_owner_recycling(self):
        for facts in ({'name': '/trade-live-orphan', 'run': None, 'role': None},
                      {'name': '/unknown', 'run': 'one', 'role': 'egress'}):
            self.system.facts['containers'] = {'a': facts}
            self.baseline['observations'] = self.system.observe()
            with self.assertRaises(RuntimeError):
                self.runner.run()
            self.assertEqual(self.calls, [])
            self.system.values[u.UNITS[0]]['ActiveState'] = 'active'

    def test_foreign_lock_is_nonblocking_and_no_helper_observes_unlocked_state(self):
        with u.original_lock(self.foreign / 'account.lock', u.identity(self.foreign / 'account.lock')):
            with self.assertRaises(BlockingIOError):
                self.runner.run()
        self.assertEqual(self.calls, [])
        self.assertNotIn('foreign', self.system.events)

    def test_no_rollback_after_unlock_or_timer_handoff(self):
        self.runner.run()
        with self.assertRaisesRegex(RuntimeError, 'after handoff'):
            self.runner.rollback()
        self.assertEqual(len(self.calls), 1)

    def test_production_helpers_have_fixed_ro_read_only_business_calls_and_no_fallback(self):
        root, foreign = u.CANONICAL, u.KNOWN_FOREIGN[0]
        baseline = {'root': str(root), 'web': 'trade-release-web-' + 'a' * 40, 'socket_gid': 999,
                    'service_image': 'ghcr.io/qoeop/trade-service@sha256:' + 'a' * 64,
                    'known_foreign': [str(foreign)], 'foreign': {str(foreign): {'root': {'uid': 123, 'gid': 456}}},
                    'identities': {str(root): {'uid': 111, 'gid': 222}}}
        system = u.System(baseline, Path('/never-used-empty-config'), u.bundle(HERE / 'bundle.json')[1]['release_host.py'])
        canonical = system.inspector_command(root, u.STATE / 'live' / ('a' * 40) / 'configuration.json')
        historical = system.foreign_command(foreign)
        for command, owner in ((canonical, '111:222'), (historical, '123:456')):
            self.assertEqual(command[command.index('--network') + 1], 'none')
            self.assertEqual(command[command.index('--user') + 1], owner)
            self.assertEqual(command[command.index('--group-add') + 1], '999')
            self.assertIn('--pull=never', command)
            self.assertIn('--read-only', command)
        self.assertIn(f'type=bind,src={u.STATE},dst={u.STATE},readonly', canonical)
        self.assertNotIn(str(u.STATE), ' '.join(historical))
        self.assertIn(u.OBSERVER_IMAGE, historical)
        self.assertIn('-I', historical)
        self.assertIn('-B', historical)
        self.assertIn('idle_locked', historical[-2])
        self.assertNotIn('authority', historical[-2])
        self.assertNotIn('maintain', historical[-2])
        with self.assertRaises(RuntimeError):
            system.foreign_command(Path('/arbitrary-root'))

    def test_inert_bundle_verification_does_not_construct_host_adapters(self):
        value, modules = u.bundle(HERE / 'bundle.json')
        self.assertEqual(set(modules), set(u.MODULES))
        self.assertEqual(value['revision'], u.REVISION)
        corrupt = copy.deepcopy(value)
        corrupt['modules'].pop('live_configuration.py')
        file = self.work / 'bad-bundle.json'
        u.new_file(file, json.dumps(corrupt).encode())
        with self.assertRaises(RuntimeError):
            u.bundle(file)

    def test_default_mode_never_constructs_a_host_adapter_or_touches_timer(self):
        path = HERE / 'bundle.json'
        digest = hashlib.sha256(u.read(path)).hexdigest()
        with patch.object(sys, 'argv', ['upgrade.py', '--bundle', str(path), '--bundle-sha256', digest]), \
                patch.object(u, 'System', side_effect=AssertionError('host adapter constructed')), \
                patch.object(u, 'read_baseline', side_effect=AssertionError('host baseline read')), patch('sys.stdout'):
            u.main()

    def test_transaction_created_by_last_external_observation_blocks_exchange(self):
        original = self.system.observe
        def changed():
            result = original()
            path = self.state / 'transaction.json'
            if not path.exists():
                u.new_file(path, b'{}')
            return result
        self.system.observe = changed
        with self.assertRaises(RuntimeError):
            self.runner.run()
        self.assertEqual(self.calls, [])
        self.assertTrue((self.state / 'transaction.json').exists())
        self.assertEqual(self.system.actions, [('timer', 'stop')])

    def test_third_party_change_after_exchange_forbids_rollback_and_timer_resume(self):
        def changed(code, *args):
            if code == self.code:
                u.new_file(self.state / 'transaction.json', b'{}')
                raise RuntimeError('third party mutation')
        self.runner.import_check = changed
        with self.assertRaises(RuntimeError):
            self.runner.run()
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(self.system.actions, [('timer', 'stop')])
        self.assertEqual(u.tree(self.runner.package.stage, self.baseline['deploy_tree']), self.baseline['deploy_tree'])
        self.assertTrue((self.state / 'transaction.json').exists())

    def test_fresh_source_only_import_ignores_old_valid_bytecode_and_external_pythonpath(self):
        _, modules = u.bundle(HERE / 'bundle.json')
        package = self.work / 'smoke/deploy'
        package.mkdir(parents=True)
        for name, content in modules.items():
            u.new_file(package / name, content, 0o644)
        init = package / '__init__.py'
        good = u.read(init)
        evil = b"raise RuntimeError('stale bytecode executed')\n"
        init.write_bytes(evil + b' ' * (len(good) - len(evil)))
        timestamp = init.stat().st_mtime_ns
        py_compile.compile(str(init), doraise=True)
        init.write_bytes(good)
        os.utime(init, ns=(timestamp, timestamp))
        hashes = {name: hashlib.sha256(content).hexdigest() for name, content in modules.items()}
        result = subprocess.run([sys.executable, '-I', '-B', '-c', u.COLD, str(package), json.dumps(hashes)],
                                cwd=self.work, env={'PATH': os.defpath, 'PYTHONPATH': '/unreviewed-shadow'},
                                capture_output=True, text=True, check=True)
        self.assertEqual(result.stdout.strip(), 'reviewed-imports-ok')
        self.assertEqual(hashlib.sha256(u.read(init)).hexdigest(), hashes['__init__.py'])


if __name__ == '__main__':
    unittest.main()
