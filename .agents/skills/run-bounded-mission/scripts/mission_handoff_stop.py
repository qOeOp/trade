#!/usr/bin/env python3

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from collections.abc import Iterable, Iterator
from typing import Any


MARKERS = (
    ("Mission-Start:", "start"),
    ("Mission-Contract:", "contract"),
    ("Mission-Plan:", "plan"),
    ("Mission-Build:", "build"),
    ("Mission-Evaluate:", "evaluate"),
    ("Mission-Handoff:", "handoff"),
    ("Mission-Terminate:", "terminate"),
)
EXPECTED_ORDER = tuple(kind for _, kind in MARKERS)
TRANSCRIPT_CHUNK_BYTES = 64 * 1024

Boundary = tuple[str, str]
Event = tuple[str, dict[str, Any] | None]
MergeVerifier = Any


def parse_object(value: str) -> dict[str, Any] | None:
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


def immutable_identity(identity: object) -> bool:
    return isinstance(identity, str) and (
        identity == "none"
        or re.fullmatch(r"sha256:[0-9a-f]{64}", identity) is not None
        or re.fullmatch(r"git:(?:[0-9a-f]{40}|[0-9a-f]{64})", identity) is not None
    )


def boundary(record: dict[str, Any] | None) -> Boundary | None:
    if not record:
        return None
    endpoint = record.get("endpoint")
    origin = record.get("origin")
    if (
        isinstance(endpoint, str)
        and endpoint
        and immutable_identity(origin)
    ):
        return endpoint, origin
    return None


def valid_common(record: dict[str, Any] | None, turn_id: str) -> bool:
    return bool(
        record
        and record.get("turn_id") == turn_id
        and boundary(record)
    )


def valid_event(kind: str, record: dict[str, Any] | None, turn_id: str) -> bool:
    if not valid_common(record, turn_id):
        return False
    assert record is not None
    if kind == "start":
        return (
            isinstance(record.get("stop"), str)
            and bool(record["stop"])
            and record.get("workspace") in {"created", "reused", "none"}
        )
    if kind in {"contract", "plan"}:
        return record.get("status") in {"done", "noop", "blocked"}
    if kind in {"build", "evaluate"}:
        return (
            record.get("status") in {"done", "noop", "blocked"}
            and immutable_identity(record.get("candidate"))
        )
    if kind == "handoff":
        return (
            record.get("status") in {"done", "noop", "blocked"}
            and immutable_identity(record.get("candidate"))
            and isinstance(record.get("effects"), list)
        )
    if kind == "terminate":
        disposition = (
            record.get("acceptance") == "passed" and record.get("route") == "accept"
        ) or (
            record.get("acceptance") == "blocked" and record.get("route") == "blocked"
        )
        cleanup = record.get("cleanup")
        return (
            immutable_identity(record.get("candidate"))
            and isinstance(record.get("effects"), list)
            and cleanup in {"complete", "preserved"}
            and disposition
            and not (cleanup == "preserved" and record.get("route") != "blocked")
        )
    return False


def lifecycle_for_message(message: str) -> list[Event]:
    events: list[Event] = []
    fence: tuple[str, int] | None = None

    envelope = parse_object(message.strip())
    if envelope and isinstance(envelope.get("_mission"), list):
        for item in envelope["_mission"]:
            if not isinstance(item, dict):
                events.append(("", None))
                continue
            stage = item.get("stage")
            record = item.get("receipt")
            if (
                isinstance(stage, str)
                and stage in EXPECTED_ORDER
                and isinstance(record, dict)
            ):
                events.append((stage, record))
            else:
                events.append(("", None))
        return events

    for original_line in message.splitlines():
        line = original_line.rstrip()
        if line.startswith("# "):
            line = line[2:]
        if fence:
            closing = re.fullmatch(r" {0,3}(`+|~+)[ \t]*", line)
            if (
                closing
                and closing.group(1)[0] == fence[0]
                and len(closing.group(1)) >= fence[1]
            ):
                fence = None
            continue

        opening = re.match(r" {0,3}(`{3,}|~{3,})", line)
        if opening:
            fence = opening.group(1)[0], len(opening.group(1))
            continue

        for marker, kind in MARKERS:
            if line.startswith(f"{marker} "):
                events.append((kind, parse_object(line[len(marker) :].strip())))
                break
    return events


def read_lines_newest_first(path: str) -> Iterator[str]:
    with open(path, "rb") as transcript:
        transcript.seek(0, os.SEEK_END)
        position = transcript.tell()
        suffix = b""
        while position > 0:
            length = min(position, TRANSCRIPT_CHUNK_BYTES)
            position -= length
            transcript.seek(position)
            combined = transcript.read(length) + suffix
            lines = combined.split(b"\n")
            suffix = lines[0]
            for line in reversed(lines[1:]):
                if line:
                    yield line.decode("utf-8")
        if suffix:
            yield suffix.decode("utf-8")


def assistant_message_from_line(line: str) -> str:
    entry = parse_object(line)
    if not entry:
        return ""
    payload = entry.get("payload")
    if (
        not isinstance(payload, dict)
        or entry.get("type") != "response_item"
        or payload.get("type") != "message"
        or payload.get("role") != "assistant"
        or not isinstance(payload.get("content"), list)
    ):
        return ""
    return "".join(
        content["text"]
        for content in payload["content"]
        if isinstance(content, dict)
        and content.get("type") == "output_text"
        and isinstance(content.get("text"), str)
    )


def assistant_messages_newest_first(path: str) -> Iterator[str]:
    if not path:
        return
    try:
        for line in read_lines_newest_first(path):
            message = assistant_message_from_line(line)
            if message:
                yield message
    except OSError:
        return


def chronological_messages(
    input_value: dict[str, Any],
    transcript_messages_newest_first: Iterable[str] | None,
) -> list[str]:
    last_message = input_value.get("last_assistant_message")
    if not isinstance(last_message, str):
        last_message = ""
    history = list(
        transcript_messages_newest_first
        if transcript_messages_newest_first is not None
        else assistant_messages_newest_first(
            input_value.get("transcript_path", "")
            if isinstance(input_value.get("transcript_path"), str)
            else ""
        )
    )
    skipped_duplicate = False
    filtered: list[str] = []
    for message in history:
        if last_message and message == last_message and not skipped_duplicate:
            skipped_duplicate = True
            continue
        filtered.append(message)
    messages = list(reversed(filtered))
    if last_message:
        messages.append(last_message)
    return messages


def content_text(payload: dict[str, Any]) -> str:
    content = payload.get("content")
    if not isinstance(content, list):
        return ""
    return "".join(
        item["text"]
        for item in content
        if isinstance(item, dict)
        and item.get("type") in {"input_text", "output_text"}
        and isinstance(item.get("text"), str)
    )


def admission_from_lines(
    input_value: dict[str, Any],
    lines_newest_first: Iterable[str],
) -> dict[str, Any] | None:
    turn_id = input_value.get("turn_id")
    if not isinstance(turn_id, str):
        return None
    records: list[dict[str, Any]] = []
    context_cwd = ""
    for line in lines_newest_first:
        entry = parse_object(line)
        if not entry or not isinstance(entry.get("payload"), dict):
            continue
        payload = entry["payload"]
        if (
            entry.get("type") == "turn_context"
            and payload.get("turn_id") == turn_id
            and isinstance(payload.get("cwd"), str)
        ):
            context_cwd = payload["cwd"]
        if (
            entry.get("type") == "response_item"
            and payload.get("type") == "message"
            and payload.get("role") == "developer"
        ):
            for line_value in content_text(payload).splitlines():
                if line_value.startswith("Mission-Admission: "):
                    record = parse_object(
                        line_value[len("Mission-Admission: ") :].strip()
                    )
                    if record and record.get("turn_id") == turn_id:
                        records.append(record)
    if len(records) != 1:
        return None
    record = records[0]
    if (
        not context_cwd
        or record.get("cwd") != context_cwd
        or context_cwd != input_value.get("cwd")
        or record.get("workspace") not in {"reused", "none"}
        or not immutable_identity(record.get("origin"))
        or (record.get("workspace") == "none") != (record.get("origin") == "none")
        or not isinstance(record.get("repository"), str)
        or (record.get("workspace") == "none") != (record.get("repository") == "none")
    ):
        return None
    return record


def transcript_admission(input_value: dict[str, Any]) -> dict[str, Any] | None:
    transcript_path = input_value.get("transcript_path")
    if not isinstance(transcript_path, str):
        return None
    try:
        return admission_from_lines(input_value, read_lines_newest_first(transcript_path))
    except OSError:
        return None


def pull_request_effect(effects: object, candidate: str) -> dict[str, Any] | None:
    if not isinstance(effects, list):
        return None
    matches = [
        effect
        for effect in effects
        if isinstance(effect, dict)
        and effect.get("kind") == "github_pull_request"
        and effect.get("state") in {"open", "merged"}
        and effect.get("head") == candidate
        and isinstance(effect.get("url"), str)
        and (
            (effect.get("state") == "open" and "merge" not in effect)
            or (
                effect.get("state") == "merged"
                and isinstance(effect.get("merge"), str)
            )
        )
    ]
    return matches[0] if len(matches) == 1 else None


def verify_local_candidate(cwd: str, origin: str, candidate: str) -> bool:
    if not re.fullmatch(r"git:[0-9a-f]{40}", candidate):
        return False
    if not re.fullmatch(r"git:[0-9a-f]{40}", origin):
        return False
    try:
        subprocess.run(
            ["git", "-C", cwd, "cat-file", "-e", f"{candidate[4:]}^{{commit}}"],
            check=True,
            capture_output=True,
            timeout=3,
        )
        subprocess.run(
            ["git", "-C", cwd, "merge-base", "--is-ancestor", origin[4:], candidate[4:]],
            check=True,
            capture_output=True,
            timeout=3,
        )
    except (OSError, subprocess.SubprocessError):
        return False
    return True


def verify_github_effects(
    cwd: str,
    repository: str,
    origin: str,
    candidate: str,
    effects: object,
    require_merged: bool,
) -> bool:
    if not verify_local_candidate(cwd, origin, candidate):
        return False
    effect = pull_request_effect(effects, candidate)
    if effect is None:
        return False
    url = effect["url"]
    if not re.fullmatch(r"https://github\.com/[^/]+/[^/]+/pull/[0-9]+", url):
        return False
    if "/".join(url.split("/")[3:5]).lower() != repository.lower():
        return False
    try:
        result = subprocess.run(
            [
                "gh",
                "pr",
                "view",
                url,
                "--json",
                "state,headRefOid,mergeCommit,baseRefName",
            ],
            cwd=cwd,
            check=True,
            capture_output=True,
            text=True,
            timeout=8,
        )
        remote = parse_object(result.stdout)
        repository_result = subprocess.run(
            ["gh", "repo", "view", repository, "--json", "defaultBranchRef"],
            cwd=cwd,
            check=True,
            capture_output=True,
            text=True,
            timeout=5,
        )
        repository_remote = parse_object(repository_result.stdout)
    except (OSError, subprocess.SubprocessError):
        return False
    merge = remote.get("mergeCommit") if remote else None
    default_branch = (
        repository_remote.get("defaultBranchRef") if repository_remote else None
    )
    expected_state = "MERGED" if require_merged else "OPEN"
    if not (
        remote
        and remote.get("state") == expected_state
        and remote.get("headRefOid") == candidate[4:]
        and isinstance(default_branch, dict)
        and remote.get("baseRefName") == default_branch.get("name")
    ):
        return False
    if require_merged:
        return bool(
            effect.get("state") == "merged"
            and isinstance(merge, dict)
            and effect.get("merge") == f"git:{merge.get('oid')}"
        )
    return effect.get("state") == "open" and "merge" not in effect


def terminal_message(message: str, turn_id: str) -> bool:
    envelope = parse_object(message.strip())
    if envelope and isinstance(envelope.get("_mission"), list):
        events = lifecycle_for_message(message)
        return bool(
            events
            and events[-1][0] == "terminate"
            and events[-1][1]
            and events[-1][1].get("turn_id") == turn_id
        )
    lines = [line for line in message.splitlines() if line.strip()]
    if not lines:
        return False
    line = lines[-1]
    if line.startswith("# "):
        line = line[2:]
    if not line.startswith("Mission-Terminate: "):
        return False
    record = parse_object(line[len("Mission-Terminate: ") :].strip())
    return bool(record and record.get("turn_id") == turn_id)


def mission_state(
    input_value: dict[str, Any],
    transcript_messages_newest_first: Iterable[str] | None = None,
    admission: dict[str, Any] | None = None,
    merge_verifier: MergeVerifier = verify_github_effects,
    local_verifier: MergeVerifier = verify_local_candidate,
) -> str:
    turn_id = input_value.get("turn_id")
    if not isinstance(turn_id, str) or not turn_id:
        return "active"

    messages = chronological_messages(input_value, transcript_messages_newest_first)
    if not messages:
        return "active"
    if not terminal_message(messages[-1], turn_id):
        return "active"

    events = [
        event
        for message in messages
        for event in lifecycle_for_message(message)
        if event[1] is not None and event[1].get("turn_id") == turn_id
    ]
    if tuple(kind for kind, _ in events) != EXPECTED_ORDER:
        return "active"
    if not all(valid_event(kind, record, turn_id) for kind, record in events):
        return "active"

    records = [record for _, record in events]
    if any(record is None for record in records):
        return "active"
    typed_records = [record for record in records if record is not None]
    frozen_boundary = boundary(typed_records[0])
    if not frozen_boundary or any(boundary(record) != frozen_boundary for record in typed_records):
        return "active"
    trusted = admission if admission is not None else transcript_admission(input_value)
    if (
        not trusted
        or trusted.get("turn_id") != turn_id
        or trusted.get("origin") != frozen_boundary[1]
        or typed_records[0].get("workspace") != trusted.get("workspace")
    ):
        return "active"

    phase_records = dict(events)
    build = phase_records["build"]
    evaluate = phase_records["evaluate"]
    handoff = phase_records["handoff"]
    terminate = phase_records["terminate"]
    assert build and evaluate and handoff and terminate
    candidate = build["candidate"]
    if (
        evaluate["candidate"] != candidate
        or handoff["candidate"] != candidate
        or terminate["candidate"] != candidate
        or handoff["effects"] != terminate["effects"]
    ):
        return "active"

    statuses = [
        phase_records[stage]["status"]
        for stage in ("contract", "plan", "build", "evaluate", "handoff")
        if phase_records[stage]
    ]
    blocked = "blocked" in statuses
    blocked_seen = False
    for status in statuses:
        if blocked_seen and status == "done":
            return "active"
        blocked_seen = blocked_seen or status == "blocked"
    if blocked != (terminate["route"] == "blocked"):
        return "active"

    if frozen_boundary[0] not in {"response", "merged"}:
        return "active"
    if candidate != "none" and not local_verifier(
        trusted["cwd"],
        frozen_boundary[1],
        candidate,
    ):
        return "active"

    if candidate == "none" and not blocked:
        if (
            frozen_boundary[0] != "response"
            or build["status"] != "noop"
            or evaluate["status"] != "noop"
            or handoff["status"] != "noop"
        ):
            return "active"
    elif candidate == "none" and blocked and handoff["effects"]:
        return "active"
    elif candidate != "none" and blocked:
        if frozen_boundary[0] != "merged":
            return "active"
        if handoff["effects"] and not merge_verifier(
            trusted["cwd"],
            trusted["repository"],
            frozen_boundary[1],
            candidate,
            handoff["effects"],
            pull_request_effect(handoff["effects"], candidate).get("state") == "merged"
            if pull_request_effect(handoff["effects"], candidate)
            else False,
        ):
            return "active"
    elif candidate != "none" and not blocked and (
        frozen_boundary[0] != "merged"
        or build["status"] != "done"
        or evaluate["status"] != "done"
        or handoff["status"] != "done"
        or not merge_verifier(
            trusted["cwd"],
            trusted["repository"],
            frozen_boundary[1],
            candidate,
            handoff["effects"],
            True,
        )
    ):
        return "active"

    return "closed"


def evaluate_stop(
    input_value: dict[str, Any],
    transcript_messages_newest_first: Iterable[str] | None = None,
    admission: dict[str, Any] | None = None,
    merge_verifier: MergeVerifier = verify_github_effects,
    local_verifier: MergeVerifier = verify_local_candidate,
) -> dict[str, Any]:
    if (
        mission_state(
            input_value,
            transcript_messages_newest_first,
            admission,
            merge_verifier,
            local_verifier,
        )
        == "closed"
    ):
        return {"continue": True}
    turn_id = input_value.get("turn_id")
    turn_instruction = (
        f" Use turn_id={turn_id} in every receipt."
        if isinstance(turn_id, str) and turn_id
        else ""
    )
    if input_value.get("stop_hook_active") is True:
        return {
            "continue": False,
            "stopReason": "Universal mission lifecycle remained incomplete after one continuation.",
            "systemMessage": (
                "The turn stopped without a valid ordered Mission-Start through "
                "Mission-Terminate lifecycle."
            ),
        }
    return {
        "decision": "block",
        "reason": (
            "Resume the current turn's mission. Emit exactly one ordered receipt for "
            "Mission-Start, Contract, Plan, Build, Evaluate, Handoff, and "
            "Mission-Terminate. A stage may be noop but may not be omitted."
            f"{turn_instruction}"
        ),
    }


def main() -> None:
    try:
        input_value = json.load(sys.stdin)
    except (json.JSONDecodeError, OSError):
        print(json.dumps({"decision": "block", "reason": "Mission hook input is invalid."}))
        return
    print(json.dumps(evaluate_stop(input_value), separators=(",", ":")))


if __name__ == "__main__":
    main()
