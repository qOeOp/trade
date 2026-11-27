"""Deterministic CI delivery, production log, and agent/user transcript friction telemetry (product-doctor).

Operationalizes the `Friction` (`delivery`, `agents`, `burden`, `operation`) theme with streaming
JSONL parsing, Claude Code / Antigravity / Codex support, and privacy-safe redaction.
Pure Python standard library; never prints raw transcript prompts, outputs, or credentials.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Callable
from datetime import UTC, datetime
import json
import math
from pathlib import Path
import re
import shlex
import statistics
from typing import Any

SKILL_PATH_RE = re.compile(r"(?:\.agents|\.claude)/skills/([A-Za-z0-9_.-]+)/SKILL\.md")
SKILL_CMD_RE = re.compile(
    r"(?:\.agents|\.claude)/skills/([A-Za-z0-9_.-]+)(?:/SKILL\.md|\b[^\n]*\bSKILL\.md)"
)
INJECTED_SKILL_RE = re.compile(
    r"Base directory for this skill:[^\n]*(?:\.agents|\.claude)/skills/([A-Za-z0-9_.-]+)"
)
NONZERO_EXIT_RE = re.compile(
    r"(?:^Command exited with code |^Process exited with code |^Exit code:\s*)([1-9]\d*)\b",
    re.MULTILINE,
)

SECRET_TOKEN_RE = re.compile(r"(?:^|[\s/'\"<=(])([^\s'\";|&()]*?(?:\.env|dolt/service\.json))(?:$|[\s'\")|;&])")
SECRET_REDIR_RE = re.compile(r"<\s*['\"]?([^\s'\";|&()]*?(?:\.env|dolt/service\.json))(?:['\"]|$|[\s;|&)])")
DEPLOY_ENV_RE = re.compile(r"(?:^|/)deploy/\.env$")
RESEARCH_KEY_NAMES = (
    "OPENALEX_API_KEY|SEMANTIC_SCHOLAR_API_KEY|FRED_API_KEY|"
    "COINALYZE_API_KEY|CRYPTOHFTDATA_API_KEY|RESEARCH_CONTACT_EMAIL|"
    "OPENALEX|SEMANTIC_SCHOLAR|FRED|COINALYZE|CRYPTOHFTDATA|RESEARCH_CONTACT"
)
RESEARCH_KEY_LOOKUP_RE = re.compile(
    rf"""(?:^|[\s'"^(])(?:\^)?(?:{RESEARCH_KEY_NAMES})(?:_[A-Z0-9_]+)?(?:\b|=|\$)"""
    r"""|s/\^\$\{?[A-Za-z_][A-Za-z0-9_]*\}?=//p"""
)
_DOC_PATH_RE = re.compile(r"(?:^|/)(?:README\.md|AGENTS\.md|docs(?:/.*)?)$", re.IGNORECASE)
_ENV_ASSIGN_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*=")
_WRAPPER_BINS = frozenset({"env", "sudo", "command", "exec"})
_WRAPPER_ARG_FLAGS = frozenset({"-u", "-g", "-C", "-a", "-S"})
_GREP_BINS = frozenset({"grep", "egrep", "fgrep", "rg", "ag"})
_SECRET_READ_BINS = frozenset({
    ".", "source", "cat", "head", "tail", "less", "more", "sed", "awk", "gawk", "jq",
    "base64", "xxd", "od", "strings", "hexdump", "nl", "tac", "rev", "cut", "sort",
    "tr", "bat", "view", "cp", "mv", "tee",
})
_INTERPRETER_RE = re.compile(r"^(?:python\d*(?:\.\d+)?|node|perl|ruby|bash|sh|zsh)$")

ANSI_ESCAPE_RE = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]")
PROD_LOG_PREFIX_RE = re.compile(
    r"^(?:(?!(?:DEBUG|INFO|WARN(?:ING)?|TRACE)\s+\|)[\w.-]+\s+\|\s+"
    r"|[A-Z][a-z]{2}\s+\d+\s+\d{2}:\d{2}:\d{2}\s+\S+\s+\S+?:\s+)"
)
PROD_OOM_RE = re.compile(
    r"\b(?:oom-killer|OOMKilled(?!(?:[\"']?\s*[:=]\s*(?:false|0)\b))|"
    r"(?<!\bnot\s)(?<!\bno\s)Out of memory(?!\s+check\s+(?:passed|ok)\b)|"
    r"ExitCode\s*[:=]\s*137|exit_code\s*[:=]\s*137|"
    r"exited\s+with\s+(?:exit\s+)?code\s+137\b|"
    r"Cannot allocate memory\b|MemoryError\b|Killed process\b)",
    re.IGNORECASE,
)
PROD_CHECKPOINT_DEFER_MARKER = "paper checkpoint deferred:"
PROD_RECOVERY_UNAVAIL_MARKER = "PAPER_RECOVERY_UNAVAILABLE"
PROD_RECONNECT_RE = re.compile(r"\b(?:reconnecting|WebSocket[^\n]*closed|connection reset|disconnected)\b", re.IGNORECASE)
PROD_ERROR_RE = re.compile(
    r"(?:^Traceback \(most recent call last\):|"
    r"^(?:\[?\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?\]?[\s|:-]+)?"
    r"[\[(]?(?:CRITICAL|FATAL|ERROR)[\])]?(?:\b|[\s:|])|"
    r"(?i:(?:level|severity)[\"']?\s*[:=]\s*[\"']?(?:CRITICAL|FATAL|ERROR)\b))"
)
PROD_SERVICE_HINTS = ("paper", "live", "ide", "ledger", "market")
NON_EFFECTIVE_CONCLUSIONS = frozenset({"cancelled", "skipped", "neutral"})
ACTIVE_GAP_CAP_MIN = 30.0

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


def _is_shell_sep(cmd: str, i: int) -> bool:
    ch = cmd[i]
    if ch in (";", "\n", "|"):
        return True
    if ch != "&":
        return False
    if i + 1 < len(cmd) and cmd[i + 1] == "&":
        return True
    prev_redir = i > 0 and cmd[i - 1] in (">", "<")
    next_redir = i + 1 < len(cmd) and cmd[i + 1] == ">"
    return not prev_redir and not next_redir


def _find_matching_paren(cmd: str, start: int) -> int:
    depth, quote, i, n = 1, None, start, len(cmd)
    while i < n:
        ch = cmd[i]
        if quote == "'":
            quote = None if ch == "'" else quote
        elif quote == '"':
            if ch == "\\" and i + 1 < n:
                i += 1
            elif ch == '"':
                quote = None
        elif ch == "\\" and i + 1 < n:
            i += 1
        elif ch in ("'", '"'):
            quote = ch
        elif ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
            if depth == 0:
                return i
        i += 1
    return n


def _extract_cmd_subs(cmd: str) -> list[str]:
    subs: list[str] = []
    quote: str | None = None
    i, n = 0, len(cmd)
    while i < n:
        ch = cmd[i]
        if quote == "'":
            quote = None if ch == "'" else quote
        elif ch == "\\" and i + 1 < n:
            i += 1
        elif quote is None and ch in ("'", '"'):
            quote = ch
        elif quote == '"' and ch == '"':
            quote = None
        elif ch == "$" and i + 1 < n and cmd[i + 1] == "(":
            end = _find_matching_paren(cmd, i + 2)
            subs.append(cmd[i + 2:end])
            i = end
        elif ch == "`":
            end = cmd.find("`", i + 1)
            end = n if end == -1 else end
            subs.append(cmd[i + 1:end])
            i = end
        i += 1
    return subs


def _split_shell_segments(cmd: str, _depth: int = 0) -> list[str]:
    """Split a shell command on unquoted separators and command substitutions."""
    segs: list[str] = []
    buf: list[str] = []
    quote: str | None = None
    i, n = 0, len(cmd)
    while i < n:
        ch = cmd[i]
        if quote:
            buf.append(ch)
            if ch == "\\" and quote == '"' and i + 1 < n:
                i += 1
                buf.append(cmd[i])
            elif ch == quote:
                quote = None
        elif ch == "\\" and i + 1 < n:
            buf.append(ch)
            i += 1
            buf.append(cmd[i])
        elif ch in ("'", '"'):
            quote = ch
            buf.append(ch)
        elif _is_shell_sep(cmd, i):
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
    if _depth < 4:
        for sub in _extract_cmd_subs(cmd):
            segs.extend(_split_shell_segments(sub, _depth + 1))
    return [s for s in segs if s]


def _is_secret_target(path_str: str) -> bool:
    """Return True if `path_str` refers to `.env` (excluding `deploy/.env`) or `dolt/service.json`."""
    cleaned = path_str.strip().strip("'\"")
    if not cleaned or DEPLOY_ENV_RE.search(cleaned):
        return False
    return cleaned in (".env", "dolt/service.json") or cleaned.endswith(("/.env", "/dolt/service.json"))


def _extract_cmd_and_args(tokens: list[str]) -> tuple[str, list[str]]:
    """Skip leading `VAR=val` assignments and wrappers (`env`, `sudo`, `command`, `exec`)."""
    idx = 0
    while idx < len(tokens):
        tok = tokens[idx]
        if _ENV_ASSIGN_RE.match(tok):
            idx += 1
            continue
        base = "." if tok == "." else Path(tok).name
        if base in _WRAPPER_BINS:
            idx += 1
            while idx < len(tokens) and (tokens[idx].startswith("-") or _ENV_ASSIGN_RE.match(tokens[idx])):
                idx += 2 if tokens[idx] in _WRAPPER_ARG_FLAGS else 1
            continue
        return base, tokens[idx + 1:]
    return "", []


def _grep_short_flag(flags: str, next_tok: str) -> tuple[bool, bool, int]:
    """Return `(reads_secret, has_pattern, step)` for a short-flag cluster like `-ieKEY` or `-f.env`."""
    if "f" in flags:
        after = flags.split("f", 1)[1]
        return _is_secret_target(after or next_tok), True, (1 if after else 2)
    if "e" in flags:
        return False, True, (2 if flags.endswith("e") else 1)
    return False, False, (2 if flags[-1] in ("m", "A", "B", "C", "g", "t") else 1)


def _grep_reads_secret(args: list[str], seg: str) -> bool:
    if RESEARCH_KEY_LOOKUP_RE.search(seg) and "dolt/service.json" not in seg:
        return False
    has_pat, positionals, idx = False, [], 0
    while idx < len(args):
        tok = args[idx]
        if tok == "--":
            positionals.extend(args[idx + 1:])
            break
        if tok.startswith("--file="):
            if _is_secret_target(tok.split("=", 1)[1]):
                return True
            has_pat = True
        elif tok == "--file":
            if idx + 1 < len(args) and _is_secret_target(args[idx + 1]):
                return True
            has_pat, idx = True, idx + 1
        elif tok in ("--regexp", "--glob", "--type"):
            has_pat = has_pat or tok == "--regexp"
            idx += 1
        elif tok.startswith("--regexp="):
            has_pat = True
        elif tok.startswith("-") and len(tok) >= 2 and not tok.startswith("--"):
            sec, pat, step = _grep_short_flag(tok[1:], args[idx + 1] if idx + 1 < len(args) else "")
            if sec:
                return True
            has_pat, idx = has_pat or pat, idx + step
            continue
        elif not tok.startswith("--"):
            positionals.append(tok)
        idx += 1
    targets = positionals if has_pat else positionals[1:]
    return any(_is_secret_target(t) and not _DOC_PATH_RE.search(t) for t in targets)


def _segment_reads_secret(seg: str) -> bool:
    for m in SECRET_REDIR_RE.finditer(seg):
        if _is_secret_target(m.group(1)):
            return True
    try:
        tokens = shlex.split(seg)
    except ValueError:
        tokens = seg.split()
    cmd_bin, args = _extract_cmd_and_args(tokens)
    if not cmd_bin:
        return False
    if cmd_bin == "git" and args and args[0] in ("grep", "log", "show", "diff", "blame", "rev-parse"):
        return False
    if cmd_bin in _GREP_BINS:
        return _grep_reads_secret(args, seg)
    secret_hits = [m.group(1) for m in SECRET_TOKEN_RE.finditer(seg) if _is_secret_target(m.group(1))]
    if not secret_hits:
        return False
    if cmd_bin == "sed" and RESEARCH_KEY_LOOKUP_RE.search(seg) and all("dolt/service.json" not in h for h in secret_hits):
        return False
    if cmd_bin in _SECRET_READ_BINS:
        return any(_is_secret_target(a) for a in args) or bool(secret_hits)
    if _INTERPRETER_RE.match(cmd_bin):
        return True
    return cmd_bin == "uv" and any(_INTERPRETER_RE.match(Path(a).name) for a in args[:5])


def _scan_workflow_args(args: dict[str, Any], violations: Counter[str]) -> None:
    """Detect credential file access from tool arguments without retaining raw inputs."""
    cmd = _unwrap_str(args.get("CommandLine") or args.get("command") or args.get("cmd") or "")
    fpath = _unwrap_str(args.get("Path") or args.get("path") or args.get("file_path") or "")
    if cmd and any(_segment_reads_secret(s) for s in _split_shell_segments(cmd)):
        violations["secret_file_access"] += 1
    if fpath and _is_secret_target(fpath):
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


def _record_tool_call(
    tname: str, args: Any, skills_loaded: set[str], cmd_summaries: Counter[str],
    violations: Counter[str], on_command: Callable[[str], None] | None,
) -> None:
    if not isinstance(args, dict):
        return
    fpath = _unwrap_str(args.get("Path") or args.get("path") or args.get("file_path") or "")
    for skill in SKILL_PATH_RE.findall(fpath):
        skills_loaded.add(skill)
    if tname == "Skill" and args.get("skill"):
        skills_loaded.add(_unwrap_str(args["skill"]).split(":")[-1])
    cmd = _unwrap_str(args.get("CommandLine") or args.get("command") or args.get("cmd") or "")
    if cmd:
        for skill in SKILL_CMD_RE.findall(cmd):
            skills_loaded.add(skill)
        if on_command is not None:
            on_command(cmd)
    summary = _sanitize_summary(_unwrap_str(args.get("toolSummary") or ""))
    if summary:
        cmd_summaries[summary] += 1
    _scan_workflow_args(args, violations)


_CLAUDE_SYNTHETIC_PREFIXES = (
    "<local-command",
    "<command-",
    "<task-notification>",
    "<system-reminder>",
    "This session is being continued from a previous conversation",
    "Base directory for this skill:",
)


def _is_human_claude_text(text: str) -> bool:
    stripped = text.strip()
    return bool(stripped) and not stripped.startswith(_CLAUDE_SYNTHETIC_PREFIXES)


def _is_claude_user_turn(obj: dict[str, Any], skills_loaded: set[str]) -> bool:
    """Detect real human turns in Claude Code `type=='user'` rows and extract injected skill headers."""
    msg = obj.get("message")
    content = msg.get("content") if isinstance(msg, dict) else None
    is_meta = bool(obj.get("isMeta"))
    if isinstance(content, str):
        for sk in INJECTED_SKILL_RE.findall(content):
            skills_loaded.add(sk)
        return not is_meta and _is_human_claude_text(content)
    if isinstance(content, list):
        has_human = False
        for blk in content:
            if not isinstance(blk, dict):
                continue
            btype = blk.get("type")
            if btype == "text":
                txt = str(blk.get("text") or "")
                for sk in INJECTED_SKILL_RE.findall(txt):
                    skills_loaded.add(sk)
                if _is_human_claude_text(txt):
                    has_human = True
            elif btype != "tool_result":
                has_human = True
        return not is_meta and has_human
    return False


def _record_step_tools(
    obj: dict[str, Any], seen_tool_ids: set[str], skills_loaded: set[str],
    cmd_summaries: Counter[str], violations: Counter[str],
    on_command: Callable[[str], None] | None,
) -> tuple[int, int]:
    """Count deduplicated (tool_calls, tool_errors) from Antigravity and Claude Code rows."""
    calls = errors = 0
    raw_tcs = obj.get("tool_calls")
    for tc in raw_tcs if isinstance(raw_tcs, list) else ():
        if isinstance(tc, dict):
            calls += 1
            raw_args = tc.get("args") if tc.get("args") is not None else tc.get("arguments")
            _record_tool_call(
                str(tc.get("name") or ""), _decode_tool_args(raw_args, skills_loaded),
                skills_loaded, cmd_summaries, violations, on_command,
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
            tid = blk.get("id")
            if isinstance(tid, str) and tid:
                if tid in seen_tool_ids:
                    continue
                seen_tool_ids.add(tid)
            calls += 1
            _record_tool_call(
                str(blk.get("name") or ""), blk.get("input"),
                skills_loaded, cmd_summaries, violations, on_command,
            )
        elif btype == "tool_result" and blk.get("is_error"):
            errors += 1
    return calls, errors


def _record_codex_payload(
    obj: dict[str, Any], skills_loaded: set[str], cmd_summaries: Counter[str],
    violations: Counter[str], on_command: Callable[[str], None] | None,
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
        _record_tool_call(
            str(payload.get("name") or ""), raw_args, skills_loaded, cmd_summaries, violations, on_command,
        )
        return 0, 1, 0
    if ptype.endswith("_output") and NONZERO_EXIT_RE.search(str(payload.get("output") or "")):
        return 0, 0, 1
    return 0, 0, 0


def _compute_durations(timestamps: list[datetime]) -> tuple[float | None, float | None]:
    if len(timestamps) < 2:
        return None, None
    timestamps.sort()
    span_min = round((timestamps[-1] - timestamps[0]).total_seconds() / 60.0, 1)
    active_min = round(
        sum(min((b - a).total_seconds() / 60.0, ACTIVE_GAP_CAP_MIN) for a, b in zip(timestamps, timestamps[1:], strict=False)),
        1,
    )
    return span_min, active_min


def parse_transcript_file(
    path: Path,
    *,
    on_command: Callable[[str], None] | None = None,
) -> dict[str, Any]:
    """Stream-parse one JSONL transcript (Antigravity, Claude Code, or Codex) into privacy-safe metrics."""
    steps = user_turns = tool_calls = tool_errors = 0
    seen_tool_ids: set[str] = set()
    skills_loaded: set[str] = set()
    cmd_summaries: Counter[str] = Counter()
    violations: Counter[str] = Counter()
    timestamps: list[datetime] = []

    try:
        with path.open("r", encoding="utf-8", errors="replace") as fh:
            for line in fh:
                if not line.strip():
                    continue
                try:
                    obj = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if not isinstance(obj, dict) or obj.get("type") == "api-request-blob":
                    continue
                steps += 1
                ts = _parse_iso(obj.get("created_at") or obj.get("timestamp"))
                if ts:
                    timestamps.append(ts)
                raw_type = str(obj.get("type") or "")
                step_type = raw_type.upper()
                role = str(obj.get("role") or "").lower()
                source = str(obj.get("source") or "").upper()
                if raw_type == "user" and isinstance(obj.get("message"), dict):
                    if _is_claude_user_turn(obj, skills_loaded):
                        user_turns += 1
                elif step_type == "USER_INPUT" or source == "USER_EXPLICIT" or (role == "user" and step_type in ("", "USER")):
                    user_turns += 1
                status = str(obj.get("status") or "").upper()
                if status == "ERROR" or (step_type == "GENERIC" and NONZERO_EXIT_RE.search(str(obj.get("content") or ""))):
                    tool_errors += 1
                c, e = _record_step_tools(obj, seen_tool_ids, skills_loaded, cmd_summaries, violations, on_command)
                cu, cc, ce = _record_codex_payload(obj, skills_loaded, cmd_summaries, violations, on_command)
                user_turns += cu
                tool_calls += c + cc
                tool_errors += e + ce
    except OSError as error:
        raise SystemExit(f"cannot read transcript {path}: {error}") from None

    span_min, active_min = _compute_durations(timestamps)
    err_rate = round(tool_errors / tool_calls, 3) if tool_calls else 0.0
    repeated = [(s, c) for s, c in cmd_summaries.most_common(5) if c >= 4]
    return {
        "file": path.name,
        "steps": steps,
        "user_turns": user_turns,
        "tool_calls": tool_calls,
        "tool_errors": tool_errors,
        "tool_error_rate": err_rate,
        "duration_minutes": span_min,
        "active_minutes": active_min,
        "skills_loaded": sorted(skills_loaded),
        "repeated_actions": [{"action": s, "count": c} for s, c in repeated],
        "workflow_violations": [{"kind": k, "count": c} for k, c in sorted(violations.items())],
    }


def analyze_transcripts(paths: list[Path]) -> dict[str, Any]:
    """Summarize one or more agent session transcripts into privacy-safe agent/burden friction signals."""
    sessions = [parse_transcript_file(p) for p in paths]
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
        active = s["active_minutes"] if s["active_minutes"] is not None else s["duration_minutes"]
        if s["user_turns"] >= 12 and (active or 0.0) >= 30.0:
            triggers.append(f"user_clarification_burden ({s['file']}: {s['user_turns']} user turns over {active}m active)")
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
                clean = ANSI_ESCAPE_RE.sub("", ln) if "\x1b" in ln else ln
                low = clean.lower()
                if PROD_RECOVERY_UNAVAIL_MARKER in clean:
                    rec_unavail += 1
                if ("error" in low or "critical" in low or "fatal" in low or "traceback" in low) and PROD_ERROR_RE.search(
                    PROD_LOG_PREFIX_RE.sub("", clean, count=1)
                ):
                    errors += 1
                if ("oom" in low or "memory" in low or "137" in clean or "killed" in low) and PROD_OOM_RE.search(clean):
                    oom += 1
                if PROD_CHECKPOINT_DEFER_MARKER in low:
                    ckpt_defer += 1
                if ("reconnect" in low or "disconnect" in low or "websocket" in low or "connection reset" in low) and PROD_RECONNECT_RE.search(clean):
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


def collect_friction(
    ci_runs: list[dict[str, Any]] | None = None,
    transcript_paths: list[Path] | None = None,
    prod_log_paths: list[Path] | None = None,
) -> dict[str, Any]:
    """Combine CI delivery, agent transcript, and production service log friction signals."""
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


def _is_finite_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _audit_research_state(state: dict[str, Any], triggers: list[str]) -> dict[str, Any]:
    raw_line = state.get("line")
    line_obj: dict[str, Any] | None = raw_line if isinstance(raw_line, dict) else None
    line_name = str(line_obj.get("name") or "none") if line_obj is not None else "none"
    is_open = line_obj is not None and not line_obj.get("closed_at")
    raw_cadence = state.get("review_every")
    review_every = (
        int(raw_cadence)
        if isinstance(raw_cadence, int) and not isinstance(raw_cadence, bool) and raw_cadence > 0
        else 5
    )

    unreviewed = _as_list(state.get("unreviewed_trials"))
    raw_undist = state.get("undistinguished_runs")
    undist: dict[str, Any] | None = raw_undist if isinstance(raw_undist, dict) else None
    undist_trials = _as_list(undist.get("trials")) if undist is not None else []
    uncompared = _as_list(undist.get("uncompared")) if undist is not None else []
    distinguished = undist.get("distinguished") if undist is not None else None
    behind = _as_list(state.get("runs_behind_image"))
    gate_codes = [str(g.get("code") or "UNKNOWN") for g in _as_list(state.get("gates")) if isinstance(g, dict)]

    if len(unreviewed) >= review_every:
        triggers.append(
            f"research_unreviewed_backlog ({line_name}: {len(unreviewed)} unreviewed trials >= review_every={review_every})"
        )
    if len(uncompared) >= review_every:
        triggers.append(
            f"research_uncompared_backlog ({line_name}: {len(uncompared)} uncompared runs >= review_every={review_every})"
        )
    if undist is not None and distinguished in (None, False) and len(undist_trials) >= review_every:
        triggers.append(
            f"research_undistinguished_streak ({line_name}: {len(undist_trials)} undistinguished runs >= review_every={review_every})"
        )
    if behind:
        triggers.append(
            f"research_stale_runtime_runs ({line_name}: {len(behind)} passed run(s) behind current image)"
        )
    if is_open and gate_codes:
        triggers.append(f"research_blocking_gates ({line_name}: {', '.join(gate_codes)})")

    interps = _as_list(state.get("interpretations"))
    exposures = _as_list(state.get("search_exposures"))
    return {
        "ledger_commit": state.get("ledger_commit"),
        "line": line_name if line_obj else None,
        "is_open": is_open,
        "review_every": review_every,
        "trials_on_line": state.get("trials_on_line"),
        "unreviewed_count": len(unreviewed),
        "uncompared_count": len(uncompared),
        "undistinguished_count": len(undist_trials),
        "distinguished_trial": distinguished,
        "runs_behind_image_count": len(behind),
        "has_recommendation": state.get("recommendation") is not None,
        "interpretations_count": len(interps),
        "search_exposures_count": len(exposures),
        "gates": gate_codes,
    }


def _audit_multiple_testing(status: dict[str, Any], triggers: list[str]) -> dict[str, Any]:
    mt = status.get("multiple_testing") if isinstance(status.get("multiple_testing"), dict) else None
    summary: dict[str, Any] = {
        "ledger_commit": status.get("ledger_commit"),
        "trials": status.get("trials"),
        "multiple_testing": None,
    }
    if mt is None:
        return summary
    mt_line = str(mt.get("line") or "unknown")
    rwr = mt.get("runs_with_returns")
    res_trials = mt.get("research_trials")
    mean_corr = mt.get("mean_correlation")
    eff = mt.get("effective_trials")
    rwr_int = int(rwr) if _is_finite_number(rwr) else 0
    res_int = int(res_trials) if _is_finite_number(res_trials) else 0
    denom = max(rwr_int, res_int) if rwr_int > 0 else res_int
    eff_ratio = round(float(eff) / denom, 4) if (denom > 0 and _is_finite_number(eff)) else None

    high_corr = rwr_int >= 6 and _is_finite_number(mean_corr) and float(mean_corr) >= 0.85
    low_eff = rwr_int >= 6 and eff_ratio is not None and eff_ratio <= 0.35
    if high_corr or low_eff:
        corr_s = f"{float(mean_corr):.3f}" if _is_finite_number(mean_corr) else "null"
        eff_s = f"{float(eff):.2f}" if _is_finite_number(eff) else "null"
        ratio_s = f"{eff_ratio:.2f}" if eff_ratio is not None else "null"
        triggers.append(
            f"research_correlated_sweep ({mt_line}: runs_with_returns={rwr_int}, "
            f"mean_correlation={corr_s}, effective_trials={eff_s}, ratio={ratio_s})"
        )

    summary["multiple_testing"] = {
        "line": mt.get("line"),
        "research_trials": mt.get("research_trials"),
        "all_purpose_trials": mt.get("all_purpose_trials"),
        "sweep_variants": mt.get("sweep_variants"),
        "trials_with_sweeps": mt.get("trials_with_sweeps"),
        "runs_with_returns": mt.get("runs_with_returns"),
        "mean_correlation": round(float(mean_corr), 4) if _is_finite_number(mean_corr) else None,
        "effective_trials": round(float(eff), 4) if _is_finite_number(eff) else None,
        "effective_trial_ratio": eff_ratio,
    }
    return summary


def analyze_research_ledger(
    state_data: dict[str, Any] | None = None,
    status_data: dict[str, Any] | None = None,
    transcript_paths: list[Path] | None = None,
) -> dict[str, Any]:
    """Audit a research line from real `research state` / `research status` JSON and optional transcripts."""
    if state_data is not None and not isinstance(state_data, dict):
        raise SystemExit("--state-json must contain a JSON object from `cli.main research state`")
    if status_data is not None and not isinstance(status_data, dict):
        raise SystemExit("--status-json must contain a JSON object from `cli.main research status`")
    effective_status = status_data
    if effective_status is None and isinstance(state_data, dict):
        facts = state_data.get("facts")
        if isinstance(facts, dict) and isinstance(facts.get("counts"), dict):
            effective_status = facts["counts"]

    triggers: list[str] = []
    state_summary = _audit_research_state(state_data, triggers) if state_data is not None else None
    status_summary = _audit_multiple_testing(effective_status, triggers) if effective_status is not None else None
    tx_summary = analyze_transcripts(transcript_paths) if transcript_paths else None
    if tx_summary is not None:
        triggers.extend(tx_summary["triggers"])

    return {
        "ok": not triggers,
        "state_provided": state_data is not None,
        "status_provided": effective_status is not None,
        "transcripts_provided": tx_summary is not None,
        "state": state_summary,
        "status": status_summary,
        "transcripts": tx_summary,
        "triggers": triggers,
    }
