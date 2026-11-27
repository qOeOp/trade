"""IDE/HTTP security surface probe (Dimension 7) and Skill/Eval statistical audit (Dimension 9) for product-doctor.

Provides two deterministic, pure-stdlib audit suites registered on `doctor.py`:
  1. `doctor.py surface`      — Static PP Supply Mono font integrity, dangerous sink / Host-before-URL scan,
                                `ide/web` <-> `ide/overview` API route contract parity, and optional active
                                loopback-only raw-socket HTTP/1.1 security & DoS contract probe.
  2. `doctor.py skills-audit` — Skill inventory & burden ratchet (`SKILL.md` / frontmatter / `references/`),
                                `.agents/evals/` completeness & symlink checks, optional multi-session
                                transcript skill-firing telemetry, and optional multi-run eval statistics
                                (exact Wilson score 95% CI, flakiness, under-sampling, baseline regression).

Pure Python standard library; strictly refuses non-loopback HTTP targets and never reads secret files.
"""

from __future__ import annotations

import argparse
from collections import Counter
import ipaddress
import json
import math
from pathlib import Path
import re
import socket
import subprocess
import sys
from typing import Any
from urllib.parse import urlsplit

_ASSETS_DIR = str(Path(__file__).resolve().parent)
if _ASSETS_DIR not in sys.path:
    sys.path.insert(0, _ASSETS_DIR)
import friction  # noqa: E402

_SECRET_BASENAME_TOKENS = ("secret", "credential", "passwd", "password")
_SECRET_STEMS = frozenset({"token", "tokens", "key", "keys", "apikey", "cookie", "cookies"})
_SECRET_COMPOUND_RE = re.compile(
    r"(?:api[_-]?key|private[_-]?key|priv[_-]?key|auth[_-]?token|access[_-]?token|"
    r"refresh[_-]?token|paper[_-]?token|bot[_-]?token|api[_-]?token|session[_-]?token|"
    r"bearer[_-]?token|id_rsa|id_ed25519)",
    re.IGNORECASE,
)
_SECRET_EXTENSIONS = frozenset({".pem", ".p12", ".pfx", ".key"})
MAX_JSON_BYTES = 2 * 1024 * 1024


def is_secret_path(path: Path) -> bool:
    """Return True if `path` looks like a credential or key file that must never be read."""
    name = path.name.lower()
    if name == ".env" or name.startswith(".env.") or name in ("service.json", "telegram.json"):
        return True
    if path.suffix.lower() in _SECRET_EXTENSIONS:
        return True
    if any(tok in name for tok in _SECRET_BASENAME_TOKENS) or _SECRET_COMPOUND_RE.search(name):
        return True
    return path.stem.lower() in _SECRET_STEMS


def _read_json_bounded(path: Path, max_bytes: int = MAX_JSON_BYTES) -> tuple[Any, str | None]:
    if is_secret_path(path):
        return None, f"refused secret file {path.name}"
    try:
        if not path.exists():
            return None, "file not found"
        if not path.is_file():
            return None, "not a regular file"
        if path.stat().st_size > max_bytes:
            return None, f"file exceeds {max_bytes} bytes"
        raw = path.read_text(encoding="utf-8", errors="replace")
        return json.loads(raw), None
    except (OSError, json.JSONDecodeError) as err:
        return None, str(err)

# Dimension 7 constants
REQUIRED_FONT_ASSETS = (
    "ide/web/fonts/Supply-Regular.otf",
    "ide/web/fonts/Supply-Medium.otf",
    "ide/web/fonts/Supply-Bold.otf",
)
FONT_WEIGHT_FILES = ("Supply-Regular.otf", "Supply-Medium.otf", "Supply-Bold.otf")
IDE_SOURCE_EXTS = frozenset({".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"})
TEST_FILE_RE = re.compile(r"\.(?:test|spec)\.(?:ts|tsx|js|jsx|mjs|cjs)$")
SKIP_DIRS = frozenset({"node_modules", "dist", ".next", "out", "build", "__pycache__"})

OVERVIEW_ROUTE_RE = re.compile(r"""["'`](/api/overview/[A-Za-z0-9_-]+)""")
DIRECT_EVAL_RE = re.compile(r"(?:(?<![.\w$])eval|\b(?:window|globalThis)\.eval|\bnew\s+Function)\s*\(")
HTML_SINK_RE = re.compile(r"(?:\.(?:innerHTML|outerHTML)\s*=|\bdocument\.write\s*\(|\binsertAdjacentHTML\s*\()")
DANGEROUS_JSX_RE = re.compile(r"dangerouslySetInnerHTML\s*=\s*\{([^}]*)\}")
AUDITED_ICON_EXPR_RE = re.compile(r"^\s*(?:BODIES|BRAND_BODIES)\.get\([^)]*\)\s*\?\?\s*EMPTY\s*$")
SECRET_LITERAL_RE = re.compile(
    r"""["'`](?:[^"'`]*dolt/service\.json|[^"'`]*(?:^|/)\.env(?:\.[A-Za-z0-9_.-]+)?)["'`]"""
)
SUPPLY_FONT_FACE_RE = re.compile(
    r"""@font-face\s*\{[^}]*font-family\s*:\s*["']Supply["'][^}]*\}""",
    re.DOTALL,
)
CSS_FONT_VAR_RE = re.compile(r"(--font-(?:sans|mono))\s*:\s*([^;]+);")
HTTP_STATUS_RE = re.compile(rb"^HTTP/1\.[01]\s+(\d{3})\b([^\r\n]*)")

# Dimension 9 constants
DEFAULT_MAX_SKILL_WORDS = 2500
DEFAULT_MAX_FRONTMATTER_WORDS = 120
WILSON_Z_95 = 1.959963984540054
MIN_RECOMMENDED_EVAL_RUNS = 12
FLAKY_MIN_RUNS = 4
FLAKY_LOW_RATE = 0.15
FLAKY_HIGH_RATE = 0.85

FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?)\n---\s*(?:\n|$)", re.DOTALL)
_HELP_FLAG_RE = re.compile(r"(?:^|\s)(?:--help|-h)(?:\s|$)")

# Command hints used to flag missed skill triggers across multi-session transcripts.
# Only match actual strategy-research write/run commands (not read-only debugging or --help).
SKILL_COMMAND_HINTS: dict[str, re.Pattern[str]] = {
    "product-doctor": re.compile(r"\b(?:doctor\.py|agent-finding)\b"),
    "research-round": re.compile(
        r"\bcli\.main\b[^\n;&|]*\b(?:registration\s+add|replay\s+(?:run|precheck|explore))\b"
    ),
    "research-start": re.compile(
        r"\bcli\.main\b[^\n;&|]*\bline\s+(?:open|close|select)\b"
    ),
    "nautilus-report-analysis": re.compile(r"\b(?:nautilus_trader|deflated_sharpe|tearsheet)\b|\btables\s*\(\s*\)"),
    "research-sources": re.compile(r"\b(?:openalex|crossref|semanticscholar|coinalyze|cftc)\b", re.IGNORECASE),
    "video-evidence": re.compile(r"\b(?:yt-dlp|ffmpeg|faster-whisper|whisper)\b"),
}


def _resolve_repo_root(root: Path | None) -> Path:
    if root is not None:
        return root.resolve()
    done = subprocess.run(
        ["git", "rev-parse", "--show-toplevel"],
        capture_output=True,
        text=True,
        check=False,
    )
    if done.returncode == 0 and done.stdout.strip():
        return Path(done.stdout.strip()).resolve()
    return Path.cwd().resolve()


_REGEX_PREV_CHARS = frozenset("(,=[!&|?:;{}\n+*-/%^~<>")
_REGEX_PREV_WORDS = frozenset({"return", "case", "throw", "typeof", "in", "of", "yield", "await", "delete", "void", "new"})


def _can_start_regex(out: list[str]) -> bool:
    idx = len(out) - 1
    while idx >= 0 and out[idx] in (" ", "\t", "\r"):
        idx -= 1
    if idx < 0 or out[idx] in _REGEX_PREV_CHARS:
        return True
    end = idx + 1
    while idx >= 0 and (out[idx].isalnum() or out[idx] in ("_", "$")):
        idx -= 1
    return "".join(out[idx + 1:end]) in _REGEX_PREV_WORDS


def _consume_regex_literal(source: str, i: int, out: list[str]) -> int:
    n = len(source)
    out.append(source[i])
    i += 1
    in_class = False
    while i < n and source[i] != "\n":
        ch = source[i]
        out.append(ch)
        if ch == "\\" and i + 1 < n and source[i + 1] != "\n":
            out.append(source[i + 1])
            i += 2
            continue
        if ch == "[":
            in_class = True
        elif ch == "]":
            in_class = False
        elif ch == "/" and not in_class:
            return i + 1
        i += 1
    return i


def _strip_js_comments(source: str) -> str:
    """Remove JS/TS `//` and `/* */` comments outside string and regex literals while preserving line numbers."""
    out: list[str] = []
    i = 0
    n = len(source)
    quote: str | None = None
    while i < n:
        ch = source[i]
        nxt = source[i + 1] if i + 1 < n else ""
        if quote is not None:
            out.append(ch)
            if ch == "\\" and i + 1 < n:
                out.append(nxt)
                i += 2
                continue
            if ch == quote:
                quote = None
            i += 1
            continue
        if ch in ("'", '"', "`"):
            quote = ch
            out.append(ch)
            i += 1
        elif ch == "/" and nxt == "/":
            i += 2
            while i < n and source[i] != "\n":
                out.append(" ")
                i += 1
        elif ch == "/" and nxt == "*":
            out.extend((" ", " "))
            i += 2
            while i < n and not (source[i] == "*" and i + 1 < n and source[i + 1] == "/"):
                out.append("\n" if source[i] == "\n" else " ")
                i += 1
            if i + 1 < n:
                out.extend((" ", " "))
                i += 2
        elif ch == "/" and _can_start_regex(out):
            i = _consume_regex_literal(source, i, out)
        else:
            out.append(ch)
            i += 1
    return "".join(out)


def _line_number(text: str, pos: int) -> int:
    return text.count("\n", 0, pos) + 1


# ============================================================================
# Dimension 7 — IDE, Font & HTTP Security Surface Audit
# ============================================================================


def _check_css_font_vars(
    text: str,
    rel_path: str,
    triggers: list[str],
) -> dict[str, Any]:
    vars_found: dict[str, str] = {}
    for match in CSS_FONT_VAR_RE.finditer(text):
        vars_found[match.group(1)] = match.group(2).strip()
    primary_ok: dict[str, bool] = {}
    for var_name in ("--font-sans", "--font-mono"):
        val = vars_found.get(var_name, "")
        if not val:
            primary_ok[var_name] = False
            triggers.append(f"font_declaration_missing ({rel_path}: missing {var_name})")
            continue
        first_family = val.split(",", 1)[0].strip().strip("\"'")
        is_supply = first_family == "Supply"
        primary_ok[var_name] = is_supply
        if not is_supply:
            triggers.append(
                f"font_family_order_changed ({rel_path}: {var_name} starts with {first_family!r}, expected 'Supply')"
            )
    return {"vars": vars_found, "primary_supply_ok": primary_ok}


def _check_css_font_faces(text: str, rel_path: str, triggers: list[str]) -> dict[str, Any]:
    blocks = SUPPLY_FONT_FACE_RE.findall(text)
    combined = "\n".join(blocks)
    weights_present = {wf: (wf in combined) for wf in FONT_WEIGHT_FILES}
    if not blocks:
        triggers.append(f"font_declaration_missing ({rel_path}: no @font-face for 'Supply')")
    else:
        for wf, ok in weights_present.items():
            if not ok:
                triggers.append(f"font_declaration_missing ({rel_path}: @font-face missing {wf})")
    return {"supply_face_count": len(blocks), "weights_present": weights_present}


def audit_font_integrity(root: Path) -> dict[str, Any]:
    """Verify PP Supply Mono font assets and CSS declarations in `ide/web/` and `docs-site/`."""
    triggers: list[str] = []
    assets: dict[str, dict[str, Any]] = {}
    for rel in REQUIRED_FONT_ASSETS:
        fpath = root / rel
        exists = fpath.is_file()
        size = fpath.stat().st_size if exists else 0
        ok = exists and size > 0
        assets[rel] = {"exists": exists, "bytes": size, "ok": ok}
        if not ok:
            triggers.append(f"font_asset_missing ({rel})")

    declarations: dict[str, Any] = {}
    ide_base = root / "ide/web/src/theme/base.css"
    ide_tokens = root / "ide/web/src/theme/tokens.css"
    docs_css = root / "docs-site/app/global.css"

    if ide_base.is_file():
        declarations["ide/web/src/theme/base.css"] = _check_css_font_faces(
            ide_base.read_text(encoding="utf-8", errors="replace"),
            "ide/web/src/theme/base.css",
            triggers,
        )
    else:
        declarations["ide/web/src/theme/base.css"] = {"missing": True}
        triggers.append("font_declaration_missing (ide/web/src/theme/base.css not found)")

    if ide_tokens.is_file():
        declarations["ide/web/src/theme/tokens.css"] = _check_css_font_vars(
            ide_tokens.read_text(encoding="utf-8", errors="replace"),
            "ide/web/src/theme/tokens.css",
            triggers,
        )
    else:
        declarations["ide/web/src/theme/tokens.css"] = {"missing": True}
        triggers.append("font_declaration_missing (ide/web/src/theme/tokens.css not found)")

    if docs_css.is_file():
        docs_text = docs_css.read_text(encoding="utf-8", errors="replace")
        declarations["docs-site/app/global.css"] = {
            **_check_css_font_faces(docs_text, "docs-site/app/global.css", triggers),
            **_check_css_font_vars(docs_text, "docs-site/app/global.css", triggers),
        }
    else:
        declarations["docs-site/app/global.css"] = {"missing": True}
        triggers.append("font_declaration_missing (docs-site/app/global.css not found)")

    return {
        "ok": not triggers,
        "assets": assets,
        "declarations": declarations,
        "triggers": triggers,
    }


def _iter_source_files(base_dir: Path) -> list[Path]:
    if not base_dir.is_dir():
        return []
    found: list[Path] = []
    for path in sorted(base_dir.rglob("*")):
        if not path.is_file() or path.suffix not in IDE_SOURCE_EXTS:
            continue
        if SKIP_DIRS.intersection(path.parts):
            continue
        if TEST_FILE_RE.search(path.name):
            continue
        found.append(path)
    return found


def _scan_file_security_patterns(
    rel_path: str,
    stripped: str,
    findings: list[dict[str, Any]],
    audited_static: list[dict[str, Any]],
) -> None:
    for kind, pattern in (
        ("direct_eval", DIRECT_EVAL_RE),
        ("unsanitized_html_sink", HTML_SINK_RE),
        ("secret_file_reference", SECRET_LITERAL_RE),
    ):
        findings.extend(
            {
                "kind": kind,
                "file": rel_path,
                "line": _line_number(stripped, m.start()),
                "match": m.group(0).strip(),
            }
            for m in pattern.finditer(stripped)
        )
    for m in DANGEROUS_JSX_RE.finditer(stripped):
        expr = m.group(1).strip()
        line = _line_number(stripped, m.start())
        if rel_path == "ide/web/src/icons/Icon.tsx" and AUDITED_ICON_EXPR_RE.match(expr):
            audited_static.append({"file": rel_path, "line": line, "expr": expr})
        else:
            findings.append({
                "kind": "unsanitized_html_sink",
                "file": rel_path,
                "line": line,
                "match": f"dangerouslySetInnerHTML={{{expr[:60]}}}",
            })


def _try_block_ranges(stripped: str) -> list[tuple[int, int]]:
    ranges: list[tuple[int, int]] = []
    n = len(stripped)
    for m in re.finditer(r"\btry\s*\{", stripped):
        start = m.end() - 1
        depth = 0
        quote: str | None = None
        i = start
        while i < n:
            ch = stripped[i]
            if quote is not None:
                if ch == "\\" and i + 1 < n:
                    i += 2
                    continue
                if ch == quote:
                    quote = None
            elif ch in ("'", '"', "`"):
                quote = ch
            elif ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    ranges.append((start, i))
                    break
            i += 1
    return ranges


def _check_overview_app_security(root: Path) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    app_path = root / "ide/overview/src/app.ts"
    if not app_path.is_file():
        return {"present": False}, [{"kind": "overview_app_missing", "file": "ide/overview/src/app.ts", "line": 0}]

    stripped = _strip_js_comments(app_path.read_text(encoding="utf-8", errors="replace"))
    host_match = re.search(r"\bhosts\.has\s*\(", stripped)
    url_matches = list(re.finditer(r"\bnew\s+URL\s*\(", stripped))
    try_ranges = _try_block_ranges(stripped)

    host_line = _line_number(stripped, host_match.start()) if host_match else None
    first_url = url_matches[0] if url_matches else None
    url_line = _line_number(stripped, first_url.start()) if first_url else None
    host_before_url = bool(host_match and all(host_match.start() < m.start() for m in url_matches))
    unguarded_lines = [
        _line_number(stripped, m.start()) for m in url_matches
        if not any(lo < m.start() < hi for lo, hi in try_ranges)
    ]
    url_parse_guarded = not unguarded_lines

    issues: list[dict[str, Any]] = []
    if host_match is None:
        issues.append({
            "kind": "overview_missing_host_check",
            "file": "ide/overview/src/app.ts",
            "line": 1,
            "detail": "no hosts.has(...) allowlist guard found",
        })
    elif not host_before_url:
        bad_line = next(_line_number(stripped, m.start()) for m in url_matches if m.start() < host_match.start())
        issues.append({
            "kind": "host_check_after_url_parse",
            "file": "ide/overview/src/app.ts",
            "line": bad_line,
            "detail": f"new URL() at line {bad_line} runs before hosts.has() at line {host_line}",
        })
    issues.extend({
        "kind": "unguarded_url_parse",
        "file": "ide/overview/src/app.ts",
        "line": bad_line,
        "detail": f"new URL() at line {bad_line} is not guarded by try/catch",
    } for bad_line in unguarded_lines)

    info = {
        "present": True,
        "host_check_line": host_line,
        "url_parse_line": url_line,
        "host_before_url": host_before_url,
        "url_parse_guarded": url_parse_guarded,
    }
    return info, issues


PYTHON_HTTP_SERVERS = (
    "paper/serve.py",
    "ide/research_graph/serve.py",
    "live/serve.py",
    "ledger/replica.py",
)
RAW_CL_INT_RE = re.compile(r"\bint\s*\([^)\n]*headers\.get\s*\(\s*['\"]Content-Length['\"]", re.IGNORECASE)


def _check_python_http_servers(root: Path) -> list[dict[str, Any]]:
    issues: list[dict[str, Any]] = []
    for rel in PYTHON_HTTP_SERVERS:
        path = root / rel
        if not path.is_file():
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        for m in RAW_CL_INT_RE.finditer(text):
            line_no = _line_number(text, m.start())
            window = text[m.start():m.start() + 300]
            if "< 0" not in window and "isdigit" not in window:
                issues.append({
                    "kind": "unguarded_content_length_parse",
                    "file": rel,
                    "line": line_no,
                    "detail": "int(headers.get('Content-Length')) without negative/digit validation",
                })
    return issues


def audit_ide_security_patterns(root: Path) -> dict[str, Any]:
    """Scan `ide/web/src/`, `ide/overview/src/`, and Python HTTP servers for dangerous sinks and parsing bugs."""
    findings: list[dict[str, Any]] = []
    audited_static: list[dict[str, Any]] = []
    files_scanned = 0
    for rel_dir in ("ide/web/src", "ide/overview/src"):
        for fpath in _iter_source_files(root / rel_dir):
            files_scanned += 1
            rel_path = fpath.relative_to(root).as_posix()
            stripped = _strip_js_comments(fpath.read_text(encoding="utf-8", errors="replace"))
            _scan_file_security_patterns(rel_path, stripped, findings, audited_static)

    overview_check, overview_issues = _check_overview_app_security(root)
    findings.extend(overview_issues)
    findings.extend(_check_python_http_servers(root))

    triggers = [
        f"{item['kind']} ({item['file']}:{item['line']})"
        for item in findings
    ]
    return {
        "ok": not findings,
        "files_scanned": files_scanned,
        "overview_app_guard": overview_check,
        "findings": findings,
        "audited_static_sinks": audited_static,
        "triggers": triggers,
    }


def audit_overview_route_parity(root: Path) -> dict[str, Any]:
    """Verify every `/api/overview/*` path called by `ide/web/src/` exists in `ide/overview/src/app.ts`."""
    web_routes: dict[str, list[str]] = {}
    for fpath in _iter_source_files(root / "ide/web/src"):
        rel = fpath.relative_to(root).as_posix()
        stripped = _strip_js_comments(fpath.read_text(encoding="utf-8", errors="replace"))
        for match in OVERVIEW_ROUTE_RE.finditer(stripped):
            route = match.group(1)
            web_routes.setdefault(route, [])
            if rel not in web_routes[route]:
                web_routes[route].append(rel)

    overview_routes: set[str] = set()
    app_path = root / "ide/overview/src/app.ts"
    if app_path.is_file():
        stripped_app = _strip_js_comments(app_path.read_text(encoding="utf-8", errors="replace"))
        overview_routes.update(OVERVIEW_ROUTE_RE.findall(stripped_app))

    missing_in_overview = sorted(set(web_routes) - overview_routes)
    unused_in_web = sorted(overview_routes - set(web_routes))
    triggers: list[str] = []
    if not app_path.is_file():
        triggers.append("overview_app_missing (ide/overview/src/app.ts)")
    if missing_in_overview:
        triggers.append(
            f"overview_route_contract_mismatch (missing in ide/overview/src/app.ts: {', '.join(missing_in_overview)})"
        )
    return {
        "ok": not triggers,
        "web_routes": {k: web_routes[k] for k in sorted(web_routes)},
        "overview_routes": sorted(overview_routes),
        "missing_in_overview": missing_in_overview,
        "unused_in_web": unused_in_web,
        "triggers": triggers,
    }


def _is_loopback_host(host: str) -> bool:
    cleaned = host.strip().lower()
    if cleaned.startswith("[") and cleaned.endswith("]"):
        cleaned = cleaned[1:-1]
    if not cleaned:
        return False
    if cleaned == "localhost":
        return True
    try:
        addr = ipaddress.ip_address(cleaned)
    except ValueError:
        return False
    if isinstance(addr, ipaddress.IPv6Address) and addr.ipv4_mapped is not None:
        return addr.ipv4_mapped.is_loopback
    return addr.is_loopback


def parse_loopback_http_target(target: str) -> tuple[str, int]:
    """Parse `host:port` (or `[::1]:port` / `http://host:port`) and refuse any non-loopback host."""
    raw = target.strip()
    if not raw:
        raise ValueError("empty --http-target")
    if "://" in raw:
        parsed = urlsplit(raw)
        if parsed.scheme != "http" or parsed.username or parsed.password:
            raise ValueError(f"unsupported --http-target scheme or credentials: {target!r}")
        host = parsed.hostname or ""
        port = parsed.port
    else:
        parsed = urlsplit(f"http://{raw}")
        if parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment:
            raise ValueError(f"invalid --http-target {target!r}: expected host:port")
        host = parsed.hostname or ""
        port = parsed.port
    if not host or port is None or not (1 <= port <= 65535):
        raise ValueError(f"invalid --http-target {target!r}: expected loopback host:port")
    if not _is_loopback_host(host):
        raise ValueError(
            f"refusing non-loopback --http-target {host!r}; only loopback targets (127.0.0.1, localhost, ::1) allowed"
        )
    return host, port


def _raw_http_exchange(host: str, port: int, raw_request: bytes, timeout: float) -> dict[str, Any]:
    """Send raw HTTP/1.1 bytes over a fresh loopback socket and parse the status line."""
    try:
        with socket.create_connection((host, port), timeout=timeout) as sock:
            sock.settimeout(timeout)
            sock.sendall(raw_request)
            buf = bytearray()
            while len(buf) < 8192:
                try:
                    chunk = sock.recv(4096)
                except TimeoutError:
                    return {
                        "status": None,
                        "status_line": "",
                        "disconnected": len(buf) == 0,
                        "error": "recv timed out",
                        "bytes_read": len(buf),
                    }
                if not chunk:
                    break
                buf.extend(chunk)
                if b"\r\n\r\n" in buf:
                    break
    except OSError as err:
        return {
            "status": None,
            "status_line": "",
            "disconnected": True,
            "error": f"{type(err).__name__}: {err}",
            "bytes_read": 0,
        }

    head = bytes(buf).split(b"\r\n", 1)[0]
    match = HTTP_STATUS_RE.match(head)
    if not match:
        return {
            "status": None,
            "status_line": head.decode("latin-1", errors="replace")[:120],
            "disconnected": len(buf) == 0,
            "error": "empty response (silent disconnect)" if not buf else "non-HTTP response",
            "bytes_read": len(buf),
        }
    return {
        "status": int(match.group(1)),
        "status_line": head.decode("latin-1", errors="replace")[:120],
        "disconnected": False,
        "error": None,
        "bytes_read": len(buf),
    }


def _http_probe_cases(trusted_host: str, health_path: str) -> list[tuple[str, bytes, tuple[int, ...]]]:
    return [
        (
            "untrusted_host_normal",
            f"GET {health_path} HTTP/1.1\r\nHost: evil.example\r\nConnection: close\r\n\r\n".encode("ascii"),
            (400, 403),
        ),
        (
            "untrusted_host_malformed_url",
            b"GET //x:99999/ HTTP/1.1\r\nHost: evil.example\r\nConnection: close\r\n\r\n",
            (400, 403),
        ),
        (
            "trusted_host_malformed_port_url",
            f"GET //x:99999/ HTTP/1.1\r\nHost: {trusted_host}\r\nConnection: close\r\n\r\n".encode("ascii"),
            (400,),
        ),
        (
            "trusted_host_backslash_url",
            f"GET /\\evil{health_path} HTTP/1.1\r\nHost: {trusted_host}\r\nConnection: close\r\n\r\n".encode("ascii"),
            (400, 404),
        ),
        (
            "non_get_method",
            f"POST /api/overview/snapshot HTTP/1.1\r\nHost: {trusted_host}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".encode(
                "ascii"
            ),
            (400, 405, 411, 413),
        ),
        (
            "conflicting_transfer_encoding",
            (
                f"GET {health_path} HTTP/1.1\r\nHost: {trusted_host}\r\n"
                "Transfer-Encoding: chunked\r\nTransfer-Encoding: identity\r\nConnection: close\r\n\r\n"
            ).encode("ascii"),
            (400, 405, 411, 413),
        ),
        (
            "invalid_content_length",
            (
                f"POST /api/overview/snapshot HTTP/1.1\r\nHost: {trusted_host}\r\n"
                "Content-Length: abc\r\nConnection: close\r\n\r\n"
            ).encode("ascii"),
            (400, 405, 411, 413),
        ),
        (
            "negative_content_length",
            (
                f"POST /api/overview/snapshot HTTP/1.1\r\nHost: {trusted_host}\r\n"
                "Content-Length: -1\r\nConnection: close\r\n\r\n"
            ).encode("ascii"),
            (400, 405, 411, 413),
        ),
    ]


def probe_http_surface(
    target: str,
    *,
    health_path: str = "/api/overview/health",
    trusted_host: str | None = None,
    timeout: float = 3.0,
) -> dict[str, Any]:
    """Run adversarial HTTP/1.1 security & DoS probes against an isolated loopback test server."""
    host, port = parse_loopback_http_target(target)
    host_header = trusted_host or (f"[{host}]:{port}" if ":" in host else f"{host}:{port}")
    clean_health = health_path if health_path.startswith("/") else f"/{health_path}"

    checks: list[dict[str, Any]] = []
    triggers: list[str] = []
    for name, payload, expected in _http_probe_cases(host_header, clean_health):
        resp = _raw_http_exchange(host, port, payload, timeout)
        status = resp["status"]
        passed = status in expected and not resp["disconnected"]
        checks.append({
            "case": name,
            "expected": list(expected),
            "status": status,
            "disconnected": resp["disconnected"],
            "error": resp["error"],
            "passed": passed,
        })
        if not passed:
            if resp["disconnected"] or status is None:
                triggers.append(f"http_probe_dos_disconnect ({name}: {resp['error'] or 'silent disconnect'})")
            else:
                triggers.append(f"http_probe_contract_violation ({name}: got {status}, expected {list(expected)})")

    liveness_req = f"GET {clean_health} HTTP/1.1\r\nHost: {host_header}\r\nConnection: close\r\n\r\n".encode("ascii")
    live_resp = _raw_http_exchange(host, port, liveness_req, timeout)
    liveness_ok = live_resp["status"] == 200 and not live_resp["disconnected"]
    checks.append({
        "case": "liveness_followup",
        "expected": [200],
        "status": live_resp["status"],
        "disconnected": live_resp["disconnected"],
        "error": live_resp["error"],
        "passed": liveness_ok,
    })
    if not liveness_ok:
        triggers.append(
            f"http_probe_dos_liveness_failed ({clean_health}: status={live_resp['status']}, error={live_resp['error']})"
        )

    return {
        "target": f"{host}:{port}",
        "trusted_host": host_header,
        "health_path": clean_health,
        "ok": not triggers,
        "liveness_ok": liveness_ok,
        "checks": checks,
        "triggers": triggers,
    }


def run_surface_audit(
    *,
    repo_root: Path | None = None,
    tree_rev: str | None = None,
    http_target: str | None = None,
    health_path: str = "/api/overview/health",
    trusted_host: str | None = None,
    timeout: float = 3.0,
) -> dict[str, Any]:
    """Run Dimension 7 static IDE/font/route audit and optional active loopback HTTP probe."""
    root = _resolve_repo_root(repo_root)
    fonts = audit_font_integrity(root)
    security = audit_ide_security_patterns(root)
    routes = audit_overview_route_parity(root)
    http_probe = (
        probe_http_surface(http_target, health_path=health_path, trusted_host=trusted_host, timeout=timeout)
        if http_target
        else None
    )
    triggers = [
        *fonts["triggers"],
        *security["triggers"],
        *routes["triggers"],
        *(http_probe["triggers"] if http_probe else []),
    ]
    out: dict[str, Any] = {
        "dimension": "D7_ide_http_surface",
        "repo_root": str(root),
        "ok": not triggers,
        "font_integrity": fonts,
        "security_patterns": security,
        "route_parity": routes,
        "http_probe": http_probe,
        "triggers": triggers,
    }
    if tree_rev is not None:
        out["tree"] = tree_rev
    return out


# ============================================================================
# Dimension 9 — Agent Skills, Burden Ratchet & Statistical Eval Audit
# ============================================================================


def _inspect_eval_case(case_dir: Path) -> list[str]:
    issues: list[str] = []
    if not (case_dir / "prompt.md").is_file():
        issues.append("missing:prompt.md")
    graders_dir = case_dir / "graders"
    if not graders_dir.is_dir():
        issues.append("missing:graders/")
        return issues

    grader_entries = sorted(graders_dir.iterdir())
    issues.extend(
        f"broken_symlink:graders/{entry.name}"
        for entry in grader_entries
        if entry.is_symlink() and not entry.exists()
    )

    sf = graders_dir / "skill-fired.md"
    cr = graders_dir / "criteria.md"
    if case_dir.name == "trigger-negative":
        valid_graders = [e for e in grader_entries if e.suffix == ".md" and e.is_file()]
        if not valid_graders:
            issues.append("missing:graders/*.md")
        return issues
    if case_dir.name == "trigger-positive":
        if not sf.is_file():
            issues.append("missing_or_broken:graders/skill-fired.md")
        return issues

    if not cr.is_file():
        issues.append("missing:graders/criteria.md")
    if not sf.is_file():
        issues.append("missing_or_broken:graders/skill-fired.md")
    return issues


def _inspect_one_skill(
    skill_dir: Path,
    evals_root: Path,
    max_skill_words: int,
    max_frontmatter_words: int,
    triggers: list[str],
) -> dict[str, Any]:
    name = skill_dir.name
    skill_md = skill_dir / "SKILL.md"
    text = skill_md.read_text(encoding="utf-8", errors="replace") if skill_md.is_file() else ""
    fm_match = FRONTMATTER_RE.match(text)
    fm_text = fm_match.group(1) if fm_match else ""
    fm_words = len(fm_text.split())
    skill_words = len(text.split())

    ref_dir = skill_dir / "references"
    ref_files = sorted(ref_dir.glob("*.md")) if ref_dir.is_dir() else []
    ref_words = sum(len(rf.read_text(encoding="utf-8", errors="replace").split()) for rf in ref_files)

    eval_dir = evals_root / name
    case_dirs = sorted(p for p in eval_dir.iterdir() if p.is_dir()) if eval_dir.is_dir() else []
    malformed_cases: dict[str, list[str]] = {}
    for case_dir in case_dirs:
        problems = _inspect_eval_case(case_dir)
        if problems:
            malformed_cases[case_dir.name] = problems
            triggers.append(f"malformed_eval_case ({name}/{case_dir.name}: {', '.join(problems)})")

    if not skill_md.is_file():
        triggers.append(f"skill_md_missing ({name})")
    if skill_words > max_skill_words:
        triggers.append(f"skill_md_bloat ({name}: {skill_words} > {max_skill_words} words)")
    if fm_words > max_frontmatter_words:
        triggers.append(f"frontmatter_bloat ({name}: {fm_words} > {max_frontmatter_words} words)")
    if len(case_dirs) == 0:
        triggers.append(f"missing_eval_coverage ({name}: 0 eval cases)")

    return {
        "frontmatter_words": fm_words,
        "skill_md_words": skill_words,
        "references_files": len(ref_files),
        "references_words": ref_words,
        "total_words": skill_words + ref_words,
        "eval_case_count": len(case_dirs),
        "malformed_eval_cases": malformed_cases,
    }


def audit_skill_inventory(
    root: Path,
    *,
    max_skill_words: int = DEFAULT_MAX_SKILL_WORDS,
    max_frontmatter_words: int = DEFAULT_MAX_FRONTMATTER_WORDS,
) -> dict[str, Any]:
    """Scan `.agents/skills/*/SKILL.md`, `references/*.md`, and `.agents/evals/<skill>/`."""
    skills_root = root / ".agents/skills"
    evals_root = root / ".agents/evals"
    triggers: list[str] = []
    skills: dict[str, dict[str, Any]] = {}

    if not skills_root.is_dir():
        triggers.append("skills_directory_missing (.agents/skills)")
    else:
        for skill_dir in sorted(p for p in skills_root.iterdir() if p.is_dir()):
            skills[skill_dir.name] = _inspect_one_skill(
                skill_dir, evals_root, max_skill_words, max_frontmatter_words, triggers
            )

    orphan_eval_suites = (
        [ed.name for ed in sorted(p for p in evals_root.iterdir() if p.is_dir()) if ed.name not in skills]
        if evals_root.is_dir()
        else []
    )

    return {
        "ok": not triggers,
        "skills_count": len(skills),
        "thresholds": {
            "max_skill_words": max_skill_words,
            "max_frontmatter_words": max_frontmatter_words,
        },
        "total_frontmatter_words": sum(s["frontmatter_words"] for s in skills.values()),
        "total_skill_md_words": sum(s["skill_md_words"] for s in skills.values()),
        "total_references_words": sum(s["references_words"] for s in skills.values()),
        "total_eval_cases": sum(s["eval_case_count"] for s in skills.values()),
        "orphan_eval_suites": orphan_eval_suites,
        "skills": skills,
        "triggers": triggers,
    }


def _inspect_transcript_skills(path: Path) -> dict[str, Any]:
    if is_secret_path(path):
        raise ValueError(f"refused secret file {path.name}")
    related_skills: set[str] = set()

    def _on_command(cmd: str) -> None:
        for seg in friction._split_shell_segments(cmd):
            if _HELP_FLAG_RE.search(seg):
                continue
            for sk, pat in SKILL_COMMAND_HINTS.items():
                if pat.search(seg):
                    related_skills.add(sk)

    try:
        parsed = friction.parse_transcript_file(path, on_command=_on_command)
    except SystemExit as err:
        raise ValueError(str(err)) from None
    return {
        "file": parsed["file"],
        "tool_calls": parsed["tool_calls"],
        "tool_errors": parsed["tool_errors"],
        "tool_error_rate": parsed["tool_error_rate"],
        "skills_loaded": parsed["skills_loaded"],
        "related_command_skills": sorted(related_skills),
    }


def audit_transcript_skill_firing(
    transcript_paths: list[Path],
    installed_skills: set[str],
) -> dict[str, Any]:
    """Aggregate skill loads, per-skill tool error rates, and missed triggers across transcripts."""
    sessions = [_inspect_transcript_skills(p) for p in transcript_paths]
    total_sessions = len(sessions)
    load_counts: Counter[str] = Counter()
    related_counts: Counter[str] = Counter()
    skill_calls: Counter[str] = Counter()
    skill_errors: Counter[str] = Counter()

    for sess in sessions:
        for sk in sess["skills_loaded"]:
            load_counts[sk] += 1
            skill_calls[sk] += sess["tool_calls"]
            skill_errors[sk] += sess["tool_errors"]
        for sk in sess["related_command_skills"]:
            related_counts[sk] += 1

    all_skills = sorted(installed_skills | set(load_counts) | set(related_counts))
    per_skill: dict[str, dict[str, Any]] = {}
    missed: list[dict[str, Any]] = []
    triggers: list[str] = []
    for sk in all_skills:
        loads = load_counts[sk]
        rel_n = related_counts[sk]
        calls_n = skill_calls[sk]
        errs_n = skill_errors[sk]
        per_skill[sk] = {
            "sessions_loaded": loads,
            "load_rate": round(loads / total_sessions, 3) if total_sessions else 0.0,
            "related_command_sessions": rel_n,
            "tool_calls": calls_n,
            "tool_errors": errs_n,
            "tool_error_rate": round(errs_n / calls_n, 3) if calls_n else None,
        }
        if sk in installed_skills and loads == 0 and rel_n > 0:
            missed.append({"skill": sk, "related_command_sessions": rel_n})
            triggers.append(
                f"missed_skill_triggers ({sk}: 0 loads across {total_sessions} session(s) "
                f"despite {rel_n} session(s) running related commands)"
            )

    return {
        "ok": not triggers,
        "sessions_analyzed": total_sessions,
        "per_skill": per_skill,
        "missed_skill_triggers": missed,
        "sessions": sessions,
        "triggers": triggers,
    }


def wilson_ci(passes: int, total: int, z: float = WILSON_Z_95) -> tuple[float, float]:
    """Compute exact Wilson score confidence interval (clamped to [0.0, 1.0]) using pure stdlib math."""
    if total <= 0:
        return 0.0, 1.0
    if passes < 0 or passes > total:
        raise ValueError(f"invalid Wilson inputs: passes={passes}, total={total}")
    p = passes / total
    z2 = z * z
    denom = 1.0 + z2 / total
    center = (p + z2 / (2.0 * total)) / denom
    half = (z * math.sqrt((p * (1.0 - p)) / total + z2 / (4.0 * total * total))) / denom
    return max(0.0, center - half), min(1.0, center + half)


def _two_proportion_z(k1: int, n1: int, k2: int, n2: int) -> tuple[float, float]:
    """Return `(z_score, two_sided_p_value)` comparing current `k1/n1` against baseline `k2/n2`."""
    if n1 <= 0 or n2 <= 0:
        return 0.0, 1.0
    p1 = k1 / n1
    p2 = k2 / n2
    pooled = (k1 + k2) / (n1 + n2)
    var = pooled * (1.0 - pooled) * (1.0 / n1 + 1.0 / n2)
    if var <= 0.0:
        return 0.0, 1.0
    z = (p1 - p2) / math.sqrt(var)
    p_val = math.erfc(abs(z) / math.sqrt(2.0))
    return z, p_val


def _parse_bool_pass(item: dict[str, Any]) -> bool | None:
    for key in ("passed", "pass", "ok", "success"):
        if key in item and isinstance(item[key], bool):
            return item[key]
    status = item.get("status")
    if isinstance(status, str):
        low = status.strip().lower()
        if low in ("pass", "passed", "ok", "success"):
            return True
        if low in ("fail", "failed", "error"):
            return False
    return None


def _parse_count_pair(item: dict[str, Any]) -> tuple[int, int] | None:
    p_val = None
    for key in ("pass_count", "passes", "passed_count", "n_pass"):
        if key in item and isinstance(item[key], int) and not isinstance(item[key], bool):
            p_val = item[key]
            break
    t_val = None
    for key in ("total", "n", "runs", "trials", "total_runs"):
        if key in item and isinstance(item[key], int) and not isinstance(item[key], bool):
            t_val = item[key]
            break
    if p_val is not None and t_val is not None:
        if t_val < 0 or p_val < 0 or p_val > t_val:
            raise ValueError(f"invalid eval counts: pass_count={p_val}, total={t_val}")
        return p_val, t_val
    return None


def _extract_eval_records(payload: Any) -> list[tuple[str, int, int]]:
    if isinstance(payload, dict):
        if isinstance(payload.get("results"), list):
            items = payload["results"]
        elif isinstance(payload.get("cases"), list):
            items = payload["cases"]
        elif isinstance(payload.get("cases"), dict):
            items = [{"case": k, **v} for k, v in payload["cases"].items() if isinstance(v, dict)]
        else:
            raise ValueError("eval JSON object must contain 'results' or 'cases'")
    elif isinstance(payload, list):
        items = payload
    else:
        raise ValueError("eval JSON must be a list or an object with 'results'/'cases'")

    records: list[tuple[str, int, int]] = []
    for entry in items:
        if not isinstance(entry, dict):
            raise ValueError("each eval result entry must be a JSON object")
        case_name = str(entry.get("case") or entry.get("eval_case") or entry.get("id") or entry.get("name") or "").strip()
        if not case_name:
            raise ValueError("eval result entry missing 'case' name")
        skill_prefix = str(entry.get("skill") or "").strip()
        full_name = f"{skill_prefix}/{case_name}" if skill_prefix and "/" not in case_name else case_name
        counts = _parse_count_pair(entry)
        if counts is not None:
            records.append((full_name, counts[0], counts[1]))
            continue
        passed = _parse_bool_pass(entry)
        if passed is None:
            raise ValueError(f"eval entry {full_name!r} missing 'passed' or ('pass_count', 'total')")
        records.append((full_name, 1 if passed else 0, 1))
    return records


def _load_eval_counts(paths: list[Path]) -> dict[str, tuple[int, int]]:
    totals: dict[str, list[int]] = {}
    for path in paths:
        payload, err = _read_json_bounded(path)
        if err is not None:
            raise ValueError(f"invalid eval JSON {path}: {err}")
        for case_name, p_cnt, t_cnt in _extract_eval_records(payload):
            bucket = totals.setdefault(case_name, [0, 0])
            bucket[0] += p_cnt
            bucket[1] += t_cnt
    return {k: (v[0], v[1]) for k, v in sorted(totals.items())}


def _detect_baseline_regressions(
    current: dict[str, dict[str, Any]],
    baseline_counts: dict[str, tuple[int, int]],
    triggers: list[str],
) -> list[dict[str, Any]]:
    regressions: list[dict[str, Any]] = []
    for case_name, cur in current.items():
        if case_name not in baseline_counts:
            continue
        b_pass, b_tot = baseline_counts[case_name]
        c_pass, c_tot = cur["pass_count"], cur["total"]
        if b_tot <= 0 or c_tot <= 0:
            continue
        b_rate = b_pass / b_tot
        c_rate = c_pass / c_tot
        if c_rate >= b_rate:
            continue
        b_low, b_high = wilson_ci(b_pass, b_tot)
        c_low, c_high = cur["ci_low"], cur["ci_high"]
        z_score, p_val = _two_proportion_z(c_pass, c_tot, b_pass, b_tot)
        non_overlapping = c_high < b_low
        z_significant = z_score < -WILSON_Z_95 and p_val < 0.05
        if non_overlapping or z_significant:
            regressions.append({
                "case": case_name,
                "baseline_pass_count": b_pass,
                "baseline_total": b_tot,
                "baseline_rate": round(b_rate, 4),
                "baseline_ci": [round(b_low, 4), round(b_high, 4)],
                "current_pass_count": c_pass,
                "current_total": c_tot,
                "current_rate": round(c_rate, 4),
                "current_ci": [c_low, c_high],
                "delta": round(c_rate - b_rate, 4),
                "z_score": round(z_score, 3),
                "p_value": round(p_val, 5),
                "non_overlapping_ci": non_overlapping,
            })
            triggers.append(
                f"eval_regression ({case_name}: {b_rate:.0%} -> {c_rate:.0%}, z={z_score:.2f}, p={p_val:.4f})"
            )
    return regressions


def analyze_eval_results(
    eval_json_paths: list[Path],
    *,
    baseline_path: Path | None = None,
) -> dict[str, Any]:
    """Compute Wilson 95% CIs, detect flaky/under-sampled cases, and check baseline regressions."""
    counts = _load_eval_counts(eval_json_paths)
    cases_out: dict[str, dict[str, Any]] = {}
    flaky_cases: list[str] = []
    under_sampled_cases: list[str] = []
    triggers: list[str] = []

    tot_passes = 0
    tot_runs = 0
    for case_name, (passes, total) in counts.items():
        tot_passes += passes
        tot_runs += total
        rate = (passes / total) if total else 0.0
        ci_low, ci_high = wilson_ci(passes, total)
        is_flaky = total >= FLAKY_MIN_RUNS and FLAKY_LOW_RATE < rate < FLAKY_HIGH_RATE
        is_under_sampled = 0 < total < MIN_RECOMMENDED_EVAL_RUNS and 0.0 < rate < 1.0

        if is_flaky:
            flaky_cases.append(case_name)
            triggers.append(
                f"eval_flaky_case ({case_name}: {passes}/{total} = {rate:.0%}, "
                f"95% CI [{ci_low:.2f}, {ci_high:.2f}])"
            )
        if is_under_sampled:
            under_sampled_cases.append(case_name)
            triggers.append(
                f"eval_under_sampled ({case_name}: n={total} < {MIN_RECOMMENDED_EVAL_RUNS} "
                f"with non-deterministic rate {rate:.0%})"
            )
        cases_out[case_name] = {
            "pass_count": passes,
            "total": total,
            "pass_rate": round(rate, 4),
            "ci_low": round(ci_low, 4),
            "ci_high": round(ci_high, 4),
            "flaky": is_flaky,
            "under_sampled": is_under_sampled,
        }

    regressions: list[dict[str, Any]] = []
    if baseline_path is not None:
        baseline_counts = _load_eval_counts([baseline_path])
        regressions = _detect_baseline_regressions(cases_out, baseline_counts, triggers)

    overall_low, overall_high = wilson_ci(tot_passes, tot_runs)
    return {
        "ok": not triggers,
        "summary": {
            "case_count": len(cases_out),
            "total_passes": tot_passes,
            "total_runs": tot_runs,
            "overall_pass_rate": round(tot_passes / tot_runs, 4) if tot_runs else 0.0,
            "overall_ci_95": [round(overall_low, 4), round(overall_high, 4)],
            "flaky_count": len(flaky_cases),
            "under_sampled_count": len(under_sampled_cases),
            "regression_count": len(regressions),
        },
        "cases": cases_out,
        "flaky_cases": flaky_cases,
        "under_sampled_cases": under_sampled_cases,
        "regressions": regressions,
        "triggers": triggers,
    }


def run_skills_audit(
    *,
    repo_root: Path | None = None,
    tree_rev: str | None = None,
    transcripts: list[Path] | None = None,
    eval_jsons: list[Path] | None = None,
    eval_baseline: Path | None = None,
    max_skill_words: int = DEFAULT_MAX_SKILL_WORDS,
    max_frontmatter_words: int = DEFAULT_MAX_FRONTMATTER_WORDS,
) -> dict[str, Any]:
    """Run Dimension 9 skill burden ratchet, eval coverage, transcript firing, and statistical eval audit."""
    root = _resolve_repo_root(repo_root)
    inventory = audit_skill_inventory(
        root,
        max_skill_words=max_skill_words,
        max_frontmatter_words=max_frontmatter_words,
    )
    firing = (
        audit_transcript_skill_firing(transcripts, set(inventory["skills"]))
        if transcripts
        else None
    )
    eval_stats = (
        analyze_eval_results(eval_jsons, baseline_path=eval_baseline)
        if eval_jsons
        else None
    )
    triggers = [
        *inventory["triggers"],
        *(firing["triggers"] if firing else []),
        *(eval_stats["triggers"] if eval_stats else []),
    ]
    out: dict[str, Any] = {
        "dimension": "D9_skills_eval_audit",
        "repo_root": str(root),
        "ok": not triggers,
        "inventory": inventory,
        "transcript_firing": firing,
        "eval_stats": eval_stats,
        "triggers": triggers,
    }
    if tree_rev is not None:
        out["tree"] = tree_rev
    return out


# ============================================================================
# CLI integration with `doctor.py`
# ============================================================================


def run_surface_cmd(args: argparse.Namespace) -> None:
    """CLI handler for `doctor.py surface`."""
    try:
        report = run_surface_audit(
            repo_root=args.root,
            tree_rev=getattr(args, "_tree_rev", None),
            http_target=args.http_target,
            health_path=args.health_path,
            trusted_host=args.trusted_host,
            timeout=args.timeout,
        )
    except ValueError as err:
        raise SystemExit(str(err)) from None
    print(json.dumps(report, indent=1))


def run_skills_audit_cmd(args: argparse.Namespace) -> None:
    """CLI handler for `doctor.py skills-audit`."""
    try:
        report = run_skills_audit(
            repo_root=args.root,
            tree_rev=getattr(args, "_tree_rev", None),
            transcripts=list(args.transcripts or []) or None,
            eval_jsons=list(args.eval_json or []) or None,
            eval_baseline=args.eval_baseline,
            max_skill_words=args.max_skill_words,
            max_frontmatter_words=args.max_frontmatter_words,
        )
    except ValueError as err:
        raise SystemExit(str(err)) from None
    print(json.dumps(report, indent=1))


def register_surface_skill_parsers(commands: Any) -> None:
    """Attach `surface` (D7) and `skills-audit` (D9) subcommands to `doctor.py`."""
    surf_p = commands.add_parser(
        "surface",
        help="Dimension 7 audit: PP Supply Mono font integrity, IDE/overview security patterns, route parity, and loopback HTTP probe",
    )
    surf_p.add_argument("--root", type=Path, help="repository root directory (default: git top-level)")
    surf_p.add_argument("--tree", default=None, metavar="REV", help="optional git revision to audit via git archive instead of --root")
    surf_p.add_argument(
        "--http-target",
        help="isolated loopback host:port (127.0.0.1, localhost, or ::1 only) for active HTTP/1.1 security & DoS probe",
    )
    surf_p.add_argument("--health-path", default="/api/overview/health", help="liveness GET path (default: %(default)s)")
    surf_p.add_argument("--trusted-host", help="Host header value trusted by the loopback server (default: target host:port)")
    surf_p.add_argument("--timeout", type=float, default=3.0, help="socket timeout in seconds (default: %(default)g)")
    surf_p.set_defaults(function=run_surface_cmd)

    skill_p = commands.add_parser(
        "skills-audit",
        help="Dimension 9 audit: skill burden ratchet, eval coverage, multi-session skill firing, and Wilson 95%% CI eval stats",
    )
    skill_p.add_argument("--root", type=Path, help="repository root directory (default: git top-level)")
    skill_p.add_argument("--tree", default=None, metavar="REV", help="optional git revision to audit via git archive instead of --root")
    skill_p.add_argument("--transcripts", type=Path, nargs="+", help="optional agent JSONL transcript files")
    skill_p.add_argument("--eval-json", type=Path, nargs="+", help="optional multi-run eval result JSON files")
    skill_p.add_argument("--eval-baseline", type=Path, help="optional baseline eval result JSON for regression comparison")
    skill_p.add_argument(
        "--max-skill-words",
        type=int,
        default=DEFAULT_MAX_SKILL_WORDS,
        help="SKILL.md bloat threshold in words (default: %(default)d)",
    )
    skill_p.add_argument(
        "--max-frontmatter-words",
        type=int,
        default=DEFAULT_MAX_FRONTMATTER_WORDS,
        help="SKILL.md frontmatter bloat threshold in words (default: %(default)d)",
    )
    skill_p.set_defaults(function=run_skills_audit_cmd)
