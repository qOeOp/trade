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

    def delivery_prefix(self, *extra_stages: str) -> str:
        start = json.dumps(
            {
                "turn_id": "turn-1",
                "status": "done",
                "endpoint": "merged",
                "origin": f"git:{'1' * 40}",
                "stop": "one revision",
            },
            separators=(",", ":"),
        )
        lines = [f"Mission-Start: {start}"]
        lines.extend(
            MISSION.receipt_line(stage, "turn-1", "done")
            for stage in ("contract", "plan", *extra_stages)
        )
        return "\n".join(lines)

    def transcript(self, message: str, earlier: str = "") -> str:
        with tempfile.NamedTemporaryFile("w", delete=False) as transcript:
            if earlier:
                transcript.write(earlier)
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
                            "content": [{"type": "output_text", "text": message}],
                        },
                    }
                )
                + "\n"
            )
            return transcript.name

    def pre_tool(
        self,
        tool_name: str,
        message: str,
        *,
        command: str | None = None,
        now: float = 101.0,
    ) -> dict:
        path = self.transcript(message)
        try:
            tool_input = {"cmd": command} if command is not None else {}
            return MISSION.evaluate(
                {
                    **self.input,
                    "transcript_path": path,
                    "hook_event_name": "PreToolUse",
                    "tool_name": tool_name,
                    "tool_input": tool_input,
                    "permission_mode": "default",
                },
                now=now,
            )
        finally:
            Path(path).unlink()

    def test_prompt_admits_every_turn_and_describes_all_stages(self) -> None:
        output = self.submit()
        context = output["hookSpecificOutput"]["additionalContext"]
        self.assertIn("Mission-Start", context)
        self.assertIn("Mission-Terminate", context)
        self.assertIn('"status":"noop"', context)
        self.assertIn("writable mission defaults to merged", context)
        self.assertIn("automatic merge", context)
        self.assertIsNotNone(MISSION.read_state(self.input))

    def test_exact_json_without_trusted_host_signal_fails_closed(self) -> None:
        self.submit()
        output = self.stop('{"result":"ok"}')
        self.assertEqual(output["decision"], "block")
        self.assertIn("Mission-Start:", output["reason"])

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
        output = self.pre_tool("apply_patch", self.delivery_prefix())
        self.assertEqual(output, {})
        state = MISSION.read_state(self.input)
        self.assertTrue(state["tool_seen"])
        self.assertEqual(state["build_started_at"], 101.0)

    def test_patch_is_denied_after_build_receipt(self) -> None:
        self.submit()
        output = self.pre_tool(
            "apply_patch",
            self.delivery_prefix("build"),
        )
        self.assertEqual(
            output["hookSpecificOutput"]["permissionDecision"],
            "deny",
        )

    def test_shell_mutation_cannot_bypass_visible_plan(self) -> None:
        self.submit()
        output = self.pre_tool(
            "exec_command",
            "",
            command="sed -i '' 's/a/b/' file && tee output",
        )
        self.assertEqual(
            output["hookSpecificOutput"]["permissionDecision"],
            "deny",
        )

    def test_namespaced_read_tool_remains_available_during_planning(self) -> None:
        self.submit()
        output = self.pre_tool(
            "mcp__github__get_pull_request",
            "",
        )
        self.assertEqual(output, {})

    def test_plan_control_tool_is_not_treated_as_a_repository_write(self) -> None:
        self.submit()
        self.assertEqual(self.pre_tool("update_plan", ""), {})

    def test_build_timeout_starts_with_first_build_tool(self) -> None:
        self.submit()
        output = self.pre_tool(
            "exec_command",
            self.delivery_prefix(),
            command="python3 build.py",
            now=4000.0,
        )
        self.assertEqual(output, {})
        self.assertEqual(MISSION.read_state(self.input)["build_started_at"], 4000.0)
        expired = self.pre_tool(
            "exec_command",
            self.delivery_prefix(),
            command="python3 build.py",
            now=5801.0,
        )
        self.assertEqual(
            expired["hookSpecificOutput"]["permissionDecision"],
            "deny",
        )

    def test_evaluation_shell_is_allowed_but_mutating_shell_is_denied(self) -> None:
        self.submit()
        self.assertEqual(
            self.pre_tool(
                "exec_command",
                self.delivery_prefix(),
                command="python3 build.py",
            ),
            {},
        )
        self.assertEqual(
            self.pre_tool(
                "exec_command",
                self.delivery_prefix("build"),
                command="python3 -m unittest test_module.py",
            ),
            {},
        )
        denied = self.pre_tool(
            "exec_command",
            self.delivery_prefix("build"),
            command="python3 rewrite_source.py > generated.py",
        )
        self.assertEqual(
            denied["hookSpecificOutput"]["permissionDecision"],
            "deny",
        )

    def test_handoff_write_requires_evaluate_receipt(self) -> None:
        self.submit()
        denied = self.pre_tool(
            "exec_command",
            self.delivery_prefix("build"),
            command="git push origin HEAD",
        )
        self.assertEqual(
            denied["hookSpecificOutput"]["permissionDecision"],
            "deny",
        )
        allowed = self.pre_tool(
            "exec_command",
            self.delivery_prefix("build", "evaluate"),
            command="git push origin HEAD",
        )
        self.assertEqual(allowed, {})

    def test_malformed_start_and_handoff_boundary_are_rejected(self) -> None:
        self.submit()
        state = MISSION.read_state(self.input)
        state["tool_seen"] = True
        MISSION.write_state(self.input, state)
        malformed = "\n".join(
            MISSION.receipt_line(stage, "turn-1", "done")
            for stage in MISSION.STAGES
        )
        self.assertEqual(self.stop(malformed)["decision"], "block")

        prefix = self.delivery_prefix("build", "evaluate")
        handoff = json.dumps(
            {
                "turn_id": "turn-1",
                "status": "done",
                "endpoint": "merged",
                "origin": f"git:{'2' * 40}",
                "candidate": f"git:{'3' * 40}",
                "acceptance": "passed",
                "effects": [],
                "cleanup": "complete",
                "route": "accept",
            },
            separators=(",", ":"),
        )
        mismatched = "\n".join(
            (
                prefix,
                f"Mission-Handoff: {handoff}",
                MISSION.receipt_line("terminate", "turn-1", "done"),
            )
        )
        self.assertEqual(self.stop(mismatched)["decision"], "block")

    def test_complete_delivery_requires_and_accepts_matching_boundary(self) -> None:
        self.submit()
        state = MISSION.read_state(self.input)
        state["tool_seen"] = True
        MISSION.write_state(self.input, state)
        empty_effects_handoff = json.dumps(
            {
                "turn_id": "turn-1",
                "status": "done",
                "endpoint": "merged",
                "origin": f"git:{'1' * 40}",
                "candidate": f"git:{'3' * 40}",
                "acceptance": "passed",
                "effects": [],
                "cleanup": "complete",
                "route": "accept",
            },
            separators=(",", ":"),
        )
        empty_effects_message = "\n".join(
            (
                self.delivery_prefix("build", "evaluate"),
                f"Mission-Handoff: {empty_effects_handoff}",
                MISSION.receipt_line("terminate", "turn-1", "done"),
            )
        )
        self.assertEqual(self.stop(empty_effects_message)["decision"], "block")

        handoff = json.dumps(
            {
                "turn_id": "turn-1",
                "status": "done",
                "endpoint": "merged",
                "origin": f"git:{'1' * 40}",
                "candidate": f"git:{'3' * 40}",
                "acceptance": "passed",
                "effects": [{"kind": "github_pull_request"}],
                "cleanup": "complete",
                "route": "accept",
            },
            separators=(",", ":"),
        )
        message = "\n".join(
            (
                self.delivery_prefix("build", "evaluate"),
                f"Mission-Handoff: {handoff}",
                MISSION.receipt_line("terminate", "turn-1", "done"),
            )
        )
        self.assertEqual(self.stop(message), {"continue": True})

    def test_tool_recovery_sequence_can_close_as_blocked(self) -> None:
        self.submit()
        state = MISSION.read_state(self.input)
        state["tool_seen"] = True
        MISSION.write_state(self.input, state)
        first = self.stop("unfinished")
        replacement = first["reason"].split("last:\n", 1)[1]
        self.assertEqual(self.stop(replacement, active=True), {"continue": True})

    def test_transcript_scan_stops_at_current_turn_boundary(self) -> None:
        earlier = (
            json.dumps(
                {
                    "type": "response_item",
                    "payload": {
                        "type": "message",
                        "role": "assistant",
                        "content": [
                            {
                                "type": "output_text",
                                "text": MISSION.receipt_line(
                                    "start", "old-turn", "done"
                                ),
                            }
                        ],
                    },
                }
            )
            + "\n"
        )
        path = self.transcript(self.delivery_prefix(), earlier=earlier)
        try:
            messages = MISSION.messages_for_turn(path, "turn-1")
            self.assertEqual(messages, [self.delivery_prefix()])
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
