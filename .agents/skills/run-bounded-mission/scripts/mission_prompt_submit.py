#!/usr/bin/env python3

from __future__ import annotations

import json
import re
import subprocess
import sys
from typing import Any


def github_repository(remote: str) -> str | None:
    match = re.fullmatch(
        r"(?:git@github\.com:|https://github\.com/)([^/]+/[^/]+?)(?:\.git)?",
        remote,
    )
    return match.group(1) if match else None


def git_boundary(cwd: str) -> tuple[str, str, str]:
    try:
        root = subprocess.run(
            ["git", "-C", cwd, "rev-parse", "--show-toplevel"],
            check=True,
            capture_output=True,
            text=True,
            timeout=2,
        ).stdout.strip()
        head = subprocess.run(
            ["git", "-C", root, "rev-parse", "HEAD"],
            check=True,
            capture_output=True,
            text=True,
            timeout=2,
        ).stdout.strip()
        remote = subprocess.run(
            ["git", "-C", root, "remote", "get-url", "origin"],
            check=True,
            capture_output=True,
            text=True,
            timeout=2,
        ).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return "none", "none", "none"
    repository = github_repository(remote)
    if len(head) not in {40, 64} or repository is None:
        return "none", "none", "none"
    return f"git:{head}", "reused", repository


def admission_record(input_value: dict[str, Any]) -> dict[str, Any] | None:
    cwd = input_value.get("cwd")
    turn_id = input_value.get("turn_id")
    if (
        not isinstance(cwd, str)
        or not cwd
        or not isinstance(turn_id, str)
        or not turn_id
    ):
        return None
    origin, workspace, repository = git_boundary(cwd)
    return {
        "turn_id": turn_id,
        "cwd": cwd,
        "origin": origin,
        "workspace": workspace,
        "repository": repository,
    }


def admission(input_value: dict[str, Any]) -> dict[str, Any]:
    turn_id = input_value.get("turn_id")
    if not isinstance(turn_id, str) or not turn_id:
        return {
            "decision": "block",
            "reason": "Universal mission admission requires a non-empty turn_id.",
        }
    record = admission_record(input_value)
    if record is None:
        return {
            "decision": "block",
            "reason": "Universal mission admission could not bind the turn boundary.",
        }
    encoded_record = json.dumps(record, separators=(",", ":"))
    context = (
        f"Mission-Admission: {encoded_record}\n"
        f"Universal mission admission for turn_id={turn_id}. "
        f"Use origin={record['origin']} and workspace={record['workspace']} exactly. "
        "Run exactly one lifecycle for this root user turn: Mission-Start, "
        "Mission-Contract, Mission-Plan, Mission-Build, Mission-Evaluate, "
        "Mission-Handoff, Mission-Terminate. Use this exact turn_id in every receipt. "
        "Every stage is mandatory and may be done, noop, or blocked. "
        "A Stop-hook continuation resumes this same mission and must not emit another "
        "Mission-Start. Only Mission-Terminate closes the turn."
    )
    return {
        "hookSpecificOutput": {
            "hookEventName": "UserPromptSubmit",
            "additionalContext": context,
        }
    }


def main() -> None:
    try:
        input_value = json.load(sys.stdin)
    except (json.JSONDecodeError, OSError):
        print(json.dumps({"decision": "block", "reason": "Mission admission input is invalid."}))
        return
    print(json.dumps(admission(input_value), separators=(",", ":")))


if __name__ == "__main__":
    main()
