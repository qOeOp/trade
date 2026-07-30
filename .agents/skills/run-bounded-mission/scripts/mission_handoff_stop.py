#!/usr/bin/env python3

from __future__ import annotations

import json
import os
import re
import sys
from collections.abc import Iterable, Iterator
from typing import Any


ACTIVE_MARKER = "Mission-Terminal:"
HANDOFF_MARKER = "Mission-Handoff:"
START_MARKER = "Mission-Start:"
TRANSCRIPT_CHUNK_BYTES = 64 * 1024

Boundary = tuple[str, str]
Event = tuple[str, Boundary | None]


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
        and isinstance(origin, str)
        and immutable_identity(origin)
    ):
        return endpoint, origin
    return None


def parse_start(record: dict[str, Any] | None) -> Boundary | None:
    if not record:
        return None
    value = boundary(record)
    return value if value and isinstance(record.get("stop"), str) else None


def parse_active(record: dict[str, Any] | None) -> Boundary | None:
    if not record:
        return None
    value = boundary(record)
    return value if value and record.get("status") == "active" else None


def parse_handoff(record: dict[str, Any] | None) -> Boundary | None:
    value = boundary(record)
    if not record or not value:
        return None
    if (
        not immutable_identity(record.get("candidate"))
        or not isinstance(record.get("effects"), list)
        or record.get("cleanup") not in {"complete", "preserved"}
    ):
        return None
    disposition = (
        record.get("acceptance") == "passed" and record.get("route") == "accept"
    ) or (record.get("acceptance") == "blocked" and record.get("route") == "blocked")
    return value if disposition else None


def lifecycle_for_message(message: str) -> tuple[list[Event], int]:
    events: list[Event] = []
    handoff_count = 0
    fence: tuple[str, int] | None = None

    for original_line in message.splitlines():
        line = original_line.rstrip()
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

        if line.startswith(f"{START_MARKER} "):
            value = parse_start(parse_object(line[len(START_MARKER) :].strip()))
            if value:
                events.append(("start", value))
            continue
        if line.startswith(f"{ACTIVE_MARKER} "):
            value = parse_active(parse_object(line[len(ACTIVE_MARKER) :].strip()))
            if value:
                events.append(("active", value))
            continue
        if line.startswith(f"{HANDOFF_MARKER} "):
            handoff_count += 1
            value = parse_handoff(parse_object(line[len(HANDOFF_MARKER) :].strip()))
            events.append(("handoff", value) if value else ("invalid-handoff", None))

    envelope = parse_object(message.strip())
    if envelope and "mission_handoff" in envelope:
        handoff_count += 1
        raw = envelope["mission_handoff"]
        value = parse_handoff(raw if isinstance(raw, dict) else None)
        events.append(("handoff", value) if value else ("invalid-handoff", None))
    return events, handoff_count


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
    payload = entry.get("payload") if entry else None
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


def mission_state(
    input_value: dict[str, Any],
    transcript_messages_newest_first: Iterable[str] | None = None,
) -> str:
    last_message = input_value.get("last_assistant_message")
    if not isinstance(last_message, str):
        last_message = ""
    history = (
        transcript_messages_newest_first
        if transcript_messages_newest_first is not None
        else assistant_messages_newest_first(
            input_value.get("transcript_path", "")
            if isinstance(input_value.get("transcript_path"), str)
            else ""
        )
    )

    messages: list[str] = []
    if last_message:
        messages.append(last_message)
    skipped_duplicate = False
    for message in history:
        if last_message and message == last_message and not skipped_duplicate:
            skipped_duplicate = True
            continue
        messages.append(message)

    lifecycle_history: list[tuple[list[Event], int]] = []
    for message in messages:
        lifecycle = lifecycle_for_message(message)
        if not lifecycle[0]:
            continue
        newest = len(lifecycle_history) == 0
        lifecycle_history.append(lifecycle)
        newest_event = lifecycle[0][-1]
        if newest and newest_event[0] in {"start", "active"}:
            return "active"

    active_boundary: Boundary | None = None
    boundary_conflict = False
    closed = False
    for events, handoff_count in reversed(lifecycle_history):
        if handoff_count > 1 and active_boundary:
            boundary_conflict = True
        for kind, value in events:
            if kind in {"start", "active"}:
                if not active_boundary:
                    active_boundary = value
                    boundary_conflict = False
                elif active_boundary != value:
                    boundary_conflict = True
                closed = False
                continue
            if kind == "invalid-handoff":
                if active_boundary:
                    boundary_conflict = True
                continue
            if (
                active_boundary
                and not boundary_conflict
                and handoff_count == 1
                and active_boundary == value
            ):
                active_boundary = None
                closed = True
            elif active_boundary:
                boundary_conflict = True
    if active_boundary:
        return "active"
    return "closed" if closed else "inactive"


def evaluate_stop(
    input_value: dict[str, Any],
    transcript_messages_newest_first: Iterable[str] | None = None,
) -> dict[str, Any]:
    state = mission_state(input_value, transcript_messages_newest_first)
    if state in {"closed", "inactive"}:
        return {"continue": True}
    if input_value.get("stop_hook_active") is True:
        return {
            "continue": False,
            "stopReason": (
                "Bounded mission Handoff remained incomplete after one continuation."
            ),
            "systemMessage": (
                "The bounded mission stopped without a valid Mission-Handoff receipt."
            ),
        }
    return {
        "decision": "block",
        "reason": (
            "The bounded mission is still active. Complete the separate "
            "Handoff stage, update its plan item, and end with one valid "
            "Mission-Handoff receipt."
        ),
    }


def main() -> None:
    try:
        input_value = json.load(sys.stdin)
    except (json.JSONDecodeError, OSError):
        print(json.dumps({"continue": True}))
        return
    print(json.dumps(evaluate_stop(input_value), separators=(",", ":")))


if __name__ == "__main__":
    main()
