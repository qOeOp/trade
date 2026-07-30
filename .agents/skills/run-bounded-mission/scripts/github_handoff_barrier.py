#!/usr/bin/env python3

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import subprocess
import sys
import time
from collections.abc import Callable
from typing import Any, cast
from urllib.parse import quote


PROVIDER_DEFAULT = "chatgpt-codex-connector"
CODEX_ERROR_PREFIX = "Codex Review: Something went wrong."

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
        "pull_request_reactions": snapshot["pull_request_reactions"],
        "reviews": snapshot["reviews"],
        "threads": snapshot["threads"],
    }
    encoded = json.dumps(activity, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(encoded).hexdigest()


def inspect_initial_review(snapshot: Snapshot, provider: str) -> Decision:
    fingerprint = activity_fingerprint(snapshot)
    thread_review_ids = {
        comment["review_id"]
        for thread in snapshot["threads"]
        for comment in thread["comments"]
        if comment["review_id"] and actor_matches(comment["login"], provider)
    }
    completed_reviews = [
        review["id"]
        for review in snapshot["reviews"]
        if actor_matches(review["login"], provider)
        and isinstance(review["submitted_at"], str)
        and review["submitted_at"] >= snapshot["created_at"]
        and review["id"] in thread_review_ids
    ]
    thumbs_up = [
        reaction["created_at"]
        for reaction in snapshot["pull_request_reactions"]
        if actor_matches(reaction["login"], provider)
        and reaction["content"] == "THUMBS_UP"
        and reaction["created_at"] >= snapshot["created_at"]
    ]
    if completed_reviews or thumbs_up:
        return {"status": "ready", "fingerprint": fingerprint}
    failed = [
        comment
        for comment in snapshot["comments"]
        if actor_matches(comment["login"], provider)
        and comment["created_at"] >= snapshot["created_at"]
        and comment["body"].startswith(CODEX_ERROR_PREFIX)
    ]
    if failed:
        return {
            "status": "blocked",
            "reason": "initial Codex review failed without a completion signal",
            "fingerprint": fingerprint,
        }
    return {
        "status": "pending",
        "reason": "initial Codex review has not completed",
        "fingerprint": fingerprint,
    }


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

    initial_review = inspect_initial_review(snapshot, expectation["provider"])
    if initial_review["status"] != "ready":
        return initial_review

    unresolved = [thread for thread in snapshot["threads"] if not thread["is_resolved"]]
    if unresolved:
        return {
            "status": "blocked",
            "reason": f"{len(unresolved)} review thread(s) remain unresolved",
            "fingerprint": fingerprint,
        }

    required_contexts = set(snapshot["required_contexts"])
    if not required_contexts:
        return {
            "status": "blocked",
            "reason": "required status-check context set is empty",
            "fingerprint": fingerprint,
        }
    checks = [
        check
        for check in snapshot["required_checks"]
        if check["name"] in required_contexts
    ]
    observed_contexts = {check["name"] for check in checks}
    missing_contexts = sorted(required_contexts - observed_contexts)
    if missing_contexts:
        return {
            "status": "pending",
            "reason": "required checks are not available: "
            + ", ".join(missing_contexts),
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
      id number createdAt headRefOid baseRefOid baseRefName state isDraft mergedAt
      mergeCommit{oid}
      autoMergeRequest{enabledAt}
      reactions(first:100){
        pageInfo{hasNextPage endCursor}
        nodes{content createdAt user{login}}
      }
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

PULL_REQUEST_REACTIONS_QUERY = """
query($id:ID!,$after:String){
  node(id:$id){
    ... on PullRequest{
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


def load_required_contexts(
    repository: str,
    branch: str,
    runner: Runner = run_command,
) -> list[str]:
    output = require_success(
        runner(
            [
                "gh",
                "api",
                f"repos/{repository}/rules/branches/{quote(branch, safe='')}",
            ]
        ),
        "required status-check rules lookup",
    )
    raw_rules: object = json.loads(output)
    if not isinstance(raw_rules, list):
        raise BarrierError("required status-check rules response is not an array")
    contexts: set[str] = set()
    for raw_rule in raw_rules:
        if not isinstance(raw_rule, dict) or raw_rule.get("type") != (
            "required_status_checks"
        ):
            continue
        parameters = raw_rule.get("parameters")
        if not isinstance(parameters, dict):
            raise BarrierError("required status-check rule has no parameters")
        checks = parameters.get("required_status_checks")
        if not isinstance(checks, list):
            raise BarrierError("required status-check rule has no check list")
        for check in checks:
            if not isinstance(check, dict) or not isinstance(check.get("context"), str):
                raise BarrierError("required status-check context is malformed")
            contexts.add(check["context"])
    return sorted(contexts)


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
    required_contexts = load_required_contexts(
        expectation["repository"],
        pull_request["baseRefName"],
        runner,
    )
    pull_request_reactions = list(pull_request["reactions"]["nodes"])
    reaction_info = pull_request["reactions"]["pageInfo"]
    reaction_cursor = reaction_info["endCursor"]
    pull_request_reaction_seen: set[str] = set()
    while reaction_info["hasNextPage"]:
        if not reaction_cursor or reaction_cursor in pull_request_reaction_seen:
            raise BarrierError("pull request reaction cursor did not advance")
        pull_request_reaction_seen.add(reaction_cursor)
        response = graphql(
            PULL_REQUEST_REACTIONS_QUERY,
            {"id": pull_request["id"], "after": reaction_cursor},
            runner,
        )
        reaction_page = response["data"]["node"]["reactions"]
        pull_request_reactions.extend(reaction_page["nodes"])
        reaction_info = reaction_page["pageInfo"]
        reaction_cursor = reaction_info["endCursor"]

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
        "created_at": pull_request["createdAt"],
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
        "pull_request_reactions": [
            {
                "content": reaction["content"],
                "login": (reaction.get("user") or {}).get("login", ""),
                "created_at": reaction["createdAt"],
            }
            for reaction in pull_request_reactions
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
        "required_contexts": required_contexts,
    }


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", required=True)
    parser.add_argument("--pr", required=True, type=int)
    parser.add_argument("--head", required=True)
    parser.add_argument("--base", required=True)
    parser.add_argument("--provider", default=PROVIDER_DEFAULT)
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
    timing_values = (
        arguments.settle_seconds,
        arguments.timeout_seconds,
        arguments.poll_seconds,
    )
    if (
        not all(math.isfinite(value) for value in timing_values)
        or arguments.settle_seconds < 0
        or arguments.timeout_seconds <= 0
        or arguments.poll_seconds <= 0
    ):
        parser.error("settle, timeout and poll seconds must be bounded")
    return arguments


def main() -> int:
    arguments = parse_arguments()
    expectation: Expectation = {
        "repository": arguments.repo,
        "pull_request": arguments.pr,
        "head": arguments.head,
        "base": arguments.base,
        "provider": arguments.provider,
    }

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
