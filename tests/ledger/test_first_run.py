"""If this fails, a deployment's first start no longer finishes from the IDE's page: `ledger service run --setup`
must wait past what it lacks or fails on, keep a directory holding someone's key unwritten, leave nothing behind when
a bootstrap fails or is stopped, and take only one bootstrap at a time. Throwaway services and file remotes only."""

from __future__ import annotations

from collections.abc import Callable
import http.client
import json
import os
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

from ledger import db, first_run, publish, service
from shared import paths, profiles
from shared.refusals import refuse
from tests.ledger.dolt import BINARY, SKIP
from tests.helpers import refused


class RepositoryTests(unittest.TestCase):
    def test_a_name_or_either_address_names_one_remote(self):
        for text in ("o-1/r_2", " o-1/r_2 ", "o-1/r_2/", "https://doltremoteapi.dolthub.com/o-1/r_2",
                     "https://www.dolthub.com/repositories/o-1/r_2", "dolthub.com/repositories/o-1/r_2/data/main"):
            self.assertEqual(first_run.origin_of(text), "https://doltremoteapi.dolthub.com/o-1/r_2", text)
        self.assertTrue(publish.DOLTHUB.fullmatch(first_run.origin_of("o/r")))

    def test_anything_else_is_refused(self):
        for text in ("", "name", "o/r/more", "https://example.com/o/r", "file:///tmp/o/r", "o/r;drop",
                     "https://www.dolthub.com/users/o/r"):
            self.assertEqual(refused(first_run.origin_of, text).code, "REMOTE_INVALID", text)


@unittest.skipUnless(BINARY, SKIP)
class FirstStartTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="fr-", dir="/tmp"))
        self.addCleanup(shutil.rmtree, self.root, True)
        self.service_root, self.data, self.backups = self.root / "s", self.root / "data", self.root / "backups"
        self.credentials = self.root / "user" / ".dolt"
        self.credentials.mkdir(parents=True)
        self.empty = self.root / "empty-copy"
        self.empty.mkdir()
        for patcher in (patch.dict(os.environ, {"TRADE_LEDGER_HOME": str(self.root / "profiles")}),
                        patch.object(service, "LISTEN", "127.0.0.1"),
                        patch.object(paths, "is_temporary", return_value=False),  # an active service, in a throwaway root
                        patch.object(db, "_binary", return_value=BINARY)):
            patcher.start()
            self.addCleanup(patcher.stop)
        with socket.socket() as held:  # held, so the setup port cannot be given the same number
            held.bind(("127.0.0.1", 0))
            self.port = held.getsockname()[1]
            self.address = f"127.0.0.1:{db._free_port()}"
        for signum in (signal.SIGTERM, signal.SIGINT):
            self.addCleanup(signal.signal, signum, signal.getsignal(signum))

    def call(self, method: str = "GET", body: dict | None = None, host: str | None = None,
             path: str = first_run.PATH) -> tuple[int, dict]:
        for _ in range(200):
            conn = http.client.HTTPConnection(self.address, timeout=30)
            try:
                conn.request(method, path, json.dumps(body) if body is not None else None,
                             {"Host": host or self.address})
                response = conn.getresponse()
                return response.status, json.loads(response.read())
            except ConnectionError:
                time.sleep(0.05)
            finally:
                conn.close()
        self.fail("the setup port did not open")

    def until(self, *states: str) -> dict:
        for _ in range(1200):
            _, answer = self.call()
            if answer["state"] in states:
                return answer
            time.sleep(0.05)
        self.fail(f"never {states}: {answer}")

    def first_start(self, origin: str | None, page: Callable[[], None], readers: Path | None = None):
        """The first start on this thread (signals need it), `page` acting on it from another; the server it
        returned, or None when `page` ended it with SIGTERM as `docker stop` would."""
        failures: list[BaseException] = []

        def act() -> None:
            try:
                page()
            except BaseException as exc:
                failures.append(exc)
                os.kill(os.getpid(), signal.SIGTERM)

        client = threading.Thread(target=act)
        client.start()
        server = None
        try:
            server = service._first_start(self.service_root, self.data, self.backups, self.credentials, origin,
                                          self.port, readers, self.address)
            self.addCleanup(service._stop, server)
        except SystemExit as exc:
            self.assertEqual(exc.code, 0)
        client.join(120)
        if failures:
            raise failures[0]
        return server

    def stop(self) -> None:
        os.kill(os.getpid(), signal.SIGTERM)

    def nothing_left(self) -> None:
        self.assertEqual(list(self.data.iterdir()) if self.data.exists() else [], [])
        self.assertEqual(list(profiles.home().glob("*.json")) if profiles.home().exists() else [], [])
        self.assertFalse((self.service_root / "service.json").exists())

    def test_an_empty_copy_in_the_configuration_starts_at_once_and_the_page_learns_it_is_done(self):
        answers = {}

        def page() -> None:
            answers["done"] = self.until("done")
            answers["post"] = self.call("POST", {"repository": "someone/else"})

        readers = self.root / "readers"
        server = self.first_start(self.empty.as_uri(), page, readers)
        self.assertIsNone(server.poll())
        self.assertIsNone(answers["done"]["refusal"])
        self.assertEqual(answers["post"][1]["state"], "done", "nothing starts again once the ledger is up")
        self.assertEqual(answers["post"][1]["repository"], self.empty.as_uri())
        profile = db.load_profile("research")
        self.assertEqual(profile.kind, "active")
        self.assertFalse(publish.unpublished(profile), "the new ledger is on its copy")
        self.assertTrue((readers / "service.json").is_file())
        self.assertTrue((self.credentials / "config_global.json").is_file(), "the key it made stays for later starts")

    def test_the_page_waits_past_a_failure_keeps_nothing_and_a_new_answer_starts_again(self):
        answers = {}
        not_a_copy = self.root / "not-a-copy"
        not_a_copy.write_text("not a Dolt remote", encoding="utf-8")

        def page() -> None:
            answers["failed"] = self.until("waiting")
            self.nothing_left()
            answers["bad"] = self.call("POST", {"repository": "not a repository"})
            answers["still"] = self.call()
            not_a_copy.unlink()
            not_a_copy.symlink_to(self.empty, target_is_directory=True)
            answers["asked"] = self.call("POST", {"repository": not_a_copy.as_uri()})
            self.until("done")

        server = self.first_start(not_a_copy.as_uri(), page)
        self.assertIsNone(server.poll())
        self.assertEqual(answers["failed"]["refusal"]["code"], "BOOTSTRAP_FAILED")
        self.assertEqual(answers["failed"]["repository"], not_a_copy.as_uri(), "the answer stays to correct")
        self.assertEqual((answers["bad"][0], answers["bad"][1]["code"]), (400, "REMOTE_INVALID"))
        self.assertEqual(answers["still"][1]["state"], "waiting", "an invalid answer starts nothing")
        self.assertEqual(answers["asked"][0], 202)
        self.assertIsNone(answers["asked"][1]["refusal"], "a new try clears the old failure")

    def test_an_answer_on_the_page_replaces_the_configured_repository(self):
        answers = {}

        def page() -> None:
            self.until("waiting")
            with patch.object(first_run, "origin_of", return_value=self.empty.as_uri()) as parsed:
                answers["asked"] = self.call("POST", {"repository": "owner/name"})
                parsed.assert_called_once_with("owner/name")
            self.until("done")

        not_a_copy = self.root / "not-a-copy"
        not_a_copy.write_text("not a Dolt remote", encoding="utf-8")
        self.assertIsNone(self.first_start(not_a_copy.as_uri(), page).poll())
        self.assertEqual(answers["asked"][0], 202)
        self.assertEqual(publish.set_remote(db.load_profile("research"), self.empty.as_uri())["added"], False)

    def test_with_nothing_configured_it_asks_and_answers_only_the_ide(self):
        answers = {}

        def page() -> None:
            answers["first"] = self.call()
            answers["host"] = self.call(host="elsewhere:1")
            answers["path"] = self.call(path="/other")
            answers["no repository"] = self.call("POST", {})
            self.stop()

        self.assertIsNone(self.first_start(None, page))
        first = answers["first"][1]
        self.assertEqual((first["state"], first["repository"], first["refusal"]), ("waiting", None, None))
        self.assertEqual(answers["host"][0], 403)
        self.assertEqual(answers["path"][0], 404)
        self.assertEqual(answers["no repository"][1]["code"], "REMOTE_INVALID")
        listed = subprocess.run([BINARY, "creds", "ls", "-v"], capture_output=True, text=True, check=True, cwd=self.root,
                                env={**os.environ, "DOLT_ROOT_PATH": str(self.credentials.parent),
                                     "DOLT_DISABLE_EVENT_FLUSH": "true"}).stdout
        self.assertIn(first["public_key"], listed, "the page shows the key it made")
        self.assertNotIn(json.loads((self.credentials / "config_global.json").read_text())["user.creds"], json.dumps(first),
                         "the key's id is not shown")
        self.nothing_left()

    def test_a_key_dolthub_does_not_know_is_asked_for_quietly_then_named_once_someone_pressed(self):
        answers = {}
        origin = "https://doltremoteapi.dolthub.com/owner/name"

        def page() -> None:
            answers["configured"] = self.until("waiting")
            answers["pressed"] = self.call("POST", {"repository": "owner/name"})
            answers["named"] = self.until("waiting")
            self.stop()

        with patch.object(first_run, "check_key", side_effect=refuse("DOLTHUB_CREDENTIALS", "not known")):
            self.assertIsNone(self.first_start(origin, page))
        self.assertIsNone(answers["configured"]["refusal"])
        self.assertEqual(answers["configured"]["repository"], "owner/name")
        self.assertEqual(answers["named"]["refusal"]["code"], "DOLTHUB_CREDENTIALS")
        self.nothing_left()

    def test_a_directory_holding_someones_key_is_not_written(self):
        home = self.root / "login"
        home.mkdir()
        subprocess.run([BINARY, "creds", "new"], check=True, capture_output=True, cwd=home,
                       env={**os.environ, "DOLT_ROOT_PATH": str(home), "DOLT_DISABLE_EVENT_FLUSH": "true"})
        shutil.rmtree(self.credentials)
        shutil.copytree(home / ".dolt", self.credentials)
        before = {path: path.read_bytes() for path in self.credentials.rglob("*") if path.is_file()}
        answers = {}

        def page() -> None:
            answers["first"] = self.call()
            self.stop()

        self.assertIsNone(self.first_start(None, page))
        self.assertTrue(answers["first"][1]["public_key"])
        self.assertEqual({path: path.read_bytes() for path in self.credentials.rglob("*") if path.is_file()}, before)

    def test_what_a_retry_cannot_fix_is_only_reported(self):
        cases = {"BOOTSTRAP_REFUSED": lambda: (self.data.mkdir(), (self.data / "keep").write_text("someone's")),
                 "DOLTHUB_CREDENTIALS": lambda: (self.credentials / "unrelated").write_text("someone's")}
        for code, arrange in cases.items():
            with self.subTest(code):
                answers = {}
                arrange()
                written = sorted(path.name for path in self.credentials.iterdir())

                def page() -> None:
                    answers["first"] = self.call()
                    answers["asked"] = self.call("POST", {"repository": "owner/name"})
                    self.stop()

                self.assertIsNone(self.first_start(self.empty.as_uri(), page))
                self.assertEqual(answers["first"][1]["state"], "blocked")
                self.assertEqual(answers["first"][1]["refusal"]["code"], code)
                self.assertEqual(answers["asked"][1]["state"], "blocked", "a press changes nothing")
                self.assertEqual(sorted(path.name for path in self.credentials.iterdir()), written)
                shutil.rmtree(self.data, True)
                for path in self.credentials.iterdir():
                    path.unlink() if path.is_file() else shutil.rmtree(path)
                self.address = f"127.0.0.1:{db._free_port()}"

    def test_a_signal_during_the_bootstrap_leaves_nothing_it_made(self):
        def signalled(*_arguments):
            self.stop()
            time.sleep(30)  # the handler raises on this thread, here

        with patch.object(publish, "publish", side_effect=signalled):
            self.assertIsNone(self.first_start(self.empty.as_uri(), lambda: None))
        self.nothing_left()
        self.assertEqual(signal.getsignal(signal.SIGTERM), signal.SIG_IGN, "the cleanup cannot be interrupted")

    def test_a_later_start_opens_no_setup_port(self):
        self.first_start(self.empty.as_uri(), lambda: self.until("done"))
        config = db.service_config(self.service_root)
        self.assertIsNotNone(config)
        with patch.object(first_run, "serve", side_effect=AssertionError("a later start asked the page")), \
                patch.object(service, "start", return_value=(subprocess.Popen(["true"]), config)):
            self.assertEqual(service.run(self.service_root, self.data, self.backups, self.credentials, None, self.port,
                                         setup=self.address)[0]["action"], "run")
