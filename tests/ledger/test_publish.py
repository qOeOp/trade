"""If this fails, the public copy of a database is no longer pushed as it should be: the branch and
then its tags without force, checked against the remote's head; a remote changed elsewhere refused
with nothing pushed after it; an isolated database kept off public remotes; the `dolt login` key
installed in the service's own Dolt home; a command publishing what origin lacks; and the market
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
import unittest
from unittest.mock import patch

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
