"""Closed-loop convergence scheduler and stopping controller for product-doctor (v2.2).

Hardened against Round 3B adversarial red-team & longitudinal simulation findings:
- P0-1: `steady` gate cannot be gamed by 0-probe audits, unrefuted bug-heavy audits, partial audits,
  or repeated `steady` records themselves.
- P0-2: `read_audit_history` batch-reads records via `git cat-file --batch` and parses case-insensitive
  headings and `record.md` `| Coverage |` cells (`Partial themed audit:` / `Themed audit:` / `Full audit`).
- P1-2: `structural_decay` requires fixes specifically on unhealthy files (`unhealthy_fixes_short >= 2`);
  when coverage SLA breaches remain, `slim` yields after 1 run instead of 2:1 ping-ponging `find`.
- P1-6: Validates `issues` schema, fixes `last_touch` max(updated, comments), checks body harm for
  unclaimed issues (excluding docs-only typos), widens file citation matching, and expires `claimed` > 2d.
- P2-1: `zero_yield_streak` maps file-level subjects via `owner_fn` and resets immediately on `confirmed > 0`.
"""

from __future__ import annotations

from datetime import UTC, datetime
import math
from pathlib import Path
import re
import subprocess
import sys
from typing import Any

_ASSETS_DIR = str(Path(__file__).resolve().parent)
if _ASSETS_DIR not in sys.path:
    sys.path.insert(0, _ASSETS_DIR)
import prod_invariants  # noqa: E402
import telemetry  # noqa: E402

HARM_RE = re.compile(
    r"\b(live|money|funds?|orders?|fills?|filled|positions?|venue_flat|ledger|"
    r"corrupt(?:s|ed|ing|ion)?|wrong|incorrect|invalid|bypass(?:es|ed|ing)?|refusals?|veto(?:es|ed)?|"
    r"drawdown|equity|security|crash(?:es|ed|ing)?|oom|data loss|silent(?:ly)?|phantom|stops?|stopped|"
    r"voids?|voided|reproduction failure|unfalsified|leaks?|leaked|leaking|drops?|dropped|dropping)\b",
    re.IGNORECASE,
)
SECURITY_RE = re.compile(r"\b(security|credential|secret|token|password|cve|injection|bypass)\b", re.IGNORECASE)
FILE_PATH_RE = re.compile(
    r"\b([a-zA-Z0-9_.-]+(?:/[a-zA-Z0-9_.-]+)+\.(?:py|js|ts|tsx|jsx|mjs|cjs|sh|yml|yaml|go|ini|toml|json|md)"
    r"|[a-zA-Z0-9_.-]+\.(?:ini|toml|yml|yaml|Dockerfile)|[a-zA-Z0-9_.-]*Dockerfile[a-zA-Z0-9_.-]*)\b"
)
SHOWN_RE = re.compile(r"Shown:\s*(\d+)\s+of\s+(\d+)\s+probed")
REFUTED_SHOWN_RE = re.compile(r"Shown by a refuter's own probe too:\s*(\d+)")
REFUTERS_RAN_RE = re.compile(r"Refuters ran on\s*(\d+)")
REFUTER_TABLE_ROW_RE = re.compile(r"^\|[^|\n]+\|[^|\n]+\|[^|\n]+\|[^|\n]+\|[^|\n]+\|[^|\n]+\|\s*([a-z]+)\s*\|$", re.MULTILINE)
THEME_RE = re.compile(
    r"(?:^#\s*|\|\s*Coverage\s*\|[^\n]*?)(Partial\s+)?Themed audit:\s*([a-z]+)",
    re.MULTILINE | re.IGNORECASE,
)
FULL_RE = re.compile(
    r"(?:^#\s*|\|\s*Coverage\s*\|[^\n]*?)(Partial|Full)\s+audit\b",
    re.MULTILINE | re.IGNORECASE,
)
RECORDED_ROW_RE = re.compile(r"^\| ([a-z]+) \| ([^|]+) \| (?:examined|failed) \|", re.MULTILINE)
CLAIM_EXPIRY_SECONDS = 2 * 86400  # record.md: a claim under 2 days old is left alone
PROD_INCIDENT_PREFIXES = (
    "prod_oom_kill",
    "prod_recovery_unavailable",
    "prod_checkpoint_deferred",
    "prod_log_empty",
    "prod_invariant:",
    "prod_state:",
)
REDLINE_PATTERNS: tuple[re.Pattern[str], ...] = (
    # Real orders / live real-account trials.
    re.compile(r"\bprimary\s+(?:live\s+|binance\s+)?(?:account|funds?)\b", re.IGNORECASE),
    re.compile(
        r"\b(?:real|live)\s+orders?\b.{0,40}\b(?:primary|live\s+account|production\s+account|main\s+account|real\s+account)\b",
        re.IGNORECASE,
    ),
    re.compile(r"\b(?:real[\s-]account\s+trial|live\s+real[\s-]account)\b", re.IGNORECASE),
    # Project fonts.
    re.compile(r"\bpp\s+supply\s+mono\b", re.IGNORECASE),
    re.compile(r"\b(?:change|replace|remove|override|swap)\b.{0,30}\b(?:project(?:'s)?\s+)?fonts?\b", re.IGNORECASE),
    # Destructive writes, ledger/artifact/run/catalog/GHCR image deletion.
    re.compile(
        r"\b(?:reset(?:ting)?|clear(?:ing)?|wipe(?:s|d|ing)?|truncat(?:e|es|ed|ing)|delet(?:e|es|ed|ing|ion)|"
        r"rewrit(?:e|es|ing)|drop(?:s|ped|ping)?)\b.{0,45}\b(?:dolt\s+ledger|active\s+ledger|"
        r"ledger\s+(?:history|records?|table)|published\s+records?|stored\s+runs?|sealed\s+artifacts?|"
        r"database\s+backups?|historical\s+receipts?|canonical\s+catalog\s+inputs?|"
        r"retained\s+runtime\s+images?|published\s+image\s+versions?|ghcr\s+(?:images?|versions?)|"
        r"pull\s+request\s+images?)\b",
        re.IGNORECASE,
    ),
    re.compile(r"\b(?:ghcr\s+retention|passes?\s+--delete\s+on\s+the\s+schedule)\b", re.IGNORECASE),
    re.compile(r"\bdestructive\s+(?:write|ledger|history|wipe)\b", re.IGNORECASE),
    # Creating, rebuilding, or switching the active ledger or market directory.
    re.compile(r"\b(?:ledger|market)\s+init\s+--kind\s+active\b", re.IGNORECASE),
    re.compile(
        r"\b(?:rebuild(?:s|ing)?|switch(?:es|ed|ing)?|replac(?:e|es|ed|ing)|recreat(?:e|es|ed|ing)|"
        r"build(?:s|ing)?\s+anew)\b.{0,45}\b(?:active\s+(?:dolt\s+)?(?:ledger|market\s+directory|directory)|"
        r"market\s+directory)\b",
        re.IGNORECASE,
    ),
    re.compile(
        r"\bactive\s+(?:market|ledger)\s+directory\b.{0,45}\b(?:switch(?:es|ed|ing)?|rebuild(?:s|ing)?|"
        r"rebuilt|written|replac(?:e|es|ed|ing)|build\s+anew|made\s+active)\b",
        re.IGNORECASE,
    ),
    re.compile(r"\b(?:directory\s+switch|stored\s+months\s+then\s+recompute|universe_changed)\b", re.IGNORECASE),
    # Adding a stored field / column / table to ledger or record schema (tightened against validation-fix prose).
    re.compile(
        r"\b(?:add(?:s|ed|ing)?|introduc(?:e|es|ed|ing)|creat(?:e|es|ed|ing))\s+"
        r"(?:a\s+|an\s+|the\s+)?(?:new\s+)?stored\s+(?:[a-z0-9_-]+\s+){0,2}(?:field|column|table|value|term)s?\b",
        re.IGNORECASE,
    ),
    re.compile(
        r"\b(?:add(?:s|ed|ing)?|introduc(?:e|es|ed|ing))\s+(?:a\s+|an\s+|the\s+)?(?:new\s+)?"
        r"(?:[a-z0-9_-]+\s+){0,2}(?:column|table|field)s?\s+(?:to|in|into)\s+(?:the\s+)?(?:dolt\s+)?(?:ledger|record|schema)\b",
        re.IGNORECASE,
    ),
    re.compile(r"\bnew\s+stored\s+(?:[a-z0-9_-]+\s+){0,2}(?:field|column|table|value|term)s?\b", re.IGNORECASE),
    # Changing research targets (maximum drawdown target / minimum annual return target).
    re.compile(
        r"\b(?:weaken(?:s|ed|ing)?|relax(?:es|ed|ing)?|loosen(?:s|ed|ing)?|lower(?:s|ed|ing)?|"
        r"rais(?:e|es|ed|ing)|chang(?:e|es|ed|ing))\s+(?:the\s+|either\s+of\s+the\s+|user'?s\s+|owner'?s\s+|current\s+)?"
        r"(?:research\s+targets?|"
        r"(?:max(?:imum)?\s+drawdown|min(?:imum)?\s+annual\s+return)\s+(?:target|threshold|limit|cap|bar|floor|ceiling)s?|"
        r"(?:target|threshold|limit|cap|bar|floor|ceiling)\s+(?:for|of|on)\s+"
        r"(?:max(?:imum)?\s+drawdown|min(?:imum)?\s+annual\s+return))\b",
        re.IGNORECASE,
    ),
    # Restarting Docker Desktop / compose services / terminating host processes / host settings.
    re.compile(
        r"\b(?:start(?:s|ed|ing)?|stop(?:s|ped|ping)?|restart(?:s|ed|ing)?)\b.{0,35}\b"
        r"(?:docker\s+desktop|trade-ide\s+compose|compose\s+services?|host\s+services?)\b",
        re.IGNORECASE,
    ),
    re.compile(r"\bterminat(?:e|es|ed|ing)\s+(?:any\s+|a\s+|the\s+)?host\s+process(?:es)?\b", re.IGNORECASE),
    re.compile(
        r"\b(?:chang(?:e|es|ed|ing)|modif(?:y|ies|ied|ying)|alter(?:s|ed|ing)?)\s+"
        r"(?:the\s+)?(?:docker|system|host)\s+(?:settings?|configuration|config)\b",
        re.IGNORECASE,
    ),
    # Reading or saving credentials (.env, dolt/service.json, exchange keys, cookies, paper token).
    re.compile(
        r"\b(?:read(?:s|ing)?|load(?:s|ed|ing)?|print(?:s|ed|ing)?|dump(?:s|ed|ing)?|fetch(?:es|ed|ing)?|"
        r"extract(?:s|ed|ing)?|save(?:s|d|ing)?|access(?:es|ed|ing)?)\b.{0,45}"
        r"(?:(?<!\w)\.env\b|\bdolt/service\.json\b|\bexchange\s+credentials?\b|"
        r"\bbinance\s+api\s+(?:key|secret)\b|\bbrowser\s+cookies?\b|\bpaper\s+token\b|\bcredentials?\s+directly\b)",
        re.IGNORECASE,
    ),
    # Tagging a release.
    re.compile(r"\b(?:tag(?:s|ged|ging)?\b.{0,25}\brelease\b|\brelease\s+tag\b|\btag\s+v\d+\.\d+\.\d+\b)", re.IGNORECASE),
)
_POLICY_RELAX_RE = re.compile(
    r"\b(?:weaken(?:s|ed|ing)?|relax(?:es|ed|ing)?|loosen(?:s|ed|ing)?|disable|disabling|remove|removing)\b"
    r".{0,35}\b(?:refusal|audit\s+(?:check|gate)|guard|test\s+bar|ci\s+gate)\b",
    re.IGNORECASE,
)
_DEFECT_SUBJECT_RE = re.compile(
    r"\b(?:bug|regression|defect|flaw|fault|missing\s+\w+|omission|broken|typo)\b",
    re.IGNORECASE,
)


def _is_redline_label(labels: set[str]) -> bool:
    return any(
        (low := lbl.lower()) in ("authority:redline", "redline") or low.startswith("authority:redline")
        for lbl in labels
    )


def _has_policy_relaxation(text: str) -> bool:
    for match in _POLICY_RELAX_RE.finditer(text):
        prefix = text[max(0, match.start() - 60):match.start()]
        clause = re.split(r"[\n.;]", prefix)[-1]
        if not _DEFECT_SUBJECT_RE.search(clause):
            return True
    return False


def _is_redline_text(title: str, body: str, comments: list[dict[str, Any]] | None = None) -> bool:
    parts = [title, body]
    if comments:
        parts.extend(str(c.get("body") or "") for c in comments)
    sample = "\n".join(p for p in parts if p)
    return any(pat.search(sample) for pat in REDLINE_PATTERNS) or _has_policy_relaxation(sample)


def _has_prod_incident(friction_triggers: list[str]) -> bool:
    return any(t.startswith(PROD_INCIDENT_PREFIXES) for t in friction_triggers)


def _git(*args: str) -> bytes:
    top = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True, check=False)
    done = subprocess.run(["git", *args], capture_output=True, check=False, cwd=top.stdout.strip() or None)
    if done.returncode:
        raise SystemExit(f"git {' '.join(args)}: {done.stderr.decode().strip()}")
    return done.stdout


def _commit_date(rev: str) -> datetime:
    raw = _git("show", "-s", "--format=%cI", rev).decode().strip()
    return datetime.fromisoformat(raw.replace("Z", "+00:00")).astimezone(UTC)


def _parse_iso(ts: Any) -> datetime | None:
    if not isinstance(ts, str) or not ts:
        return None
    try:
        dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
        return dt.replace(tzinfo=UTC) if dt.tzinfo is None else dt.astimezone(UTC)
    except ValueError:
        return None


def _refuters_ran_count(text: str) -> int:
    m = REFUTERS_RAN_RE.search(text)
    if m:
        return int(m.group(1))
    # Fallback for older records without `Refuters ran on N.`: inspect the `Refuter's probe` table column.
    verdicts = [
        v.lower() for v in REFUTER_TABLE_ROW_RE.findall(text)
        if v.lower() in ("shown", "absent", "broken", "indiscriminate", "uncontrolled")
    ]
    return len(verdicts)


def read_audit_history(rev: str, tracked_paths: dict[str, int],
                       tops: dict[str, dict[str, Any]], owner_fn,
                       records_prefix: str = "docs/plans/doctor/") -> list[dict[str, Any]]:
    """Batch-read dated audit records from `rev` to track recent themes, partial status, yield, and objects."""
    paths = sorted(
        p for p in tracked_paths
        if p.startswith(records_prefix) and p.endswith(".md") and "%" not in p
        and re.fullmatch(r"\d{4}-\d\d-\d\d", Path(p).name[:10])
    )
    if not paths:
        return []
    blobs = telemetry.read_blobs(rev, paths)
    records: list[dict[str, Any]] = []
    for path in paths:
        raw = blobs.get(path)
        if raw is None:
            continue
        text = raw.decode("utf-8", errors="replace")
        date_str = Path(path).name[:10]

        theme_m = THEME_RE.search(text)
        full_m = FULL_RE.search(text)
        if theme_m:
            is_partial = bool(theme_m.group(1))
            theme = theme_m.group(2).lower()
        elif full_m:
            is_partial = full_m.group(1).lower() == "partial"
            theme = "full"
        else:
            is_partial = False
            theme = "focused"

        shown_m = SHOWN_RE.search(text)
        ref_m = REFUTED_SHOWN_RE.search(text)
        shown = int(shown_m.group(1)) if shown_m else None
        probed = int(shown_m.group(2)) if shown_m else None
        refuters_ran = _refuters_ran_count(text)
        if shown is None:
            confirmed = None
        elif ref_m and refuters_ran > 0:
            confirmed = int(ref_m.group(1))
        else:
            # Never treat unrefuted `shown > 0` defects as `confirmed = 0`!
            confirmed = shown

        exercised_objs: set[str] = set()
        exercised_items: set[str] = set()
        for item_name, subj in RECORDED_ROW_RE.findall(text):
            exercised_items.add(item_name)
            named, sep, _ = subj.strip().partition(":")
            if not sep:
                continue
            for part in named.split("+"):
                mapped = owner_fn(part.rstrip("/"), tops)
                if mapped:
                    exercised_objs.add(mapped)

        records.append({
            "path": path,
            "date": date_str,
            "theme": theme,
            "is_partial": is_partial,
            "shown": shown,
            "probed": probed,
            "refuters_ran": refuters_ran,
            "confirmed": confirmed,
            "objects": sorted(exercised_objs),
            "items": sorted(exercised_items),
        })
    return records


def _extract_comments(issue: dict[str, Any]) -> list[dict[str, Any]]:
    raw = issue.get("comments")
    if isinstance(raw, dict):
        nodes = raw.get("nodes")
        return [c for c in nodes if isinstance(c, dict)] if isinstance(nodes, list) else []
    if isinstance(raw, list):
        return [c for c in raw if isinstance(c, dict)]
    return []


def _issue_citations(title: str, body: str, tops: dict[str, dict[str, Any]], tracked_lines: dict[str, int],
                     unique_basenames: dict[str, str], obj_names: list[str], owner_fn) -> tuple[list[str], list[str]]:
    text = f"{title}\n{body}"
    cited_set = {
        raw if (raw in tracked_lines and not telemetry.is_test_path(raw)) else unique_basenames[raw]
        for raw in FILE_PATH_RE.findall(text)
        if (raw in tracked_lines and not telemetry.is_test_path(raw)) or raw in unique_basenames
    }
    cited_files = sorted(cited_set)
    mentioned = sorted({
        *(owner_fn(p, tops) for p in cited_files if owner_fn(p, tops)),
        *(name for name in obj_names if re.search(rf"(?<![\w/-]){re.escape(name)}(?:/|\b)", title)),
    })
    if not mentioned:
        mentioned = sorted({
            name for name in obj_names
            if re.search(rf"(?<![\w/-]){re.escape(name)}(?:/|\b)", body[:600])
        })
    return cited_files, mentioned


def _classify_one_issue(issue: dict[str, Any], tops: dict[str, dict[str, Any]], tracked_lines: dict[str, int],
                        unique_basenames: dict[str, str], obj_names: list[str], object_kinds: dict[str, str],
                        owner_fn, file_latest_ts: dict[str, int], now_ts: int,
                        *, authority_gate: bool = True) -> tuple[list[str], dict[str, Any]]:
    labels = {lbl["name"] if isinstance(lbl, dict) else str(lbl) for lbl in (issue.get("labels") or [])}
    title, body = str(issue.get("title") or ""), str(issue.get("body") or "")
    comments = _extract_comments(issue)
    c_dates = [str(d) for c in comments if (d := c.get("createdAt") or c.get("created_at"))]
    updated = issue.get("updatedAt") or issue.get("updated_at")
    candidates_ts = [str(d) for d in [updated, *c_dates] if d]
    last_touch = max(candidates_ts) if candidates_ts else None
    touch_dt = _parse_iso(last_touch)
    touch_ts = int(touch_dt.timestamp()) if touch_dt else 0

    cited_files, mentioned_objs = _issue_citations(
        title, body, tops, tracked_lines, unique_basenames, obj_names, owner_fn
    )
    entry: dict[str, Any] = {
        "number": issue.get("number"), "title": title, "labels": sorted(labels),
        "objects": mentioned_objs, "cited_files": cited_files[:5], "last_touch": last_touch,
    }
    docs_only = bool(cited_files) and all(
        object_kinds.get(owner_fn(p, tops) or ".", "meta") == "docs" or p.endswith(".md") for p in cited_files
    )
    has_harm_text = bool(HARM_RE.search(title) or HARM_RE.search(body[:600]))
    if docs_only and not SECURITY_RE.search(f"{title}\n{body}"[:600]):
        has_harm_text = False
    is_harm = not title.lower().startswith("minor:") and "enhancement" not in labels and has_harm_text
    has_redline_label = _is_redline_label(labels)
    is_redline = has_redline_label or ("authority" in labels and _is_redline_text(title, body, comments))
    is_auth_blocked = is_redline or (authority_gate and "authority" in labels)

    if "claimed" in labels:
        # Per record.md:24, claims under 2 days old are left alone; older ones are stale.
        claim_age = (now_ts - touch_ts) if touch_ts else CLAIM_EXPIRY_SECONDS + 1
        if claim_age < CLAIM_EXPIRY_SECONDS:
            return ["claimed"], entry
        entry["reason"] = f"stale claim ({claim_age // 86400}d old, >= 2d expiry)"
        buckets = ["stale_claimed"]
        if is_harm and not is_auth_blocked and "needs-evidence" not in labels:
            buckets.append("actionable_harm")
        return buckets, entry

    if is_auth_blocked:
        if is_redline:
            entry["redline"] = True
        changed = [p for p in cited_files if file_latest_ts.get(p, 0) > touch_ts] if touch_ts else []
        if changed and is_harm:
            entry["changed_files"] = changed
            prefix = "irreversible AGENTS.md redline (authority-blocked)" if is_redline else "authority-blocked"
            entry["reason"] = f"{prefix}; cited file(s) changed since last check: {', '.join(changed[:3])}"
            return ["authority_drifted"], entry
        entry["reason"] = (
            "irreversible AGENTS.md redline; waiting on owner authority"
            if is_redline else "waiting on owner authority; cited code unchanged since last check"
        )
        return ["blocked_authority"], entry

    if is_harm and "needs-evidence" not in labels:
        entry["reason"] = "unclaimed actionable harm finding"
        return ["actionable_harm"], entry
    return ["other_open"], entry


def classify_issues(issues: list[dict[str, Any]], tops: dict[str, dict[str, Any]],
                    tracked_lines: dict[str, int], object_kinds: dict[str, str],
                    owner_fn, file_latest_ts: dict[str, int],
                    now_dt: datetime, *, authority_gate: bool = True) -> dict[str, list[dict[str, Any]]]:
    """Partition open `agent-finding` issues into actionable harm, authority-drifted, authority-blocked,
    claimed, stale-claimed, and other. With `authority_gate=False` (full-auto mode), `authority` does not block."""
    if not isinstance(issues, list) or not all(isinstance(item, dict) for item in issues):
        raise SystemExit("--issues-json must contain a JSON array of issue objects")

    buckets: dict[str, list[dict[str, Any]]] = {
        k: [] for k in ("actionable_harm", "authority_drifted", "blocked_authority", "claimed", "stale_claimed", "other_open")
    }
    obj_names = [name for name in tops if name not in (".", "docs", "docs/plans", "changelog.d")]
    basename_map: dict[str, list[str]] = {}
    for p in tracked_lines:
        if not telemetry.is_test_path(p):
            basename_map.setdefault(Path(p).name, []).append(p)
    unique_basenames = {b: ps[0] for b, ps in basename_map.items() if len(ps) == 1}
    now_ts = int(now_dt.timestamp())

    for issue in issues:
        if str(issue.get("state") or "OPEN").upper() == "CLOSED":
            continue
        keys, entry = _classify_one_issue(
            issue, tops, tracked_lines, unique_basenames, obj_names, object_kinds,
            owner_fn, file_latest_ts, now_ts, authority_gate=authority_gate,
        )
        for k in keys:
            buckets[k].append(entry)
    return buckets


def _percentile(values: list[float], pct: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    idx = (len(ordered) - 1) * pct
    lo = int(math.floor(idx))
    hi = min(len(ordered) - 1, lo + 1)
    frac = idx - lo
    return ordered[lo] * (1.0 - frac) + ordered[hi] * frac


def _slim_candidates(telemetry_data: dict[str, Any],
                     last_slimmed: dict[str, str] | None = None) -> tuple[list[dict[str, Any]], list[str], dict[str, int]]:
    """Identify code objects triggering oscillation, test-bloat, structural-decay, or clone-bloat slimming.

    Uses repo-cadence-aware outlier thresholds (`max(floor, p75)`) so high-velocity repos target genuine
    outliers ("well ahead of the rest") while slow repos keep the absolute floor, and applies per-object
    slimming cooldown when no new fix/revert landed after the object's last complete `slim` audit.
    """
    last_slimmed = last_slimmed or {}
    code_objs = [o for o in telemetry_data["objects"].values() if o["kind"] == "code"]
    active_obj_fixes = [float(o["fixes_short"]) for o in code_objs if o["fixes_short"] > 0]
    active_file_fixes = [
        float(max((f["fixes"] + f.get("reverts", 0) for f in o["fix_burst_files"]), default=0))
        for o in code_objs if o["fixes_short"] > 0
    ]
    p75_obj_fixes = _percentile(active_obj_fixes, 0.75)
    p75_file_fixes = _percentile(active_file_fixes, 0.75)
    # Absolute floors preserve sensitivity on quiet repos; p75 scales smoothly on hyper-velocity repos.
    file_burst_bar = max(4, int(math.ceil(p75_file_fixes)))
    severe_burst_bar = max(8, int(math.ceil(p75_file_fixes * 1.5)))
    unhealthy_fix_bar = max(3, int(math.ceil(p75_obj_fixes * 0.5)))

    candidates: list[dict[str, Any]] = []
    cooled_objects: list[str] = []
    for name, obj in telemetry_data["objects"].items():
        if obj["kind"] != "code":
            continue
        # Per-object slim cooldown: skip if already slimmed on/after its latest fix/revert commit.
        slim_date = last_slimmed.get(name)
        if slim_date:
            slim_dt = _parse_iso(f"{slim_date}T23:59:59Z")
            slim_end_ts = int(slim_dt.timestamp()) if slim_dt else 0
            if slim_end_ts and obj.get("latest_fix_ts", 0) <= slim_end_ts:
                cooled_objects.append(name)
                continue

        reasons: list[str] = []
        severity = 0.0
        max_file_touches = max((f["fixes"] + f.get("reverts", 0) for f in obj["fix_burst_files"]), default=0)
        reverts = obj.get("reverts_short", 0)
        if reverts >= 1 or (
            max_file_touches >= file_burst_bar
            and (obj["oscillation_ratio"] >= 2.5 or max_file_touches >= severe_burst_bar or obj["fixes_short"] == max_file_touches)
        ):
            reasons.append(
                f"oscillation_burst (max_file_fixes={max_file_touches}>={file_burst_bar}, reverts={reverts}, "
                f"obj_fixes={obj['fixes_short']}, osc={obj['oscillation_ratio']})"
            )
            severity += max_file_touches * 4.0 + reverts * 6.0 + obj["fixes_short"] * 1.5
        if ((obj["test_to_prod_ratio"] or 0) >= 1.35 and obj["test_net_short"] > 150) or (
            obj["net_short"] <= 0 and obj["test_net_short"] > 300
        ):
            reasons.append(f"test_bloat (test_net={obj['test_net_short']:+d}, prod_net={obj['net_short']:+d}, ratio={obj['test_to_prod_ratio']})")
            severity += min(30.0, obj["test_net_short"] / 50.0)
        unhealthy_fixes = obj.get("unhealthy_fixes_short", 0)
        if obj["break_even_caution"] and obj["min_health"] is not None and unhealthy_fixes >= unhealthy_fix_bar:
            reasons.append(
                f"structural_decay (min_health={obj['min_health']}, max_cognitive={obj['max_cognitive']}, "
                f"unhealthy_fixes={unhealthy_fixes}>={unhealthy_fix_bar})"
            )
            severity += (6.0 - obj["min_health"]) * 5.0 + unhealthy_fixes * 2.0
        if obj["duplicate_fns"] >= 6 and obj["net_short"] > 100:
            reasons.append(f"clone_bloat (duplicate_fns={obj['duplicate_fns']}, net={obj['net_short']:+d})")
            severity += obj["duplicate_fns"] * 1.5

        if reasons:
            candidates.append({
                "object": name,
                "severity": round(severity, 2),
                "reasons": reasons,
                "min_health": obj["min_health"],
                "break_even_caution": obj["break_even_caution"],
                "recommended_strategy": (
                    "seam-and-characterize-first (arXiv:2610.33343: health < 6.0)"
                    if obj["break_even_caution"] else "direct-restate-or-remove"
                ),
                "top_burst_files": obj["fix_burst_files"][:3],
            })
    candidates.sort(key=lambda c: (-c["severity"], c["object"]))
    bars = {
        "file_burst_bar": file_burst_bar,
        "severe_burst_bar": severe_burst_bar,
        "unhealthy_fix_bar": unhealthy_fix_bar,
    }
    return candidates, sorted(cooled_objects), bars


FRICTION_COOLDOWN_DAYS = 7


def _compute_yield_streaks(
    substantive_audits: list[dict[str, Any]],
) -> tuple[dict[str, int], dict[str, int], dict[str, int]]:
    """Compute consecutive zero-yield streaks per object and per lens (resetting on confirmed > 0)."""
    obj_streak: dict[str, int] = {}
    obj_broken: set[str] = set()
    lens_streak: dict[str, int] = {}
    lens_runs: dict[str, int] = {}
    lens_broken: set[str] = set()
    for rec in reversed(substantive_audits[-8:]):
        is_zero = rec["confirmed"] == 0
        for obj in rec["objects"]:
            if obj not in obj_broken:
                if is_zero:
                    obj_streak[obj] = obj_streak.get(obj, 0) + 1
                else:
                    obj_broken.add(obj)
        for item_name in rec.get("items", []):
            lens_runs[item_name] = lens_runs.get(item_name, 0) + 1
            if item_name not in lens_broken:
                if is_zero:
                    lens_streak[item_name] = lens_streak.get(item_name, 0) + 1
                else:
                    lens_broken.add(item_name)
    return obj_streak, lens_streak, lens_runs


def _rank_code_objects(
    telemetry_data: dict[str, Any], scan_objects: dict[str, dict[str, Any]],
    zero_yield_streak: dict[str, int], now_dt: datetime, sla_days: int,
) -> tuple[list[dict[str, Any]], list[str]]:
    ranked: list[dict[str, Any]] = []
    breaches: list[str] = []
    for name, obj in telemetry_data["objects"].items():
        if obj["kind"] != "code":
            continue
        examined_str = scan_objects.get(name, {}).get("examined")
        examined_dt = _parse_iso(f"{examined_str}T00:00:00Z") if examined_str else None
        examined_end = _parse_iso(f"{examined_str}T23:59:59Z") if examined_str else None
        examined_end_ts = int(examined_end.timestamp()) if examined_end else 0
        stale_days = sla_days * 2 if examined_dt is None else max(0, int((now_dt - examined_dt).total_seconds() // 86400))
        breach = examined_dt is None or stale_days > sla_days
        if breach:
            breaches.append(name)
        unchanged = examined_dt is not None and not breach and obj.get("latest_code_ts", 0) <= examined_end_ts
        raw_risk = (
            math.log1p(obj["abs_churn_short"]) * 1.5
            + (obj["fixes_short"] + obj.get("reverts_short", 0)) * 2.5
            + len(obj["fix_burst_files"]) * 4.0
            + max(0, obj["max_cognitive"] - 15) * 0.25
        )
        # Drop risk prior to 0 once examined on/after its latest code commit (prevents re-auditing unchanged hotspots).
        risk_prior = 0.0 if unchanged else raw_risk
        staleness_bonus = min(stale_days, sla_days * 2) * (1.2 if breach else 0.35)
        saturation_pen = zero_yield_streak.get(name, 0) * 6.0
        ranked.append({
            "object": name, "score": round(risk_prior + staleness_bonus - saturation_pen, 2),
            "risk_prior": round(risk_prior, 2), "unchanged_since_examined": unchanged,
            "staleness_days": stale_days, "examined": examined_str, "staleness_breach": breach,
            "saturation_penalty": round(saturation_pen, 2), "commits_long": obj["commits_long"],
            "fixes_short": obj["fixes_short"], "abs_churn_short": obj["abs_churn_short"],
            "min_health": obj["min_health"],
        })
    ranked.sort(key=lambda r: (-r["score"], r["object"]))
    return ranked, breaches


def _friction_targets(
    friction_data: dict[str, Any] | None, tops: dict[str, dict[str, Any]], ranked_objects: list[dict[str, Any]],
) -> tuple[list[str], list[str]]:
    data = friction_data or {}
    f_objs: list[str] = []
    f_items: list[str] = []
    sources = (
        ("prod_state_summary", "affected_objects", ["operation"]),
        ("prod_logs", "affected_services", ["operation"]),
        ("ci", None, ["delivery"]),
        ("transcripts", None, ["agents", "burden"]),
    )
    static_map = {"ci": [".github"], "transcripts": [".agents"]}
    for key, obj_key, items in sources:
        sec = data.get(key)
        if not (isinstance(sec, dict) and sec.get("triggers")):
            continue
        names = (sec.get(obj_key) or []) if obj_key else static_map[key]
        f_objs.extend(n for n in names if n in tops and n not in f_objs)
        f_items.extend(items)
    if not f_objs and ranked_objects:
        f_objs = [ranked_objects[0]["object"]]
    return f_objs[:3], (list(dict.fromkeys(f_items)) or ["delivery", "agents", "burden"])


def _friction_is_object_cooled(
    target_objs: list[str], last_friction_zero: dict[str, str], now_dt: datetime,
) -> bool:
    if not target_objs:
        return False
    for obj in target_objs:
        dt_str = last_friction_zero.get(obj)
        if not dt_str:
            return False
        dt = _parse_iso(f"{dt_str}T00:00:00Z")
        if dt is None or (now_dt - dt).total_seconds() > FRICTION_COOLDOWN_DAYS * 86400:
            return False
    return True


def _pick_find_objects(ranked_objects: list[dict[str, Any]], tops: dict[str, dict[str, Any]] | None = None) -> list[str]:
    picked: list[str] = []
    actionable_pool = [r for r in ranked_objects if r["staleness_breach"] or not r["unchanged_since_examined"]]
    pool = actionable_pool or ranked_objects
    if pool:
        picked.append(pool[0]["object"])
    cold_stale = sorted(
        [r for r in ranked_objects if r["staleness_breach"] and r["object"] not in picked],
        key=lambda r: (r["examined"] or "0000-00-00", r["commits_long"], r["object"]),
    )
    if cold_stale:
        picked.append(cold_stale[0]["object"])
    elif len(pool) > 1:
        picked.append(pool[1]["object"])
    if not picked and tops:
        non_root = [n for n in sorted(tops) if n != "."]
        picked = non_root[:2] or sorted(tops)[:1]
    return picked[:3]


def _select_theme_and_scope(
    issue_buckets: dict[str, list[dict[str, Any]]], slim_list: list[dict[str, Any]],
    friction_triggers: list[str], friction_objs: list[str], friction_items: list[str],
    slim_cooled_down: bool, friction_cooled_down: bool, can_steady: bool,
    ranked_objects: list[dict[str, Any]], stalest_items: list[tuple[str, str]],
    staleness_breaches: list[str], sla_days: int, tops: dict[str, dict[str, Any]] | None = None,
    has_prod_incident: bool = False,
) -> tuple[str, list[str], list[str], str]:
    if issue_buckets["actionable_harm"]:
        objs = sorted({o for iss in issue_buckets["actionable_harm"] for o in iss["objects"]})[:3]
        if not objs and ranked_objects:
            objs = [ranked_objects[0]["object"]]
        rat = (
            f"{len(issue_buckets['actionable_harm'])} actionable harm finding(s) require verification "
            f"({len(issue_buckets['blocked_authority'])} unchanged authority-blocked and "
            f"{len(issue_buckets['authority_drifted'])} drifted authority issue(s) excluded)."
        )
        return "harm", objs, [], rat
    if has_prod_incident:
        prod_trigs = [t for t in friction_triggers if t.startswith(PROD_INCIDENT_PREFIXES)]
        rat = (
            f"{len(prod_trigs)} active production operational incident(s) preempt cooldown/steady: "
            f"{'; '.join(prod_trigs[:3])}."
        )
        return "friction", friction_objs, friction_items, rat
    if slim_list and not slim_cooled_down:
        rat = (
            f"{len(slim_list)} code object(s) hit anti-bloat/oscillation thresholds; top: "
            f"{slim_list[0]['object']} ({'; '.join(slim_list[0]['reasons'])})."
        )
        return "slim", [c["object"] for c in slim_list[:2]], ["structure", "size", "checks"], rat
    if friction_triggers and not friction_cooled_down:
        rat = f"{len(friction_triggers)} deterministic friction signal(s) detected: {'; '.join(friction_triggers[:3])}."
        return "friction", friction_objs, friction_items, rat
    if can_steady:
        if friction_triggers:
            rat = (
                f"All code objects are fresh (<= {sla_days}d SLA) and unchanged with saturated yield; "
                f"active friction target(s) are in {FRICTION_COOLDOWN_DAYS}d zero-yield cooldown. "
                "Stop and wait until cooldown expires, friction changes, or code changes."
            )
        else:
            rat = (
                "All convergence gates hold: 0 actionable harm, 0 slim/oscillation triggers, "
                f"0 coverage SLA breaches (<= {sla_days}d), and saturated marginal discovery yield across "
                "substantive complete audits. Stop and cooldown instead of manufacturing low-value findings."
            )
        return "steady", [], [], rat
    objs = _pick_find_objects(ranked_objects, tops)
    chosen_items = [item for item, _ in stalest_items[:3]]
    cooldown_note = " (`slim` in cooldown while SLA breaches remain)" if slim_list and slim_cooled_down else ""
    if staleness_breaches:
        sla_note = (
            f"{len(staleness_breaches)} code object(s) exceed {sla_days}d coverage SLA. "
            "Pairing top fresh risk/churn object with coldest unexamined object."
        )
    else:
        sla_note = (
            f"All code objects are within {sla_days}d coverage SLA; "
            "auditing highest-priority fresh/recent-change objects until marginal yield saturates."
        )
    rat = f"0 actionable harm ({len(issue_buckets['blocked_authority'])} authority-blocked excluded){cooldown_note}; {sla_note}"
    return "find", objs, chosen_items, rat


def _extract_cooldown_dates(records: list[dict[str, Any]]) -> tuple[dict[str, str], dict[str, str]]:
    last_slimmed: dict[str, str] = {}
    last_friction_zero: dict[str, str] = {}
    for rec in records:
        if rec["is_partial"]:
            continue
        if rec["theme"] == "slim":
            for obj in rec["objects"]:
                if rec["date"] > last_slimmed.get(obj, ""):
                    last_slimmed[obj] = rec["date"]
        elif rec["theme"] == "friction" and rec["confirmed"] == 0:
            for obj in rec["objects"]:
                if rec["date"] > last_friction_zero.get(obj, ""):
                    last_friction_zero[obj] = rec["date"]
    return last_slimmed, last_friction_zero


def _compute_gates(
    issues_provided: bool, issue_buckets: dict[str, list[dict[str, Any]]],
    slim_list: list[dict[str, Any]], friction_triggers: list[str], friction_obj_cooled: bool,
    staleness_breaches: list[str], ranked_objects: list[dict[str, Any]],
    substantive_audits: list[dict[str, Any]], last_two_themes: list[str],
    telemetry_data: dict[str, Any], *, has_prod_incident: bool = False,
) -> tuple[dict[str, bool], bool, bool, bool]:
    last_two_sub = substantive_audits[-2:]
    recent_confirmed = sum(r["confirmed"] for r in last_two_sub) if len(last_two_sub) >= 2 else None
    any_recent_bugs = any((r["confirmed"] or 0) > 0 for r in last_two_sub)
    code_commits_short = sum(o["commits_short"] for o in telemetry_data["objects"].values() if o["kind"] == "code")
    stopping_checks = {
        "issues_provided": issues_provided,
        "no_actionable_harm": len(issue_buckets["actionable_harm"]) == 0,
        "no_slim_triggers": len(slim_list) == 0,
        "no_friction_triggers": len(friction_triggers) == 0,
        "no_staleness_breaches": len(staleness_breaches) == 0,
        "marginal_yield_saturated": (
            (recent_confirmed == 0)
            or (code_commits_short < 5 and len(staleness_breaches) == 0 and not any_recent_bugs and len(last_two_sub) >= 1)
        ),
    }
    non_find_pair = len(last_two_themes) == 2 and all(t in ("slim", "friction") for t in last_two_themes)
    slim_cooled = (("slim" in last_two_themes or non_find_pair) and bool(staleness_breaches)) or last_two_themes == ["slim", "slim"]
    fric_cooled = (
        not has_prod_incident
        and (
            friction_obj_cooled
            or (("friction" in last_two_themes or non_find_pair) and bool(staleness_breaches))
            or last_two_themes == ["friction", "friction"]
        )
    )
    all_unchanged = all(r["unchanged_since_examined"] for r in ranked_objects)
    non_fric_ready = all(v for k, v in stopping_checks.items() if k != "no_friction_triggers")
    can_steady = all(stopping_checks.values()) or (
        bool(friction_triggers)
        and not has_prod_incident
        and friction_obj_cooled
        and non_fric_ready
        and all_unchanged
    )
    return stopping_checks, slim_cooled, fric_cooled, can_steady


def advise(rev: str, tops: dict[str, dict[str, Any]], tracked_lines: dict[str, int],
           scan_objects: dict[str, dict[str, Any]], scan_items: dict[str, str | None],
           telemetry_data: dict[str, Any], owner_fn, *,
           issues: list[dict[str, Any]] | None = None,
           friction_data: dict[str, Any] | None = None,
           sla_days: int = 21,
           authority_gate: bool = True) -> dict[str, Any]:
    """Compute the closed-loop audit recommendation, priority table, and stopping decision."""
    now_dt = _commit_date(rev)
    records = read_audit_history(rev, tracked_lines, tops, owner_fn)
    themed_records = [r for r in records if r["theme"] in ("harm", "slim", "find", "friction", "steady")]
    last_two_themes = [r["theme"] for r in themed_records[-2:]]

    substantive_audits = [
        r for r in records
        if r["theme"] != "steady" and not r["is_partial"] and r["confirmed"] is not None
        and ((r["probed"] or 0) >= 1 or (r["shown"] == 0 and len(r["objects"]) >= 1))
    ]
    zero_yield_streak, lens_zero_streak, lens_runs = _compute_yield_streaks(substantive_audits)
    last_slimmed, last_friction_zero = _extract_cooldown_dates(records)

    object_kinds = {name: obj["kind"] for name, obj in telemetry_data["objects"].items()}
    issue_buckets = classify_issues(
        issues if issues is not None else [], tops, tracked_lines, object_kinds,
        owner_fn, telemetry_data.get("_file_latest_ts", {}), now_dt, authority_gate=authority_gate,
    )
    slim_list, slim_cooled_objects, dynamic_bars = _slim_candidates(telemetry_data, last_slimmed=last_slimmed)
    ranked_objects, staleness_breaches = _rank_code_objects(
        telemetry_data, scan_objects, zero_yield_streak, now_dt, sla_days
    )
    stalest_items = sorted(
        [(item, dt or "0000-00-00") for item, dt in scan_items.items() if item not in ("fixed", "self")],
        key=lambda pair: (pair[1], pair[0]),
    )
    friction_triggers = list(friction_data.get("triggers", [])) if friction_data else []
    has_prod_incident = _has_prod_incident(friction_triggers)
    friction_objs, friction_items = _friction_targets(friction_data, tops, ranked_objects)
    friction_obj_cooled = _friction_is_object_cooled(friction_objs, last_friction_zero, now_dt)

    stopping_checks, slim_cooled_down, friction_cooled_down, can_steady = _compute_gates(
        issues is not None, issue_buckets, slim_list, friction_triggers, friction_obj_cooled,
        staleness_breaches, ranked_objects, substantive_audits, last_two_themes, telemetry_data,
        has_prod_incident=has_prod_incident,
    )
    theme, chosen_objs, chosen_items, rationale = _select_theme_and_scope(
        issue_buckets, slim_list, friction_triggers, friction_objs, friction_items,
        slim_cooled_down, friction_cooled_down, can_steady,
        ranked_objects, stalest_items, staleness_breaches, sla_days, tops=tops,
        has_prod_incident=has_prod_incident,
    )
    coupled_contracts = [
        c for c in telemetry_data["couplings"]
        if any(obj in c["pair"].split("+") for obj in chosen_objs)
    ][:3]

    return {
        "tree": rev, "as_of": now_dt.strftime("%Y-%m-%dT%H:%M:%SZ"), "sla_days": sla_days,
        "auto_mode": not authority_gate,
        "recommended_theme": theme, "rationale": rationale,
        "recommended_scope": {"theme": theme, "objects": chosen_objs, "items": chosen_items, "coupled_contracts": coupled_contracts},
        "stopping_checks": stopping_checks, "last_two_themes": last_two_themes, "dynamic_bars": dynamic_bars,
        "issues_summary": {
            "provided": issues is not None, "actionable_harm": issue_buckets["actionable_harm"][:10],
            "authority_drifted": issue_buckets["authority_drifted"][:10], "stale_claimed": issue_buckets["stale_claimed"][:10],
            "blocked_authority_count": len(issue_buckets["blocked_authority"]),
            "claimed_count": len(issue_buckets["claimed"]), "other_open_count": len(issue_buckets["other_open"]),
        },
        "slim_total_count": len(slim_list), "slim_cooled_objects": slim_cooled_objects, "slim_candidates": slim_list[:6],
        "friction_summary": {
            "provided": friction_data is not None,
            "in_cooldown": friction_obj_cooled and not has_prod_incident,
            "prod_incident_active": has_prod_incident,
            "prod_state_summary": prod_invariants.compact_summary(friction_data),
            "triggers": friction_triggers[:8],
        },
        "staleness_breach_count": len(staleness_breaches), "ranked_code_objects": ranked_objects[:12],
        "stalest_items": [{"item": i, "examined": None if d == "0000-00-00" else d} for i, d in stalest_items[:8]],
        "low_yield_lenses": [
            {"item": item, "zero_yield_streak": streak, "recent_runs": lens_runs.get(item, 0)}
            for item, streak in sorted(lens_zero_streak.items(), key=lambda p: (-p[1], p[0])) if streak >= 2
        ],
        "next_trigger_if_steady": (
            "Re-enter audit when a new unclaimed harm finding opens, a code object hits >=3 fix commits "
            f"in {telemetry_data['days']}d, a dependency/release changes, or an object exceeds {sla_days}d SLA."
        ),
    }
