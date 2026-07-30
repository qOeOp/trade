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


def write_state(input_value: dict[str, Any], state: dict[str, Any]) -> bool:
    path = state_path(input_value)
    if path is None:
        return False
    try:
        path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        path.write_text(json.dumps(state, separators=(",", ":")))
    except OSError:
        return False
    return True


def clear_state(input_value: dict[str, Any]) -> None:
    path = state_path(input_value)
    if path is not None:
        path.unlink(missing_ok=True)


def start_state(input_value: dict[str, Any], now: float) -> bool:
    if read_state(input_value) is not None:
        return True
    return write_state(input_value, {"started_at": now, "tool_seen": False})


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
                    and set(stripped) == {fence[0]}
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
                    and record.get("turn_id") == turn_id
                    and record.get("status") in STATUSES
                ):
                    found.append((stage, record["status"]))
                else:
                    found.append(("invalid", "invalid"))
                break
    return found


def valid_prefix(found: list[tuple[str, str]]) -> bool:
    return len(found) <= len(STAGES) and [stage for stage, _ in found] == list(
        STAGES[: len(found)]
    )


def terminal_is_last(messages: list[str], turn_id: str) -> bool:
    if not messages:
        return False
    lines = [line for line in messages[-1].splitlines() if line.strip()]
    if not lines:
        return False
    marker = "Mission-Terminate: "
    if not lines[-1].startswith(marker):
        return False
    try:
        record = json.loads(lines[-1][len(marker) :])
    except json.JSONDecodeError:
        return False
    return (
        isinstance(record, dict)
        and record.get("turn_id") == turn_id
        and record.get("status") in STATUSES
    )


def complete(messages: list[str], turn_id: str) -> bool:
    found = receipts(messages, turn_id)
    return (
        valid_prefix(found)
        and len(found) == len(STAGES)
        and terminal_is_last(messages, turn_id)
    )


def exact_json_document(message: str) -> bool:
    if not message.strip():
        return False
    try:
        json.loads(message)
    except json.JSONDecodeError:
        return False
    return True


def receipt_line(stage: str, turn_id: str, status: str) -> str:
    marker = f"Mission-{stage.title()}:"
    value = json.dumps(
        {"turn_id": turn_id, "status": status},
        separators=(",", ":"),
    )
    return f"{marker} {value}"


def recovery_suffix(
    turn_id: str,
    start: int,
    tool_seen: bool,
) -> str:
    lines: list[str] = []
    for stage in STAGES[start:]:
        if stage in {"start", "terminate"}:
            status = "done"
        else:
            status = "blocked" if tool_seen else "noop"
        lines.append(receipt_line(stage, turn_id, status))
    return "\n".join(lines)


def prompt_submit(input_value: dict[str, Any], now: float) -> dict[str, Any]:
    turn_id = input_value.get("turn_id")
    if not isinstance(turn_id, str) or not turn_id or not start_state(input_value, now):
        return {"decision": "block", "reason": "Mission admission could not bind this turn."}
    answer_receipts = "\n".join(
        (
            receipt_line("start", turn_id, "done"),
            receipt_line("contract", turn_id, "noop"),
            receipt_line("plan", turn_id, "noop"),
            receipt_line("build", turn_id, "noop"),
            receipt_line("evaluate", turn_id, "noop"),
            receipt_line("handoff", turn_id, "noop"),
            receipt_line("terminate", turn_id, "done"),
        )
    )
    context = (
        f"MANDATORY root-turn lifecycle, turn_id={turn_id}: Mission-Start, Contract, "
        "Plan, Build, Evaluate, Handoff, Mission-Terminate. Run every stage in order; "
        "each may be done, noop, or blocked. Make Plan visible for work: use a mini-plan "
        "for exact mechanical work; for consequential choices, clarify, compare real options, "
        "recommend, and obtain alignment before Build. Respect the user's delivery authority: "
        "writable work is not automatically a PR. For an answer-only request, use no tools, "
        "answer briefly, mark Plan noop, then append exactly:\n"
        f"{answer_receipts}\n"
        "For other work, emit each stage receipt exactly once after that stage. Start and "
        "Handoff receipts may include the skill's endpoint, origin, candidate, acceptance, "
        "effects, cleanup, and route fields. Mission-Terminate must be the final line. "
        "If an immutable structured-output schema requires an exact JSON document, perform "
        "the lifecycle conceptually but return only that document; the Stop hook preserves it."
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
    state = read_state(input_value)
    if state is None:
        return deny("Mission admission state is unavailable; tool use is blocked.")
    state["tool_seen"] = True
    if not write_state(input_value, state):
        return deny("Mission state could not record tool use.")
    if input_value.get("tool_name") != "apply_patch":
        return {}
    if input_value.get("permission_mode") == "plan":
        return deny("Plan mode is read-only. Finish planning before repository writes.")
    started_at = state.get("started_at")
    if not isinstance(started_at, (int, float)):
        return deny("Mission start time is unavailable; repository writes are blocked.")
    if now - float(started_at) > BUILD_SECONDS:
        return deny(
            "The 30-minute Build window expired. Finish Handoff as blocked and run "
            "Mission-Terminate; do not revise or replan in this mission."
        )
    turn_id = input_value.get("turn_id")
    found = receipts(current_messages(input_value), turn_id)
    if found[:3] != [("start", "done"), ("contract", "done"), ("plan", "done")]:
        return deny("Complete visible Start, Contract, and Plan before repository writes.")
    return {}


def stop(input_value: dict[str, Any]) -> dict[str, Any]:
    turn_id = input_value.get("turn_id")
    if not isinstance(turn_id, str):
        return {"continue": False, "stopReason": "Mission turn_id is unavailable."}
    messages = current_messages(input_value)
    last = messages[-1] if messages else ""
    if exact_json_document(last) or complete(messages, turn_id):
        clear_state(input_value)
        return {"continue": True}
    if input_value.get("stop_hook_active") is True:
        if complete([last], turn_id):
            clear_state(input_value)
            return {"continue": True}
        clear_state(input_value)
        return {
            "continue": False,
            "stopReason": "Mission remained incomplete after one continuation.",
            "systemMessage": "The turn stopped without one ordered seven-stage lifecycle.",
        }

    found = receipts(messages, turn_id)
    state = read_state(input_value) or {}
    if valid_prefix(found) and len(found) < len(STAGES):
        suffix = recovery_suffix(
            turn_id,
            len(found),
            state.get("tool_seen") is True,
        )
        reason = (
            "Resume only to close this mission. Do not call tools or repeat prior receipts. "
            "Append exactly this missing suffix, with Mission-Terminate last:\n"
            f"{suffix}"
        )
    else:
        replacement = recovery_suffix(turn_id, 0, True)
        reason = (
            "The lifecycle receipt sequence is invalid. Resume only to fail closed: do not "
            "call tools or repeat the prior answer; emit exactly this replacement sequence:\n"
            f"{replacement}"
        )
    return {"decision": "block", "reason": reason}


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
        print(
            json.dumps(
                {"continue": False, "stopReason": "Mission hook input is invalid."},
                separators=(",", ":"),
            )
        )
        return
    print(json.dumps(evaluate(input_value), separators=(",", ":")))


if __name__ == "__main__":
    main()
