"""Closed-loop convergence scheduler and stopping controller for product-doctor.

Routes audits across Harm -> Prod Incident -> Slim -> Friction -> Steady -> Find using deterministic
git telemetry, issue labels (`authority` / `authority:redline`), audit history, per-lens SLA overrides,
and saturation stopping checks. Pure Python standard library.
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
HEADING_THEME_RE = re.compile(r"^#\s*(Partial\s+)?Themed audit:\s*([a-z]+)\b", re.MULTILINE | re.IGNORECASE)
HEADING_FULL_RE = re.compile(r"^#\s*(Partial|Full)\s+audit\b", re.MULTILINE | re.IGNORECASE)
COVERAGE_ROW_RE = re.compile(r"^\|\s*Coverage\s*\|\s*([^\n|]+)", re.MULTILINE | re.IGNORECASE)
CELL_THEME_RE = re.compile(r"\b(Partial\s+)?Themed audit:\s*([a-z]+)\b", re.IGNORECASE)
CELL_FULL_RE = re.compile(r"\b(Partial|Full)\s+audit\b", re.IGNORECASE)
RECORDED_ROW_RE = re.compile(r"^\| ([a-z]+) \| ([^|]+) \| (?:examined|failed) \|", re.MULTILINE)

CLAIM_EXPIRY_SECONDS = 2 * 86400  # record.md: a claim under 2 days old is left alone
FRICTION_COOLDOWN_DAYS = 7
LENS_SLA_OVERRIDES: dict[str, int] = {"methodology": 60}
PROD_INCIDENT_PREFIXES = (
    "prod_oom_kill",
    "prod_recovery_unavailable",
    "prod_checkpoint_deferred",
    "prod_log_empty",
)


def _is_redline_label(labels: set[str]) -> bool:
    return any(
        (low := lbl.lower()) in ("authority:redline", "redline") or low.startswith("authority:redline")
        for lbl in labels
    )


def _has_authority_label(labels: set[str]) -> bool:
    return any(
        (low := lbl.lower()) == "authority" or low.startswith("authority:")
        for lbl in labels
    )


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
    verdicts = [
        v.lower() for v in REFUTER_TABLE_ROW_RE.findall(text)
        if v.lower() in ("shown", "absent", "broken", "indiscriminate", "uncontrolled")
    ]
    return len(verdicts)


def _classify_record_header(path: str, text: str) -> tuple[str, bool]:
    """Classify an audit record's (theme, is_partial) without letting quoted prose override partial."""
    fname_partial = "-partial-" in Path(path).name.lower()
    cov_m = COVERAGE_ROW_RE.search(text)
    cov_cell = cov_m.group(1).strip() if cov_m else ""
    first_heading = text.lstrip().splitlines()[0] if text.strip() else ""
    heading_partial = bool(re.match(r"^#\s*.*(?:\bPartial\b|覆盖不全)", first_heading, re.IGNORECASE))
    cov_partial = bool(re.search(r"\bPartial\b|覆盖不全", cov_cell, re.IGNORECASE))

    h_theme = HEADING_THEME_RE.search(text)
    c_theme = CELL_THEME_RE.search(cov_cell)
    h_full = HEADING_FULL_RE.search(text)
    c_full = CELL_FULL_RE.search(cov_cell)

    if h_theme or c_theme:
        m = h_theme or c_theme
        assert m is not None
        is_partial = fname_partial or heading_partial or cov_partial or bool(m.group(1))
        return m.group(2).lower(), is_partial
    if h_full or c_full:
        m = h_full or c_full
        assert m is not None
        is_partial = fname_partial or heading_partial or cov_partial or (m.group(1).lower() == "partial")
        return "full", is_partial
    if fname_partial or heading_partial or cov_partial:
        return "full", True
    return "focused", False


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
        theme, is_partial = _classify_record_header(path, text)

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
            confirmed = shown

        exercised_objs: set[str] = set()
        exercised_items: set[str] = set()
        for item_name, subj in RECORDED_ROW_RE.findall(text):
            exercised_items.add(item_name)
            raw_subj = subj.strip()
            if ":" in raw_subj:
                named, _, _ = raw_subj.partition(":")
                for part in named.split("+"):
                    mapped = owner_fn(part.rstrip("/"), tops)
                    if mapped:
                        exercised_objs.add(mapped)
            else:
                bare = raw_subj.rstrip("/")
                if bare in tops:
                    exercised_objs.add(bare)

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
    is_redline = _is_redline_label(labels)
    is_auth_blocked = is_redline or (authority_gate and _has_authority_label(labels))

    if "claimed" in labels:
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
    claimed, stale-claimed, and other. Rely on `authority` / `authority:redline` labels for gating."""
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
    """Identify code objects triggering oscillation, test-bloat, structural-decay, or clone-bloat slimming."""
    last_slimmed = last_slimmed or {}
    code_objs = [o for o in telemetry_data["objects"].values() if o["kind"] == "code"]
    active_obj_fixes = [float(o["fixes_short"]) for o in code_objs if o["fixes_short"] > 0]
    active_file_fixes = [
        float(max((f["fixes"] + f.get("reverts", 0) for f in o["fix_burst_files"]), default=0))
        for o in code_objs if o["fixes_short"] > 0
    ]
    p75_obj_fixes = _percentile(active_obj_fixes, 0.75)
    p75_file_fixes = _percentile(active_file_fixes, 0.75)
    file_burst_bar = max(4, int(math.ceil(p75_file_fixes)))
    severe_burst_bar = max(8, int(math.ceil(p75_file_fixes * 1.5)))
    unhealthy_fix_bar = max(3, int(math.ceil(p75_obj_fixes * 0.5)))

    candidates: list[dict[str, Any]] = []
    cooled_objects: list[str] = []
    for name, obj in telemetry_data["objects"].items():
        if obj["kind"] != "code":
            continue
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
                    "characterize-before-refactor (heuristic health < 6.0)"
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


def evaluate_lens_slas(
    scan_items: dict[str, str | None], now_dt: datetime, default_sla_days: int,
    lens_sla_overrides: dict[str, int] | None = None,
) -> tuple[list[dict[str, Any]], list[str], list[str], dict[str, int]]:
    """Rank non-meta lenses using per-lens SLA overrides (e.g. 60d for `methodology`).

    A never-examined override lens (`examined is None`) counts as overdue so `no_overdue_lens_sla`
    is consistently `False` whenever `lens_sla_breaches` contains an override lens.
    """
    overrides = {**LENS_SLA_OVERRIDES, **(lens_sla_overrides or {})}
    rows: list[tuple[tuple[Any, ...], dict[str, Any]]] = []
    breaches: list[str] = []
    overdue_overrides: list[str] = []
    for item, dt in scan_items.items():
        if item in ("fixed", "self"):
            continue
        eff_sla = overrides.get(item, default_sla_days)
        examined_dt = _parse_iso(f"{dt}T00:00:00Z") if dt else None
        stale_days = eff_sla * 2 if examined_dt is None else max(0, int((now_dt - examined_dt).total_seconds() // 86400))
        breach = examined_dt is None or stale_days > eff_sla
        if breach:
            breaches.append(item)
            if item in overrides:
                overdue_overrides.append(item)
        entry = {"item": item, "examined": dt, "sla_days": eff_sla, "stale_days": stale_days, "sla_breach": breach}
        rows.append(((not breach, -(stale_days / max(eff_sla, 1)), dt or "0000-00-00", item), entry))
    rows.sort(key=lambda pair: pair[0])
    return [e for _, e in rows], sorted(breaches), sorted(overdue_overrides), overrides


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
    pl_data = data.get("prod_logs")
    if isinstance(pl_data, dict) and pl_data.get("triggers"):
        prod_objs = [n for n in (pl_data.get("affected_services") or []) if n in tops]
        if not prod_objs and ranked_objects:
            prod_objs = [ranked_objects[0]["object"]]
        return prod_objs[:3], ["operation"]
    ci_fired = bool(isinstance(data.get("ci"), dict) and data["ci"].get("triggers"))
    tx_fired = bool(isinstance(data.get("transcripts"), dict) and data["transcripts"].get("triggers"))
    f_objs: list[str] = []
    f_items: list[str] = []
    if ci_fired:
        if ".github" in tops:
            f_objs.append(".github")
        f_items.append("delivery")
    if tx_fired:
        if ".agents" in tops and ".agents" not in f_objs:
            f_objs.append(".agents")
        f_items.extend(["agents", "burden"])
    if not f_objs and ranked_objects:
        f_objs = [ranked_objects[0]["object"]]
    return f_objs[:3], (list(dict.fromkeys(f_items)) or ["delivery", "agents", "burden"])


def _friction_is_object_cooled(
    target_objs: list[str], last_friction_zero: dict[str, str], now_dt: datetime,
    tops: dict[str, dict[str, Any]] | None = None, owner_fn=None,
) -> bool:
    if not target_objs:
        return False
    for obj in target_objs:
        dt_str = last_friction_zero.get(obj)
        if not dt_str and tops is not None and owner_fn is not None:
            mapped = owner_fn(obj, tops)
            dt_str = last_friction_zero.get(mapped) if mapped else None
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
    ranked_objects: list[dict[str, Any]], stalest_items: list[dict[str, Any]],
    staleness_breaches: list[str], sla_days: int, tops: dict[str, dict[str, Any]] | None = None,
    has_prod_incident: bool = False, overdue_override_lenses: list[str] | None = None,
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
    chosen_items = list(dict.fromkeys([
        *(overdue_override_lenses or []),
        *(entry["item"] for entry in stalest_items),
    ]))[:3]
    cooldown_note = " (`slim` in cooldown while SLA breaches remain)" if slim_list and slim_cooled_down else ""
    if staleness_breaches:
        sla_note = (
            f"{len(staleness_breaches)} code object(s) exceed {sla_days}d coverage SLA. "
            "Pairing top fresh risk/churn object with coldest unexamined object."
        )
    elif overdue_override_lenses:
        sla_note = (
            f"{len(overdue_override_lenses)} low-frequency lens(es) exceeded per-lens SLA "
            f"({', '.join(overdue_override_lenses)})."
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
    overdue_override_lenses: list[str] | None = None,
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
        "no_overdue_lens_sla": not overdue_override_lenses,
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
           authority_gate: bool = True,
           lens_sla_overrides: dict[str, int] | None = None) -> dict[str, Any]:
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
    stalest_items, lens_sla_breaches, overdue_override_lenses, effective_lens_slas = evaluate_lens_slas(
        scan_items, now_dt, sla_days, lens_sla_overrides=lens_sla_overrides
    )
    friction_triggers = list(friction_data.get("triggers", [])) if friction_data else []
    has_prod_incident = _has_prod_incident(friction_triggers)
    friction_objs, friction_items = _friction_targets(friction_data, tops, ranked_objects)
    friction_obj_cooled = _friction_is_object_cooled(
        friction_objs, last_friction_zero, now_dt, tops=tops, owner_fn=owner_fn
    )

    stopping_checks, slim_cooled_down, friction_cooled_down, can_steady = _compute_gates(
        issues is not None, issue_buckets, slim_list, friction_triggers, friction_obj_cooled,
        staleness_breaches, ranked_objects, substantive_audits, last_two_themes, telemetry_data,
        has_prod_incident=has_prod_incident, overdue_override_lenses=overdue_override_lenses,
    )
    theme, chosen_objs, chosen_items, rationale = _select_theme_and_scope(
        issue_buckets, slim_list, friction_triggers, friction_objs, friction_items,
        slim_cooled_down, friction_cooled_down, can_steady,
        ranked_objects, stalest_items, staleness_breaches, sla_days, tops=tops,
        has_prod_incident=has_prod_incident, overdue_override_lenses=overdue_override_lenses,
    )
    coupled_contracts = [c for c in telemetry_data["couplings"] if any(obj in c["pair"].split("+") for obj in chosen_objs)][:3]
    friction_summary = {
        "provided": friction_data is not None,
        "in_cooldown": friction_obj_cooled and not has_prod_incident,
        "prod_incident_active": has_prod_incident,
        "triggers": friction_triggers[:8],
    }

    return {
        "tree": rev, "as_of": now_dt.strftime("%Y-%m-%dT%H:%M:%SZ"), "sla_days": sla_days,
        "lens_sla_overrides": effective_lens_slas, "auto_mode": not authority_gate,
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
        "friction_summary": friction_summary,
        "staleness_breach_count": len(staleness_breaches), "ranked_code_objects": ranked_objects[:12],
        "lens_sla_breaches": lens_sla_breaches, "stalest_items": stalest_items[:8],
        "low_yield_lenses": [
            {"item": item, "zero_yield_streak": streak, "recent_runs": lens_runs.get(item, 0)}
            for item, streak in sorted(lens_zero_streak.items(), key=lambda p: (-p[1], p[0])) if streak >= 2
        ],
        "next_trigger_if_steady": (
            "Re-enter audit when a new unclaimed harm finding opens, a code object hits >=3 fix commits "
            f"in {telemetry_data['days']}d, a dependency/release changes, or an object exceeds {sla_days}d SLA."
        ),
    }
