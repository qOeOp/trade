from __future__ import annotations

import unittest
from unittest.mock import patch

import github_handoff_barrier as barrier


HEAD = "a" * 40
BASE = "b" * 40
PROVIDER = "chatgpt-codex-connector"
EXPECTATION = {
    "repository": "owner/repo",
    "pull_request": 39,
    "head": HEAD,
    "base": BASE,
    "provider": PROVIDER,
    "trigger_actor": "owner",
}


def review_trigger(
    head: str = HEAD,
    *,
    identifier: str = "trigger",
    body: str | None = None,
    reactions: list[dict[str, str]] | None = None,
) -> dict[str, object]:
    return {
        "id": identifier,
        "login": "owner",
        "body": body if body is not None else barrier.trigger_body(head),
        "created_at": "2026-07-30T07:00:00Z",
        "reactions": reactions
        if reactions is not None
        else [
            {
                "content": "THUMBS_UP",
                "login": f"{PROVIDER}[bot]",
                "created_at": "2026-07-30T07:01:00Z",
            }
        ],
    }


def snapshot(**overrides: object) -> dict[str, object]:
    value: dict[str, object] = {
        "repository": "owner/repo",
        "pull_request": 39,
        "head": HEAD,
        "base": BASE,
        "state": "OPEN",
        "is_draft": False,
        "merged_at": None,
        "merge_commit": None,
        "auto_merge_armed": False,
        "comments": [review_trigger()],
        "reviews": [],
        "threads": [],
        "required_checks": [
            {
                "name": "quality",
                "state": "SUCCESS",
                "bucket": "pass",
                "workflow": "repository-quality",
            }
        ],
        "required_contexts": ["quality"],
    }
    value.update(overrides)
    return value


class BarrierTests(unittest.TestCase):
    def test_no_thread_review_shell_is_not_terminal(self) -> None:
        current = snapshot(
            comments=[review_trigger(reactions=[])],
            reviews=[
                {
                    "id": "review",
                    "login": PROVIDER,
                    "state": "COMMENTED",
                    "submitted_at": "2026-07-30T07:01:00Z",
                    "commit": HEAD,
                }
            ],
        )
        self.assertEqual(
            barrier.inspect_snapshot(current, EXPECTATION)["status"],
            "pending",
        )
        current["reviews"][0]["submitted_at"] = None
        self.assertEqual(
            barrier.inspect_snapshot(current, EXPECTATION)["status"],
            "pending",
        )

    def test_review_is_terminal_only_with_its_associated_thread(self) -> None:
        review = {
            "id": "review",
            "login": PROVIDER,
            "state": "COMMENTED",
            "submitted_at": "2026-07-30T07:01:00Z",
            "commit": HEAD,
        }
        unrelated = {
            "id": "thread",
            "is_resolved": True,
            "is_outdated": False,
            "comments": [
                {
                    "id": "comment",
                    "login": PROVIDER,
                    "created_at": "2026-07-30T07:01:01Z",
                    "review_id": "another-review",
                }
            ],
        }
        self.assertEqual(
            barrier.inspect_snapshot(
                snapshot(
                    comments=[review_trigger(reactions=[])],
                    reviews=[review],
                    threads=[unrelated],
                ),
                EXPECTATION,
            )["status"],
            "pending",
        )
        related = dict(unrelated)
        related["comments"] = [
            {
                "id": "comment",
                "login": PROVIDER,
                "created_at": "2026-07-30T07:01:01Z",
                "review_id": "review",
            }
        ]
        self.assertEqual(
            barrier.inspect_snapshot(
                snapshot(
                    comments=[review_trigger(reactions=[])],
                    reviews=[review],
                    threads=[related],
                ),
                EXPECTATION,
            )["status"],
            "ready",
        )

    def test_late_thread_blocks_before_settle_can_pass(self) -> None:
        now = 0.0
        index = 0
        review = {
            "id": "review",
            "login": PROVIDER,
            "state": "COMMENTED",
            "submitted_at": "2026-07-30T07:01:00Z",
            "commit": HEAD,
        }
        late_thread = {
            "id": "late-thread",
            "is_resolved": False,
            "is_outdated": False,
            "comments": [
                {
                    "id": "late-comment",
                    "login": PROVIDER,
                    "created_at": "2026-07-30T07:01:01Z",
                    "review_id": "review",
                }
            ],
        }
        snapshots = [
            snapshot(comments=[review_trigger(reactions=[])], reviews=[review]),
            snapshot(
                comments=[review_trigger(reactions=[])],
                reviews=[review],
                threads=[late_thread],
            ),
        ]

        def load() -> dict[str, object]:
            nonlocal index
            value = snapshots[min(index, len(snapshots) - 1)]
            index += 1
            return value

        def clock() -> float:
            return now

        def sleep(seconds: float) -> None:
            nonlocal now
            now += seconds

        decision = barrier.wait_for_barrier(
            EXPECTATION,
            load,
            settle_seconds=2,
            timeout_seconds=10,
            poll_seconds=1,
            clock=clock,
            sleep=sleep,
        )
        self.assertEqual(decision["status"], "blocked")
        self.assertIn("unresolved", decision["reason"])

    def test_unmarked_or_concurrent_trigger_blocks(self) -> None:
        unmarked = review_trigger(body="@codex review", reactions=[])
        self.assertEqual(
            barrier.inspect_snapshot(snapshot(comments=[unmarked]), EXPECTATION)[
                "status"
            ],
            "blocked",
        )
        duplicate = review_trigger(identifier="duplicate")
        self.assertEqual(
            barrier.inspect_snapshot(
                snapshot(comments=[review_trigger(), duplicate]),
                EXPECTATION,
            )["status"],
            "blocked",
        )

    def test_prior_marked_attempt_must_be_terminal(self) -> None:
        old = review_trigger("c" * 40, identifier="old", reactions=[])
        decision = barrier.inspect_snapshot(
            snapshot(comments=[old, review_trigger()]),
            EXPECTATION,
        )
        self.assertEqual(decision["status"], "pending")
        self.assertIn("prior", decision["reason"])

    def test_merged_observation_precedes_open_base_check(self) -> None:
        decision = barrier.inspect_snapshot(
            snapshot(
                base="c" * 40,
                merged_at="2026-07-30T08:00:00Z",
                merge_commit="d" * 40,
            ),
            EXPECTATION,
        )
        self.assertEqual(decision["status"], "merged")
        self.assertEqual(decision["merge_commit"], "d" * 40)
        self.assertEqual(
            barrier.inspect_snapshot(
                snapshot(
                    head="c" * 40,
                    base="c" * 40,
                    merged_at="2026-07-30T08:00:00Z",
                    merge_commit="d" * 40,
                ),
                EXPECTATION,
            )["status"],
            "blocked",
        )

    def test_checks_threads_identity_and_auto_merge_fail_closed(self) -> None:
        self.assertEqual(
            barrier.inspect_snapshot(snapshot(required_checks=[]), EXPECTATION)[
                "status"
            ],
            "pending",
        )
        missing = barrier.inspect_snapshot(
            snapshot(
                required_contexts=["quality", "codeql-python"],
            ),
            EXPECTATION,
        )
        self.assertEqual(missing["status"], "pending")
        self.assertIn("codeql-python", missing["reason"])
        self.assertEqual(
            barrier.inspect_snapshot(
                snapshot(
                    required_checks=[
                        {
                            "name": "quality",
                            "state": "FAILURE",
                            "bucket": "fail",
                            "workflow": "repository-quality",
                        }
                    ]
                ),
                EXPECTATION,
            )["status"],
            "blocked",
        )
        self.assertEqual(
            barrier.inspect_snapshot(snapshot(auto_merge_armed=True), EXPECTATION)[
                "status"
            ],
            "blocked",
        )
        self.assertEqual(
            barrier.inspect_snapshot(snapshot(base="c" * 40), EXPECTATION)["status"],
            "blocked",
        )

    def test_stable_ready_activity_passes_after_window(self) -> None:
        now = 0.0
        loads = 0

        def load() -> dict[str, object]:
            nonlocal loads
            loads += 1
            return snapshot()

        def clock() -> float:
            return now

        def sleep(seconds: float) -> None:
            nonlocal now
            now += seconds

        decision = barrier.wait_for_barrier(
            EXPECTATION,
            load,
            settle_seconds=2,
            timeout_seconds=10,
            poll_seconds=1,
            clock=clock,
            sleep=sleep,
        )
        self.assertEqual(decision["status"], "ready")
        self.assertEqual(loads, 3)

    def test_merge_command_is_direct_and_guarded(self) -> None:
        arguments = barrier.merge_arguments(EXPECTATION)
        self.assertEqual(
            arguments,
            [
                "gh",
                "pr",
                "merge",
                "--repo",
                "owner/repo",
                "--squash",
                "--match-head-commit",
                HEAD,
                "39",
            ],
        )
        self.assertNotIn("--auto", arguments)
        self.assertNotIn("--admin", arguments)

    def test_pagination_collects_every_page_and_rejects_stalled_cursor(
        self,
    ) -> None:
        pages = {
            None: {
                "nodes": [{"id": "one"}],
                "pageInfo": {"hasNextPage": True, "endCursor": "next"},
            },
            "next": {
                "nodes": [{"id": "two"}],
                "pageInfo": {"hasNextPage": False, "endCursor": "done"},
            },
        }
        self.assertEqual(
            [node["id"] for node in barrier.page_nodes(pages.__getitem__)],
            ["one", "two"],
        )
        stalled = {
            "nodes": [],
            "pageInfo": {"hasNextPage": True, "endCursor": "same"},
        }
        with self.assertRaises(barrier.BarrierError):
            barrier.page_nodes(lambda _cursor: stalled)

    def test_required_contexts_are_loaded_from_base_rules(self) -> None:
        calls: list[list[str]] = []

        def runner(
            arguments: list[str],
        ) -> barrier.subprocess.CompletedProcess[str]:
            calls.append(arguments)
            return barrier.subprocess.CompletedProcess(
                arguments,
                0,
                stdout=(
                    '[{"type":"required_status_checks","parameters":'
                    '{"required_status_checks":['
                    '{"context":"quality"},{"context":"codeql-python"},'
                    '{"context":"quality"}]}}]'
                ),
                stderr="",
            )

        self.assertEqual(
            barrier.load_required_contexts("owner/repo", "release/v1", runner),
            ["codeql-python", "quality"],
        )
        self.assertEqual(
            calls,
            [["gh", "api", "repos/owner/repo/rules/branches/release%2Fv1"]],
        )

    def test_non_finite_timing_is_rejected(self) -> None:
        common = [
            "github_handoff_barrier.py",
            "--repo",
            "owner/repo",
            "--pr",
            "39",
            "--head",
            HEAD,
            "--base",
            BASE,
        ]
        for flag, value in [
            ("--settle-seconds", "nan"),
            ("--timeout-seconds", "inf"),
            ("--poll-seconds", "-inf"),
        ]:
            with (
                self.subTest(flag=flag),
                patch(
                    "sys.argv",
                    [*common, f"{flag}={value}"],
                ),
            ):
                with self.assertRaises(SystemExit):
                    barrier.parse_arguments()


if __name__ == "__main__":
    unittest.main()
