"""If this fails, the skill heat tool miscounts what sessions did after loading a skill, or forgets sessions."""

import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
_spec = importlib.util.spec_from_file_location("skill_heat", ROOT / ".agents/skills/product-doctor/assets/skill_heat.py")
assert _spec and _spec.loader
heat = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(heat)

SKILL = """---
name: alpha
description: Test skill.
---

# Alpha

Run `ledger review` before `replay explore`.

- Read `freeze_latest` from the report.

Both `replay explore` and `ledger sql` appear here.

- Set `DAILY_WARMUP = True` in the strategy.

- Call `self.place( <order> )` once.

- On `CONCURRENT_WRITE`, rerun with `retry_now`.
"""
DOCTOR = "---\nname: product-doctor\ndescription: Test.\n---\n\nRead `doctor_only_term` first.\n"
WRITTEN = "2026-10-01T00:00:00Z"


def claude_line(stamp, *blocks, kind="assistant", cwd=None):
    line = {"type": kind, "timestamp": stamp, "message": {"role": kind, "content": list(blocks)}}
    return json.dumps({**line, **({"cwd": cwd} if cwd else {})})


def tool(call, name, **arguments):
    return {"type": "tool_use", "id": call, "name": name, "input": arguments}


def codex_meta(session, cwd, **extra):
    return json.dumps({"timestamp": "2026-10-05T00:00:00Z", "type": "session_meta",
                       "payload": {"id": session, "cwd": cwd, **extra}})


def codex_patch(stamp, call, path):
    return json.dumps({"timestamp": stamp, "type": "response_item",
                       "payload": {"type": "custom_tool_call", "name": "apply_patch", "call_id": call,
                                   "input": f"*** Begin Patch\n*** Update File: {path}\n@@\n-a\n+b\n*** End Patch"}})


def codex_call(stamp, call, command):
    return json.dumps({"timestamp": stamp, "type": "response_item",
                       "payload": {"type": "function_call", "name": "exec_command", "call_id": call,
                                   "arguments": json.dumps({"cmd": command})}})


class SkillHeatTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.base = Path(temp.name).resolve()
        self.repo = self.base / "repo"
        self.repo.mkdir()
        self.git("init", "-q")
        self.git("remote", "add", "origin", "git@github.com:owner/repo.git")
        self.write(".agents/skills/alpha/SKILL.md", SKILL)
        self.write(".agents/skills/product-doctor/SKILL.md", DOCTOR)
        self.commit(WRITTEN)
        main = Path(self.git("rev-parse", "--path-format=absolute", "--git-common-dir").strip()).parent
        self.main = main
        self.claude = self.base / "claude"
        self.project = self.claude / re.sub(r"[^A-Za-z0-9]", "-", str(main))
        self.codex = self.base / "codex"
        self.store = self.base / "store.jsonl"

    def git(self, *args, env=None):
        return subprocess.run(["git", *args], cwd=self.repo, check=True, capture_output=True, text=True,
                              env={**os.environ, **(env or {})}).stdout

    def write(self, name, text):
        path = self.repo / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")

    def commit(self, when):
        self.git("add", "-A")
        dates = {"GIT_AUTHOR_DATE": when, "GIT_COMMITTER_DATE": when}
        self.git("-c", "user.name=T", "-c", "user.email=t@example.com", "commit", "-qm", "change", env=dates)

    def transcript(self, path, lines):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("\n".join(lines) + "\n", encoding="utf-8")
        return path

    def run_tool(self, *extra):
        output = self.base / "out"
        with contextlib.redirect_stdout(io.StringIO()):
            heat.main(["--store", str(self.store), "--output", str(output), "--checkout", str(self.repo),
                       "--claude", str(self.claude), "--codex", str(self.codex), *extra])
        data = json.loads((output / "data.json").read_text(encoding="utf-8"))
        self.assertIn("const DATA = {", (output / "index.html").read_text(encoding="utf-8"))
        return {(p["file"].split("/")[2], p["text"].split("`")[1]): p for p in data["paras"] if "`" in p["text"]}, data

    def research_session(self, name="s1", day="06", calls=(("c2", "ledger review --id 3"), ("c3", "replay explore --line 2"), ("c4", "flag = True"))):
        return self.transcript(self.project / f"{name}.jsonl", [
            claude_line(f"2026-10-{day}T00:00:00Z", tool(f"{name}-load", "Skill", skill="alpha")),
            *(claude_line(f"2026-10-{day}T00:0{i + 1}:00Z", tool(f"{name}-{call}", "Bash", command=command))
              for i, (call, command) in enumerate(calls)),
        ])

    def test_hits_count_only_identifiers_one_paragraph_names(self):
        self.research_session()
        sibling = self.claude / (self.project.name + "-graph")  # another checkout whose name extends this one's
        self.transcript(sibling / "other.jsonl", [
            claude_line("2026-10-06T00:00:00Z", tool("o1", "Skill", skill="alpha"), cwd=f"{self.main}-graph"),
            claude_line("2026-10-06T00:01:00Z", tool("o2", "Bash", command="ledger review"), cwd=f"{self.main}-graph")])
        paras, data = self.run_tool()
        self.assertEqual(sum(paras["alpha", "ledger review"]["opp"]), 1)
        self.assertEqual(sum(paras["alpha", "ledger review"]["hit"]), 1)
        self.assertEqual(sum(paras["alpha", "freeze_latest"]["hit"]), 0)
        row = paras["alpha", "replay explore"]
        self.assertEqual({term: (shared, sum(used)) for term, shared, used in row["terms"]},
                         {"ledger sql": (1, 0), "replay explore": (2, 1)})
        self.assertEqual(sum(row["hit"]), 0)  # `replay explore` was used, but two paragraphs name it
        self.assertEqual(data["meta"]["groups"][0], 1)  # a Claude main session, not maintenance
        self.assertEqual(sum(paras["alpha", "DAILY_WARMUP = True"]["hit"]), 0)  # `flag = True` is not it
        self.assertEqual(paras["alpha", "self.place( <order> )"]["terms"], [])  # nothing left to match
        self.assertEqual([t for t, _, _ in paras["alpha", "CONCURRENT_WRITE"]["terms"]], ["retry_now"])  # codes are output

    def test_codex_sessions_of_this_repository_read_skills_by_path(self):
        rollout = self.codex / "sessions/2026/10/05"
        self.transcript(rollout / "a.jsonl", [
            codex_meta("cx1", "/elsewhere/trade-worktree", git={"repository_url": "https://github.com/owner/repo"}),
            codex_call("2026-10-05T00:01:00Z", "k1", "cat .agents/skills/alpha/SKILL.md"),
            codex_call("2026-10-05T00:02:00Z", "k2", "python -m cli.main ledger review"),
        ])
        self.transcript(rollout / "b.jsonl", [
            codex_meta("cx2", "/some/other/project"),
            codex_call("2026-10-05T00:01:00Z", "k3", "cat .agents/skills/alpha/SKILL.md"),
            codex_call("2026-10-05T00:02:00Z", "k4", "ledger review"),
        ])
        self.transcript(rollout / "c.jsonl", [
            codex_meta("cx3", str(self.main)),
            codex_call("2026-10-05T00:01:00Z", "k5", "sed -n 1,40p .agents/skills/alpha/SKILL.md"),
            codex_patch("2026-10-05T00:02:00Z", "k6", ".agents/skills/alpha/SKILL.md"),
        ])
        paras, data = self.run_tool()
        self.assertEqual(sum(paras["alpha", "ledger review"]["hit"]), 1)
        self.assertEqual(data["meta"]["groups"][4:6], [1, 1])  # cx1, and cx3 marked maintenance by its patch

    def test_sessions_stay_counted_after_their_transcripts_are_deleted(self):
        session = self.research_session()
        first, _ = self.run_tool()
        self.assertEqual(sum(first["alpha", "ledger review"]["hit"]), 1)
        session.write_text(session.read_text() + claude_line("2026-10-06T01:00:00Z", tool("late", "Read", file_path="x")) + "\n")
        grown, _ = self.run_tool()  # a session still running at the last run is read again and keeps what it had
        self.assertEqual(grown["alpha", "ledger review"]["hit"], first["alpha", "ledger review"]["hit"])
        shutil.rmtree(self.claude)
        again, _ = self.run_tool()
        self.assertEqual(again["alpha", "ledger review"]["hit"], first["alpha", "ledger review"]["hit"])
        self.assertEqual(len(self.store.read_text().splitlines()), 1)
        self.research_session()  # read again under text that no longer names it: the stored observation stays
        self.write(".agents/skills/alpha/SKILL.md", SKILL.replace("`ledger review`", "the review"))
        self.commit("2026-10-10T00:00:00Z")
        self.run_tool()
        self.assertIn("ledger review", json.loads(self.store.read_text())["loads"]["alpha/SKILL.md"][1])

    def test_a_copied_transcript_counts_the_original_calls_once(self):
        # A resumed or forked Claude session copies the original's lines with their times and call ids.
        original = self.research_session("zz-original", "06")
        self.run_tool()
        copy = [*original.read_text().splitlines(),
                claude_line("2026-10-07T00:00:00Z", tool("own", "Bash", command="rg freeze_latest report"))]
        self.transcript(self.project / "aa-copy.jsonl", copy)
        for step in ("original stored first", "both read fresh", "original deleted"):
            with self.subTest(step):
                if step == "both read fresh":
                    self.store.unlink()
                if step == "original deleted":
                    original.unlink()
                paras, _ = self.run_tool()
                self.assertEqual(sum(paras["alpha", "ledger review"]["hit"]), 1)
                self.assertEqual(sum(paras["alpha", "freeze_latest"]["hit"]), 1)

    def test_a_codex_fork_inherits_skill_text_but_not_its_parents_calls(self):
        self.transcript(self.codex / "sessions/2026/10/05/fork.jsonl", [
            codex_meta("child", str(self.main), parent_thread_id="parent", subagent_history_start_ordinal=3),
            codex_call("2026-10-05T00:00:01Z", "p1", "cat .agents/skills/alpha/SKILL.md"),
            codex_call("2026-10-05T00:00:01Z", "p2", "ledger review"),
            codex_call("2026-10-05T00:03:00Z", "own", "rg freeze_latest report"),
        ])
        paras, data = self.run_tool()
        self.assertEqual(sum(paras["alpha", "ledger review"]["hit"]), 0)
        self.assertEqual(sum(paras["alpha", "freeze_latest"]["hit"]), 1)
        self.assertEqual(data["meta"]["groups"][6], 1)  # a Codex sub-agent

    def test_audit_maintenance_and_rewritten_paragraphs(self):
        self.transcript(self.project / "audit.jsonl", [
            claude_line("2026-10-06T00:00:00Z", tool("a0", "Skill", skill="product-doctor")),
            claude_line("2026-10-06T00:00:30Z", tool("a1", "Read", file_path=f"{self.repo}/.agents/skills/alpha/SKILL.md")),
            claude_line("2026-10-06T00:01:00Z", tool("a2", "Bash", command="grep -r doctor_only_term; ledger review")),
        ])
        self.transcript(self.project / "audit/subagents/agent-1.jsonl", [
            claude_line("2026-10-06T00:02:00Z", tool("b1", "Skill", skill="alpha")),
            claude_line("2026-10-06T00:03:00Z", tool("b2", "Bash", command="ledger review")),
        ])
        self.transcript(self.project / "upkeep.jsonl", [
            claude_line("2026-10-06T00:00:00Z", tool("m1", "Skill", skill="alpha")),
            claude_line("2026-10-06T00:01:00Z", tool("m2", "Edit", file_path=".agents/skills/alpha/SKILL.md")),
            claude_line("2026-10-06T00:02:00Z", tool("m3", "Bash", command="ledger review")),
        ])
        paras, data = self.run_tool()
        self.assertEqual(sum(paras["product-doctor", "doctor_only_term"]["hit"]), 1)
        self.assertEqual(paras["alpha", "ledger review"]["hit"], [0, 1, 0, 0, 0, 0, 0, 0])  # only the upkeep session
        self.assertEqual(data["meta"]["groups"][:4], [1, 1, 1, 0])  # audit main, upkeep (maintenance), audit sub-agent
        self.write(".agents/skills/alpha/SKILL.md", SKILL.replace("before `replay explore`", "first"))
        self.commit("2026-10-10T00:00:00Z")
        paras, _ = self.run_tool("--no-scan")
        self.assertEqual(sum(paras["alpha", "ledger review"]["opp"]), 0)  # every session predates the new wording
        self.assertEqual(sum(paras["alpha", "freeze_latest"]["opp"]), 1)
        self.write(".agents/skills/alpha/SKILL.md", SKILL + "\nUse `fresh_term` too.\n")  # not committed yet
        paras, _ = self.run_tool("--no-scan")
        self.assertEqual(sum(paras["alpha", "fresh_term"]["opp"]), 0)
        self.assertEqual(sum(paras["alpha", "freeze_latest"]["opp"]), 1)

    def test_compare_and_until_cut_by_session_start(self):
        self.research_session("early", "06")
        self.research_session("late", "20")
        paras, _ = self.run_tool("--compare", "2026-10-10")
        row = paras["alpha", "ledger review"]
        self.assertEqual((sum(row["hit"]), sum(row["hit_before"])), (2, 1))
        paras, _ = self.run_tool("--no-scan", "--until", "2026-10-10")
        self.assertEqual(sum(paras["alpha", "ledger review"]["hit"]), 1)
