"""If this fails, the public copy of a database is no longer pushed as it should be: the branch without
force, checked against the remote's head (an emptied remote gets it again); a remote changed elsewhere
refused; concurrent publishes of one head serialized and all published, a
rejected push judged by the remote's head after a fetch, a remote that descends from the head read
before the push (another writer committed in between) published; an isolated database kept off public
remotes; the `dolt login` key
installed in the service's own Dolt home, with a restart named while the service runs without it;
no command publishing (a write only commits locally) while `ledger publish` publishes at once; and the ledger
service publishing what writes left behind, through failed rounds, and saying how long and why it could not.
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
import threading
import time
import unittest
from unittest.mock import patch

import pymysql

from cli import main as cli
from ledger import db, publish, server, strategies
from ledger import service as ledger_service
from shared.errors import Refusal
from shared.refusals import refuse
from tests.ledger.dolt import BINARY, SKIP, Service, source
from tests.helpers import refused, tempdir


@unittest.skipUnless(BINARY, SKIP)
class PublishTests(unittest.TestCase):
    def setUp(self):
        self.service = Service()
        self.addCleanup(self.service.close)
        self.profile = self.service.ledger("pub")
        self.remote = tempdir(self.addCleanup, prefix="rm-", dir="/tmp")
        self.url = self.remote.as_uri()

    def code_and_message(self, function, *arguments) -> tuple[str, str]:
        caught = refused(lambda: function(*arguments))
        return caught.code, caught.message

    def head(self) -> str:
        return self.service.sql(self.profile, "SELECT hash FROM dolt_branches WHERE name = 'main'")[0][0]

    def clone(self) -> tuple[Path, dict]:
        home = tempdir(self.addCleanup, prefix="cl-", dir="/tmp")
        environment = {**os.environ, "DOLT_ROOT_PATH": str(home)}
        server.dolt_home(home, {"user.name": "elsewhere", "user.email": "elsewhere@example.invalid"})
        subprocess.run([BINARY, "clone", "--branch", db.BRANCH, self.url, str(home / "c")], env=environment, check=True,
                       capture_output=True)
        return home / "c", environment

    def remote_head(self) -> str:
        copy, environment = self.clone()
        return subprocess.run([BINARY, "sql", "-r", "csv", "-q", f"SELECT hash FROM dolt_branches WHERE name = '{db.BRANCH}'"],
                              cwd=copy, env=environment, check=True, capture_output=True, text=True).stdout.split()[-1]

    def command(self, *argv) -> dict:
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertEqual(cli.main([*argv, "--ledger", "pub"]), 0)
        return json.loads(out.getvalue())

    def test_the_branch_reaches_the_remote_and_a_remote_changed_elsewhere_is_refused(self):
        self.assertEqual(refused(publish.publish, self.profile).code, "REMOTE_UNSET")
        self.assertEqual(refused(publish.set_remote, self.profile, "https://doltremoteapi.dolthub.com/a/b").code,
                         "PUBLISH_FORBIDDEN", "an isolated database never publishes to a public remote")
        self.assertTrue(publish.set_remote(self.profile, self.url)["added"])
        self.assertFalse(publish.set_remote(self.profile, self.url)["added"])
        self.assertEqual(refused(publish.set_remote, self.profile, self.url + "-other").code, "REMOTE_MISMATCH")
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
                          ("push", "origin", db.BRANCH)):
            subprocess.run([BINARY, *arguments], cwd=copy, env=environment, check=True, capture_output=True)
        changed = self.remote_head()
        strategies.publish_candidate(self.profile, source("later"), "later", "Fixture", "after the remote changed")
        self.assertEqual(refused(publish.publish, self.profile).code, "PUBLISH_REJECTED")
        self.assertEqual(self.remote_head(), changed, "nothing forced")

    def test_a_first_origin_that_took_nothing_is_forgotten_and_a_good_one_stays(self):
        with patch.object(publish, "_push", side_effect=refuse("PUBLISH_FAILED", "the key cannot write")):
            self.assertEqual(refused(publish.name_and_publish, self.profile, self.url + "-typo").code, "PUBLISH_FAILED")
        published, named = publish.name_and_publish(self.profile, self.url)
        self.assertTrue(named["added"])
        self.assertIsNotNone(published["head"])
        self.assertEqual(refused(publish.name_and_publish, self.profile, self.url + "-other").code, "REMOTE_MISMATCH")
        with patch.object(publish, "publish", side_effect=refuse("PUBLISH_FAILED", "the network is down")):
            self.assertEqual(refused(publish.name_and_publish, self.profile, self.url).code, "PUBLISH_FAILED")
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

        holder = server.admin(self.profile)
        self.addCleanup(holder.close)
        with holder.cursor() as cursor:
            cursor.execute("SELECT GET_LOCK(%s, 0)", (f"{self.profile.database}/publish",))
        with patch.object(publish, "PUBLISH_WAIT", 1):
            self.assertEqual(refused(publish.publish, self.profile).code, "PUBLISH_FAILED",
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
        folder = tempdir(self.addCleanup, prefix="src-", dir="/tmp")
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
        self.assertTrue(status()["unpublished"], "a write leaves origin behind")
        with patch.object(publish, "_push", side_effect=publish.refuse("PUBLISH_FAILED", "offline")):
            self.assertEqual(refused(publish.publish, self.profile).code, "PUBLISH_FAILED")
        self.assertTrue(status()["unpublished"], "a failed publish stays visible")
        self.command("ledger", "publish")
        self.assertFalse(status()["unpublished"])

    def test_the_service_publishes_what_writes_left_through_failed_rounds(self):
        publish.set_remote(self.profile, self.url)
        self.write("first")
        self.assertIsNone(publish.state(self.profile)["behind_seconds"], "origin holds no branch yet")
        publish.publish(self.profile)
        self.write("second")
        self.write("third")
        behind = publish.state(self.profile)
        self.assertEqual((behind["unpublished"], behind["diverged"]), (True, False))
        self.assertLess(behind["behind_seconds"], 300, "the age of the oldest commit origin lacks")
        self.assertNotEqual(self.remote_head(), self.head())
        offline = publish.refuse("PUBLISH_FAILED", "offline")

        stop = threading.Event()
        with patch.object(db, "load_profile", return_value=self.profile), \
                patch.object(ledger_service, "PUBLISH_RETRY", 0.05), \
                patch.object(publish, "_push", wraps=publish._push) as pushed:
            pushed.side_effect = offline
            keeper = threading.Thread(target=ledger_service.keep_backed_up, args=(stop,), daemon=True)
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
        self.assertEqual(self.remote_head(), self.head(), "published by no command at all")
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
        publish.publish(self.profile)
        copy, environment = self.clone()
        for arguments in (("sql", "-q", "CREATE TABLE elsewhere (a INT PRIMARY KEY)"), ("commit", "-Am", "elsewhere"),
                          ("push", "origin", db.BRANCH)):
            subprocess.run([BINARY, *arguments], cwd=copy, env=environment, check=True, capture_output=True)
        self.write("second")
        self.assertEqual(refused(publish.publish, self.profile).code, "PUBLISH_REJECTED")
        found = publish.state(self.profile)
        self.assertEqual((found["unpublished"], found["behind_seconds"], found["diverged"]), (True, None, True))

    def test_no_command_but_ledger_publish_publishes(self):
        publish.set_remote(self.profile, self.url)
        for read in (("ledger", "sql", "SELECT 1"), ("candidate", "list"), ("research", "status")):
            found = self.command(*read)
            self.assertFalse({"published", "publish_failed"} & set(found), f"{read[:2]} only reads")
        written = self.write("first")
        self.assertFalse({"published", "publish_failed"} & set(written), "a write only commits locally")
        self.assertTrue(publish.unpublished(self.profile), "neither a read nor a write publishes")
        self.write("second")
        published = self.command("ledger", "publish")
        self.assertEqual((published["previous_head"], published["head"]), (None, self.head()),
                         "a new origin lacks the whole history; one publish carries every write")
        self.assertEqual(self.remote_head(), self.head())

    def test_the_dolt_login_key_is_installed_in_the_service_home(self):
        user = tempdir(self.addCleanup, prefix="u-", dir="/tmp")
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
        self.assertEqual(refused(publish.install_key, service, user / "none" / ".dolt").code, "DOLTHUB_CREDENTIALS")
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
        server.stop_service(root)
        time.sleep(0.01)
        server.start_service(root)
        self.assertFalse(publish._key_after_start(self.profile), "a restarted service has the key")
        self.assertEqual(failed()[0], "PUBLISH_FAILED")
        self.assertNotIn("ledger service stop", failed()[1])
        publish.install_key(service, user / ".dolt")
        self.assertFalse(publish._key_after_start(self.profile), "an unchanged key is not installed again")


    def test_the_first_publication_carries_the_line_tag_and_a_ledger_of_another_line_is_not_published(self):
        publish.set_remote(self.profile, self.url)
        publish.publish(self.profile)
        copy, environment = self.clone()
        tags = subprocess.run([BINARY, "sql", "-r", "csv", "-q", "SELECT tag_name FROM dolt_tags"], cwd=copy,
                              env=environment, check=True, capture_output=True, text=True).stdout.split()[1:]
        self.assertEqual(tags, [publish.TAG])
        self.assertEqual(publish.where(self.profile)["line"], publish.LINE)
        strategies.publish_candidate(self.profile, source("other-line"), "other", "Fixture", "a write")
        with patch.object(publish, "LINE", "v9"), patch.object(publish, "TAG", "line/v9"):
            self.assertEqual(refused(publish.publish, self.profile).code, "PUBLISH_FAILED")
        self.assertNotEqual(self.remote_head(), self.head(), "nothing was pushed")


@unittest.skipUnless(BINARY, SKIP)
class OntoMainTests(unittest.TestCase):
    """The one-time move of a v0.5 ledger that 0.5.3 published as origin's branch `v0.5` onto `main`, which holds the
    previous generation (schema generation 1, no line tag), with real pushes to a file remote."""

    def setUp(self):
        self.moved = patch.object(publish, "MOVED_LINE", publish.LINE)
        self.moved.start()
        self.addCleanup(self.moved.stop)
        self.service = Service()
        self.addCleanup(self.service.close)
        self.profile = self.service.ledger("moving")
        self.remote = tempdir(self.addCleanup, prefix="rm-", dir="/tmp")
        self.url = self.remote.as_uri()
        self.home = tempdir(self.addCleanup, prefix="hm-", dir="/tmp")
        self.environment = {**os.environ, "DOLT_ROOT_PATH": str(self.home), "DOLT_DISABLE_EVENT_FLUSH": "true"}
        server.dolt_home(self.home, {"user.name": "elsewhere", "user.email": "elsewhere@example.invalid"})
        self.previous = self.generation(1)
        self.shape_0_5_3()

    def dolt(self, cwd: Path, *arguments: str) -> str:
        return subprocess.run([BINARY, *arguments], cwd=cwd, env=self.environment, check=True, capture_output=True,
                              text=True).stdout

    def generation(self, schema: int, branch: str = "main") -> str:
        """A ledger of the previous generation (no line tag) pushed as origin's `branch`; its head."""
        work = self.home / f"gen-{schema}-{branch}"
        work.mkdir()
        self.dolt(work, "init")
        self.dolt(work, "sql", "-q", "CREATE TABLE ledger_schema (singleton INT PRIMARY KEY, version INT); "
                                     f"INSERT INTO ledger_schema VALUES (1, {schema})")
        self.dolt(work, "commit", "-Am", "schema")
        self.dolt(work, "commit", "--allow-empty", "-m", "a trial of the previous generation")
        self.dolt(work, "remote", "add", "origin", self.url)
        self.dolt(work, "push", "origin", f"main:{branch}")
        return self.dolt(work, "sql", "-r", "csv", "-q", "SELECT DOLT_HASHOF('main')").split()[-1]

    def shape_0_5_3(self) -> None:
        """The ledger as 0.5.3 left it: no line tag, published as `v0.5` and tracking that branch alone."""
        self.service.sql(self.profile, "CALL DOLT_TAG('-d', %s)", (publish.TAG,))
        self.service.sql(self.profile, "CALL DOLT_REMOTE('add', 'origin', %s)", (self.url,))
        self.service.sql(self.profile, "CALL DOLT_PUSH('origin', %s)", (f"main:{publish.LINE}",))
        strategies.publish_candidate(self.profile, source("unpublished"), "later", "Fixture", "after 0.5.3's publish")

    def head(self) -> str:
        return self.service.sql(self.profile, "SELECT DOLT_HASHOF('main')")[0][0]

    def root(self) -> str:
        return self.service.sql(self.profile, "SELECT commit_hash FROM dolt_log WHERE commit_order = 1")[0][0]

    def remote_refs(self) -> dict:
        """origin's branches (name: head) and tags (name: commit), from a full clone."""
        copy = self.home / f"read-{len(list(self.home.glob('read-*')))}"
        subprocess.run([BINARY, "clone", self.url, str(copy)], env=self.environment, check=True, capture_output=True)

        def rows(statement: str) -> dict:
            return dict(line.split(",") for line in self.dolt(copy, "sql", "-r", "csv", "-q", statement).split()[1:])

        return {"branches": {name.removeprefix("remotes/origin/"): head for name, head in
                             rows("SELECT name, hash FROM dolt_remote_branches").items()},
                "tags": rows("SELECT tag_name, tag_hash FROM dolt_tags")}

    def test_main_is_archived_as_v0_4_then_holds_the_ledger_and_v0_5_goes(self):
        before = self.remote_refs()["branches"]
        self.assertEqual(set(before), {"main", publish.LINE})
        self.assertEqual(publish.where(self.profile) | {"head": None, "remote": None},
                         {"remote": None, "head": None, "tracked": [publish.LINE], "line": None})
        result = publish.publish(self.profile)
        self.assertEqual(result["head"], self.head())
        after = self.remote_refs()
        self.assertEqual(after["branches"], {"main": self.head(), "v0.4": self.previous},
                         "the previous generation kept as v0.4, the ledger on main, v0.5 gone")
        self.assertEqual(after["tags"], {publish.TAG: self.root()})
        self.assertEqual(publish.where(self.profile) | {"remote": None},
                         {"remote": None, "head": self.head(), "tracked": ["main"], "line": publish.LINE})
        self.assertFalse((Path(self.profile.service_root) / "line-archive").exists(), "the scratch copy is gone")
        strategies.publish_candidate(self.profile, source("after"), "after", "Fixture", "after the move")
        self.assertEqual(publish.publish(self.profile)["head"], self.head(), "then publishes as usual")
        self.assertEqual(self.remote_refs()["branches"]["v0.4"], self.previous)

    def test_an_interrupted_move_resumes_and_v0_5_goes_only_once_main_holds_its_head(self):
        original = publish._push

        def lost(cursor, profile, url, ref, force=False):
            if ref == f":{publish.MOVED_LINE}":
                raise publish.refuse("PUBLISH_FAILED", "the connection dropped")
            return original(cursor, profile, url, ref, force)

        with patch.object(publish, "_push", side_effect=lost):
            self.assertEqual(refused(publish.publish, self.profile).code, "PUBLISH_FAILED")
        self.assertEqual(self.remote_refs()["branches"], {"main": self.head(), "v0.4": self.previous,
                                                          publish.LINE: self.published_v0_5()})
        # Something lands on v0.5 that main lacks: it stays.
        copy = self.home / "writer"
        subprocess.run([BINARY, "clone", "--branch", publish.LINE, self.url, str(copy)], env=self.environment,
                       check=True, capture_output=True)
        self.dolt(copy, "commit", "--allow-empty", "-m", "only on v0.5")
        self.dolt(copy, "push", "origin", publish.LINE)
        held = self.remote_refs()["branches"][publish.LINE]
        caught = refused(publish.publish, self.profile)
        self.assertEqual(caught.code, "PUBLISH_FAILED")
        self.assertIn("stays", caught.message)
        self.assertEqual(self.remote_refs()["branches"][publish.LINE], held)
        # Once main holds it, the move finishes.
        self.dolt(copy, "merge", "--no-ff", "-m", "both", "origin/main")
        self.dolt(copy, "push", "origin", publish.LINE)
        self.dolt(copy, "push", "origin", f"{publish.LINE}:main")
        self.service.sql(self.profile, "CALL DOLT_FETCH('origin', 'refs/heads/main:refs/remotes/origin/main')")
        self.service.sql(self.profile, "CALL DOLT_MERGE('--ff-only', 'origin/main')")
        publish.publish(self.profile)
        self.assertEqual(self.remote_refs()["branches"], {"main": self.head(), "v0.4": self.previous})

    def published_v0_5(self) -> str:
        return self.service.sql(self.profile, "SELECT hash FROM dolt_remote_branches WHERE name = %s",
                                (f"remotes/origin/{publish.LINE}",))[0][0]

    def test_an_archive_branch_that_does_not_show_main_s_head_stops_the_move_before_main_changes(self):
        original = publish.dolt_cli

        def unheard(binary, directory, environment, *arguments):
            if arguments[0] == "push":  # the branch ends up at another commit than main's head (its parent)
                head = arguments[2].split(":")[0]
                (parent,), = publish._cli_rows(binary, directory, environment, "SELECT parent_hash FROM "
                                               f"dolt_commit_ancestors WHERE commit_hash = '{head}'")
                arguments = (*arguments[:2], f"{parent}:{arguments[2].split(':')[1]}")
            return original(binary, directory, environment, *arguments)

        before = self.remote_refs()["branches"]
        with patch.object(publish, "dolt_cli", side_effect=unheard):
            caught = refused(publish.publish, self.profile)
        self.assertEqual(caught.code, "PUBLISH_FAILED")
        after = self.remote_refs()["branches"]
        self.assertEqual(after["main"], before["main"], "main is never forced without its archive")
        self.assertNotEqual(after["v0.4"], self.previous)

    def test_main_that_is_not_the_previous_generation_is_left_alone(self):
        remote = tempdir(self.addCleanup, prefix="rm-", dir="/tmp")
        self.service.sql(self.profile, "CALL DOLT_REMOTE('remove', 'origin')")
        self.url = remote.as_uri()
        self.service.sql(self.profile, "CALL DOLT_REMOTE('add', 'origin', %s)", (self.url,))
        self.generation(2)  # untagged, but not the previous generation's schema
        self.service.sql(self.profile, "CALL DOLT_PUSH('origin', %s)", (f"main:{publish.LINE}",))
        before = self.remote_refs()["branches"]
        caught = refused(publish.publish, self.profile)
        self.assertEqual(caught.code, "PUBLISH_FAILED")
        self.assertIn("neither this ledger nor the previous generation", caught.message)
        self.assertEqual(self.remote_refs()["branches"], before, "nothing pushed, archived or deleted")

    def test_an_archive_branch_holding_other_history_is_never_rewritten_and_main_stays(self):
        other = self.generation(1, "v0.4")
        before = self.remote_refs()["branches"]
        self.assertEqual(before["v0.4"], other)
        caught = refused(publish.publish, self.profile)
        self.assertEqual(caught.code, "PUBLISH_FAILED")
        self.assertEqual(self.remote_refs()["branches"], before, "main, v0.4 and v0.5 as they were")
        self.assertEqual(publish.where(self.profile)["tracked"], [publish.LINE])
