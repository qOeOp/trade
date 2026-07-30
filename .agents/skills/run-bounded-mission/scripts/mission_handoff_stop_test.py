#!/usr/bin/env python3

from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


SCRIPT = Path(__file__).with_name("mission_handoff_stop.py")
SPEC = importlib.util.spec_from_file_location("mission_handoff_stop", SCRIPT)
assert SPEC and SPEC.loader
hook = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(hook)

TURN = "turn-1"
SESSION = "session-1"


def message(text: str) -> dict[str, object]:
    return {
        "type": "response_item",
        "payload": {
            "type": "message",
            "role": "assistant",
            "content": [{"type": "output_text", "text": text}],
        },
    }


def receipt(stage: str, status: str = "done") -> str:
    return (
        f"Mission-{stage}: "
        + json.dumps({"turn_id": TURN, "status": status}, separators=(",", ":"))
    )


def lifecycle() -> str:
    return "\n".join(
        (
            receipt("Start"),
            receipt("Contract"),
            receipt("Plan"),
            receipt("Build", "noop"),
            receipt("Evaluate", "noop"),
            receipt("Handoff", "noop"),
            receipt("Terminate"),
        )
    )


class MissionLifecycleHookTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.transcript = Path(self.temp.name) / "transcript.jsonl"
        self.input = {
            "session_id": SESSION,
            "turn_id": TURN,
            "transcript_path": str(self.transcript),
            "cwd": self.temp.name,
        }
        self.state_root = Path(self.temp.name) / "state"
        self.temp_patch = patch.object(
            hook.tempfile, "gettempdir", return_value=str(self.state_root)
        )
        self.temp_patch.start()
        self.addCleanup(self.temp_patch.stop)

    def write_messages(self, *texts: str) -> None:
        lines = [
            json.dumps(
                {
                    "type": "turn_context",
                    "payload": {"turn_id": TURN, "cwd": self.temp.name},
                }
            )
        ]
        lines.extend(json.dumps(message(text)) for text in texts)
        self.transcript.write_text("\n".join(lines) + "\n")

    def admit(self, now: float = 100.0) -> dict[str, object]:
        return hook.evaluate(
            {**self.input, "hook_event_name": "UserPromptSubmit"},
            now=now,
        )

    def pre_tool(self, now: float = 101.0, mode: str = "default") -> dict[str, object]:
        return hook.evaluate(
            {
                **self.input,
                "hook_event_name": "PreToolUse",
                "tool_name": "apply_patch",
                "permission_mode": mode,
            },
            now=now,
        )

    def test_prompt_admits_one_seven_stage_mission(self) -> None:
        result = self.admit()
        context = result["hookSpecificOutput"]["additionalContext"]
        self.assertIn(f"turn_id={TURN}", context)
        self.assertIn(lifecycle(), context)
        self.assertTrue(hook.state_path(self.input).exists())

    def test_write_requires_completed_visible_plan(self) -> None:
        self.admit()
        self.write_messages(receipt("Start"), receipt("Contract"))
        self.assertEqual(
            self.pre_tool()["hookSpecificOutput"]["permissionDecision"],
            "deny",
        )

    def test_write_opens_after_plan(self) -> None:
        self.admit()
        self.write_messages(
            "\n".join((receipt("Start"), receipt("Contract"), receipt("Plan")))
        )
        self.assertEqual(self.pre_tool(), {})

    def test_plan_mode_is_read_only(self) -> None:
        self.admit()
        self.write_messages(
            "\n".join((receipt("Start"), receipt("Contract"), receipt("Plan")))
        )
        self.assertEqual(
            self.pre_tool(mode="plan")["hookSpecificOutput"]["permissionDecision"],
            "deny",
        )

    def test_expired_build_window_blocks_more_edits(self) -> None:
        self.admit()
        self.write_messages(
            "\n".join((receipt("Start"), receipt("Contract"), receipt("Plan")))
        )
        reason = self.pre_tool(now=100.0 + hook.BUILD_SECONDS + 1)[
            "hookSpecificOutput"
        ]["permissionDecisionReason"]
        self.assertIn("expired", reason)

    def test_stop_accepts_exact_order_and_cleans_state(self) -> None:
        self.admit()
        self.write_messages("answer\n" + lifecycle())
        result = hook.evaluate(
            {
                **self.input,
                "hook_event_name": "Stop",
                "last_assistant_message": "answer\n" + lifecycle(),
            }
        )
        self.assertEqual(result, {"continue": True})
        self.assertFalse(hook.state_path(self.input).exists())

    def test_stop_accepts_last_message_without_transcript(self) -> None:
        self.admit()
        result = hook.evaluate(
            {
                **self.input,
                "hook_event_name": "Stop",
                "transcript_path": None,
                "last_assistant_message": "answer\n" + lifecycle(),
            }
        )
        self.assertEqual(result, {"continue": True})
        self.assertFalse(hook.state_path(self.input).exists())

    def test_stop_continues_once_then_fails_explicitly(self) -> None:
        self.admit()
        self.write_messages("answer")
        first = hook.evaluate({**self.input, "hook_event_name": "Stop"})
        second = hook.evaluate(
            {
                **self.input,
                "hook_event_name": "Stop",
                "stop_hook_active": True,
            }
        )
        self.assertEqual(first["decision"], "block")
        self.assertIn(lifecycle(), first["reason"])
        self.assertEqual(second["continue"], False)
        self.assertFalse(hook.state_path(self.input).exists())

    def test_fenced_receipts_do_not_close(self) -> None:
        self.admit()
        self.write_messages("```\n" + lifecycle() + "\n```")
        result = hook.evaluate({**self.input, "hook_event_name": "Stop"})
        self.assertEqual(result["decision"], "block")


if __name__ == "__main__":
    unittest.main()
