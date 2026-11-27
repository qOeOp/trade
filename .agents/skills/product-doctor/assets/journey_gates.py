"""Static Gate & Refusal Map analyzer for user-journey & gate-satisfiability audits (`doctor.py gates-map`).

Statically scans tracked Python files across admission/domain packages via AST to build a
deterministic Gate & Refusal Map:
  1. Ordered gate/refusal check chains per function (`chains`) and code index (`codes`).
  2. Real CLI command inventory from `cli/` (supporting both this repo's `command(fn, noun, verb, ...)`
     declarations and standard `argparse` `add_parser(...)` trees) + phantom remedy command detection
     across refusal messages, `shared/refusals.py` `CATALOGUE`, and `live/control.py` `MESSAGES`.
  3. Test coverage cross-reference against `tests/` to surface `untested_refusal_codes`.
  4. Duplicate-code-in-chain candidates (`duplicate_codes_in_chain`) and AST-provable dead or
     shadowed gate branches (`dead_unreachable_gates`).

100% pure Python standard library; strictly read-only on repository files; never reads credentials.
"""

from __future__ import annotations

import ast
from collections.abc import Sequence
import json
from pathlib import Path
import re
import subprocess
from typing import Any

DEFAULT_PACKAGES: tuple[str, ...] = (
    "live",
    "paper",
    "registration",
    "report",
    "replay",
    "ledger",
    "market",
    "engine",
    "cli",
    "ide",
)

REFUSAL_CALL_NAMES: frozenset[str] = frozenset({
    "refuse",
    "Refusal",
    "LiveRefusal",
    "EngineRefusal",
    "RuntimeRefusal",
    "fail",
    "unreconciled",
})

CODE_RE = re.compile(r"^[A-Z][A-Z0-9_]{2,}$")
UPPER_TOKEN_RE = re.compile(r"\b[A-Z][A-Z0-9_]{2,}\b")
BACKTICK_RE = re.compile(r"`([^`\n]+)`")
CLI_PREFIX_RE = re.compile(r"^(?:uv\s+run\s+(?:--frozen\s+)?)?python3?\s+-m\s+cli\.main(?:\s+|$)")
PLAIN_CLI_RE = re.compile(
    r"(?:uv\s+run\s+(?:--frozen\s+)?)?python3?\s+-m\s+cli\.main\s+([a-z][a-z0-9-]*)(?:\s+([a-z][a-z0-9-]*))?"
)
VERB_RE = re.compile(r"^[a-z][a-z-]*$")
_SKIP_DIR_PARTS = frozenset({".git", ".venv", "node_modules", "__pycache__"})
_SECRET_SUFFIXES = frozenset({".key", ".key_secret", ".p12", ".pfx", ".pem"})
_MESSAGE_LIMIT = 240
_GUARD_LIMIT = 140


def _resolve_root(root: Path | None) -> Path:
    if root is not None:
        return root.resolve()
    done = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True, check=False)
    if done.returncode == 0 and done.stdout.strip():
        return Path(done.stdout.strip()).resolve()
    return Path.cwd().resolve()


def _is_forbidden_out_path(path: Path) -> bool:
    name = path.name.lower()
    if name == ".env" or name.startswith(".env.") or name == "service.json":
        return True
    return path.suffix.lower() in _SECRET_SUFFIXES


def _tracked_py_files(root: Path, prefixes: Sequence[str]) -> list[str]:
    norm_prefixes = tuple(p.strip("/ ") + "/" for p in prefixes if p.strip("/ "))
    done = subprocess.run(["git", "-C", str(root), "ls-files", "-z", "*.py"], capture_output=True, check=False)
    if done.returncode == 0:
        rels = [entry.decode("utf-8", errors="surrogateescape") for entry in done.stdout.split(b"\0") if entry]
    else:
        rels = []
        for path in root.rglob("*.py"):
            if not path.is_file():
                continue
            rel = path.relative_to(root)
            if not _SKIP_DIR_PARTS.intersection(rel.parts):
                rels.append(rel.as_posix())
    if not norm_prefixes:
        return sorted(r for r in rels if (root / r).is_file())
    return sorted(r for r in rels if r.startswith(norm_prefixes) and (root / r).is_file())


def _parse_file(path: Path, rel: str) -> ast.Module | None:
    try:
        return ast.parse(path.read_text(encoding="utf-8", errors="replace"), rel)
    except (OSError, SyntaxError):
        return None


def _call_name(call: ast.Call) -> str:
    if isinstance(call.func, ast.Name):
        return call.func.id
    if isinstance(call.func, ast.Attribute):
        return call.func.attr
    return ""


def _const_str(node: ast.AST | None, consts: dict[str, str] | None = None) -> str | None:
    if node is None:
        return None
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    if isinstance(node, ast.Name) and consts and node.id in consts:
        return consts[node.id]
    if isinstance(node, ast.JoinedStr):
        parts: list[str] = []
        for part in node.values:
            if isinstance(part, ast.Constant) and isinstance(part.value, str):
                parts.append(part.value)
            elif isinstance(part, ast.FormattedValue):
                parts.append("{" + ast.unparse(part.value) + "}")
        return "".join(parts)
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
        left = _const_str(node.left, consts)
        right = _const_str(node.right, consts)
        if left is not None and right is not None:
            return left + right
        return left if left is not None else right
    return None


def _truncate(text: str, limit: int) -> str:
    compact = " ".join(text.split())
    return compact if len(compact) <= limit else compact[: limit - 3] + "..."


def _module_string_consts(tree: ast.Module) -> dict[str, str]:
    consts: dict[str, str] = {}
    for stmt in tree.body:
        if isinstance(stmt, ast.Assign) and len(stmt.targets) == 1 and isinstance(stmt.targets[0], ast.Name):
            val = _const_str(stmt.value, consts)
            if val is not None:
                consts[stmt.targets[0].id] = val
        elif isinstance(stmt, ast.AnnAssign) and isinstance(stmt.target, ast.Name) and stmt.value is not None:
            val = _const_str(stmt.value, consts)
            if val is not None:
                consts[stmt.target.id] = val
    return consts


def _is_refusal_code(text: str | None, *, require_underscore: bool = False) -> bool:
    if not text or not CODE_RE.fullmatch(text):
        return False
    return ("_" in text) if require_underscore else True


def _extract_kw_str(call: ast.Call, names: tuple[str, ...], consts: dict[str, str]) -> str | None:
    for kw in call.keywords:
        if kw.arg in names:
            return _const_str(kw.value, consts)
    return None


def _extract_known_refusal(call: ast.Call, consts: dict[str, str], *, in_raise: bool) -> tuple[str, str, str] | None:
    kind = "raise_call" if in_raise else "refusal_call"
    arg0 = _const_str(call.args[0], consts) if call.args else None
    if _is_refusal_code(arg0):
        msg = _const_str(call.args[1], consts) if len(call.args) >= 2 else _extract_kw_str(call, ("message", "detail"), consts)
        return str(arg0), _truncate(msg or "", _MESSAGE_LIMIT), kind
    kw_code = _extract_kw_str(call, ("code",), consts)
    if _is_refusal_code(kw_code):
        msg = _extract_kw_str(call, ("message", "detail"), consts) or (_const_str(call.args[0], consts) if call.args else "")
        return str(kw_code), _truncate(msg or "", _MESSAGE_LIMIT), kind
    return None


def _extract_refusal_call(
    call: ast.Call,
    consts: dict[str, str],
    wrappers: dict[str, str],
    *,
    in_raise: bool,
) -> tuple[str, str, str] | None:
    fn = _call_name(call)
    if fn in REFUSAL_CALL_NAMES or fn.endswith("Refusal"):
        return _extract_known_refusal(call, consts, in_raise=in_raise)
    if in_raise and fn in wrappers:
        msg = _const_str(call.args[0], consts) if call.args else _extract_kw_str(call, ("message", "detail"), consts)
        return wrappers[fn], _truncate(msg or "", _MESSAGE_LIMIT), "wrapper_raise"
    if in_raise and call.args:
        arg0 = _const_str(call.args[0], consts)
        if _is_refusal_code(arg0, require_underscore=True):
            msg = _const_str(call.args[1], consts) if len(call.args) >= 2 else _extract_kw_str(call, ("message", "detail"), consts)
            return str(arg0), _truncate(msg or "", _MESSAGE_LIMIT), "raise_call"
    kw_code = _extract_kw_str(call, ("code",), consts)
    if _is_refusal_code(kw_code, require_underscore=True) and (in_raise or fn == "dict"):
        msg = _extract_kw_str(call, ("message", "detail", "reason"), consts)
        return str(kw_code), _truncate(msg or "", _MESSAGE_LIMIT), "raise_call" if in_raise else "return_dict"
    return None


def _extract_refusal_dict(node: ast.Dict, consts: dict[str, str]) -> tuple[str, str, str] | None:
    code: str | None = None
    msg: str | None = None
    for key_node, val_node in zip(node.keys, node.values, strict=False):
        key = _const_str(key_node)
        if key == "code":
            cand = _const_str(val_node, consts)
            if _is_refusal_code(cand, require_underscore=True):
                code = cand
        elif key in ("message", "detail", "reason") and msg is None:
            msg = _const_str(val_node, consts)
    if code is None:
        return None
    return code, _truncate(msg or "", _MESSAGE_LIMIT), "return_dict"


def _local_refusal_wrappers(tree: ast.Module, consts: dict[str, str]) -> dict[str, str]:
    wrappers: dict[str, str] = {}
    for stmt in tree.body:
        if not isinstance(stmt, ast.FunctionDef) or len(stmt.body) > 3:
            continue
        returns = [n for n in stmt.body if isinstance(n, ast.Return) and isinstance(n.value, ast.Call)]
        if len(returns) != 1 or not isinstance(returns[0].value, ast.Call):
            continue
        hit = _extract_refusal_call(returns[0].value, consts, {}, in_raise=False)
        if hit is not None:
            wrappers[stmt.name] = hit[0]
    return wrappers


def _const_compare(node: ast.Compare) -> bool | None:
    if not isinstance(node.left, ast.Constant):
        return None
    left: Any = node.left.value
    for op, comp in zip(node.ops, node.comparators, strict=False):
        if not isinstance(comp, ast.Constant):
            return None
        right: Any = comp.value
        try:
            if isinstance(op, ast.Eq):
                ok = left == right
            elif isinstance(op, ast.NotEq):
                ok = left != right
            elif isinstance(op, ast.Lt):
                ok = left < right
            elif isinstance(op, ast.LtE):
                ok = left <= right
            elif isinstance(op, ast.Gt):
                ok = left > right
            elif isinstance(op, ast.GtE):
                ok = left >= right
            elif isinstance(op, ast.Is):
                ok = left is right
            elif isinstance(op, ast.IsNot):
                ok = left is not right
            else:
                return None
        except TypeError:
            return None
        if not ok:
            return False
        left = right
    return True


def _const_truthiness(expr: ast.AST) -> bool | None:
    if isinstance(expr, ast.Constant):
        return bool(expr.value)
    if isinstance(expr, ast.UnaryOp) and isinstance(expr.op, ast.Not):
        inner = _const_truthiness(expr.operand)
        return None if inner is None else (not inner)
    if isinstance(expr, ast.BoolOp):
        vals = [_const_truthiness(v) for v in expr.values]
        if isinstance(expr.op, ast.And):
            if any(v is False for v in vals):
                return False
            return True if all(v is True for v in vals) else None
        if isinstance(expr.op, ast.Or):
            if any(v is True for v in vals):
                return True
            return False if all(v is False for v in vals) else None
    if isinstance(expr, ast.Compare):
        return _const_compare(expr)
    return None


def _stmt_terminates(stmt: ast.stmt) -> bool:
    if isinstance(stmt, (ast.Return, ast.Raise, ast.Break, ast.Continue)):
        return True
    if isinstance(stmt, ast.If) and stmt.orelse:
        return _block_terminates(stmt.body) and _block_terminates(stmt.orelse)
    return False


def _block_terminates(stmts: Sequence[ast.stmt]) -> bool:
    return any(_stmt_terminates(s) for s in stmts)


def _iter_shallow_nodes(node: ast.AST) -> list[ast.AST]:
    """Return AST nodes inside `node` without descending into nested functions or classes."""
    found: list[ast.AST] = []
    stack: list[ast.AST] = [node]
    while stack:
        cur = stack.pop()
        found.append(cur)
        for child in reversed(list(ast.iter_child_nodes(cur))):
            if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                continue
            stack.append(child)
    return found


def _stmt_gate_codes(
    stmts: Sequence[ast.stmt],
    consts: dict[str, str],
    wrappers: dict[str, str],
) -> list[tuple[int, str]]:
    found: list[tuple[int, str]] = []
    for stmt in stmts:
        for node in _iter_shallow_nodes(stmt):
            if isinstance(node, ast.Raise) and isinstance(node.exc, ast.Call):
                hit = _extract_refusal_call(node.exc, consts, wrappers, in_raise=True)
                if hit:
                    found.append((node.lineno, hit[0]))
            elif isinstance(node, ast.Return) and isinstance(node.value, ast.Dict):
                hit = _extract_refusal_dict(node.value, consts)
                if hit:
                    found.append((node.lineno, hit[0]))
    return found


def _names_in_expr(expr: ast.AST) -> set[str]:
    return {n.id for n in ast.walk(expr) if isinstance(n, ast.Name)}


def _assigned_names(stmt: ast.stmt) -> set[str]:
    names: set[str] = set()
    for node in _iter_shallow_nodes(stmt):
        if isinstance(node, ast.Name) and isinstance(node.ctx, (ast.Store, ast.Del)):
            names.add(node.id)
    return names


def _record_if_dead_gates(
    rel: str,
    qualname: str,
    stmt: ast.If,
    tail: Sequence[ast.stmt],
    consts: dict[str, str],
    wrappers: dict[str, str],
    dead: list[dict[str, Any]],
) -> None:
    truth = _const_truthiness(stmt.test)
    if truth is False:
        codes = _stmt_gate_codes(stmt.body, consts, wrappers)
        if codes:
            dead.append({
                "file": rel,
                "function": qualname,
                "line": stmt.lineno,
                "kind": "always_false_gate_branch",
                "codes": sorted({c for _, c in codes}),
                "condition": _truncate(ast.unparse(stmt.test), _GUARD_LIMIT),
                "detail": f"gate branch condition is statically False ({ast.unparse(stmt.test)})",
            })
    elif truth is True:
        else_codes = _stmt_gate_codes(stmt.orelse, consts, wrappers)
        if else_codes:
            dead.append({
                "file": rel,
                "function": qualname,
                "line": stmt.orelse[0].lineno,
                "kind": "always_true_shadows_else_gate",
                "codes": sorted({c for _, c in else_codes}),
                "condition": _truncate(ast.unparse(stmt.test), _GUARD_LIMIT),
                "detail": "else/elif gate branch is unreachable because prior condition is statically True",
            })
        if _block_terminates(stmt.body) and tail:
            tail_codes = _stmt_gate_codes(tail, consts, wrappers)
            if tail_codes:
                dead.append({
                    "file": rel,
                    "function": qualname,
                    "line": tail_codes[0][0],
                    "kind": "always_true_gate_shadows_following",
                    "codes": sorted({c for _, c in tail_codes}),
                    "condition": _truncate(ast.unparse(stmt.test), _GUARD_LIMIT),
                    "detail": "following gate is unreachable after statically True terminating branch",
                })
    # Check duplicate condition across if / elif chain.
    seen_tests: set[str] = {ast.dump(stmt.test)}
    cur: ast.If = stmt
    while len(cur.orelse) == 1 and isinstance(cur.orelse[0], ast.If):
        cur = cur.orelse[0]
        dumped = ast.dump(cur.test)
        if dumped in seen_tests:
            codes = _stmt_gate_codes(cur.body, consts, wrappers)
            if codes:
                dead.append({
                    "file": rel,
                    "function": qualname,
                    "line": cur.lineno,
                    "kind": "duplicate_elif_condition",
                    "codes": sorted({c for _, c in codes}),
                    "condition": _truncate(ast.unparse(cur.test), _GUARD_LIMIT),
                    "detail": f"elif repeats identical condition `{ast.unparse(cur.test)}` from earlier branch",
                })
        seen_tests.add(dumped)


def _check_shadowed_if(
    rel: str,
    qualname: str,
    stmt: ast.If,
    prior_guards: dict[str, tuple[int, set[str]]],
    consts: dict[str, str],
    wrappers: dict[str, str],
    dead: list[dict[str, Any]],
) -> None:
    dumped = ast.dump(stmt.test)
    if dumped in prior_guards:
        codes = _stmt_gate_codes(stmt.body, consts, wrappers)
        if codes:
            first_line = prior_guards[dumped][0]
            dead.append({
                "file": rel,
                "function": qualname,
                "line": stmt.lineno,
                "kind": "shadowed_identical_guard",
                "codes": sorted({c for _, c in codes}),
                "condition": _truncate(ast.unparse(stmt.test), _GUARD_LIMIT),
                "detail": f"guard `{ast.unparse(stmt.test)}` already terminated unconditionally at line {first_line}",
            })
    elif not stmt.orelse and _block_terminates(stmt.body) and _stmt_gate_codes(stmt.body, consts, wrappers):
        prior_guards[dumped] = (stmt.lineno, _names_in_expr(stmt.test))


def _scan_block_dead_gates(
    rel: str,
    qualname: str,
    stmts: Sequence[ast.stmt],
    consts: dict[str, str],
    wrappers: dict[str, str],
    dead: list[dict[str, Any]],
) -> None:
    prior_guards: dict[str, tuple[int, set[str]]] = {}
    terminated_at: int | None = None
    for idx, stmt in enumerate(stmts):
        if terminated_at is not None:
            codes = _stmt_gate_codes([stmt], consts, wrappers)
            if codes:
                dead.append({
                    "file": rel,
                    "function": qualname,
                    "line": codes[0][0],
                    "kind": "post_terminator_unreachable_gate",
                    "codes": sorted({c for _, c in codes}),
                    "condition": "",
                    "detail": f"gate at line {codes[0][0]} appears after unconditional exit at line {terminated_at}",
                })
            continue
        if isinstance(stmt, ast.If):
            _record_if_dead_gates(rel, qualname, stmt, stmts[idx + 1 :], consts, wrappers, dead)
            _check_shadowed_if(rel, qualname, stmt, prior_guards, consts, wrappers, dead)
            _scan_block_dead_gates(rel, qualname, stmt.body, consts, wrappers, dead)
            if stmt.orelse:
                _scan_block_dead_gates(rel, qualname, stmt.orelse, consts, wrappers, dead)
        else:
            _recurse_compound_dead_gates(rel, qualname, stmt, consts, wrappers, dead)
        mutated = _assigned_names(stmt)
        for key in [k for k, (_, deps) in prior_guards.items() if deps & mutated]:
            del prior_guards[key]
        if _stmt_terminates(stmt):
            terminated_at = stmt.lineno


def _recurse_compound_dead_gates(
    rel: str,
    qualname: str,
    stmt: ast.stmt,
    consts: dict[str, str],
    wrappers: dict[str, str],
    dead: list[dict[str, Any]],
) -> None:
    if isinstance(stmt, (ast.For, ast.AsyncFor, ast.While)):
        _scan_block_dead_gates(rel, qualname, stmt.body, consts, wrappers, dead)
        if stmt.orelse:
            _scan_block_dead_gates(rel, qualname, stmt.orelse, consts, wrappers, dead)
    elif isinstance(stmt, (ast.With, ast.AsyncWith)):
        _scan_block_dead_gates(rel, qualname, stmt.body, consts, wrappers, dead)
    elif isinstance(stmt, ast.Try):
        _scan_block_dead_gates(rel, qualname, stmt.body, consts, wrappers, dead)
        for handler in stmt.handlers:
            _scan_block_dead_gates(rel, qualname, handler.body, consts, wrappers, dead)
        if stmt.orelse:
            _scan_block_dead_gates(rel, qualname, stmt.orelse, consts, wrappers, dead)
        if stmt.finalbody:
            _scan_block_dead_gates(rel, qualname, stmt.finalbody, consts, wrappers, dead)


def _walk_stmt_sites(
    rel: str,
    qualname: str,
    stmts: Sequence[ast.stmt],
    guard: str,
    consts: dict[str, str],
    wrappers: dict[str, str],
    local_fns: set[str],
    sites: list[dict[str, Any]],
    called_locals: list[str],
) -> None:
    for stmt in stmts:
        if isinstance(stmt, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            continue
        if isinstance(stmt, ast.If):
            test_text = _truncate(ast.unparse(stmt.test), _GUARD_LIMIT)
            _collect_local_calls(stmt.test, local_fns, called_locals)
            _walk_stmt_sites(rel, qualname, stmt.body, test_text, consts, wrappers, local_fns, sites, called_locals)
            if stmt.orelse:
                else_guard = "" if (len(stmt.orelse) == 1 and isinstance(stmt.orelse[0], ast.If)) else f"not ({test_text})"
                _walk_stmt_sites(rel, qualname, stmt.orelse, else_guard, consts, wrappers, local_fns, sites, called_locals)
            continue
        _inspect_single_stmt(rel, qualname, stmt, guard, consts, wrappers, local_fns, sites, called_locals)


def _collect_local_calls(node: ast.AST, local_fns: set[str], called_locals: list[str]) -> None:
    for sub in _iter_shallow_nodes(node):
        if (
            isinstance(sub, ast.Call)
            and isinstance(sub.func, ast.Name)
            and sub.func.id in local_fns
            and sub.func.id not in called_locals
        ):
            called_locals.append(sub.func.id)


def _inspect_single_stmt(
    rel: str,
    qualname: str,
    stmt: ast.stmt,
    guard: str,
    consts: dict[str, str],
    wrappers: dict[str, str],
    local_fns: set[str],
    sites: list[dict[str, Any]],
    called_locals: list[str],
) -> None:
    if isinstance(stmt, ast.Raise) and isinstance(stmt.exc, ast.Call):
        hit = _extract_refusal_call(stmt.exc, consts, wrappers, in_raise=True)
        if hit:
            code, msg, kind = hit
            sites.append({
                "file": rel,
                "line": stmt.lineno,
                "function": qualname,
                "code": code,
                "kind": kind,
                "message_template": msg,
                "guard": guard,
            })
        _collect_local_calls(stmt.exc, local_fns, called_locals)
        return
    if isinstance(stmt, ast.Return) and stmt.value is not None:
        hit = None
        if isinstance(stmt.value, ast.Dict):
            hit = _extract_refusal_dict(stmt.value, consts)
        elif isinstance(stmt.value, ast.Call):
            hit = _extract_refusal_call(stmt.value, consts, wrappers, in_raise=False)
        if hit:
            code, msg, kind = hit
            sites.append({
                "file": rel,
                "line": stmt.lineno,
                "function": qualname,
                "code": code,
                "kind": kind,
                "message_template": msg,
                "guard": guard,
            })
        _collect_local_calls(stmt.value, local_fns, called_locals)
        return
    if isinstance(stmt, (ast.For, ast.AsyncFor, ast.While)):
        _walk_stmt_sites(rel, qualname, stmt.body, guard, consts, wrappers, local_fns, sites, called_locals)
        if stmt.orelse:
            _walk_stmt_sites(rel, qualname, stmt.orelse, guard, consts, wrappers, local_fns, sites, called_locals)
        return
    if isinstance(stmt, (ast.With, ast.AsyncWith)):
        _walk_stmt_sites(rel, qualname, stmt.body, guard, consts, wrappers, local_fns, sites, called_locals)
        return
    if isinstance(stmt, ast.Try):
        _walk_stmt_sites(rel, qualname, stmt.body, guard, consts, wrappers, local_fns, sites, called_locals)
        for handler in stmt.handlers:
            _walk_stmt_sites(rel, qualname, handler.body, guard, consts, wrappers, local_fns, sites, called_locals)
        if stmt.orelse:
            _walk_stmt_sites(rel, qualname, stmt.orelse, guard, consts, wrappers, local_fns, sites, called_locals)
        if stmt.finalbody:
            _walk_stmt_sites(rel, qualname, stmt.finalbody, guard, consts, wrappers, local_fns, sites, called_locals)
        return
    _collect_local_calls(stmt, local_fns, called_locals)


def _iter_functions(tree: ast.Module) -> list[tuple[str, ast.FunctionDef | ast.AsyncFunctionDef]]:
    found: list[tuple[str, ast.FunctionDef | ast.AsyncFunctionDef]] = []

    def visit(stmts: Sequence[ast.stmt], prefix: str) -> None:
        for stmt in stmts:
            if isinstance(stmt, (ast.FunctionDef, ast.AsyncFunctionDef)):
                qname = f"{prefix}.{stmt.name}" if prefix else stmt.name
                found.append((qname, stmt))
                visit(stmt.body, qname)
            elif isinstance(stmt, ast.ClassDef):
                cname = f"{prefix}.{stmt.name}" if prefix else stmt.name
                visit(stmt.body, cname)

    visit(tree.body, "")
    return found


def _analyze_file(
    rel: str,
    tree: ast.Module,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    consts = _module_string_consts(tree)
    wrappers = _local_refusal_wrappers(tree, consts)
    funcs = _iter_functions(tree)
    local_fns = {qname for qname, _ in funcs if "." not in qname}

    raw_chains: list[tuple[str, int, list[dict[str, Any]], list[str]]] = []
    all_sites: list[dict[str, Any]] = []
    dead_gates: list[dict[str, Any]] = []

    for qname, fn in funcs:
        sites: list[dict[str, Any]] = []
        called_locals: list[str] = []
        _walk_stmt_sites(rel, qname, fn.body, "", consts, wrappers, local_fns, sites, called_locals)
        _scan_block_dead_gates(rel, qname, fn.body, consts, wrappers, dead_gates)
        sites.sort(key=lambda item: item["line"])
        for order, site in enumerate(sites, 1):
            site["order"] = order
        if sites or called_locals:
            raw_chains.append((qname, fn.lineno, sites, called_locals))
        all_sites.extend(sites)

    gate_bearing = {qname for qname, _, sites, _ in raw_chains if sites}
    changed = True
    while changed:
        changed = False
        for qname, _, _, called_locals in raw_chains:
            if qname not in gate_bearing and any(name in gate_bearing for name in called_locals):
                gate_bearing.add(qname)
                changed = True
    chains: list[dict[str, Any]] = []
    for qname, lineno, sites, called_locals in raw_chains:
        helper_calls = [name for name in called_locals if name in gate_bearing and name != qname]
        if not sites and len(helper_calls) < 2:
            continue
        chains.append({
            "file": rel,
            "function": qname,
            "line": lineno,
            "gate_count": len(sites),
            "unique_codes": list(dict.fromkeys(s["code"] for s in sites)),
            "calls_local_gate_helpers": helper_calls,
            "gates": [
                {
                    "order": s["order"],
                    "line": s["line"],
                    "code": s["code"],
                    "kind": s["kind"],
                    "guard": s["guard"],
                    "message_template": s["message_template"],
                }
                for s in sites
            ],
        })
    return chains, all_sites, dead_gates


def _resolve_argparse_call(
    call: ast.Call,
    sub_owner: dict[str, tuple[str, ...]],
    parser_owner: dict[str, tuple[str, ...]],
    nouns: dict[str, set[str]],
    standalone: set[str],
) -> tuple[str, tuple[str, ...]] | None:
    if not isinstance(call.func, ast.Attribute):
        return None
    attr, recv = call.func.attr, call.func.value
    if attr == "add_subparsers":
        if isinstance(recv, ast.Name):
            return "sub", parser_owner.get(recv.id, ())
        if isinstance(recv, ast.Call):
            inner = _resolve_argparse_call(recv, sub_owner, parser_owner, nouns, standalone)
            return ("sub", inner[1]) if (inner and inner[0] == "parser") else ("sub", ())
        return "sub", ()
    if attr != "add_parser" or not call.args:
        return None
    name = _const_str(call.args[0])
    if not name:
        return None
    parent: tuple[str, ...] = ()
    if isinstance(recv, ast.Name):
        parent = sub_owner.get(recv.id, ())
    elif isinstance(recv, ast.Call):
        inner = _resolve_argparse_call(recv, sub_owner, parser_owner, nouns, standalone)
        if inner and inner[0] == "sub":
            parent = inner[1]
    full = (*parent, name)
    if len(full) == 1:
        standalone.add(full[0])
    else:
        nouns.setdefault(full[0], set()).add(full[1])
    return "parser", full


def _extract_argparse_commands(tree: ast.Module, nouns: dict[str, set[str]], standalone: set[str]) -> None:
    """Track `add_subparsers` / `add_parser` chains in AST to capture 1- and 2-level argparse CLIs."""
    sub_owner: dict[str, tuple[str, ...]] = {}
    parser_owner: dict[str, tuple[str, ...]] = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name) and isinstance(node.value, ast.Call):
            res = _resolve_argparse_call(node.value, sub_owner, parser_owner, nouns, standalone)
            if res and res[0] == "sub":
                sub_owner[node.targets[0].id] = res[1]
            elif res and res[0] == "parser":
                parser_owner[node.targets[0].id] = res[1]
        elif isinstance(node, ast.Expr) and isinstance(node.value, ast.Call):
            _resolve_argparse_call(node.value, sub_owner, parser_owner, nouns, standalone)


def _extract_nouns_dict(node: ast.Assign, nouns: dict[str, set[str]]) -> None:
    if len(node.targets) != 1 or not isinstance(node.targets[0], ast.Name):
        return
    if node.targets[0].id != "NOUNS" or not isinstance(node.value, ast.Dict):
        return
    for key_node in node.value.keys:
        noun = _const_str(key_node)
        if noun:
            nouns.setdefault(noun, set())


def _extract_declared_commands(tree: ast.Module, nouns: dict[str, set[str]]) -> None:
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            fn = _call_name(node)
            pair = (
                (_const_str(node.args[1]), _const_str(node.args[2]))
                if fn == "command" and len(node.args) >= 3
                else (_const_str(node.args[0]), _const_str(node.args[1]))
                if fn == "Command" and len(node.args) >= 2
                else (None, None)
            )
            if pair[0] and pair[1]:
                nouns.setdefault(pair[0], set()).add(pair[1])
        elif isinstance(node, ast.Assign):
            _extract_nouns_dict(node, nouns)


def extract_cli_inventory(root: Path) -> dict[str, Any]:
    """Statically extract all real CLI commands from `cli/` via AST (`command(...)`, `Command(...)`, `add_parser(...)`)."""
    nouns: dict[str, set[str]] = {}
    standalone: set[str] = set()
    for rel in _tracked_py_files(root, ("cli",)):
        tree = _parse_file(root / rel, rel)
        if tree is None:
            continue
        _extract_argparse_commands(tree, nouns, standalone)
        _extract_declared_commands(tree, nouns)
    pure_standalone = sorted(standalone - set(nouns))
    noun_map = {noun: sorted(verbs) for noun, verbs in sorted(nouns.items())}
    commands = sorted([f"{noun} {verb}" for noun, verbs in noun_map.items() for verb in verbs] + pure_standalone)
    return {"nouns": noun_map, "standalone": pure_standalone, "commands": commands}


def _dict_entries_from_value(
    rel: str,
    code: str,
    val_node: ast.AST,
    consts: dict[str, str],
) -> list[tuple[str, int, str, str]]:
    if isinstance(val_node, (ast.Tuple, ast.List)):
        out: list[tuple[str, int, str, str]] = []
        for elt in val_node.elts:
            text = _const_str(elt, consts)
            if text:
                out.append((rel, elt.lineno, code, text))
        return out
    text = _const_str(val_node, consts)
    return [(rel, val_node.lineno, code, text)] if text else []


def _extract_dict_table(root: Path, rel: str, var_name: str) -> list[tuple[str, int, str, str]]:
    path = root / rel
    if not path.is_file():
        return []
    tree = _parse_file(path, rel)
    if tree is None:
        return []
    consts = _module_string_consts(tree)
    entries: list[tuple[str, int, str, str]] = []
    for stmt in tree.body:
        target = (
            stmt.targets[0]
            if isinstance(stmt, ast.Assign) and len(stmt.targets) == 1
            else stmt.target
            if isinstance(stmt, ast.AnnAssign)
            else None
        )
        value = stmt.value if isinstance(stmt, (ast.Assign, ast.AnnAssign)) else None
        if not isinstance(target, ast.Name) or target.id != var_name or not isinstance(value, ast.Dict):
            continue
        for k_node, v_node in zip(value.keys, value.values, strict=False):
            code = _const_str(k_node, consts)
            if _is_refusal_code(code):
                entries.extend(_dict_entries_from_value(rel, str(code), v_node, consts))
    return entries


def _extract_catalogue_entries(root: Path) -> list[tuple[str, int, str, str]]:
    """Extract `(file, line, code, text)` remedy strings from `shared/refusals.py` and `live/control.py`."""
    return (
        _extract_dict_table(root, "shared/refusals.py", "CATALOGUE")
        + _extract_dict_table(root, "live/control.py", "MESSAGES")
    )


def _check_remedy_text(
    rel: str,
    line: int,
    code: str,
    text: str,
    source: str,
    nouns: dict[str, list[str]],
    standalone: set[str],
) -> list[dict[str, Any]]:
    hits: list[dict[str, Any]] = []
    if not text or (not nouns and not standalone):
        return hits

    def inspect_words(words: list[str], *, prefixed: bool) -> None:
        if not words:
            return
        head = words[0]
        if head in nouns:
            if len(words) < 2:
                return
            verb = words[1]
            if not VERB_RE.fullmatch(verb):
                return
            if verb not in nouns[head]:
                hits.append({
                    "file": rel,
                    "line": line,
                    "code": code,
                    "command": f"{head} {verb}",
                    "reason": f"unknown verb `{verb}` for CLI noun `{head}` (known: {', '.join(nouns[head])})",
                    "source": source,
                })
        elif prefixed and VERB_RE.fullmatch(head) and head not in standalone:
            cmd = f"{head} {words[1]}" if len(words) >= 2 and VERB_RE.fullmatch(words[1]) else head
            hits.append({
                "file": rel,
                "line": line,
                "code": code,
                "command": cmd,
                "reason": f"unknown CLI command `{head}`",
                "source": source,
            })

    for match in BACKTICK_RE.finditer(text):
        span = match.group(1).strip()
        pref = CLI_PREFIX_RE.match(span)
        words = span[pref.end() :].split() if pref else span.split()
        inspect_words(words, prefixed=bool(pref))

    plain = BACKTICK_RE.sub(" ", text)
    for match in PLAIN_CLI_RE.finditer(plain):
        words = [w for w in (match.group(1), match.group(2)) if w]
        inspect_words(words, prefixed=True)
    return hits


def _scan_test_code_tokens(root: Path) -> set[str]:
    tokens: set[str] = set()
    for rel in _tracked_py_files(root, ("tests",)):
        try:
            tokens.update(UPPER_TOKEN_RE.findall((root / rel).read_text(encoding="utf-8", errors="replace")))
        except OSError:
            continue
    return tokens


def _detect_duplicate_codes(chains: Sequence[dict[str, Any]]) -> list[dict[str, Any]]:
    duplicates: list[dict[str, Any]] = []
    for chain in chains:
        by_code: dict[str, list[dict[str, Any]]] = {}
        for gate in chain["gates"]:
            by_code.setdefault(gate["code"], []).append(gate)
        for code, group in sorted(by_code.items()):
            if len(group) < 2:
                continue
            guards = [g["guard"] for g in group if g["guard"]]
            msgs = [g["message_template"] for g in group if g["message_template"]]
            identical_guard = len(guards) != len(set(guards))
            identical_message = len(msgs) != len(set(msgs))
            duplicates.append({
                "file": chain["file"],
                "function": chain["function"],
                "code": code,
                "count": len(group),
                "lines": [g["line"] for g in group],
                "identical_guard": identical_guard,
                "identical_message": identical_message,
                "severity": "high" if (identical_guard or identical_message) else "review",
            })
    return duplicates


def _normalize_packages(packages: Sequence[str] | None) -> list[str]:
    if not packages:
        return list(DEFAULT_PACKAGES)
    out: list[str] = []
    for raw in packages:
        for item in raw.split(","):
            cleaned = item.strip().strip("/")
            if cleaned and cleaned not in out:
                out.append(cleaned)
    return out or list(DEFAULT_PACKAGES)


def build_gates_map(root: Path | None = None, *, packages: Sequence[str] | None = None) -> dict[str, Any]:
    """Build a deterministic static Gate & Refusal Map across `packages` under `root`."""
    resolved = _resolve_root(root)
    pkg_list = _normalize_packages(packages)
    py_files = _tracked_py_files(resolved, pkg_list)
    cli_inventory = extract_cli_inventory(resolved)
    nouns = cli_inventory["nouns"]
    standalone = set(cli_inventory["standalone"])
    test_tokens = _scan_test_code_tokens(resolved)

    chains: list[dict[str, Any]] = []
    all_sites: list[dict[str, Any]] = []
    dead_gates: list[dict[str, Any]] = []
    for rel in py_files:
        tree = _parse_file(resolved / rel, rel)
        if tree is None:
            continue
        file_chains, file_sites, file_dead = _analyze_file(rel, tree)
        chains.extend(file_chains)
        all_sites.extend(file_sites)
        dead_gates.extend(file_dead)

    chains.sort(key=lambda c: (c["file"], c["line"], c["function"]))
    dead_gates.sort(key=lambda d: (d["file"], d["line"], d["kind"]))
    duplicates = _detect_duplicate_codes(chains)

    catalogue_entries = _extract_catalogue_entries(resolved)
    remedies_by_code: dict[str, list[str]] = {}
    phantom_raw: list[dict[str, Any]] = []
    for rel, line, code, text in catalogue_entries:
        remedies_by_code.setdefault(code, []).append(_truncate(text, _MESSAGE_LIMIT))
        phantom_raw.extend(_check_remedy_text(rel, line, code, text, "catalogue", nouns, standalone))
    for site in all_sites:
        phantom_raw.extend(
            _check_remedy_text(
                site["file"], site["line"], site["code"], site["message_template"], "raise_message", nouns, standalone
            )
        )
    seen_phantom: set[tuple[str, int, str, str]] = set()
    phantom_remedies: list[dict[str, Any]] = []
    for item in sorted(phantom_raw, key=lambda x: (x["file"], x["line"], x["code"], x["command"])):
        key = (item["file"], item["line"], item["code"], item["command"])
        if key not in seen_phantom:
            seen_phantom.add(key)
            phantom_remedies.append(item)

    codes_index: dict[str, dict[str, Any]] = {}
    for site in sorted(all_sites, key=lambda s: (s["code"], s["file"], s["line"])):
        entry = codes_index.setdefault(
            site["code"],
            {
                "count": 0,
                "tested": site["code"] in test_tokens,
                "remedies": remedies_by_code.get(site["code"], []),
                "sites": [],
            },
        )
        entry["count"] += 1
        entry["sites"].append({
            "file": site["file"],
            "line": site["line"],
            "function": site["function"],
            "kind": site["kind"],
            "message_template": site["message_template"],
        })

    untested = [
        {"code": code, "site_count": meta["count"], "sites": [f"{s['file']}:{s['line']}" for s in meta["sites"]]}
        for code, meta in sorted(codes_index.items())
        if not meta["tested"]
    ]

    triggers: list[str] = []
    if phantom_remedies:
        triggers.append("gates:phantom_remedy_commands")
    if dead_gates:
        triggers.append("gates:dead_unreachable_gates")
    if untested:
        triggers.append("gates:untested_refusal_codes")
    if any(d["severity"] == "high" for d in duplicates):
        triggers.append("gates:high_risk_duplicate_codes")

    status = "fail" if (phantom_remedies or dead_gates) else ("warn" if triggers else "ok")
    return {
        "status": status,
        "root": str(resolved),
        "packages": pkg_list,
        "summary": {
            "files_scanned": len(py_files),
            "chains_found": len(chains),
            "total_gate_sites": len(all_sites),
            "distinct_codes": len(codes_index),
            "tested_codes": len(codes_index) - len(untested),
            "untested_codes": len(untested),
            "cli_nouns": len(nouns),
            "cli_commands": len(cli_inventory["commands"]),
            "phantom_remedy_count": len(phantom_remedies),
            "dead_unreachable_count": len(dead_gates),
            "duplicate_code_chains": len(duplicates),
            "high_risk_duplicate_chains": sum(1 for d in duplicates if d["severity"] == "high"),
        },
        "cli_inventory": cli_inventory,
        "chains": chains,
        "codes": codes_index,
        "untested_refusal_codes": untested,
        "phantom_remedy_commands": phantom_remedies,
        "dead_or_shadowed_candidates": {
            "dead_unreachable_gates": dead_gates,
            "duplicate_codes_in_chain": duplicates,
        },
        "triggers": triggers,
    }


def run_gates_map_cmd(args: Any) -> None:
    """CLI handler for `doctor.py gates-map`."""
    result = build_gates_map(getattr(args, "root", None), packages=getattr(args, "packages", None))
    rendered = json.dumps(result, indent=1)
    out_path = getattr(args, "out", None)
    if out_path:
        if _is_forbidden_out_path(out_path):
            raise SystemExit(f"refusing to write gates-map output to secret path: {out_path}")
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(rendered + "\n", encoding="utf-8")
    print(rendered)


def register_gates_map_parser(commands: Any) -> None:
    """Attach the `gates-map` subcommand to `doctor.py`'s argparse subparsers."""
    gm_p = commands.add_parser(
        "gates-map",
        help="static AST Gate & Refusal Map: ordered check chains, phantom CLI remedies, untested codes, dead/shadowed gates",
    )
    gm_p.add_argument(
        "--packages",
        nargs="+",
        default=None,
        help="domain packages to scan (default: live paper registration report replay ledger market engine cli ide)",
    )
    gm_p.add_argument(
        "--root",
        type=Path,
        default=None,
        help="repository root to scan (default: current git toplevel)",
    )
    gm_p.add_argument("--out", type=Path, help="optional path to write structured gates-map JSON")
    gm_p.set_defaults(function=run_gates_map_cmd)
