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
import urllib.parse

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
    """Docker on a workstation whose ledger is of line v0.5 on main of the research repository, the version (v0.6
    unless a test says otherwise) being admitted: the version's checks, where the ledger publishes, its publish, the
    archive (run on the temporary data with the version's own code) and compose. A ledger 0.5.3 left tracks `v0.5`;
    once the version's ledger runs, its publish moves it onto main (ledger/publish.py onto_main)."""

    def __init__(self, data: Path, volume: Path):
        super().__init__({})
        self.data, self.volume = data, volume
        self.unread: set[str] = set()
        self.published = True
        self.line = "v0.6"  # the version's line
        self.stored, self.tracked, self.ledger_line = BASE, ["main"], "v0.5"  # where and what the running ledger is
        self.volumes = {generation.VOLUME}
        self.started = False  # whether the version's ledger runs
        self.moves = True  # whether its publish moves a ledger 0.5.3 left onto main
        self.main = True  # whether the version publishes on main (0.5.4 and later)

    def __call__(self, *args: str, check: bool = True) -> str:
        self.calls.append(args)
        if args[:2] == ("volume", "ls"):
            return "\n".join(sorted(self.volumes))
        if args[:2] == ("volume", "rm"):
            self.volumes.discard(args[2])
        if args[0] == "inspect":
            return "healthy\n" if "{{.State.Health.Status}}" in args else "1000:1000\n"
        if args[0] == "run" and "deploy.generation" in args:
            command = [str(self.volume) if item == generation.MOUNTED else item
                       for item in args[args.index("deploy.generation") + 1:]]
            if command[0] == "prune":
                return " ".join(generation.prune(Path(command[1]), command[2]))
            generation.main(command)
        if args[0] == "run" and generation.ORIGIN in args:
            return json.dumps({"line": self.line, "main": self.main, "research": 2, "paper": 1})
        if args[0] == "compose" and args[-1] == "ledger" and "up" in args:
            self.started = True
        return ""

    def result(self, *args: str):
        self.calls.append(args)
        if generation.WHERE in args:
            return SimpleNamespace(returncode=0, stderr="", stdout=json.dumps(
                {"remote": self.stored, "tracked": self.tracked, "line": self.ledger_line, "head": HEAD}))
        if args[0] == "exec":
            if self.published and self.started and self.moves and self.tracked == ["v0.5"]:
                self.tracked, self.ledger_line = ["main"], "v0.5"
            elif self.published and not self.tracked:
                self.tracked = ["main"]
            return SimpleNamespace(returncode=0 if self.published else 1, stderr="PUBLISH_FAILED",
                                   stdout=json.dumps({"remote": self.stored}) if self.published else "")
        database = args[-1]
        refused = database in self.unread
        return SimpleNamespace(returncode=1 if refused else 0, stdout="", stderr=REFUSAL if refused else "")


class DoltHub:
    """DoltHub's API on the research repository's main: its state, the line tag on its history, every request."""

    def __init__(self, state: str, line: str | None = "v0.5", schema: str = "2"):
        self.state, self.line, self.schema, self.requests = state, line, schema, []

    def __call__(self, request, timeout):
        self.requests.append(request)
        query = urllib.parse.unquote(request.full_url.split("?q=", 1)[1])
        if self.state == "data":
            rows = ([{"tag_name": f"line/{self.line}", "tag_hash": "t" * 32}] if self.line else []) \
                if "dolt_tags" in query else [{"n": "1"}] if "dolt_log" in query else [{"version": self.schema}]
            return io.BytesIO(json.dumps({"query_execution_status": "Success", "rows": rows}).encode())
        message = {"absent": "no such repository", "empty": generation.NO_BRANCH, "other": generation.NO_TABLE}.get(
            self.state, "query error: something else")
        raise urllib.error.HTTPError(request.full_url, 400, "", {}, io.BytesIO(json.dumps(
            {"query_execution_status": "Error", "query_execution_message": message}).encode()))


class CutoverTests(unittest.TestCase):
    """A version of a later line starts a new data generation on the workstation, and the first 0.5.4 update moves
    the v0.5 ledger onto main (deploy/update.py Cutover; docs/plans/main-is-the-ledger-in-use-20261123.zh.md)."""

    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.data = Path(temporary.name)
        self.volume = fill(self.data)
        self.env = self.data / ".env"
        self.env.write_text(f"TRADE_DATA={self.data}\nTRADE_RESEARCH_ORIGIN={BASE}\n")
        self.docker = Workstation(self.data, self.volume)
        self.hub = DoltHub("data")
        self.now = 0.0
        self.cutover = Cutover(self.docker, self.env, self.data, ADMITTED, SERVICE, opener=self.hub,
                               sleep=self.sleep, clock=lambda: self.now)
        self.running = {"ledger": {"state": "running"}}

    def sleep(self, seconds: float) -> None:
        self.now += seconds

    def stopped(self) -> bool:
        return any(call[-1:] == ("stop",) for call in self.docker.calls)

    def test_a_later_line_is_a_new_generation_even_with_the_same_schema(self):
        self.assertEqual(self.cutover.assess(self.running), ({}, "cutover"))
        self.docker.unread = {"research"}
        self.assertEqual(self.cutover.assess(self.running), ({"research": "2"}, "cutover"))
        self.docker.unread, self.docker.line = set(), "v0.5"
        self.assertEqual(self.cutover.assess(self.running), ({}, "same"))
        self.docker.line = "v0.4"
        with self.assertRaisesRegex(RuntimeError, "does not go back a line"):
            self.cutover.assess(self.running)
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
        self.docker.line, self.docker.tracked, self.docker.ledger_line = "v0.5", ["v0.5"], None
        self.assertEqual(self.cutover.assess(self.running, check=True), ({}, "move"))
        self.assertNotIn("TRADE_RESEARCH_ORIGIN", read_env(self.env), "--check changes nothing")
        self.assertEqual(self.cutover.wanted["origin"], BASE)
        self.assertEqual(self.cutover.assess(self.running), ({}, "move"))
        self.assertEqual(read_env(self.env)["TRADE_RESEARCH_ORIGIN"], BASE)
        self.env.write_text(f"TRADE_DATA={self.data}\n")
        self.docker.unread = {"research"}  # refused: nothing named
        with self.assertRaisesRegex(RuntimeError, "another schema generation"):
            self.cutover.assess(self.running)
        self.assertNotIn("TRADE_RESEARCH_ORIGIN", read_env(self.env))

    def test_a_ledger_publishing_elsewhere_tracking_other_branches_or_without_a_line_is_refused(self):
        for stored, tracked, line, text in ((f"{BASE}-other", ["main"], "v0.5", "publishes to .*-other, not to"),
                                            (f"{BASE}-g2", ["main"], "v0.5", "not to"),
                                            (BASE, ["main", "v0.4"], "v0.5", "does not move onto main"),
                                            (BASE, ["v0.5"], None, "does not move onto main"),
                                            (BASE, ["main"], None, "no line tag")):
            with self.subTest(stored=stored, tracked=tracked, line=line):
                self.docker.stored, self.docker.tracked, self.docker.ledger_line = stored, tracked, line
                with self.assertRaisesRegex(RuntimeError, text):
                    self.cutover.assess(self.running)
        self.assertFalse(self.stopped())

    def test_a_ledger_not_yet_published_publishes_first(self):
        self.docker.line, self.docker.tracked = "v0.5", []
        output = io.StringIO()
        with redirect_stdout(output):
            self.assertEqual(self.cutover.assess(self.running, check=True)[1], "unpublished")
        self.assertNotIn(PUBLISH, self.docker.calls, "--check publishes nothing")
        self.assertEqual(self.cutover.assess(self.running), ({}, "same"))
        self.assertIn(PUBLISH, self.docker.calls)
        self.docker.tracked, self.docker.published = [], False
        with self.assertRaisesRegex(RuntimeError, "has not published to main"):
            self.cutover.assess(self.running)

    def test_the_v0_5_ledger_0_5_3_left_moves_onto_main(self):
        self.docker.line, self.docker.tracked, self.docker.ledger_line = "v0.5", ["v0.5"], None
        self.assertEqual(self.cutover.assess(self.running)[1], "move")
        self.docker.published = False
        with self.assertRaisesRegex(RuntimeError, "publish failed"):
            self.cutover.move(check=False)
        self.docker.published = True
        self.docker.calls.clear()
        self.cutover.move(check=False)
        self.assertFalse(self.stopped())
        self.assertEqual(self.docker.tracked, ["v0.5"], "the old ledger publishes as it did")
        self.cutover.moved(["compose"])
        up = self.docker.calls.index(("compose", "up", "--detach", "--wait", "--wait-timeout", "1800", "ledger"))
        publishes = [index for index, call in enumerate(self.docker.calls) if call == PUBLISH]
        self.assertEqual(len(publishes), 2)
        self.assertLess(publishes[0], up, "the old copy is complete before the version's ledger starts")
        self.assertGreater(publishes[1], up, "then the version's ledger moves onto main")
        self.assertEqual((self.docker.tracked, self.docker.ledger_line), (["main"], "v0.5"))
        self.assertEqual(self.cutover.assess(self.running), ({}, "same"), "the next update has nothing to do")
        self.assertEqual(self.hub.requests, [], "a move asks DoltHub nothing: the ledger's own publish checks")

    def test_a_move_waits_for_the_ledger_s_own_rounds_and_then_gives_up_loudly(self):
        self.docker.line, self.docker.tracked, self.docker.ledger_line = "v0.5", ["v0.5"], None
        self.cutover.assess(self.running)
        self.docker.moves = False  # a publish round of the ledger holds the move
        rounds = iter(range(5))

        def later(seconds):
            self.sleep(seconds)
            if next(rounds) == 3:
                self.docker.tracked, self.docker.ledger_line = ["main"], "v0.5"

        self.cutover.sleep = later
        self.cutover.moved(["compose"])
        self.assertEqual(self.now, 4 * 20)
        self.docker.tracked, self.docker.ledger_line, self.now = ["v0.5"], None, 0.0
        self.cutover.sleep = self.sleep
        with self.assertRaisesRegex(RuntimeError, "is not on main yet"):
            self.cutover.moved(["compose"])
        self.assertGreaterEqual(self.now, 1800)

    def test_a_version_older_than_0_5_4_is_refused(self):
        for line in (None, "v0.5", "v0.6"):
            with self.subTest(line=line):
                self.docker.line, self.docker.main = line, False  # 0.5.3 published its ledger as its line's branch
                with self.assertRaisesRegex(RuntimeError, "older than 0.5.4"):
                    self.cutover.assess(self.running)
        self.assertFalse(self.stopped())
        self.assertFalse([call for call in self.docker.calls if call[0] == "exec"], "not even a publish")

    def test_a_new_generation_archives_the_ledger_and_starts_it_alone_first(self):
        older = self.data / generation.ARCHIVE / ("20260101T000000Z-" + "c" * 12)
        older.mkdir(parents=True)
        journal = self.cutover.begin(self.cutover.assess(self.running)[0], check=False)
        self.assertEqual(journal["phase"], "archiving")
        self.assertFalse(self.stopped(), "nothing changes before the journal")
        self.assertTrue(all(request.full_url.startswith(generation.API + "owner/research/main?q=")
                            for request in self.hub.requests), "main is asked about, read-only")
        self.assertEqual({request.get_method() for request in self.hub.requests}, {"GET"})
        self.docker.calls.clear()
        with patch("deploy.update.services", return_value=self.running):
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
        others = self.docker.calls.index(("compose", "-p", "trade-ide", "stop", "ide", "market-import", "paper",
                                          "docker-api"))
        self.assertLess(others, self.docker.calls.index(PUBLISH), "nothing else writes when it publishes last")
        self.assertLess(self.docker.calls.index(PUBLISH), self.docker.calls.index(("compose", "-p", "trade-ide",
                                                                                   "stop")),
                        "the old ledger publishes before it stops")

    def test_a_failed_last_publish_stops_the_cutover_before_the_ledger_stops(self):
        self.cutover.assess(self.running)
        journal = self.cutover.begin({}, check=False)
        self.docker.published = False
        with patch("deploy.update.services", return_value=self.running), \
                self.assertRaisesRegex(RuntimeError, "after the other services stopped failed"):
            self.cutover.run(journal, ["compose"])
        self.assertFalse(self.stopped(), "the ledger still runs")
        self.assertTrue((self.data / "dolt/service.json").is_file(), "nothing archived")
        self.docker.published = True
        with patch("deploy.update.services", return_value={}):  # a ledger this step removed after publishing
            self.cutover.run(journal, ["compose"])
        self.assertFalse(self.cutover.journal.exists())

    def test_a_resumed_cutover_starts_a_stopped_old_ledger_to_publish_before_archiving(self):
        self.cutover.assess(self.running)
        journal = self.cutover.begin({}, check=False)
        self.docker.calls.clear()
        with patch("deploy.update.services", return_value={"ledger": {"state": "exited"}}):
            self.cutover.run(journal, ["compose"])
        start = self.docker.calls.index(("start", LEDGER))
        self.assertLess(start, self.docker.calls.index(PUBLISH))
        self.assertLess(self.docker.calls.index(PUBLISH), self.docker.calls.index(("compose", "stop")))
        self.cutover.journal.write_text(json.dumps(journal))
        self.docker.published = False
        with patch("deploy.update.services", return_value={"ledger": {"state": "exited"}}), \
                self.assertRaisesRegex(RuntimeError, "after the other services stopped failed"):
            self.cutover.run(journal, ["compose"])

    def test_what_main_holds_decides_before_anything_changes(self):
        self.cutover.assess(self.running)
        for hub, text in ((DoltHub("absent"), "does not exist on DoltHub; create it once"),
                          (DoltHub("other"), "holds no research ledger"),
                          (DoltHub("data", "v0.4"), "neither this ledger's v0.5 nor the version's v0.6"),
                          (DoltHub("data", None), "unknown \\(no line tag\\)"),
                          (DoltHub("data", "v0.6", "3"), "schema generation 3, not 2")):
            with self.subTest(state=hub.state, line=hub.line):
                self.cutover.opener = hub
                with self.assertRaisesRegex(RuntimeError, text):
                    self.cutover.begin({}, check=False)
        self.cutover.opener = DoltHub("unknown")
        with self.assertRaises(generation.OriginUnreadable):
            self.cutover.begin({}, check=False)
        for hub in (DoltHub("data", "v0.5"), DoltHub("data", "v0.6"), DoltHub("empty")):
            with self.subTest(fine=hub.state, line=hub.line):
                self.cutover.opener = hub
                self.assertEqual(self.cutover.begin({}, check=False)["phase"], "archiving")
                self.cutover.journal.unlink()
        self.docker.published = False
        requests = len(self.hub.requests)
        for found in ({}, {"paper": "2"}, {"research": "2"}):
            with self.subTest(found=found), self.assertRaisesRegex(RuntimeError, "publish failed"):
                self.cutover.begin(found, check=False)
        self.assertEqual(len(self.hub.requests), requests, "a failed publish refuses before anything else")
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
        with self.assertRaisesRegex(RuntimeError, "not a cutover journal"):
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

    def test_the_first_0_5_4_update_moves_the_ledger_onto_main_then_moves_the_services(self):
        with tempfile.TemporaryDirectory() as directory:
            data = Path(directory)
            docker = Workstation(data, fill(data))
            docker.line, docker.tracked, docker.ledger_line = "v0.5", ["v0.5"], None
            (data / ".env").write_text(f"TRADE_DATA={data}\nTRADE_RESEARCH_ORIGIN={BASE}\nTRADE_SERVICE_IMAGE=old\n")
            hub = DoltHub("data", None)
            self.update(data, docker, hub)
            self.assertEqual(read_env(data / ".env")["TRADE_SERVICE_IMAGE"], SERVICE)
            self.assertEqual((docker.tracked, docker.ledger_line), (["main"], "v0.5"))
            self.assertEqual(hub.requests, [])
            composed = [call for call in docker.calls if call[0] == "compose"]
            self.assertFalse([call for call in composed if call[-1] == "stop"], "nothing is archived")
            ledger = next(index for index, call in enumerate(docker.calls) if call[0] == "compose"
                          and call[-1] == "ledger")
            everything = next(index for index, call in enumerate(docker.calls) if call[0] == "compose"
                              and call[-2:] == ("up", "-d"))
            self.assertLess(ledger, everything, "the moved ledger is on main before the other services move")


def fill(data: Path) -> Path:
    for path, text in (("dolt/service.json", "{}"), ("dolt/paper/7/run.json", "{}"), ("ledgers/research.json", "{}"),
                       ("ledgers/market.json", "{}"), ("dolt-backups/research/b", "b"), ("volume/research/x", "x")):
        (data / path).parent.mkdir(parents=True, exist_ok=True)
        (data / path).write_text(text)
    return data / "volume"


if __name__ == "__main__":
    unittest.main()
