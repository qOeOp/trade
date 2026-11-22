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
REFUSAL = '{"code": "SCHEMA_MISMATCH", "message": "research schema version 1, this code expects 2", "expected": "2"}'


class Workstation(Fake):
    """Docker on a workstation whose ledger holds generation 1: the version's checks, the old ledger's publish, the
    archive (run on the temporary data with the version's own code) and compose."""

    def __init__(self, data: Path, volume: Path):
        super().__init__({})
        self.data, self.volume = data, volume
        self.unread = {"research"}
        self.published = True
        self.stored = f"{BASE}-g2"  # where the running ledger publishes
        self.volumes = {generation.VOLUME}

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
            return json.dumps({"origin": f"{BASE}-g2", "research": 2, "paper": 1})
        return ""

    def result(self, *args: str):
        self.calls.append(args)
        if args[0] == "exec" and "status" in args:
            return SimpleNamespace(returncode=0, stderr="", stdout=json.dumps({"running": True, "remote": self.stored}))
        if args[0] == "exec":
            return SimpleNamespace(returncode=0 if self.published else 1, stderr="PUBLISH_FAILED",
                                   stdout=json.dumps({"remote": BASE}) if self.published else "")
        database = args[-1]
        refused = database in self.unread
        return SimpleNamespace(returncode=1 if refused else 0, stdout="", stderr=REFUSAL if refused else "")


class DoltHub:
    """DoltHub's API: one repository's state, and every request made."""

    def __init__(self, state: str):
        self.state, self.requests = state, []

    def __call__(self, request, timeout):
        self.requests.append(request)
        if request.get_method() == "POST":
            self.state = "empty"
            return io.BytesIO(b"{}")
        if self.state == "data":
            return io.BytesIO(json.dumps({"query_execution_status": "Success", "rows": [{"version": "2"}]}).encode())
        message = {"absent": "no such repository", "empty": "query error: table not found: ledger_schema"}.get(
            self.state, "query error: something else")
        raise urllib.error.HTTPError(request.full_url, 400, "", {}, io.BytesIO(json.dumps(
            {"query_execution_status": "Error", "query_execution_message": message}).encode()))


class CutoverTests(unittest.TestCase):
    """A version of another schema generation starts a new data generation on the workstation (deploy/update.py
    Cutover; docs/plans/data-generation-in-release-20261123.zh.md)."""

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

    def test_only_a_schema_mismatch_is_a_new_generation(self):
        self.assertEqual(self.cutover.unread(self.running), {"research": "2"})
        self.docker.unread = set()
        self.assertEqual(self.cutover.unread(self.running), {})
        self.assertEqual(self.cutover.unread({}), {}, "a first start has nothing to compare")
        with self.assertRaisesRegex(RuntimeError, "not running"):
            self.cutover.unread({"ledger": {"state": "exited"}})

    def test_a_ledger_of_this_generation_publishing_elsewhere_is_refused(self):
        self.docker.unread = set()
        self.docker.stored = BASE  # generation 1's repository, while the version names generation 2's
        with self.assertRaisesRegex(RuntimeError, f"publishes to {BASE}, but .*{BASE}-g2"):
            self.cutover.unread(self.running)
        self.assertFalse(self.stopped())
        self.env.write_text(f"TRADE_DATA={self.data}\n")
        self.assertEqual(self.cutover.unread(self.running), {}, "without a base there is nothing to compare")

    def test_a_new_generation_archives_the_ledger_and_starts_it_alone_first(self):
        older = self.data / generation.ARCHIVE / ("20260101T000000Z-" + "c" * 12)
        older.mkdir(parents=True)
        journal = self.cutover.begin(self.cutover.unread(self.running), check=False)
        self.assertEqual(journal["phase"], "archiving")
        self.assertFalse(self.stopped(), "nothing changes before the journal")
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
        self.assertTrue(self.docker.calls.index(("exec", LEDGER, "python", "-m", "cli.main", "ledger", "publish",
                                                 "--ledger", "research")) < self.docker.calls.index(
            ("compose", "-p", "trade-ide", "stop")), "the old ledger publishes before it stops")

    def test_a_missing_repository_is_created_with_the_token_or_nothing_changes(self):
        self.hub.state = "absent"
        with self.assertRaisesRegex(RuntimeError, f"owner/research-g2 does not exist.*{self.data / 'dolthub-token'}"):
            self.cutover.begin({"research": "2"}, check=False)
        self.assertFalse(self.cutover.journal.exists())
        self.assertFalse(self.stopped())
        (self.data / "dolthub-token").write_text("secret-token\n")
        output = io.StringIO()
        with redirect_stdout(output):
            journal = self.cutover.begin({"research": "2"}, check=False)
        self.assertIsNotNone(journal)
        [post] = [request for request in self.hub.requests if request.get_method() == "POST"]
        self.assertEqual(post.get_header("Authorization"), "token secret-token")
        self.assertEqual(json.loads(post.data)["repoName"], "research-g2")
        self.assertNotIn("secret-token", output.getvalue())

    def test_refusals_before_anything_changes(self):
        self.hub.state = "data"
        self.docker.run = None
        with patch.object(generation, "version", return_value={"origin": f"{BASE}-g2", "research": 3, "paper": 1}), \
                self.assertRaisesRegex(RuntimeError, "schema generation 2, not 3"):
            self.cutover.begin({"research": "3"}, check=False)
        self.docker.published = False
        for found in ({"paper": "2"}, {"research": "2"}, {"research": "2", "paper": "2"}):
            with self.subTest(found=found), self.assertRaisesRegex(RuntimeError, "publish failed"):
                self.cutover.begin(found, check=False)
        self.assertFalse([call for call in self.docker.calls if call[0] == "run" and generation.ORIGIN in call],
                         "a failed publish refuses before anything else")
        self.hub.state = "unknown"  # DoltHub answers something that is neither a repository nor its absence
        self.docker.published = True
        with self.assertRaises(generation.OriginUnreadable):
            self.cutover.begin({"research": "2"}, check=False)
        self.assertFalse([request for request in self.hub.requests if request.get_method() == "POST"])
        self.env.write_text(f"TRADE_DATA={self.data}\n")
        self.hub.state = "absent"
        with self.assertRaisesRegex(RuntimeError, "does not exist"):
            self.cutover.begin({"research": "2"}, check=False)
        self.assertNotIn("TRADE_RESEARCH_ORIGIN", read_env(self.env), "a refusal leaves the env file as it was")
        self.assertIsNone(self.cutover.begin({"research": "2"}, check=True))
        self.assertFalse(self.cutover.journal.exists())
        self.assertFalse(self.stopped())

    def test_the_base_comes_from_the_old_ledger_when_the_env_file_names_none(self):
        self.env.write_text(f"TRADE_DATA={self.data}\n")
        self.cutover.begin({"research": "2"}, check=False)
        self.assertEqual(read_env(self.env)["TRADE_RESEARCH_ORIGIN"], BASE)

    def test_an_interrupted_cutover_goes_on_from_its_step(self):
        journal = self.cutover.begin({"research": "2"}, check=False)
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


class MainTests(unittest.TestCase):
    def test_a_refused_cutover_leaves_the_env_file_and_the_definition_as_they_were(self):
        with tempfile.TemporaryDirectory() as directory:
            data = Path(directory)
            volume = fill(data)
            env = data / ".env"
            before = f"TRADE_DATA={data}\nTRADE_RESEARCH_ORIGIN={BASE}\nTRADE_SERVICE_IMAGE=old\n"
            env.write_text(before)
            docker = Workstation(data, volume)
            source = Mock()
            source.git.return_value = "services: {}\n"
            with patch("deploy.update.paper_busy", return_value=[]), \
                    patch("deploy.update.services", return_value={"ledger": {"state": "running", "revision": None}}), \
                    patch("deploy.update.channel_source", return_value=(source, "deploy")), \
                    patch("deploy.update.resolve", return_value=(ADMITTED, {"TRADE_SERVICE_IMAGE": SERVICE})), \
                    patch("deploy.update.urllib.request.urlopen", DoltHub("absent")), \
                    self.assertRaisesRegex(RuntimeError, "does not exist"):
                main(["--env", str(env), "--arch", "arm64"], docker)
            self.assertEqual(env.read_text(), before)
            self.assertFalse((data / "deploy" / ADMITTED).exists())
            self.assertFalse([call for call in docker.calls if call[0] == "compose"])


def fill(data: Path) -> Path:
    for path, text in (("dolt/service.json", "{}"), ("dolt/paper/7/run.json", "{}"), ("ledgers/research.json", "{}"),
                       ("ledgers/market.json", "{}"), ("dolt-backups/research/b", "b"), ("volume/research/x", "x")):
        (data / path).parent.mkdir(parents=True, exist_ok=True)
        (data / path).write_text(text)
    return data / "volume"


if __name__ == "__main__":
    unittest.main()
