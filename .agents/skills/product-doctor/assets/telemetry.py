"""Deterministic multi-timescale evolutionary and structural telemetry for product-doctor (v2.2).

Reads everything from git blobs and history at `rev` (never the dirty working tree), using only the
Python standard library so audits run identically offline, in `git archive` copies, and across Python versions.

v2.2 upgrades driven by Round 3A (frontend ground-truth calibration) and Round 3B (red-team & longitudinal replay):
- Commit-time anchored `--since=@{head_ts - max_days*86400}` so historical `--tree <rev>` replays are exact.
- Uses `js_analyzer.py` stateful lexer + function-level Campbell complexity + Type-2 clones for JS/TS/TSX/JSX/MJS/CJS.
- Adds `.mjs`/`.cjs`, unified `is_test_path()`, co-located/sibling/subpackage test mapping (`tests/research_graph/`,
  `ide/web/scripts/*.test.mjs`, `*.test.ts`), and excludes test files from prod telemetry.
- Consistent `spelled()` percent-encoding across `_read_blobs` and `_git_dual_window` (no dropped special filenames).
- Preserves `Attr:{cur.attr}` in Python AST clone skeleton (`CLONE_MIN_NODES = 32`), detects `Revert` commits,
  computes per-file oscillation & `unhealthy_fixes_short`, and handles `ast.AnnAssign` in `_isolated_roots`.
"""

from __future__ import annotations

import ast
from collections import Counter, defaultdict
import hashlib
import io
import os
from pathlib import Path
import re
import subprocess
import sys
import tokenize
from typing import Any

_ASSETS_DIR = str(Path(__file__).resolve().parent)
if _ASSETS_DIR not in sys.path:
    sys.path.insert(0, _ASSETS_DIR)
import js_analyzer  # noqa: E402

CODE_EXTS = frozenset({".py", ".js", ".ts", ".tsx", ".jsx", ".mjs", ".cjs", ".sh", ".rs", ".go", ".c", ".h", ".cpp"})
JS_TS_EXTS = frozenset({".js", ".ts", ".tsx", ".jsx", ".mjs", ".cjs"})
JSX_EXTS = frozenset({".tsx", ".jsx"})
DOC_EXTS = frozenset({".md", ".mdx", ".rst", ".txt", ".svg", ".png", ".jpg", ".css", ".html"})
SATD_RE = re.compile(r"\b(TODO|FIXME|HACK|XXX|WORKAROUND|TEMP)\b", re.IGNORECASE)
FIX_RE = re.compile(r"fix(\(|:|!)")
REVERT_RE = re.compile(r"^Revert\s+", re.IGNORECASE)
TEST_FILE_RE = re.compile(r"(?:^|/)__tests__/|\.(?:test|spec)\.[a-z0-9]+$", re.IGNORECASE)
BREAK_EVEN_HEALTH = 6.0  # midpoint of arXiv:2610.33343 break-even range (4.9..7.1)
CLONE_MIN_NODES = 32
CLONE_MIN_BODY_LINES = 5


def _git(*args: str) -> bytes:
    top = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True, check=False)
    done = subprocess.run(["git", *args], capture_output=True, check=False, cwd=top.stdout.strip() or None)
    if done.returncode:
        raise SystemExit(f"git {' '.join(args)}: {done.stderr.decode().strip()}")
    return done.stdout


def _spelled(path: bytes) -> str:
    """Exact same percent-encoding as `doctor.spelled()` so keys always match `tracked()`."""
    return re.sub(
        r"[%+:|,@`\s\x00-\x1f\x7f\udc80-\udcff]",
        lambda found: "".join(f"%{byte:02X}" for byte in os.fsencode(found[0])),
        os.fsdecode(path),
    )


def is_test_path(path: str) -> bool:
    """True for `tests/` paths, co-located `*.test.*`/`*.spec.*`, and `/__tests__/` files."""
    return path.startswith("tests/") or bool(TEST_FILE_RE.search(path))


def cognitive_complexity(node: ast.AST) -> int:
    """Sonar/Campbell cognitive complexity for a Python function/method AST node."""
    func_name = getattr(node, "name", None)
    score = 0

    def visit_bool_chain(expr: ast.AST, parent_op: type[ast.boolop] | None, nesting: int) -> None:
        nonlocal score
        if isinstance(expr, ast.BoolOp):
            op_type = type(expr.op)
            if op_type is not parent_op:
                score += 1
            for val in expr.values:
                visit_bool_chain(val, op_type, nesting)
        else:
            visit(expr, nesting)

    def visit(cur: ast.AST, nesting: int) -> None:
        nonlocal score
        if isinstance(cur, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            for stmt in cur.body:
                visit(stmt, nesting + 1)
            return
        if isinstance(cur, ast.If):
            score += 1 + nesting
            visit_bool_chain(cur.test, None, nesting)
            for stmt in cur.body:
                visit(stmt, nesting + 1)
            orelse = cur.orelse
            while len(orelse) == 1 and isinstance(orelse[0], ast.If):
                elif_node = orelse[0]
                score += 1
                visit_bool_chain(elif_node.test, None, nesting)
                for stmt in elif_node.body:
                    visit(stmt, nesting + 1)
                orelse = elif_node.orelse
            if orelse:
                score += 1
                for stmt in orelse:
                    visit(stmt, nesting + 1)
            return
        if isinstance(cur, (ast.For, ast.AsyncFor, ast.While)):
            score += 1 + nesting
            for child in ast.iter_child_nodes(cur):
                visit(child, nesting + 1)
            return
        if isinstance(cur, ast.ExceptHandler):
            score += 1 + nesting
            for stmt in cur.body:
                visit(stmt, nesting + 1)
            return
        if isinstance(cur, ast.Match):
            score += 1 + nesting
            for child in ast.iter_child_nodes(cur):
                visit(child, nesting + 1)
            return
        if isinstance(cur, ast.IfExp):
            score += 1 + nesting
            visit_bool_chain(cur.test, None, nesting)
            visit(cur.body, nesting + 1)
            visit(cur.orelse, nesting + 1)
            return
        if isinstance(cur, (ast.ListComp, ast.SetComp, ast.DictComp, ast.GeneratorExp)):
            for gen in cur.generators:
                visit(gen.iter, nesting)
                for cond in gen.ifs:
                    score += 1 + nesting
                    visit_bool_chain(cond, None, nesting + 1)
            if isinstance(cur, ast.DictComp):
                visit(cur.key, nesting)
                visit(cur.value, nesting)
            else:
                visit(cur.elt, nesting)
            return
        if isinstance(cur, ast.BoolOp):
            visit_bool_chain(cur, None, nesting)
            return
        if isinstance(cur, ast.Call) and func_name and isinstance(cur.func, ast.Name) and cur.func.id == func_name:
            score += 1
        for child in ast.iter_child_nodes(cur):
            visit(child, nesting)

    for stmt in getattr(node, "body", ()):
        visit(stmt, 0)
    return score


def _non_docstring_body(fn: ast.FunctionDef | ast.AsyncFunctionDef) -> list[ast.stmt]:
    body = list(fn.body)
    if body and isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant) and isinstance(body[0].value.value, str):
        body = body[1:]
    return body


def _ast_skeleton_body(stmts: list[ast.stmt]) -> tuple[str, int]:
    """Normalized structural fingerprint of a function body (strips docstrings, annotations, var names,
    and literals while preserving control flow and attribute method names)."""
    tokens: list[str] = []
    count = 0

    def emit(cur: ast.AST) -> None:
        nonlocal count
        count += 1
        kind = type(cur).__name__
        if isinstance(cur, ast.Constant):
            tokens.append(f"C:{type(cur.value).__name__}")
            return
        if isinstance(cur, ast.Name):
            tokens.append("N")
            return
        if isinstance(cur, ast.arg):
            tokens.append("A")
            return
        if isinstance(cur, ast.Attribute):
            tokens.append(f"Attr:{cur.attr}")
            emit(cur.value)
            return
        tokens.append(kind)
        for child in ast.iter_child_nodes(cur):
            if isinstance(child, (ast.Load, ast.Store, ast.Del)):
                continue
            emit(child)

    for stmt in stmts:
        emit(stmt)
    return hashlib.sha1(" ".join(tokens).encode()).hexdigest()[:12], count


def analyze_python_source(source: str) -> dict[str, Any]:
    """Extract cognitive complexity, function sizes, SATD markers, and calibrated clone fingerprints."""
    satd = 0
    try:
        for tok in tokenize.generate_tokens(io.StringIO(source).readline):
            if tok.type == tokenize.COMMENT and SATD_RE.search(tok.string):
                satd += 1
    except (tokenize.TokenError, IndentationError):
        satd = sum(1 for line in source.splitlines() if "#" in line and SATD_RE.search(line.split("#", 1)[1]))

    lines = source.count("\n") + (1 if source and not source.endswith("\n") else 0)
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return {"lines": lines, "functions": 0, "max_cognitive": 0, "top3_cognitive": 0.0,
                "max_fn_lines": 0, "satd": satd, "clone_hashes": [], "parse_error": True}

    fn_scores: list[tuple[str, int, int]] = []
    clone_hashes: list[tuple[str, str, int, int]] = []
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            cog = cognitive_complexity(node)
            span = (getattr(node, "end_lineno", node.lineno) or node.lineno) - node.lineno + 1
            fn_scores.append((node.name, cog, span))
            body = _non_docstring_body(node)
            if body:
                b_start = body[0].lineno
                b_end = getattr(body[-1], "end_lineno", body[-1].lineno) or body[-1].lineno
                body_lines = b_end - b_start + 1
                digest, nodes = _ast_skeleton_body(body)
                if nodes >= CLONE_MIN_NODES and body_lines >= CLONE_MIN_BODY_LINES:
                    clone_hashes.append((digest, node.name, body_lines, nodes))

    fn_scores.sort(key=lambda item: (-item[1], -item[2], item[0]))
    max_cog = fn_scores[0][1] if fn_scores else 0
    top3 = [c for _, c, _ in fn_scores[:3]]
    top3_mean = round(sum(top3) / len(top3), 2) if top3 else 0.0
    max_fn_lines = max((span for _, _, span in fn_scores), default=0)
    hot_fns = [{"name": n, "cognitive": c, "lines": s} for n, c, s in fn_scores[:5] if c >= 10]

    return {
        "lines": lines,
        "functions": len(fn_scores),
        "max_cognitive": max_cog,
        "top3_cognitive": top3_mean,
        "max_fn_lines": max_fn_lines,
        "hot_functions": hot_fns,
        "satd": satd,
        "clone_hashes": clone_hashes,
    }


def analyze_js_ts_source(source: str, *, is_jsx: bool = False) -> dict[str, Any]:
    """Delegate JS/TS/TSX/JSX/MJS/CJS analysis to the pure-stdlib stateful lexer in `js_analyzer`."""
    return js_analyzer.analyze_js_ts_source(source, is_jsx=is_jsx)


def compute_health_score(lines: int, max_cognitive: int, top3_cognitive: float,
                         max_fn_lines: int, duplicate_fns: int, satd: int) -> float:
    """Deterministic 1.0..10.0 structural health score (higher is healthier)."""
    penalty = 0.0
    if max_cognitive > 12:
        penalty += min(3.5, (max_cognitive - 12) * 0.09)
    if top3_cognitive > 10:
        penalty += min(2.0, (top3_cognitive - 10) * 0.08)
    if lines > 400:
        penalty += min(2.0, (lines - 400) / 400.0)
    if max_fn_lines > 80:
        penalty += min(1.0, (max_fn_lines - 80) / 160.0)
    penalty += min(1.0, duplicate_fns * 0.25)
    penalty += min(0.5, satd * 0.1)
    return round(max(1.0, min(10.0, 10.0 - penalty)), 2)


def read_blobs(rev: str, paths: list[str]) -> dict[str, bytes]:
    """Batch-read raw file contents from git blobs at `rev` using `spelled()` keys."""
    if not paths:
        return {}
    entries = [entry.split(b"\t", 1) for entry in _git("ls-tree", "-r", "-z", rev).split(b"\0") if entry]
    wanted = set(paths)
    selected = [(head.split()[2], sp) for head, raw_p in entries if (sp := _spelled(raw_p)) in wanted]
    if not selected:
        return {}
    raw = subprocess.run(
        ["git", "cat-file", "--batch"],
        input=b"".join(blob + b"\n" for blob, _ in selected),
        capture_output=True, check=True,
    ).stdout
    contents: dict[str, bytes] = {}
    at = 0
    for _, path in selected:
        end = raw.index(b"\n", at)
        head, at = raw[at:end].split(), end + 1
        if head[-1] == b"missing" or head[1] != b"blob":
            at += 0 if head[-1] == b"missing" else int(head[2]) + 1
            continue
        size = int(head[2])
        contents[path] = raw[at:at + size]
        at += size + 1
    return contents


def _isolated_roots(rev: str, tracked_lines: dict[str, int]) -> set[str]:
    """Discover intentionally isolated package roots (`ISOLATED`, lowest `LAYERS[0]`, or `RANK == 0`)
    from `tests/test_package_layers.py` supporting both `ast.Assign` and PEP 526 `ast.AnnAssign`."""
    layer_file = "tests/test_package_layers.py"
    if layer_file not in tracked_lines:
        return set()
    raw = read_blobs(rev, [layer_file]).get(layer_file, b"").decode("utf-8", errors="replace")
    roots: set[str] = set()
    try:
        mod = ast.parse(raw)
    except SyntaxError:
        return roots

    def extract(name: str, value: ast.AST | None) -> None:
        if value is None:
            return
        if name == "ISOLATED":
            val = value.args[0] if isinstance(value, ast.Call) and value.args else value
            try:
                lit = ast.literal_eval(val)
                if isinstance(lit, (tuple, list, set, frozenset)):
                    roots.update(str(x) for x in lit)
            except (ValueError, SyntaxError):
                pass
        elif name == "LAYERS":
            try:
                lit = ast.literal_eval(value)
                if isinstance(lit, (tuple, list)) and lit and isinstance(lit[0], (tuple, list)):
                    roots.update(str(x) for x in lit[0])
            except (ValueError, SyntaxError):
                pass
        elif name == "RANK":
            try:
                lit = ast.literal_eval(value)
                if isinstance(lit, dict):
                    roots.update(str(k) for k, v in lit.items() if v == 0)
            except (ValueError, SyntaxError):
                pass

    for node in mod.body:
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name):
                    extract(target.id, node.value)
        elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            extract(node.target.id, node.value)
    return roots


def classify_object_kind(obj_name: str, obj_paths: list[str]) -> str:
    """Classify an object as 'tests', 'code', 'docs', or 'meta' from paths and extensions."""
    low = obj_name.lower()
    if low == "tests" or low.startswith("tests/"):
        return "tests"
    if not obj_paths:
        return "meta"
    test_n = sum(1 for p in obj_paths if is_test_path(p))
    if test_n >= len(obj_paths) * 0.5:
        return "tests"
    code_n = sum(1 for p in obj_paths if Path(p).suffix.lower() in CODE_EXTS)
    doc_n = sum(1 for p in obj_paths if Path(p).suffix.lower() in DOC_EXTS)
    if low.startswith((".", "changelog")):
        return "meta"
    if code_n >= max(1, len(obj_paths) * 0.25):
        return "code"
    if doc_n >= len(obj_paths) * 0.5:
        return "docs"
    return "meta"


def _new_window() -> dict[str, Any]:
    return {
        "total_commits": 0,
        "total_fixes": 0,
        "total_reverts": 0,
        "obj_commits": Counter(),
        "obj_fixes": Counter(),
        "obj_reverts": Counter(),
        "obj_added": Counter(),
        "obj_removed": Counter(),
        "file_commits": Counter(),
        "file_fixes": Counter(),
        "file_reverts": Counter(),
        "file_churn": Counter(),
        "file_fix_added": Counter(),
        "file_fix_removed": Counter(),
        "file_net": Counter(),
        "cross_pkg_coupling": Counter(),
        "intra_pkg_coupling": Counter(),
        "file_coupling": Counter(),
    }


def _git_dual_window(rev: str, days: int, long_days: int,
                     tops: dict[str, dict[str, Any]], owner_fn) -> tuple[dict[str, Any], dict[str, Any], dict[str, int], dict[str, int]]:
    """Single-pass commit-time-anchored git log collector computing both short (`days`) and long (`long_days`)
    windows plus each file's latest commit and latest fix/revert unix timestamps within `long_days`."""
    head_ts = int(_git("show", "-s", "--format=%ct", rev).decode().strip())
    short_cutoff = head_ts - days * 86400
    long_cutoff = head_ts - max(days, long_days) * 86400
    # Anchor `--since` to rev's commit timestamp (with 1-day slack for clock skew, filtered strictly in Python).
    log = _git("log", "--first-parent", "-m", "--no-renames", f"--since=@{max(0, long_cutoff - 86400)}",
               "--numstat", "-z", "--format=%x01%ct%x02%s%x02%b%x03", rev)
    short, long = _new_window(), _new_window()
    file_latest_ts: dict[str, int] = {}
    file_latest_fix_ts: dict[str, int] = {}

    for chunk in log.split(b"\x01")[1:]:
        hdr, _, body = chunk.partition(b"\x03")
        parts = hdr.decode(errors="replace").split("\x02")
        ts = int(parts[0]) if parts and parts[0].isdigit() else head_ts
        if ts < long_cutoff:
            continue
        title = parts[1] if len(parts) > 1 else ""
        rest = parts[2] if len(parts) > 2 else ""
        subject = rest.lstrip() if title.startswith("Merge ") else title
        is_revert = bool(REVERT_RE.match(subject))
        is_fix = bool(FIX_RE.match(subject))
        is_osc_commit = is_fix or is_revert
        in_short = ts >= short_cutoff

        targets = (short, long) if in_short else (long,)
        for win in targets:
            win["total_commits"] += 1
            win["total_fixes"] += int(is_fix)
            win["total_reverts"] += int(is_revert)

        touched_objs: set[str] = set()
        code_files: list[str] = []
        code_objs: set[str] = set()
        for line in body.split(b"\0"):
            if line.count(b"\t") < 2:
                continue
            added_b, removed_b, raw_path = line.lstrip(b"\n").split(b"\t", 2)
            path = _spelled(raw_path)
            a = int(added_b) if added_b.isdigit() else 0
            d = int(removed_b) if removed_b.isdigit() else 0
            if ts > file_latest_ts.get(path, 0):
                file_latest_ts[path] = ts
            if is_osc_commit and ts > file_latest_fix_ts.get(path, 0):
                file_latest_fix_ts[path] = ts
            name = owner_fn(path, tops) or "."
            touched_objs.add(name)
            for win in targets:
                win["obj_added"][name] += a
                win["obj_removed"][name] += d
                win["file_net"][path] += a - d
            if Path(path).suffix.lower() in CODE_EXTS and not is_test_path(path):
                for win in targets:
                    win["file_commits"][path] += 1
                    win["file_churn"][path] += a + d
                    if is_fix:
                        win["file_fixes"][path] += 1
                    if is_revert:
                        win["file_reverts"][path] += 1
                    if is_osc_commit:
                        win["file_fix_added"][path] += a
                        win["file_fix_removed"][path] += d
                code_files.append(path)
                code_objs.add(name)

        for win in targets:
            for name in touched_objs:
                win["obj_commits"][name] += 1
                if is_fix:
                    win["obj_fixes"][name] += 1
                if is_revert:
                    win["obj_reverts"][name] += 1
            if 2 <= len(code_files) <= 12 and len(code_objs) >= 2:
                sorted_objs = sorted(code_objs)
                for i in range(len(sorted_objs)):
                    for j in range(i + 1, len(sorted_objs)):
                        o1, o2 = sorted_objs[i], sorted_objs[j]
                        if o1.split("/", 1)[0] != o2.split("/", 1)[0]:
                            win["cross_pkg_coupling"][(o1, o2)] += 1
                        else:
                            win["intra_pkg_coupling"][(o1, o2)] += 1
                sorted_files = sorted(set(code_files))
                for i in range(len(sorted_files)):
                    for j in range(i + 1, len(sorted_files)):
                        f1, f2 = sorted_files[i], sorted_files[j]
                        if f1.split("/", 1)[0] != f2.split("/", 1)[0]:
                            win["file_coupling"][(f1, f2)] += 1

    return short, long, file_latest_ts, file_latest_fix_ts


def _map_test_paths(tracked_lines: dict[str, int], code_objects: list[str],
                    tops: dict[str, dict[str, Any]], owner_fn) -> dict[str, list[str]]:
    """Map test files (both `tests/` and co-located/sibling `*.test.*` suites) to their owning code object
    without hardcoding package names."""
    by_code: dict[str, list[str]] = defaultdict(list)
    code_set = set(code_objects)
    roots = {obj: obj for obj in code_objects if "/" not in obj}

    # Build subpackage directory map: immediate subdir name inside a code object -> code object
    # (e.g. `ide/research_graph/...` -> subdir `research_graph` maps to `ide`).
    subdir_owner: dict[str, set[str]] = defaultdict(set)
    for path in tracked_lines:
        if is_test_path(path):
            continue
        o = owner_fn(path, tops)
        if o in code_set and "/" in path:
            parts = path.split("/")
            if len(parts) >= 3:
                subdir_owner[parts[1]].add(o)
    unique_subdir = {sub: next(iter(owners)) for sub, owners in subdir_owner.items() if len(owners) == 1}

    # Map package parent prefixes for sibling test dirs (e.g. `ide/web/scripts/*.test.mjs` -> `ide/web/src`).
    def sibling_code_target(test_path: str) -> str | None:
        parts = test_path.split("/")
        for depth in range(len(parts) - 2, 0, -1):
            prefix = "/".join(parts[:depth])
            candidates = sorted(o for o in code_objects if o == prefix or o.startswith(prefix + "/"))
            if candidates:
                # Prefer `<prefix>/src` if present, otherwise the shallowest matching code object.
                if f"{prefix}/src" in candidates:
                    return f"{prefix}/src"
                return min(candidates, key=lambda c: (c.count("/"), c))
        return None

    for path in tracked_lines:
        if not is_test_path(path):
            continue
        if not path.startswith("tests/"):
            # Co-located test inside a code object (e.g. `ide/agent/src/app.test.ts` -> `ide/agent`).
            o = owner_fn(path, tops)
            if o in code_set:
                by_code[o].append(path)
                continue
            # Sibling test dir inside a package (e.g. `ide/web/scripts/*.test.mjs` -> `ide/web/src`).
            sib = sibling_code_target(path)
            if sib:
                by_code[sib].append(path)
            continue

        rest = path[len("tests/"):]
        sub = rest.split("/", 1)[0]
        if sub in roots:
            by_code[roots[sub]].append(path)
            continue
        if sub in unique_subdir:
            by_code[unique_subdir[sub]].append(path)
            continue
        prefix = sub.split("_", 1)[0]
        if prefix in roots:
            by_code[roots[prefix]].append(path)
            continue
        if "/" not in rest and rest.startswith("test_"):
            stem = rest[len("test_"):].split("_", 1)[0].removesuffix(".py")
            if stem in roots:
                by_code[roots[stem]].append(path)
    return by_code


def collect_telemetry(rev: str, tops: dict[str, dict[str, Any]], tracked_lines: dict[str, int],
                      owner_fn, *, days: int = 14, long_days: int = 30) -> dict[str, Any]:
    """Build complete multi-timescale evolutionary + structural telemetry for `rev`."""
    short, long, file_latest_ts, file_latest_fix_ts = _git_dual_window(rev, days, long_days, tops, owner_fn)
    isolated_roots = _isolated_roots(rev, tracked_lines)

    obj_paths: dict[str, list[str]] = defaultdict(list)
    for path in tracked_lines:
        name = owner_fn(path, tops) or "."
        obj_paths[name].append(path)

    kinds = {name: classify_object_kind(name, obj_paths.get(name, [])) for name in tops}
    code_objs = [n for n, k in kinds.items() if k == "code"]

    # Analyze non-test Python and JS/TS/TSX/JSX/MJS/CJS files in code objects directly from git blobs.
    target_files = sorted(
        p for name in code_objs for p in obj_paths.get(name, [])
        if not is_test_path(p) and (p.endswith(".py") or Path(p).suffix.lower() in JS_TS_EXTS)
    )
    blobs = read_blobs(rev, target_files)
    file_ast: dict[str, dict[str, Any]] = {}
    clone_index: dict[str, list[tuple[str, str, int, int]]] = defaultdict(list)
    for path, raw in blobs.items():
        if b"\0" in raw:
            continue
        text = raw.decode("utf-8", errors="replace")
        ext = Path(path).suffix.lower()
        info = analyze_python_source(text) if ext == ".py" else analyze_js_ts_source(text, is_jsx=ext in JSX_EXTS)
        file_ast[path] = info
        for digest, fn_name, b_lines, nodes in info.get("clone_hashes", []):
            clone_index[digest].append((path, fn_name, b_lines, nodes))

    file_dups: Counter[str] = Counter()
    duplicate_groups: list[dict[str, Any]] = []
    boundary_clones: list[dict[str, Any]] = []
    for digest, locs in clone_index.items():
        if len(locs) < 2:
            continue
        pkg_roots = {p.split("/", 1)[0] for p, _, _, _ in locs}
        cross_boundary = len(pkg_roots) > 1 and bool(pkg_roots & isolated_roots)
        group = {
            "hash": digest,
            "count": len(locs),
            "body_lines": max(bl for _, _, bl, _ in locs),
            "nodes": max(nd for _, _, _, nd in locs),
            "cross_boundary": cross_boundary,
            "locations": [f"{p}:{fn}" for p, fn, _, _ in locs[:6]],
        }
        if cross_boundary:
            boundary_clones.append(group)
        else:
            for path, _, _, _ in locs:
                file_dups[path] += 1
            duplicate_groups.append(group)
    duplicate_groups.sort(key=lambda g: (-int(g["count"]), -int(g["body_lines"]), str(g["hash"])))
    boundary_clones.sort(key=lambda g: (-int(g["count"]), str(g["hash"])))

    file_reports: dict[str, dict[str, Any]] = {}
    for path, info in file_ast.items():
        dups = file_dups[path]
        health = compute_health_score(
            info["lines"], info["max_cognitive"], info["top3_cognitive"],
            info["max_fn_lines"], dups, info["satd"],
        )
        f_fixes = short["file_fixes"][path]
        f_reverts = short["file_reverts"][path]
        f_osc_a, f_osc_r = short["file_fix_added"][path], short["file_fix_removed"][path]
        f_osc_churn = f_osc_a + f_osc_r
        f_osc_net = abs(f_osc_a - f_osc_r)
        # Per-file oscillation ratio: only meaningful when the same file has >=3 fix/revert touches or >=1 revert.
        f_osc = (
            round(f_osc_churn / max(f_osc_net, 10), 2)
            if (f_fixes + f_reverts) >= 3 or f_reverts >= 1
            else 0.0
        )
        file_reports[path] = {
            "object": owner_fn(path, tops) or ".",
            "lines": info["lines"],
            "functions": info["functions"],
            "max_cognitive": info["max_cognitive"],
            "top3_cognitive": info["top3_cognitive"],
            "max_fn_lines": info["max_fn_lines"],
            "duplicate_fns": dups,
            "satd": info["satd"],
            "health": health,
            "break_even_caution": health < BREAK_EVEN_HEALTH,
            "fixes_short": f_fixes,
            "reverts_short": f_reverts,
            "oscillation_ratio": f_osc,
            "churn_short": short["file_churn"][path],
            "fixes_long": long["file_fixes"][path],
            "hot_functions": info.get("hot_functions", []),
        }

    test_paths_by_code = _map_test_paths(tracked_lines, code_objs, tops, owner_fn)

    objects_out: dict[str, dict[str, Any]] = {}
    for name, meta in tops.items():
        o_files = [r for r in file_reports.values() if r["object"] == name]
        min_health: float | None = min((r["health"] for r in o_files), default=None)
        mean_health: float | None = (
            round(sum(r["health"] for r in o_files) / len(o_files), 2) if o_files else None
        )
        max_cog = max((r["max_cognitive"] for r in o_files), default=0)
        dup_fns = sum(r["duplicate_fns"] for r in o_files)
        satd_tot = sum(r["satd"] for r in o_files)
        unhealthy_fixes_short = sum(r["fixes_short"] + r["reverts_short"] for r in o_files if r["break_even_caution"])
        burst_files = sorted(
            [{"file": p, "fixes": r["fixes_short"], "reverts": r["reverts_short"],
              "osc": r["oscillation_ratio"], "churn": r["churn_short"], "health": r["health"]}
             for p, r in file_reports.items()
             if r["object"] == name and (r["fixes_short"] + r["reverts_short"]) >= 3],
            key=lambda x: (-(x["fixes"] + x["reverts"]), -x["churn"], x["file"]),
        )
        osc_ratio = max((r["oscillation_ratio"] for r in o_files), default=0.0)

        t_paths = test_paths_by_code.get(name, [])
        t_lines = sum(tracked_lines.get(p, 0) for p in t_paths)
        t_net_short = sum(short["file_net"][p] for p in t_paths)
        # Subtract co-located test lines from prod_lines so prod size isn't inflated by co-located tests.
        colocated_lines = sum(tracked_lines.get(p, 0) for p in obj_paths.get(name, []) if is_test_path(p))
        prod_lines = max(1, meta["lines"] - colocated_lines)
        colocated_net = sum(short["file_net"][p] for p in obj_paths.get(name, []) if is_test_path(p))
        prod_net_short = (short["obj_added"][name] - short["obj_removed"][name]) - colocated_net
        prod_paths = [p for p in obj_paths.get(name, []) if not is_test_path(p) and not p.endswith(".md")]
        latest_code_ts = max((file_latest_ts.get(p, 0) for p in prod_paths), default=0)
        latest_fix_ts = max((file_latest_fix_ts.get(p, 0) for p in prod_paths), default=0)

        objects_out[name] = {
            "kind": kinds[name],
            "lines": prod_lines,
            "analyzed_files": len(o_files),
            "commits_short": short["obj_commits"][name],
            "fixes_short": short["obj_fixes"][name],
            "reverts_short": short["obj_reverts"][name],
            "latest_code_ts": latest_code_ts,
            "latest_fix_ts": latest_fix_ts,
            "added_short": short["obj_added"][name],
            "removed_short": short["obj_removed"][name],
            "net_short": prod_net_short,
            "abs_churn_short": short["obj_added"][name] + short["obj_removed"][name],
            "commits_long": long["obj_commits"][name],
            "fixes_long": long["obj_fixes"][name],
            "abs_churn_long": long["obj_added"][name] + long["obj_removed"][name],
            "fix_burst_files": burst_files,
            "oscillation_ratio": osc_ratio,
            "min_health": min_health,
            "mean_health": mean_health,
            "max_cognitive": max_cog,
            "duplicate_fns": dup_fns,
            "satd": satd_tot,
            "break_even_caution": min_health is not None and min_health < BREAK_EVEN_HEALTH,
            "unhealthy_fixes_short": unhealthy_fixes_short,
            "test_file_count": len(t_paths),
            "test_lines": t_lines,
            "test_to_prod_ratio": round(t_lines / prod_lines, 2) if t_lines else None,
            "test_net_short": t_net_short,
        }

    file_pairs_by_objpair: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for (f1, f2), cnt in short["file_coupling"].most_common(80):
        if cnt < 2:
            continue
        o1, o2 = owner_fn(f1, tops) or ".", owner_fn(f2, tops) or "."
        key = (o1, o2) if o1 <= o2 else (o2, o1)
        if len(file_pairs_by_objpair[key]) < 5:
            file_pairs_by_objpair[key].append({"files": [f1, f2], "cochanges": cnt})

    cross_couplings = [
        {"pair": f"{a}+{b}", "cochanges": cnt, "top_file_pairs": file_pairs_by_objpair.get((a, b), [])}
        for (a, b), cnt in short["cross_pkg_coupling"].most_common(12)
        if cnt >= 2
    ]
    intra_couplings = [
        {"pair": f"{a}+{b}", "cochanges": cnt}
        for (a, b), cnt in short["intra_pkg_coupling"].most_common(8)
        if cnt >= 2
    ]
    top_file_couplings = [
        {"files": [a, b], "cochanges": cnt}
        for (a, b), cnt in short["file_coupling"].most_common(15)
        if cnt >= 2
    ]
    unhealthy_files = sorted(
        [{"file": p, **r} for p, r in file_reports.items() if r["break_even_caution"]],
        key=lambda x: (x["health"], -x["fixes_short"], x["file"]),
    )[:15]
    burst_leaderboard = sorted(
        [{"file": p, "object": r["object"], "fixes": r["fixes_short"], "reverts": r["reverts_short"],
          "osc": r["oscillation_ratio"], "churn": r["churn_short"],
          "health": r["health"], "max_cognitive": r["max_cognitive"]}
         for p, r in file_reports.items() if (r["fixes_short"] + r["reverts_short"]) >= 3],
        key=lambda x: (-(x["fixes"] + x["reverts"]), -x["churn"], x["file"]),
    )[:20]

    untouched_long = [n for n in code_objs if objects_out[n]["commits_long"] == 0]

    return {
        "tree": rev,
        "days": days,
        "long_days": long_days,
        "summary": {
            "commits_short": short["total_commits"],
            "fixes_short": short["total_fixes"],
            "reverts_short": short["total_reverts"],
            "commits_long": long["total_commits"],
            "fixes_long": long["total_fixes"],
            "code_objects": len(code_objs),
            "untouched_code_objects_long": untouched_long,
            "fix_burst_file_count": len([r for r in file_reports.values() if (r["fixes_short"] + r["reverts_short"]) >= 3]),
            "break_even_caution_files": len([r for r in file_reports.values() if r["break_even_caution"]]),
            "duplicate_clone_groups": len(duplicate_groups),
            "boundary_isolation_clones": len(boundary_clones),
            "isolated_roots": sorted(isolated_roots),
        },
        "objects": objects_out,
        "fix_bursts": burst_leaderboard,
        "couplings": cross_couplings,
        "intra_couplings": intra_couplings,
        "file_couplings": top_file_couplings,
        "break_even_files": unhealthy_files,
        "duplicate_groups": duplicate_groups[:15],
        "boundary_clones": boundary_clones[:10],
        "_file_latest_ts": file_latest_ts,
    }
