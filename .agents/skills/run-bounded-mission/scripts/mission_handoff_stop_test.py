#!/usr/bin/env python3

from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("mission_handoff_stop.py")
SPEC = importlib.util.spec_from_file_location("mission_handoff_stop", SCRIPT)
assert SPEC and SPEC.loader
MISSION = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MISSION)


class MissionHookTest(unittest.TestCase):
    def setUp(self) -> None:
        self.input = {
            "session_id": f"session-{self.id()}",
            "turn_id": "turn-1",
            "transcript_path": None,
        }
        MISSION.clear_state(self.input)

    def tearDown(self) -> None:
        MISSION.clear_state(self.input)

    def submit(self) -> dict:
        return MISSION.evaluate(
            {**self.input, "hook_event_name": "UserPromptSubmit", "prompt": "hi"},
            now=100.0,
        )

    def stop(self, message: str, active: bool = False) -> dict:
        return MISSION.evaluate(
            {
                **self.input,
                "hook_event_name": "Stop",
                "last_assistant_message": message,
                "stop_hook_active": active,
            }
        )

    def test_prompt_admits_every_turn_and_describes_all_stages(self) -> None:
        output = self.submit()
        context = output["hookSpecificOutput"]["additionalContext"]
        self.assertIn("Mission-Start", context)
        self.assertIn("Mission-Terminate", context)
        self.assertIn('"status":"noop"', context)
        self.assertIsNotNone(MISSION.read_state(self.input))

    def test_exact_json_response_is_not_modified(self) -> None:
        self.submit()
        self.assertEqual(self.stop('{"result":"ok"}'), {"continue": True})

    def test_complete_answer_only_lifecycle_passes_with_null_transcript(self) -> None:
        self.submit()
        message = "\n".join(
            (
                "你好。",
                MISSION.receipt_line("start", "turn-1", "done"),
                MISSION.receipt_line("contract", "turn-1", "noop"),
                MISSION.receipt_line("plan", "turn-1", "noop"),
                MISSION.receipt_line("build", "turn-1", "noop"),
                MISSION.receipt_line("evaluate", "turn-1", "noop"),
                MISSION.receipt_line("handoff", "turn-1", "noop"),
                MISSION.receipt_line("terminate", "turn-1", "done"),
            )
        )
        self.assertEqual(self.stop(message), {"continue": True})

    def test_pre_tool_use_denies_patch_before_visible_plan(self) -> None:
        self.submit()
        output = MISSION.evaluate(
            {
                **self.input,
                "hook_event_name": "PreToolUse",
                "tool_name": "apply_patch",
                "permission_mode": "default",
            },
            now=101.0,
        )
        self.assertEqual(
            output["hookSpecificOutput"]["permissionDecision"],
            "deny",
        )

    def test_pre_tool_use_allows_patch_after_visible_plan(self) -> None:
        self.submit()
        prefix = "\n".join(
            MISSION.receipt_line(stage, "turn-1", "done")
            for stage in ("start", "contract", "plan")
        )
        with tempfile.NamedTemporaryFile("w", delete=False) as transcript:
            transcript.write(
                json.dumps(
                    {
                        "type": "turn_context",
                        "payload": {"turn_id": "turn-1"},
                    }
                )
                + "\n"
            )
            transcript.write(
                json.dumps(
                    {
                        "type": "response_item",
                        "payload": {
                            "type": "message",
                            "role": "assistant",
                            "content": [{"type": "output_text", "text": prefix}],
                        },
                    }
                )
                + "\n"
            )
            path = transcript.name
        try:
            output = MISSION.evaluate(
                {
                    **self.input,
                    "transcript_path": path,
                    "hook_event_name": "PreToolUse",
                    "tool_name": "apply_patch",
                    "permission_mode": "default",
                },
                now=101.0,
            )
            self.assertEqual(output, {})
            self.assertTrue(MISSION.read_state(self.input)["tool_seen"])
        finally:
            Path(path).unlink()

    def test_partial_prefix_recovery_emits_only_missing_suffix(self) -> None:
        self.submit()
        prefix = "\n".join(
            MISSION.receipt_line(stage, "turn-1", "done")
            for stage in ("start", "contract", "plan")
        )
        output = self.stop(prefix)
        reason = output["reason"]
        self.assertNotIn("Mission-Start:", reason)
        self.assertNotIn("Mission-Plan:", reason)
        self.assertIn("Mission-Build:", reason)
        self.assertIn("Mission-Terminate:", reason)

    def test_tool_work_recovery_never_synthesizes_noop(self) -> None:
        self.submit()
        state = MISSION.read_state(self.input)
        state["tool_seen"] = True
        MISSION.write_state(self.input, state)
        output = self.stop("unfinished work")
        self.assertNotIn('"status":"noop"', output["reason"])
        self.assertIn('"status":"blocked"', output["reason"])

    def test_answer_only_recovery_uses_noops(self) -> None:
        self.submit()
        output = self.stop("hello")
        self.assertIn('"status":"noop"', output["reason"])
        self.assertNotIn('"status":"blocked"', output["reason"])

    def test_replacement_sequence_can_close_invalid_prior_receipts(self) -> None:
        self.submit()
        invalid = MISSION.receipt_line("plan", "turn-1", "done")
        first = self.stop(invalid)
        replacement = first["reason"].split("sequence:\n", 1)[1]
        self.assertEqual(self.stop(replacement, active=True), {"continue": True})

    def test_second_incomplete_stop_fails_without_another_loop(self) -> None:
        self.submit()
        output = self.stop("still incomplete", active=True)
        self.assertFalse(output["continue"])
        self.assertIn("one continuation", output["stopReason"])


if __name__ == "__main__":
    unittest.main()
