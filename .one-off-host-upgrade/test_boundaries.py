"""Decisive v1 counterexamples using only synthetic fixtures and offline adapters."""
from contextlib import ExitStack
import hashlib
import json
import os
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

import collect
import test_upgrade as fixtures
import upgrade as u

HERE = Path(__file__).resolve().parent


class PackageReadTests(unittest.TestCase):
    setUp = fixtures.UpgradeTests.setUp
    swap = fixtures.UpgradeTests.swap
    cold = fixtures.UpgradeTests.cold

    def test_unknown_file_never_read_during_prepare_or_failed_rollback(self):
        unknown = self.code / 'unreviewed-credential-fixture.json'
        u.new_file(unknown, b'{"fake":"synthetic-only"}')
        with patch.object(u, 'read', wraps=u.read) as reads, patch.object(self.runner, 'rollback', wraps=self.runner.rollback) as rollback:
            with self.assertRaisesRegex(RuntimeError, 'path set'):
                self.runner.run()
        self.assertEqual(rollback.call_count, 1)
        self.assertNotIn(unknown, [Path(call.args[0]) for call in reads.call_args_list])
        self.assertEqual(self.calls, [])
        self.assertEqual(self.system.actions, [('timer', 'stop')])

    def test_complete_metadata_checked_before_any_package_content_read(self):
        target = self.code / 'reviewed-extra.txt'
        for kind in ('type', 'mode', 'owner'):
            with self.subTest(change=kind):
                before = u.metadata_tree(self.code)
                if kind == 'type':
                    target.unlink()
                    target.mkdir()
                elif kind == 'mode':
                    target.chmod(0o600)
                else:
                    before['reviewed-extra.txt']['uid'] += 1
                with patch.object(u, 'read', wraps=u.read) as reads:
                    with self.assertRaisesRegex(RuntimeError, 'type or ownership'):
                        u.tree(self.code, before)
                self.assertEqual(reads.call_count, 0)
                if kind == 'type':
                    target.rmdir()
                    u.new_file(target, b'retained attachment\n', 0o640)
                target.chmod(0o640)

    def test_unknown_added_after_metadata_scan_is_never_opened(self):
        unknown = self.code / 'late-unreviewed-fixture.json'
        real_scan = u.metadata_tree
        calls = []
        def changed(root):
            result = real_scan(root)
            calls.append(root)
            if len(calls) == 1:
                u.new_file(unknown, b'synthetic')
            return result
        with patch.object(u, 'metadata_tree', side_effect=changed), patch.object(u, 'read', wraps=u.read) as reads:
            with self.assertRaisesRegex(RuntimeError, 'identities changed'):
                u.tree(self.code, self.baseline['deploy_tree'])
        self.assertNotIn(unknown, [Path(call.args[0]) for call in reads.call_args_list])

    def test_opened_file_identity_is_checked_before_reading_replacement(self):
        target = self.code / 'reviewed-extra.txt'
        original = u.metadata_tree(self.code)
        target.rename(self.work / 'original-attachment')
        u.new_file(target, b'synthetic replacement', 0o640)
        with self.assertRaisesRegex(RuntimeError, 'before content read'):
            u.read(target, expected=original['reviewed-extra.txt'])

    def test_content_inventory_without_original_inode_accepts_identical_copy(self):
        copied = self.work / 'independent-reviewed-copy'
        reviewed = self.baseline['deploy_tree']
        self.assertTrue(all('dev' not in row and 'ino' not in row for row in reviewed.values()))
        shutil.copytree(self.code, copied)
        self.assertNotEqual(u.identity(copied)['ino'], u.identity(self.code)['ino'])
        self.assertEqual(u.tree(copied, reviewed), reviewed)

    def test_unknown_after_exchange_is_not_read_by_failed_recovery(self):
        unknown = self.code / 'after-exchange-unreviewed-fixture.json'
        def fail(code, *args):
            if code == self.code:
                u.new_file(unknown, b'synthetic')
                raise RuntimeError('cold failure after unknown addition')
        self.runner.import_check = fail
        with patch.object(u, 'read', wraps=u.read) as reads:
            with self.assertRaisesRegex(RuntimeError, 'path set'):
                self.runner.run()
        self.assertNotIn(unknown, [Path(call.args[0]) for call in reads.call_args_list])
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(self.system.actions, [('timer', 'stop')])


class CollectorTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='collector-v2-offline-')
        self.addCleanup(temporary.cleanup)
        self.work = Path(temporary.name).resolve()
        self.code, self.state, self.root, self.foreign = [self.work / name for name in ('code', 'state', 'canonical', 'foreign')]
        for path in (self.code, self.state, self.root, self.foreign):
            path.mkdir(mode=0o700)
        u.new_file(self.code / 'reviewed.py', b'# reviewed synthetic\n', 0o644)
        self.assets = u.metadata_tree(self.code)
        self.declaration = self.state / 'live/configuration.json'
        self.declaration.parent.mkdir()
        u.new_file(self.declaration, json.dumps({'root': str(self.root)}).encode())
        self.web = 'trade-release-web-' + 'a' * 40
        snapshot = self.state / 'live' / ('a' * 40) / 'configuration.json'
        snapshot.parent.mkdir()
        u.new_file(snapshot, b'{}')
        route = self.state / 'router/active.json'
        route.parent.mkdir()
        u.new_file(route, json.dumps({'apps': {'http': {'servers': {'ide': {'routes': [
            {'handle': [{'upstreams': [{'dial': self.web + ':8765'}]}]}]}}}}}).encode())
        for path in (self.state / 'lock', self.root / 'account.lock', self.foreign / 'account.lock'):
            u.new_file(path, b'')
        self.digest = hashlib.sha256(u.read(HERE / 'bundle.json')).hexdigest()
        actual_identity = u.identity
        def fake_host_identity(path, **kwargs):
            if path.is_relative_to(self.work):
                return actual_identity(path, **kwargs)
            self.assertIn(str(path), {'/var/run/docker.sock', *('/etc/systemd/system/' + unit for unit in u.UNITS)})
            result = {'kind': 'socket' if str(path) == '/var/run/docker.sock' else 'file',
                      'mode': 0o600, 'uid': os.getuid(), 'gid': os.getgid(), 'dev': 1, 'ino': 1}
            if kwargs.get('contents'):
                result.update(size=0, sha256=hashlib.sha256(b'').hexdigest())
            return result
        case = self
        class OfflineSystem(u.System):
            def __init__(self, baseline, docker_config, owner_code):
                super().__init__(baseline, docker_config, owner_code)
                case.adapter = self
            def units(self):
                return fixtures.FakeSystem().units()
            def docker(self, *args, **kwargs):
                case.assertEqual(args, ('inspect', '--format', u.CONTAINERS, 'trade-release-live-' + 'a' * 40))
                return json.dumps({'image': 'ghcr.io/qoeop/trade-service@sha256:' + 'a' * 64})
            def observe(self):
                case.observations += 1
                if case.after_observation:
                    case.after_observation(case.observations)
                return {'containers': {}, 'routes': {}}
            def foreign_observation(self, root):
                command = self.foreign_command(root)  # Real production owner/lock-dependent constructor.
                original = self.baseline['foreign'][str(root)]
                case.assertEqual(original['root'], actual_identity(root))
                case.assertEqual(original['lock'], actual_identity(root / 'account.lock'))
                case.assertEqual(command[command.index('--user') + 1], f'{os.getuid()}:{os.getgid()}')
                case.events.append('foreign')
                return case.foreign_state
            def inspector(self, root, snapshot):
                self.inspector_command(root, snapshot)
                case.events.append('canonical')
                return case.canonical_state
        self.events, self.observations = [], 0
        self.foreign_state = self.canonical_state = {'state': 'idle'}
        self.after_observation = None
        stack = ExitStack()
        self.addCleanup(stack.close)
        stack.enter_context(patch.multiple(u, CODE=self.code, STATE=self.state, CANONICAL=self.root,
                                          DECLARATION=self.declaration, KNOWN_FOREIGN=(self.foreign,)))
        stack.enter_context(patch.object(u, 'identity', side_effect=fake_host_identity))
        stack.enter_context(patch.object(u, 'System', OfflineSystem))

    def test_full_draft_initializes_foreign_before_production_command_and_is_not_installable(self):
        result = collect.capture(self.assets, self.digest)
        self.assertEqual(self.events, ['foreign', 'canonical'])
        self.assertEqual(result['foreign'][str(self.foreign)]['observation'], {'state': 'idle'})
        self.assertEqual(result['format'], 'draft-existing-live-host-upgrade-observation-v1')
        self.assertEqual(result['window'], 'NOT_CONFIRMED')
        draft = self.work / 'draft.json'
        u.new_file(draft, json.dumps(result).encode())
        digest = hashlib.sha256(u.read(draft)).hexdigest()
        with self.assertRaisesRegex(RuntimeError, 'concrete reviewed baseline'):
            u.read_baseline(draft, digest, self.digest)

    def test_reviewed_metadata_original_cannot_omit_content_fingerprint(self):
        # Synthetic only: changing draft labels here is not an authorization flow.
        result = collect.capture(self.assets, self.digest)
        result['format'] = 'reviewed-existing-live-host-upgrade-v1'
        result['window'] = 'no-new-live-or-manual-host-package-consumers;three-product-prs-unmerged'
        del result['identities'][str(self.declaration)]['sha256']
        path = self.work / 'incomplete-synthetic-review.json'
        u.new_file(path, json.dumps(result).encode())
        digest = hashlib.sha256(u.read(path)).hexdigest()
        with self.assertRaisesRegex(RuntimeError, 'complete content fingerprint'):
            u.read_baseline(path, digest, self.digest)

    def test_collector_unknown_between_observations_never_read(self):
        unknown = self.code / 'unreviewed-collector-fixture.json'
        def change(count):
            if count == 1:
                u.new_file(unknown, b'synthetic')
        self.after_observation = change
        with patch.object(u, 'read', wraps=u.read) as reads:
            with self.assertRaisesRegex(RuntimeError, 'path set'):
                collect.capture(self.assets, self.digest)
        self.assertNotIn(unknown, [Path(call.args[0]) for call in reads.call_args_list])

    def test_collector_scan_to_read_race_never_reads_new_attachment(self):
        unknown = self.code / 'scan-race-fixture.json'
        scan = u.metadata_tree
        def changed(root):
            result = scan(root)
            if not unknown.exists():
                u.new_file(unknown, b'synthetic')
            return result
        with patch.object(u, 'metadata_tree', side_effect=changed), patch.object(u, 'read', wraps=u.read) as reads:
            with self.assertRaisesRegex(RuntimeError, 'identities changed'):
                collect.capture(self.assets, self.digest)
        self.assertNotIn(unknown, [Path(call.args[0]) for call in reads.call_args_list])
        self.assertEqual(self.events, [])

    def test_collector_replaced_reviewed_inode_before_capture_is_never_read(self):
        target = self.code / 'reviewed.py'
        original = self.assets['reviewed.py'].copy()
        retained = self.work / 'retained-survey-original.py'
        target.rename(retained)
        u.new_file(target, b'# synthetic replacement, never read\n', original['mode'])
        replacement = target.lstat()
        self.assertNotEqual(replacement.st_ino, original['ino'])
        self.assertEqual((replacement.st_mode & 0o7777, replacement.st_uid, replacement.st_gid),
                         (original['mode'], original['uid'], original['gid']))
        real_read, reads = u.read, []
        def tracked(path, **kwargs):
            if Path(path) == target:
                current = target.lstat()  # Metadata only; do not read the replacement to count it.
                reads.append((current.st_dev, current.st_ino))
            return real_read(path, **kwargs)
        draft = None
        with patch.object(u, 'read', side_effect=tracked):
            with self.assertRaisesRegex(RuntimeError, 'original identity differs'):
                draft = collect.capture(self.assets, self.digest)
        self.assertIsNone(draft)
        self.assertEqual(reads, [])
        self.assertEqual(self.events, [])
        self.assertEqual(self.observations, 0)
        self.assertEqual((retained.lstat().st_dev, retained.lstat().st_ino), (original['dev'], original['ino']))
        self.assertEqual(self.assets['reviewed.py'], original)

    def test_collector_replaced_inode_before_final_tree_is_never_read(self):
        target = self.code / 'reviewed.py'
        original = self.assets['reviewed.py'].copy()
        retained = self.work / 'retained-initial-capture-original.py'
        replaced = []
        def change(count):
            if count == 2:  # Both helpers have completed; final package tree has not run.
                target.rename(retained)
                u.new_file(target, b'# synthetic final-observation replacement, never read\n', original['mode'])
                replaced.append(target.lstat().st_ino)
        self.after_observation = change
        real_read, reads = u.read, []
        def tracked(path, **kwargs):
            if Path(path) == target:
                current = target.lstat()  # Classify by metadata; no replacement body is inspected.
                reads.append((current.st_dev, current.st_ino))
            return real_read(path, **kwargs)
        draft = None
        with patch.object(u, 'read', side_effect=tracked):
            with self.assertRaisesRegex(RuntimeError, 'original identity differs'):
                draft = collect.capture(self.assets, self.digest)
        self.assertIsNone(draft)
        self.assertEqual(len(replaced), 1)
        self.assertNotEqual(replaced[0], original['ino'])
        self.assertEqual(reads, [(original['dev'], original['ino'])])
        self.assertEqual(self.events, ['foreign', 'canonical'])
        self.assertEqual(self.observations, 2)
        self.assertEqual((retained.lstat().st_dev, retained.lstat().st_ino), (original['dev'], original['ino']))
        self.assertEqual(self.assets['reviewed.py'], original)

    def test_canonical_failure_never_uses_historical_idle(self):
        self.canonical_state = {'state': 'unavailable'}
        with self.assertRaisesRegex(RuntimeError, 'canonical inspection unavailable'):
            collect.capture(self.assets, self.digest)
        self.assertEqual(self.events, ['foreign', 'canonical'])

    def test_historical_unavailable_stays_distinct_in_draft(self):
        self.foreign_state = {'state': 'unavailable'}
        result = collect.capture(self.assets, self.digest)
        self.assertEqual(result['foreign'][str(self.foreign)]['observation'], {'state': 'unavailable'})
        self.assertEqual(result['window'], 'NOT_CONFIRMED')


if __name__ == '__main__':
    unittest.main()
