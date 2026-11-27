"""L4 operational silent invariants for Market, Ledger, and Deploy/Ops (product-doctor v3.2).

Extends `prod_invariants.py` with three deterministic, strictly read-only invariants:
  7. market_archive_integrity    - 0-byte/0-row/corrupt Parquet (pure-stdlib PAR1 + Thrift footer),
                                   non-monotonic/duplicate months, >20% symbol drop, delisted residue,
                                   or exchange schema drift -> owning object `market`
  8. ledger_public_hygiene       - private Paper/Live tables, private markers, or credential patterns
                                   in public ledger exports; stale (>30d) or failed restore drill; or
                                   backup divergence/checksum mismatch -> owning object `ledger`
  9. ops_disk_and_deploy_health  - disk utilization (>=85% or <10 GiB free), retained image/GHCR drift
                                   (>max_retained or >35d), container restart loop (>=5/24h), or
                                   non-stdlib imports in `deploy/*.py` (AST) -> owning object `deploy`

Pure Python standard library; strictly read-only; refuses secret files and redacts all summaries.
"""

from __future__ import annotations

import ast
from datetime import UTC, datetime
import json
import math
from pathlib import Path
import re
import struct
import sys
from typing import Any

DEFAULT_MAX_SYMBOLS_DROP_PCT = 20.0
DEFAULT_MAX_RESTORE_DRILL_AGE_DAYS = 30.0
DEFAULT_MAX_DISK_USED_PCT = 85.0
DEFAULT_MIN_FREE_GIB = 10.0
DEFAULT_MAX_RETAINED_IMAGES = 10
DEFAULT_MAX_GHCR_CLEANUP_DAYS = 35.0
DEFAULT_MAX_RESTART_COUNT_24H = 5

MAX_JSON_BYTES = 2 * 1024 * 1024
MAX_EXPORT_SCAN_BYTES = 256 * 1024
MAX_PARQUET_FOOTER_BYTES = 16 * 1024 * 1024
MAX_SCAN_ENTRIES = 5000
MAX_SUMMARY_LEN = 160
MAX_THRIFT_ITEMS = 1_000_000
MAX_THRIFT_DEPTH = 32

_SECRET_BASENAME_TOKENS = ("secret", "credential", "token", "key", "passwd", "password")
_SECRET_EXTENSIONS = frozenset({".pem", ".p12", ".pfx", ".key"})
_SKIP_DIRS = frozenset({"__pycache__", ".venv", "node_modules", ".git"})
_EXPORT_TEXT_EXTENSIONS = frozenset({
    ".sql", ".json", ".jsonl", ".csv", ".tsv", ".txt", ".md", ".yaml", ".yml", ".toml", ".manifest", "",
})
_MONTH_STRICT_RE = re.compile(r"^20\d{2}-(?:0[1-9]|1[0-2])$")
_MONTH_PARTITION_RE = re.compile(r"(?<!\d)(20\d{2}-(?:0[1-9]|1[0-2]))(?!-\d{2})(?!\d)")

_PRIVATE_TABLE_NAMES = frozenset({
    "paper_runs", "paper_run", "paper_source", "paper_seal", "paper_file",
    "live_runs", "live_run", "live_orders", "live_fills", "live_positions",
    "execution_runs", "execution_records",
})
_PRIVATE_TABLE_RE = re.compile(
    r"\b(paper_runs?|paper_source|paper_seal|paper_file|"
    r"live_runs?|live_orders|live_fills|live_positions|execution_runs|execution_records)\b",
    re.IGNORECASE,
)
_PRIVATE_MARKER_RE = re.compile(
    r"\b(private_root|live_private_root|paper_db|paper_token|dolt/service\.json)\b",
    re.IGNORECASE,
)
_CREDENTIAL_LEAK_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"://[^/\s:@]+:[^/\s@]+@"),
    re.compile(r"(?i)\bAuthorization\s*:\s*(?:Bearer|Basic|Token)\s+\S+"),
    re.compile(r"\b\d{6,12}:[A-Za-z0-9_-]{20,}\b"),
    re.compile(r"(?i)\b(?:BINANCE_API_KEY|BINANCE_API_SECRET)\b"),
    re.compile(
        r"(?i)\b[A-Za-z0-9_-]*(?:api[_-]?key|api[_-]?secret|access[_-]?token|auth[_-]?token|"
        r"refresh[_-]?token|bot[_-]?token|password|passwd|secret)\s*[=:]\s*['\"]?[A-Za-z0-9._~+/=-]{8,}"
    ),
    re.compile(
        r"\b(?:sk-(?:ant-|proj-)?[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9_]{8,}|github_pat_[A-Za-z0-9_]{8,}|"
        r"AKIA[0-9A-Z]{12,}|AIza[0-9A-Za-z_-]{16,}|xox[baprs]-[A-Za-z0-9-]{8,})\b"
    ),
    re.compile(r"\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9._-]{6,}"),
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
            r"(?i)([A-Za-z0-9_-]*(?:api[_-]?key|api[_-]?secret|access[_-]?token|auth[_-]?token|"
            r"refresh[_-]?token|token|secret|password|passwd|pwd|cookie))(\s*[=:]\s*)\S+"
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

MARKET_INTEGRITY_META_KEYS = (
    "corrupt_files",
    "zero_byte_files",
    "zero_row_files",
    "non_monotonic_months",
    "duplicate_months",
    "month_partitions",
    "active_symbols_drop_pct",
    "active_symbols",
    "prev_active_symbols",
    "delisted_blocking_head",
    "schema_drift_count",
    "max_symbols_drop_pct",
)

LEDGER_HYGIENE_META_KEYS = (
    "public_export_private_tables",
    "public_export_private_markers",
    "exported_tables",
    "private_table_leaks",
    "private_marker_leaks",
    "credential_leaks",
    "last_restore_ok",
    "last_restore_drill_age_days",
    "last_restore_drill_at",
    "max_restore_drill_age_days",
    "backup_diverged",
    "backup_checksum_mismatch",
    "mirror_checksum_mismatch",
    "backup_missing",
    "backup_head_mismatch",
    "mirror_head_mismatch",
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
    if name == ".env" or name.startswith(".env.") or name == "telegram.json":
        return True
    if candidate.suffix.lower() in _SECRET_EXTENSIONS:
        return True
    if any(tok in name for tok in _SECRET_BASENAME_TOKENS):
        return True
    parts = [p.lower() for p in candidate.parts]
    for idx in range(len(parts) - 1):
        if parts[idx] == "dolt" and parts[idx + 1] == "service.json":
            return True
    return ".env" in parts


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


def _read_optional_int(
    mapping: dict[str, Any], key: str, label: str, bad_fields: list[str],
) -> int | None:
    raw = mapping.get(key)
    if raw is None:
        return None
    val = _as_int(raw)
    if val is None:
        bad_fields.append(label)
    return val


def _read_optional_float(
    mapping: dict[str, Any], key: str, label: str, bad_fields: list[str],
) -> float | None:
    raw = mapping.get(key)
    if raw is None:
        return None
    val = _as_float(raw)
    if val is None:
        bad_fields.append(label)
    return val


def _resolve_age_days(
    mapping: dict[str, Any],
    age_key: str,
    ts_key: str,
    as_of: datetime,
    bad_fields: list[str],
    prefix: str,
) -> float | None:
    if mapping.get(age_key) is not None:
        return _read_optional_float(mapping, age_key, f"{prefix}.{age_key}", bad_fields)
    if mapping.get(ts_key) is not None:
        dt = _parse_iso(mapping.get(ts_key))
        if dt is None:
            bad_fields.append(f"{prefix}.{ts_key}")
            return None
        return round(max(0.0, (as_of - dt).total_seconds()) / 86400.0, 2)
    return None


# ---------------------------------------------------------------------------
# Pure-stdlib Parquet magic + Thrift Compact Protocol footer inspector
# ---------------------------------------------------------------------------

def _decode_varint(buf: bytes, pos: int) -> tuple[int, int]:
    shift = 0
    val = 0
    n = len(buf)
    while pos < n:
        byte = buf[pos]
        pos += 1
        val |= (byte & 0x7F) << shift
        if not (byte & 0x80):
            return val, pos
        shift += 7
        if shift > 70:
            raise ValueError("varint overflow")
    raise ValueError("truncated varint")


def _decode_zigzag(num: int) -> int:
    return (num >> 1) ^ -(num & 1)


def _skip_thrift_container(buf: bytes, pos: int, ttype: int, depth: int) -> int:
    if ttype in (9, 10):
        if pos >= len(buf):
            raise ValueError("truncated list header")
        hdr = buf[pos]
        pos += 1
        size = (hdr >> 4) & 0x0F
        elem_type = hdr & 0x0F
        if size == 15:
            size, pos = _decode_varint(buf, pos)
        if size > MAX_THRIFT_ITEMS:
            raise ValueError("thrift list too large")
        for _ in range(size):
            pos = _skip_thrift_value(buf, pos, elem_type, depth + 1)
        return pos
    size, pos = _decode_varint(buf, pos)
    if size > MAX_THRIFT_ITEMS:
        raise ValueError("thrift map too large")
    if size == 0:
        return pos
    if pos >= len(buf):
        raise ValueError("truncated map types")
    kv = buf[pos]
    pos += 1
    kt, vt = (kv >> 4) & 0x0F, kv & 0x0F
    for _ in range(size):
        pos = _skip_thrift_value(buf, pos, kt, depth + 1)
        pos = _skip_thrift_value(buf, pos, vt, depth + 1)
    return pos


def _skip_thrift_struct(buf: bytes, pos: int, depth: int) -> int:
    n = len(buf)
    while pos < n:
        hdr = buf[pos]
        pos += 1
        if hdr == 0:
            return pos
        delta = (hdr >> 4) & 0x0F
        ftype = hdr & 0x0F
        if delta == 0:
            _, pos = _decode_varint(buf, pos)
        pos = _skip_thrift_value(buf, pos, ftype, depth + 1)
    raise ValueError("unterminated thrift struct")


def _skip_thrift_value(buf: bytes, pos: int, ttype: int, depth: int = 0) -> int:
    if depth > MAX_THRIFT_DEPTH:
        raise ValueError("thrift nesting exceeded")
    if ttype in (1, 2):
        return pos
    if ttype == 3:
        if pos + 1 > len(buf):
            raise ValueError("truncated byte")
        return pos + 1
    if ttype in (4, 5, 6):
        _, pos = _decode_varint(buf, pos)
        return pos
    if ttype == 7:
        if pos + 8 > len(buf):
            raise ValueError("truncated double")
        return pos + 8
    if ttype == 8:
        length, pos = _decode_varint(buf, pos)
        if length < 0 or pos + length > len(buf):
            raise ValueError("truncated binary")
        return pos + length
    if ttype in (9, 10, 11):
        return _skip_thrift_container(buf, pos, ttype, depth)
    if ttype == 12:
        return _skip_thrift_struct(buf, pos, depth)
    raise ValueError(f"unknown thrift type {ttype}")


def _parse_parquet_num_rows(footer: bytes) -> int | None:
    """Parse Parquet FileMetaData Thrift Compact Protocol footer and return field 3 (`num_rows`)."""
    pos = 0
    field_id = 0
    num_rows: int | None = None
    saw_version = False
    n = len(footer)
    while pos < n:
        hdr = footer[pos]
        pos += 1
        if hdr == 0:
            break
        delta = (hdr >> 4) & 0x0F
        ftype = hdr & 0x0F
        if delta == 0:
            zz, pos = _decode_varint(footer, pos)
            field_id = _decode_zigzag(zz)
        else:
            field_id += delta
        if field_id == 1 and ftype == 5:
            _, pos = _decode_varint(footer, pos)
            saw_version = True
        elif field_id == 3 and ftype == 6:
            zz, pos = _decode_varint(footer, pos)
            num_rows = _decode_zigzag(zz)
        else:
            pos = _skip_thrift_value(footer, pos, ftype, 1)
    if not saw_version or num_rows is None or num_rows < 0:
        return None
    return num_rows


def inspect_parquet_file(path: Path) -> dict[str, Any]:
    """Validate Parquet PAR1 magic, footer length, Thrift FileMetaData, and row count in pure stdlib."""
    if is_secret_path(path):
        return {"status": "skipped", "reason": "secret file refused", "num_rows": None}
    try:
        size = path.stat().st_size
    except OSError:
        return {"status": "corrupt", "reason": "unreadable file", "num_rows": None}
    if size == 0:
        return {"status": "zero_byte", "reason": "0-byte parquet file", "num_rows": 0}
    if size < 12:
        return {"status": "corrupt", "reason": "file smaller than 12-byte parquet structure", "num_rows": None}
    try:
        with path.open("rb") as fh:
            head = fh.read(4)
            fh.seek(size - 8)
            tail = fh.read(8)
            if head != b"PAR1" or tail[4:8] != b"PAR1":
                return {"status": "corrupt", "reason": "missing PAR1 magic bytes", "num_rows": None}
            footer_len = struct.unpack("<I", tail[:4])[0]
            if footer_len == 0 or footer_len > size - 12 or footer_len > MAX_PARQUET_FOOTER_BYTES:
                return {"status": "corrupt", "reason": f"invalid footer_len={footer_len}", "num_rows": None}
            fh.seek(size - 8 - footer_len)
            footer = fh.read(footer_len)
    except OSError:
        return {"status": "corrupt", "reason": "read error", "num_rows": None}
    if len(footer) != footer_len:
        return {"status": "corrupt", "reason": "truncated footer", "num_rows": None}
    try:
        num_rows = _parse_parquet_num_rows(footer)
    except ValueError as err:
        return {"status": "corrupt", "reason": sanitize_text(str(err), 60), "num_rows": None}
    if num_rows is None:
        return {"status": "corrupt", "reason": "missing or invalid parquet FileMetaData", "num_rows": None}
    if num_rows == 0:
        return {"status": "zero_row", "reason": "0-row parquet file", "num_rows": 0}
    return {"status": "ok", "reason": None, "num_rows": num_rows}


# ---------------------------------------------------------------------------
# Dimension 1: Market Data L4 (`market_archive_integrity`)
# ---------------------------------------------------------------------------

def _analyze_month_sequence(seq: list[Any], bad_fields: list[str]) -> tuple[int, int]:
    months: list[str] = []
    for item in seq:
        if isinstance(item, str) and _MONTH_STRICT_RE.fullmatch(item.strip()):
            months.append(item.strip())
        else:
            bad_fields.append("market.month_partitions")
            return 0, 0
    non_mono = sum(1 for prev, cur in zip(months, months[1:], strict=False) if cur < prev)
    dups = len(months) - len(set(months))
    return non_mono, dups


def _check_month_partitions(raw: Any, bad_fields: list[str]) -> tuple[int, int]:
    if raw is None:
        return 0, 0
    if isinstance(raw, list):
        return _analyze_month_sequence(raw, bad_fields)
    if isinstance(raw, dict):
        total_non_mono = 0
        total_dups = 0
        for val in raw.values():
            if not isinstance(val, list):
                bad_fields.append("market.month_partitions")
                continue
            nm, dp = _analyze_month_sequence(val, bad_fields)
            total_non_mono += nm
            total_dups += dp
        return total_non_mono, total_dups
    bad_fields.append("market.month_partitions")
    return 0, 0


def _compute_symbol_drop_pct(market: dict[str, Any], bad_fields: list[str]) -> float | None:
    explicit = _read_optional_float(market, "active_symbols_drop_pct", "market.active_symbols_drop_pct", bad_fields)
    if explicit is not None:
        return explicit
    prev = _read_optional_int(market, "prev_active_symbols", "market.prev_active_symbols", bad_fields)
    cur_key = "active_symbols" if market.get("active_symbols") is not None else "active_usdt_perps"
    cur = _read_optional_int(market, cur_key, f"market.{cur_key}", bad_fields)
    if prev is not None and cur is not None and prev > 0 and cur < prev:
        return round(((prev - cur) / prev) * 100.0, 2)
    return None


def _check_market_archive_integrity(
    data: dict[str, Any],
    thresholds: dict[str, Any],
    file_name: str,
    violations: list[dict[str, Any]],
    triggers: list[str],
    affected: set[str],
    bad_fields: list[str],
) -> None:
    market = data.get("market")
    if not isinstance(market, dict):
        return
    reasons: list[str] = []
    for key, label in (
        ("corrupt_files", "corrupt_files"),
        ("zero_byte_files", "zero_byte_files"),
        ("zero_row_files", "zero_row_files"),
        ("delisted_blocking_head", "delisted_blocking_head"),
        ("schema_drift_count", "schema_drift"),
    ):
        val = _read_optional_int(market, key, f"market.{key}", bad_fields)
        if val is not None and val > 0:
            reasons.append(f"{label}={val}")

    nm_raw = _read_optional_int(market, "non_monotonic_months", "market.non_monotonic_months", bad_fields) or 0
    dp_raw = _read_optional_int(market, "duplicate_months", "market.duplicate_months", bad_fields) or 0
    nm_seq, dp_seq = _check_month_partitions(market.get("month_partitions"), bad_fields)
    if nm_raw + nm_seq > 0:
        reasons.append(f"non_monotonic_months={nm_raw + nm_seq}")
    if dp_raw + dp_seq > 0:
        reasons.append(f"duplicate_months={dp_raw + dp_seq}")

    max_drop = _threshold_float(
        market.get("max_symbols_drop_pct"),
        thresholds.get("market_max_symbols_drop_pct"),
        DEFAULT_MAX_SYMBOLS_DROP_PCT,
    )
    drop_pct = _compute_symbol_drop_pct(market, bad_fields)
    if drop_pct is not None and drop_pct > max_drop:
        reasons.append(f"active_symbols_drop={drop_pct:.1f}% > {max_drop:.1f}%")

    if reasons:
        _record_violation(
            violations, triggers, affected,
            file_name=file_name, invariant="market_archive_integrity", obj="market",
            detail=", ".join(reasons),
        )


def _read_market_integrity_meta(market_dir: Path) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for meta_name in ("head.json", "status.json", "coverage.json", "state.json", "manifest.json"):
        cand = market_dir / meta_name
        if not cand.is_file():
            continue
        raw, err = _read_json_bounded(cand)
        if err is None and isinstance(raw, dict):
            for key in MARKET_INTEGRITY_META_KEYS:
                if key in raw and key not in out:
                    out[key] = raw[key]
    return out


def _tally_parquet_file(
    child: Path,
    market_dir: Path,
    counts: dict[str, int],
    seen_partitions: set[tuple[str, str, str]],
) -> None:
    counts["scanned"] += 1
    st = inspect_parquet_file(child)["status"]
    if st == "zero_byte":
        counts["zero_byte"] += 1
        counts["corrupt"] += 1
    elif st == "corrupt":
        counts["corrupt"] += 1
    elif st == "zero_row":
        counts["zero_row"] += 1
    m = _MONTH_PARTITION_RE.search(child.stem)
    if not m:
        return
    prefix = child.stem[: m.start()].rstrip("-_.")
    part_key = (str(child.parent.relative_to(market_dir)), prefix, m.group(1))
    if part_key in seen_partitions:
        counts["dup_months"] += 1
    else:
        seen_partitions.add(part_key)


def _walk_market_parquets(market_dir: Path, notes: list[str]) -> dict[str, int]:
    counts = {"scanned": 0, "corrupt": 0, "zero_byte": 0, "zero_row": 0, "dup_months": 0}
    seen_partitions: set[tuple[str, str, str]] = set()
    visited = 0
    stack = [market_dir]
    while stack and visited < MAX_SCAN_ENTRIES:
        cur = stack.pop()
        for child in _safe_dir_entries(cur, MAX_SCAN_ENTRIES - visited):
            visited += 1
            if is_secret_path(child):
                notes.append("skipped secret file under market_dir")
                continue
            if child.is_dir():
                if child.name not in _SKIP_DIRS and len(child.relative_to(market_dir).parts) < 5:
                    stack.append(child)
            elif child.suffix.lower() == ".parquet":
                _tally_parquet_file(child, market_dir, counts, seen_partitions)
    return counts


def collect_market_integrity(market_dir: Path, notes: list[str]) -> dict[str, Any]:
    """Read-only scan of `market_dir` for corrupt/0-byte/0-row Parquet files and duplicate month partitions."""
    if is_secret_path(market_dir) or not market_dir.is_dir():
        return {}
    out = _read_market_integrity_meta(market_dir)
    counts = _walk_market_parquets(market_dir, notes)
    if counts["scanned"] > 0:
        out["parquet_files_scanned"] = counts["scanned"]
        out["corrupt_files"] = max(_as_int(out.get("corrupt_files")) or 0, counts["corrupt"])
        out["zero_byte_files"] = max(_as_int(out.get("zero_byte_files")) or 0, counts["zero_byte"])
        out["zero_row_files"] = max(_as_int(out.get("zero_row_files")) or 0, counts["zero_row"])
    if counts["dup_months"] > 0:
        out["duplicate_months"] = max(_as_int(out.get("duplicate_months")) or 0, counts["dup_months"])
    return out


# ---------------------------------------------------------------------------
# Dimension 4: Ledger Public Hygiene & Restore Drill L4 (`ledger_public_hygiene`)
# ---------------------------------------------------------------------------

def _extract_string_list(raw: Any, label: str, bad_fields: list[str]) -> list[str]:
    if raw is None:
        return []
    if not isinstance(raw, list):
        bad_fields.append(label)
        return []
    out: list[str] = []
    for item in raw:
        if isinstance(item, str) and item.strip():
            out.append(sanitize_text(item.strip(), 48))
        else:
            bad_fields.append(f"{label}[]")
    return out


def _collect_ledger_hygiene_reasons(
    ledger: dict[str, Any], as_of: datetime, thresholds: dict[str, Any], bad_fields: list[str],
) -> list[str]:
    reasons: list[str] = []
    priv_tables = _extract_string_list(
        ledger.get("public_export_private_tables"), "ledger.public_export_private_tables", bad_fields
    )
    exported = _extract_string_list(ledger.get("exported_tables"), "ledger.exported_tables", bad_fields)
    priv_tables.extend(t for t in exported if t.lower() in _PRIVATE_TABLE_NAMES and t not in priv_tables)
    priv_table_cnt = _read_optional_int(ledger, "private_table_leaks", "ledger.private_table_leaks", bad_fields) or 0
    if priv_tables or priv_table_cnt > 0:
        sample = ",".join(priv_tables[:4]) if priv_tables else str(priv_table_cnt)
        reasons.append(f"private_tables={sample}")

    priv_markers = _extract_string_list(
        ledger.get("public_export_private_markers"), "ledger.public_export_private_markers", bad_fields
    )
    priv_marker_cnt = _read_optional_int(ledger, "private_marker_leaks", "ledger.private_marker_leaks", bad_fields) or 0
    cred_leaks = _read_optional_int(ledger, "credential_leaks", "ledger.credential_leaks", bad_fields) or 0
    if priv_markers or priv_marker_cnt > 0:
        sample = ",".join(priv_markers[:4]) if priv_markers else str(priv_marker_cnt)
        reasons.append(f"private_markers={sample}")
    if cred_leaks > 0:
        reasons.append(f"credential_leaks={cred_leaks}")

    restore_ok = ledger.get("last_restore_ok")
    if restore_ok is False:
        reasons.append("last_restore_ok=false")
    elif restore_ok is not None and not isinstance(restore_ok, bool):
        bad_fields.append("ledger.last_restore_ok")

    max_drill_days = _threshold_float(
        ledger.get("max_restore_drill_age_days"),
        thresholds.get("ledger_max_restore_drill_age_days"),
        DEFAULT_MAX_RESTORE_DRILL_AGE_DAYS,
    )
    drill_days = _resolve_age_days(
        ledger, "last_restore_drill_age_days", "last_restore_drill_at", as_of, bad_fields, "ledger"
    )
    if drill_days is not None and drill_days > max_drill_days:
        reasons.append(f"restore_drill_age={drill_days:.1f}d > {max_drill_days:.1f}d")

    for flag in (
        "backup_diverged", "backup_checksum_mismatch", "mirror_checksum_mismatch",
        "backup_missing", "backup_head_mismatch", "mirror_head_mismatch",
    ):
        val = ledger.get(flag)
        if val is True:
            reasons.append(f"{flag}=true")
        elif val is not None and not isinstance(val, bool):
            bad_fields.append(f"ledger.{flag}")
    return reasons


def _check_ledger_public_hygiene(
    data: dict[str, Any],
    as_of: datetime,
    thresholds: dict[str, Any],
    file_name: str,
    violations: list[dict[str, Any]],
    triggers: list[str],
    affected: set[str],
    bad_fields: list[str],
) -> None:
    ledger = data.get("ledger")
    if not isinstance(ledger, dict):
        return
    reasons = _collect_ledger_hygiene_reasons(ledger, as_of, thresholds, bad_fields)
    if reasons:
        _record_violation(
            violations, triggers, affected,
            file_name=file_name, invariant="ledger_public_hygiene", obj="ledger",
            detail=", ".join(reasons),
        )


def _scan_export_text_file(path: Path, tables: set[str], markers: set[str]) -> int:
    if path.suffix.lower() not in _EXPORT_TEXT_EXTENSIONS:
        return 0
    try:
        with path.open("rb") as fh:
            raw = fh.read(MAX_EXPORT_SCAN_BYTES)
    except OSError:
        return 0
    text = raw.decode("utf-8", errors="replace")
    for m in _PRIVATE_TABLE_RE.finditer(text):
        tables.add(m.group(1).lower())
    for m in _PRIVATE_MARKER_RE.finditer(text):
        markers.add(m.group(1).lower())
    cred_hits = sum(1 for pat in _CREDENTIAL_LEAK_PATTERNS if pat.search(text))
    if cred_hits > 0:
        markers.add("credential_pattern")
    return cred_hits


def collect_ledger_export_hygiene(export_dir: Path, notes: list[str]) -> dict[str, Any] | None:
    """Strictly read-only scan of a public ledger export directory for private tables, markers, or secrets."""
    if is_secret_path(export_dir):
        notes.append("ledger_export_dir refused (secret path)")
        return None
    if not export_dir.is_dir():
        notes.append("ledger_export_dir missing or not a directory")
        return None

    found_tables: set[str] = set()
    found_markers: set[str] = set()
    cred_leaks = 0
    scanned = 0
    visited = 0
    stack = [export_dir]
    while stack and visited < MAX_SCAN_ENTRIES:
        cur = stack.pop()
        for child in _safe_dir_entries(cur, MAX_SCAN_ENTRIES - visited):
            visited += 1
            if is_secret_path(child):
                # Never read secret file contents; flag presence in public export with a redacted label only.
                found_markers.add("secret_file_in_export")
                cred_leaks += 1
                notes.append("refused reading secret file inside ledger_export_dir")
                continue
            if child.is_dir():
                if child.name not in _SKIP_DIRS and len(child.relative_to(export_dir).parts) < 4:
                    stack.append(child)
                continue
            scanned += 1
            if child.stem.lower() in _PRIVATE_TABLE_NAMES:
                found_tables.add(child.stem.lower())
            cred_leaks += _scan_export_text_file(child, found_tables, found_markers)

    out: dict[str, Any] = {"export_files_scanned": scanned}
    if found_tables:
        out["public_export_private_tables"] = sorted(found_tables)[:10]
    if found_markers:
        out["public_export_private_markers"] = sorted(found_markers)[:10]
    if cred_leaks > 0:
        out["credential_leaks"] = cred_leaks
    return out


# ---------------------------------------------------------------------------
# Dimension 8: Deploy / Disk / Image / Container Ops L4 (`ops_disk_and_deploy_health`)
# ---------------------------------------------------------------------------

def _check_disk_entry(
    entry: dict[str, Any],
    max_used_pct: float,
    min_free_gib: float,
    label_prefix: str,
    reasons: list[str],
    bad_fields: list[str],
) -> None:
    mount = sanitize_text(str(entry.get("mount") or ""), 32)
    tag = f"{mount}:" if mount else ""
    used = _read_optional_float(entry, "disk_used_pct", f"{label_prefix}.disk_used_pct", bad_fields)
    if used is not None and used >= max_used_pct:
        reasons.append(f"{tag}disk_used={used:.1f}% >= {max_used_pct:.1f}%")
    free = _read_optional_float(entry, "free_gib", f"{label_prefix}.free_gib", bad_fields)
    if free is not None and free < min_free_gib:
        reasons.append(f"{tag}free_gib={free:.1f} < {min_free_gib:.1f}")


def _check_ops_disk_and_containers(
    ops: dict[str, Any], thresholds: dict[str, Any], reasons: list[str], bad_fields: list[str],
) -> None:
    max_disk_pct = _threshold_float(
        ops.get("max_disk_used_pct"), thresholds.get("ops_max_disk_used_pct"), DEFAULT_MAX_DISK_USED_PCT
    )
    min_free_gib = _threshold_float(
        ops.get("min_free_gib"), thresholds.get("ops_min_free_gib"), DEFAULT_MIN_FREE_GIB
    )
    _check_disk_entry(ops, max_disk_pct, min_free_gib, "ops", reasons, bad_fields)
    raw_disks = ops.get("disks")
    if isinstance(raw_disks, list):
        for item in raw_disks:
            if isinstance(item, dict):
                _check_disk_entry(item, max_disk_pct, min_free_gib, "ops.disks[]", reasons, bad_fields)
            else:
                bad_fields.append("ops.disks[]")
    elif raw_disks is not None:
        bad_fields.append("ops.disks")

    max_restarts = _threshold_int(
        ops.get("max_restart_count_24h"), thresholds.get("ops_max_restart_count_24h"), DEFAULT_MAX_RESTART_COUNT_24H
    )
    restarts = _read_optional_int(ops, "restart_count_24h", "ops.restart_count_24h", bad_fields)
    if restarts is not None and restarts >= max_restarts:
        reasons.append(f"restart_count_24h={restarts} >= {max_restarts}")
    raw_ctrs = ops.get("containers")
    if isinstance(raw_ctrs, list):
        for item in raw_ctrs:
            if not isinstance(item, dict):
                bad_fields.append("ops.containers[]")
                continue
            cnt = _read_optional_int(item, "restart_count_24h", "ops.containers[].restart_count_24h", bad_fields)
            if cnt is not None and cnt >= max_restarts:
                cname = sanitize_text(str(item.get("name") or "container"), 32)
                reasons.append(f"{cname}:restart_count_24h={cnt} >= {max_restarts}")
    elif raw_ctrs is not None:
        bad_fields.append("ops.containers")


def _check_ops_disk_and_deploy_health(
    data: dict[str, Any],
    as_of: datetime,
    thresholds: dict[str, Any],
    file_name: str,
    violations: list[dict[str, Any]],
    triggers: list[str],
    affected: set[str],
    bad_fields: list[str],
) -> None:
    ops = data.get("ops") if data.get("ops") is not None else data.get("deploy")
    if ops is None:
        return
    if not isinstance(ops, dict):
        bad_fields.append("ops")
        return

    reasons: list[str] = []
    _check_ops_disk_and_containers(ops, thresholds, reasons, bad_fields)

    max_ret_override = ops.get("max_retained") if ops.get("max_retained") is not None else ops.get("max_retained_images")
    max_retained = _threshold_int(max_ret_override, thresholds.get("ops_max_retained_images"), DEFAULT_MAX_RETAINED_IMAGES)
    unpruned = _read_optional_int(ops, "unpruned_images_count", "ops.unpruned_images_count", bad_fields)
    if unpruned is not None and unpruned > max_retained:
        reasons.append(f"unpruned_images={unpruned} > {max_retained}")

    max_ghcr_days = _threshold_float(
        ops.get("max_ghcr_cleanup_days"), thresholds.get("ops_max_ghcr_cleanup_days"), DEFAULT_MAX_GHCR_CLEANUP_DAYS
    )
    ghcr_days = _resolve_age_days(
        ops, "ghcr_cleanup_overdue_days", "last_ghcr_cleanup_at", as_of, bad_fields, "ops"
    )
    if ghcr_days is not None and ghcr_days > max_ghcr_days:
        reasons.append(f"ghcr_cleanup_overdue={ghcr_days:.1f}d > {max_ghcr_days:.1f}d")

    non_std = _read_optional_int(ops, "deploy_non_stdlib_imports", "ops.deploy_non_stdlib_imports", bad_fields)
    details = _extract_string_list(ops.get("deploy_non_stdlib_details"), "ops.deploy_non_stdlib_details", bad_fields)
    non_std_total = max(non_std or 0, len(details))
    if non_std_total > 0:
        sample = f" ({details[0]})" if details else ""
        reasons.append(f"deploy_non_stdlib_imports={non_std_total}{sample}")

    if reasons:
        _record_violation(
            violations, triggers, affected,
            file_name=file_name, invariant="ops_disk_and_deploy_health", obj="deploy",
            detail=", ".join(reasons),
        )


def _file_non_stdlib_imports(path: Path, rel_label: str, stdlib_names: set[str], siblings: set[str]) -> list[str]:
    try:
        with path.open("rb") as fh:
            raw = fh.read(MAX_JSON_BYTES + 1)
    except OSError:
        return []
    if len(raw) > MAX_JSON_BYTES:
        return []
    try:
        tree = ast.parse(raw.decode("utf-8", errors="replace"), filename=rel_label)
    except SyntaxError:
        return [f"{rel_label}:syntax_error"]
    found: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names = [alias.name.split(".")[0] for alias in node.names]
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            names = [node.module.split(".")[0]]
        else:
            continue
        found.extend(
            f"{rel_label}:{node.lineno}:{top}"
            for top in names
            if top not in stdlib_names and top != "deploy" and top not in siblings
        )
    return found


def _dir_sibling_modules(entries: list[Path]) -> set[str]:
    return {
        e.stem for e in entries if e.is_file() and e.suffix == ".py"
    } | {
        e.name for e in entries if e.is_dir() and (e / "__init__.py").is_file()
    }


def scan_deploy_stdlib_purity(repo_root: Path, notes: list[str] | None = None) -> dict[str, Any]:
    """Deterministically inspect `deploy/**/*.py` via AST and flag any non-stdlib / non-deploy import."""
    if is_secret_path(repo_root):
        if notes is not None:
            notes.append("repo_root refused (secret path)")
        return {}
    deploy_dir = repo_root / "deploy"
    if not deploy_dir.is_dir():
        if notes is not None:
            notes.append("deploy/ directory missing under repo_root")
        return {}

    stdlib_names = set(sys.stdlib_module_names) | set(sys.builtin_module_names) | {"__future__"}
    details: list[str] = []
    scanned = visited = 0
    stack = [deploy_dir]
    while stack and visited < MAX_SCAN_ENTRIES:
        cur = stack.pop()
        entries = _safe_dir_entries(cur, MAX_SCAN_ENTRIES - visited)
        siblings = _dir_sibling_modules(entries)
        for child in entries:
            visited += 1
            if is_secret_path(child):
                continue
            if child.is_dir() and child.name not in _SKIP_DIRS:
                stack.append(child)
            elif child.is_file() and child.suffix == ".py":
                scanned += 1
                rel = child.relative_to(repo_root).as_posix()
                details.extend(_file_non_stdlib_imports(child, rel, stdlib_names, siblings))

    out: dict[str, Any] = {
        "deploy_py_files_scanned": scanned,
        "deploy_non_stdlib_imports": len(details),
    }
    if details:
        out["deploy_non_stdlib_details"] = [sanitize_text(d, 80) for d in details[:20]]
    return out


_OPS_STATUS_KEYS = (
    "disk_used_pct", "free_gib", "max_disk_used_pct", "min_free_gib", "disks",
    "unpruned_images_count", "max_retained", "max_retained_images",
    "ghcr_cleanup_overdue_days", "max_ghcr_cleanup_days",
    "restart_count_24h", "max_restart_count_24h", "containers",
    "deploy_non_stdlib_imports", "deploy_non_stdlib_details",
)


def _read_ops_status_json(ops_status_json: Path, as_of: datetime, notes: list[str]) -> dict[str, Any]:
    raw, err = _read_json_bounded(ops_status_json)
    if err is not None:
        notes.append(f"ops_status: {err}")
        return {}
    if not isinstance(raw, dict):
        notes.append("ops_status must be a JSON object")
        return {}
    out = {k: raw[k] for k in _OPS_STATUS_KEYS if k in raw}
    if "ghcr_cleanup_overdue_days" not in out and raw.get("last_ghcr_cleanup_at") is not None:
        dt = _parse_iso(raw.get("last_ghcr_cleanup_at"))
        if dt is not None:
            out["ghcr_cleanup_overdue_days"] = round(max(0.0, (as_of - dt).total_seconds()) / 86400.0, 2)
    return out


def collect_ops_health(
    ops_status_json: Path | None,
    repo_root: Path | None,
    as_of: datetime,
    notes: list[str],
) -> dict[str, Any] | None:
    """Assemble read-only ops/deploy health fields from optional `--ops-status-json` and `--repo-root`."""
    out = _read_ops_status_json(ops_status_json, as_of, notes) if ops_status_json is not None else {}
    if repo_root is not None:
        purity = scan_deploy_stdlib_purity(repo_root, notes)
        if purity:
            out["deploy_py_files_scanned"] = purity["deploy_py_files_scanned"]
            prev_cnt = _as_int(out.get("deploy_non_stdlib_imports")) or 0
            out["deploy_non_stdlib_imports"] = max(prev_cnt, purity["deploy_non_stdlib_imports"])
            if purity.get("deploy_non_stdlib_details"):
                out["deploy_non_stdlib_details"] = purity["deploy_non_stdlib_details"]
    return out or None


# ---------------------------------------------------------------------------
# Entry point called by `prod_invariants._inspect_prod_state_file`
# ---------------------------------------------------------------------------

def evaluate_ops_invariants(
    data: dict[str, Any],
    as_of: datetime,
    thresholds: dict[str, Any],
    file_name: str,
    violations: list[dict[str, Any]],
    triggers: list[str],
    affected: set[str],
    bad_fields: list[str],
) -> None:
    """Evaluate silent invariants #7 (`market_archive_integrity`), #8 (`ledger_public_hygiene`),
    and #9 (`ops_disk_and_deploy_health`) on a parsed production snapshot."""
    _check_market_archive_integrity(data, thresholds, file_name, violations, triggers, affected, bad_fields)
    _check_ledger_public_hygiene(data, as_of, thresholds, file_name, violations, triggers, affected, bad_fields)
    _check_ops_disk_and_deploy_health(data, as_of, thresholds, file_name, violations, triggers, affected, bad_fields)
