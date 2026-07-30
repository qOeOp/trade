#!/usr/bin/env python3

from __future__ import annotations

import hashlib
import json
import sys
import tempfile
import time
from pathlib import Path
from typing import Any


STAGES = ("start", "contract", "plan", "build", "evaluate", "handoff", "terminate")
MARKERS = {f"Mission-{stage.title()}:": stage for stage in STAGES}
STATUSES = {"done", "noop", "blocked"}
BUILD_SECONDS = 30 * 60


def state_path(input_value: dict[str, Any]) -> Path | None:
    session_id = input_value.get("session_id")
    turn_id = input_value.get("turn_id")
    if not isinstance(session_id, str) or not isinstance(turn_id, str):
        return None
    key = hashlib.sha256(f"{session_id}\0{turn_id}".encode()).hexdigest()
    return Path(tempfile.gettempdir()) / "codex-mission" / f"{key}.json"


def read_state(input_value: dict[str, Any]) -> dict[str, Any] | None:
    path = state_path(input_value)
    if path is None:
        return None
    try:
        value = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return None
    return value if isinstance(value, dict) else None


def start_state(input_value: dict[str, Any], now: float) -> bool:
    path = state_path(input_value)
    if path is None:
        return False
    if read_state(input_value) is not None:
        return True
    try:
        path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        path.write_text(json.dumps({"started_at": now}, separators=(",", ":")))
    except OSError:
        return False
    return True


def assistant_text(payload: dict[str, Any]) -> str:
    if (
        payload.get("type") != "message"
        or payload.get("role") != "assistant"
        or not isinstance(payload.get("content"), list)
    ):
        return ""
    return "".join(
        item["text"]
        for item in payload["content"]
        if isinstance(item, dict)
        and item.get("type") == "output_text"
        and isinstance(item.get("text"), str)
    )


def messages_for_turn(path: str, turn_id: str) -> list[str]:
    messages: list[str] = []
    active = False
    try:
        with open(path, encoding="utf-8") as transcript:
            for line in transcript:
                try:
                    entry = json.loads(line)
                except json.JSONDecodeError:
                    continue
                payload = entry.get("payload")
                if not isinstance(payload, dict):
                    continue
                if entry.get("type") == "turn_context":
                    active = payload.get("turn_id") == turn_id
                    if active:
                        messages = []
                    continue
                if active and entry.get("type") == "response_item":
                    text = assistant_text(payload)
                    if text:
                        messages.append(text)
    except OSError:
        return []
    return messages


def current_messages(input_value: dict[str, Any]) -> list[str]:
    turn_id = input_value.get("turn_id")
    if not isinstance(turn_id, str):
        return []
    transcript_path = input_value.get("transcript_path")
    messages = (
        messages_for_turn(transcript_path, turn_id)
        if isinstance(transcript_path, str)
        else []
    )
    last = input_value.get("last_assistant_message")
    if isinstance(last, str) and last and (not messages or messages[-1] != last):
        messages.append(last)
    return messages


def receipts(messages: list[str], turn_id: str) -> list[tuple[str, str]]:
    found: list[tuple[str, str]] = []
    for message in messages:
        fence: tuple[str, int] | None = None
        for line in message.splitlines():
            stripped = line.strip()
            if fence:
                if (
                    stripped
                    and set(stripped) <= {fence[0]}
                    and len(stripped) >= fence[1]
                ):
                    fence = None
                continue
            if stripped.startswith(("```", "~~~")):
                fence = stripped[0], len(stripped) - len(stripped.lstrip(stripped[0]))
                continue
            for marker, stage in MARKERS.items():
                if not line.startswith(f"{marker} "):
                    continue
                try:
                    record = json.loads(line[len(marker) :].strip())
                except json.JSONDecodeError:
                    found.append(("invalid", "invalid"))
                    break
                if (
                    isinstance(record, dict)
                    and set(record) == {"turn_id", "status"}
                    and record.get("turn_id") == turn_id
                    and record.get("status") in STATUSES
                ):
                    found.append((stage, record["status"]))
                else:
                    found.append(("invalid", "invalid"))
                break
    return found


def plan_complete(input_value: dict[str, Any]) -> bool:
    turn_id = input_value.get("turn_id")
    if not isinstance(turn_id, str):
        return False
    found = receipts(current_messages(input_value), turn_id)
    return found[:3] == [("start", "done"), ("contract", "done"), ("plan", "done")]


def required_receipts(turn_id: str) -> str:
    return "\n".join(
        (
            f'Mission-Start: {{"turn_id":"{turn_id}","status":"done"}}',
            f'Mission-Contract: {{"turn_id":"{turn_id}","status":"done"}}',
            f'Mission-Plan: {{"turn_id":"{turn_id}","status":"done"}}',
            f'Mission-Build: {{"turn_id":"{turn_id}","status":"noop"}}',
            f'Mission-Evaluate: {{"turn_id":"{turn_id}","status":"noop"}}',
            f'Mission-Handoff: {{"turn_id":"{turn_id}","status":"noop"}}',
            f'Mission-Terminate: {{"turn_id":"{turn_id}","status":"done"}}',
        )
    )


def prompt_submit(input_value: dict[str, Any], now: float) -> dict[str, Any]:
    turn_id = input_value.get("turn_id")
    if not isinstance(turn_id, str) or not turn_id or not start_state(input_value, now):
        return {"decision": "block", "reason": "Mission admission could not bind this turn."}
    context = (
        f"MANDATORY lifecycle for this root turn, turn_id={turn_id}: Mission-Start, "
        "Contract, Plan, Build, Evaluate, Handoff, Mission-Terminate. Every stage is required "
        "and may be done, noop, or blocked. Make Plan visible. Use a mini-plan for exact "
        "mechanical work; for a consequential choice, clarify, explore, compare, recommend, "
        "and obtain user alignment before Build. For an answer-only request, do not read the "
        "skill or use tools: answer briefly, then append these exact receipts:\n"
        f"{required_receipts(turn_id)}\n"
        "For other work, emit each corresponding receipt exactly once after its stage. "
        "Mission-Terminate must be the final line. A Stop continuation resumes this mission."
    )
    return {
        "hookSpecificOutput": {
            "hookEventName": "UserPromptSubmit",
            "additionalContext": context,
        }
    }


def deny(reason: str) -> dict[str, Any]:
    return {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        }
    }


def pre_tool_use(input_value: dict[str, Any], now: float) -> dict[str, Any]:
    if input_value.get("tool_name") != "apply_patch":
        return {}
    if input_value.get("permission_mode") == "plan":
        return deny("Plan mode is read-only. Finish planning before repository writes.")
    state = read_state(input_value)
    started_at = state.get("started_at") if state else None
    if not isinstance(started_at, (int, float)):
        return deny("Mission admission state is unavailable; repository writes are blocked.")
    if now - float(started_at) > BUILD_SECONDS:
        return deny(
            "The 30-minute Build window expired. Do not revise or replan in this mission; "
            "finish Handoff as blocked and run Mission-Terminate."
        )
    if not plan_complete(input_value):
        return deny("Complete the visible Contract and Plan before repository writes.")
    return {}


def terminal_is_last(messages: list[str], turn_id: str) -> bool:
    if not messages:
        return False
    last_lines = [line for line in messages[-1].splitlines() if line.strip()]
    if not last_lines:
        return False
    marker = "Mission-Terminate: "
    line = last_lines[-1]
    if not line.startswith(marker):
        return False
    try:
        record = json.loads(line[len(marker) :])
    except json.JSONDecodeError:
        return False
    return isinstance(record, dict) and record.get("turn_id") == turn_id


def stop(input_value: dict[str, Any]) -> dict[str, Any]:
    turn_id = input_value.get("turn_id")
    if not isinstance(turn_id, str):
        return {"continue": False, "stopReason": "Mission turn_id is unavailable."}
    messages = current_messages(input_value)
    found = receipts(messages, turn_id)
    if [stage for stage, _ in found] == list(STAGES) and terminal_is_last(
        messages, turn_id
    ):
        path = state_path(input_value)
        if path is not None:
            path.unlink(missing_ok=True)
        return {"continue": True}
    if input_value.get("stop_hook_active") is True:
        path = state_path(input_value)
        if path is not None:
            path.unlink(missing_ok=True)
        return {
            "continue": False,
            "stopReason": "Mission remained incomplete after one continuation.",
            "systemMessage": "The turn stopped without one ordered seven-stage lifecycle.",
        }
    return {
        "decision": "block",
        "reason": (
            "Resume this same mission only to close it. Do not read files, call tools, start "
            "another mission, or perform Build work. Repeat the user-facing answer briefly if "
            "needed, then emit exactly these ordered receipts:\n"
            f"{required_receipts(turn_id)}"
        ),
    }


def evaluate(input_value: dict[str, Any], now: float | None = None) -> dict[str, Any]:
    event = input_value.get("hook_event_name")
    current_time = time.time() if now is None else now
    if event == "UserPromptSubmit":
        return prompt_submit(input_value, current_time)
    if event == "PreToolUse":
        return pre_tool_use(input_value, current_time)
    if event == "Stop":
        return stop(input_value)
    return {}


def main() -> None:
    try:
        input_value = json.load(sys.stdin)
    except (json.JSONDecodeError, OSError):
        print(json.dumps({"decision": "block", "reason": "Mission hook input is invalid."}))
        return
    print(json.dumps(evaluate(input_value), separators=(",", ":")))


if __name__ == "__main__":
    main()
