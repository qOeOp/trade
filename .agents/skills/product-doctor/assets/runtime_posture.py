"""Cost regression baseline gate, Dockerfile digest pinning, and security posture checks (product-doctor).

Covers high-signal checks with zero CI overlap:
  1. Cost regression baseline gate (`compare_cost_baseline`, `write_cost_baseline`) for `doctor.py cost --baseline`
  2. Dockerfile `@sha256:` digest pinning across all Dockerfiles (`doctor.py posture --check runtime`)
  3. Python security AST scan (`eval`/`exec`/`pickle`/`yaml.load`/`shell=True`/`verify=False`) and
     tracked secret file hygiene (`doctor.py posture --check security`)

100% pure Python standard library; strictly read-only on repository files; never reads credential file contents.
"""

from __future__ import annotations

import ast
import json
import math
from pathlib import Path
import statistics
import subprocess
from typing import Any

# Cost baseline regression thresholds.
TIME_EXPONENT_DELTA_MIN = 0.25
TIME_EXPONENT_AFTER_MIN = 1.35
HEAP_EXPONENT_DELTA_MIN = 0.25
HEAP_EXPONENT_AFTER_MIN = 0.35
RSS_RATIO_MIN = 1.35
RSS_DELTA_MIB_MIN = 32.0
WALL_TIME_RATIO_MIN = 1.50
WALL_TIME_DELTA_S_MIN = 0.05

# Security posture expectations.
AST_SECURITY_ALLOWLIST: dict[tuple[str, str], str] = {
    (
        "engine/load.py",
        "exec",
    ): "hash-verified and AST-screened strategy loader in engine/load.py",
}
_SUBPROCESS_CALLS = frozenset({"run", "Popen", "call", "check_call", "check_output"})
_SAFE_YAML_LOADERS = frozenset({"SafeLoader", "CSafeLoader", "BaseLoader", "CBaseLoader"})
_SKIP_DIR_PARTS = frozenset({".git", ".venv", "node_modules", "__pycache__"})
_ENV_TEMPLATE_NAMES = frozenset({".env.example", ".env.sample", ".env.template"})
_SECRET_KEY_SUFFIXES = frozenset({".key", ".key_secret", ".p12", ".pfx"})


def _as_finite_float(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    out = float(value)
    return out if math.isfinite(out) else None


def _size_series(raw: Any) -> dict[int, float]:
    if not isinstance(raw, dict):
        return {}
    out: dict[int, float] = {}
    for key, val in raw.items():
        try:
            size = int(key)
        except (TypeError, ValueError):
            continue
        if isinstance(val, (list, tuple)):
            nums = [num for item in val if (num := _as_finite_float(item)) is not None]
            if nums:
                out[size] = float(statistics.median(nums))
        else:
            num = _as_finite_float(val)
            if num is not None:
                out[size] = num
    return out


def _extract_wall_series(record: dict[str, Any]) -> tuple[dict[int, float], float | None]:
    median_raw = record.get("median_s")
    if isinstance(median_raw, dict):
        series = _size_series(median_raw)
        if series:
            return series, None
    scalar = _as_finite_float(median_raw)
    if scalar is not None:
        return {}, scalar
    return _size_series(record.get("warm_s")), None


def _extract_rss_series(record: dict[str, Any]) -> tuple[dict[int, float], float | None]:
    rss_raw = record.get("median_peak_rss_mib")
    if isinstance(rss_raw, dict):
        return _size_series(rss_raw), None
    return {}, _as_finite_float(rss_raw)


def _pick_largest_pair(
    cur_map: dict[int, float],
    cur_scalar: float | None,
    base_map: dict[int, float],
    base_scalar: float | None,
) -> tuple[int | None, float | None, float | None, bool]:
    common = set(cur_map) & set(base_map)
    if common:
        size = max(common)
        return size, cur_map[size], base_map[size], False
    if cur_map and base_map:
        return None, None, None, True
    if cur_scalar is not None and base_scalar is not None:
        return None, cur_scalar, base_scalar, False
    return None, None, None, False


def compare_cost_baseline(current: dict[str, Any], baseline: dict[str, Any]) -> dict[str, Any]:
    """Compare measured cost telemetry against a saved baseline JSON and flag regressions deterministically."""
    if not isinstance(current, dict) or not isinstance(baseline, dict):
        raise ValueError("cost comparison inputs must be JSON objects")
    violations: list[dict[str, Any]] = []
    metrics: dict[str, Any] = {}
    size_mismatch = False

    cur_exp, base_exp = _as_finite_float(current.get("exponent")), _as_finite_float(baseline.get("exponent"))
    if cur_exp is not None and base_exp is not None:
        delta = cur_exp - base_exp
        metrics["exponent"] = {"before": round(base_exp, 4), "after": round(cur_exp, 4), "delta": round(delta, 4)}
        if delta > TIME_EXPONENT_DELTA_MIN and cur_exp > TIME_EXPONENT_AFTER_MIN:
            violations.append({
                "kind": "time_exponent_regression",
                "before": round(base_exp, 4),
                "after": round(cur_exp, 4),
                "delta": round(delta, 4),
                "detail": f"time exponent rose {base_exp:.2f} -> {cur_exp:.2f} (delta +{delta:.2f} > 0.25, after > 1.35)",
            })

    cur_hexp = _as_finite_float(current.get("heap_exponent"))
    base_hexp = _as_finite_float(baseline.get("heap_exponent"))
    if cur_hexp is not None and base_hexp is None and baseline.get("median_peak_heap_kib"):
        base_hexp = 0.0
    if cur_hexp is not None and base_hexp is not None:
        delta = cur_hexp - base_hexp
        metrics["heap_exponent"] = {
            "before": round(base_hexp, 4),
            "after": round(cur_hexp, 4),
            "delta": round(delta, 4),
        }
        if delta > HEAP_EXPONENT_DELTA_MIN and cur_hexp > HEAP_EXPONENT_AFTER_MIN:
            violations.append({
                "kind": "heap_exponent_regression",
                "before": round(base_hexp, 4),
                "after": round(cur_hexp, 4),
                "delta": round(delta, 4),
                "detail": f"heap exponent rose {base_hexp:.2f} -> {cur_hexp:.2f} (delta +{delta:.2f} > 0.25, after > 0.35)",
            })

    rss_sz, cur_rss, base_rss, rss_mismatch = _pick_largest_pair(*_extract_rss_series(current), *_extract_rss_series(baseline))
    size_mismatch = size_mismatch or rss_mismatch
    if cur_rss is not None and base_rss is not None and base_rss > 0:
        delta_mib = cur_rss - base_rss
        ratio = cur_rss / base_rss
        metrics["median_peak_rss_mib"] = {
            "size": rss_sz,
            "before": round(base_rss, 3),
            "after": round(cur_rss, 3),
            "delta_mib": round(delta_mib, 3),
            "ratio": round(ratio, 4),
        }
        if ratio > RSS_RATIO_MIN and delta_mib > RSS_DELTA_MIB_MIN:
            violations.append({
                "kind": "rss_regression",
                "size": rss_sz,
                "before": round(base_rss, 3),
                "after": round(cur_rss, 3),
                "delta_mib": round(delta_mib, 3),
                "ratio": round(ratio, 4),
                "detail": f"peak RSS grew {base_rss:.1f} -> {cur_rss:.1f} MiB ({ratio:.2f}x, +{delta_mib:.1f} MiB)",
            })

    wall_sz, cur_wall, base_wall, wall_mismatch = _pick_largest_pair(*_extract_wall_series(current), *_extract_wall_series(baseline))
    size_mismatch = size_mismatch or wall_mismatch
    if cur_wall is not None and base_wall is not None and base_wall > 0:
        delta_s = cur_wall - base_wall
        ratio = cur_wall / base_wall
        metrics["wall_time_median_s"] = {
            "size": wall_sz,
            "before": round(base_wall, 6),
            "after": round(cur_wall, 6),
            "delta_s": round(delta_s, 6),
            "ratio": round(ratio, 4),
        }
        if ratio > WALL_TIME_RATIO_MIN and delta_s > WALL_TIME_DELTA_S_MIN:
            violations.append({
                "kind": "wall_time_regression",
                "size": wall_sz,
                "before": round(base_wall, 6),
                "after": round(cur_wall, 6),
                "delta_s": round(delta_s, 6),
                "ratio": round(ratio, 4),
                "detail": f"largest-size median wall time grew {base_wall:.4f}s -> {cur_wall:.4f}s ({ratio:.2f}x, +{delta_s:.4f}s)",
            })

    return {
        "regression": bool(violations),
        "size_mismatch": size_mismatch,
        "violations": violations,
        "metrics": metrics,
    }


def write_cost_baseline(path: Path, row: dict[str, Any]) -> dict[str, Any]:
    """Persist a deterministic cost baseline JSON snapshot from a `doctor.py cost` row."""
    warm_medians, _ = _extract_wall_series(row)
    payload: dict[str, Any] = {
        "subject": row.get("subject"),
        "tree": row.get("tree"),
        "probe": row.get("probe"),
        "verdict": row.get("verdict"),
        "exponent": row.get("exponent"),
        "heap_exponent": row.get("heap_exponent"),
        "warm_s": row.get("warm_s"),
        "median_s": {str(size): round(med, 6) for size, med in sorted(warm_medians.items())},
    }
    if row.get("median_peak_rss_mib") is not None:
        payload["median_peak_rss_mib"] = row["median_peak_rss_mib"]
    if row.get("median_peak_heap_kib") is not None:
        payload["median_peak_heap_kib"] = row["median_peak_heap_kib"]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    return payload


def _resolve_root(root: Path | None) -> Path:
    if root is not None:
        return root.resolve()
    done = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True, check=False)
    if done.returncode == 0 and done.stdout.strip():
        return Path(done.stdout.strip()).resolve()
    return Path.cwd().resolve()


def _tracked_files(root: Path, *patterns: str) -> list[str]:
    if (root / ".git").exists():
        done = subprocess.run(
            ["git", "-C", str(root), "ls-files", "-z", *patterns],
            capture_output=True,
            check=False,
        )
        if done.returncode == 0:
            return sorted(entry.decode("utf-8", errors="surrogateescape") for entry in done.stdout.split(b"\0") if entry)
    found: list[str] = []
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        rel = path.relative_to(root)
        if _SKIP_DIR_PARTS.intersection(rel.parts):
            continue
        if not patterns or any(path.match(pat) for pat in patterns):
            found.append(rel.as_posix())
    return sorted(found)


def _parse_dockerfile_from_lines(text: str) -> list[tuple[int, str, str | None]]:
    results: list[tuple[int, str, str | None]] = []
    for lineno, raw in enumerate(text.splitlines(), 1):
        stripped = raw.strip()
        if not stripped or stripped.startswith("#"):
            continue
        parts = stripped.split()
        if parts[0].upper() != "FROM":
            continue
        idx = 1
        while idx < len(parts) and parts[idx].startswith("--"):
            idx += 1
        if idx >= len(parts):
            continue
        image = parts[idx]
        alias = parts[idx + 2] if idx + 2 < len(parts) and parts[idx + 1].upper() == "AS" else None
        results.append((lineno, image, alias))
    return results


def _is_internal_stage_ref(image: str, stages: set[str]) -> bool:
    low = image.lower()
    if low == "scratch" or low in stages:
        return True
    if "${" in image or "$" in image:
        prefix = image.split("$", 1)[0].lower()
        return bool(prefix) and any(stage.startswith(prefix) for stage in stages)
    return False


def _audit_dockerfile(rel: str, path: Path, violations: list[dict[str, Any]], triggers: list[str]) -> dict[str, Any]:
    stages: set[str] = set()
    external_images: list[dict[str, Any]] = []
    for lineno, image, alias in _parse_dockerfile_from_lines(path.read_text(encoding="utf-8", errors="replace")):
        if not _is_internal_stage_ref(image, stages):
            has_digest = "@sha256:" in image
            tag_part = image.split("@", 1)[0]
            is_latest = tag_part.lower().endswith(":latest")
            external_images.append({"line": lineno, "image": image, "digest_pinned": has_digest, "latest": is_latest})
            if is_latest:
                violations.append({
                    "kind": "floating_latest_base_image",
                    "location": f"{rel}:{lineno}",
                    "image": image,
                    "detail": f"floating :latest tag in {rel}:{lineno} ({image})",
                })
                triggers.append("runtime:floating_latest_base_image")
            elif not has_digest:
                violations.append({
                    "kind": "unpinned_base_image_digest",
                    "location": f"{rel}:{lineno}",
                    "image": image,
                    "detail": f"base image lacks @sha256 digest in {rel}:{lineno} ({image})",
                })
                triggers.append("runtime:unpinned_base_image_digest")
        if alias:
            stages.add(alias.lower())
    return {"file": rel, "external_images": external_images}


def check_runtime_posture(root: Path) -> dict[str, Any]:
    """Verify every Dockerfile external `FROM` image is pinned by `@sha256:` digest (no floating tags)."""
    violations: list[dict[str, Any]] = []
    triggers: list[str] = []
    dockerfiles_found = [
        rel for rel in _tracked_files(root)
        if not rel.endswith(".dockerignore") and (Path(rel).name == "Dockerfile" or Path(rel).name.endswith(".Dockerfile"))
    ]
    dockerfiles = [_audit_dockerfile(rel, root / rel, violations, triggers) for rel in dockerfiles_found if (root / rel).is_file()]
    return {
        "status": "ok" if not violations else "fail",
        "dockerfiles": dockerfiles,
        "violations": violations,
        "triggers": sorted(set(triggers)),
    }


def _collect_import_aliases(tree: ast.AST) -> tuple[dict[str, str], dict[str, str]]:
    module_aliases: dict[str, str] = {}
    symbol_aliases: dict[str, str] = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                if alias.asname:
                    module_aliases[alias.asname] = alias.name
                else:
                    root = alias.name.split(".")[0]
                    module_aliases.setdefault(root, root)
        elif isinstance(node, ast.ImportFrom) and node.module:
            for alias in node.names:
                symbol_aliases[alias.asname or alias.name] = f"{node.module}.{alias.name}"
    return module_aliases, symbol_aliases


def _resolve_call_name(call: ast.Call, module_aliases: dict[str, str], symbol_aliases: dict[str, str]) -> str:
    fn = call.func
    if isinstance(fn, ast.Name):
        return symbol_aliases.get(fn.id, fn.id)
    if isinstance(fn, ast.Attribute) and isinstance(fn.value, ast.Name):
        base = module_aliases.get(fn.value.id, fn.value.id)
        return f"{base}.{fn.attr}"
    return ""


def _yaml_loader_is_safe(call: ast.Call) -> bool:
    loader_node: ast.AST | None = call.args[1] if len(call.args) >= 2 else None
    for kw in call.keywords:
        if kw.arg == "Loader":
            loader_node = kw.value
    if isinstance(loader_node, ast.Name):
        return loader_node.id in _SAFE_YAML_LOADERS
    if isinstance(loader_node, ast.Attribute):
        return loader_node.attr in _SAFE_YAML_LOADERS
    return False


def _inspect_ast_call(
    rel: str,
    call: ast.Call,
    module_aliases: dict[str, str],
    symbol_aliases: dict[str, str],
) -> list[dict[str, Any]]:
    hits: list[dict[str, Any]] = []
    name = _resolve_call_name(call, module_aliases, symbol_aliases)
    loc = f"{rel}:{call.lineno}"
    if name in ("eval", "builtins.eval"):
        hits.append({"location": loc, "file": rel, "line": call.lineno, "pattern": "eval", "detail": "eval() call"})
    elif name in ("exec", "builtins.exec"):
        hits.append({"location": loc, "file": rel, "line": call.lineno, "pattern": "exec", "detail": "exec() call"})
    elif name in ("pickle.loads", "pickle.load", "_pickle.loads", "_pickle.load"):
        hits.append({
            "location": loc,
            "file": rel,
            "line": call.lineno,
            "pattern": "pickle_deserialize",
            "detail": f"{name}() deserialization",
        })
    elif name == "yaml.unsafe_load" or (name in ("yaml.load", "yaml.load_all") and not _yaml_loader_is_safe(call)):
        hits.append({
            "location": loc,
            "file": rel,
            "line": call.lineno,
            "pattern": "unsafe_yaml_load",
            "detail": f"{name}() without SafeLoader",
        })
    for kw in call.keywords:
        if kw.arg == "shell" and isinstance(kw.value, ast.Constant) and bool(kw.value.value) is True:
            tail = name.rsplit(".", 1)[-1]
            if name.startswith("subprocess.") or tail in _SUBPROCESS_CALLS:
                hits.append({
                    "location": loc,
                    "file": rel,
                    "line": call.lineno,
                    "pattern": "subprocess_shell_true",
                    "detail": f"{name}(..., shell=True)",
                })
        elif kw.arg == "verify" and isinstance(kw.value, ast.Constant) and kw.value.value is not None and bool(kw.value.value) is False:
            hits.append({
                "location": loc,
                "file": rel,
                "line": call.lineno,
                "pattern": "tls_verify_disabled",
                "detail": f"{name or 'call'}(..., verify=False)",
            })
    return hits


def _scan_python_security_ast(root: Path) -> tuple[int, list[dict[str, Any]], list[dict[str, Any]]]:
    py_files = [
        rel for rel in _tracked_files(root, "*.py")
        if not rel.startswith(("tests/", ".agents/evals/")) and (root / rel).is_file()
    ]
    findings: list[dict[str, Any]] = []
    allowlisted: list[dict[str, Any]] = []
    for rel in py_files:
        try:
            tree = ast.parse((root / rel).read_text(encoding="utf-8", errors="replace"), rel)
        except (OSError, SyntaxError):
            continue
        mod_aliases, sym_aliases = _collect_import_aliases(tree)
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            for hit in _inspect_ast_call(rel, node, mod_aliases, sym_aliases):
                reason = AST_SECURITY_ALLOWLIST.get((rel, hit["pattern"]))
                if reason:
                    allowlisted.append({**hit, "reason": reason})
                else:
                    findings.append(hit)
    findings.sort(key=lambda item: (item["file"], item["line"], item["pattern"]))
    allowlisted.sort(key=lambda item: (item["file"], item["line"], item["pattern"]))
    return len(py_files), findings, allowlisted


def _pem_is_public_cert_only(path: Path) -> bool:
    try:
        headers = [
            line.strip()
            for line in path.read_text(encoding="utf-8", errors="replace").splitlines()
            if line.strip().startswith("-----BEGIN ")
        ]
    except OSError:
        return False
    return bool(headers) and all("CERTIFICATE" in h and "PRIVATE KEY" not in h for h in headers)


def _check_tracked_secrets(root: Path) -> tuple[list[dict[str, Any]], list[str]]:
    secret_files: list[dict[str, Any]] = []
    public_certs: list[str] = []
    for rel in _tracked_files(root):
        name = Path(rel).name.lower()
        suffix = Path(rel).suffix.lower()
        if (name == ".env" or name.startswith(".env.")) and name not in _ENV_TEMPLATE_NAMES:
            secret_files.append({"file": rel, "reason": "tracked_env_file"})
        elif name == "service.json":
            secret_files.append({"file": rel, "reason": "tracked_service_json"})
        elif suffix in _SECRET_KEY_SUFFIXES:
            secret_files.append({"file": rel, "reason": f"tracked_key_file:{suffix}"})
        elif suffix == ".pem":
            if _pem_is_public_cert_only(root / rel):
                public_certs.append(rel)
            else:
                secret_files.append({"file": rel, "reason": "tracked_private_or_noncert_pem"})
    return secret_files, public_certs


def check_security_posture(root: Path) -> dict[str, Any]:
    """Scan production Python AST for dangerous calls and verify no secret files are tracked."""
    scanned_count, ast_findings, allowlisted = _scan_python_security_ast(root)
    tracked_secrets, public_certs = _check_tracked_secrets(root)

    violations: list[dict[str, Any]] = []
    triggers: list[str] = []
    for hit in ast_findings:
        violations.append({"kind": f"ast_{hit['pattern']}", **hit})
        triggers.append(f"security:ast_{hit['pattern']}")
    for sec in tracked_secrets:
        violations.append({"kind": "tracked_secret_file", **sec, "detail": f"forbidden credential file tracked: {sec['file']}"})
        triggers.append("security:tracked_secret_file")

    return {
        "status": "ok" if not violations else "fail",
        "ast_files_scanned": scanned_count,
        "ast_findings": ast_findings,
        "allowlisted_ast_findings": allowlisted,
        "tracked_secret_files": tracked_secrets,
        "public_cert_bundles": public_certs,
        "violations": violations,
        "triggers": sorted(set(triggers)),
    }


def run_posture(root: Path | None = None, *, check: str = "all", tree_rev: str | None = None) -> dict[str, Any]:
    """Run Dockerfile digest pinning and/or Python security AST + tracked-secret checks against `root`."""
    resolved = _resolve_root(root)
    selected = ("runtime", "security") if check == "all" else (check,)
    out: dict[str, Any] = {"status": "ok", "check": check, "root": str(resolved)}
    if tree_rev is not None:
        out["tree"] = tree_rev
    triggers: list[str] = []
    runners = {
        "runtime": check_runtime_posture,
        "security": check_security_posture,
    }
    for name in selected:
        section = runners[name](resolved)
        out[name] = section
        triggers.extend(section.get("triggers", []))
        if section.get("status") != "ok":
            out["status"] = "fail"
    out["triggers"] = sorted(set(triggers))
    return out


def _is_forbidden_out_path(path: Path) -> bool:
    name = path.name.lower()
    if name == ".env" or name.startswith(".env.") or name == "service.json":
        return True
    return path.suffix.lower() in _SECRET_KEY_SUFFIXES or path.suffix.lower() == ".pem"


def run_posture_cmd(args: Any) -> None:
    """CLI handler for `doctor.py posture`."""
    result = run_posture(getattr(args, "root", None), check=args.check, tree_rev=getattr(args, "_tree_rev", None))
    rendered = json.dumps(result, indent=1)
    out_path = getattr(args, "out", None)
    if out_path:
        if _is_forbidden_out_path(out_path):
            raise SystemExit(f"refusing to write posture output to secret path: {out_path}")
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(rendered + "\n", encoding="utf-8")
    print(rendered)


def register_posture_parser(commands: Any) -> None:
    """Attach the `posture` subcommand to `doctor.py`'s argparse subparsers."""
    pos_p = commands.add_parser(
        "posture",
        help="deterministic Dockerfile @sha256 digest pinning, Python security AST, and tracked-secret audit",
    )
    pos_p.add_argument(
        "--check",
        choices=("all", "runtime", "security"),
        default="all",
        help="which posture checks to run (default: %(default)s)",
    )
    pos_p.add_argument(
        "--root",
        type=Path,
        default=None,
        help="repository root to audit (default: current git toplevel)",
    )
    pos_p.add_argument(
        "--tree",
        default=None,
        metavar="REV",
        help="optional git revision to materialize via git archive and audit instead of --root",
    )
    pos_p.add_argument("--out", type=Path, help="optional path to write structured posture JSON")
    pos_p.set_defaults(function=run_posture_cmd)
