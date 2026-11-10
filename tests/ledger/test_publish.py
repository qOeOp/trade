"""If this fails, the public copy of a database is no longer pushed as it should be: the branch without
force, checked against the remote's head (an emptied remote gets it again); a remote changed elsewhere
refused; concurrent publishes of one head serialized and all published, a
rejected push judged by the remote's head after a fetch, a remote that descends from the head read
before the push (another writer committed in between) published; an isolated database kept off public
remotes; the `dolt login` key
installed in the service's own Dolt home, with a restart named while the service runs without it;
a write command publishing what origin lacks, a read command publishing nothing; and the ledger service
publishing what a failed publish left behind with no further write, and saying how long and why it could not.
Local file remotes only, never DoltHub or the active ledger."""

from __future__ import annotations

import contextlib
import dataclasses
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

import pymysql

from cli import main as cli
from cli import service as ledger_service
from ledger import db, publish, strategies
from shared.errors import Refusal
from shared.refusals import refuse
from tests.ledger.dolt import BINARY, SKIP, Service, source


@unittest.skipUnless(BINARY, SKIP)
class PublishTests(unittest.TestCase):
    def setUp(self):
        self.service = Service()
        self.addCleanup(self.service.close)
        self.profile = self.service.ledger("pub")
        self.remote = Path(tempfile.mkdtemp(prefix="rm-", dir="/tmp"))
        self.addCleanup(shutil.rmtree, self.remote, True)
        self.url = self.remote.as_uri()

    def code(self, function, *arguments) -> str:
        with self.assertRaises(Refusal) as caught:
            function(*arguments)
        return caught.exception.code

    def code_and_message(self, function, *arguments) -> tuple[str, str]:
        with self.assertRaises(Refusal) as caught:
            function(*arguments)
        return caught.exception.code, caught.exception.message

    def head(self) -> str:
        return self.service.sql(self.profile, "SELECT hash FROM dolt_branches WHERE name = 'main'")[0][0]

    def clone(self) -> tuple[Path, dict]:
        home = Path(tempfile.mkdtemp(prefix="cl-", dir="/tmp"))
        self.addCleanup(shutil.rmtree, home, True)
        environment = {**os.environ, "DOLT_ROOT_PATH": str(home)}
        db.dolt_home(home, {"user.name": "elsewhere", "user.email": "elsewhere@example.invalid"})
        subprocess.run([BINARY, "clone", self.url, str(home / "c")], env=environment, check=True, capture_output=True)
        return home / "c", environment

    def remote_head(self) -> str:
        copy, environment = self.clone()
        return subprocess.run([BINARY, "sql", "-r", "csv", "-q", "SELECT hash FROM dolt_branches WHERE name = 'main'"],
                              cwd=copy, env=environment, check=True, capture_output=True, text=True).stdout.split()[-1]

    def command(self, *argv) -> dict:
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertEqual(cli.main([*argv, "--ledger", "pub"]), 0)
        return json.loads(out.getvalue())

    def test_the_branch_reaches_the_remote_and_a_remote_changed_elsewhere_is_refused(self):
        self.assertEqual(self.code(publish.publish, self.profile), "REMOTE_UNSET")
        self.assertEqual(self.code(publish.set_remote, self.profile, "https://doltremoteapi.dolthub.com/a/b"),
                         "PUBLISH_FORBIDDEN", "an isolated database never publishes to a public remote")
        self.assertTrue(publish.set_remote(self.profile, self.url)["added"])
        self.assertFalse(publish.set_remote(self.profile, self.url)["added"])
        self.assertEqual(self.code(publish.set_remote, self.profile, self.url + "-other"), "REMOTE_MISMATCH")
        first = publish.publish(self.profile)
        self.assertEqual((first["head"], first["previous_head"]), (self.head(), None))
        self.assertEqual(self.remote_head(), self.head())
        self.assertFalse(publish.unpublished(self.profile))
        strategies.publish_candidate(self.profile, source("held"), "held", "Fixture", "a write")
        self.assertTrue(publish.unpublished(self.profile))
        found = publish.publish(self.profile)
        self.assertEqual((found["head"], found["previous_head"]), (self.head(), first["head"]))
        self.assertEqual(self.remote_head(), self.head())

        copy, environment = self.clone()
        for arguments in (("sql", "-q", "CREATE TABLE elsewhere (a INT PRIMARY KEY)"), ("commit", "-Am", "elsewhere"),
                          ("push", "origin", "main")):
            subprocess.run([BINARY, *arguments], cwd=copy, env=environment, check=True, capture_output=True)
        changed = self.remote_head()
        strategies.publish_candidate(self.profile, source("later"), "later", "Fixture", "after the remote changed")
        self.assertEqual(self.code(publish.publish, self.profile), "PUBLISH_REJECTED")
        self.assertEqual(self.remote_head(), changed, "nothing forced")

    def test_a_first_origin_that_took_nothing_is_forgotten_and_a_good_one_stays(self):
        with patch.object(publish, "_push", side_effect=refuse("PUBLISH_FAILED", "the key cannot write")):
            self.assertEqual(self.code(publish.name_and_publish, self.profile, self.url + "-typo"), "PUBLISH_FAILED")
        published, named = publish.name_and_publish(self.profile, self.url)
        self.assertTrue(named["added"])
        self.assertIsNotNone(published["head"])
        self.assertEqual(self.code(publish.name_and_publish, self.profile, self.url + "-other"), "REMOTE_MISMATCH")
        with patch.object(publish, "publish", side_effect=refuse("PUBLISH_FAILED", "the network is down")):
            self.assertEqual(self.code(publish.name_and_publish, self.profile, self.url), "PUBLISH_FAILED")
        self.assertFalse(publish.set_remote(self.profile, self.url)["added"], "an origin that took the ledger stays")

    def test_an_emptied_remote_gets_the_branch_again(self):
        """The service's tracking head still names the published head after the remote was emptied elsewhere:
        the fetch that confirms it finds no branch, so the next publish pushes again."""
        publish.set_remote(self.profile, self.url)
        self.assertEqual(publish.publish(self.profile)["head"], self.head())
        shutil.rmtree(self.remote)
        self.remote.mkdir()
        found = publish.publish(self.profile)
        self.assertEqual((found["head"], found["previous_head"]), (self.head(), self.head()))
        self.assertEqual(self.remote_head(), self.head())

    def test_concurrent_publishes_of_one_head_are_all_published(self):
        publish.set_remote(self.profile, self.url)
        for round in range(4):
            strategies.publish_candidate(self.profile, source(f"r{round}"), f"r{round}", "Fixture", "a write")
            barrier, outcomes = threading.Barrier(3), []

            def run():
                barrier.wait()
                try:
                    outcomes.append(publish.publish(self.profile)["head"])
                except Refusal as exc:
                    outcomes.append(exc.code)
            threads = [threading.Thread(target=run) for _ in range(3)]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join()
            self.assertEqual(outcomes, [self.head()] * 3, "a publish that lost the race is not a divergence")
        self.assertEqual(self.remote_head(), self.head())

    def test_a_rejected_push_is_judged_by_the_remote_head(self):
        publish.set_remote(self.profile, self.url)
        published = publish.publish(self.profile)["head"]
        strategies.publish_candidate(self.profile, source("later"), "later", "Fixture", "a write")
        push = publish._push

        def rejected(pushed: bool):
            def _push(cursor, profile, url, ref):
                if pushed:
                    push(cursor, profile, url, ref)
                raise publish.refuse("PUBLISH_REJECTED", "lost a race")
            return _push
        with patch.object(publish, "_push", rejected(pushed=False)):
            code, message = self.code_and_message(publish.publish, self.profile)
        self.assertEqual(code, "PUBLISH_FAILED", "a remote behind the local head is retried, not a divergence")
        self.assertIn(published, message)
        self.assertEqual(self.remote_head(), published)
        with patch.object(publish, "_push", rejected(pushed=True)):
            found = publish.publish(self.profile)
        self.assertEqual(found["head"], self.head(), "the remote already holds the head")
        self.assertEqual(self.remote_head(), self.head())

        holder = publish._admin(self.profile)
        self.addCleanup(holder.close)
        with holder.cursor() as cursor:
            cursor.execute("SELECT GET_LOCK(%s, 0)", (f"{self.profile.database}/publish",))
        with patch.object(publish, "PUBLISH_WAIT", 1):
            self.assertEqual(self.code(publish.publish, self.profile), "PUBLISH_FAILED",
                             "another publish holds the lock")

    def test_a_remote_descending_from_the_head_read_before_the_push_is_published(self):
        """Another writer on the same service commits between the head read and the push: the push names
        the branch, so it carries both commits and the remote's head descends from the head read. That is
        a publish, whether or not the push was reported rejected."""
        publish.set_remote(self.profile, self.url)
        previous = publish.publish(self.profile)["head"]
        push = publish._push

        def interleaved(rejected: bool):
            def _push(cursor, profile, url, ref):
                strategies.publish_candidate(self.profile, source(f"theirs-{rejected}"), f"theirs-{rejected}",
                                             "Fixture", "another session's write before our push")
                push(cursor, profile, url, ref)
                if rejected:
                    raise publish.refuse("PUBLISH_REJECTED", "lost a race")
            return _push
        for rejected in (False, True):
            strategies.publish_candidate(self.profile, source(f"ours-{rejected}"), f"ours-{rejected}", "Fixture", "our write")
            read = self.head()
            with patch.object(publish, "_push", interleaved(rejected)):
                found = publish.publish(self.profile)
            self.assertNotEqual(self.head(), read, "the other write landed on the branch")
            self.assertEqual((found["head"], found["previous_head"]), (self.head(), previous),
                             "published, with the remote head that descends from the head read")
            self.assertEqual(self.remote_head(), self.head())
            self.assertFalse(publish.unpublished(self.profile))
            previous = found["head"]

    def write(self, tag: str) -> dict:
        """candidate publish through the command line: a ledger write."""
        folder = Path(tempfile.mkdtemp(prefix="src-", dir="/tmp"))
        self.addCleanup(shutil.rmtree, folder, True)
        (folder / "strategy.py").write_bytes(source(tag))
        return self.command("candidate", "publish", "--file", str(folder / "strategy.py"), "--strategy-id", tag,
                            "--entry-class", "Fixture", "--description", "a write")

    def test_a_reader_learns_where_the_ledger_is_published(self):
        def status():
            return self.command("ledger", "service", "status")

        self.assertEqual((status()["remote"], status()["unpublished"]), (None, False))
        publish.set_remote(self.profile, self.url)
        self.assertEqual((status()["remote"], status()["unpublished"]), (self.url, True), "nothing is on it yet")
        self.write("first")
        self.assertFalse(status()["unpublished"])
        with patch.object(publish, "_push", side_effect=publish.refuse("PUBLISH_FAILED", "offline")):
            self.assertIn("publish_failed", self.write("second"))
        self.assertTrue(status()["unpublished"], "a failed publish stays visible")
        self.write("third")
        self.assertFalse(status()["unpublished"], "the next write publishes it")

    def test_the_service_publishes_what_a_failed_publish_left_with_no_further_write(self):
        publish.set_remote(self.profile, self.url)
        self.write("first")
        offline = publish.refuse("PUBLISH_FAILED", "offline")
        with patch.object(publish, "_push", side_effect=offline):
            self.assertIn("publish_failed", self.write("second"))
        behind = publish.state(self.profile)
        self.assertEqual((behind["unpublished"], behind["diverged"]), (True, False))
        self.assertLess(behind["behind_seconds"], 300, "the age of the commit origin lacks")
        self.assertNotEqual(self.remote_head(), self.head())

        stop = threading.Event()
        with patch.object(db, "load_profile", return_value=self.profile), \
                patch.object(ledger_service, "PUBLISH_RETRY", 0.05), \
                patch.object(publish, "_push", wraps=publish._push) as pushed:
            pushed.side_effect = offline
            keeper = threading.Thread(target=ledger_service._keep_published, args=(stop,), daemon=True)
            keeper.start()
            self.addCleanup(keeper.join, 30)
            self.addCleanup(stop.set)
            while pushed.call_count < 2:  # a failing round does not end the loop
                time.sleep(0.02)
            self.assertTrue(publish.unpublished(self.profile))
            pushed.side_effect = None
            deadline = time.monotonic() + 30
            while publish.unpublished(self.profile) and time.monotonic() < deadline:
                time.sleep(0.05)
            stop.set()
            keeper.join(30)
        self.assertEqual(self.remote_head(), self.head(), "published by no write at all")
        current = publish.state(self.profile)
        self.assertEqual((current["unpublished"], current["behind_seconds"], current["diverged"]), (False, None, False))

    def test_a_read_only_copy_is_never_published_by_the_service(self):
        publish.set_remote(self.profile, self.url)
        with patch.object(db, "load_profile", return_value=dataclasses.replace(self.profile, kind=None)), \
                patch.object(publish, "publish") as published:
            ledger_service._publish_if_behind()
        published.assert_not_called()

    def test_a_remote_changed_elsewhere_is_diverged_not_merely_behind(self):
        publish.set_remote(self.profile, self.url)
        self.write("first")
        copy, environment = self.clone()
        for arguments in (("sql", "-q", "CREATE TABLE elsewhere (a INT PRIMARY KEY)"), ("commit", "-Am", "elsewhere"),
                          ("push", "origin", "main")):
            subprocess.run([BINARY, *arguments], cwd=copy, env=environment, check=True, capture_output=True)
        self.assertEqual(self.write("second")["publish_failed"]["code"], "PUBLISH_REJECTED")
        found = publish.state(self.profile)
        self.assertEqual((found["unpublished"], found["behind_seconds"], found["diverged"]), (True, None, True))

    def test_a_write_publishes_what_origin_lacks_once_and_a_read_never_publishes(self):
        publish.set_remote(self.profile, self.url)
        for read in (("ledger", "sql", "SELECT 1"), ("candidate", "list"), ("research", "status")):
            found = self.command(*read)
            self.assertFalse({"published", "publish_failed"} & set(found), f"{read[:2]} only reads")
        self.assertTrue(publish.unpublished(self.profile), "a read leaves origin behind")
        self.assertEqual(self.write("first")["published"]["previous_head"], None,
                         "a new origin lacks the whole history")
        self.assertEqual(self.remote_head(), self.head())
        strategies.publish_candidate(self.profile, source("second"), "second", "Fixture", "a write")
        self.assertNotIn("published", self.command("ledger", "sql", "SELECT 1"), "a read never publishes")
        with patch.object(publish, "_push", side_effect=publish.refuse("PUBLISH_FAILED", "offline")):
            failed = self.write("third")
        self.assertEqual(failed["publish_failed"]["code"], "PUBLISH_FAILED", "the command itself still succeeds")
        self.assertTrue(publish.unpublished(self.profile))
        caught_up = self.write("fourth")
        self.assertEqual(caught_up["published"]["head"], self.head(), "the next write publishes earlier writes")
        self.assertEqual(self.remote_head(), self.head())
        strategies.publish_candidate(self.profile, source("fifth"), "fifth", "Fixture", "a write")
        self.assertEqual(self.command("ledger", "publish")["head"], self.head())

    def test_the_dolt_login_key_is_installed_in_the_service_home(self):
        user = Path(tempfile.mkdtemp(prefix="u-", dir="/tmp"))
        self.addCleanup(shutil.rmtree, user, True)
        (user / ".dolt" / "creds").mkdir(parents=True)
        (user / ".dolt" / "config_global.json").write_text(json.dumps({"user.creds": "k1"}), encoding="utf-8")
        (user / ".dolt" / "creds" / "k1.jwk").write_bytes(b'{"key": "fixture"}')
        home = Path(self.profile.service_root) / "home" / ".dolt"
        before = json.loads((home / "config_global.json").read_text(encoding="utf-8"))
        service = Path(self.profile.service_root)
        self.assertEqual(publish.install_key(service, user / ".dolt"), ("k1", True))
        self.assertEqual((home / "creds" / "k1.jwk").read_bytes(), b'{"key": "fixture"}')
        self.assertEqual((home / "creds" / "k1.jwk").stat().st_mode & 0o777, 0o600)
        self.assertEqual(json.loads((home / "config_global.json").read_text(encoding="utf-8")),
                         {**before, "user.creds": "k1"}, "the service's own settings stay")
        self.assertEqual(self.code(publish.install_key, service, user / "none" / ".dolt"), "DOLTHUB_CREDENTIALS")
        self.assertTrue(db.connect(self.profile, "reader").close() is None, "the service still serves")

        class Denied:
            def execute(self, *arguments):
                raise pymysql.err.OperationalError(1105, "rpc error: code = PermissionDenied desc = permission denied")
        failed = lambda: self.code_and_message(publish._push, Denied(), self.profile, self.url, "main")
        self.assertTrue(publish._key_after_start(self.profile), "the service started before the key")
        self.assertIn("ledger service stop", failed()[1])
        self.assertIn("must be able to write", failed()[1])

        class Offline:
            def execute(self, *arguments):
                raise pymysql.err.OperationalError(1105, "connection refused")
        self.assertNotIn("must be able to write", self.code_and_message(publish._push, Offline(), self.profile, self.url, "main")[1])
        root = Path(self.profile.service_root)
        db.stop_service(root)
        time.sleep(0.01)
        db.start_service(root)
        self.assertFalse(publish._key_after_start(self.profile), "a restarted service has the key")
        self.assertEqual(failed()[0], "PUBLISH_FAILED")
        self.assertNotIn("ledger service stop", failed()[1])
        publish.install_key(service, user / ".dolt")
        self.assertFalse(publish._key_after_start(self.profile), "an unchanged key is not installed again")


if __name__ == "__main__":
    unittest.main()
