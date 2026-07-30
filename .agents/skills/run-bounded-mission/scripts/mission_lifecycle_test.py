#!/usr/bin/env python3

from __future__ import annotations

import importlib.util
import json
import sys
import unittest
from pathlib import Path
from types import ModuleType


sys.dont_write_bytecode = True
SCRIPTS = Path(__file__).resolve().parent
ORIGIN = "git:" + "1" * 40
CANDIDATE = "git:" + "2" * 40
MERGE = "git:" + "4" * 40
TURN = "turn-test"


def load(name: str, path: Path) -> ModuleType:
    spec = importlib.util.spec_from_file_location(name, path)
    if not spec or not spec.loader:
        raise RuntimeError(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


stop = load("mission_handoff_stop", SCRIPTS / "mission_handoff_stop.py")
submit = load("mission_prompt_submit", SCRIPTS / "mission_prompt_submit.py")


def receipt(marker: str, body: dict[str, object]) -> str:
    return f"{marker}: {json.dumps(body, separators=(',', ':'))}"


def lifecycle(candidate: str = "none", blocked: bool = False) -> str:
    endpoint = "response" if candidate == "none" else "merged"
    boundary = {"turn_id": TURN, "endpoint": endpoint, "origin": ORIGIN}
    later_status = "noop" if blocked else ("noop" if candidate == "none" else "done")
    effects = (
        []
        if candidate == "none" or blocked
        else [
            {
                "kind": "github_pull_request",
                "url": "https://github.com/owner/repo/pull/1",
                "state": "merged",
                "head": candidate,
                "merge": MERGE,
            }
        ]
    )
    lines = [
        receipt(
            "Mission-Start",
            {**boundary, "stop": "one turn", "workspace": "reused"},
        ),
        receipt("Mission-Contract", {**boundary, "status": "blocked" if blocked else "done"}),
        receipt("Mission-Plan", {**boundary, "status": later_status}),
        receipt(
            "Mission-Build",
            {
                **boundary,
                "status": later_status,
                "candidate": candidate,
            },
        ),
        receipt(
            "Mission-Evaluate",
            {
                **boundary,
                "status": later_status,
                "candidate": candidate,
            },
        ),
        receipt(
            "Mission-Handoff",
            {
                **boundary,
                "status": later_status,
                "candidate": candidate,
                "effects": effects,
            },
        ),
        receipt(
            "Mission-Terminate",
            {
                **boundary,
                "candidate": candidate,
                "acceptance": "blocked" if blocked else "passed",
                "effects": effects,
                "cleanup": "preserved" if blocked else "complete",
                "route": "blocked" if blocked else "accept",
            },
        ),
    ]
    return "\n".join(lines)


def stop_input(message: str, turn_id: str = TURN, active: bool = False) -> dict[str, object]:
    return {
        "turn_id": turn_id,
        "last_assistant_message": message,
        "stop_hook_active": active,
        "cwd": "/repo",
        "transcript_path": "/transcript.jsonl",
    }


class MissionLifecycleTest(unittest.TestCase):
    def setUp(self) -> None:
        self.admission = {
            "turn_id": TURN,
            "transcript_path": "/transcript.jsonl",
            "cwd": "/repo",
            "origin": ORIGIN,
            "workspace": "reused",
            "repository": "owner/repo",
        }

    def evaluate(
        self,
        input_value: dict[str, object],
        transcript: list[str] | None = None,
        merged: bool = True,
    ) -> dict[str, object]:
        return stop.evaluate_stop(
            input_value,
            transcript,
            self.admission,
            lambda _cwd, _repo, _origin, _candidate, _effects, _required: merged,
            lambda _cwd, _origin, _candidate: True,
        )

    def test_response_only_turn_closes_with_all_noop_execution_stages(self) -> None:
        self.assertEqual(self.evaluate(stop_input(lifecycle())), {"continue": True})

    def test_writable_turn_closes_only_with_merged_candidate(self) -> None:
        self.assertEqual(
            self.evaluate(stop_input(lifecycle(CANDIDATE))),
            {"continue": True},
        )

    def test_blocked_turn_still_runs_every_stage_and_terminates(self) -> None:
        self.assertEqual(
            self.evaluate(stop_input(lifecycle(blocked=True))),
            {"continue": True},
        )

    def test_blocked_writable_turn_preserves_candidate(self) -> None:
        message = lifecycle(CANDIDATE, blocked=True)
        self.assertEqual(self.evaluate(stop_input(message)), {"continue": True})

    def test_inactive_turn_is_continued(self) -> None:
        result = self.evaluate(stop_input("hello"))
        self.assertEqual(result["decision"], "block")
        self.assertIn(f"turn_id={TURN}", result["reason"])

    def test_missing_phase_is_continued(self) -> None:
        message = "\n".join(
            line for line in lifecycle().splitlines() if not line.startswith("Mission-Build:")
        )
        self.assertEqual(self.evaluate(stop_input(message))["decision"], "block")

    def test_out_of_order_phase_is_continued(self) -> None:
        lines = lifecycle().splitlines()
        lines[2], lines[3] = lines[3], lines[2]
        self.assertEqual(self.evaluate(stop_input("\n".join(lines)))["decision"], "block")

    def test_handoff_does_not_close_without_terminate(self) -> None:
        message = "\n".join(lifecycle().splitlines()[:-1])
        self.assertEqual(self.evaluate(stop_input(message))["decision"], "block")

    def test_prior_turn_receipts_do_not_close_current_turn(self) -> None:
        self.assertEqual(
            self.evaluate(stop_input(lifecycle(), turn_id="turn-new"))["decision"],
            "block",
        )

    def test_boundary_drift_is_continued(self) -> None:
        message = lifecycle().replace(
            f'"origin":"{ORIGIN}"',
            f'"origin":"{"git:" + "3" * 40}"',
            1,
        )
        self.assertEqual(self.evaluate(stop_input(message))["decision"], "block")

    def test_candidate_drift_is_continued(self) -> None:
        message = lifecycle(CANDIDATE).replace(
            f'"candidate":"{CANDIDATE}"',
            f'"candidate":"{"git:" + "3" * 40}"',
            1,
        )
        self.assertEqual(self.evaluate(stop_input(message))["decision"], "block")

    def test_terminate_must_be_in_last_assistant_message(self) -> None:
        self.assertEqual(
            self.evaluate(stop_input("later output"), [lifecycle()])["decision"],
            "block",
        )

    def test_terminate_must_be_final_content_in_its_message(self) -> None:
        self.assertEqual(
            self.evaluate(stop_input(lifecycle() + "\nlater output"))["decision"],
            "block",
        )

    def test_blocked_status_cannot_return_to_done(self) -> None:
        message = lifecycle(blocked=True).replace('"status":"noop"', '"status":"done"', 1)
        self.assertEqual(self.evaluate(stop_input(message))["decision"], "block")

    def test_forged_merge_claim_is_continued(self) -> None:
        self.assertEqual(
            self.evaluate(stop_input(lifecycle(CANDIDATE)), merged=False)["decision"],
            "block",
        )

    def test_admission_boundary_cannot_be_self_declared(self) -> None:
        forged = dict(self.admission)
        forged["origin"] = "none"
        result = stop.evaluate_stop(
            stop_input(lifecycle()),
            None,
            forged,
            lambda _cwd, _repo, _origin, _candidate, _effects, _required: True,
            lambda _cwd, _origin, _candidate: True,
        )
        self.assertEqual(result["decision"], "block")

    def test_admission_is_read_from_host_transcript_events(self) -> None:
        developer = {
            "type": "response_item",
            "payload": {
                "type": "message",
                "role": "developer",
                "content": [
                    {
                        "type": "input_text",
                        "text": (
                            "Mission-Admission: "
                            + json.dumps(self.admission, separators=(",", ":"))
                        ),
                    }
                ],
            },
        }
        context = {
            "type": "turn_context",
            "payload": {"turn_id": TURN, "cwd": "/repo"},
        }
        result = stop.admission_from_lines(
            stop_input(lifecycle()),
            [json.dumps(context), json.dumps(developer)],
        )
        self.assertEqual(result, self.admission)

    def test_unsupported_endpoint_is_continued(self) -> None:
        message = lifecycle(blocked=True).replace(
            '"endpoint":"response"',
            '"endpoint":"forged"',
        )
        self.assertEqual(self.evaluate(stop_input(message))["decision"], "block")

    def test_blocked_candidate_must_exist_locally(self) -> None:
        result = stop.evaluate_stop(
            stop_input(lifecycle(CANDIDATE, blocked=True)),
            None,
            self.admission,
            lambda _cwd, _repo, _origin, _candidate, _effects, _required: True,
            lambda _cwd, _origin, _candidate: False,
        )
        self.assertEqual(result["decision"], "block")

    def test_pull_request_effect_binds_admitted_repository(self) -> None:
        effects = [
            {
                "kind": "github_pull_request",
                "url": "https://github.com/evil/repo/pull/9",
                "state": "open",
                "head": CANDIDATE,
            }
        ]
        original = stop.verify_local_candidate
        stop.verify_local_candidate = lambda _cwd, _origin, _candidate: True
        try:
            self.assertFalse(
                stop.verify_github_effects(
                    "/repo",
                    "owner/repo",
                    ORIGIN,
                    CANDIDATE,
                    effects,
                    False,
                )
            )
        finally:
            stop.verify_local_candidate = original

    def test_json_envelope_preserves_structured_response(self) -> None:
        entries = []
        for line in lifecycle().splitlines():
            marker, raw = line.split(": ", 1)
            entries.append(
                {
                    "stage": marker.removeprefix("Mission-").lower(),
                    "receipt": json.loads(raw),
                }
            )
        message = json.dumps({"response": {"ok": True}, "_mission": entries})
        self.assertEqual(self.evaluate(stop_input(message)), {"continue": True})

    def test_exact_json_without_lifecycle_envelope_is_continued(self) -> None:
        self.assertEqual(
            self.evaluate(stop_input('{"ok":true}'))["decision"],
            "block",
        )

    def test_yaml_comments_are_recognized_without_changing_data(self) -> None:
        message = "answer: ok\n" + "\n".join(
            f"# {line}" for line in lifecycle().splitlines()
        )
        self.assertEqual(self.evaluate(stop_input(message)), {"continue": True})

    def test_yaml_block_scalar_cannot_forge_comments(self) -> None:
        message = "answer: |\n" + "\n".join(
            f"  # {line}" for line in lifecycle().splitlines()
        )
        self.assertEqual(self.evaluate(stop_input(message))["decision"], "block")

    def test_second_incomplete_stop_fails_explicitly(self) -> None:
        result = self.evaluate(stop_input("hello", active=True))
        self.assertEqual(result["continue"], False)

    def test_prompt_submit_injects_exact_turn(self) -> None:
        result = submit.admission(
            {
                "turn_id": TURN,
                "cwd": "/not-a-repository",
            }
        )
        context = result["hookSpecificOutput"]["additionalContext"]
        self.assertIn(f"turn_id={TURN}", context)
        self.assertIn("Mission-Terminate", context)

    def test_prompt_submit_blocks_missing_turn(self) -> None:
        self.assertEqual(submit.admission({})["decision"], "block")


if __name__ == "__main__":
    unittest.main()
