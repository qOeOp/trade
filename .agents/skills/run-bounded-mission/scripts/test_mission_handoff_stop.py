from __future__ import annotations

import json
import tempfile
import unittest

import mission_handoff_stop as hook


ORIGIN = f"git:{'b' * 40}"
CANDIDATE = f"sha256:{'a' * 64}"
START = (
    'Mission-Start: {"endpoint":"merged","origin":"'
    + ORIGIN
    + '","stop":"two revisions"}'
)
ACTIVE = (
    'Mission-Terminal: {"status":"active","endpoint":"merged","origin":"'
    + ORIGIN
    + '"}'
)


def receipt(**overrides: object) -> dict[str, object]:
    value: dict[str, object] = {
        "endpoint": "merged",
        "origin": ORIGIN,
        "candidate": CANDIDATE,
        "acceptance": "passed",
        "effects": [],
        "cleanup": "complete",
        "route": "accept",
    }
    value.update(overrides)
    return value


def handoff(**overrides: object) -> str:
    return "Mission-Handoff: " + json.dumps(receipt(**overrides), separators=(",", ":"))


def evaluate(
    last_message: str,
    history: list[str] | None = None,
    stop_hook_active: bool = False,
) -> dict[str, object]:
    return hook.evaluate_stop(
        {
            "last_assistant_message": last_message,
            "stop_hook_active": stop_hook_active,
        },
        history or [],
    )


class StopHookTests(unittest.TestCase):
    def test_normal_turn_is_ignored(self) -> None:
        self.assertEqual(evaluate("Done."), {"continue": True})

    def test_active_mission_blocks_without_handoff(self) -> None:
        self.assertEqual(evaluate("Implemented.", [START])["decision"], "block")
        self.assertEqual(evaluate(ACTIVE)["decision"], "block")

    def test_active_tail_does_not_consume_older_transcript(self) -> None:
        def older_messages() -> object:
            self.fail("active tail should stop transcript iteration")
            yield "unreachable"

        self.assertEqual(
            hook.mission_state(
                {"last_assistant_message": ACTIVE},
                older_messages(),
            ),
            "active",
        )

    def test_matching_receipt_closes_original_mission(self) -> None:
        self.assertEqual(evaluate(handoff(), [START]), {"continue": True})
        self.assertEqual(evaluate(handoff(), [ACTIVE, START]), {"continue": True})

    def test_mismatched_receipt_or_replacement_marker_blocks(self) -> None:
        self.assertEqual(
            evaluate(handoff(endpoint="local-only"), [START])["decision"],
            "block",
        )
        replacement_origin = f"git:{'d' * 40}"
        replacement = (
            'Mission-Start: {"endpoint":"local-only","origin":"'
            + replacement_origin
            + '","stop":"one revision"}'
        )
        self.assertEqual(
            evaluate(
                handoff(endpoint="local-only", origin=replacement_origin),
                [replacement, START],
            )["decision"],
            "block",
        )

    def test_later_active_marker_keeps_mission_open(self) -> None:
        self.assertEqual(
            evaluate(f"{handoff()}\n{ACTIVE}", [START])["decision"],
            "block",
        )

    def test_structured_envelope_is_supported(self) -> None:
        envelope = json.dumps(
            {"result": {"status": "done"}, "mission_handoff": receipt()}
        )
        self.assertEqual(evaluate(envelope, [START]), {"continue": True})

    def test_multiple_or_malformed_receipts_block(self) -> None:
        self.assertEqual(
            evaluate(f"{handoff()}\n{handoff()}", [START])["decision"],
            "block",
        )
        self.assertEqual(
            evaluate(handoff(candidate="abc"), [START])["decision"],
            "block",
        )

    def test_examples_quotes_and_prose_do_not_activate(self) -> None:
        message = "\n".join(
            [
                "The label Mission-Start: is documented here.",
                f"> {START}",
                "```text",
                START,
                "```",
                "~~~~text",
                START,
                "~~~~",
            ]
        )
        self.assertEqual(evaluate(message), {"continue": True})

    def test_sequential_missions_close_independently(self) -> None:
        next_origin = f"git:{'d' * 40}"
        next_start = (
            'Mission-Start: {"endpoint":"local-only","origin":"'
            + next_origin
            + '","stop":"one revision"}'
        )
        self.assertEqual(
            evaluate(
                handoff(endpoint="local-only", origin=next_origin),
                [next_start, handoff(), START],
            ),
            {"continue": True},
        )

    def test_second_stop_is_bounded_failure(self) -> None:
        result = evaluate(ACTIVE, stop_hook_active=True)
        self.assertFalse(result["continue"])
        self.assertIn("incomplete", result["stopReason"])

    def test_reads_assistant_lifecycle_from_jsonl_tail(self) -> None:
        entry = {
            "type": "response_item",
            "payload": {
                "type": "message",
                "role": "assistant",
                "content": [{"type": "output_text", "text": START}],
            },
        }
        with tempfile.NamedTemporaryFile("w", encoding="utf-8") as transcript:
            transcript.write(json.dumps({"type": "other"}) + "\n")
            transcript.write(json.dumps(entry) + "\n")
            transcript.flush()
            result = hook.evaluate_stop(
                {
                    "last_assistant_message": "Implemented.",
                    "transcript_path": transcript.name,
                }
            )
        self.assertEqual(result["decision"], "block")


if __name__ == "__main__":
    unittest.main()
