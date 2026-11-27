"""Silent production invariants evaluator and strictly read-only ops snapshot collector (product-doctor v3.1).

Catches production Paper / Live / Market / Ledger failures that emit zero ERROR/Traceback/OOM log lines:
  1. market_head_staleness       - active USDT perpetuals head lagging UTC date past SLA while not halted
  2. paper_checkpoint_stall      - active Paper run alive > 2h without checkpoint advance, or stuck in WARMING
  3. orphan_unsealed_age         - unsealed orphan run directory older than 600s not yet sealed by daemon
  4. compare_unexplained_drift   - read-only paper/live compare reporting unexplained items or order/position drift
  5. notify_heartbeat_missing    - active Live/Paper monitor missing daily summary heartbeat (> 26h, even on 0-trade days)
  6. ledger_backup_or_mirror_drift - dolt_backup or public DoltHub mirror lagging/diverged past publish SLA

Pure Python standard library; strictly read-only collection; refuses secret files and redacts all summaries.
"""

from __future__ import annotations

from datetime import UTC, date, datetime
import json
import math
from pathlib import Path
import re
from typing import Any

DEFAULT_MARKET_HEAD_MAX_LAG_DAYS = 2
DEFAULT_CHECKPOINT_MAX_AGE_S = 7200.0
DEFAULT_WARMUP_BUDGET_S = 900.0
DEFAULT_ORPHAN_UNSEALED_MAX_AGE_S = 600.0
DEFAULT_NOTIFY_HEARTBEAT_MAX_AGE_H = 26.0
DEFAULT_BACKUP_MAX_LAG_S = 3600.0
DEFAULT_MIRROR_MAX_LAG_S = 3600.0

MAX_JSON_BYTES = 2 * 1024 * 1024
MAX_LOG_LINE_CHARS = 4096
MAX_SCAN_ENTRIES = 5000
MAX_SUMMARY_LEN = 160

_INACTIVE_RUN_STATES = frozenset({"STOPPED", "SEALED", "ENDED", "DONE", "IDLE", "FAILED"})
_SECRET_BASENAME_TOKENS = ("secret", "credential", "token", "key", "passwd", "password")
_SECRET_DIR_TOKENS = ("secret", "secrets", "credential", "credentials")
_SECRET_EXTENSIONS = frozenset({".pem", ".p12", ".pfx", ".key"})
_DATE_RE = re.compile(r"\b(20\d{2}-\d{2}-\d{2})\b")
_ISO_TS_RE = re.compile(
    r"\b(20\d{2}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)\b"
)
_DAILY_SUMMARY_RE = re.compile(r"(?:daily[\s_-]+summary|daily_summary|heartbeat|@daily:)", re.IGNORECASE)
_NOTIFY_FAIL_RE = re.compile(
    r"\b(?:refused|not\s+sent|failed|failure|error|retried\s+later|exception|rejected|timeout)\b",
    re.IGNORECASE,
)

_REDACT_PATTERNS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"://[^/\s:@]+:[^/\s@]+@"), "://<REDACTED>@"),
    (re.compile(r"(?i)\b(Authorization\s*:\s*(?:Bearer|Basic|Token)\s+)\S+"), r"\1<REDACTED>"),
    (re.compile(r"(?i)\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}"), r"\1 <REDACTED>"),
    (re.compile(r"\b\d{6,12}:[A-Za-z0-9_-]{20,}\b"), "<REDACTED>"),
    (
        re.compile(
            r"(?i)(--(?:[a-z0-9_-]*-)?(?:api[_-]?key|api[_-]?secret|access[_-]?token|auth[_-]?token|"
            r"refresh[_-]?token|token|secret|password|passwd|pwd|cookie))(\s+)(?!-)(\S+)"
        ),
        r"\1\2<REDACTED>",
    ),
    (
        re.compile(
            r"(?i)([A-Za-z0-9_-]*(?:api[_-]?key|access[_-]?token|auth[_-]?token|refresh[_-]?token|"
            r"token|secret|password|passwd|pwd|cookie))(\s*[=:]\s*)\S+"
        ),
        r"\1\2<REDACTED>",
    ),
    (
        re.compile(
            r"\b(?:sk-(?:ant-|proj-)?[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9_]{8,}|github_pat_[A-Za-z0-9_]{8,}|"
            r"AKIA[0-9A-Z]{12,}|AIza[0-9A-Za-z_-]{16,}|xox[baprs]-[A-Za-z0-9-]{8,})\b"
        ),
        "<REDACTED>",
    ),
    (re.compile(r"\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9._-]{6,}"), "<REDACTED>"),
    (re.compile(r"\b[0-9a-fA-F]{40,64}\b"), "<REDACTED>"),
)


def sanitize_text(text: str, max_len: int = MAX_SUMMARY_LEN) -> str:
    """Scrub credentials, tokens, and long hex keys from text and cap length."""
    cleaned = " ".join(str(text).split())
    for pat, repl in _REDACT_PATTERNS:
        cleaned = pat.sub(repl, cleaned)
    if len(cleaned) > max_len:
        return cleaned[: max_len - 3] + "..."
    return cleaned


def _path_is_secret_candidate(candidate: Path) -> bool:
    name = candidate.name.lower()
    if name == ".env" or name.startswith(".env.") or name.endswith(".env") or name in ("telegram.json", "service.json"):
        return True
    if candidate.suffix.lower() in _SECRET_EXTENSIONS:
        return True
    if any(tok in name for tok in _SECRET_BASENAME_TOKENS):
        return True
    parts = [p.lower() for p in candidate.parts]
    return ".env" in parts or any(
        part in _SECRET_DIR_TOKENS or any(t in part for t in ("secret", "credential")) for part in parts
    )


def is_secret_path(path: Path) -> bool:
    """Return True if `path` (or its resolved symlink target) names a forbidden secret/credential file."""
    if _path_is_secret_candidate(path):
        return True
    try:
        resolved = path.resolve()
    except OSError:
        return False
    return resolved != path and _path_is_secret_candidate(resolved)


def _as_float(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    fval = float(value)
    return fval if math.isfinite(fval) else None


def _as_int(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float) and math.isfinite(value) and value.is_integer():
        return int(value)
    return None


def _parse_iso(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    text = value.strip()
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
        text = f"{text}T00:00:00+00:00"
    try:
        dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
        return dt.replace(tzinfo=UTC) if dt.tzinfo is None else dt.astimezone(UTC)
    except ValueError:
        return None


def _parse_date(value: Any) -> date | None:
    dt = _parse_iso(value)
    return dt.date() if dt is not None else None


def _threshold_float(override: Any, global_val: Any, default: float) -> float:
    for candidate in (override, global_val):
        num = _as_float(candidate)
        if num is not None and num >= 0.0:
            return num
    return default


def _threshold_int(override: Any, global_val: Any, default: int) -> int:
    for candidate in (override, global_val):
        num = _as_int(candidate)
        if num is not None and num >= 0:
            return num
    return default


def _normalize_service(raw: Any, default: str, allowed: tuple[str, ...] = ("paper", "live")) -> str:
    if isinstance(raw, str):
        low = raw.strip().lower()
        for item in allowed:
            if low == item or item in re.split(r"[-_.\s/]+", low):
                return item
    return default


def _resolve_age_s(
    entry: dict[str, Any],
    age_key: str,
    ts_keys: tuple[str, ...],
    as_of: datetime,
    bad_fields: list[str],
    field_label: str,
) -> float | None:
    if entry.get(age_key) is not None:
        val = _as_float(entry.get(age_key))
        if val is None:
            bad_fields.append(field_label)
            return None
        return val
    for ts_key in ts_keys:
        if entry.get(ts_key) is not None:
            dt = _parse_iso(entry.get(ts_key))
            if dt is None:
                bad_fields.append(f"{field_label}:{ts_key}")
                return None
            return max(0.0, (as_of - dt).total_seconds())
    return None


def _read_json_bounded(path: Path) -> tuple[Any, str | None]:
    if is_secret_path(path):
        return None, "secret file refused"
    if not path.exists():
        return None, "file not found"
    if not path.is_file():
        return None, "not a regular file"
    try:
        with path.open("rb") as fh:
            raw = fh.read(MAX_JSON_BYTES + 1)
    except OSError as error:
        return None, sanitize_text(error.strerror or str(error), 80)
    if len(raw) > MAX_JSON_BYTES:
        return None, f"file exceeds {MAX_JSON_BYTES} byte limit"
    try:
        return json.loads(raw.decode("utf-8", errors="replace")), None
    except json.JSONDecodeError as error:
        return None, sanitize_text(f"malformed JSON ({error.msg})", 80)


def _record_violation(
    violations: list[dict[str, Any]],
    triggers: list[str],
    affected: set[str],
    *,
    file_name: str,
    invariant: str,
    obj: str | None,
    detail: str,
    prefix: str = "prod_invariant",
) -> None:
    clean_detail = sanitize_text(detail, 140)
    trigger = f"{prefix}:{invariant} ({file_name}: {clean_detail})"
    violations.append({
        "file": file_name,
        "invariant": invariant,
        "object": obj,
        "detail": clean_detail,
        "trigger": trigger,
    })
    triggers.append(trigger)
    if obj:
        affected.add(obj)


def _check_market_head_staleness(
    data: dict[str, Any], as_of: datetime, thresholds: dict[str, Any],
    file_name: str, violations: list[dict[str, Any]], triggers: list[str],
    affected: set[str], bad_fields: list[str],
) -> None:
    market = data.get("market")
    if market is None:
        return
    if not isinstance(market, dict):
        bad_fields.append("market")
        return
    if market.get("halted") is True:
        return
    raw_head = market.get("latest_day") if market.get("latest_day") is not None else market.get("head")
    if raw_head is None:
        return
    head_date = _parse_date(raw_head)
    if head_date is None:
        bad_fields.append("market.latest_day")
        return
    ref_date = _parse_date(market.get("as_of")) or as_of.date()
    max_lag = _threshold_int(market.get("max_lag_days"), thresholds.get("market_head_max_lag_days"), DEFAULT_MARKET_HEAD_MAX_LAG_DAYS)
    lag_days = (ref_date - head_date).days
    if lag_days > max_lag:
        _record_violation(
            violations, triggers, affected,
            file_name=file_name, invariant="market_head_staleness", obj="market",
            detail=f"head={head_date.isoformat()} lags {ref_date.isoformat()} by {lag_days}d > {max_lag}d",
        )


def _extract_paper_runs(paper: dict[str, Any], bad_fields: list[str]) -> list[dict[str, Any]]:
    raw_runs = paper.get("runs") if "runs" in paper else paper.get("active_runs")
    if raw_runs is None:
        if any(k in paper for k in ("state", "checkpoint_age_s", "warming_age_s", "alive_s")):
            return [paper]
        return []
    if not isinstance(raw_runs, list):
        bad_fields.append("paper.runs")
        return []
    out: list[dict[str, Any]] = []
    for item in raw_runs:
        if isinstance(item, dict):
            out.append(item)
        else:
            bad_fields.append("paper.runs[]")
    return out


def _check_paper_checkpoint_stall(
    data: dict[str, Any], as_of: datetime, thresholds: dict[str, Any],
    file_name: str, violations: list[dict[str, Any]], triggers: list[str],
    affected: set[str], bad_fields: list[str],
) -> None:
    paper = data.get("paper")
    if paper is None:
        return
    if not isinstance(paper, dict):
        bad_fields.append("paper")
        return
    max_ckpt = _threshold_float(paper.get("checkpoint_max_age_s"), thresholds.get("checkpoint_max_age_s"), DEFAULT_CHECKPOINT_MAX_AGE_S)
    default_warmup = _threshold_float(paper.get("warmup_budget_s"), thresholds.get("warmup_budget_s"), DEFAULT_WARMUP_BUDGET_S)
    for run in _extract_paper_runs(paper, bad_fields):
        state = str(run.get("state") or "RUNNING").upper()
        if state in _INACTIVE_RUN_STATES:
            continue
        run_id = sanitize_text(str(run.get("id") or run.get("paper_id") or run.get("run_id") or "paper"), 40)
        if state == "WARMING":
            warm_age = _resolve_age_s(run, "warming_age_s", ("warming_started_at", "started_at"), as_of, bad_fields, "paper.warming_age_s")
            budget = _threshold_float(run.get("warmup_budget_s"), None, default_warmup)
            if warm_age is not None and warm_age > budget:
                _record_violation(
                    violations, triggers, affected,
                    file_name=file_name, invariant="paper_checkpoint_stall", obj="paper",
                    detail=f"run={run_id} stuck in WARMING {int(warm_age)}s > {int(budget)}s",
                )
            continue
        alive_s = _resolve_age_s(run, "alive_s", ("started_at",), as_of, bad_fields, "paper.alive_s")
        ckpt_age = _resolve_age_s(run, "checkpoint_age_s", ("last_checkpoint_at",), as_of, bad_fields, "paper.checkpoint_age_s")
        if ckpt_age is None and "last_checkpoint_at" in run and run.get("last_checkpoint_at") is None and alive_s is not None:
            ckpt_age = alive_s
        if ckpt_age is not None and ckpt_age > max_ckpt and (alive_s is None or alive_s > max_ckpt):
            _record_violation(
                violations, triggers, affected,
                file_name=file_name, invariant="paper_checkpoint_stall", obj="paper",
                detail=f"run={run_id} checkpoint_age={int(ckpt_age)}s > {int(max_ckpt)}s",
            )


def _gather_orphans(data: dict[str, Any], bad_fields: list[str]) -> list[tuple[str, dict[str, Any]]]:
    items: list[tuple[str, dict[str, Any]]] = []
    sources: list[tuple[str, Any, str]] = [("paper", data.get("unsealed_orphans"), "unsealed_orphans")]
    for svc in ("paper", "live"):
        sec = data.get(svc)
        if isinstance(sec, dict) and sec.get("unsealed_orphans") is not None:
            sources.append((svc, sec.get("unsealed_orphans"), f"{svc}.unsealed_orphans"))
    for default_svc, raw, label in sources:
        if raw is None:
            continue
        if not isinstance(raw, list):
            bad_fields.append(label)
            continue
        for entry in raw:
            if isinstance(entry, dict):
                items.append((default_svc, entry))
            else:
                bad_fields.append(f"{label}[]")
    return items


def _check_orphan_unsealed_age(
    data: dict[str, Any], as_of: datetime, thresholds: dict[str, Any],
    file_name: str, violations: list[dict[str, Any]], triggers: list[str],
    affected: set[str], bad_fields: list[str],
) -> None:
    max_age = _threshold_float(None, thresholds.get("orphan_unsealed_max_age_s"), DEFAULT_ORPHAN_UNSEALED_MAX_AGE_S)
    for default_svc, orphan in _gather_orphans(data, bad_fields):
        if orphan.get("sealed") is True:
            continue
        age_s = _resolve_age_s(orphan, "age_s", ("ended_at", "mtime_at", "updated_at"), as_of, bad_fields, "unsealed_orphans.age_s")
        if age_s is not None and age_s > max_age:
            svc = _normalize_service(orphan.get("service"), default=default_svc, allowed=("paper", "live"))
            run_id = sanitize_text(str(orphan.get("id") or orphan.get("run_id") or orphan.get("dir") or "orphan"), 40)
            _record_violation(
                violations, triggers, affected,
                file_name=file_name, invariant="orphan_unsealed_age", obj=svc,
                detail=f"{svc}/{run_id} unsealed {int(age_s)}s > {int(max_age)}s",
            )


def _normalize_record_list(raw: Any, label: str, bad_fields: list[str]) -> list[dict[str, Any]]:
    if raw is None:
        return []
    if isinstance(raw, dict):
        return [raw]
    if isinstance(raw, list):
        out: list[dict[str, Any]] = []
        for item in raw:
            if isinstance(item, dict):
                out.append(item)
            else:
                bad_fields.append(f"{label}[]")
        return out
    bad_fields.append(label)
    return []


def _check_compare_unexplained_drift(
    data: dict[str, Any], file_name: str, violations: list[dict[str, Any]],
    triggers: list[str], affected: set[str], bad_fields: list[str],
) -> None:
    records = _normalize_record_list(data.get("compare"), "compare", bad_fields)
    records.extend(_normalize_record_list(data.get("compares"), "compares", bad_fields))
    for rec in records:
        unexp_raw = rec.get("unexplained")
        unexp_len = 0
        if isinstance(unexp_raw, list):
            unexp_len = len(unexp_raw)
        elif unexp_raw is not None:
            bad_fields.append("compare.unexplained")
        raw_cnt = rec.get("unexplained_count")
        cnt = _as_int(raw_cnt)
        if raw_cnt is not None and cnt is None:
            bad_fields.append("compare.unexplained_count")
        unexplained_count = max(cnt or 0, unexp_len)
        orders_differ = rec.get("orders_differ") is True
        positions_differ = rec.get("positions_differ") is True
        if unexplained_count > 0 or orders_differ or positions_differ:
            obj = _normalize_service(rec.get("service") or rec.get("mode"), default="engine", allowed=("paper", "live", "engine"))
            parts: list[str] = []
            if unexplained_count > 0:
                parts.append(f"unexplained={unexplained_count}")
            if orders_differ:
                parts.append("orders_differ")
            if positions_differ:
                parts.append("positions_differ")
            _record_violation(
                violations, triggers, affected,
                file_name=file_name, invariant="compare_unexplained_drift", obj=obj,
                detail=f"{obj} {', '.join(parts)}",
            )


def _check_notify_heartbeat_missing(
    data: dict[str, Any], as_of: datetime, thresholds: dict[str, Any],
    file_name: str, violations: list[dict[str, Any]], triggers: list[str],
    affected: set[str], bad_fields: list[str],
) -> None:
    max_age_h = _threshold_float(None, thresholds.get("notify_heartbeat_max_age_h"), DEFAULT_NOTIFY_HEARTBEAT_MAX_AGE_H)
    for rec in _normalize_record_list(data.get("notify"), "notify", bad_fields):
        if rec.get("active") is False:
            continue
        svc = _normalize_service(rec.get("service"), default="live", allowed=("live", "paper"))
        limit_h = _threshold_float(rec.get("max_age_h"), None, max_age_h)
        age_h: float | None = None
        if rec.get("last_daily_summary_age_h") is not None:
            age_h = _as_float(rec.get("last_daily_summary_age_h"))
            if age_h is None:
                bad_fields.append("notify.last_daily_summary_age_h")
                continue
        elif rec.get("last_daily_summary_at") is not None:
            dt = _parse_iso(rec.get("last_daily_summary_at"))
            if dt is None:
                bad_fields.append("notify.last_daily_summary_at")
                continue
            age_h = round(max(0.0, (as_of - dt).total_seconds()) / 3600.0, 2)
        uptime_h = _as_float(rec.get("monitor_uptime_h"))
        never_sent_overdue = (
            age_h is None and "last_daily_summary_at" in rec
            and rec.get("last_daily_summary_at") is None and uptime_h is not None and uptime_h > limit_h
        )
        if rec.get("missing") is True or never_sent_overdue or (age_h is not None and age_h > limit_h):
            desc = f"{age_h:.1f}h > {limit_h:.1f}h" if age_h is not None else "missing"
            _record_violation(
                violations, triggers, affected,
                file_name=file_name, invariant="notify_heartbeat_missing", obj=svc,
                detail=f"{svc} daily summary {desc}",
            )


def _check_ledger_backup_or_mirror_drift(
    data: dict[str, Any], as_of: datetime, thresholds: dict[str, Any],
    file_name: str, violations: list[dict[str, Any]], triggers: list[str],
    affected: set[str], bad_fields: list[str],
) -> None:
    ledger = data.get("ledger")
    if ledger is None:
        return
    if not isinstance(ledger, dict):
        bad_fields.append("ledger")
        return
    backup_max = _threshold_float(ledger.get("backup_max_lag_s"), thresholds.get("backup_max_lag_s"), DEFAULT_BACKUP_MAX_LAG_S)
    mirror_max = _threshold_float(ledger.get("mirror_max_lag_s"), thresholds.get("mirror_max_lag_s"), DEFAULT_MIRROR_MAX_LAG_S)
    behind = _as_int(ledger.get("backup_behind_commits"))
    if ledger.get("backup_behind_commits") is not None and behind is None:
        bad_fields.append("ledger.backup_behind_commits")
    backup_lag = _resolve_age_s(ledger, "backup_lag_s", ("last_backup_at",), as_of, bad_fields, "ledger.backup_lag_s")
    mirror_lag = _resolve_age_s(ledger, "mirror_lag_s", ("last_mirror_push_at",), as_of, bad_fields, "ledger.mirror_lag_s")
    reasons: list[str] = []
    if (behind or 0) > 0 and backup_lag is not None and backup_lag > backup_max:
        reasons.append(f"backup_behind={behind} lag={int(backup_lag)}s > {int(backup_max)}s")
    if ledger.get("mirror_diverged") is True:
        reasons.append("mirror_diverged=true")
    if mirror_lag is not None and mirror_lag > mirror_max:
        reasons.append(f"mirror_lag={int(mirror_lag)}s > {int(mirror_max)}s")
    if reasons:
        _record_violation(
            violations, triggers, affected,
            file_name=file_name, invariant="ledger_backup_or_mirror_drift", obj="ledger",
            detail=", ".join(reasons),
        )


def _inspect_prod_state_file(path: Path) -> tuple[dict[str, Any], list[dict[str, Any]], list[str], set[str]]:
    file_name = sanitize_text(path.name, 80)
    raw, err = _read_json_bounded(path)
    violations: list[dict[str, Any]] = []
    triggers: list[str] = []
    affected: set[str] = set()
    if err is not None:
        _record_violation(
            violations, triggers, affected,
            file_name=file_name, invariant="prod_state_unreadable", obj=None, detail=err, prefix="prod_state",
        )
        return {
            "file": file_name, "as_of": None, "skipped": True, "error": err,
            "triggers": triggers, "violations": violations,
        }, violations, triggers, affected
    if not isinstance(raw, dict):
        reason = "snapshot root must be a JSON object"
        _record_violation(
            violations, triggers, affected,
            file_name=file_name, invariant="prod_state_unreadable", obj=None, detail=reason, prefix="prod_state",
        )
        return {
            "file": file_name, "as_of": None, "skipped": True, "error": reason,
            "triggers": triggers, "violations": violations,
        }, violations, triggers, affected

    bad_fields: list[str] = []
    as_of = _parse_iso(raw.get("as_of"))
    if raw.get("as_of") is not None and as_of is None:
        bad_fields.append("as_of")
    effective_as_of = as_of or datetime.now(UTC)
    thresholds = raw.get("thresholds") if isinstance(raw.get("thresholds"), dict) else {}
    if raw.get("thresholds") is not None and not isinstance(raw.get("thresholds"), dict):
        bad_fields.append("thresholds")

    _check_market_head_staleness(raw, effective_as_of, thresholds, file_name, violations, triggers, affected, bad_fields)
    _check_paper_checkpoint_stall(raw, effective_as_of, thresholds, file_name, violations, triggers, affected, bad_fields)
    _check_orphan_unsealed_age(raw, effective_as_of, thresholds, file_name, violations, triggers, affected, bad_fields)
    _check_compare_unexplained_drift(raw, file_name, violations, triggers, affected, bad_fields)
    _check_notify_heartbeat_missing(raw, effective_as_of, thresholds, file_name, violations, triggers, affected, bad_fields)
    _check_ledger_backup_or_mirror_drift(raw, effective_as_of, thresholds, file_name, violations, triggers, affected, bad_fields)

    if bad_fields:
        _record_violation(
            violations, triggers, affected,
            file_name=file_name, invariant="prod_state_unreadable", obj=None,
            detail=f"malformed field(s): {', '.join(sorted(set(bad_fields))[:4])}", prefix="prod_state",
        )

    return {
        "file": file_name,
        "as_of": effective_as_of.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "triggers": triggers,
        "violations": violations,
    }, violations, triggers, affected


def analyze_prod_states(paths: list[Path]) -> dict[str, Any]:
    """Evaluate one or more production state snapshots against all 6 silent invariants."""
    snapshots: list[dict[str, Any]] = []
    all_violations: list[dict[str, Any]] = []
    all_triggers: list[str] = []
    affected: set[str] = set()
    warnings: list[str] = []
    for path in paths:
        entry, viols, trigs, objs = _inspect_prod_state_file(path)
        snapshots.append(entry)
        all_violations.extend(viols)
        all_triggers.extend(trigs)
        affected.update(objs)
        if entry.get("error"):
            warnings.append(f"{entry['file']}: {entry['error']}")
    out: dict[str, Any] = {
        "state_count": len(snapshots),
        "affected_objects": sorted(affected),
        "violations": all_violations,
        "snapshots": snapshots,
        "triggers": all_triggers,
    }
    if warnings:
        out["warnings"] = warnings
    return out


# ---------------------------------------------------------------------------
# Strictly read-only ops snapshot collector (`doctor.py prod-snapshot`)
# ---------------------------------------------------------------------------

def _safe_dir_entries(directory: Path, limit: int = MAX_SCAN_ENTRIES) -> list[Path]:
    out: list[Path] = []
    try:
        for idx, child in enumerate(sorted(directory.iterdir())):
            if idx >= limit:
                break
            out.append(child)
    except OSError:
        return []
    return out


def _read_market_meta(market_dir: Path) -> dict[str, Any] | None:
    for name in ("head.json", "status.json", "coverage.json", "state.json", "manifest.json"):
        cand = market_dir / name
        if not cand.is_file():
            continue
        raw, err = _read_json_bounded(cand)
        if err is None and isinstance(raw, dict) and (raw.get("latest_day") or raw.get("head")):
            out: dict[str, Any] = {
                "latest_day": str(raw.get("latest_day") or raw.get("head")),
                "halted": bool(raw.get("halted", False)),
            }
            if _as_int(raw.get("active_usdt_perps")) is not None:
                out["active_usdt_perps"] = raw["active_usdt_perps"]
            return out
    return None


def _max_date_in_name(name: str, current: date | None) -> date | None:
    best = current
    for match in _DATE_RE.findall(name):
        parsed = _parse_date(match)
        if parsed and (best is None or parsed > best):
            best = parsed
    return best


def _collect_market(market_dir: Path, notes: list[str]) -> dict[str, Any] | None:
    if is_secret_path(market_dir):
        notes.append("market_dir refused (secret path)")
        return None
    if not market_dir.is_dir():
        notes.append("market_dir missing or not a directory")
        return None
    meta = _read_market_meta(market_dir)
    if meta is not None:
        return meta
    latest_found: date | None = None
    seen = 0
    stack = [market_dir]
    while stack and seen < MAX_SCAN_ENTRIES:
        cur = stack.pop()
        for child in _safe_dir_entries(cur, MAX_SCAN_ENTRIES - seen):
            seen += 1
            if is_secret_path(child):
                notes.append("skipped secret file under market_dir")
                continue
            latest_found = _max_date_in_name(child.name, latest_found)
            if child.is_dir() and len(child.relative_to(market_dir).parts) < 3:
                stack.append(child)
    return {"latest_day": latest_found.isoformat(), "halted": False} if latest_found else None


def _find_checkpoint_mtime(run_dir: Path) -> datetime | None:
    for rel in ("out/checkpoint/manifest.json", "out/checkpoint.json", "checkpoint.json"):
        cand = run_dir / rel
        if cand.is_file() and not is_secret_path(cand):
            raw, err = _read_json_bounded(cand)
            if err is None and isinstance(raw, dict):
                for key in ("checkpoint_at", "updated_at", "created_at", "at"):
                    dt = _parse_iso(raw.get(key))
                    if dt is not None:
                        return dt
            try:
                return datetime.fromtimestamp(cand.stat().st_mtime, tz=UTC)
            except OSError:
                return None
    return None


def _iter_run_dirs(root: Path, notes: list[str]) -> list[Path]:
    run_dirs: list[Path] = []
    for child in _safe_dir_entries(root, 500):
        if is_secret_path(child):
            notes.append(f"skipped secret path in {sanitize_text(root.name, 40)}")
            continue
        if not child.is_dir() or child.name in ("notify", "dolt", ".git"):
            continue
        markers = ("status.json", "state.json", "manifest.json", "seal.json", "out", "inputs")
        if any((child / m).exists() for m in markers):
            run_dirs.append(child)
        else:
            run_dirs.extend(
                sub for sub in _safe_dir_entries(child, 200)
                if sub.is_dir() and not is_secret_path(sub)
            )
    return run_dirs


def _read_run_meta(run_dir: Path) -> dict[str, Any]:
    for name in ("status.json", "state.json", "manifest.json", "inputs/manifest.json"):
        cand = run_dir / name
        if cand.is_file() and not is_secret_path(cand):
            raw, err = _read_json_bounded(cand)
            if err is None and isinstance(raw, dict):
                return raw
    return {}


def _build_active_paper_entry(run_dir: Path, run_id: str, state: str, meta: dict[str, Any], as_of: datetime) -> dict[str, Any]:
    entry: dict[str, Any] = {"id": run_id, "state": state}
    started = _parse_iso(meta.get("started_at"))
    if started is not None:
        entry["alive_s"] = round(max(0.0, (as_of - started).total_seconds()), 1)
        if state == "WARMING":
            entry["warming_age_s"] = entry["alive_s"]
    for num_key in ("alive_s", "checkpoint_age_s", "warming_age_s", "warmup_budget_s"):
        val = _as_float(meta.get(num_key))
        if val is not None:
            entry[num_key] = val
    if "checkpoint_age_s" not in entry:
        ckpt_dt = _parse_iso(meta.get("last_checkpoint_at")) or _find_checkpoint_mtime(run_dir)
        if ckpt_dt is not None:
            entry["checkpoint_age_s"] = round(max(0.0, (as_of - ckpt_dt).total_seconds()), 1)
        else:
            entry["last_checkpoint_at"] = None
    return entry


def _orphan_age_seconds(run_dir: Path, meta: dict[str, Any], as_of: datetime) -> float:
    age_s = _as_float(meta.get("age_s"))
    if age_s is not None:
        return age_s
    ref_dt = _parse_iso(meta.get("ended_at") or meta.get("updated_at"))
    if ref_dt is None:
        try:
            ref_dt = datetime.fromtimestamp(run_dir.stat().st_mtime, tz=UTC)
        except OSError:
            ref_dt = as_of
    return round(max(0.0, (as_of - ref_dt).total_seconds()), 1)


def _inspect_run_dir(
    run_dir: Path, service: str, as_of: datetime,
    active_runs: list[dict[str, Any]], orphans: list[dict[str, Any]],
) -> None:
    meta = _read_run_meta(run_dir)
    run_id = sanitize_text(str(meta.get("run_id") or meta.get("paper_id") or meta.get("id") or run_dir.name), 40)
    has_seal = (run_dir / "seal.json").is_file()
    state = str(meta.get("state") or ("SEALED" if has_seal else "UNSEALED")).upper()
    if state in ("RUNNING", "WARMING", "ACTIVE") and service == "paper":
        active_runs.append(_build_active_paper_entry(run_dir, run_id, state, meta, as_of))
    elif state in ("UNSEALED", "ENDED") and not has_seal:
        orphans.append({"id": run_id, "service": service, "age_s": _orphan_age_seconds(run_dir, meta, as_of)})


def _extract_latest_daily_date(raw: dict[str, Any]) -> date | None:
    latest_day: date | None = None
    candidates: list[str] = [k for k in raw if isinstance(k, str)]
    done = raw.get("done")
    if isinstance(done, list):
        candidates.extend(x for x in done if isinstance(x, str))
    for item in candidates:
        if "daily" not in item.lower():
            continue
        for match in _DATE_RE.findall(item):
            parsed = _parse_date(match)
            if parsed and (latest_day is None or parsed > latest_day):
                latest_day = parsed
    return latest_day


def _collect_notify_json(path: Path, as_of: datetime, default_service: str, notes: list[str]) -> dict[str, Any] | None:
    raw, err = _read_json_bounded(path)
    if err is not None:
        notes.append(f"notify {sanitize_text(path.name, 40)}: {err}")
        return None
    if not isinstance(raw, dict):
        return None
    svc = _normalize_service(raw.get("service"), default=default_service, allowed=("live", "paper"))
    out: dict[str, Any] = {"service": svc, "active": raw.get("active") is not False}
    if _as_float(raw.get("last_daily_summary_age_h")) is not None:
        out["last_daily_summary_age_h"] = float(raw["last_daily_summary_age_h"])
        return out
    dt = _parse_iso(raw.get("last_daily_summary_at"))
    if dt is None:
        latest_day = _extract_latest_daily_date(raw)
        if latest_day is not None:
            dt = datetime(latest_day.year, latest_day.month, latest_day.day, tzinfo=UTC)
    if dt is not None:
        out["last_daily_summary_at"] = dt.strftime("%Y-%m-%dT%H:%M:%SZ")
        out["last_daily_summary_age_h"] = round(max(0.0, (as_of - dt).total_seconds()) / 3600.0, 2)
    elif out["active"]:
        out["missing"] = True
    return out


def _read_bounded_lines(fh: Any, max_chars: int = MAX_LOG_LINE_CHARS) -> Any:
    while True:
        chunk = fh.readline(max_chars + 1)
        if not chunk:
            break
        yield chunk[:max_chars]
        while len(chunk) > max_chars and not chunk.endswith("\n"):
            chunk = fh.readline(max_chars + 1)
            if not chunk:
                break


def _collect_notify_log(path: Path, as_of: datetime, notes: list[str]) -> dict[str, Any] | None:
    if is_secret_path(path):
        notes.append("notify_log refused (secret path)")
        return None
    if not path.is_file():
        notes.append(f"notify_log missing: {sanitize_text(path.name, 40)}")
        return None
    svc = _normalize_service(path.stem, default="live", allowed=("live", "paper"))
    if path.suffix.lower() == ".json":
        return _collect_notify_json(path, as_of, svc, notes)
    latest_dt: datetime | None = None
    try:
        with path.open("r", encoding="utf-8", errors="replace") as fh:
            for line in _read_bounded_lines(fh):
                if not _DAILY_SUMMARY_RE.search(line) or _NOTIFY_FAIL_RE.search(line):
                    continue
                m = _ISO_TS_RE.search(line)
                dt = _parse_iso(m.group(1)) if m else None
                if dt is None:
                    dm = _DATE_RE.search(line)
                    dt = _parse_iso(dm.group(1)) if dm else None
                if dt is not None and (latest_dt is None or dt > latest_dt):
                    latest_dt = dt
    except OSError as error:
        notes.append(f"notify_log unreadable: {sanitize_text(error.strerror or str(error), 60)}")
        return None
    out: dict[str, Any] = {"service": svc, "active": True}
    if latest_dt is not None:
        out["last_daily_summary_at"] = latest_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
        out["last_daily_summary_age_h"] = round(max(0.0, (as_of - latest_dt).total_seconds()) / 3600.0, 2)
    else:
        out["missing"] = True
    return out


def _extract_compare_record(rec: dict[str, Any], default_svc: str) -> dict[str, Any]:
    unexp = rec.get("unexplained")
    count = max(_as_int(rec.get("unexplained_count")) or 0, len(unexp) if isinstance(unexp, list) else 0)
    orders_differ = bool(rec.get("orders_differ", False))
    positions_differ = bool(rec.get("positions_differ", False))
    summary = rec.get("summary")
    if isinstance(summary, dict):
        for key in ("equity_unexplained_minutes", "unexplained_count", "unexplained"):
            val = summary.get(key)
            if isinstance(val, list):
                count = max(count, len(val))
            elif (ival := _as_int(val)) is not None:
                count = max(count, ival)
        if any((_as_int(summary.get(k)) or 0) > 0 for k in ("differs", "run_only", "replay_only")):
            orders_differ = True
    groups = rec.get("groups")
    if isinstance(groups, list):
        unexp_groups = sum(1 for g in groups if isinstance(g, dict) and str(g.get("cause") or "").lower() == "unexplained")
        count = max(count, unexp_groups)
    return {
        "service": _normalize_service(rec.get("service") or rec.get("mode"), default=default_svc, allowed=("paper", "live", "engine")),
        "unexplained_count": count,
        "orders_differ": orders_differ,
        "positions_differ": positions_differ,
    }


def _collect_compares(compare_paths: list[Path], notes: list[str]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for path in compare_paths:
        raw, err = _read_json_bounded(path)
        if err is not None:
            notes.append(f"compare {sanitize_text(path.name, 40)}: {err}")
            continue
        default_svc = _normalize_service(path.stem, default="engine", allowed=("paper", "live", "engine"))
        items = [raw] if isinstance(raw, dict) else ([x for x in raw if isinstance(x, dict)] if isinstance(raw, list) else [])
        out.extend(_extract_compare_record(rec, default_svc) for rec in items)
    return out


def _collect_ledger(ledger_path: Path, as_of: datetime, notes: list[str]) -> dict[str, Any] | None:
    raw, err = _read_json_bounded(ledger_path)
    if err is not None:
        notes.append(f"ledger_status: {err}")
        return None
    if not isinstance(raw, dict):
        notes.append("ledger_status must be a JSON object")
        return None
    out: dict[str, Any] = {}
    behind = _as_int(raw.get("backup_behind_commits"))
    if behind is not None:
        out["backup_behind_commits"] = behind
    for key, ts_key in (("backup_lag_s", "last_backup_at"), ("mirror_lag_s", "last_mirror_push_at")):
        val = _as_float(raw.get(key))
        if val is not None:
            out[key] = val
        elif raw.get(ts_key) is not None:
            dt = _parse_iso(raw.get(ts_key))
            if dt is not None:
                out[key] = round(max(0.0, (as_of - dt).total_seconds()), 1)
    if "mirror_diverged" in raw:
        out["mirror_diverged"] = bool(raw.get("mirror_diverged"))
    return out


def _collect_service_root(
    root: Path | None, service: str, ref_dt: datetime,
    active_runs: list[dict[str, Any]], orphans: list[dict[str, Any]], notes: list[str],
) -> None:
    if root is None:
        return
    if is_secret_path(root) or not root.is_dir():
        notes.append(f"{service}_root skipped (missing or secret)")
        return
    for rdir in _iter_run_dirs(root, notes):
        _inspect_run_dir(rdir, service, ref_dt, active_runs, orphans)


def _collect_notify_entries(
    notify_logs: list[Path] | None, live_root: Path | None, ref_dt: datetime, notes: list[str],
) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    for npath in notify_logs or []:
        entry = _collect_notify_log(npath, ref_dt, notes)
        if entry is not None:
            entries.append(entry)
    if not entries and live_root is not None and (live_root / "notify" / "state.json").is_file():
        entry = _collect_notify_json(live_root / "notify" / "state.json", ref_dt, "live", notes)
        if entry is not None:
            entries.append(entry)
    return entries


def collect_prod_snapshot(
    *,
    market_dir: Path | None = None,
    paper_root: Path | None = None,
    live_root: Path | None = None,
    compare_jsons: list[Path] | None = None,
    notify_logs: list[Path] | None = None,
    ledger_status_json: Path | None = None,
    as_of: str | None = None,
) -> dict[str, Any]:
    """Assemble a redacted, credential-free production state snapshot from read-only paths."""
    ref_dt = _parse_iso(as_of) if as_of else datetime.now(UTC)
    if ref_dt is None:
        raise SystemExit(f"invalid --as-of timestamp: {sanitize_text(str(as_of), 60)}")
    notes: list[str] = []
    snapshot: dict[str, Any] = {"as_of": ref_dt.strftime("%Y-%m-%dT%H:%M:%SZ")}

    if market_dir is not None and (market_info := _collect_market(market_dir, notes)) is not None:
        snapshot["market"] = market_info

    active_runs: list[dict[str, Any]] = []
    orphans: list[dict[str, Any]] = []
    _collect_service_root(paper_root, "paper", ref_dt, active_runs, orphans, notes)
    _collect_service_root(live_root, "live", ref_dt, active_runs, orphans, notes)
    if active_runs:
        snapshot["paper"] = {"runs": active_runs}
    if orphans:
        snapshot["unsealed_orphans"] = orphans

    if compare_jsons and (compares := _collect_compares(compare_jsons, notes)):
        snapshot["compare"] = compares
    if notify_entries := _collect_notify_entries(notify_logs, live_root, ref_dt, notes):
        snapshot["notify"] = notify_entries
    if ledger_status_json is not None and (ledger_info := _collect_ledger(ledger_status_json, ref_dt, notes)) is not None:
        snapshot["ledger"] = ledger_info
    if notes:
        snapshot["collector_notes"] = [sanitize_text(n, 120) for n in notes[:20]]
    return snapshot


def compact_summary(friction_data: dict[str, Any] | None) -> dict[str, Any] | None:
    """Return a concise `prod_state_summary` block for `scheduler.advise`."""
    ps = friction_data.get("prod_state_summary") if friction_data else None
    if not isinstance(ps, dict):
        return None
    viols = ps.get("violations") or []
    return {
        "state_count": ps.get("state_count", 0),
        "affected_objects": list(ps.get("affected_objects") or []),
        "violation_count": len(viols),
        "invariants_triggered": sorted({str(v.get("invariant")) for v in viols if isinstance(v, dict) and v.get("invariant")}),
    }


def run_prod_snapshot_cmd(args: Any) -> None:
    """CLI handler for `doctor.py prod-snapshot`."""
    snapshot = collect_prod_snapshot(
        market_dir=args.market_dir,
        paper_root=args.paper_root,
        live_root=args.live_root,
        compare_jsons=list(args.compare_json or []) or None,
        notify_logs=list(args.notify_log or []) or None,
        ledger_status_json=args.ledger_status_json,
        as_of=args.as_of,
    )
    rendered = json.dumps(snapshot, indent=1)
    if args.out:
        if is_secret_path(args.out):
            raise SystemExit(f"refusing to write snapshot to secret path: {args.out}")
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(rendered + "\n", encoding="utf-8")
    print(rendered)


def register_prod_snapshot_parser(commands: Any) -> None:
    """Attach the `prod-snapshot` subcommand to `doctor.py`'s argparse subparsers."""
    snap_p = commands.add_parser("prod-snapshot", help="strictly read-only collector that builds a redacted state.json for --prod-state")
    snap_p.add_argument("--market-dir", type=Path, help="read-only market directory to inspect for head staleness")
    snap_p.add_argument("--paper-root", type=Path, help="read-only paper root directory to inspect for checkpoint stalls and unsealed orphans")
    snap_p.add_argument("--live-root", type=Path, help="read-only live root directory to inspect for unsealed orphans and notify state (secrets refused)")
    snap_p.add_argument("--compare-json", type=Path, nargs="+", help="one or more read-only paper/live compare JSON files")
    snap_p.add_argument("--notify-log", type=Path, nargs="+", help="one or more read-only notification log/state files for daily summary heartbeat")
    snap_p.add_argument("--ledger-status-json", type=Path, help="read-only ledger backup/mirror status JSON (never dolt/service.json)")
    snap_p.add_argument("--as-of", help="reference UTC ISO-8601 timestamp (default: current UTC time)")
    snap_p.add_argument("--out", type=Path, help="optional output path to write the redacted snapshot JSON")
    snap_p.set_defaults(function=run_prod_snapshot_cmd)
