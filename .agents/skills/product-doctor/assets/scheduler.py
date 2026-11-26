"""Closed-loop convergence scheduler and stopping controller for product-doctor.

Implements the #3785 control plane on top of deterministic `scan` and `telemetry` outputs:
1. File-precise actionable harm filter: excludes claimed issues and `authority`-blocked issues
   unless their *specifically referenced files* (not merely any sibling in the same package) changed
   after the last triage/comment timestamp.
2. Oscillation & anti-bloat `slim` triggers with `arXiv:2610.33343` break-even guidance.
3. Backtest-calibrated bandit + staleness-SLA scorer pairing high-risk hotspots with the coldest
   unexamined code objects, plus cross-package `A+B` coupled contract recommendations.
4. First-class `steady` (cooldown) stopping criterion when actionable harm = 0, no slim/oscillation
   trigger fires, coverage SLA holds, and marginal audit yield is saturated.
"""

from __future__ import annotations

from datetime import UTC, datetime
import math
from pathlib import Path
import re
import subprocess
from typing import Any

HARM_RE = re.compile(
    r"\b(live|money|fund|order|fill|position|venue_flat|ledger|corrupt|wrong|incorrect|invalid|"
    r"bypass|refusal|veto|drawdown|equity|security|crash|oom|data loss|silent|phantom|stop|"
    r"voids|reproduction failure|unfalsified|leak|drop)\b",
    re.IGNORECASE,
)
FILE_PATH_RE = re.compile(r"\b([a-zA-Z0-9_.-]+(?:/[a-zA-Z0-9_.-]+)+\.(?:py|js|ts|tsx|sh|yml|yaml))\b")
SHOWN_RE = re.compile(r"Shown:\s*(\d+)\s+of\s+(\d+)\s+probed")
REFUTED_SHOWN_RE = re.compile(r"Shown by a refuter's own probe too:\s*(\d+)")
THEME_RE = re.compile(r"^#\s*(?:Partial\s+)?Themed audit:\s*([a-z]+)", re.MULTILINE)
FULL_RE = re.compile(r"^#\s*(?:Partial|Full)\s+audit\b", re.MULTILINE)
RECORDED_ROW_RE = re.compile(r"^\| ([a-z]+) \| ([^|]+) \| (?:examined|failed) \|", re.MULTILINE)


def _git(*args: str) -> bytes:
    top = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True, check=False)
    done = subprocess.run(["git", *args], capture_output=True, check=False, cwd=top.stdout.strip() or None)
    if done.returncode:
        raise SystemExit(f"git {' '.join(args)}: {done.stderr.decode().strip()}")
    return done.stdout


def _commit_date(rev: str) -> datetime:
    raw = _git("show", "-s", "--format=%cI", rev).decode().strip()
    return datetime.fromisoformat(raw.replace("Z", "+00:00")).astimezone(UTC)


def _parse_iso(ts: str | None) -> datetime | None:
    if not ts:
        return None
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00")).astimezone(UTC)
    except ValueError:
        return None


def read_audit_history(rev: str, tracked_paths: dict[str, int],
                       records_prefix: str = "docs/plans/doctor/") -> list[dict[str, Any]]:
    """Parse dated audit records from `rev` to track recent themes, probed yield, and examined objects."""
    records: list[dict[str, Any]] = []
    paths = sorted(p for p in tracked_paths if p.startswith(records_prefix) and p.endswith(".md") and "%" not in p)
    for path in paths:
        date_str = Path(path).name[:10]
        if not re.fullmatch(r"\d{4}-\d\d-\d\d", date_str):
            continue
        text = _git("show", f"{rev}:{path}").decode(errors="replace")
        theme_m = THEME_RE.search(text)
        theme = theme_m.group(1) if theme_m else ("full" if FULL_RE.search(text) else "focused")
        shown_m = SHOWN_RE.search(text)
        ref_m = REFUTED_SHOWN_RE.search(text)
        shown = int(shown_m.group(1)) if shown_m else None
        probed = int(shown_m.group(2)) if shown_m else None
        confirmed = int(ref_m.group(1)) if ref_m else shown
        exercised_objs = sorted({
            subj.strip().partition(":")[0]
            for _, subj in RECORDED_ROW_RE.findall(text)
            if ":" in subj
        })
        records.append({
            "path": path,
            "date": date_str,
            "theme": theme,
            "shown": shown,
            "probed": probed,
            "confirmed": confirmed,
            "objects": exercised_objs,
        })
    return records


def classify_issues(issues: list[dict[str, Any]], tops: dict[str, dict[str, Any]],
                    tracked_lines: dict[str, int], owner_fn,
                    file_latest_ts: dict[str, int]) -> dict[str, list[dict[str, Any]]]:
    """Partition open `agent-finding` issues into actionable harm, authority-drifted, authority-blocked,
    claimed, and other.

    Anti-starvation rule: `authority`-labelled issues are waiting on the owner's decision and never
    preempt `slim`/`find`. When one of their explicitly cited files changes after `last_touch`, they
    move to `authority_drifted` (surfaced for opportunistic recheck, not a `harm` deadlock).
    """
    actionable_harm: list[dict[str, Any]] = []
    authority_drifted: list[dict[str, Any]] = []
    blocked_authority: list[dict[str, Any]] = []
    claimed: list[dict[str, Any]] = []
    other_open: list[dict[str, Any]] = []

    obj_names = [name for name in tops if name not in (".", "docs", "docs/plans", "changelog.d")]

    for issue in issues:
        raw_labels = issue.get("labels") or []
        labels = {lbl["name"] if isinstance(lbl, dict) else str(lbl) for lbl in raw_labels}
        title = issue.get("title") or ""
        body = issue.get("body") or ""
        text = f"{title}\n{body}"
        num = issue.get("number")
        updated = issue.get("updatedAt") or issue.get("updated_at")
        comments = issue.get("comments") or []
        last_touch = updated
        if comments:
            c_dates = [
                str(d) for c in comments
                if isinstance(c, dict) and (d := c.get("createdAt") or c.get("created_at"))
            ]
            if c_dates:
                last_touch = max(c_dates)
        touch_dt = _parse_iso(last_touch)
        touch_ts = int(touch_dt.timestamp()) if touch_dt else 0

        # Extract exact tracked repo files mentioned in the issue (file-precise change detection).
        cited_files = sorted({p for p in FILE_PATH_RE.findall(text) if p in tracked_lines and not p.startswith("tests/")})
        mentioned_objs = sorted({
            *(owner_fn(p, tops) for p in cited_files if owner_fn(p, tops)),
            *(name for name in obj_names if re.search(rf"(?<![\w/-]){re.escape(name)}(?:/|\b)", title)),
        })
        if not mentioned_objs:
            mentioned_objs = sorted({
                name for name in obj_names
                if re.search(rf"(?<![\w/-]){re.escape(name)}(?:/|\b)", body[:600])
            })

        entry = {
            "number": num,
            "title": title,
            "labels": sorted(labels),
            "objects": mentioned_objs,
            "cited_files": cited_files[:5],
            "last_touch": last_touch,
        }

        if "claimed" in labels:
            claimed.append(entry)
            continue

        is_minor = title.lower().startswith("minor:")
        is_enhancement = "enhancement" in labels
        is_harm = (not is_minor and not is_enhancement) and (
            bool(HARM_RE.search(title)) or ("authority" in labels and bool(HARM_RE.search(text[:600])))
        )

        if "authority" in labels:
            changed_files = [p for p in cited_files if file_latest_ts.get(p, 0) > touch_ts] if touch_ts else []
            if changed_files and is_harm:
                entry["changed_files"] = changed_files
                entry["reason"] = f"authority-blocked; cited file(s) changed since last check: {', '.join(changed_files[:3])}"
                authority_drifted.append(entry)
            else:
                entry["reason"] = "waiting on owner authority; cited code unchanged since last check"
                blocked_authority.append(entry)
            continue

        if is_harm and "needs-evidence" not in labels:
            entry["reason"] = "unclaimed actionable harm finding"
            actionable_harm.append(entry)
        else:
            other_open.append(entry)

    return {
        "actionable_harm": actionable_harm,
        "authority_drifted": authority_drifted,
        "blocked_authority": blocked_authority,
        "claimed": claimed,
        "other_open": other_open,
    }


def _slim_candidates(telemetry_data: dict[str, Any]) -> list[dict[str, Any]]:
    """Identify code objects triggering oscillation, test-bloat, or structural-decay slimming."""
    candidates: list[dict[str, Any]] = []
    for name, obj in telemetry_data["objects"].items():
        if obj["kind"] != "code":
            continue
        reasons: list[str] = []
        severity = 0.0
        max_file_fixes = max((f["fixes"] for f in obj["fix_burst_files"]), default=0)
        if max_file_fixes >= 4 or (obj["fixes_short"] >= 8 and obj["oscillation_ratio"] >= 2.5):
            reasons.append(f"oscillation_burst (max_file_fixes={max_file_fixes}, obj_fixes={obj['fixes_short']}, osc={obj['oscillation_ratio']})")
            severity += max_file_fixes * 4.0 + obj["fixes_short"] * 1.5
        if obj["test_net_short"] > max(300, 1.5 * max(obj["net_short"], 0)) or (
            (obj["test_to_prod_ratio"] or 0) >= 1.2 and obj["test_net_short"] > 100
        ):
            reasons.append(f"test_bloat (test_net={obj['test_net_short']:+d}, prod_net={obj['net_short']:+d}, ratio={obj['test_to_prod_ratio']})")
            severity += min(30.0, obj["test_net_short"] / 50.0)
        if obj["break_even_caution"] and obj["fixes_short"] >= 2:
            reasons.append(f"structural_decay (min_health={obj['min_health']}, max_cognitive={obj['max_cognitive']}, fixes={obj['fixes_short']})")
            severity += (6.0 - obj["min_health"]) * 5.0 + obj["fixes_short"] * 1.5
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
    return candidates


def advise(rev: str, tops: dict[str, dict[str, Any]], tracked_lines: dict[str, int],
           scan_objects: dict[str, dict[str, Any]], scan_items: dict[str, str | None],
           telemetry_data: dict[str, Any], owner_fn, *,
           issues: list[dict[str, Any]] | None = None,
           sla_days: int = 21) -> dict[str, Any]:
    """Compute the closed-loop audit recommendation, priority table, and stopping decision."""
    now_dt = _commit_date(rev)
    records = read_audit_history(rev, tracked_lines)
    themed_records = [r for r in records if r["theme"] in ("harm", "slim", "find", "friction", "steady")]
    last_two_themes = [r["theme"] for r in themed_records[-2:]]

    recent_audits = [r for r in records if r["confirmed"] is not None][-4:]
    zero_yield_streak: dict[str, int] = {}
    for rec in reversed(recent_audits):
        if rec["confirmed"] == 0:
            for obj_expr in rec["objects"]:
                for part in obj_expr.split("+"):
                    zero_yield_streak[part] = zero_yield_streak.get(part, 0) + 1

    file_latest_ts = telemetry_data.get("_file_latest_ts", {})
    issue_buckets = classify_issues(issues or [], tops, tracked_lines, owner_fn, file_latest_ts)
    slim_list = _slim_candidates(telemetry_data)

    ranked_objects: list[dict[str, Any]] = []
    staleness_breaches: list[str] = []
    for name, obj in telemetry_data["objects"].items():
        if obj["kind"] != "code":
            continue
        examined_str = scan_objects.get(name, {}).get("examined")
        examined_dt = _parse_iso(f"{examined_str}T00:00:00Z") if examined_str else None
        if examined_dt is None:
            stale_days = sla_days * 2
            breach = True
        else:
            stale_days = max(0, int((now_dt - examined_dt).total_seconds() // 86400))
            breach = stale_days > sla_days
        if breach:
            staleness_breaches.append(name)

        risk_prior = (
            math.log1p(obj["abs_churn_short"]) * 1.5
            + obj["fixes_short"] * 2.5
            + len(obj["fix_burst_files"]) * 4.0
            + max(0, obj["max_cognitive"] - 15) * 0.25
        )
        staleness_bonus = min(stale_days, sla_days * 2) * (1.2 if breach else 0.35)
        saturation_pen = zero_yield_streak.get(name, 0) * 6.0
        score = round(risk_prior + staleness_bonus - saturation_pen, 2)
        ranked_objects.append({
            "object": name,
            "score": score,
            "risk_prior": round(risk_prior, 2),
            "staleness_days": stale_days,
            "examined": examined_str,
            "staleness_breach": breach,
            "saturation_penalty": round(saturation_pen, 2),
            "commits_long": obj["commits_long"],
            "fixes_short": obj["fixes_short"],
            "abs_churn_short": obj["abs_churn_short"],
            "min_health": obj["min_health"],
        })
    ranked_objects.sort(key=lambda r: (-r["score"], r["object"]))

    stalest_items = sorted(
        [(item, dt or "0000-00-00") for item, dt in scan_items.items() if item not in ("fixed", "self")],
        key=lambda pair: (pair[1], pair[0]),
    )

    last_two_probed = [r for r in records if r["confirmed"] is not None][-2:]
    recent_confirmed = sum(r["confirmed"] for r in last_two_probed) if len(last_two_probed) >= 2 else None
    code_commits_short = sum(o["commits_short"] for o in telemetry_data["objects"].values() if o["kind"] == "code")

    stopping_checks = {
        "issues_provided": issues is not None,
        "no_actionable_harm": len(issue_buckets["actionable_harm"]) == 0,
        "no_slim_triggers": len(slim_list) == 0,
        "no_staleness_breaches": len(staleness_breaches) == 0,
        "marginal_yield_saturated": (
            (recent_confirmed == 0)
            or (code_commits_short < 5 and len(staleness_breaches) == 0)
        ),
    }

    can_steady = all(stopping_checks.values())
    if issue_buckets["actionable_harm"]:
        theme = "harm"
        chosen_objs = sorted({o for iss in issue_buckets["actionable_harm"] for o in iss["objects"]})[:3]
        if not chosen_objs and ranked_objects:
            chosen_objs = [ranked_objects[0]["object"]]
        chosen_items: list[str] = []
        rationale = (
            f"{len(issue_buckets['actionable_harm'])} actionable harm finding(s) require verification "
            f"({len(issue_buckets['blocked_authority'])} unchanged authority-blocked issue(s) excluded)."
        )
    elif slim_list and last_two_themes != ["slim", "slim"]:
        theme = "slim"
        chosen_objs = [c["object"] for c in slim_list[:2]]
        chosen_items = ["structure", "size", "checks"]
        rationale = (
            f"{len(slim_list)} code object(s) hit anti-bloat/oscillation thresholds; top: "
            f"{slim_list[0]['object']} ({'; '.join(slim_list[0]['reasons'])})."
        )
    elif can_steady:
        theme = "steady"
        chosen_objs = []
        chosen_items = []
        rationale = (
            "All convergence gates hold: 0 actionable harm, 0 slim/oscillation triggers, "
            f"0 coverage SLA breaches (<= {sla_days}d), and saturated marginal discovery yield. "
            "Stop and cooldown instead of manufacturing low-value findings."
        )
    else:
        theme = "find"
        picked: list[str] = []
        if ranked_objects:
            picked.append(ranked_objects[0]["object"])
        # Pair highest-risk object with the COLDEST unexamined object (fewest long commits, oldest examined date)
        # so hot areas can never starve cold areas.
        cold_stale = sorted(
            [r for r in ranked_objects if r["staleness_breach"] and r["object"] not in picked],
            key=lambda r: (r["examined"] or "0000-00-00", r["commits_long"], r["object"]),
        )
        if cold_stale:
            picked.append(cold_stale[0]["object"])
        elif len(ranked_objects) > 1:
            picked.append(ranked_objects[1]["object"])
        chosen_objs = picked[:3]
        chosen_items = [item for item, _ in stalest_items[:3]]
        rationale = (
            f"0 actionable harm ({len(issue_buckets['blocked_authority'])} authority-blocked excluded); "
            f"{len(staleness_breaches)} code object(s) exceed {sla_days}d coverage SLA. "
            "Pairing top risk/churn object with coldest unexamined object."
        )

    coupled_contracts = [
        c for c in telemetry_data["couplings"]
        if any(obj in c["pair"].split("+") for obj in chosen_objs)
    ][:3]

    return {
        "tree": rev,
        "as_of": now_dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "sla_days": sla_days,
        "recommended_theme": theme,
        "rationale": rationale,
        "recommended_scope": {
            "theme": theme,
            "objects": chosen_objs,
            "items": chosen_items,
            "coupled_contracts": coupled_contracts,
        },
        "stopping_checks": stopping_checks,
        "last_two_themes": last_two_themes,
        "issues_summary": {
            "provided": issues is not None,
            "actionable_harm": issue_buckets["actionable_harm"][:10],
            "authority_drifted": issue_buckets["authority_drifted"][:10],
            "blocked_authority_count": len(issue_buckets["blocked_authority"]),
            "claimed_count": len(issue_buckets["claimed"]),
            "other_open_count": len(issue_buckets["other_open"]),
        },
        "slim_candidates": slim_list[:6],
        "staleness_breach_count": len(staleness_breaches),
        "ranked_code_objects": ranked_objects[:12],
        "stalest_items": [{"item": i, "examined": None if d == "0000-00-00" else d} for i, d in stalest_items[:8]],
        "next_trigger_if_steady": (
            "Re-enter audit when a new unclaimed harm finding opens, a code object hits >=3 fix commits "
            f"in {telemetry_data['days']}d, a dependency/release changes, or an object exceeds {sla_days}d SLA."
        ),
    }
