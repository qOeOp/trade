"""What a workstation update recreates, refuses and removes, with Docker faked."""
from contextlib import redirect_stdout
from datetime import datetime, timedelta, UTC
import io
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
import urllib.error

from deploy import generation
from deploy.update import (LEDGER, Cutover, Docker, main, paper_busy, plan, read_env, relation, removable,
                           stale_replays)


NOW = datetime(2026, 11, 22, 12, tzinfo=UTC)
ADMITTED, OLD, AHEAD = "a" * 40, "b" * 40, "c" * 40


class Fake(Docker):
    """Answers by the first arguments; records every call."""

    def __init__(self, answers: dict[tuple, str]):
        super().__init__()
        self.answers = answers
        self.calls: list[tuple[str, ...]] = []

    def __call__(self, *args: str, check: bool = True) -> str:
        self.calls.append(args)
        for prefix, answer in self.answers.items():
            if args[:len(prefix)] == prefix:
                return answer
        return ""


def replay(name: str, finished: datetime, **labels) -> dict:
    return {"Name": f"/{name}", "Config": {"Labels": {"trade.runtime.contract": "replay-contract@v8", **labels}},
            "State": {"FinishedAt": finished.strftime("%Y-%m-%dT%H:%M:%S.123456789Z")}}


class PlanTests(unittest.TestCase):
    def test_only_a_changed_service_is_recreated_and_a_stopped_one_started(self):
        running = {"ledger": {"hash": "l", "state": "running"}, "paper": {"hash": "old", "state": "running"},
                   "ide": {"hash": "i", "state": "exited"}}
        self.assertEqual(plan({"ledger": "l", "paper": "p", "ide": "i", "docker-api": "d"}, running),
                         {"ledger": "keep", "paper": "recreate", "ide": "start", "docker-api": "recreate"})

    def test_a_build_the_version_does_not_contain_is_flagged(self):
        def ancestor(before, after):
            return before == OLD and after == ADMITTED

        self.assertEqual(relation(ADMITTED, ADMITTED, ancestor), "admitted")
        self.assertEqual(relation(OLD, ADMITTED, ancestor), "older")
        self.assertEqual(relation(AHEAD, ADMITTED, ancestor), "NOT IN THE ADMITTED VERSION")
        self.assertEqual(relation(None, ADMITTED, ancestor), "NOT IN THE ADMITTED VERSION")


class PaperTests(unittest.TestCase):
    def test_a_runner_or_a_comparison_is_busy(self):
        idle = Fake({("ps", "-q"): "paper1\n", ("top",): "UID PID CMD\n1 1 python -m cli.main paper serve\n"})
        self.assertEqual(paper_busy(idle), [])
        runs = Fake({("ps", "--filter"): "trade-paper-x-runner\n"})
        self.assertEqual(paper_busy(runs), ["Paper runner trade-paper-x-runner"])
        comparing = Fake({("ps", "-q"): "paper1\n", ("top",): "1 2 python -m cli.main paper compare 7\n"})
        self.assertEqual(paper_busy(comparing), ["a Paper comparison"])

    def test_update_refuses_while_paper_runs_and_changes_nothing(self):
        with tempfile.TemporaryDirectory() as directory:
            env = Path(directory) / ".env"
            env.write_text(f'TRADE_DATA="{directory}"\nTRADE_IDE_IMAGE=old\n')
            docker = Fake({("ps", "--filter"): "trade-paper-x-runner\n"})
            with self.assertRaisesRegex(RuntimeError, "Paper is not idle"):
                main(["--env", str(env)], docker)
            self.assertEqual(env.read_text(), f'TRADE_DATA="{directory}"\nTRADE_IDE_IMAGE=old\n')
            self.assertFalse((Path(directory) / "deploy").exists())
            self.assertFalse([call for call in docker.calls if call[0] in ("compose", "rm", "image", "volume")])

    def test_env_values_lose_one_level_of_quotes(self):
        with tempfile.TemporaryDirectory() as directory:
            env = Path(directory) / ".env"
            env.write_text("# TRADE_DATA=/no\nTRADE_DATA='/d'\nTRADE_MARKET_ARGS=\"--bars-from 2020-01\"\n")
            self.assertEqual(read_env(env), {"TRADE_DATA": "/d", "TRADE_MARKET_ARGS": "--bars-from 2020-01"})


class CleanTests(unittest.TestCase):
    def test_only_this_repositorys_unused_unpinned_images_go(self):
        def image(identity, tags=(), digests=()):
            return {"Id": identity, "RepoTags": list(tags), "RepoDigests": list(digests)}

        images = [
            image("used", digests=["ghcr.io/qoeop/trade-service@sha256:1"]),
            image("pr", tags=["ghcr.io/qoeop/trade-runtime:pr-3441"]),
            image("old", digests=["ghcr.io/qoeop/trade-ide@sha256:2"]),
            image("main", tags=["ghcr.io/qoeop/trade-runtime:main", "ghcr.io/qoeop/trade-runtime:pr-9"]),
            # The containerd store lists digest names among the tags.
            image("pinned", tags=["ghcr.io/qoeop/trade-runtime@sha256:3"]),
            image("other", tags=["redis:7"]),
            image("dangling"),
            image("dangling-used"),
        ]
        self.assertEqual([item["Id"] for item in removable(images, {"used", "pinned", "dangling-used"})],
                         ["pr", "old", "dangling"])

    def test_a_replay_container_goes_only_once_its_replay_is_surely_over(self):
        containers = [replay("replay-temp-trial-4-native", NOW - timedelta(hours=2)),
                      replay("replay-temp-trial-5-native", NOW - timedelta(minutes=5)),
                      replay("trade-paper-1-runner", NOW - timedelta(days=2), **{"trade.paper.role": "runner"}),
                      replay("replay-compose", NOW - timedelta(days=2), **{"com.docker.compose.project": "x"})]
        docker = Fake({("ps",): "a b c d", ("container", "inspect"): json.dumps(containers)})
        self.assertEqual(stale_replays(docker, NOW), ["replay-temp-trial-4-native"])


SERVICE = "ghcr.io/qoeop/trade-service@sha256:" + "e" * 64
BASE = "https://doltremoteapi.dolthub.com/owner/research"
HEAD = "h" * 32
REFUSAL = '{"code": "SCHEMA_MISMATCH", "message": "research schema version 1, this code expects 2", "expected": "2"}'
PUBLISH = ("exec", LEDGER, "python", "-m", "cli.main", "ledger", "publish", "--ledger", "research")


class Workstation(Fake):
    """Docker on a workstation whose ledger publishes as v0.5 of the research repository, the version (v0.6 unless a
    test says otherwise) being admitted: the version's checks, where the ledger publishes, its publish, the archive (run
    on the temporary data with the version's own code) and compose. A ledger's start renames an origin of 0.5.2's
    repository per generation to the repository (ledger/service.py), and its publish pushes its line."""

    def __init__(self, data: Path, volume: Path):
        super().__init__({})
        self.data, self.volume = data, volume
        self.unread: set[str] = set()
        self.published = True
        self.line = "v0.6"  # the version's line
        self.stored, self.lines = BASE, ["v0.5"]  # where the running ledger publishes, and its line
        self.volumes = {generation.VOLUME}
        self.renames = True  # the started ledger renames an origin of one generation (0.5.3 and later)

    def __call__(self, *args: str, check: bool = True) -> str:
        self.calls.append(args)
        if args[:2] == ("volume", "ls"):
            return "\n".join(sorted(self.volumes))
        if args[:2] == ("volume", "rm"):
            self.volumes.discard(args[2])
        if args[0] == "inspect":
            return "1000:1000\n"
        if args[0] == "run" and "deploy.generation" in args:
            command = [str(self.volume) if item == generation.MOUNTED else item
                       for item in args[args.index("deploy.generation") + 1:]]
            if command[0] == "prune":
                return " ".join(generation.prune(Path(command[1]), command[2]))
            generation.main(command)
        if args[0] == "run" and generation.ORIGIN in args:
            return json.dumps({"line": self.line, "research": 2, "paper": 1})
        if args[0] == "compose" and args[-1] == "ledger" and "up" in args and self.renames \
                and self.stored == f"{BASE}-g2":
            self.stored, self.lines = BASE, []  # the version's ledger renamed its origin at start
        return ""

    def result(self, *args: str):
        self.calls.append(args)
        if generation.WHERE in args:
            return SimpleNamespace(returncode=0, stderr="", stdout=json.dumps(
                {"remote": self.stored, "lines": self.lines, "head": HEAD}))
        if args[0] == "exec":
            if self.published and self.stored == BASE and not self.lines:
                self.lines = [self.line]
            return SimpleNamespace(returncode=0 if self.published else 1, stderr="PUBLISH_FAILED",
                                   stdout=json.dumps({"remote": self.stored}) if self.published else "")
        database = args[-1]
        refused = database in self.unread
        return SimpleNamespace(returncode=1 if refused else 0, stdout="", stderr=REFUSAL if refused else "")


class DoltHub:
    """DoltHub's API: the state of the research repository's branch of a line, and every request made."""

    def __init__(self, state: str):
        self.state, self.requests = state, []

    def __call__(self, request, timeout):
        self.requests.append(request)
        if self.state == "data":
            return io.BytesIO(json.dumps({"query_execution_status": "Success", "rows": [{"version": "2"}]}).encode())
        message = {"absent": "no such repository", "empty": generation.NO_BRANCH, "other": generation.NO_TABLE}.get(
            self.state, "query error: something else")
        raise urllib.error.HTTPError(request.full_url, 400, "", {}, io.BytesIO(json.dumps(
            {"query_execution_status": "Error", "query_execution_message": message}).encode()))


class CutoverTests(unittest.TestCase):
    """A version of another line starts a new data generation on the workstation, and the first 0.5.3 update moves
    the v0.5 ledger (deploy/update.py Cutover; docs/plans/version-line-branches-20261123.zh.md)."""

    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.data = Path(temporary.name)
        self.volume = fill(self.data)
        self.env = self.data / ".env"
        self.env.write_text(f"TRADE_DATA={self.data}\nTRADE_RESEARCH_ORIGIN={BASE}\n")
        self.docker = Workstation(self.data, self.volume)
        self.hub = DoltHub("empty")
        self.cutover = Cutover(self.docker, self.env, self.data, ADMITTED, SERVICE, opener=self.hub)
        self.running = {"ledger": {"state": "running"}}

    def stopped(self) -> bool:
        return any(call[-1:] == ("stop",) for call in self.docker.calls)

    def test_another_line_is_a_new_generation_even_with_the_same_schema(self):
        self.assertEqual(self.cutover.assess(self.running), ({}, "cutover"))
        self.docker.unread = {"research"}
        self.assertEqual(self.cutover.assess(self.running), ({"research": "2"}, "cutover"))
        self.docker.unread, self.docker.line = set(), "v0.5"
        self.assertEqual(self.cutover.assess(self.running), ({}, "same"))
        self.assertFalse(self.stopped())

    def test_a_schema_change_within_a_line_is_refused(self):
        self.docker.unread, self.docker.line = {"research"}, "v0.5"
        with self.assertRaisesRegex(RuntimeError, "within this ledger's line v0.5; a schema change needs a new line"):
            self.cutover.assess(self.running)
        self.assertFalse([call for call in self.docker.calls if call[0] == "exec"], "not even a publish")

    def test_what_cannot_be_compared_is_refused(self):
        (self.data / "dolt/service.json").unlink()
        self.assertEqual(self.cutover.assess({}), ({}, "first"), "a first start has nothing to compare")
        (self.data / "dolt/service.json").write_text("{}")
        with self.assertRaisesRegex(RuntimeError, "has data .* but no container"):
            self.cutover.assess({"other": {"state": "running"}})
        with self.assertRaisesRegex(RuntimeError, "not running"):
            self.cutover.assess({"ledger": {"state": "exited"}})
        self.env.write_text(f"TRADE_DATA={self.data}\n")
        self.docker.stored = None
        with self.assertRaisesRegex(RuntimeError, "names no TRADE_RESEARCH_ORIGIN and the ledger publishes nowhere"):
            self.cutover.assess(self.running)

    def test_an_unnamed_repository_is_the_one_the_ledger_publishes_to_named_once_checked(self):
        self.env.write_text(f"TRADE_DATA={self.data}\n")
        self.docker.line, self.docker.stored, self.docker.lines = "v0.5", f"{BASE}-g2", ["main"]
        self.assertEqual(self.cutover.assess(self.running, check=True), ({}, "move"))
        self.assertNotIn("TRADE_RESEARCH_ORIGIN", read_env(self.env), "--check changes nothing")
        self.assertEqual(self.cutover.wanted["origin"], BASE, "without 0.5.2's generation suffix")
        self.assertEqual(self.cutover.assess(self.running), ({}, "move"))
        self.assertEqual(read_env(self.env)["TRADE_RESEARCH_ORIGIN"], BASE)
        self.env.write_text(f"TRADE_DATA={self.data}\n")
        self.docker.unread = {"research"}  # refused: nothing named
        with self.assertRaisesRegex(RuntimeError, "another schema generation"):
            self.cutover.assess(self.running)
        self.assertNotIn("TRADE_RESEARCH_ORIGIN", read_env(self.env))

    def test_a_ledger_publishing_elsewhere_or_tracking_several_lines_is_refused(self):
        for stored, lines, text in ((f"{BASE}-other", ["main"], "publishes to .*-other, not to"),
                                    ("https://doltremoteapi.dolthub.com/someone/else-g2", ["main"], "not to"),
                                    (BASE, ["v0.5", "v0.4"], "several branches")):
            with self.subTest(stored=stored, lines=lines):
                self.docker.stored, self.docker.lines = stored, lines
                with self.assertRaisesRegex(RuntimeError, text):
                    self.cutover.assess(self.running)
        self.assertFalse(self.stopped())

    def test_a_ledger_not_yet_published_to_its_line_publishes_first(self):
        self.docker.line, self.docker.lines = "v0.5", []
        output = io.StringIO()
        with redirect_stdout(output):
            self.assertEqual(self.cutover.assess(self.running, check=True)[1], "unpublished")
        self.assertNotIn(PUBLISH, self.docker.calls, "--check publishes nothing")
        self.assertEqual(self.cutover.assess(self.running), ({}, "same"))
        self.assertIn(PUBLISH, self.docker.calls)
        self.docker.lines, self.docker.published = [], False
        with self.assertRaisesRegex(RuntimeError, "has not published to its line"):
            self.cutover.assess(self.running)

    def test_the_v0_5_ledger_of_0_5_2_moves_only_into_v0_5(self):
        self.docker.stored, self.docker.lines = f"{BASE}-g2", ["main"]
        self.assertEqual(self.cutover.assess(self.running)[1], "cutover", "v0.6 starts its own ledger")
        self.docker.line = "v0.5"
        self.assertEqual(self.cutover.assess(self.running)[1], "move")
        self.docker.published = False
        with self.assertRaisesRegex(RuntimeError, "publish failed"):
            self.cutover.move(check=False)
        self.docker.published = True
        self.docker.calls.clear()
        self.cutover.move(check=False)
        self.assertFalse(self.stopped())
        self.cutover.moved(["compose"])
        up = self.docker.calls.index(("compose", "up", "--detach", "--wait", "--wait-timeout", "1800", "ledger"))
        publishes = [index for index, call in enumerate(self.docker.calls) if call == PUBLISH]
        self.assertEqual(len(publishes), 2)
        self.assertLess(publishes[0], up, "the old copy is complete before the version's ledger starts")
        self.assertGreater(publishes[1], up, "then the moved ledger publishes its line")
        self.assertEqual((self.docker.stored, self.docker.lines), (BASE, ["v0.5"]))
        self.assertEqual(self.cutover.assess(self.running), ({}, "same"), "the next update has nothing to do")
        self.docker.stored = f"{BASE}-g2"  # a ledger that did not rename its origin
        self.docker.lines, self.docker.renames = ["main"], False
        with self.assertRaisesRegex(RuntimeError, "published to .*-g2, not"):
            self.cutover.moved(["compose"])

    def test_a_version_without_a_line_or_a_base_of_one_generation_is_refused(self):
        self.docker.line = None
        with self.assertRaisesRegex(RuntimeError, "publishes no version line"):
            self.cutover.assess(self.running)
        self.docker.line = "v0.6"
        self.env.write_text(f"TRADE_DATA={self.data}\nTRADE_RESEARCH_ORIGIN={BASE}-g2\n")
        with self.assertRaisesRegex(RuntimeError, "names a repository of one generation"):
            self.cutover.assess(self.running)

    def test_a_new_generation_archives_the_ledger_and_starts_it_alone_first(self):
        older = self.data / generation.ARCHIVE / ("20260101T000000Z-" + "c" * 12)
        older.mkdir(parents=True)
        journal = self.cutover.begin(self.cutover.assess(self.running)[0], check=False)
        self.assertEqual(journal["phase"], "archiving")
        self.assertFalse(self.stopped(), "nothing changes before the journal")
        [request] = self.hub.requests
        self.assertTrue(request.full_url.startswith(generation.API + "owner/research/v0.6?q="))
        self.cutover.run(journal, ["compose", "-p", "trade-ide"])
        archive = self.data / generation.ARCHIVE / journal["archive"]
        self.assertTrue((archive / "dolt/service.json").is_file())
        self.assertTrue((archive / generation.VOLUME_TGZ).is_file())
        self.assertEqual(sorted(path.name for path in (self.data / "dolt").iterdir()), ["paper"])
        self.assertEqual([path.name for path in (self.data / "ledgers").iterdir()], ["market.json"],
                         "market.json is put back once the ledger started; nothing else")
        self.assertNotIn(generation.VOLUME, self.docker.volumes)
        self.assertFalse(older.exists())
        self.assertFalse(self.cutover.journal.exists())
        ups = [call for call in self.docker.calls if "up" in call]
        self.assertEqual([call[-1] for call in ups], ["ledger"], "the ledger alone, before market.json is back")
        self.assertTrue(self.docker.calls.index(PUBLISH) < self.docker.calls.index(
            ("compose", "-p", "trade-ide", "stop")), "the old ledger publishes before it stops")

    def test_a_missing_repository_is_refused_and_never_created(self):
        self.cutover.assess(self.running)
        self.hub.state = "absent"
        with self.assertRaisesRegex(RuntimeError, "owner/research does not exist on DoltHub; create it once"):
            self.cutover.begin({}, check=False)
        self.assertEqual({request.get_method() for request in self.hub.requests}, {"GET"})
        self.assertFalse(self.cutover.journal.exists())
        self.assertFalse(self.stopped())

    def test_refusals_before_anything_changes(self):
        self.cutover.assess(self.running)
        self.hub.state = "data"
        self.cutover.wanted = {**self.cutover.wanted, "research": 3}
        with self.assertRaisesRegex(RuntimeError, "schema generation 2, not 3"):
            self.cutover.begin({"research": "3"}, check=False)
        self.cutover.wanted = {**self.cutover.wanted, "research": 2}
        self.docker.published = False
        requests = len(self.hub.requests)
        for found in ({}, {"paper": "2"}, {"research": "2"}):
            with self.subTest(found=found), self.assertRaisesRegex(RuntimeError, "publish failed"):
                self.cutover.begin(found, check=False)
        self.assertEqual(len(self.hub.requests), requests, "a failed publish refuses before anything else")
        self.docker.published = True
        self.hub.state = "other"  # a branch of that name holding something else
        with self.assertRaisesRegex(RuntimeError, "holds no research ledger"):
            self.cutover.begin({}, check=False)
        self.hub.state = "unknown"  # DoltHub answers something that is neither a branch nor its absence
        with self.assertRaises(generation.OriginUnreadable):
            self.cutover.begin({}, check=False)
        self.assertIsNone(self.cutover.begin({}, check=True))
        self.assertFalse(self.cutover.journal.exists())
        self.assertFalse(self.stopped())

    def test_an_interrupted_cutover_goes_on_from_its_step(self):
        self.cutover.assess(self.running)
        journal = self.cutover.begin({}, check=False)
        self.docker.calls.clear()
        archived = {**journal, "phase": "archived"}
        self.cutover.journal.write_text(json.dumps(archived))
        self.assertEqual(self.cutover.pending(), archived)
        self.cutover.run(self.cutover.pending(), ["compose"])
        self.assertFalse(self.stopped(), "an archived ledger is not archived again")
        self.assertFalse(self.cutover.journal.exists())
        self.cutover.journal.write_text('{"phase": "done"}')
        with self.assertRaisesRegex(RuntimeError, "not a cutover journal"):
            self.cutover.pending()

    def test_a_cutover_pending_for_another_line_is_left_to_the_operator(self):
        self.cutover.assess(self.running)
        journal = self.cutover.begin({}, check=False)
        self.assertEqual(journal["line"], "v0.6")
        self.docker.line = "v0.7"  # a newer version of the next line admitted before the cutover finished
        with self.assertRaisesRegex(RuntimeError, "cutover to v0.6 is pending, but version .* publishes its ledger "
                                                  "as v0.7"):
            self.cutover.pending()
        self.assertEqual(json.loads(self.cutover.journal.read_text()), journal, "left as it is")
        self.cutover.journal.write_text(json.dumps({key: value for key, value in journal.items() if key != "line"}))
        with self.assertRaisesRegex(RuntimeError, "not a cutover journal"):  # 0.5.2's journal names no line
            self.cutover.pending()


class MainTests(unittest.TestCase):
    def update(self, data: Path, docker: Workstation, hub: DoltHub) -> Path:
        env = data / ".env"
        source = Mock()
        source.git.return_value = "services: {}\n"
        with patch("deploy.update.paper_busy", return_value=[]), \
                patch("deploy.update.services", return_value={"ledger": {
                    "state": "running", "revision": None, "hash": None, "definition": "compose.yaml"}}), \
                patch("deploy.update.channel_source", return_value=(source, "deploy")), \
                patch("deploy.update.resolve", return_value=(ADMITTED, {"TRADE_SERVICE_IMAGE": SERVICE})), \
                patch("deploy.update.urllib.request.urlopen", hub), redirect_stdout(io.StringIO()):
            main(["--env", str(env), "--arch", "arm64"], docker)
        return env

    def test_a_refused_cutover_leaves_the_env_file_and_the_definition_as_they_were(self):
        with tempfile.TemporaryDirectory() as directory:
            data = Path(directory)
            docker = Workstation(data, fill(data))
            before = f"TRADE_DATA={data}\nTRADE_RESEARCH_ORIGIN={BASE}\nTRADE_SERVICE_IMAGE=old\n"
            (data / ".env").write_text(before)
            with self.assertRaisesRegex(RuntimeError, "does not exist"):
                self.update(data, docker, DoltHub("absent"))
            self.assertEqual((data / ".env").read_text(), before)
            self.assertFalse((data / "deploy" / ADMITTED).exists())
            self.assertFalse([call for call in docker.calls if call[0] == "compose"])

    def test_the_first_0_5_3_update_moves_the_ledger_then_moves_the_services(self):
        with tempfile.TemporaryDirectory() as directory:
            data = Path(directory)
            docker = Workstation(data, fill(data))
            docker.line, docker.stored, docker.lines = "v0.5", f"{BASE}-g2", ["main"]
            (data / ".env").write_text(f"TRADE_DATA={data}\nTRADE_RESEARCH_ORIGIN={BASE}\nTRADE_SERVICE_IMAGE=old\n")
            hub = DoltHub("empty")
            self.update(data, docker, hub)
            self.assertEqual(read_env(data / ".env")["TRADE_SERVICE_IMAGE"], SERVICE)
            self.assertEqual((docker.stored, docker.lines), (BASE, ["v0.5"]))
            self.assertEqual(hub.requests, [], "a move asks DoltHub nothing: the ledger's own publish checks")
            composed = [call for call in docker.calls if call[0] == "compose"]
            self.assertFalse([call for call in composed if call[-1] == "stop"], "nothing is archived")
            ledger = next(index for index, call in enumerate(docker.calls) if call[0] == "compose"
                          and call[-1] == "ledger")
            everything = next(index for index, call in enumerate(docker.calls) if call[0] == "compose"
                              and call[-2:] == ("up", "-d"))
            self.assertLess(ledger, everything, "the moved ledger publishes before the other services move")
            self.assertEqual(read_env(data / ".env")["TRADE_RESEARCH_ORIGIN"], BASE)


def fill(data: Path) -> Path:
    for path, text in (("dolt/service.json", "{}"), ("dolt/paper/7/run.json", "{}"), ("ledgers/research.json", "{}"),
                       ("ledgers/market.json", "{}"), ("dolt-backups/research/b", "b"), ("volume/research/x", "x")):
        (data / path).parent.mkdir(parents=True, exist_ok=True)
        (data / path).write_text(text)
    return data / "volume"


if __name__ == "__main__":
    unittest.main()
