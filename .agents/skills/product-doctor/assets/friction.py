"""Deterministic CI delivery and agent/user transcript friction telemetry for product-doctor (v2.4).

Operationalizes the `Friction` (`delivery`, `agents`, `burden`) theme so `doctor.py advise` can
deterministically detect and schedule `friction` audits instead of relying on ad-hoc manual checks.
Pure Python standard library; never prints raw transcript prompts, outputs, or credentials.
"""

from __future__ import annotations

from collections import Counter
from datetime import UTC, datetime
import json
import math
from pathlib import Path
import re
import shlex
import statistics
from typing import Any

SKILL_PATH_MARKER = ".agents/skills/"
SKILL_PATH_RE = re.compile(r"\.agents/skills/([A-Za-z0-9_.-]+)/SKILL\.md")
NONZERO_EXIT_RE = re.compile(
    r"(?:^Command exited with code |^Process exited with code |^Exit code:\s*)([1-9]\d*)\b",
    re.MULTILINE,
)
GIT_SEARCH_RE = re.compile(r"^\s*git\s+(?:grep|log|show|diff|blame)\b")
GREP_CMD_RE = re.compile(r"^\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*(?:e?grep|fgrep|rg|ag)\b")
AD_HOC_SQL_RE = re.compile(
    r"^\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*"
    r"(?:(?:env|sudo|command|exec|docker\s+exec(?:\s+-\S+)*\s+\S+)\s+)*"
    r"(?:dolt(?:\s+-\S+(?:\s+[^-;\s]\S*)?){0,3}\s+sql|mysql)\b",
    re.IGNORECASE,
)
SECRET_FILE_RE = re.compile(r"(?:^|[\s/'\"<=(])(?:\.env|dolt/service\.json)(?:$|[\s'\")|;&])")
SECRET_REDIR_RE = re.compile(r"<\s*['\"]?(?:[^\s'\";|&]*/)?(?:\.env|dolt/service\.json)(?:['\"]|$|[\s;|&)])")
SECRET_READ_CMD_RE = re.compile(
    r"^\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*"
    r"(?:\.(?=\s)|(?:cat|head|tail|less|more|sed|awk|gawk|jq|source|base64|xxd|od|strings|hexdump|"
    r"nl|tac|rev|cut|sort|tr|bat|view|cp|mv|tee)\b)"
)
INLINE_SCRIPT_CMD_RE = re.compile(
    r"^\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*(?:uv\s+run\s+(?:--\S+\s+)*)?"
    r"(?:python\d*(?:\.\d+)?|node|perl|ruby|bash|sh|zsh)\b"
)
_GREP_VAL_FLAGS = frozenset({"-e", "-f", "-m", "-A", "-B", "-C", "-g", "-t", "--regexp", "--file", "--glob", "--type"})
_DOC_PATH_RE = re.compile(r"(?:^|/)(?:README\.md|AGENTS\.md|docs(?:/.*)?)$", re.IGNORECASE)
RESEARCH_CMD_RE = re.compile(
    r"\bcli\.main(?:\s+--?[A-Za-z0-9_-]+(?:=\S+|\s+[^\s-]\S*)?)*\s+(?:research|line|trial|replay)\b"
)
PROD_OOM_RE = re.compile(
    r"\b(?:oom-killer|OOMKilled(?!(?:[\"']?\s*[:=]\s*(?:false|0)\b))|"
    r"(?<!\bnot\s)(?<!\bno\s)Out of memory(?!\s+check\s+(?:passed|ok)\b)|"
    r"ExitCode\s*[:=]\s*137|exit_code\s*[:=]\s*137|Killed process\b)",
    re.IGNORECASE,
)
PROD_CHECKPOINT_DEFER_MARKER = "paper checkpoint deferred:"
PROD_RECOVERY_UNAVAIL_MARKER = "PAPER_RECOVERY_UNAVAILABLE"
PROD_RECONNECT_RE = re.compile(r"\b(?:reconnecting|WebSocket[^\n]*closed|connection reset|disconnected)\b", re.IGNORECASE)
PROD_ERROR_RE = re.compile(
    r"(?:^Traceback \(most recent call last\):|"
    r"^(?:\[?\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?\]?[\s|:-]+)?"
    r"[\[(]?(?:CRITICAL|FATAL|ERROR)[\])]?(?:\b|[\s:|])|"
    r"(?:level|severity)[\"']?\s*[:=]\s*[\"']?(?:CRITICAL|FATAL|ERROR)\b)"
)
PROD_SERVICE_HINTS = ("paper", "live", "ide", "ledger", "market")
NON_EFFECTIVE_CONCLUSIONS = frozenset({"cancelled", "skipped", "neutral"})
_SUMMARY_REDACT_PATTERNS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"://[^/\s:@]+:[^/\s@]+@"), "://<REDACTED>@"),
    (re.compile(r"(?i)\b(Authorization\s*:\s*(?:Bearer|Basic|Token)\s+)\S+"), r"\1<REDACTED>"),
    (re.compile(r"(?i)\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}"), r"\1 <REDACTED>"),
    (re.compile(
        r"(?i)(--(?:[a-z0-9_-]*-)?(?:api[_-]?key|api[_-]?secret|access[_-]?token|auth[_-]?token|"
        r"refresh[_-]?token|token|secret|password|passwd|pwd|cookie))(\s+)(?!-)(\S+)"
    ), r"\1\2<REDACTED>"),
    (re.compile(
        r"(?i)([A-Za-z0-9_-]*(?:api[_-]?key|access[_-]?token|auth[_-]?token|refresh[_-]?token|"
        r"token|secret|password|passwd|pwd|cookie))(\s*[=:]\s*)\S+"
    ), r"\1\2<REDACTED>"),
    (re.compile(
        r"\b(?:sk-(?:ant-|proj-)?[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9_]{8,}|github_pat_[A-Za-z0-9_]{8,}|"
        r"AKIA[0-9A-Z]{12,}|AIza[0-9A-Za-z_-]{16,}|xox[baprs]-[A-Za-z0-9-]{8,})\b"
    ), "<REDACTED>"),
    (re.compile(r"\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9._-]{6,}"), "<REDACTED>"),
    (re.compile(r"\b[0-9a-fA-F]{40,64}\b"), "<REDACTED>"),
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


def _parse_iso(ts: Any) -> datetime | None:
    if not isinstance(ts, str) or not ts:
        return None
    try:
        dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
        return dt.replace(tzinfo=UTC) if dt.tzinfo is None else dt.astimezone(UTC)
    except ValueError:
        return None


def _summarize_workflow_runs(name: str, items: list[dict[str, Any]]) -> tuple[dict[str, Any], list[str]]:
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
            dated.append((c_at, round((u_at - c_at).total_seconds() / 60.0, 2)))
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

    return {
        "runs": total,
        "failures": failures,
        "cancelled": cancelled,
        "failure_rate": fail_rate,
        "median_minutes": median_min,
        "p90_minutes": p90_min,
        "wait_growth_pct": wait_growth_pct,
        "triggers": wf_triggers,
    }, wf_triggers


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
        wf_summary, wf_triggers = _summarize_workflow_runs(name, items)
        workflows_out[name] = wf_summary
        triggers.extend(wf_triggers)

    return {
        "total_runs": len(runs),
        "workflows": workflows_out,
        "triggers": triggers,
    }


def _split_shell_segments(cmd: str) -> list[str]:
    """Split a shell command on unquoted pipes, semicolons, newlines, && and ||."""
    segs: list[str] = []
    buf: list[str] = []
    quote: str | None = None
    i = 0
    n = len(cmd)
    while i < n:
        ch = cmd[i]
        if quote:
            buf.append(ch)
            if ch == "\\" and quote == '"' and i + 1 < n:
                i += 1
                buf.append(cmd[i])
            elif ch == quote:
                quote = None
        elif ch in ("'", '"'):
            quote = ch
            buf.append(ch)
        elif ch in (";", "\n", "|") or (ch == "&" and i + 1 < n and cmd[i + 1] == "&"):
            if buf:
                segs.append("".join(buf).strip())
                buf = []
            if ch in ("|", "&") and i + 1 < n and cmd[i + 1] == ch:
                i += 1
        else:
            buf.append(ch)
        i += 1
    if buf:
        segs.append("".join(buf).strip())
    return [s for s in segs if s]


def _grep_reads_secret(seg: str) -> bool:
    if SECRET_REDIR_RE.search(seg):
        return True
    try:
        tokens = shlex.split(seg)
    except ValueError:
        tokens = seg.split()
    has_pattern_flag = False
    positionals: list[str] = []
    idx = 1
    while idx < len(tokens):
        tok = tokens[idx]
        if tok == "--":
            positionals.extend(tokens[idx + 1:])
            break
        if tok in ("-f", "--file") and idx + 1 < len(tokens):
            if SECRET_FILE_RE.search(tokens[idx + 1]):
                return True
            idx += 2
            continue
        if tok in _GREP_VAL_FLAGS:
            has_pattern_flag = has_pattern_flag or tok in ("-e", "--regexp")
            idx += 2
            continue
        if tok.startswith("-"):
            if tok.startswith("--regexp="):
                has_pattern_flag = True
            elif tok.startswith("--file=") and SECRET_FILE_RE.search(tok.split("=", 1)[1]):
                return True
            idx += 1
            continue
        positionals.append(tok)
        idx += 1
    targets = positionals if has_pattern_flag else positionals[1:]
    return any(SECRET_FILE_RE.search(t) and not _DOC_PATH_RE.search(t) for t in targets)


def _segment_reads_secret(seg: str) -> bool:
    if SECRET_REDIR_RE.search(seg):
        return True
    if GIT_SEARCH_RE.search(seg):
        return False
    if GREP_CMD_RE.search(seg):
        return _grep_reads_secret(seg)
    if not SECRET_FILE_RE.search(seg):
        return False
    return bool(SECRET_READ_CMD_RE.search(seg) or INLINE_SCRIPT_CMD_RE.search(seg))


def _scan_workflow_args(
    args: dict[str, Any], violations: Counter[str], research_activity: list[bool],
) -> None:
    """Detect research-workflow adherence violations from tool arguments without retaining raw inputs."""
    cmd = _unwrap_str(args.get("CommandLine") or args.get("command") or args.get("cmd") or "")
    fpath = _unwrap_str(args.get("Path") or args.get("path") or args.get("file_path") or "")
    if cmd:
        segs = _split_shell_segments(cmd)
        if any(not GIT_SEARCH_RE.search(s) and not GREP_CMD_RE.search(s) and AD_HOC_SQL_RE.search(s) for s in segs):
            violations["ad_hoc_ledger_sql"] += 1
        if any(_segment_reads_secret(s) for s in segs):
            violations["secret_file_access"] += 1
        if RESEARCH_CMD_RE.search(cmd):
            research_activity[0] = True
    if fpath and SECRET_FILE_RE.search(fpath):
        violations["secret_file_access"] += 1


def _decode_tool_args(raw_args: Any, skills_loaded: set[str]) -> Any:
    if not isinstance(raw_args, str):
        return raw_args
    for skill in SKILL_PATH_RE.findall(raw_args):
        skills_loaded.add(skill)
    try:
        return json.loads(raw_args)
    except json.JSONDecodeError:
        return None


def _record_skill_args(
    tname: str, args: Any, skills_loaded: set[str], cmd_summaries: Counter[str],
    violations: Counter[str] | None = None, research_activity: list[bool] | None = None,
) -> None:
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
    if violations is not None and research_activity is not None:
        _scan_workflow_args(args, violations, research_activity)


def _record_step_tools(
    obj: dict[str, Any], skills_loaded: set[str], cmd_summaries: Counter[str],
    violations: Counter[str], research_activity: list[bool],
) -> tuple[int, int]:
    """Count (tool_calls, tool_errors) from Antigravity `tool_calls` and Claude Code `message.content`."""
    calls = errors = 0
    raw_tcs = obj.get("tool_calls")
    for tc in raw_tcs if isinstance(raw_tcs, list) else ():
        if isinstance(tc, dict):
            calls += 1
            raw_args = tc.get("args") if tc.get("args") is not None else tc.get("arguments")
            _record_skill_args(
                str(tc.get("name") or ""), _decode_tool_args(raw_args, skills_loaded),
                skills_loaded, cmd_summaries, violations, research_activity,
            )
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
            _record_skill_args(
                str(blk.get("name") or ""), blk.get("input"),
                skills_loaded, cmd_summaries, violations, research_activity,
            )
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


def _record_codex_payload(
    obj: dict[str, Any], skills_loaded: set[str], cmd_summaries: Counter[str],
    violations: Counter[str], research_activity: list[bool],
) -> tuple[int, int, int]:
    """Extract (user_turns, tool_calls, tool_errors) from Codex rollout `{timestamp, type, payload}` rows."""
    payload = obj.get("payload")
    if not isinstance(payload, dict):
        return 0, 0, 0
    ptype = str(payload.get("type") or "").lower()
    if ptype == "message" and str(payload.get("role") or "").lower() == "user":
        return 1, 0, 0
    if ptype in ("function_call", "custom_tool_call"):
        raw_args = _decode_tool_args(payload.get("arguments") or payload.get("input"), skills_loaded)
        _record_skill_args(
            str(payload.get("name") or ""), raw_args, skills_loaded, cmd_summaries, violations, research_activity,
        )
        return 0, 1, 0
    if ptype.endswith("_output") and NONZERO_EXIT_RE.search(str(payload.get("output") or "")):
        return 0, 0, 1
    return 0, 0, 0


def _inspect_transcript_file(path: Path) -> dict[str, Any]:
    """Parse one JSONL transcript (Antigravity, Claude Code, or Codex) into privacy-safe friction metrics."""
    rows = _iter_jsonl_dicts(path)
    user_turns = tool_calls = tool_errors = 0
    skills_loaded: set[str] = set()
    cmd_summaries: Counter[str] = Counter()
    violations: Counter[str] = Counter()
    research_activity = [False]
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
        c, e = _record_step_tools(obj, skills_loaded, cmd_summaries, violations, research_activity)
        cu, cc, ce = _record_codex_payload(obj, skills_loaded, cmd_summaries, violations, research_activity)
        user_turns += cu
        tool_calls += c + cc
        tool_errors += e + ce

    if research_activity[0] and tool_calls >= 5 and not (skills_loaded & {"research-round", "research-start", "product-doctor"}):
        violations["missing_research_skill"] += 1

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
        "workflow_violations": [{"kind": k, "count": c} for k, c in sorted(violations.items())],
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
        triggers.extend(f"workflow_{v['kind']} ({s['file']}: x{v['count']})" for v in s["workflow_violations"])

    return {
        "session_count": len(sessions),
        "total_tool_calls": tot_calls,
        "total_tool_errors": tot_errors,
        "overall_tool_error_rate": err_rate,
        "sessions": sessions,
        "triggers": triggers,
    }


def _prod_log_error_entry(path: Path, service: str, reason: str) -> tuple[dict[str, Any], list[str]]:
    return {
        "file": path.name, "service": service, "lines": 0,
        "oom_signals": 0, "checkpoint_deferrals": 0,
        "recovery_unavailable": 0, "reconnect_events": 0,
        "error_lines": 0, "triggers": [], "skipped": True, "error": reason,
    }, []


def _inspect_prod_log(path: Path) -> tuple[dict[str, Any], list[str]]:
    tokens = set(re.split(r"[-_.\s]+", path.stem.lower()))
    service = next((hint for hint in PROD_SERVICE_HINTS if hint in tokens), "unknown")
    if not path.exists():
        return _prod_log_error_entry(path, service, "file not found")
    if not path.is_file():
        return _prod_log_error_entry(path, service, "not a regular file")

    line_count = oom = ckpt_defer = rec_unavail = reconnects = errors = 0
    try:
        with path.open("r", encoding="utf-8", errors="replace") as fh:
            for ln in fh:
                line_count += 1
                if PROD_RECOVERY_UNAVAIL_MARKER in ln:
                    rec_unavail += 1
                if ("ERROR" in ln or "CRITICAL" in ln or "FATAL" in ln or "Traceback" in ln) and PROD_ERROR_RE.search(ln):
                    errors += 1
                low = ln.lower()
                if ("oom" in low or "memory" in low or "137" in ln or "killed" in low) and PROD_OOM_RE.search(ln):
                    oom += 1
                if PROD_CHECKPOINT_DEFER_MARKER in low:
                    ckpt_defer += 1
                if ("reconnect" in low or "disconnect" in low or "websocket" in low or "connection reset" in low) and PROD_RECONNECT_RE.search(ln):
                    reconnects += 1
    except OSError as error:
        return _prod_log_error_entry(path, service, error.strerror or str(error))

    log_triggers: list[str] = []
    if line_count == 0:
        log_triggers.append(f"prod_log_empty ({path.name}: 0 lines — possible logging defect)")
    if oom >= 1:
        log_triggers.append(f"prod_oom_kill ({path.name}: {oom} OOM signal(s))")
    if ckpt_defer >= 3:
        log_triggers.append(f"prod_checkpoint_deferred ({path.name}: {ckpt_defer} deferred checkpoints)")
    if rec_unavail >= 1:
        log_triggers.append(f"prod_recovery_unavailable ({path.name}: {rec_unavail} recovery failure(s))")
    if reconnects >= 10:
        log_triggers.append(f"prod_reconnect_storm ({path.name}: {reconnects} reconnect/drop events)")
    if errors >= 5:
        log_triggers.append(f"prod_error_burst ({path.name}: {errors} error/traceback lines)")

    return {
        "file": path.name, "service": service, "lines": line_count,
        "oom_signals": oom, "checkpoint_deferrals": ckpt_defer,
        "recovery_unavailable": rec_unavail, "reconnect_events": reconnects,
        "error_lines": errors, "triggers": log_triggers,
    }, log_triggers


def analyze_prod_logs(paths: list[Path]) -> dict[str, Any]:
    """Summarize production service logs (Paper/Live/IDE/Dolt) into deterministic operational triggers."""
    logs: list[dict[str, Any]] = []
    triggers: list[str] = []
    warnings: list[str] = []
    services: set[str] = set()
    for path in paths:
        entry, log_triggers = _inspect_prod_log(path)
        logs.append(entry)
        if entry.get("error"):
            warnings.append(f"{entry['file']}: {entry['error']}")
        triggers.extend(log_triggers)
        if log_triggers and entry["service"] != "unknown":
            services.add(entry["service"])
    out: dict[str, Any] = {
        "log_count": len(logs),
        "affected_services": sorted(services),
        "logs": logs,
        "triggers": triggers,
    }
    if warnings:
        out["warnings"] = warnings
    return out


def collect_friction(ci_runs: list[dict[str, Any]] | None = None,
                     transcript_paths: list[Path] | None = None,
                     prod_log_paths: list[Path] | None = None) -> dict[str, Any]:
    """Combine CI delivery, agent/user transcript, and production log signals into a unified summary."""
    ci = analyze_ci_runs(ci_runs) if ci_runs is not None else None
    tx = analyze_transcripts(transcript_paths) if transcript_paths else None
    pl = analyze_prod_logs(prod_log_paths) if prod_log_paths else None
    triggers = [
        *(ci["triggers"] if ci else []),
        *(tx["triggers"] if tx else []),
        *(pl["triggers"] if pl else []),
    ]
    return {
        "ci_provided": ci is not None,
        "transcripts_provided": tx is not None,
        "prod_logs_provided": pl is not None,
        "ci": ci,
        "transcripts": tx,
        "prod_logs": pl,
        "triggers": triggers,
        "has_friction": bool(triggers),
    }
