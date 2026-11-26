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
import telemetry  # noqa: E402

HARM_RE = re.compile(
    r"\b(live|money|fund|order|fill|position|venue_flat|ledger|corrupt|wrong|incorrect|invalid|"
    r"bypass|refusal|veto|drawdown|equity|security|crash|oom|data loss|silent|phantom|stop|"
    r"voids|reproduction failure|unfalsified|leak|drop)\b",
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
        for _, subj in RECORDED_ROW_RE.findall(text):
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


def classify_issues(issues: list[dict[str, Any]], tops: dict[str, dict[str, Any]],
                    tracked_lines: dict[str, int], object_kinds: dict[str, str],
                    owner_fn, file_latest_ts: dict[str, int],
                    now_dt: datetime) -> dict[str, list[dict[str, Any]]]:
    """Partition open `agent-finding` issues into actionable harm, authority-drifted, authority-blocked,
    claimed, stale-claimed, and other."""
    if not isinstance(issues, list) or not all(isinstance(item, dict) for item in issues):
        raise SystemExit("--issues-json must contain a JSON array of issue objects")

    actionable_harm: list[dict[str, Any]] = []
    authority_drifted: list[dict[str, Any]] = []
    blocked_authority: list[dict[str, Any]] = []
    claimed: list[dict[str, Any]] = []
    stale_claimed: list[dict[str, Any]] = []
    other_open: list[dict[str, Any]] = []

    obj_names = [name for name in tops if name not in (".", "docs", "docs/plans", "changelog.d")]
    # Map unique tracked basenames (e.g. `quality.yml` -> `.github/workflows/quality.yml`) for drift checks.
    basename_map: dict[str, list[str]] = {}
    for p in tracked_lines:
        if not telemetry.is_test_path(p):
            basename_map.setdefault(Path(p).name, []).append(p)
    unique_basenames = {b: ps[0] for b, ps in basename_map.items() if len(ps) == 1}
    now_ts = int(now_dt.timestamp())

    for issue in issues:
        raw_labels = issue.get("labels") or []
        labels = {lbl["name"] if isinstance(lbl, dict) else str(lbl) for lbl in raw_labels}
        title = str(issue.get("title") or "")
        body = str(issue.get("body") or "")
        text = f"{title}\n{body}"
        num = issue.get("number")
        updated = issue.get("updatedAt") or issue.get("updated_at")
        comments = _extract_comments(issue)
        c_dates = [str(d) for c in comments if (d := c.get("createdAt") or c.get("created_at"))]
        candidates_ts = [str(d) for d in [updated, *c_dates] if d]
        last_touch = max(candidates_ts) if candidates_ts else None
        touch_dt = _parse_iso(last_touch)
        touch_ts = int(touch_dt.timestamp()) if touch_dt else 0

        cited_set: set[str] = set()
        for raw_match in FILE_PATH_RE.findall(text):
            if raw_match in tracked_lines and not telemetry.is_test_path(raw_match):
                cited_set.add(raw_match)
            elif raw_match in unique_basenames:
                cited_set.add(unique_basenames[raw_match])
        cited_files = sorted(cited_set)

        mentioned_objs = sorted({
            *(owner_fn(p, tops) for p in cited_files if owner_fn(p, tops)),
            *(name for name in obj_names if re.search(rf"(?<![\w/-]){re.escape(name)}(?:/|\b)", title)),
        })
        if not mentioned_objs:
            mentioned_objs = sorted({
                name for name in obj_names
                if re.search(rf"(?<![\w/-]){re.escape(name)}(?:/|\b)", body[:600])
            })

        entry: dict[str, Any] = {
            "number": num,
            "title": title,
            "labels": sorted(labels),
            "objects": mentioned_objs,
            "cited_files": cited_files[:5],
            "last_touch": last_touch,
        }

        is_minor = title.lower().startswith("minor:")
        is_enhancement = "enhancement" in labels
        docs_only = bool(cited_files) and all(
            object_kinds.get(owner_fn(p, tops) or ".", "meta") == "docs" or p.endswith(".md")
            for p in cited_files
        )
        has_harm_text = bool(HARM_RE.search(title)) or bool(HARM_RE.search(body[:600]))
        if docs_only and not SECURITY_RE.search(text[:600]):
            has_harm_text = False
        is_harm = (not is_minor and not is_enhancement) and has_harm_text

        if "claimed" in labels:
            # Per record.md:24, claims under 2 days old are left alone; older ones are stale.
            claim_age = (now_ts - touch_ts) if touch_ts else CLAIM_EXPIRY_SECONDS + 1
            if claim_age < CLAIM_EXPIRY_SECONDS:
                claimed.append(entry)
                continue
            entry["reason"] = f"stale claim ({claim_age // 86400}d old, >= 2d expiry)"
            stale_claimed.append(entry)
            if is_harm and "authority" not in labels and "needs-evidence" not in labels:
                actionable_harm.append(entry)
            continue

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
        "stale_claimed": stale_claimed,
        "other_open": other_open,
    }


def _slim_candidates(telemetry_data: dict[str, Any]) -> list[dict[str, Any]]:
    """Identify code objects triggering oscillation, test-bloat, structural-decay, or clone-bloat slimming."""
    candidates: list[dict[str, Any]] = []
    for name, obj in telemetry_data["objects"].items():
        if obj["kind"] != "code":
            continue
        reasons: list[str] = []
        severity = 0.0
        max_file_touches = max((f["fixes"] + f.get("reverts", 0) for f in obj["fix_burst_files"]), default=0)
        reverts = obj.get("reverts_short", 0)
        if max_file_touches >= 4 or reverts >= 1 or (obj["fixes_short"] >= 8 and obj["oscillation_ratio"] >= 2.5):
            reasons.append(
                f"oscillation_burst (max_file_fixes={max_file_touches}, reverts={reverts}, "
                f"obj_fixes={obj['fixes_short']}, osc={obj['oscillation_ratio']})"
            )
            severity += max_file_touches * 4.0 + reverts * 6.0 + obj["fixes_short"] * 1.5
        if ((obj["test_to_prod_ratio"] or 0) >= 1.35 and obj["test_net_short"] > 150) or (
            obj["net_short"] <= 0 and obj["test_net_short"] > 300
        ):
            reasons.append(f"test_bloat (test_net={obj['test_net_short']:+d}, prod_net={obj['net_short']:+d}, ratio={obj['test_to_prod_ratio']})")
            severity += min(30.0, obj["test_net_short"] / 50.0)
        # Only trigger structural_decay when an unhealthy file ITSELF received >=2 fixes/reverts (no sibling FP).
        unhealthy_fixes = obj.get("unhealthy_fixes_short", 0)
        if obj["break_even_caution"] and obj["min_health"] is not None and unhealthy_fixes >= 2:
            reasons.append(
                f"structural_decay (min_health={obj['min_health']}, max_cognitive={obj['max_cognitive']}, "
                f"unhealthy_fixes={unhealthy_fixes})"
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
    return candidates


def advise(rev: str, tops: dict[str, dict[str, Any]], tracked_lines: dict[str, int],
           scan_objects: dict[str, dict[str, Any]], scan_items: dict[str, str | None],
           telemetry_data: dict[str, Any], owner_fn, *,
           issues: list[dict[str, Any]] | None = None,
           sla_days: int = 21) -> dict[str, Any]:
    """Compute the closed-loop audit recommendation, priority table, and stopping decision."""
    now_dt = _commit_date(rev)
    records = read_audit_history(rev, tracked_lines, tops, owner_fn)
    themed_records = [r for r in records if r["theme"] in ("harm", "slim", "find", "friction", "steady")]
    last_two_themes = [r["theme"] for r in themed_records[-2:]]

    # Compute per-object consecutive zero-yield streaks from complete, non-steady substantive audits;
    # reset immediately when an audit covering that object found confirmed > 0.
    substantive_audits = [
        r for r in records
        if r["theme"] != "steady"
        and not r["is_partial"]
        and r["confirmed"] is not None
        and ((r["probed"] or 0) >= 1 or (r["shown"] == 0 and len(r["objects"]) >= 1))
    ]
    zero_yield_streak: dict[str, int] = {}
    streak_broken: set[str] = set()
    for rec in reversed(substantive_audits[-8:]):
        for obj in rec["objects"]:
            if obj in streak_broken:
                continue
            if rec["confirmed"] == 0:
                zero_yield_streak[obj] = zero_yield_streak.get(obj, 0) + 1
            else:
                streak_broken.add(obj)

    object_kinds = {name: obj["kind"] for name, obj in telemetry_data["objects"].items()}
    file_latest_ts = telemetry_data.get("_file_latest_ts", {})
    issue_buckets = classify_issues(
        issues if issues is not None else [], tops, tracked_lines, object_kinds, owner_fn, file_latest_ts, now_dt
    )
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
            + (obj["fixes_short"] + obj.get("reverts_short", 0)) * 2.5
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

    # Rolling yield over last 2 complete, substantive, non-steady audits for STEADY stopping gate.
    last_two_substantive = substantive_audits[-2:]
    recent_confirmed = sum(r["confirmed"] for r in last_two_substantive) if len(last_two_substantive) >= 2 else None
    any_recent_bugs = any((r["confirmed"] or 0) > 0 for r in last_two_substantive)
    code_commits_short = sum(o["commits_short"] for o in telemetry_data["objects"].values() if o["kind"] == "code")

    stopping_checks = {
        "issues_provided": issues is not None,
        "no_actionable_harm": len(issue_buckets["actionable_harm"]) == 0,
        "no_slim_triggers": len(slim_list) == 0,
        "no_staleness_breaches": len(staleness_breaches) == 0,
        "marginal_yield_saturated": (
            (recent_confirmed == 0)
            or (code_commits_short < 5 and len(staleness_breaches) == 0 and not any_recent_bugs and len(last_two_substantive) >= 1)
        ),
    }

    # Anti-starvation cooldown: while staleness breaches remain, do not let `slim` run back-to-back or 2:1.
    slim_cooled_down = (
        ("slim" in last_two_themes and len(staleness_breaches) > 0)
        or last_two_themes == ["slim", "slim"]
    )

    can_steady = all(stopping_checks.values())
    if issue_buckets["actionable_harm"]:
        theme = "harm"
        chosen_objs = sorted({o for iss in issue_buckets["actionable_harm"] for o in iss["objects"]})[:3]
        if not chosen_objs and ranked_objects:
            chosen_objs = [ranked_objects[0]["object"]]
        chosen_items: list[str] = []
        rationale = (
            f"{len(issue_buckets['actionable_harm'])} actionable harm finding(s) require verification "
            f"({len(issue_buckets['blocked_authority'])} unchanged authority-blocked and "
            f"{len(issue_buckets['authority_drifted'])} drifted authority issue(s) excluded)."
        )
    elif slim_list and not slim_cooled_down:
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
            f"0 coverage SLA breaches (<= {sla_days}d), and saturated marginal discovery yield across "
            "substantive complete audits. Stop and cooldown instead of manufacturing low-value findings."
        )
    else:
        theme = "find"
        picked: list[str] = []
        if ranked_objects:
            picked.append(ranked_objects[0]["object"])
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
        cooldown_note = " (`slim` in cooldown while SLA breaches remain)" if slim_list and slim_cooled_down else ""
        rationale = (
            f"0 actionable harm ({len(issue_buckets['blocked_authority'])} authority-blocked excluded){cooldown_note}; "
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
            "stale_claimed": issue_buckets["stale_claimed"][:10],
            "blocked_authority_count": len(issue_buckets["blocked_authority"]),
            "claimed_count": len(issue_buckets["claimed"]),
            "other_open_count": len(issue_buckets["other_open"]),
        },
        "slim_total_count": len(slim_list),
        "slim_candidates": slim_list[:6],
        "staleness_breach_count": len(staleness_breaches),
        "ranked_code_objects": ranked_objects[:12],
        "stalest_items": [{"item": i, "examined": None if d == "0000-00-00" else d} for i, d in stalest_items[:8]],
        "next_trigger_if_steady": (
            "Re-enter audit when a new unclaimed harm finding opens, a code object hits >=3 fix commits "
            f"in {telemetry_data['days']}d, a dependency/release changes, or an object exceeds {sla_days}d SLA."
        ),
    }
