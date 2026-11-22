"""What a workstation update recreates, refuses and removes, with Docker faked."""
from datetime import datetime, timedelta, UTC
import json
from pathlib import Path
import tempfile
import unittest

from deploy.update import Docker, main, paper_busy, plan, read_env, relation, removable, stale_replays


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


if __name__ == "__main__":
    unittest.main()
