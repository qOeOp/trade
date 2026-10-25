"""If this fails, the public copy of a database is no longer pushed as it should be: the branch and
then its tags without force, checked against the remote's head; a remote changed elsewhere refused
with nothing pushed after it; concurrent publishes of one head serialized and all published, a
rejected push judged by the remote's head after a fetch; an isolated database kept off public
remotes; the `dolt login` key
installed in the service's own Dolt home, with a restart named while the service runs without it;
a command publishing what origin lacks; and the market
published only while no import holds its lock. Local file
remotes only, never DoltHub or the active ledger."""

from __future__ import annotations

import contextlib
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
from ledger import db, publish, strategies
from ledger.errors import Refusal
from tests.ledger.dolt import BINARY, SKIP, Service, source
from tests.market.dolt import TemporaryMarket


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
        for setting in (("user.name", "elsewhere"), ("user.email", "elsewhere@example.invalid")):
            subprocess.run([BINARY, "config", "--global", "--add", *setting], env=environment, check=True,
                           capture_output=True)
        subprocess.run([BINARY, "clone", self.url, str(home / "c")], env=environment, check=True, capture_output=True)
        return home / "c", environment

    def remote_state(self) -> tuple[str, list[str]]:
        copy, environment = self.clone()
        run = lambda *arguments: subprocess.run([BINARY, *arguments], cwd=copy, env=environment, check=True,  # noqa: E731
                                                capture_output=True, text=True).stdout
        head = run("sql", "-r", "csv", "-q", "SELECT hash FROM dolt_branches WHERE name = 'main'").split()[-1]
        return head, sorted(run("tag").split())

    def command(self, *argv) -> dict:
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertEqual(cli.main([*argv, "--ledger", "pub"]), 0)
        return json.loads(out.getvalue())

    def test_the_branch_then_its_tags_reach_the_remote_and_a_remote_changed_elsewhere_is_refused(self):
        self.assertEqual(self.code(publish.publish, self.profile, "main"), "REMOTE_UNSET")
        self.assertEqual(self.code(publish.set_remote, self.profile, "https://doltremoteapi.dolthub.com/a/b"),
                         "PUBLISH_FORBIDDEN", "an isolated database never publishes to a public remote")
        self.assertTrue(publish.set_remote(self.profile, self.url)["added"])
        self.assertFalse(publish.set_remote(self.profile, self.url)["added"])
        self.assertEqual(self.code(publish.set_remote, self.profile, self.url + "-other"), "REMOTE_MISMATCH")
        self.service.sql(self.profile, "CALL DOLT_TAG('line/first', 'main')")
        found = publish.publish(self.profile, "main")
        self.assertEqual((found["head"], found["previous_head"], found["tags"]), (self.head(), None, 1))
        self.assertEqual(self.remote_state(), (self.head(), ["line/first"]))
        self.assertFalse(publish.unpublished(self.profile, "main"))

        copy, environment = self.clone()
        for arguments in (("sql", "-q", "CREATE TABLE elsewhere (a INT PRIMARY KEY)"), ("commit", "-Am", "elsewhere"),
                          ("push", "origin", "main")):
            subprocess.run([BINARY, *arguments], cwd=copy, env=environment, check=True, capture_output=True)
        changed, _ = self.remote_state()
        strategies.publish_candidate(self.profile, source("later"), "later", "Fixture", "after the remote changed")
        self.service.sql(self.profile, "CALL DOLT_TAG('line/second', 'main')")
        self.assertEqual(self.code(publish.publish, self.profile, "main"), "PUBLISH_REJECTED")
        self.assertEqual(self.remote_state(), (changed, ["line/first"]), "nothing forced, no tag after the refusal")

    def test_concurrent_publishes_of_one_head_are_all_published(self):
        publish.set_remote(self.profile, self.url)
        for round in range(4):
            strategies.publish_candidate(self.profile, source(f"r{round}"), f"r{round}", "Fixture", "a write")
            barrier, outcomes = threading.Barrier(3), []

            def run():
                barrier.wait()
                try:
                    outcomes.append(publish.publish(self.profile, "main")["head"])
                except Refusal as exc:
                    outcomes.append(exc.code)
            threads = [threading.Thread(target=run) for _ in range(3)]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join()
            self.assertEqual(outcomes, [self.head()] * 3, "a publish that lost the race is not a divergence")
        self.assertEqual(self.remote_state(), (self.head(), []))

    def test_a_rejected_push_is_judged_by_the_remote_head(self):
        publish.set_remote(self.profile, self.url)
        published = publish.publish(self.profile, "main")["head"]
        strategies.publish_candidate(self.profile, source("later"), "later", "Fixture", "a write")
        self.service.sql(self.profile, "CALL DOLT_TAG('line/first', 'main')")
        push = publish._push

        def rejected(pushed: bool):
            def _push(cursor, profile, url, ref):
                if ref == "main":
                    if pushed:
                        push(cursor, profile, url, ref)
                    raise publish.refuse("PUBLISH_REJECTED", "lost a race")
                push(cursor, profile, url, ref)
            return _push
        with patch.object(publish, "_push", rejected(pushed=False)):
            code, message = self.code_and_message(publish.publish, self.profile, "main")
        self.assertEqual(code, "PUBLISH_FAILED", "a remote behind the local head is retried, not a divergence")
        self.assertIn(published, message)
        self.assertEqual(self.remote_state(), (published, []), "no tag after a failed branch")
        with patch.object(publish, "_push", rejected(pushed=True)):
            found = publish.publish(self.profile, "main")
        self.assertEqual((found["head"], found["tags"]), (self.head(), 1), "the remote already holds the head")
        self.assertEqual(self.remote_state(), (self.head(), ["line/first"]))

        holder = publish._admin(self.profile)
        self.addCleanup(holder.close)
        with holder.cursor() as cursor:
            cursor.execute("SELECT GET_LOCK(%s, 0)", (f"{self.profile.database}/publish",))
        with patch.object(publish, "PUBLISH_WAIT", 1):
            self.assertEqual(self.code(publish.publish, self.profile, "main"), "PUBLISH_FAILED",
                             "another publish holds the lock")

    def test_a_command_publishes_what_origin_lacks_once(self):
        publish.set_remote(self.profile, self.url)
        self.assertEqual(self.command("ledger", "sql", "SELECT 1")["published"]["previous_head"], None,
                         "a new origin lacks the whole history")
        self.assertNotIn("published", self.command("ledger", "sql", "SELECT 1"), "nothing left to publish")
        strategies.publish_candidate(self.profile, source("first"), "first", "Fixture", "a write")
        caught_up = self.command("ledger", "sql", "SELECT 1")
        self.assertEqual(caught_up["published"]["head"], self.head(), "the next command publishes an earlier write")
        self.assertNotIn("published", self.command("ledger", "sql", "SELECT 1"))
        strategies.publish_candidate(self.profile, source("second"), "second", "Fixture", "a write")
        with patch.object(publish, "_push", side_effect=publish.refuse("PUBLISH_FAILED", "offline")):
            failed = self.command("ledger", "sql", "SELECT 1")
        self.assertEqual(failed["publish_failed"]["code"], "PUBLISH_FAILED", "the command itself still succeeds")
        self.assertTrue(publish.unpublished(self.profile, "main"))
        self.assertEqual(self.command("ledger", "publish")["head"], self.head())

    def test_the_dolt_login_key_is_installed_in_the_service_home(self):
        user = Path(tempfile.mkdtemp(prefix="u-", dir="/tmp"))
        self.addCleanup(shutil.rmtree, user, True)
        (user / ".dolt" / "creds").mkdir(parents=True)
        (user / ".dolt" / "config_global.json").write_text(json.dumps({"user.creds": "k1"}), encoding="utf-8")
        (user / ".dolt" / "creds" / "k1.jwk").write_bytes(b'{"key": "fixture"}')
        home = Path(self.profile.service_root) / "home" / ".dolt"
        before = json.loads((home / "config_global.json").read_text(encoding="utf-8"))
        with patch.dict(os.environ, {"DOLT_ROOT_PATH": str(user)}):
            self.assertEqual(publish._install_key(self.profile), "k1")
        self.assertEqual((home / "creds" / "k1.jwk").read_bytes(), b'{"key": "fixture"}')
        self.assertEqual((home / "creds" / "k1.jwk").stat().st_mode & 0o777, 0o600)
        self.assertEqual(json.loads((home / "config_global.json").read_text(encoding="utf-8")),
                         {**before, "user.creds": "k1"}, "the service's own settings stay")
        with patch.dict(os.environ, {"DOLT_ROOT_PATH": str(user / "none")}):
            self.assertEqual(self.code(publish._install_key, self.profile), "DOLTHUB_CREDENTIALS")
        self.assertTrue(db.connect(self.profile, "reader").close() is None, "the service still serves")

        class Denied:
            def execute(self, *arguments):
                raise pymysql.err.OperationalError(1105, "rpc error: code = PermissionDenied desc = permission denied")
        failed = lambda: self.code_and_message(publish._push, Denied(), self.profile, self.url, "main")  # noqa: E731
        self.assertTrue(publish._key_after_start(self.profile), "the service started before the key")
        self.assertIn("ledger service stop", failed()[1])
        root = Path(self.profile.service_root)
        db.stop_service(root)
        time.sleep(0.01)
        db.start_service(root)
        self.assertFalse(publish._key_after_start(self.profile), "a restarted service has the key")
        self.assertEqual(failed()[0], "PUBLISH_FAILED")
        self.assertNotIn("ledger service stop", failed()[1])
        with patch.dict(os.environ, {"DOLT_ROOT_PATH": str(user)}):
            publish._install_key(self.profile)
        self.assertFalse(publish._key_after_start(self.profile), "an unchanged key is not installed again")


    def test_the_market_publishes_holding_its_import_lock(self):
        market = TemporaryMarket()
        self.addCleanup(market.close)
        found = cli.market_publish(market.profile, self.url)
        self.assertEqual(found["head"], market.admin(market.profile, "SELECT hash FROM dolt_branches WHERE name = 'main'")[0][0])
        conn = db._admin(db._service(Path(market.profile["service"])), database=market.profile["database"])
        self.addCleanup(conn.close)
        with conn.cursor() as cursor:
            cursor.execute("SELECT GET_LOCK(%s, 0)", (f"market-import:{market.profile['database']}",))
        self.assertEqual(self.code(cli.market_publish, market.profile, None), "CONCURRENT_IMPORT")


if __name__ == "__main__":
    unittest.main()
