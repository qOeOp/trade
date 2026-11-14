"""Original file locks are real; Docker, CI and account inspection remain isolated stand-ins."""

from contextlib import redirect_stderr, redirect_stdout
import fcntl
import io
import os
from pathlib import Path
import runpy
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

from deploy.live_host import AccountLockBusy, AccountLockWaitExpired, LiveBusy
from deploy.release import Release, failure_summary, report_failure
from deploy.release_host import AGENT, WEB, Config, DockerHost
from live import state
from tests.deploy.test_live_release import PairHost, PairLive, PAIR, SERVICE
from tests.deploy.test_release import A, B, C, D


class Clock:
    def __init__(self):
        self.now = 100.0
        self.sleeps = []
        self.after_sleep = lambda: None

    def monotonic(self):
        return self.now

    def sleep(self, seconds):
        self.sleeps.append(seconds)
        self.now += seconds
        self.after_sleep()


class LiveLockWaitTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.host = PairHost(Path(temporary.name).resolve())
        self.source = Mock()
        self.source.agent_changed.return_value = False
        self.live = PairLive(self.host, self.source)
        self.release = Release(self.host, self.source, live=self.live)
        self.reader = None
        self.addCleanup(self.release_reader)
        self.clock = Clock()
        self.output, self.errors = io.StringIO(), io.StringIO()
        self.enterContext(redirect_stdout(self.output))
        self.enterContext(redirect_stderr(self.errors))

    def fake_clock(self):
        self.enterContext(patch("deploy.live_host.time.monotonic", self.clock.monotonic))
        self.enterContext(patch("deploy.live_host.time.sleep", self.clock.sleep))

    def hold_reader(self, *, exclusive=False):
        self.reader = (state.serialized if exclusive else state.reading)(self.host.lock.parent)
        self.reader.__enter__()

    def release_reader(self):
        if self.reader is not None:
            self.reader.__exit__(None, None, None)
            self.reader = None

    def ready_barrier(self):
        self.live.prepare(A, PAIR)
        return self.live.barrier(WEB + B, SERVICE, idle=True, wait_for_lock=True)

    def durable_routes(self, name):
        # The production writer has no extra lock assertion. Exercise its actual replace/fsync,
        # rather than letting PairHost.persist_route detect the defect before metadata is written.
        def persist(route):
            DockerHost.persist_route(self.host, route)
            self.host.disk = route

        self.host.persist_route = persist
        self.host.routes, self.host.ROUTE_MODE = self.host.state / "router", None
        self.host.write_route = lambda file, config: DockerHost.write_route(self.host, file, config)
        self.host.disk_config = lambda: DockerHost.disk_config(self.host)
        self.host.disk_route = lambda: DockerHost.disk_route(self.host)
        persist(name)

    def replace_lock(self):
        self.host.lock.rename(self.host.lock.with_name("original.lock"))
        self.host.lock.touch(mode=0o600)

    def replace_root_reusing_lock(self):
        root = self.host.lock.parent
        original = root.with_name("original-custody")
        root.rename(original)
        root.mkdir(mode=0o700)
        (original / "account.lock").rename(self.host.lock)

    def replace_during_locked_protection_check(self, replace):
        ensure = self.host.ensure_protected
        changed = []

        def check(before):
            ensure(before)
            descriptor = os.open(self.host.lock, os.O_RDONLY)
            try:
                try:
                    fcntl.flock(descriptor, fcntl.LOCK_SH | fcntl.LOCK_NB)
                except BlockingIOError:
                    replace()
                    changed.append(True)
            finally:
                os.close(descriptor)

        self.host.ensure_protected = check
        return changed

    def test_initial_shared_lock_defers_without_waiting_or_recording_failure(self):
        self.fake_clock()
        self.hold_reader()
        self.release.apply(PAIR)
        self.assertEqual(self.clock.sleeps, [])
        self.assertEqual(self.live.created, [])
        self.assertFalse(self.release.transaction.exists())
        self.assertFalse(self.release.failed.exists())
        self.assertNotIn(WEB + B, self.live.configs, "a held lock is answered before the candidate is prepared")
        self.live.prepare(A, PAIR)
        with self.assertRaises(AccountLockBusy):
            with self.live.barrier(WEB + B, SERVICE):
                self.fail("default barrier waited or acquired a held lock")

    def test_short_shared_read_waits_then_commits_without_recovery(self):
        self.fake_clock()
        self.host.on_observe = self.hold_reader
        self.clock.after_sleep = self.release_reader
        inspections = []
        self.host.inspect_hook = lambda: inspections.append(self.clock.now)
        with patch.object(self.release, "recover", wraps=self.release.recover) as recover:
            self.release.apply(PAIR)
        recover.assert_not_called()
        self.assertEqual(self.clock.sleeps, [.1])
        self.assertEqual(len(inspections), 3)  # the owner's, the candidate's, the final admission's
        self.assertEqual((self.host.disk, self.host.live), (WEB + B, WEB + B))
        self.assertFalse(self.release.transaction.exists())
        self.assertFalse(self.release.failed.exists())

    def test_short_serialized_maintenance_also_allows_commit_after_release(self):
        self.fake_clock()
        self.host.on_observe = lambda: self.hold_reader(exclusive=True)
        self.clock.after_sleep = self.release_reader
        self.release.apply(PAIR)
        self.assertEqual(self.clock.sleeps, [.1])
        self.assertEqual(self.host.disk, WEB + B)

    def test_fresh_native_admission_after_wait_still_refuses_busy_or_unknown(self):
        for status in ("busy", "unavailable"):
            with self.subTest(status=status):
                self.live.prepare(A, PAIR)
                self.hold_reader()
                self.clock.after_sleep = lambda: (self.release_reader(), setattr(self.host, "idle", status))
                with patch("deploy.live_host.time.monotonic", self.clock.monotonic), \
                        patch("deploy.live_host.time.sleep", self.clock.sleep), self.assertRaises(LiveBusy):
                    with self.live.barrier(WEB + B, SERVICE, idle=True, wait_for_lock=True):
                        self.fail("waiting was treated as native idle")
                self.release_reader()

    def test_wait_has_one_deadline_and_no_acquisition_or_inspection_after_expiry(self):
        self.fake_clock()
        self.hold_reader()
        inspections = []
        self.host.inspect_hook = lambda: inspections.append(True)
        attempts = []
        flock = fcntl.flock

        def observed_flock(*args):
            attempts.append(self.clock.now)
            return flock(*args)

        with patch("deploy.live_host.fcntl.flock", observed_flock), self.assertRaises(AccountLockWaitExpired):
            with self.ready_barrier():
                self.fail("expired barrier entered")
        self.assertAlmostEqual(self.clock.now, 130.0)
        self.assertAlmostEqual(sum(self.clock.sleeps), 30.0)
        self.assertTrue(all(0 < value <= .1 for value in self.clock.sleeps))
        self.assertTrue(attempts and all(value < 130.0 for value in attempts))
        self.assertEqual(inspections, [])

    def test_final_and_recovery_expiry_keep_transaction_until_later_recovery(self):
        self.fake_clock()
        self.host.on_observe = self.hold_reader
        inspections = []
        self.host.inspect_hook = lambda: inspections.append(True)
        with self.assertRaises(AccountLockWaitExpired):
            self.release.apply(PAIR)
        self.assertAlmostEqual(self.clock.now, 160.0)
        self.assertEqual(inspections, [True, True])  # the owner's and the candidate's; none after expiry
        self.assertTrue(self.release.transaction.exists())
        self.assertFalse(self.release.failed.exists())
        self.assertTrue(self.host.containers[WEB + B])
        self.assertEqual((self.host.disk, self.host.live), (WEB + A, WEB + A))
        diagnostic = self.errors.getvalue()
        self.assertIn("Primary Web release failure: account lock wait expired", diagnostic)
        self.assertIn("Web release recovery failure: account lock wait expired", diagnostic)
        self.release_reader()
        self.release.recover()
        self.assertFalse(self.release.transaction.exists())
        self.assertTrue(self.release.failed.joinpath(B).exists())

    def test_recovery_waits_for_reader_without_requiring_native_idle(self):
        self.fake_clock()
        self.live.prepare(A, PAIR)
        self.release.journal(WEB + B, WEB + A)
        self.host.live = WEB + B
        self.host.idle = "busy"
        self.host.inspect_hook = Mock(side_effect=AssertionError("recovery must not inspect idle"))
        self.hold_reader()
        self.clock.after_sleep = self.release_reader
        self.release.recover()
        self.host.inspect_hook.assert_not_called()
        self.assertEqual(self.clock.sleeps, [.1])
        self.assertEqual((self.host.disk, self.host.live), (WEB + A, WEB + A))
        self.assertTrue(self.release.failed.joinpath(B).exists())

    def test_replaced_lock_is_not_reopened_after_wait(self):
        self.fake_clock()
        self.hold_reader()
        inode = self.host.lock.stat().st_ino

        def replace():
            self.host.lock.rename(self.host.lock.with_name("original.lock"))
            self.host.lock.touch(mode=0o600)

        self.clock.after_sleep = replace
        with self.assertRaisesRegex(RuntimeError, "lock identity changed"):
            with self.ready_barrier():
                self.fail("replacement inode accepted")
        self.assertNotEqual(self.host.lock.stat().st_ino, inode)
        self.assertEqual(self.clock.sleeps, [.1])

    def test_lock_permissions_are_rechecked_after_wait(self):
        self.fake_clock()
        self.hold_reader()
        self.clock.after_sleep = lambda: self.host.lock.chmod(0o644)
        with self.assertRaisesRegex(RuntimeError, "original private account lock"):
            with self.ready_barrier():
                self.fail("changed permissions accepted")
        self.assertEqual(self.clock.sleeps, [.1])

    def test_root_symlink_change_is_not_followed_during_wait(self):
        self.fake_clock()
        self.hold_reader()

        def redirect():
            root = self.host.lock.parent
            renamed = root.with_name("original-custody")
            root.rename(renamed)
            root.symlink_to(renamed, target_is_directory=True)

        self.clock.after_sleep = redirect
        with self.assertRaisesRegex(RuntimeError, "custody path changed"):
            with self.ready_barrier():
                self.fail("changed root accepted")

    def test_wait_rejects_replaced_root_even_when_original_lock_inode_is_reused(self):
        self.fake_clock()
        self.hold_reader()
        original_root = self.host.lock.parent.stat()
        original_lock = self.host.lock.stat()
        self.host.inspect_hook = Mock(side_effect=AssertionError("changed custody reached idle inspector"))

        def replace():
            self.replace_root_reusing_lock()
            self.release_reader()

        self.clock.after_sleep = replace
        with self.assertRaisesRegex(RuntimeError, "custody path changed"):
            with self.ready_barrier():
                self.fail("original lock in replacement root accepted")
        current_root, current_lock = self.host.lock.parent.stat(), self.host.lock.stat()
        self.assertNotEqual((original_root.st_dev, original_root.st_ino),
                            (current_root.st_dev, current_root.st_ino))
        self.assertEqual((original_lock.st_dev, original_lock.st_ino),
                         (current_lock.st_dev, current_lock.st_ino))
        self.assertEqual(self.clock.sleeps, [.1])
        self.host.inspect_hook.assert_not_called()

    def check_final_identity_change(self, replace, reason):
        self.durable_routes(WEB + A)
        route = self.host.state / "router/active.json"
        original = route.read_bytes()
        changed = self.replace_during_locked_protection_check(replace)
        # Isolate final admission from its subsequent recovery: no final metadata may commit.
        with patch.object(self.release, "recover") as recover, \
                patch.object(self.host, "persist_route", wraps=self.host.persist_route) as persist, \
                self.assertRaisesRegex(RuntimeError, reason):
            self.release.apply(PAIR)
        self.assertEqual(changed, [True])
        recover.assert_called_once_with()
        persist.assert_not_called()
        self.assertEqual(route.read_bytes(), original)
        self.assertEqual(self.host.disk_route(), WEB + A)
        self.assertTrue(self.release.transaction.exists())
        self.assertFalse(self.release.failed.exists())

    def test_final_lock_change_after_last_external_check_preserves_metadata(self):
        self.check_final_identity_change(self.replace_lock, "lock identity changed")

    def test_final_root_change_with_same_lock_preserves_metadata(self):
        self.check_final_identity_change(self.replace_root_reusing_lock, "custody path changed")

    def check_recovery_identity_change(self, replace, reason):
        self.live.prepare(A, PAIR)
        self.release.journal(WEB + B, WEB + A)
        self.durable_routes(WEB + B)
        self.host.live = WEB + B
        self.host.idle = "busy"
        self.host.inspect_hook = Mock(side_effect=AssertionError("recovery must not inspect idle"))
        route = self.host.state / "router/active.json"
        original_route, original_transaction = route.read_bytes(), self.release.transaction.read_bytes()
        changed = self.replace_during_locked_protection_check(replace)
        with patch.object(self.host, "persist_route", wraps=self.host.persist_route) as persist, \
                self.assertRaisesRegex(RuntimeError, reason):
            self.release.recover()
        self.assertEqual(changed, [True])
        persist.assert_not_called()
        self.host.inspect_hook.assert_not_called()
        self.assertEqual(route.read_bytes(), original_route)
        self.assertEqual(self.host.disk_route(), WEB + B)
        self.assertEqual(self.release.transaction.read_bytes(), original_transaction)
        self.assertFalse(self.release.failed.exists())

    def test_recovery_lock_change_after_last_external_check_preserves_metadata(self):
        self.check_recovery_identity_change(self.replace_lock, "lock identity changed")

    def test_recovery_root_change_with_same_lock_preserves_metadata(self):
        self.check_recovery_identity_change(self.replace_root_reusing_lock, "custody path changed")

    def test_wait_does_not_retry_unrelated_flock_errors(self):
        self.fake_clock()
        with patch("deploy.live_host.fcntl.flock", side_effect=PermissionError("private fixture")), \
                self.assertRaises(PermissionError):
            with self.ready_barrier():
                self.fail("unexpected flock error ignored")
        self.assertEqual(self.clock.sleeps, [])

    def test_ci_withdrawal_during_wait_is_rechecked_before_commit(self):
        self.fake_clock()
        self.host.on_observe = self.hold_reader

        def withdraw():
            self.release_reader()
            self.source.ensure.side_effect = RuntimeError("CI eligibility was withdrawn or superseded during preparation")

        self.clock.after_sleep = withdraw
        with self.assertRaisesRegex(RuntimeError, "CI eligibility"):
            self.release.apply(PAIR)
        self.assertEqual((self.host.disk, self.host.live), (WEB + A, WEB + A))
        self.assertIn("Primary Web release failure: CI eligibility changed", self.errors.getvalue())

    def test_agent_change_during_wait_is_not_committed_or_undone(self):
        self.fake_clock()
        self.host.on_observe = self.hold_reader

        def change():
            self.release_reader()
            self.host.containers[AGENT + D] = False
            self.host.containers[AGENT + C] = True

        self.clock.after_sleep = change
        with self.assertRaisesRegex(RuntimeError, "Agent changed"):
            self.release.apply(PAIR)
        self.assertEqual(self.host.disk, WEB + A)
        self.assertEqual(self.host.agent(), AGENT + C)

    def test_protected_change_during_wait_is_rechecked_before_commit(self):
        self.fake_clock()
        self.host.on_observe = self.hold_reader

        def change():
            self.release_reader()
            self.host.protected_identity["paper-worker"]["id"] = "independent-replacement"

        self.clock.after_sleep = change
        with self.assertRaises(AssertionError):
            self.release.apply(PAIR)
        self.assertEqual(self.host.disk, WEB + A)
        self.assertEqual(self.host.protected_identity["paper-worker"]["id"], "independent-replacement")

    def test_independent_route_during_wait_is_preserved(self):
        self.fake_clock()
        self.host.on_observe = self.hold_reader
        self.clock.after_sleep = lambda: (self.release_reader(), setattr(self.host, "live", WEB + C))
        with self.assertRaisesRegex(RuntimeError, "independent change"):
            self.release.apply(PAIR)
        self.assertEqual(self.host.live, WEB + C)
        self.assertTrue(self.release.transaction.exists())

    def test_health_probes_never_hold_the_exclusive_account_lock(self):
        def assert_health_unlocked(*args, **kwargs):
            descriptor = os.open(self.host.lock, os.O_RDONLY)
            try:
                fcntl.flock(descriptor, fcntl.LOCK_SH | fcntl.LOCK_NB)
            finally:
                os.close(descriptor)

        self.host.health = Mock(side_effect=assert_health_unlocked)
        self.live.health = self.live.warm = Mock(side_effect=assert_health_unlocked)
        self.release.apply(PAIR)
        self.host.on_observe = lambda: setattr(self.host, "idle", "busy")
        with self.assertRaises(LiveBusy):
            self.release.apply({**PAIR, "revision": C})
        self.live.health.assert_called()
        self.host.health.assert_called()

    def test_real_short_shared_flock_release_allows_original_barrier_to_continue(self):
        code = ("import fcntl,os,sys,time; f=os.open(sys.argv[1],os.O_RDONLY);"
                "fcntl.flock(f,fcntl.LOCK_SH); print('held',flush=True);"
                "sys.stdin.readline();time.sleep(.15);os.close(f);print('released',flush=True)")
        child = subprocess.Popen([sys.executable, "-c", code, str(self.host.lock)],
                                 stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
        self.assertEqual(child.stdout.readline().strip(), "held")
        child.stdin.write("release\n")
        child.stdin.flush()
        with self.ready_barrier():
            self.host.assert_locked()
        self.assertEqual(child.communicate(timeout=5)[0].strip(), "released")
        self.assertEqual(child.returncode, 0)


class ReleaseDiagnosticTests(unittest.TestCase):
    def test_primary_cause_is_written_before_recovery_error(self):
        with tempfile.TemporaryDirectory() as directory:
            host = PairHost(Path(directory).resolve())
            source = Mock()
            source.agent_changed.return_value = False
            live = PairLive(host, source)
            release = Release(host, source, live=live)
            def reject():
                raise RuntimeError("CI eligibility was withdrawn or superseded during preparation")
            host.on_observe = reject
            output = io.StringIO()
            with redirect_stdout(io.StringIO()), redirect_stderr(output), \
                    patch.object(release, "_recover", side_effect=AccountLockWaitExpired("fake secret")), \
                    self.assertRaises(AccountLockWaitExpired):
                release.apply(PAIR)
            self.assertEqual(output.getvalue().splitlines(), [
                "Primary Web release failure: CI eligibility changed",
                "Web release recovery failure: account lock wait expired",
            ])
            self.assertTrue(release.transaction.exists())

    def test_fixed_summaries_never_render_exception_payloads_or_unknown_phase(self):
        secret = "fake-key-secret /private/credential.json --command response-body"
        class MustNotRender:
            def __str__(self):
                raise AssertionError("exception payload rendered")
        class Unknown(RuntimeError):
            def __str__(self):
                raise AssertionError("exception subclass rendered")
        errors = [RuntimeError(secret), RuntimeError(MustNotRender()), Unknown(),
                  subprocess.TimeoutExpired(secret, 30, output=secret, stderr=secret),
                  subprocess.CalledProcessError(1, secret, output=secret, stderr=secret),
                  OSError(1, secret, secret), ValueError(secret), Exception(secret),
                  AccountLockBusy(secret), AccountLockWaitExpired(secret)]
        output = io.StringIO()
        with redirect_stderr(output):
            for error in errors:
                report_failure(secret, error)
        self.assertNotIn(secret, output.getvalue())
        self.assertEqual(len(output.getvalue().splitlines()), len(errors))
        self.assertTrue(failure_summary(Unknown()).startswith("unexpected release failure ("))

    def test_unclassified_failure_names_its_class_and_source_line_without_payload(self):
        secret = "fake-key-secret /private/credential.json"
        def fail():
            raise RuntimeError(secret)
        try:
            fail()
        except RuntimeError as error:
            summary = failure_summary(error)
        line = fail.__code__.co_firstlineno + 1
        self.assertEqual(summary, f"unclassified runtime failure (RuntimeError at tests/deploy/test_live_lock_wait.py:{line})")
        self.assertNotIn(secret, summary)
        self.assertEqual(failure_summary(KeyError(secret)), "release metadata unavailable")

    def test_a_protected_container_change_is_named_without_its_container(self):
        error = RuntimeError("protected container changed during release: trade-ide-ledger-1")
        self.assertEqual(failure_summary(error), "protected container changed")

    def test_closed_diagnostic_stream_does_not_raise_over_original_failure(self):
        closed = io.StringIO()
        closed.close()
        with redirect_stderr(closed):
            report_failure("primary", RuntimeError("private exception payload"))

    def test_top_level_command_does_not_repeat_raw_exception(self):
        secret = "fake-key-secret /private/path command-output"
        output = io.StringIO()
        with patch.object(sys, "argv", ["deploy.release", "tick"]), \
                patch("deploy.release_host.Config.installed", return_value=Config()), \
                patch("deploy.release_host.DockerHost", side_effect=RuntimeError(secret)), \
                redirect_stderr(output), self.assertRaises(SystemExit) as raised:
            runpy.run_module("deploy.release", run_name="__main__")
        self.assertEqual(raised.exception.code, 1)
        self.assertNotIn(secret, output.getvalue())
        self.assertIn("Release tick failed: unclassified runtime failure", output.getvalue())
