#!/usr/bin/env python3

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
import time
from collections.abc import Callable
from typing import Any, cast


MARKER_PREFIX = "trade-final-head-review"
PROVIDER_DEFAULT = "chatgpt-codex-connector"
MARKER_PATTERN = re.compile(rf"<!--\s*{MARKER_PREFIX}:([0-9a-f]{{40}})\s*-->")
TRIGGER_PATTERN = re.compile(r"(?i)(?:^|\s)@codex\s+review(?:\s|$)")

Snapshot = dict[str, Any]
Expectation = dict[str, Any]
Decision = dict[str, Any]
Runner = Callable[[list[str]], subprocess.CompletedProcess[str]]


class BarrierError(RuntimeError):
    pass


def run_command(arguments: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        arguments,
        check=False,
        capture_output=True,
        text=True,
    )


def require_success(result: subprocess.CompletedProcess[str], description: str) -> str:
    if result.returncode != 0:
        detail = result.stderr.strip() or result.stdout.strip()
        raise BarrierError(f"{description} failed: {detail}")
    return result.stdout


def actor_matches(actual: str, expected: str) -> bool:
    return actual.removesuffix("[bot]") == expected.removesuffix("[bot]")


def marker(head: str) -> str:
    return f"<!-- {MARKER_PREFIX}:{head} -->"


def trigger_body(head: str) -> str:
    return f"@codex review\n\n{marker(head)}"


def merge_arguments(expectation: Expectation) -> list[str]:
    return [
        "gh",
        "pr",
        "merge",
        "--repo",
        expectation["repository"],
        "--squash",
        "--match-head-commit",
        expectation["head"],
        str(expectation["pull_request"]),
    ]


def activity_fingerprint(snapshot: Snapshot) -> str:
    activity = {
        "comments": snapshot["comments"],
        "reviews": snapshot["reviews"],
        "threads": snapshot["threads"],
    }
    encoded = json.dumps(activity, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(encoded).hexdigest()


def marked_triggers(snapshot: Snapshot) -> tuple[list[dict[str, Any]], str | None]:
    triggers: list[dict[str, Any]] = []
    for comment in snapshot["comments"]:
        if not TRIGGER_PATTERN.search(comment["body"]):
            continue
        markers = MARKER_PATTERN.findall(comment["body"])
        if len(markers) != 1:
            return [], "unmarked or multiply marked Codex trigger is ambiguous"
        trigger = dict(comment)
        trigger["head"] = markers[0]
        triggers.append(trigger)
    return triggers, None


def terminal_signals(
    snapshot: Snapshot,
    trigger: dict[str, Any],
    provider: str,
) -> list[str]:
    thread_review_ids = {
        comment["review_id"]
        for thread in snapshot["threads"]
        for comment in thread["comments"]
        if comment["review_id"] and actor_matches(comment["login"], provider)
    }
    reviews = [
        review["id"]
        for review in snapshot["reviews"]
        if actor_matches(review["login"], provider)
        and review["commit"] == trigger["head"]
        and review["submitted_at"] > trigger["created_at"]
        and review["id"] in thread_review_ids
    ]
    thumbs_up = [
        reaction["created_at"]
        for reaction in trigger["reactions"]
        if actor_matches(reaction["login"], provider)
        and reaction["content"] == "THUMBS_UP"
        and reaction["created_at"] >= trigger["created_at"]
    ]
    return [f"review:{review_id}" for review_id in reviews] + [
        f"thumb:{created_at}" for created_at in thumbs_up
    ]


def inspect_attempts(
    snapshot: Snapshot,
    expectation: Expectation,
) -> Decision:
    fingerprint = activity_fingerprint(snapshot)
    triggers, trigger_error = marked_triggers(snapshot)
    if trigger_error:
        return {
            "status": "blocked",
            "reason": trigger_error,
            "fingerprint": fingerprint,
        }

    for trigger in triggers:
        if not actor_matches(trigger["login"], expectation["trigger_actor"]):
            return {
                "status": "blocked",
                "reason": "Codex trigger actor is not the frozen actor",
                "fingerprint": fingerprint,
            }

    current = [
        trigger for trigger in triggers if trigger["head"] == expectation["head"]
    ]
    if len(current) > 1:
        return {
            "status": "blocked",
            "reason": "multiple exact-head Codex triggers are ambiguous",
            "fingerprint": fingerprint,
        }

    for trigger in triggers:
        if current and trigger["id"] == current[0]["id"]:
            continue
        signals = terminal_signals(snapshot, trigger, expectation["provider"])
        if len(signals) == 0:
            return {
                "status": "pending",
                "reason": "a prior Codex review attempt is still outstanding",
                "fingerprint": fingerprint,
            }
        if len(signals) > 1:
            return {
                "status": "blocked",
                "reason": "a prior Codex review completion is ambiguous",
                "fingerprint": fingerprint,
            }

    if not current:
        return {
            "status": "pending",
            "reason": "exact-head Codex review has not been triggered",
            "fingerprint": fingerprint,
        }

    signals = terminal_signals(snapshot, current[0], expectation["provider"])
    if len(signals) == 0:
        return {
            "status": "pending",
            "reason": "exact-head Codex review is still outstanding",
            "fingerprint": fingerprint,
        }
    if len(signals) > 1:
        return {
            "status": "blocked",
            "reason": "exact-head Codex review completion is ambiguous",
            "fingerprint": fingerprint,
        }
    return {"status": "ready", "fingerprint": fingerprint}


def inspect_snapshot(snapshot: Snapshot, expectation: Expectation) -> Decision:
    fingerprint = activity_fingerprint(snapshot)
    if (
        snapshot["repository"] != expectation["repository"]
        or snapshot["pull_request"] != expectation["pull_request"]
    ):
        return {
            "status": "blocked",
            "reason": "repository or PR changed",
            "fingerprint": fingerprint,
        }
    if snapshot["head"] != expectation["head"]:
        return {
            "status": "blocked",
            "reason": "head changed",
            "fingerprint": fingerprint,
        }
    if snapshot["merged_at"]:
        if not snapshot["merge_commit"]:
            return {
                "status": "blocked",
                "reason": "merged PR is missing merge metadata",
                "fingerprint": fingerprint,
            }
        return {
            "status": "merged",
            "head": snapshot["head"],
            "merge_commit": snapshot["merge_commit"],
            "merged_at": snapshot["merged_at"],
            "fingerprint": fingerprint,
        }
    if snapshot["base"] != expectation["base"]:
        return {
            "status": "blocked",
            "reason": "base changed",
            "fingerprint": fingerprint,
        }
    if snapshot["state"] != "OPEN" or snapshot["is_draft"]:
        return {
            "status": "blocked",
            "reason": "PR is not open and ready",
            "fingerprint": fingerprint,
        }
    if snapshot["auto_merge_armed"]:
        return {
            "status": "blocked",
            "reason": "auto-merge is already armed",
            "fingerprint": fingerprint,
        }

    attempt = inspect_attempts(snapshot, expectation)
    if attempt["status"] != "ready":
        return attempt

    unresolved = [thread for thread in snapshot["threads"] if not thread["is_resolved"]]
    if unresolved:
        return {
            "status": "blocked",
            "reason": f"{len(unresolved)} review thread(s) remain unresolved",
            "fingerprint": fingerprint,
        }

    checks = snapshot["required_checks"]
    if not checks:
        return {
            "status": "pending",
            "reason": "required checks are not available",
            "fingerprint": fingerprint,
        }
    failed = [check for check in checks if check["bucket"] in {"fail", "cancel"}]
    if failed:
        names = ", ".join(check["name"] for check in failed)
        return {
            "status": "blocked",
            "reason": f"required check failed: {names}",
            "fingerprint": fingerprint,
        }
    if any(check["bucket"] != "pass" for check in checks):
        return {
            "status": "pending",
            "reason": "required checks are still pending",
            "fingerprint": fingerprint,
        }
    return {"status": "ready", "fingerprint": fingerprint}


def wait_for_barrier(
    expectation: Expectation,
    load: Callable[[], Snapshot],
    *,
    settle_seconds: float,
    timeout_seconds: float,
    poll_seconds: float,
    clock: Callable[[], float] = time.monotonic,
    sleep: Callable[[float], None] = time.sleep,
) -> Decision:
    deadline = clock() + timeout_seconds
    settled_fingerprint = ""
    settled_since = 0.0
    while clock() <= deadline:
        decision = inspect_snapshot(load(), expectation)
        if decision["status"] in {"blocked", "merged"}:
            return decision
        if decision["status"] == "ready":
            if decision["fingerprint"] != settled_fingerprint:
                settled_fingerprint = decision["fingerprint"]
                settled_since = clock()
            elif clock() - settled_since >= settle_seconds:
                return decision
        else:
            settled_fingerprint = ""
            settled_since = 0.0
        sleep(poll_seconds)
    return {
        "status": "pending",
        "reason": "review barrier timed out",
        "fingerprint": settled_fingerprint,
    }


def graphql(
    query: str,
    variables: dict[str, str | int],
    runner: Runner,
) -> dict[str, Any]:
    arguments = ["gh", "api", "graphql", "-f", f"query={query}"]
    for key, value in variables.items():
        arguments.extend(["-F", f"{key}={value}"])
    output = require_success(runner(arguments), "GitHub GraphQL query")
    raw_response: object = json.loads(output)
    if not isinstance(raw_response, dict):
        raise BarrierError("GitHub GraphQL response is not an object")
    response = cast(dict[str, Any], raw_response)
    if response.get("errors"):
        raise BarrierError(f"GitHub GraphQL errors: {response['errors']}")
    return response


CORE_QUERY = """
query($owner:String!,$name:String!,$number:Int!){
  repository(owner:$owner,name:$name){
    pullRequest(number:$number){
      number headRefOid baseRefOid state isDraft mergedAt
      mergeCommit{oid}
      autoMergeRequest{enabledAt}
    }
  }
}
"""

COMMENTS_QUERY = """
query($owner:String!,$name:String!,$number:Int!,$after:String){
  repository(owner:$owner,name:$name){
    pullRequest(number:$number){
      comments(first:100,after:$after){
        pageInfo{hasNextPage endCursor}
        nodes{
          id body createdAt author{login}
          reactions(first:100){
            pageInfo{hasNextPage endCursor}
            nodes{content createdAt user{login}}
          }
        }
      }
    }
  }
}
"""

REACTIONS_QUERY = """
query($id:ID!,$after:String){
  node(id:$id){
    ... on IssueComment{
      reactions(first:100,after:$after){
        pageInfo{hasNextPage endCursor}
        nodes{content createdAt user{login}}
      }
    }
  }
}
"""

REVIEWS_QUERY = """
query($owner:String!,$name:String!,$number:Int!,$after:String){
  repository(owner:$owner,name:$name){
    pullRequest(number:$number){
      reviews(first:100,after:$after){
        pageInfo{hasNextPage endCursor}
        nodes{id state submittedAt author{login} commit{oid}}
      }
    }
  }
}
"""

THREADS_QUERY = """
query($owner:String!,$name:String!,$number:Int!,$after:String){
  repository(owner:$owner,name:$name){
    pullRequest(number:$number){
      reviewThreads(first:100,after:$after){
        pageInfo{hasNextPage endCursor}
        nodes{
          id isResolved isOutdated
          comments(first:100){
            pageInfo{hasNextPage endCursor}
            nodes{id createdAt author{login} pullRequestReview{id}}
          }
        }
      }
    }
  }
}
"""

THREAD_COMMENTS_QUERY = """
query($id:ID!,$after:String){
  node(id:$id){
    ... on PullRequestReviewThread{
      comments(first:100,after:$after){
        pageInfo{hasNextPage endCursor}
        nodes{id createdAt author{login} pullRequestReview{id}}
      }
    }
  }
}
"""


def repository_parts(repository: str) -> tuple[str, str]:
    parts = repository.split("/")
    if len(parts) != 2 or not all(parts):
        raise BarrierError("--repo must be owner/name")
    return parts[0], parts[1]


def page_nodes(
    fetch: Callable[[str | None], dict[str, Any]],
) -> list[dict[str, Any]]:
    nodes: list[dict[str, Any]] = []
    cursor: str | None = None
    seen: set[str] = set()
    while True:
        page = fetch(cursor)
        nodes.extend(page["nodes"])
        info = page["pageInfo"]
        if not info["hasNextPage"]:
            return nodes
        cursor = info["endCursor"]
        if not cursor or cursor in seen:
            raise BarrierError("GitHub pagination cursor did not advance")
        seen.add(cursor)


def load_snapshot(
    expectation: Expectation,
    runner: Runner = run_command,
) -> Snapshot:
    owner, name = repository_parts(expectation["repository"])
    base_variables: dict[str, str | int] = {
        "owner": owner,
        "name": name,
        "number": expectation["pull_request"],
    }
    core_response = graphql(CORE_QUERY, base_variables, runner)
    pull_request = (
        core_response.get("data", {}).get("repository", {}).get("pullRequest")
    )
    if not pull_request:
        raise BarrierError("pull request was not found")

    def comments_page(cursor: str | None) -> dict[str, Any]:
        variables = dict(base_variables)
        if cursor:
            variables["after"] = cursor
        response = graphql(COMMENTS_QUERY, variables, runner)
        return cast(
            dict[str, Any],
            response["data"]["repository"]["pullRequest"]["comments"],
        )

    comments = page_nodes(comments_page)
    for comment in comments:
        reactions = list(comment["reactions"]["nodes"])
        info = comment["reactions"]["pageInfo"]
        cursor = info["endCursor"]
        reaction_seen: set[str] = set()
        while info["hasNextPage"]:
            if not cursor or cursor in reaction_seen:
                raise BarrierError("reaction pagination cursor did not advance")
            reaction_seen.add(cursor)
            response = graphql(
                REACTIONS_QUERY,
                {"id": comment["id"], "after": cursor},
                runner,
            )
            page = response["data"]["node"]["reactions"]
            reactions.extend(page["nodes"])
            info = page["pageInfo"]
            cursor = info["endCursor"]
        comment["reactions"] = reactions

    def reviews_page(cursor: str | None) -> dict[str, Any]:
        variables = dict(base_variables)
        if cursor:
            variables["after"] = cursor
        response = graphql(REVIEWS_QUERY, variables, runner)
        return cast(
            dict[str, Any],
            response["data"]["repository"]["pullRequest"]["reviews"],
        )

    reviews = page_nodes(reviews_page)

    def threads_page(cursor: str | None) -> dict[str, Any]:
        variables = dict(base_variables)
        if cursor:
            variables["after"] = cursor
        response = graphql(THREADS_QUERY, variables, runner)
        return cast(
            dict[str, Any],
            response["data"]["repository"]["pullRequest"]["reviewThreads"],
        )

    threads = page_nodes(threads_page)
    for thread in threads:
        comments_page_value = thread["comments"]
        thread_comments = list(comments_page_value["nodes"])
        info = comments_page_value["pageInfo"]
        cursor = info["endCursor"]
        comment_seen: set[str] = set()
        while info["hasNextPage"]:
            if not cursor or cursor in comment_seen:
                raise BarrierError("thread comment pagination cursor did not advance")
            comment_seen.add(cursor)
            response = graphql(
                THREAD_COMMENTS_QUERY,
                {"id": thread["id"], "after": cursor},
                runner,
            )
            page = response["data"]["node"]["comments"]
            thread_comments.extend(page["nodes"])
            info = page["pageInfo"]
            cursor = info["endCursor"]
        thread["comments"] = thread_comments

    checks_result = runner(
        [
            "gh",
            "pr",
            "checks",
            str(expectation["pull_request"]),
            "--repo",
            expectation["repository"],
            "--required",
            "--json",
            "name,state,bucket,workflow",
        ]
    )
    try:
        checks = json.loads(checks_result.stdout)
    except json.JSONDecodeError as error:
        raise BarrierError(
            "required checks could not be read: "
            + (checks_result.stderr.strip() or str(error))
        ) from error
    if not isinstance(checks, list):
        raise BarrierError("required checks response is not an array")

    return {
        "repository": expectation["repository"],
        "pull_request": pull_request["number"],
        "head": pull_request["headRefOid"],
        "base": pull_request["baseRefOid"],
        "state": pull_request["state"],
        "is_draft": pull_request["isDraft"],
        "merged_at": pull_request["mergedAt"],
        "merge_commit": (pull_request.get("mergeCommit") or {}).get("oid"),
        "auto_merge_armed": pull_request["autoMergeRequest"] is not None,
        "comments": [
            {
                "id": comment["id"],
                "login": (comment.get("author") or {}).get("login", ""),
                "body": comment["body"],
                "created_at": comment["createdAt"],
                "reactions": [
                    {
                        "content": reaction["content"],
                        "login": (reaction.get("user") or {}).get("login", ""),
                        "created_at": reaction["createdAt"],
                    }
                    for reaction in comment["reactions"]
                ],
            }
            for comment in comments
        ],
        "reviews": [
            {
                "id": review["id"],
                "login": (review.get("author") or {}).get("login", ""),
                "state": review["state"],
                "submitted_at": review["submittedAt"],
                "commit": (review.get("commit") or {}).get("oid", ""),
            }
            for review in reviews
        ],
        "threads": [
            {
                "id": thread["id"],
                "is_resolved": thread["isResolved"],
                "is_outdated": thread["isOutdated"],
                "comments": [
                    {
                        "id": comment["id"],
                        "login": (comment.get("author") or {}).get("login", ""),
                        "created_at": comment["createdAt"],
                        "review_id": (comment.get("pullRequestReview") or {}).get("id"),
                    }
                    for comment in thread["comments"]
                ],
            }
            for thread in threads
        ],
        "required_checks": checks,
    }


def prepare_trigger(
    expectation: Expectation,
    runner: Runner = run_command,
) -> None:
    snapshot = load_snapshot(expectation, runner)
    decision = inspect_snapshot(snapshot, expectation)
    if decision["status"] == "merged":
        return
    if snapshot["head"] != expectation["head"]:
        raise BarrierError("cannot trigger Codex review: head changed")
    if snapshot["base"] != expectation["base"]:
        raise BarrierError("cannot trigger Codex review: base changed")
    if snapshot["state"] != "OPEN" or snapshot["is_draft"]:
        raise BarrierError("cannot trigger Codex review: PR is not open and ready")
    if snapshot["auto_merge_armed"]:
        raise BarrierError("cannot trigger Codex review: auto-merge is armed")
    unresolved = [thread for thread in snapshot["threads"] if not thread["is_resolved"]]
    if unresolved:
        raise BarrierError(
            "cannot trigger Codex review: "
            f"{len(unresolved)} review thread(s) remain unresolved"
        )

    triggers, trigger_error = marked_triggers(snapshot)
    if trigger_error:
        raise BarrierError(trigger_error)
    for trigger in triggers:
        if not actor_matches(trigger["login"], expectation["trigger_actor"]):
            raise BarrierError("Codex trigger actor is not the frozen actor")
        signals = terminal_signals(snapshot, trigger, expectation["provider"])
        if trigger["head"] == expectation["head"]:
            if (
                len(
                    [
                        candidate
                        for candidate in triggers
                        if candidate["head"] == expectation["head"]
                    ]
                )
                > 1
            ):
                raise BarrierError("multiple exact-head Codex triggers are ambiguous")
            return
        if len(signals) != 1:
            raise BarrierError("a prior Codex review attempt is not terminal")

    require_success(
        runner(
            [
                "gh",
                "api",
                (
                    f"repos/{expectation['repository']}/issues/"
                    f"{expectation['pull_request']}/comments"
                ),
                "-f",
                f"body={trigger_body(expectation['head'])}",
            ]
        ),
        "Codex review trigger",
    )


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", required=True)
    parser.add_argument("--pr", required=True, type=int)
    parser.add_argument("--head", required=True)
    parser.add_argument("--base", required=True)
    parser.add_argument("--provider", default=PROVIDER_DEFAULT)
    parser.add_argument("--actor")
    parser.add_argument("--settle-seconds", type=float, default=30)
    parser.add_argument("--timeout-seconds", type=float, default=900)
    parser.add_argument("--poll-seconds", type=float, default=10)
    arguments = parser.parse_args()
    if arguments.pr < 1:
        parser.error("--pr must be positive")
    if not re.fullmatch(r"[0-9a-f]{40}", arguments.head):
        parser.error("--head must be a 40-character lowercase Git SHA")
    if not re.fullmatch(r"[0-9a-f]{40}", arguments.base):
        parser.error("--base must be a 40-character lowercase Git SHA")
    if (
        arguments.settle_seconds < 0
        or arguments.timeout_seconds <= 0
        or arguments.poll_seconds <= 0
    ):
        parser.error("settle, timeout and poll seconds must be bounded")
    return arguments


def main() -> int:
    arguments = parse_arguments()
    actor = arguments.actor
    if not actor:
        actor = require_success(
            run_command(["gh", "api", "user", "--jq", ".login"]),
            "GitHub actor lookup",
        ).strip()
    expectation: Expectation = {
        "repository": arguments.repo,
        "pull_request": arguments.pr,
        "head": arguments.head,
        "base": arguments.base,
        "provider": arguments.provider,
        "trigger_actor": actor,
    }

    prepare_trigger(expectation)
    decision = wait_for_barrier(
        expectation,
        lambda: load_snapshot(expectation),
        settle_seconds=arguments.settle_seconds,
        timeout_seconds=arguments.timeout_seconds,
        poll_seconds=arguments.poll_seconds,
    )
    if decision["status"] == "merged":
        print(json.dumps(decision, sort_keys=True))
        return 0
    if decision["status"] != "ready":
        print(json.dumps(decision, sort_keys=True), file=sys.stderr)
        return 2 if decision["status"] == "blocked" else 3

    final_snapshot = load_snapshot(expectation)
    final_decision = inspect_snapshot(final_snapshot, expectation)
    if (
        final_decision["status"] != "ready"
        or final_decision["fingerprint"] != decision["fingerprint"]
    ):
        print(
            json.dumps(
                {
                    "status": "blocked",
                    "reason": "activity changed during final refetch",
                    "fingerprint": final_decision["fingerprint"],
                },
                sort_keys=True,
            ),
            file=sys.stderr,
        )
        return 2

    require_success(
        run_command(merge_arguments(expectation)),
        "guarded direct merge",
    )
    for _ in range(3):
        observed = inspect_snapshot(load_snapshot(expectation), expectation)
        if observed["status"] == "merged":
            print(json.dumps(observed, sort_keys=True))
            return 0
        time.sleep(2)
    print(
        json.dumps(
            {
                "status": "blocked",
                "reason": "merge command returned without a merged observation",
            },
            sort_keys=True,
        ),
        file=sys.stderr,
    )
    return 2


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except BarrierError as error:
        print(
            json.dumps({"status": "error", "reason": str(error)}),
            file=sys.stderr,
        )
        raise SystemExit(1) from error
