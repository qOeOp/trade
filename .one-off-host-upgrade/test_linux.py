"""Linux-only mechanical evidence using real renameat2 and cross-process flock.

All paths are disposable temporary files. Systemctl, Docker and inspectors remain
fake. Crash evidence is process interruption only, never power-loss recovery.
"""
from contextlib import contextmanager
import errno
import hashlib
import json
import os
from pathlib import Path
import select
import subprocess
import sys
import unittest
from unittest.mock import patch

import upgrade as u
import test_upgrade as fixtures

HERE = Path(__file__).resolve().parent

HOLDER = """import fcntl,json,os,sys
fd=os.open(sys.argv[1],os.O_RDONLY|os.O_NOFOLLOW)
fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
s=os.fstat(fd)
print(json.dumps({'dev':s.st_dev,'ino':s.st_ino}),flush=True)
sys.stdin.readline()
os.close(fd)
"""
PROBE = """import fcntl,json,os,sys
result=[]
for path in sys.argv[1:]:
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
 try:
  try:fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB);result.append('free')
  except BlockingIOError:result.append('held')
 finally:os.close(fd)
print(json.dumps(result))
"""
CRASH_AFTER_EXCHANGE = """import os,pathlib,sys
sys.path.insert(0,sys.argv[1])
from upgrade import atomic_exchange
atomic_exchange(pathlib.Path(sys.argv[2]),pathlib.Path(sys.argv[3]))
os._exit(73)
"""


@unittest.skipUnless(sys.platform == 'linux', 'real renameat2/flock evidence requires Linux')
class LinuxMechanicalTests(unittest.TestCase):
    # Reuse only the disposable fixture; do not inherit its fake-exchange tests.
    setUp = fixtures.UpgradeTests.setUp
    swap = fixtures.UpgradeTests.swap
    cold = fixtures.UpgradeTests.cold

    def real_exchange(self, left, right):
        self.calls.append((left, right))
        u.atomic_exchange(left, right)

    def assert_originals(self):
        self.assertEqual(u.identity(self.declaration, contents=True),
                         self.baseline['identities'][str(self.declaration)])
        for path in (self.state / 'lock', self.root / 'account.lock', self.foreign / 'account.lock'):
            self.assertEqual(u.identity(path), self.baseline['identities'][str(path)])

    def prepare_real(self, *, modules=None):
        stage = self.code.parent / 'linux-review-stage'
        package = u.Package(self.code, stage, self.baseline['deploy_tree'],
                            self.modules if modules is None else modules, exchange=u.atomic_exchange)
        package.prepare()
        return package

    def test_real_exchange_reverse_and_system_python_source_import(self):
        _, modules = u.bundle(HERE / 'bundle.json')
        package = self.prepare_real(modules=modules)
        original, staged = u.identity(self.code), u.identity(package.stage)
        # Finite shared-parser inputs are fake private files, never live records.
        declaration = self.work / 'cold-declaration.json'
        snapshot = self.work / 'cold-snapshot/configuration.json'
        snapshot.parent.mkdir()
        operator = {'root': str(self.root), 'research_ledger': '/unused-ledger', 'research_at': 'a' * 40,
                    'universe_file': '/unused-universe', 'symbols': [], 'sources': [], 'defaults': {}, 'memory': 256}
        u.new_file(declaration, json.dumps(dict(operator, format='live-deployment-v1')).encode())
        u.new_file(snapshot, json.dumps(dict(operator, format='live-control-v1',
                    runtime='ghcr.io/qoeop/trade-runtime@sha256:' + 'b' * 64,
                    socket=str(snapshot.parent / 'socket/control.sock'))).encode())
        package.switch()
        self.assertEqual((u.identity(self.code), u.identity(package.stage)), (staged, original))
        package.check(True)
        for name, content in modules.items():
            self.assertEqual(hashlib.sha256(u.read(self.code / name)).hexdigest(), hashlib.sha256(content).hexdigest())
        self.assertEqual(u.read(package.stage / '__pycache__/original.pyc'), b'old cache bytes')
        self.assertEqual(u.read(package.stage / 'remote/original.compose.yaml'), b'services: {}\n')
        self.assertEqual(u.read(self.code / 'reviewed-extra.txt'), b'retained attachment\n')
        self.assertFalse((self.code / '__pycache__').exists())
        # Production cold() uses the literal /usr/bin/python3 -I -B and source-only loader.
        u.cold(self.code, modules, declaration, snapshot)
        package.restore()
        self.assertEqual((u.identity(self.code), u.identity(package.stage)), (original, staged))
        package.check(False)
        self.assert_originals()

    def test_real_missing_target_syscall_error_has_no_partial_exchange(self):
        package = self.prepare_real()
        original, staged = u.identity(self.code), u.identity(package.stage)
        missing = self.code.parent / 'missing-target'
        with self.assertRaises(OSError) as failure:
            u.atomic_exchange(self.code, missing)
        self.assertEqual(failure.exception.errno, errno.ENOENT)
        self.assertFalse(missing.exists())
        self.assertEqual((u.identity(self.code), u.identity(package.stage)), (original, staged))
        package.check(False)
        self.assert_originals()

    def test_real_rename_then_sync_failure_rolls_back_under_original_locks(self):
        self.runner.exchange = self.real_exchange
        real_sync = u.sync
        failures = []
        def sync(path):
            if Path(path) == self.code.parent and len(self.calls) == 1:
                self.assertTrue(self.runner.locks_held and self.runner.foreign_locks_held)
                self.assertTrue(self.runner.package.selected())
                failures.append('after-forward-rename')
                raise OSError(errno.EIO, 'synthetic parent fsync failure after real renameat2')
            return real_sync(path)
        with patch.object(u, 'sync', side_effect=sync):
            with self.assertRaisesRegex(RuntimeError, 'original package was proved restored'):
                self.runner.run()
        self.assertEqual(failures, ['after-forward-rename'])
        self.assertEqual(len(self.calls), 2)
        self.runner.package.check(False)
        self.assertEqual(self.system.actions, [('timer', 'stop'), ('timer', 'start')])
        self.assert_originals()

    def test_real_reverse_sync_failure_does_not_claim_durable_restore_or_resume(self):
        self.runner.exchange = self.real_exchange
        real_sync = u.sync
        failures = []
        def sync(path):
            if Path(path) == self.code.parent and self.calls:
                self.assertTrue(self.runner.locks_held and self.runner.foreign_locks_held)
                selected = self.runner.package.selected()
                self.assertEqual(selected, len(self.calls) == 1)
                failures.append(len(self.calls))
                raise OSError(errno.EIO, 'synthetic sync failure after real forward/reverse renameat2')
            return real_sync(path)
        with patch.object(u, 'sync', side_effect=sync):
            with self.assertRaises(OSError) as failure:
                self.runner.run()
        self.assertEqual(failure.exception.errno, errno.EIO)
        self.assertEqual(failures, [1, 2])
        self.assertEqual(len(self.calls), 2)
        self.runner.package.check(False)  # Directory facts only; no durability claim.
        self.assertFalse(self.runner.safe_resume)
        self.assertFalse(self.runner.window.handed_off)
        self.assertEqual(self.system.actions, [('timer', 'stop')])
        self.assert_originals()

    def test_disposable_child_exits_after_real_exchange_without_automatic_reentry(self):
        package = self.prepare_real()
        original, staged = u.identity(self.code), u.identity(package.stage)
        result = subprocess.run([sys.executable, '-I', '-B', '-c', CRASH_AFTER_EXCHANGE,
                                 str(HERE), str(self.code), str(package.stage)],
                                capture_output=True, text=True, timeout=10, check=False,
                                env={'PATH': os.defpath})
        self.assertEqual(result.returncode, 73, result.stderr)
        self.assertEqual((u.identity(self.code), u.identity(package.stage)), (staged, original))
        package.check(True)
        self.assert_originals()
        self.assertEqual(self.system.actions, [])
        # Deliberately no restore(), Upgrade.run(), or automatic re-entry here.

    @contextmanager
    def child_holds(self, path):
        child = subprocess.Popen([sys.executable, '-I', '-B', '-c', HOLDER, str(path)],
                                 stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                 text=True, env={'PATH': os.defpath})
        try:
            self.assertTrue(select.select([child.stdout], [], [], 5)[0], 'disposable lock holder did not report ready')
            opened = json.loads(child.stdout.readline())
            expected = u.identity(path)
            self.assertEqual(opened, {key: expected[key] for key in ('dev', 'ino')})
            yield
        finally:
            _, stderr = child.communicate('\n', timeout=10)
            self.assertEqual(child.returncode, 0, stderr)

    def lock_probe(self):
        paths = (self.state / 'lock', self.root / 'account.lock', self.foreign / 'account.lock')
        result = subprocess.run([sys.executable, '-I', '-B', '-c', PROBE, *map(str, paths)],
                                capture_output=True, text=True, timeout=10, check=True,
                                env={'PATH': os.defpath})
        return json.loads(result.stdout)

    def test_cross_process_original_locks_block_before_helpers_and_release_before_handoff(self):
        self.runner.exchange = self.real_exchange
        paths = (self.state / 'lock', self.root / 'account.lock', self.foreign / 'account.lock')
        for path in paths:
            with self.subTest(contended=str(path)):
                self.system.events.clear()
                with self.child_holds(path):
                    with self.assertRaises(BlockingIOError):
                        self.runner.run()
                self.assertEqual(self.calls, [])
                self.assertNotIn('canonical', self.system.events)
                self.assertNotIn('foreign', self.system.events)
                self.assertEqual(self.lock_probe(), ['free'] * 3)
                # A new independent fake invocation may start only in its original timer state.
                self.system.values[u.UNITS[0]]['ActiveState'] = 'active'
        checked_helpers = []
        old_foreign, old_inspector, old_timer = (self.system.foreign_observation,
                                                self.system.inspector, self.system.timer)
        def foreign(root):
            self.assertEqual(self.lock_probe(), ['held'] * 3)
            checked_helpers.append('foreign')
            return old_foreign(root)
        def inspector(root, snapshot):
            self.assertEqual(self.lock_probe(), ['held'] * 3)
            checked_helpers.append('canonical')
            return old_inspector(root, snapshot)
        def timer(action):
            if action == 'start':
                self.assertFalse(self.runner.locks_held)
                self.assertFalse(self.runner.foreign_locks_held)
                self.assertEqual(self.lock_probe(), ['free'] * 3)
                checked_helpers.append('handoff-after-unlock')
            return old_timer(action)
        self.system.foreign_observation, self.system.inspector, self.system.timer = foreign, inspector, timer
        self.runner.run()
        self.assertIn('foreign', checked_helpers)
        self.assertIn('canonical', checked_helpers)
        self.assertEqual(checked_helpers[-1], 'handoff-after-unlock')
        self.assertEqual(len(self.calls), 1)
        self.runner.package.check(True)
        self.assert_originals()


if __name__ == '__main__':
    unittest.main()
