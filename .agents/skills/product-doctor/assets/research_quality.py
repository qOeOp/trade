"""Deterministic research-session quality telemetry for product-doctor (v3.1).

Derives five read-only exploration-quality and methodology-degradation metrics from agent
transcript JSONL files (Antigravity, Claude Code, Codex) and optional read-only ledger trial
summary JSON exports, with zero new stored ledger fields.
Pure Python standard library; streams transcript lines and never retains raw prompts or secrets.
"""

from __future__ import annotations

from collections import Counter
from datetime import UTC, datetime
import json
from pathlib import Path
import re
from typing import Any

RESEARCH_QUALITY_PREFIX = "research_quality:"
RESEARCH_QUALITY_TARGETS = (
    ".agents/skills/research-round",
    ".agents/skills/nautilus-report-analysis",
)
LENS_SLA_OVERRIDES: dict[str, int] = {
    "methodology": 60,
}

MAX_LINE_CHARS = 2_000_000
MAX_TEXT_SCAN = 16_384
MAX_CACHED_FILES = 16

PARAM_CHURN_MIN_TRIALS = 5
PARAM_CHURN_THRESHOLD = 0.70
UNATTRIBUTED_PIVOT_THRESHOLD = 2
PREREG_DRIFT_THRESHOLD = 1
EVIDENCE_GAP_THRESHOLD = 1
OVERFIT_MIN_TRIALS = 6

SKILL_PATH_MARKER = ".agents/skills/"
SKILL_PATH_RE = re.compile(r"\.agents/skills/([A-Za-z0-9_.-]+)/SKILL\.md")
HELP_FLAG_RE = re.compile(r"(?:^|\s)(?:--help|-h)(?:\s|$)")
NONZERO_EXIT_RE = re.compile(
    r"(?:^Command exited with code |^Process exited with code |^Exit code:\s*)([1-9]\d*)\b",
    re.MULTILINE,
)
CLI_SUBCMD_RE = re.compile(
    r"\bcli\.main(?:\s+--?[A-Za-z0-9_-]+(?:=\S+|\s+[^\s-]\S*)?)*\s+([a-z]+)\s+([a-z_-]+)\b"
)
SEARCH_CMD_RE = re.compile(r"^\s*(?:git\s+(?:grep|log|show|diff|blame)|(?:e?grep|fgrep|rg|ag))\b")
RESEARCH_NOUNS = frozenset({
    "research", "line", "trial", "replay", "registration",
    "candidate", "hypothesis", "judgment", "evidence",
})
TRIAL_EXEC_VERBS = frozenset({
    ("replay", "run"), ("replay", "explore"),
    ("trial", "run"), ("trial", "submit"), ("trial", "register"),
})
PREREG_VERBS = frozenset({("registration", "add"), ("preregistration", "add"), ("trial", "preregister")})
REPORT_ANALYSIS_VERBS = frozenset({
    ("replay", "report"), ("hypothesis", "compare"),
    ("research", "history"), ("research", "status"), ("evidence", "export"),
})
BACKING_VERBS = frozenset({
    ("replay", "report"), ("hypothesis", "compare"),
    ("research", "history"), ("research", "status"),
    ("replay", "run"), ("replay", "explore"),
})
MULTI_TEST_VERBS = frozenset({("hypothesis", "compare"), ("research", "status")})

ANALYSIS_CMD_RE = re.compile(
    r"(?:\btables\s*\(|\breport\.runs\b|nautilus-report-analysis|\bcomparison\b|\battribution\b)",
    re.IGNORECASE,
)
ANALYSIS_PATH_RE = re.compile(
    r"(?:nautilus-report-analysis|(?:replay[_-]?report|comparison|attribution|tables)\.(?:json|csv|md|txt))",
    re.IGNORECASE,
)
BACKING_PATH_RE = re.compile(
    r"(?:replay[_-]?report|summary|metrics|comparison|attribution|tables)\.(?:json|csv)$",
    re.IGNORECASE,
)
PREREG_PATH_RE = re.compile(r"(?:registration|prereg)[^/]*\.json$", re.IGNORECASE)
MULTI_TEST_RE = re.compile(
    r"(?:\bdeflated[_\s-]*sharpe\b|\bmultiple[_\s-]*testing\b|\bbonferroni\b|\bbenjamini\b|"
    r"\bfdr\b|\bwhite[_\s-]*reality[_\s-]*check\b|\bspa[_\s-]*test\b|"
    r"\bcontrol[_\s-]*comparison\b|nautilus-report-analysis/references/ratios\.md)",
    re.IGNORECASE,
)
FAILURE_OUT_RE = re.compile(
    r"(?:\"(?:outcome|status)\"\s*:\s*\"(?:failed|rejected|refused|below_target|error)\"|"
    r"\"(?:meets_targets|target_met|passed)\"\s*:\s*false\b|"
    r"\b(?:ELIGIBILITY_FAILED|REFUSAL|undistinguished|below[\s_-]target|drawdown\s+exceeded)\b|"
    r"\b(?:trial|replay)\s+(?:failed|rejected)\b)",
    re.IGNORECASE,
)
FAILURE_PROSE_RE = re.compile(
    r"(?:\b(?:trial|run|candidate|strategy)\b.{0,40}\b(?:failed|rejected|below\s+target|did\s+not\s+meet|"
    r"underperformed|unprofitable|negative\s+sharpe|exceeded\s+drawdown|missed\s+target)\b|"
    r"(?:未达标|不达标|未通过|失败|回撤超标|亏损))",
    re.IGNORECASE,
)
SYMBOL_RE = re.compile(r"\b([A-Z]{2,10}USDT)(?:\.BINANCE|-PERP)?\b")
EXEC_FLAG_RE = re.compile(r"(?:--execution(?:=|\s+)|\"execution(?:_mode)?\"\s*:\s*\")(bars|quotes)\b", re.IGNORECASE)
START_FLAG_RE = re.compile(r"(?:--(?:start|from)(?:=|\s+)|\"(?:start|from)\"\s*:\s*\")(\d{4}-\d{2}-\d{2})")
END_FLAG_RE = re.compile(r"(?:--(?:end|to)(?:=|\s+)|\"(?:end|to)\"\s*:\s*\")(\d{4}-\d{2}-\d{2})")
PERIOD_FLAG_RE = re.compile(
    r"(?:--(?:period|window)(?:=|\s+)|\"(?:period|window)\"\s*:\s*\")([A-Za-z0-9_.:/-]+)"
)
DATE_RANGE_RE = re.compile(r"\b(\d{4}-\d{2}-\d{2})\s*(?:\.\.|:|to)\s*(\d{4}-\d{2}-\d{2})\b")
LINE_FLAG_RE = re.compile(r"(?:--line(?:=|\s+)|\"(?:line|research_line)\"\s*:\s*\")([A-Za-z0-9_.:/-]+)")
CANDIDATE_FLAG_RE = re.compile(r"--(?:candidate|strategy)(?:=|\s+)([A-Za-z0-9_.-]+)(?:@\d+)?")
HYP_FLAG_RE = re.compile(
    r"--(?:hypothesis|mechanism|conjecture|description|difference|changed-duties)(?:=|\s+)"
    r"(?:'([^']*)'|\"([^\"]*)\"|(\S+))"
)
HYP_PROSE_RE = re.compile(
    r"(?:^|\n)\s*(?:hypothesis|mechanism|conjecture|假设|机制)\s*[:：]\s*([^\n]{6,200})",
    re.IGNORECASE,
)
JSON_FILE_FLAG_RE = re.compile(r"--(?:body|file|spec|config|registration-file)(?:=|\s+)([^\s'\"]+)")
RUN_ID_FLAG_RE = re.compile(
    r"--(?:trial-id|registration|output|directory|dir|name|operation-id)(?:=|\s+)\S+"
)
NUM_TOKEN_RE = re.compile(r"(?<![A-Za-z_])[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?")
VERSION_SUFFIX_RE = re.compile(r"(?:@\d+|(?:[_-]|(?<=[a-z]))v\d+\b)", re.IGNORECASE)
SEG_SPLIT_RE = re.compile(r"\s*(?:&&|\|\||;|\n)\s*")

TARGET_PREFIX_RE = re.compile(
    r"(?:target|goal|threshold|require[sd]?|must\s+be|aim(?:ing)?\s+for|bar|cap|floor|limit|"
    r"目标|要求|阈值|不低于|不超过)\s*[:：]?\s*$",
    re.IGNORECASE,
)
METRIC_CLAIM_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("sharpe", re.compile(
        r"\b(?:deflated\s+)?(?:sharpe|sortino|calmar)(?:\s+ratio)?\s*"
        r"(?:(?:is|of|=|:|≈|~)\s*[+-]?\d+(?:\.\d+)?|[+-]?\d+\.\d+)\b",
        re.IGNORECASE,
    )),
    ("annual_return", re.compile(
        r"(?:\b(?:cagr|annual(?:ized)?\s+return)\b|年化收益(?:率)?)\s*(?:is|of|=|:|≈|~)?\s*[+-]?\d+(?:\.\d+)?\s*%",
        re.IGNORECASE,
    )),
    ("max_drawdown", re.compile(
        r"(?:\b(?:max(?:imum)?\s+drawdown|mdd)\b|最大回撤)\s*(?:is|of|=|:|≈|~)?\s*[+-]?\d+(?:\.\d+)?\s*%",
        re.IGNORECASE,
    )),
    ("win_rate", re.compile(
        r"(?:\bwin[\s-]*rate\b|胜率)\s*(?:is|of|=|:|≈|~)?\s*\d+(?:\.\d+)?\s*%",
        re.IGNORECASE,
    )),
    ("pnl_pct", re.compile(
        r"(?:\b(?:net\s+|total\s+|realized\s+)?pnl\b|\b(?:total|net)\s+return\b)\s*"
        r"(?:is|of|=|:|≈|~)?\s*[+-]?\d+(?:\.\d+)?\s*%",
        re.IGNORECASE,
    )),
)


def _unwrap_str(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    text = value[:MAX_TEXT_SCAN]
    if len(text) >= 2 and text[0] == '"' and text[-1] == '"':
        try:
            decoded = json.loads(text)
            if isinstance(decoded, str):
                return decoded[:MAX_TEXT_SCAN]
        except json.JSONDecodeError:
            pass
    return text


def _decode_args(raw: Any) -> dict[str, Any]:
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str) and raw.strip():
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError:
            return {"_raw": raw[:MAX_TEXT_SCAN]}
    return {}


def _flatten_content_text(content: Any) -> str:
    if isinstance(content, str):
        return content[:MAX_TEXT_SCAN]
    if isinstance(content, list):
        parts: list[str] = []
        total = 0
        for blk in content:
            if isinstance(blk, dict) and blk.get("type") in ("text", "output_text", None):
                piece = str(blk.get("text") or "")
                if piece:
                    parts.append(piece)
                    total += len(piece)
                    if total >= MAX_TEXT_SCAN:
                        break
        return "\n".join(parts)[:MAX_TEXT_SCAN]
    return ""


def _extract_tool_call(name: str, raw_args: Any) -> dict[str, Any]:
    args = _decode_args(raw_args)
    cmd = _unwrap_str(args.get("CommandLine") or args.get("command") or args.get("cmd") or "")
    fpath = _unwrap_str(args.get("Path") or args.get("path") or args.get("file_path") or "")
    content = _unwrap_str(args.get("Content") or args.get("content") or args.get("Replacement") or "")
    skill = _unwrap_str(args.get("skill") or "") if name == "Skill" else ""
    if not skill and SKILL_PATH_MARKER in fpath and fpath.endswith("SKILL.md"):
        skill = fpath.split(SKILL_PATH_MARKER, 1)[1].split("/", 1)[0]
    if not skill and isinstance(raw_args, str):
        m = SKILL_PATH_RE.search(raw_args)
        if m:
            skill = m.group(1)
    return {
        "kind": "tool_call",
        "name": name,
        "cmd": cmd,
        "path": fpath,
        "content": content,
        "skill": skill,
    }


def _extract_row_events(obj: dict[str, Any]) -> list[dict[str, Any]]:
    """Normalize one Antigravity, Claude Code, or Codex JSONL row into typed events."""
    events: list[dict[str, Any]] = []
    _append_antigravity_events(obj, events)
    _append_claude_events(obj, events)
    _append_codex_events(obj, events)
    return events


def _append_antigravity_events(obj: dict[str, Any], events: list[dict[str, Any]]) -> None:
    raw_tcs = obj.get("tool_calls")
    for tc in raw_tcs if isinstance(raw_tcs, list) else ():
        if isinstance(tc, dict):
            raw_args = tc.get("args") if tc.get("args") is not None else tc.get("arguments")
            events.append(_extract_tool_call(str(tc.get("name") or ""), raw_args))

    step_type = str(obj.get("type") or "").upper()
    role = str(obj.get("role") or "").lower()
    status = str(obj.get("status") or "").upper()
    content = obj.get("content")
    text = _flatten_content_text(content) if content is not None else ""
    if not text:
        return
    if step_type in ("GENERIC", "TOOL_OUTPUT", "TOOL_RESULT", "FUNCTION_RESPONSE") or role == "tool":
        is_err = status == "ERROR" or bool(NONZERO_EXIT_RE.search(text))
        events.append({"kind": "tool_output", "text": text, "is_error": is_err})
    elif step_type == "PLANNER_RESPONSE" or (role == "assistant" and "message" not in obj):
        events.append({"kind": "assistant_text", "text": text})


def _append_claude_events(obj: dict[str, Any], events: list[dict[str, Any]]) -> None:
    msg = obj.get("message")
    if not isinstance(msg, dict):
        return
    role = str(msg.get("role") or obj.get("type") or "").lower()
    content = msg.get("content")
    if isinstance(content, str) and content and role == "assistant":
        events.append({"kind": "assistant_text", "text": content[:MAX_TEXT_SCAN]})
        return
    if not isinstance(content, list):
        return
    for blk in content:
        if not isinstance(blk, dict):
            continue
        btype = blk.get("type")
        if btype == "tool_use":
            events.append(_extract_tool_call(str(blk.get("name") or ""), blk.get("input")))
        elif btype == "tool_result":
            text = _flatten_content_text(blk.get("content"))
            is_err = bool(blk.get("is_error")) or bool(NONZERO_EXIT_RE.search(text))
            events.append({"kind": "tool_output", "text": text, "is_error": is_err})
        elif btype == "text" and role == "assistant":
            text = _unwrap_str(blk.get("text") or "")
            if text:
                events.append({"kind": "assistant_text", "text": text})


def _append_codex_events(obj: dict[str, Any], events: list[dict[str, Any]]) -> None:
    payload = obj.get("payload")
    if not isinstance(payload, dict):
        return
    ptype = str(payload.get("type") or "").lower()
    if ptype in ("function_call", "custom_tool_call"):
        raw_args = payload.get("arguments") if payload.get("arguments") is not None else payload.get("input")
        events.append(_extract_tool_call(str(payload.get("name") or ""), raw_args))
    elif ptype.endswith("_output"):
        text = _flatten_content_text(payload.get("output"))
        is_err = bool(NONZERO_EXIT_RE.search(text))
        events.append({"kind": "tool_output", "text": text, "is_error": is_err})
    elif ptype == "message" and str(payload.get("role") or "").lower() == "assistant":
        text = _flatten_content_text(payload.get("content"))
        if text:
            events.append({"kind": "assistant_text", "text": text})


def _mask_numeric_text(text: str) -> str:
    cleaned = RUN_ID_FLAG_RE.sub("", text)
    cleaned = VERSION_SUFFIX_RE.sub("@<NUM>", cleaned)
    cleaned = NUM_TOKEN_RE.sub("<NUM>", cleaned)
    return " ".join(cleaned.lower().split())


def _extract_scope(text: str) -> dict[str, set[str]]:
    symbols = set(SYMBOL_RE.findall(text))
    executions = {m.lower() for m in EXEC_FLAG_RE.findall(text)}
    periods: set[str] = set()
    starts = START_FLAG_RE.findall(text)
    ends = END_FLAG_RE.findall(text)
    if starts and ends:
        periods.add(f"{starts[0]}..{ends[0]}")
    elif starts:
        periods.add(f"start:{starts[0]}")
    elif ends:
        periods.add(f"end:{ends[0]}")
    for s_date, e_date in DATE_RANGE_RE.findall(text):
        periods.add(f"{s_date}..{e_date}")
    for per in PERIOD_FLAG_RE.findall(text):
        periods.add(per)
    return {"symbols": symbols, "executions": executions, "periods": periods}


def _scope_has_drift(declared: dict[str, set[str]], used: dict[str, set[str]]) -> bool:
    for key in ("symbols", "executions", "periods"):
        allowed = declared.get(key)
        seen = used.get(key)
        if allowed and seen and not seen.issubset(allowed):
            return True
    return False


def _extract_mechanism_from_cmd(seg: str, extra_text: str = "") -> tuple[str, str]:
    """Return `(strategy_family, masked_mechanism_text)` from a CLI segment and optional JSON text."""
    cand_m = CANDIDATE_FLAG_RE.search(seg)
    family = VERSION_SUFFIX_RE.sub("", cand_m.group(1)).lower() if cand_m else ""
    hyps: list[str] = []
    for g1, g2, g3 in HYP_FLAG_RE.findall(seg):
        val = g1 or g2 or g3
        if val:
            hyps.append(val)
    if extra_text:
        try:
            data = json.loads(extra_text)
        except json.JSONDecodeError:
            data = None
        if isinstance(data, dict):
            if not family and data.get("candidate"):
                family = VERSION_SUFFIX_RE.sub("", str(data["candidate"])).lower()
            for field in ("hypothesis", "mechanism", "conjecture", "description", "difference", "changed_duties"):
                val = data.get(field)
                if val:
                    hyps.append(json.dumps(val, sort_keys=True) if isinstance(val, (list, dict)) else str(val))
    mech = _mask_numeric_text(" | ".join(hyps)) if hyps else ""
    return family, mech


def _extract_unbacked_metric_claims(text: str) -> list[str]:
    """Find concrete quantitative metric claims in assistant prose, excluding target/threshold statements."""
    found: list[str] = []
    for kind, pat in METRIC_CLAIM_PATTERNS:
        for match in pat.finditer(text):
            prefix = text[max(0, match.start() - 48):match.start()]
            clause = re.split(r"[\n.;!?。；！？]", prefix)[-1]
            if TARGET_PREFIX_RE.search(clause):
                continue
            found.append(kind)
    return found


def _compute_param_churn(trials: list[dict[str, str]]) -> float:
    if len(trials) < 2:
        return 0.0
    churn = 0
    for prev, cur in zip(trials, trials[1:], strict=False):
        same_mech = prev["mechanism"] == cur["mechanism"]
        same_family = prev["family"] == cur["family"]
        same_skel = prev["skeleton"] == cur["skeleton"]
        if same_mech and (same_skel or (same_family and bool(cur["family"]))):
            churn += 1
    return round(churn / (len(trials) - 1), 3)


def _new_session_state() -> dict[str, Any]:
    return {
        "research_session": False,
        "skills": set(),
        "cached_files": {},
        "active_prereg": None,
        "prereg_drift_count": 0,
        "pending_meta": {"family": "", "mechanism": ""},
        "pending_prose_hyp": "",
        "exec_trials": [],
        "reg_trials": [],
        "exec_line_window_counts": Counter(),
        "reg_line_window_counts": Counter(),
        "has_multi_test_control": False,
        "confirmed_backing_count": 0,
        "pending_backing": False,
        "last_call_role": "",
        "pending_failed_trial": False,
        "analyzed_since_failure": False,
        "unattributed_pivot_count": 0,
        "pending_unbacked_claims": 0,
    }


def _mark_backing_call(state: dict[str, Any]) -> None:
    if state["pending_backing"]:
        state["confirmed_backing_count"] += 1
    state["pending_backing"] = True


def _record_trial_entry(
    state: dict[str, Any], bucket: str, seg: str, family: str, mech: str, scope: dict[str, set[str]],
) -> None:
    eff_family = family or state["pending_meta"]["family"]
    eff_mech = mech or state["pending_meta"]["mechanism"] or state["pending_prose_hyp"]
    entry = {
        "family": eff_family,
        "mechanism": eff_mech,
        "skeleton": _mask_numeric_text(seg),
    }
    state[bucket].append(entry)
    line_m = LINE_FLAG_RE.search(seg)
    line_key = line_m.group(1) if line_m else "default"
    win_key = ",".join(sorted(scope["periods"])) if scope["periods"] else "default"
    if bucket == "exec_trials":
        state["exec_line_window_counts"][f"{line_key}|{win_key}"] += 1
        state["pending_meta"] = {"family": "", "mechanism": ""}
        state["pending_prose_hyp"] = ""
    else:
        state["reg_line_window_counts"][f"{line_key}|{win_key}"] += 1


def _resolve_extra_json(seg: str, cached_files: dict[str, str]) -> str:
    m = JSON_FILE_FLAG_RE.search(seg)
    if not m:
        return ""
    raw_ref = m.group(1)
    return cached_files.get(raw_ref) or cached_files.get(Path(raw_ref).name) or ""


def _check_unattributed_pivot(state: dict[str, Any]) -> None:
    if state["pending_failed_trial"] and not state["analyzed_since_failure"]:
        state["unattributed_pivot_count"] += 1
        state["pending_failed_trial"] = False


def _handle_cli_segment(state: dict[str, Any], seg: str) -> None:
    if not seg or HELP_FLAG_RE.search(seg) or SEARCH_CMD_RE.search(seg):
        return
    m = CLI_SUBCMD_RE.search(seg)
    if not m:
        return
    pair = (m.group(1), m.group(2))
    if pair[0] in RESEARCH_NOUNS:
        state["research_session"] = True
    extra = _resolve_extra_json(seg, state["cached_files"])
    combined = f"{seg}\n{extra}" if extra else seg
    scope = _extract_scope(combined)
    family, mech = _extract_mechanism_from_cmd(seg, extra)

    if pair in REPORT_ANALYSIS_VERBS or (pair == ("research", "state") and "--history" in seg):
        state["analyzed_since_failure"] = True
    if pair in MULTI_TEST_VERBS or MULTI_TEST_RE.search(seg):
        state["has_multi_test_control"] = True
    if pair in BACKING_VERBS:
        _mark_backing_call(state)
        state["last_call_role"] = "backing"

    if pair in PREREG_VERBS:
        _check_unattributed_pivot(state)
        if any(scope.values()):
            state["active_prereg"] = scope
        if family or mech:
            state["pending_meta"] = {"family": family, "mechanism": mech}
        _record_trial_entry(state, "reg_trials", seg, family, mech, scope)
        state["last_call_role"] = "prereg"
        return

    if pair in {("candidate", "new"), ("candidate", "publish"), ("line", "select")}:
        _check_unattributed_pivot(state)
        if family or mech:
            state["pending_meta"] = {
                "family": family or state["pending_meta"]["family"],
                "mechanism": mech or state["pending_meta"]["mechanism"],
            }
        state["last_call_role"] = "candidate"
        return

    if pair in TRIAL_EXEC_VERBS:
        _check_unattributed_pivot(state)
        if state["active_prereg"] and _scope_has_drift(state["active_prereg"], scope):
            state["prereg_drift_count"] += 1
        _record_trial_entry(state, "exec_trials", seg, family, mech, scope)
        state["last_call_role"] = "trial_exec"


def _handle_tool_call(state: dict[str, Any], ev: dict[str, Any]) -> None:
    skill = ev["skill"]
    if skill:
        state["skills"].add(skill)
        if skill == "nautilus-report-analysis":
            state["analyzed_since_failure"] = True
    fpath = ev["path"]
    content = ev["content"]
    if fpath:
        if content and len(state["cached_files"]) < MAX_CACHED_FILES:
            state["cached_files"][fpath] = content
            state["cached_files"][Path(fpath).name] = content
        if PREREG_PATH_RE.search(fpath) and content:
            scope = _extract_scope(content)
            if any(scope.values()):
                state["active_prereg"] = scope
        if ANALYSIS_PATH_RE.search(fpath):
            state["analyzed_since_failure"] = True
        if BACKING_PATH_RE.search(fpath):
            _mark_backing_call(state)
            state["last_call_role"] = "backing"
        if MULTI_TEST_RE.search(fpath):
            state["has_multi_test_control"] = True

    cmd = ev["cmd"]
    if not cmd:
        return
    if ANALYSIS_CMD_RE.search(cmd) and not SEARCH_CMD_RE.search(cmd):
        state["analyzed_since_failure"] = True
        _mark_backing_call(state)
        state["last_call_role"] = "backing"
    if MULTI_TEST_RE.search(cmd) and not SEARCH_CMD_RE.search(cmd):
        state["has_multi_test_control"] = True
    for seg in SEG_SPLIT_RE.split(cmd):
        _handle_cli_segment(state, seg.strip())


def _handle_tool_output(state: dict[str, Any], ev: dict[str, Any]) -> None:
    text = ev["text"]
    is_err = bool(ev["is_error"])
    if state["pending_backing"]:
        if not is_err:
            state["confirmed_backing_count"] += 1
        state["pending_backing"] = False
    if state["last_call_role"] == "trial_exec" and (is_err or FAILURE_OUT_RE.search(text)):
        state["pending_failed_trial"] = True
        state["analyzed_since_failure"] = False
    state["last_call_role"] = ""


def _handle_assistant_text(state: dict[str, Any], ev: dict[str, Any]) -> None:
    text = ev["text"]
    hyp_m = HYP_PROSE_RE.search(text)
    if hyp_m:
        state["pending_prose_hyp"] = _mask_numeric_text(hyp_m.group(1))
    if state["exec_trials"] and FAILURE_PROSE_RE.search(text) and not state["analyzed_since_failure"]:
        state["pending_failed_trial"] = True
    has_backing = state["confirmed_backing_count"] > 0 or state["pending_backing"]
    if not has_backing:
        claims = _extract_unbacked_metric_claims(text)
        state["pending_unbacked_claims"] += len(claims)


def _build_quality_triggers(
    label: str, n_trials: int, churn_ratio: float, pivots: int, drifts: int,
    gaps: int, max_same_window: int, overfit: bool,
) -> list[str]:
    triggers: list[str] = []
    if n_trials >= PARAM_CHURN_MIN_TRIALS and churn_ratio >= PARAM_CHURN_THRESHOLD:
        triggers.append(
            f"research_quality:param_churn_ratio ({label}: {churn_ratio:.0%} across {n_trials} trials)"
        )
    if pivots >= UNATTRIBUTED_PIVOT_THRESHOLD:
        triggers.append(
            f"research_quality:unattributed_pivot ({label}: {pivots} failed trial pivot(s) without analysis)"
        )
    if drifts >= PREREG_DRIFT_THRESHOLD:
        triggers.append(f"research_quality:prereg_drift ({label}: {drifts} undeclared scope run(s))")
    if gaps >= EVIDENCE_GAP_THRESHOLD:
        triggers.append(f"research_quality:evidence_gap ({label}: {gaps} unbacked metric claim(s))")
    if overfit:
        triggers.append(
            f"research_quality:multi_trial_overfit ({label}: {max_same_window} trials on same line/window without multiple-testing/control check)"
        )
    return triggers


def _finalize_session(path: Path, state: dict[str, Any]) -> dict[str, Any]:
    is_research = bool(state["research_session"])
    use_exec = bool(state["exec_trials"])
    trials = state["exec_trials"] if use_exec else state["reg_trials"]
    line_windows = state["exec_line_window_counts"] if use_exec else state["reg_line_window_counts"]
    n_trials = len(trials)
    if not is_research:
        return {
            "file": path.name, "research_session": False, "trial_count": 0,
            "param_churn_ratio": 0.0, "unattributed_pivot_count": 0, "prereg_drift_count": 0,
            "evidence_gap_claims": 0, "multi_trial_overfit_risk": False, "triggers": [],
        }

    churn_ratio = _compute_param_churn(trials)
    pivots = int(state["unattributed_pivot_count"])
    drifts = int(state["prereg_drift_count"])
    gaps = int(state["pending_unbacked_claims"])
    max_same_window = max(line_windows.values(), default=0)
    overfit = max_same_window >= OVERFIT_MIN_TRIALS and not state["has_multi_test_control"]
    triggers = _build_quality_triggers(
        path.name, n_trials, churn_ratio, pivots, drifts, gaps, max_same_window, overfit,
    )
    return {
        "file": path.name, "research_session": True, "trial_count": n_trials,
        "param_churn_ratio": churn_ratio, "unattributed_pivot_count": pivots,
        "prereg_drift_count": drifts, "evidence_gap_claims": gaps,
        "multi_trial_overfit_risk": overfit, "triggers": triggers,
    }


def _inspect_transcript_quality(path: Path) -> dict[str, Any]:
    state = _new_session_state()
    try:
        with path.open("r", encoding="utf-8", errors="replace") as fh:
            for line in fh:
                if not line.strip() or len(line) > MAX_LINE_CHARS:
                    continue
                try:
                    obj = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if not isinstance(obj, dict):
                    continue
                for ev in _extract_row_events(obj):
                    kind = ev["kind"]
                    if kind == "tool_call":
                        _handle_tool_call(state, ev)
                    elif kind == "tool_output":
                        _handle_tool_output(state, ev)
                    elif kind == "assistant_text":
                        _handle_assistant_text(state, ev)
    except OSError as error:
        raise SystemExit(f"cannot read transcript {path}: {error}") from None
    return _finalize_session(path, state)


def _collect_scope_values(raw: dict[str, Any], keys: tuple[str, ...], transform) -> set[str]:
    out: set[str] = set()
    for key in keys:
        val = raw.get(key)
        if isinstance(val, str) and val:
            out.add(transform(val))
        elif isinstance(val, list):
            out.update(transform(str(v)) for v in val if v)
    return out


def _normalize_scope_dict(raw: Any) -> dict[str, set[str]]:
    if not isinstance(raw, dict):
        return {"symbols": set(), "executions": set(), "periods": set()}
    syms = _collect_scope_values(raw, ("symbol", "symbols", "instrument", "instruments"), lambda v: v.split(".")[0].upper())
    execs = _collect_scope_values(raw, ("execution", "executions", "execution_mode"), str.lower)
    periods = _collect_scope_values(raw, ("period", "periods", "window", "windows"), str)
    if raw.get("start") and raw.get("end"):
        periods.add(f"{raw['start']}..{raw['end']}")
    return {"symbols": syms, "executions": execs, "periods": periods}


def _ledger_trial_is_failed(trial: dict[str, Any]) -> bool:
    status = str(trial.get("outcome") or trial.get("status") or "").lower()
    if status in ("failed", "rejected", "refused", "below_target", "error"):
        return True
    return trial.get("meets_targets") is False or trial.get("passed") is False


def _ledger_trial_mechanism(trial: dict[str, Any]) -> tuple[str, str, str]:
    raw_cand = str(trial.get("candidate") or trial.get("strategy") or "")
    family = VERSION_SUFFIX_RE.sub("", raw_cand).lower()
    parts: list[str] = []
    for key in ("hypothesis", "mechanism", "conjecture", "description", "difference", "changed_duties"):
        val = trial.get(key)
        if val:
            parts.append(json.dumps(val, sort_keys=True) if isinstance(val, (list, dict)) else str(val))
    mech = _mask_numeric_text(" | ".join(parts)) if parts else ""
    params = trial.get("params") or trial.get("parameters") or trial.get("config") or {}
    skel = _mask_numeric_text(f"{family} {json.dumps(params, sort_keys=True)}")
    return family, mech, skel


def _load_ledger_payload(path: Path) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise SystemExit(f"invalid --ledger-summary {path}: {error}") from None
    if isinstance(raw, list):
        return [t for t in raw if isinstance(t, dict)], {}
    if isinstance(raw, dict):
        seq = raw.get("trials") or raw.get("runs") or raw.get("history") or []
        trials = [t for t in seq if isinstance(t, dict)] if isinstance(seq, list) else []
        return trials, raw
    raise SystemExit(f"invalid --ledger-summary {path}: expected JSON object or array")


def _meta_has_multi_test(meta: dict[str, Any]) -> bool:
    mt = meta.get("multiple_testing")
    return bool(
        meta.get("deflated_sharpe_checked")
        or meta.get("multiple_testing_checked")
        or meta.get("control_comparisons")
        or (isinstance(mt, dict) and mt.get("deflated_sharpe") is not None)
    )


def _inspect_ledger_summary(path: Path) -> dict[str, Any]:
    trials_raw, meta = _load_ledger_payload(path)
    prereg_default = _normalize_scope_dict(meta.get("preregistered_scope"))
    raw_regs = meta.get("registrations")
    prereg_by_id = (
        {str(k): _normalize_scope_dict(v) for k, v in raw_regs.items()}
        if isinstance(raw_regs, dict) else {}
    )
    has_multi_test = _meta_has_multi_test(meta)
    trial_entries: list[dict[str, str]] = []
    line_windows: Counter[str] = Counter()
    pivots = drifts = 0
    prev_failed_unattr = False
    prev_dir_key = ""

    for t in trials_raw:
        family, mech, skel = _ledger_trial_mechanism(t)
        trial_entries.append({"family": family, "mechanism": mech, "skeleton": skel})
        dir_key = f"{family}|{mech}"
        if prev_failed_unattr and dir_key != prev_dir_key:
            pivots += 1
        analyzed = bool(t.get("analyzed") or t.get("report_read") or t.get("attribution") or t.get("judgment"))
        prev_failed_unattr = _ledger_trial_is_failed(t) and not analyzed
        prev_dir_key = dir_key
        if t.get("compared_to_control") or t.get("deflated_sharpe") is not None:
            has_multi_test = True
        declared = prereg_by_id.get(str(t.get("registration") or t.get("registration_id") or ""), prereg_default)
        used = _normalize_scope_dict(t)
        if t.get("prereg_drift") or (any(declared.values()) and _scope_has_drift(declared, used)):
            drifts += 1
        line_k = str(t.get("line") or t.get("research_line") or meta.get("line") or "default")
        win_k = ",".join(sorted(used["periods"])) or str(meta.get("window") or "default")
        line_windows[f"{line_k}|{win_k}"] += 1

    n_trials = len(trial_entries)
    churn_ratio = _compute_param_churn(trial_entries)
    max_same = max(line_windows.values(), default=0)
    overfit = max_same >= OVERFIT_MIN_TRIALS and not has_multi_test
    triggers = _build_quality_triggers(path.name, n_trials, churn_ratio, pivots, drifts, 0, max_same, overfit)
    return {
        "file": path.name, "trial_count": n_trials, "param_churn_ratio": churn_ratio,
        "unattributed_pivot_count": pivots, "prereg_drift_count": drifts,
        "multi_trial_overfit_risk": overfit, "triggers": triggers,
    }


def analyze_research_quality(
    transcript_paths: list[Path] | None = None,
    ledger_summary_paths: list[Path] | None = None,
) -> dict[str, Any]:
    """Compute deterministic research-session quality metrics from transcripts and/or ledger summaries."""
    sessions = [_inspect_transcript_quality(p) for p in (transcript_paths or [])]
    summaries = [_inspect_ledger_summary(p) for p in (ledger_summary_paths or [])]

    all_items = [*[s for s in sessions if s["research_session"]], *summaries]
    triggers = [t for item in all_items for t in item["triggers"]]
    return {
        "research_session_count": sum(1 for s in sessions if s["research_session"]),
        "transcript_count": len(sessions),
        "ledger_summary_count": len(summaries),
        "sessions": sessions,
        "ledger_summaries": summaries,
        "metrics": {
            "max_param_churn_ratio": max((i["param_churn_ratio"] for i in all_items), default=0.0),
            "total_unattributed_pivots": sum(i["unattributed_pivot_count"] for i in all_items),
            "total_prereg_drifts": sum(i["prereg_drift_count"] for i in all_items),
            "total_evidence_gap_claims": sum(s["evidence_gap_claims"] for s in sessions),
            "any_multi_trial_overfit_risk": any(i["multi_trial_overfit_risk"] for i in all_items),
        },
        "triggers": triggers,
    }


def _parse_iso_utc(ts: str) -> datetime | None:
    try:
        dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
        return dt.replace(tzinfo=UTC) if dt.tzinfo is None else dt.astimezone(UTC)
    except ValueError:
        return None


def evaluate_lens_slas(
    scan_items: dict[str, str | None], now_dt: datetime, default_sla_days: int,
    lens_sla_overrides: dict[str, int] | None = None,
) -> tuple[list[dict[str, Any]], list[str], list[str], dict[str, int]]:
    """Rank non-meta lenses using per-lens SLA overrides (e.g. 60d for `methodology`)."""
    overrides = {**LENS_SLA_OVERRIDES, **(lens_sla_overrides or {})}
    rows: list[tuple[tuple[Any, ...], dict[str, Any]]] = []
    breaches: list[str] = []
    overdue_overrides: list[str] = []
    for item, dt in scan_items.items():
        if item in ("fixed", "self"):
            continue
        eff_sla = overrides.get(item, default_sla_days)
        examined_dt = _parse_iso_utc(f"{dt}T00:00:00Z") if dt else None
        stale_days = eff_sla * 2 if examined_dt is None else max(0, int((now_dt - examined_dt).total_seconds() // 86400))
        breach = examined_dt is None or stale_days > eff_sla
        if breach:
            breaches.append(item)
            if item in overrides and examined_dt is not None:
                overdue_overrides.append(item)
        entry = {"item": item, "examined": dt, "sla_days": eff_sla, "stale_days": stale_days, "sla_breach": breach}
        rows.append(((not breach, -(stale_days / max(eff_sla, 1)), dt or "0000-00-00", item), entry))
    rows.sort(key=lambda pair: pair[0])
    return [e for _, e in rows], sorted(breaches), sorted(overdue_overrides), overrides


def has_research_quality_triggers(friction_data: dict[str, Any] | None) -> bool:
    if not friction_data:
        return False
    rq = friction_data.get("research_quality")
    if isinstance(rq, dict) and rq.get("triggers"):
        return True
    return any(str(t).startswith(RESEARCH_QUALITY_PREFIX) for t in (friction_data.get("triggers") or []))


def resolve_friction_targets(
    friction_data: dict[str, Any] | None, tops: dict[str, dict[str, Any]], ranked_objects: list[dict[str, Any]],
) -> tuple[list[str], list[str]]:
    ci_fired = bool(friction_data and friction_data.get("ci") and friction_data["ci"].get("triggers"))
    tx_fired = bool(friction_data and friction_data.get("transcripts") and friction_data["transcripts"].get("triggers"))
    pl_data = friction_data.get("prod_logs") if friction_data else None
    pl_fired = bool(pl_data and pl_data.get("triggers"))
    rq_fired = has_research_quality_triggers(friction_data)
    f_objs: list[str] = []
    f_items: list[str] = []
    if pl_fired and pl_data:
        f_objs.extend(svc for svc in (pl_data.get("affected_services") or []) if svc in tops and svc not in f_objs)
        f_items.append("operation")
    if ci_fired:
        if ".github" in tops and ".github" not in f_objs:
            f_objs.append(".github")
        f_items.append("delivery")
    if rq_fired:
        f_objs.extend(t for t in RESEARCH_QUALITY_TARGETS if t not in f_objs)
        f_items.extend(["agents", "burden"])
    if tx_fired:
        if not rq_fired and ".agents" in tops and ".agents" not in f_objs:
            f_objs.append(".agents")
        f_items.extend(["agents", "burden"])
    if not f_objs and ranked_objects:
        f_objs = [ranked_objects[0]["object"]]
    return f_objs[:3], (list(dict.fromkeys(f_items)) or ["delivery", "agents", "burden"])


def build_friction_summary(
    friction_data: dict[str, Any] | None, friction_obj_cooled: bool,
    has_prod_incident: bool, friction_triggers: list[str], rq_fired: bool,
) -> dict[str, Any]:
    summary: dict[str, Any] = {
        "provided": friction_data is not None,
        "in_cooldown": friction_obj_cooled and not has_prod_incident,
        "prod_incident_active": has_prod_incident,
        "triggers": friction_triggers[:8],
    }
    if friction_data and (isinstance(friction_data.get("research_quality"), dict) or rq_fired):
        rq = friction_data.get("research_quality") if isinstance(friction_data.get("research_quality"), dict) else {}
        summary["research_quality"] = {
            "research_session_count": rq.get("research_session_count", 0),
            "metrics": rq.get("metrics", {}),
            "triggers": list(rq.get("triggers") or [
                t for t in friction_triggers if str(t).startswith(RESEARCH_QUALITY_PREFIX)
            ]),
            "targets": list(RESEARCH_QUALITY_TARGETS) if rq_fired else [],
        }
    return summary
