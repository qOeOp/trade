"""Deterministic CI delivery and agent/user transcript friction telemetry for product-doctor (v2.4).

Operationalizes the `Friction` (`delivery`, `agents`, `burden`) theme so `doctor.py advise` can
deterministically detect and schedule `friction` audits instead of relying on ad-hoc manual checks.
Pure Python standard library; never prints raw transcript prompts, outputs, or credentials.
"""

from __future__ import annotations

from collections import Counter
from datetime import datetime
import json
import math
from pathlib import Path
import re
import statistics
from typing import Any

SKILL_PATH_MARKER = ".agents/skills/"
NONZERO_EXIT_RE = re.compile(r"^Command exited with code ([1-9]\d*)\.", re.MULTILINE)
NON_EFFECTIVE_CONCLUSIONS = frozenset({"cancelled", "skipped", "neutral"})
_SUMMARY_REDACT_PATTERNS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"://[^/\s:@]+:[^/\s@]+@"), "://<REDACTED>@"),
    (re.compile(r"(?i)\b(Authorization\s*:\s*(?:Bearer|Basic|Token)\s+)\S+"), r"\1<REDACTED>"),
    (re.compile(r"(?i)\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}"), r"\1 <REDACTED>"),
    (re.compile(
        r"(?i)\b(api[_-]?key|access[_-]?token|auth[_-]?token|refresh[_-]?token|token|secret|password|passwd|pwd|cookie)"
        r"(\s*[=:]\s*)\S+"
    ), r"\1\2<REDACTED>"),
    (re.compile(
        r"\b(?:sk-(?:ant-|proj-)?[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9_]{8,}|github_pat_[A-Za-z0-9_]{8,}|"
        r"AKIA[0-9A-Z]{12,}|AIza[0-9A-Za-z_-]{16,}|xox[baprs]-[A-Za-z0-9-]{8,})\b"
    ), "<REDACTED>"),
    (re.compile(r"\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9._-]{6,}"), "<REDACTED>"),
)
MAX_SUMMARY_LEN = 80


def _sanitize_summary(text: str) -> str:
    """Scrub credential-like tokens from a transcript toolSummary and cap its length."""
    cleaned = " ".join(text.split())
    for pat, repl in _SUMMARY_REDACT_PATTERNS:
        cleaned = pat.sub(repl, cleaned)
    if len(cleaned) > MAX_SUMMARY_LEN:
        return cleaned[: MAX_SUMMARY_LEN - 3] + "..."
    return cleaned


def _unwrap_str(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    if len(value) >= 2 and value[0] == '"' and value[-1] == '"':
        try:
            decoded = json.loads(value)
            if isinstance(decoded, str):
                return decoded
        except json.JSONDecodeError:
            pass
    return value


def _parse_iso(ts: str | None) -> datetime | None:
    if not ts:
        return None
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except ValueError:
        return None


def analyze_ci_runs(runs: list[dict[str, Any]]) -> dict[str, Any]:
    """Summarize GitHub Actions runs (`gh run list --json ...`) into deterministic delivery friction signals."""
    if not isinstance(runs, list) or not all(isinstance(r, dict) for r in runs):
        raise SystemExit("--ci-json must contain a JSON array of workflow run objects")

    by_workflow: dict[str, list[dict[str, Any]]] = {}
    for run in runs:
        # Prefer `workflowName` over `name` because GitHub Actions `name` can be a per-PR `run-name`.
        name = str(run.get("workflowName") or run.get("name") or "unknown")
        by_workflow.setdefault(name, []).append(run)

    workflows_out: dict[str, dict[str, Any]] = {}
    triggers: list[str] = []

    for name, items in sorted(by_workflow.items()):
        completed = [r for r in items if str(r.get("status") or "").lower() in ("completed", "")]
        conclusions = Counter(str(r.get("conclusion") or "unknown").lower() for r in completed)
        effective = [
            r for r in completed
            if str(r.get("conclusion") or "unknown").lower() not in NON_EFFECTIVE_CONCLUSIONS
        ]
        total = len(effective)
        failures = conclusions["failure"] + conclusions["timed_out"] + conclusions["startup_failure"]
        cancelled = conclusions["cancelled"]
        fail_rate = round(failures / total, 3) if total else 0.0

        # Order oldest -> newest to measure recent-half vs earlier-half wait-time growth (excluding cancelled/skipped).
        dated: list[tuple[datetime, float]] = []
        for r in effective:
            c_at = _parse_iso(r.get("createdAt") or r.get("created_at"))
            u_at = _parse_iso(r.get("updatedAt") or r.get("updated_at"))
            if c_at and u_at and u_at >= c_at:
                mins = round((u_at - c_at).total_seconds() / 60.0, 2)
                dated.append((c_at, mins))
        dated.sort(key=lambda pair: pair[0])
        durations = [m for _, m in dated]
        median_min = round(statistics.median(durations), 2) if durations else None
        p90_idx = max(0, math.ceil(0.9 * len(durations)) - 1) if durations else 0
        p90_min = round(sorted(durations)[p90_idx], 2) if durations else None

        wait_growth_pct: float | None = None
        if len(durations) >= 6:
            mid = len(durations) // 2
            early_med = statistics.median(durations[:mid])
            late_med = statistics.median(durations[mid:])
            if early_med >= 1.0:
                wait_growth_pct = round(((late_med - early_med) / early_med) * 100.0, 1)

        wf_triggers: list[str] = []
        if total >= 4 and fail_rate >= 0.25:
            wf_triggers.append(f"ci_failure_rate ({name}: {failures}/{total} = {fail_rate:.0%})")
        if p90_min is not None and p90_min >= 20.0:
            wf_triggers.append(f"ci_long_wait ({name}: p90={p90_min}m, median={median_min}m)")
        if wait_growth_pct is not None and wait_growth_pct >= 30.0 and (median_min or 0.0) >= 3.0:
            wf_triggers.append(f"ci_wait_growth ({name}: +{wait_growth_pct}% recent median)")
        triggers.extend(wf_triggers)

        workflows_out[name] = {
            "runs": total,
            "failures": failures,
            "cancelled": cancelled,
            "failure_rate": fail_rate,
            "median_minutes": median_min,
            "p90_minutes": p90_min,
            "wait_growth_pct": wait_growth_pct,
            "triggers": wf_triggers,
        }

    return {
        "total_runs": len(runs),
        "workflows": workflows_out,
        "triggers": triggers,
    }


def _record_skill_args(tname: str, args: Any, skills_loaded: set[str], cmd_summaries: Counter[str]) -> None:
    if not isinstance(args, dict):
        return
    fpath = _unwrap_str(args.get("Path") or args.get("path") or args.get("file_path") or "")
    if SKILL_PATH_MARKER in fpath and fpath.endswith("SKILL.md"):
        skills_loaded.add(fpath.split(SKILL_PATH_MARKER, 1)[1].split("/", 1)[0])
    if tname == "Skill" and args.get("skill"):
        skills_loaded.add(_unwrap_str(args["skill"]))
    summary = _sanitize_summary(_unwrap_str(args.get("toolSummary") or ""))
    if summary:
        cmd_summaries[summary] += 1


def _record_step_tools(obj: dict[str, Any], skills_loaded: set[str], cmd_summaries: Counter[str]) -> tuple[int, int]:
    """Count (tool_calls, tool_errors) from Antigravity `tool_calls` and Claude Code `message.content`."""
    calls = errors = 0
    for tc in obj.get("tool_calls") or []:
        if isinstance(tc, dict):
            calls += 1
            _record_skill_args(str(tc.get("name") or ""), tc.get("args") or tc.get("arguments"), skills_loaded, cmd_summaries)
    msg = obj.get("message")
    blocks = msg.get("content") if isinstance(msg, dict) else None
    if not isinstance(blocks, list):
        return calls, errors
    for blk in blocks:
        if not isinstance(blk, dict):
            continue
        btype = blk.get("type")
        if btype == "tool_use":
            calls += 1
            _record_skill_args(str(blk.get("name") or ""), blk.get("input"), skills_loaded, cmd_summaries)
        elif btype == "tool_result" and blk.get("is_error"):
            errors += 1
    return calls, errors


def _iter_jsonl_dicts(path: Path) -> list[dict[str, Any]]:
    try:
        raw_lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError as error:
        raise SystemExit(f"cannot read transcript {path}: {error}") from None
    out: list[dict[str, Any]] = []
    for line in raw_lines:
        if not line.strip():
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(obj, dict):
            out.append(obj)
    return out


def _inspect_transcript_file(path: Path) -> dict[str, Any]:
    """Parse one JSONL transcript (Antigravity, Claude Code, or Codex) into privacy-safe friction metrics."""
    rows = _iter_jsonl_dicts(path)
    user_turns = tool_calls = tool_errors = 0
    skills_loaded: set[str] = set()
    cmd_summaries: Counter[str] = Counter()
    timestamps: list[datetime] = []

    for obj in rows:
        ts = _parse_iso(obj.get("created_at") or obj.get("timestamp"))
        if ts:
            timestamps.append(ts)
        step_type = str(obj.get("type") or "").upper()
        role = str(obj.get("role") or "").lower()
        source = str(obj.get("source") or "").upper()
        if step_type == "USER_INPUT" or source == "USER_EXPLICIT" or (role == "user" and step_type in ("", "USER")):
            user_turns += 1
        status = str(obj.get("status") or "").upper()
        if status == "ERROR" or (step_type == "GENERIC" and NONZERO_EXIT_RE.search(str(obj.get("content") or ""))):
            tool_errors += 1
        c, e = _record_step_tools(obj, skills_loaded, cmd_summaries)
        tool_calls += c
        tool_errors += e

    span_min = (
        round((max(timestamps) - min(timestamps)).total_seconds() / 60.0, 1)
        if len(timestamps) >= 2 else None
    )
    err_rate = round(tool_errors / tool_calls, 3) if tool_calls else 0.0
    repeated = [(s, c) for s, c in cmd_summaries.most_common(5) if c >= 4]

    return {
        "file": path.name,
        "steps": len(rows),
        "user_turns": user_turns,
        "tool_calls": tool_calls,
        "tool_errors": tool_errors,
        "tool_error_rate": err_rate,
        "duration_minutes": span_min,
        "skills_loaded": sorted(skills_loaded),
        "repeated_actions": [{"action": s, "count": c} for s, c in repeated],
    }


def analyze_transcripts(paths: list[Path]) -> dict[str, Any]:
    """Summarize one or more agent session transcripts into privacy-safe agent/burden friction signals."""
    sessions = [_inspect_transcript_file(p) for p in paths]
    tot_calls = sum(s["tool_calls"] for s in sessions)
    tot_errors = sum(s["tool_errors"] for s in sessions)
    err_rate = round(tot_errors / tot_calls, 3) if tot_calls else 0.0
    triggers: list[str] = []

    if tot_calls >= 15 and err_rate >= 0.15:
        triggers.append(f"agent_tool_error_rate ({tot_errors}/{tot_calls} = {err_rate:.0%})")
    for s in sessions:
        if s["repeated_actions"]:
            top = s["repeated_actions"][0]
            triggers.append(f"agent_repeated_action ({s['file']}: '{top['action']}' x{top['count']})")
        if s["user_turns"] >= 12 and (s["duration_minutes"] or 0.0) >= 30.0:
            triggers.append(f"user_clarification_burden ({s['file']}: {s['user_turns']} user turns over {s['duration_minutes']}m)")

    return {
        "session_count": len(sessions),
        "total_tool_calls": tot_calls,
        "total_tool_errors": tot_errors,
        "overall_tool_error_rate": err_rate,
        "sessions": sessions,
        "triggers": triggers,
    }


def collect_friction(ci_runs: list[dict[str, Any]] | None = None,
                     transcript_paths: list[Path] | None = None) -> dict[str, Any]:
    """Combine CI delivery and transcript agent/burden signals into a unified friction summary."""
    ci = analyze_ci_runs(ci_runs) if ci_runs is not None else None
    tx = analyze_transcripts(transcript_paths) if transcript_paths else None
    triggers = [
        *(ci["triggers"] if ci else []),
        *(tx["triggers"] if tx else []),
    ]
    return {
        "ci_provided": ci is not None,
        "transcripts_provided": tx is not None,
        "ci": ci,
        "transcripts": tx,
        "triggers": triggers,
        "has_friction": bool(triggers),
    }
