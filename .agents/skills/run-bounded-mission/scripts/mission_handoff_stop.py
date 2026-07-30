#!/usr/bin/env python3

from __future__ import annotations

import hashlib
import json
import os
import re
import shlex
import sys
import tempfile
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any


STAGES = ("start", "contract", "plan", "build", "evaluate", "handoff", "terminate")
MARKERS = {f"Mission-{stage.title()}:": stage for stage in STAGES}
STATUSES = {"done", "noop", "blocked"}
BUILD_SECONDS = 30 * 60
TRANSCRIPT_CHUNK_BYTES = 64 * 1024
IMMUTABLE_IDENTITY = re.compile(
    r"(?:none|sha256:[0-9a-f]{64}|git:(?:[0-9a-f]{40}|[0-9a-f]{64}))"
)
READ_ONLY_TOOLS = {
    "read",
    "grep",
    "glob",
    "list_agents",
    "list_mcp_resources",
    "read_mcp_resource",
    "request_user_input",
    "send_message",
    "spawn_agent",
    "update_plan",
    "view_image",
    "wait_agent",
    "web_search",
}
SHELL_TOOLS = {"bash", "exec_command", "shell", "shell_command"}
SOURCE_WRITE_TOOLS = {"apply_patch", "edit", "write", "write_file"}
HANDOFF_TOOL_WORDS = {
    "deploy",
    "handoff",
    "merge",
    "publish",
    "push",
    "release",
    "send",
    "upload",
}
READ_ONLY_SHELL_COMMANDS = {
    "basename",
    "cat",
    "cut",
    "dirname",
    "find",
    "git",
    "gh",
    "head",
    "ls",
    "od",
    "pwd",
    "readlink",
    "rg",
    "sed",
    "shasum",
    "stat",
    "tail",
    "test",
    "wc",
}
EVALUATION_SHELL_COMMANDS = READ_ONLY_SHELL_COMMANDS | {
    "bun",
    "cargo",
    "go",
    "make",
    "node",
    "npm",
    "npx",
    "pnpm",
    "python",
    "python3",
    "pytest",
    "ruby",
    "uv",
    "yarn",
}


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
    return write_state(input_value, {"admitted_at": now, "tool_seen": False})


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


def messages_for_turn(path: str, turn_id: str) -> list[str]:
    newest: list[str] = []
    try:
        for line in read_lines_newest_first(path):
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue
            payload = entry.get("payload")
            if not isinstance(payload, dict):
                continue
            if entry.get("type") == "turn_context" and payload.get("turn_id") == turn_id:
                return list(reversed(newest))
            if entry.get("type") == "response_item":
                text = assistant_text(payload)
                if text:
                    newest.append(text)
    except (OSError, UnicodeDecodeError):
        return []
    return []


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


def receipt_records(
    messages: list[str], turn_id: str
) -> list[tuple[str, dict[str, Any] | None]]:
    found: list[tuple[str, dict[str, Any] | None]] = []
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
                    found.append(("invalid", None))
                    break
                found.append(
                    (stage, record)
                    if isinstance(record, dict) and record.get("turn_id") == turn_id
                    else ("invalid", None)
                )
                break
    return found


def receipts(messages: list[str], turn_id: str) -> list[tuple[str, str]]:
    return [
        (stage, record.get("status", "invalid") if record else "invalid")
        for stage, record in receipt_records(messages, turn_id)
    ]


def immutable_identity(value: object) -> bool:
    return isinstance(value, str) and IMMUTABLE_IDENTITY.fullmatch(value) is not None


def valid_stage_record(
    stage: str,
    record: dict[str, Any] | None,
    turn_id: str,
    tool_seen: bool,
) -> bool:
    if (
        not record
        or record.get("turn_id") != turn_id
        or record.get("status") not in STATUSES
    ):
        return False
    if not tool_seen:
        return set(record) == {"turn_id", "status"}
    if stage == "start":
        return (
            record.get("status") == "done"
            and isinstance(record.get("endpoint"), str)
            and bool(record["endpoint"])
            and immutable_identity(record.get("origin"))
            and isinstance(record.get("stop"), str)
            and bool(record["stop"])
        )
    if stage == "handoff":
        disposition = (
            record.get("acceptance") == "passed" and record.get("route") == "accept"
        ) or (
            record.get("acceptance") == "blocked" and record.get("route") == "blocked"
        )
        effects = record.get("effects")
        effects_valid = isinstance(effects, list) and (
            record.get("endpoint") != "merged"
            or record.get("acceptance") != "passed"
            or bool(effects)
        )
        return (
            isinstance(record.get("endpoint"), str)
            and bool(record["endpoint"])
            and immutable_identity(record.get("origin"))
            and immutable_identity(record.get("candidate"))
            and effects_valid
            and record.get("cleanup") in {"complete", "preserved"}
            and disposition
        )
    return set(record) == {"turn_id", "status"}


def valid_prefix(
    found: list[tuple[str, dict[str, Any] | None]],
    turn_id: str,
    tool_seen: bool,
) -> bool:
    return len(found) <= len(STAGES) and [stage for stage, _ in found] == list(
        STAGES[: len(found)]
    ) and all(
        valid_stage_record(stage, record, turn_id, tool_seen)
        for stage, record in found
    )


def boundaries_match(
    found: list[tuple[str, dict[str, Any] | None]],
) -> bool:
    records = {stage: record for stage, record in found}
    start = records.get("start")
    handoff = records.get("handoff")
    return bool(
        start
        and handoff
        and start.get("endpoint") == handoff.get("endpoint")
        and start.get("origin") == handoff.get("origin")
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


def complete(messages: list[str], turn_id: str, tool_seen: bool) -> bool:
    found = receipt_records(messages, turn_id)
    complete_sequence = (
        valid_prefix(found, turn_id, tool_seen)
        and len(found) == len(STAGES)
        and terminal_is_last(messages, turn_id)
    )
    if not complete_sequence:
        return False
    if tool_seen:
        return boundaries_match(found)
    statuses = {stage: record["status"] for stage, record in found if record}
    return (
        statuses["start"] == "done"
        and statuses["terminate"] == "done"
        and all(statuses[stage] == "noop" for stage in STAGES[1:-1])
    )


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
    start_record: dict[str, Any] | None = None,
) -> str:
    lines: list[str] = []
    for stage in STAGES[start:]:
        status = "done" if stage in {"start", "terminate"} else (
            "blocked" if tool_seen else "noop"
        )
        if tool_seen and stage == "start":
            value = {
                "turn_id": turn_id,
                "status": "done",
                "endpoint": "local-only",
                "origin": "none",
                "stop": "blocked recovery only",
            }
        elif tool_seen and stage == "handoff":
            value = {
                "turn_id": turn_id,
                "status": "blocked",
                "endpoint": (
                    start_record.get("endpoint", "local-only")
                    if start_record
                    else "local-only"
                ),
                "origin": (
                    start_record.get("origin", "none") if start_record else "none"
                ),
                "candidate": "none",
                "acceptance": "blocked",
                "effects": [],
                "cleanup": "preserved",
                "route": "blocked",
            }
        else:
            value = {"turn_id": turn_id, "status": status}
        lines.append(
            f"Mission-{stage.title()}: "
            f"{json.dumps(value, separators=(',', ':'))}"
        )
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
        "recommend, and obtain alignment before Build. A user-requested writable mission defaults "
        "to merged, including its ordinary worktree, commit, push, single PR, review-thread "
        "resolution, and direct non-admin merge, unless the user selects another endpoint or "
        "forbids a required remote effect. Read-only work has no effects; automatic merge, merge "
        "queues, admin/settings, deployment, scheduling, secrets, and unrelated shared state "
        "remain separate authority. For an answer-only request, use no tools, "
        "answer briefly, mark Plan noop, then append exactly:\n"
        f"{answer_receipts}\n"
        "For other work, emit each stage receipt exactly once after that stage. Start must "
        "include endpoint, immutable origin, and total stop; Handoff must include the matching "
        "endpoint and origin plus candidate, acceptance, effects, cleanup, and route. "
        "Mission-Terminate must be the final line. "
        "If an immutable structured-output schema cannot carry lifecycle receipts, fail closed: "
        "the current hook payload has no trusted structured-output signal and cannot safely "
        "exempt JSON-shaped writable responses."
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


def normalized_tool_name(input_value: dict[str, Any]) -> str:
    value = input_value.get("tool_name")
    return value.lower() if isinstance(value, str) else ""


def shell_command(input_value: dict[str, Any]) -> str:
    tool_input = input_value.get("tool_input")
    if not isinstance(tool_input, dict):
        return ""
    for key in ("cmd", "command"):
        value = tool_input.get(key)
        if isinstance(value, str):
            return value.strip()
    return ""


def shell_programs(command: str) -> list[str] | None:
    if not command or re.search(r"(?:^|[^<])>>?|[|;&]|\$\(|`", command):
        return None
    try:
        words = shlex.split(command)
    except ValueError:
        return None
    if not words:
        return []
    programs: list[str] = []
    expect_program = True
    for word in words:
        if word in {"&&", "||", ";", "|"}:
            expect_program = True
            continue
        if expect_program:
            if "=" in word and not word.startswith(("/", "./")):
                name, _, _ = word.partition("=")
                if name.replace("_", "").isalnum():
                    continue
            programs.append(Path(word).name)
            expect_program = False
    return programs


def read_only_shell(command: str) -> bool:
    programs = shell_programs(command)
    if not programs or any(program not in READ_ONLY_SHELL_COMMANDS for program in programs):
        return False
    try:
        words = shlex.split(command)
    except ValueError:
        return False
    program = Path(words[0]).name
    arguments = words[1:]
    if program == "git":
        return bool(arguments) and arguments[0] in {
            "branch",
            "diff",
            "log",
            "ls-files",
            "merge-base",
            "remote",
            "rev-list",
            "rev-parse",
            "show",
            "status",
        } and not any(argument in {"-d", "-D", "--delete"} for argument in arguments)
    if program == "gh":
        if not arguments:
            return False
        if arguments[0] == "api":
            return not any(
                argument in {"-X", "--method", "-f", "-F", "--field", "--raw-field"}
                for argument in arguments
            )
        return len(arguments) > 1 and (arguments[0], arguments[1]) in {
            ("pr", "checks"),
            ("pr", "diff"),
            ("pr", "list"),
            ("pr", "status"),
            ("pr", "view"),
            ("repo", "view"),
            ("run", "list"),
            ("run", "view"),
            ("run", "watch"),
        }
    if program == "sed":
        return "-i" not in arguments and not re.search(
            r"(?:^|[;\s])w(?:\s|$)", command
        )
    if program == "find":
        return not any(
            argument in {"-delete", "-exec", "-execdir", "-ok", "-okdir"}
            for argument in arguments
        )
    return True


def evaluation_shell(command: str) -> bool:
    programs = shell_programs(command)
    return bool(
        programs
        and all(program in EVALUATION_SHELL_COMMANDS for program in programs)
        and not re.search(r"\b(?:tee|rm|mv|cp|mkdir|touch|truncate)\b", command)
    )


def handoff_shell(command: str) -> bool:
    if re.search(r"[|;&]|\$\(|`|(?:^|[^<])>>?", command):
        return False
    return bool(
        re.fullmatch(
            r"\s*(?:git\s+(?:add(?:\s+.+)?|branch\s+-[dD](?:\s+.+)?|"
            r"commit(?:\s+.+)?|push(?:\s+.+)?|worktree\s+(?:prune|remove)(?:\s+.+)?)|"
            r"gh\s+(?:pr\s+(?:close|comment|create|edit|merge|ready|reopen|review)"
            r"(?:\s+.+)?|api\s+(?:(?:--method|-X)\s+)?(?:POST|PATCH|PUT|DELETE)"
            r"(?:\s+.+)?))\s*",
            command,
            re.IGNORECASE,
        )
    )


def tool_class(input_value: dict[str, Any]) -> str:
    name = normalized_tool_name(input_value)
    operation = name.rsplit("__", 1)[-1]
    if name in READ_ONLY_TOOLS or operation.startswith(
        ("read_", "get_", "list_", "search_", "view_")
    ):
        return "read"
    if name in SOURCE_WRITE_TOOLS or any(
        word in name for word in ("patch", "edit", "write_file")
    ):
        return "source"
    if name in SHELL_TOOLS or name.endswith(("bash", "exec_command", "shell")):
        command = shell_command(input_value)
        if read_only_shell(command):
            return "read"
        if handoff_shell(command):
            return "handoff"
        return "shell"
    if any(word in name for word in HANDOFF_TOOL_WORDS):
        return "handoff"
    if "github" in name and operation.startswith(
        ("add_", "create_", "delete_", "resolve_", "submit_", "update_")
    ):
        return "handoff"
    return "source"


def pre_tool_use(input_value: dict[str, Any], now: float) -> dict[str, Any]:
    state = read_state(input_value)
    if state is None:
        return deny("Mission admission state is unavailable; tool use is blocked.")
    state["tool_seen"] = True
    if not write_state(input_value, state):
        return deny("Mission state could not record tool use.")
    category = tool_class(input_value)
    if category == "read":
        return {}
    if input_value.get("permission_mode") == "plan":
        return deny("Plan mode is read-only. Finish planning before repository writes.")
    turn_id = input_value.get("turn_id")
    found = receipt_records(current_messages(input_value), turn_id)
    if not valid_prefix(found, turn_id, True):
        return deny("Mission receipts are malformed or out of order; writes are blocked.")
    stages = [stage for stage, _ in found]
    build_started_at = state.get("build_started_at")
    if category in {"source", "shell"} and build_started_at is None:
        if stages != ["start", "contract", "plan"]:
            return deny("Complete visible Start, Contract, and Plan before Build writes.")
        state["build_started_at"] = now
        if not write_state(input_value, state):
            return deny("Mission state could not start the Build window.")
        build_started_at = now
    if (
        category in {"source", "shell"}
        and isinstance(build_started_at, (int, float))
        and now - float(build_started_at) > BUILD_SECONDS
    ):
        return deny(
            "The 30-minute Build window expired. Finish Handoff as blocked and run "
            "Mission-Terminate; do not revise or replan in this mission."
        )
    if category == "source" and stages != ["start", "contract", "plan"]:
        return deny("Source writes are allowed only in Build before its receipt.")
    if category == "shell":
        if stages == ["start", "contract", "plan"]:
            return {}
        if stages == ["start", "contract", "plan", "build"] and evaluation_shell(
            shell_command(input_value)
        ):
            return {}
        return deny("Shell writes are outside the active Build or Evaluate stage.")
    if category == "handoff" and stages != list(STAGES[:5]):
        return deny("External delivery writes are allowed only after Evaluate.")
    return {}


def stop(input_value: dict[str, Any]) -> dict[str, Any]:
    turn_id = input_value.get("turn_id")
    if not isinstance(turn_id, str):
        return {"continue": False, "stopReason": "Mission turn_id is unavailable."}
    messages = current_messages(input_value)
    state = read_state(input_value) or {}
    tool_seen = state.get("tool_seen") is True
    if complete(messages, turn_id, tool_seen):
        clear_state(input_value)
        return {"continue": True}
    if input_value.get("stop_hook_active") is True:
        last = messages[-1:] if messages else []
        if complete(last, turn_id, tool_seen):
            clear_state(input_value)
            return {"continue": True}
        clear_state(input_value)
        return {
            "continue": False,
            "stopReason": "Mission remained incomplete after one continuation.",
            "systemMessage": "The turn stopped without one ordered seven-stage lifecycle.",
        }

    found = receipt_records(messages, turn_id)
    if valid_prefix(found, turn_id, tool_seen) and len(found) < len(STAGES):
        start_record = found[0][1] if found and found[0][0] == "start" else None
        suffix = recovery_suffix(
            turn_id,
            len(found),
            tool_seen,
            start_record,
        )
        reason = (
            "Resume only to close this mission. Do not call tools or repeat prior receipts. "
            "Append exactly this missing suffix, with Mission-Terminate last:\n"
            f"{suffix}"
        )
    else:
        replacement = recovery_suffix(turn_id, 0, tool_seen)
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
