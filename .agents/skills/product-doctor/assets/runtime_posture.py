"""Runtime parity, cost regression baseline gate, security/supply-chain posture, and docs drift checks (product-doctor v3.2).

Covers Dimensions 3 (Replay/Engine/Nautilus) and 10 (Code/Cost/Security/Docs):
  1. Cost regression baseline gate (`compare_cost_baseline`, `write_cost_baseline`) for `doctor.py cost --baseline`
  2. Replay closure & Nautilus pinning audit (`doctor.py posture --check runtime`)
  3. Security & supply-chain posture audit (`doctor.py posture --check security`)
  4. Docs & CLI reference drift detector (`doctor.py posture --check docs`)

100% pure Python standard library; strictly read-only on repository files; never reads credential file contents.
"""

from __future__ import annotations

import ast
import json
import math
from pathlib import Path
import re
import shlex
import statistics
import subprocess
import tomllib
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

# Runtime closure expectations.
RUNTIME_CLOSURE_FILES = (
    "engine/runtime/replay.Dockerfile",
    "engine/runtime/Dockerfile",
    "runtime/image.py",
    "runtime/container.py",
    "runtime/identity.py",
)
REPLAY_CLOSURE_TEST = "tests/runtime/test_replay_closure.py"
REPLAY_CLOSURE_MARKERS = (
    "RUNTIME_SOURCE_PATHS",
    "AUDIT_PATH",
    "replay.Dockerfile",
    "engine.run",
    "engine.audit",
    "engine.compare",
)

# Security & supply-chain expectations.
NODE_MANIFEST_CANDIDATES = (
    "ide/web/package.json",
    "ide/overview/package.json",
    "ide/agent/package.json",
)
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

# Docs drift expectations.
TOP_LEVEL_DOCS = ("README.md", "AGENTS.md", "CLAUDE.md", "SECURITY.md")
REPO_PATH_PREFIXES = (
    "docs/",
    ".agents/skills/",
    ".github/",
    "engine/",
    "cli/",
    "runtime/",
    "deploy/",
    "ide/",
    "ledger/",
    "market/",
    "paper/",
    "live/",
    "replay/",
    "report/",
    "registration/",
    "shared/",
    "changelog.d/",
)
_MD_LINK_RE = re.compile(r"!?\[[^\]]*\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")
_BACKTICK_RE = re.compile(r"`([^`\n]+)`")
_PY_SPEC_OP_RE = re.compile(r"(==|>=|<=|~=|!=|<|>)")
_NODE_WILDCARD_EXACT = frozenset({"", "*", "latest", "next", "canary", "x", "X"})
_NODE_WILDCARD_RE = re.compile(r"(?:^|\.)[*xX](?:$|\.)|^\s*>=?\s*\d")


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


def _canonical_pkg(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def _resolve_root(root: Path | None) -> Path:
    if root is not None:
        return root.resolve()
    done = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True, check=False)
    if done.returncode == 0 and done.stdout.strip():
        return Path(done.stdout.strip()).resolve()
    return Path.cwd().resolve()


def _tracked_files(root: Path, *patterns: str) -> list[str]:
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
        rel_str = rel.as_posix()
        if not patterns or any(path.match(pat) for pat in patterns):
            found.append(rel_str)
    return sorted(found)


def _find_pyproject_nautilus_spec(root: Path) -> str | None:
    pyproject = root / "pyproject.toml"
    if not pyproject.is_file():
        return None
    try:
        data = tomllib.loads(pyproject.read_text(encoding="utf-8"))
    except (OSError, tomllib.TOMLDecodeError):
        return None
    deps = data.get("project", {}).get("dependencies", [])
    if not isinstance(deps, list):
        return None
    for spec in deps:
        if isinstance(spec, str):
            name = re.split(r"[\s<>=!~;\[]", spec, maxsplit=1)[0]
            if _canonical_pkg(name) == "nautilus-trader":
                return spec
    return None


def _check_nautilus_pinning(root: Path, violations: list[dict[str, Any]], triggers: list[str]) -> dict[str, Any]:
    uv_lock = root / "uv.lock"
    py_spec = _find_pyproject_nautilus_spec(root)
    info: dict[str, Any] = {
        "uv_lock_present": uv_lock.is_file(),
        "pinned": False,
        "version": None,
        "sdist_locked": False,
        "wheel_count": 0,
        "all_wheels_hashed": False,
        "pyproject_spec": py_spec,
        "pyproject_exact_pin": bool(py_spec and "==" in py_spec and "*" not in py_spec),
    }
    if not uv_lock.is_file():
        violations.append({"kind": "missing_uv_lock", "file": "uv.lock", "detail": "uv.lock is missing"})
        triggers.append("runtime:missing_uv_lock")
        return info
    try:
        lock_data = tomllib.loads(uv_lock.read_text(encoding="utf-8"))
    except (OSError, tomllib.TOMLDecodeError) as error:
        violations.append({"kind": "invalid_uv_lock", "file": "uv.lock", "detail": str(error)})
        triggers.append("runtime:invalid_uv_lock")
        return info
    pkgs = lock_data.get("package", [])
    entry = next(
        (p for p in pkgs if isinstance(p, dict) and _canonical_pkg(str(p.get("name", ""))) == "nautilus-trader"),
        None,
    )
    if entry is None:
        violations.append({"kind": "nautilus_not_locked", "file": "uv.lock", "detail": "nautilus-trader not in uv.lock"})
        triggers.append("runtime:nautilus_not_locked")
        return info
    version = str(entry.get("version", "")).strip()
    sdist = entry.get("sdist")
    sdist_locked = isinstance(sdist, dict) and str(sdist.get("hash", "")).startswith("sha256:")
    wheels = entry.get("wheels") if isinstance(entry.get("wheels"), list) else []
    all_wheels_hashed = bool(wheels) and all(
        isinstance(w, dict) and str(w.get("hash", "")).startswith("sha256:") for w in wheels
    )
    exact_ver = bool(version) and "*" not in version and not any(op in version for op in ("<", ">", "~", "^"))
    info.update({
        "pinned": exact_ver and (sdist_locked or all_wheels_hashed),
        "version": version or None,
        "sdist_locked": sdist_locked,
        "wheel_count": len(wheels),
        "all_wheels_hashed": all_wheels_hashed,
    })
    if not info["pinned"]:
        violations.append({
            "kind": "nautilus_unpinned",
            "file": "uv.lock",
            "detail": f"nautilus-trader version={version!r} lacks exact pin or sha256 artifact hashes",
        })
        triggers.append("runtime:nautilus_unpinned")
    if py_spec and not info["pyproject_exact_pin"]:
        violations.append({
            "kind": "nautilus_pyproject_not_exact",
            "file": "pyproject.toml",
            "detail": f"nautilus_trader dependency {py_spec!r} is not pinned with ==",
        })
        triggers.append("runtime:nautilus_pyproject_not_exact")
    elif py_spec and info["pyproject_exact_pin"] and version:
        py_ver = py_spec.split("==", 1)[1].split(";", 1)[0].strip()
        if py_ver != version:
            violations.append({
                "kind": "nautilus_version_mismatch",
                "file": "pyproject.toml",
                "detail": f"pyproject.toml pins {py_ver!r} but uv.lock locks {version!r}",
            })
            triggers.append("runtime:nautilus_version_mismatch")
    return info


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


def _check_replay_dockerfile_copies(root: Path, rel: str, violations: list[dict[str, Any]], triggers: list[str]) -> dict[str, Any]:
    path = root / rel
    if not path.is_file():
        return {"present": False, "missing_copied_files": [], "frozen_uv_sync": False, "has_contract_label": False}
    text = path.read_text(encoding="utf-8", errors="replace")
    missing_copies: list[str] = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or not line.upper().startswith("COPY "):
            continue
        try:
            words = shlex.split(line)
        except ValueError:
            continue
        if len(words) < 3 or any(w.startswith("--from=") for w in words[1:]):
            continue
        for src in words[1:-1]:
            if src.startswith("--") or "*" in src:
                continue
            if not (root / src).exists():
                missing_copies.append(src)
    frozen_sync = "uv sync --frozen" in text
    has_contract = "trade.runtime.contract=" in text
    if missing_copies:
        violations.append({
            "kind": "replay_dockerfile_missing_copy_source",
            "file": rel,
            "missing": sorted(missing_copies),
            "detail": f"{rel} copies missing path(s): {', '.join(sorted(missing_copies))}",
        })
        triggers.append("runtime:replay_closure_missing_source")
    if not frozen_sync:
        violations.append({"kind": "replay_dockerfile_unfrozen_sync", "file": rel, "detail": f"{rel} lacks `uv sync --frozen`"})
        triggers.append("runtime:replay_unfrozen_sync")
    return {
        "present": True,
        "missing_copied_files": sorted(missing_copies),
        "frozen_uv_sync": frozen_sync,
        "has_contract_label": has_contract,
    }


def check_runtime_posture(root: Path) -> dict[str, Any]:
    """Dimension 3: Replay closure, Dockerfile pinning hygiene, and Nautilus lock verification."""
    violations: list[dict[str, Any]] = []
    triggers: list[str] = []

    nautilus = _check_nautilus_pinning(root, violations, triggers)
    dockerfiles_found = [
        rel for rel in _tracked_files(root)
        if not rel.endswith(".dockerignore") and (Path(rel).name == "Dockerfile" or Path(rel).name.endswith(".Dockerfile"))
    ]
    dockerfiles = [_audit_dockerfile(rel, root / rel, violations, triggers) for rel in dockerfiles_found if (root / rel).is_file()]

    runtime_files = {rel: (root / rel).is_file() for rel in RUNTIME_CLOSURE_FILES}
    missing_runtime = [rel for rel, ok in runtime_files.items() if not ok]
    for rel in missing_runtime:
        violations.append({"kind": "missing_runtime_closure_file", "file": rel, "detail": f"missing closure file {rel}"})
        triggers.append("runtime:missing_closure_file")

    closure_test = root / REPLAY_CLOSURE_TEST
    test_present = closure_test.is_file()
    test_text = closure_test.read_text(encoding="utf-8", errors="replace") if test_present else ""
    markers_present = [m for m in REPLAY_CLOSURE_MARKERS if m in test_text]
    missing_markers = [m for m in REPLAY_CLOSURE_MARKERS if m not in test_text]
    if not test_present:
        violations.append({"kind": "missing_replay_closure_test", "file": REPLAY_CLOSURE_TEST, "detail": f"missing {REPLAY_CLOSURE_TEST}"})
        triggers.append("runtime:missing_closure_test")
    elif missing_markers:
        violations.append({
            "kind": "incomplete_replay_closure_test",
            "file": REPLAY_CLOSURE_TEST,
            "missing_markers": missing_markers,
            "detail": f"{REPLAY_CLOSURE_TEST} missing closure markers: {', '.join(missing_markers)}",
        })
        triggers.append("runtime:incomplete_closure_test")

    replay_df = _check_replay_dockerfile_copies(root, "engine/runtime/replay.Dockerfile", violations, triggers)

    return {
        "status": "ok" if not violations else "fail",
        "nautilus": nautilus,
        "dockerfiles": dockerfiles,
        "replay_closure": {
            "test_present": test_present,
            "test_path": REPLAY_CLOSURE_TEST,
            "markers_present": markers_present,
            "missing_markers": missing_markers,
            "runtime_files_present": runtime_files,
            "replay_dockerfile": replay_df,
        },
        "violations": violations,
        "triggers": sorted(set(triggers)),
    }


def _is_unpinned_py_spec(spec: str) -> bool:
    cleaned = spec.split(";", 1)[0].strip()
    if not cleaned:
        return True
    if "*" in cleaned or "latest" in cleaned.lower():
        return True
    return _PY_SPEC_OP_RE.search(cleaned) is None


def _is_unpinned_node_spec(spec: str) -> bool:
    cleaned = spec.strip()
    if cleaned in _NODE_WILDCARD_EXACT:
        return True
    return bool(_NODE_WILDCARD_RE.search(cleaned))


def _check_pyproject_deps(
    root: Path,
    manifests: list[str],
    dep_findings: list[dict[str, Any]],
    missing_locks: list[str],
) -> None:
    pyproject = root / "pyproject.toml"
    if not pyproject.is_file():
        return
    manifests.append("pyproject.toml")
    if not (root / "uv.lock").is_file():
        missing_locks.append("uv.lock")
    try:
        data = tomllib.loads(pyproject.read_text(encoding="utf-8"))
    except (OSError, tomllib.TOMLDecodeError) as error:
        dep_findings.append({"file": "pyproject.toml", "spec": "<parse_error>", "detail": str(error)})
        return
    groups: list[tuple[str, list[Any]]] = [("project.dependencies", data.get("project", {}).get("dependencies", []))]
    dep_groups = data.get("dependency-groups", {})
    if isinstance(dep_groups, dict):
        for group_name, entries in sorted(dep_groups.items()):
            if isinstance(entries, list):
                groups.append((f"dependency-groups.{group_name}", entries))
    for section, entries in groups:
        dep_findings.extend(
            {
                "file": "pyproject.toml",
                "section": section,
                "spec": spec,
                "detail": f"unpinned or wildcard Python dependency: {spec!r}",
            }
            for spec in entries
            if isinstance(spec, str) and _is_unpinned_py_spec(spec)
        )


def _check_node_manifests(
    root: Path,
    manifests: list[str],
    dep_findings: list[dict[str, Any]],
    missing_locks: list[str],
) -> None:
    for rel in NODE_MANIFEST_CANDIDATES:
        path = root / rel
        if not path.is_file():
            continue
        manifests.append(rel)
        lock_rel = (Path(rel).parent / "package-lock.json").as_posix()
        if not (root / lock_rel).is_file():
            missing_locks.append(lock_rel)
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            dep_findings.append({"file": rel, "spec": "<parse_error>", "detail": str(error)})
            continue
        for section in ("dependencies", "devDependencies"):
            block = data.get(section)
            if not isinstance(block, dict):
                continue
            for pkg, ver in sorted(block.items()):
                if not isinstance(ver, str) or _is_unpinned_node_spec(ver):
                    dep_findings.append({
                        "file": rel,
                        "section": section,
                        "package": pkg,
                        "spec": ver,
                        "detail": f"unpinned or wildcard Node dependency {pkg}: {ver!r}",
                    })


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
    """Dimension 10: Dependency pinning, lockfiles, Python AST dangerous patterns, and tracked credential hygiene."""
    manifests: list[str] = []
    dep_findings: list[dict[str, Any]] = []
    missing_locks: list[str] = []
    _check_pyproject_deps(root, manifests, dep_findings, missing_locks)
    _check_node_manifests(root, manifests, dep_findings, missing_locks)

    scanned_count, ast_findings, allowlisted = _scan_python_security_ast(root)
    tracked_secrets, public_certs = _check_tracked_secrets(root)

    violations: list[dict[str, Any]] = []
    triggers: list[str] = []
    for dep in dep_findings:
        violations.append({"kind": "unpinned_dependency", **dep})
        triggers.append("security:unpinned_dependency")
    for lock in sorted(set(missing_locks)):
        violations.append({"kind": "missing_lockfile", "file": lock, "detail": f"missing lockfile {lock}"})
        triggers.append("security:missing_lockfile")
    for hit in ast_findings:
        violations.append({"kind": f"ast_{hit['pattern']}", **hit})
        triggers.append(f"security:ast_{hit['pattern']}")
    for sec in tracked_secrets:
        violations.append({"kind": "tracked_secret_file", **sec, "detail": f"forbidden credential file tracked: {sec['file']}"})
        triggers.append("security:tracked_secret_file")

    return {
        "status": "ok" if not violations else "fail",
        "manifests_checked": manifests,
        "dependency_findings": dep_findings,
        "missing_lockfiles": sorted(set(missing_locks)),
        "ast_files_scanned": scanned_count,
        "ast_findings": ast_findings,
        "allowlisted_ast_findings": allowlisted,
        "tracked_secret_files": tracked_secrets,
        "public_cert_bundles": public_certs,
        "violations": violations,
        "triggers": sorted(set(triggers)),
    }


def _doc_targets(root: Path) -> list[str]:
    targets = [name for name in TOP_LEVEL_DOCS if (root / name).is_file()]
    skills_dir = root / ".agents/skills"
    if skills_dir.is_dir():
        targets.extend(skill_doc.relative_to(root).as_posix() for skill_doc in sorted(skills_dir.glob("*/SKILL.md")))
    return targets


def _scan_doc_file(root: Path, rel: str) -> tuple[int, int, list[dict[str, Any]]]:
    doc_path = root / rel
    root_resolved = root.resolve()
    broken: list[dict[str, Any]] = []
    links_checked = 0
    paths_checked = 0
    fence_char = ""

    for lineno, line in enumerate(doc_path.read_text(encoding="utf-8", errors="replace").splitlines(), 1):
        stripped = line.strip()
        if not fence_char and stripped.startswith(("```", "~~~")):
            fence_char = stripped[0]
            continue
        if fence_char:
            if stripped.startswith(fence_char * 3):
                fence_char = ""
            continue
        prose = _BACKTICK_RE.sub("", line)
        for match in _MD_LINK_RE.finditer(prose):
            raw_target = match.group(1)
            target = raw_target.split("#", 1)[0].split("?", 1)[0]
            if not target or "://" in target or target.startswith(("mailto:", "#")):
                continue
            links_checked += 1
            resolved = ((root_resolved / target.lstrip("/")) if target.startswith("/") else (doc_path.parent / target)).resolve()
            if not resolved.is_relative_to(root_resolved) or not resolved.exists():
                broken.append({"file": rel, "line": lineno, "kind": "markdown_link", "target": raw_target})
        for match in _BACKTICK_RE.finditer(line):
            tok = match.group(1).strip()
            if not tok or not tok.startswith(REPO_PATH_PREFIXES):
                continue
            if any(ch in tok for ch in " *<>{}$|;():") or "..." in tok:
                continue
            paths_checked += 1
            clean = tok.split("#", 1)[0].rstrip("/")
            if clean and not (root / clean).exists():
                broken.append({"file": rel, "line": lineno, "kind": "backtick_path", "target": tok})
    return links_checked, paths_checked, broken


def check_docs_posture(root: Path) -> dict[str, Any]:
    """Dimension 10: Verify relative markdown links and backticked repo paths in top-level & skill docs exist."""
    docs = _doc_targets(root)
    links_checked = 0
    paths_checked = 0
    broken_refs: list[dict[str, Any]] = []
    for rel in docs:
        l_cnt, p_cnt, broken = _scan_doc_file(root, rel)
        links_checked += l_cnt
        paths_checked += p_cnt
        broken_refs.extend(broken)
    violations = [
        {
            "kind": "broken_doc_ref",
            "location": f"{ref['file']}:{ref['line']}",
            **ref,
            "detail": f"broken {ref['kind']} in {ref['file']}:{ref['line']} -> {ref['target']}",
        }
        for ref in broken_refs
    ]
    triggers = ["docs:broken_doc_refs"] if broken_refs else []
    return {
        "status": "ok" if not broken_refs else "fail",
        "docs_scanned": docs,
        "links_checked": links_checked,
        "paths_checked": paths_checked,
        "broken_doc_refs": broken_refs,
        "violations": violations,
        "triggers": triggers,
    }


def run_posture(root: Path | None = None, *, check: str = "all") -> dict[str, Any]:
    """Run runtime, security, and/or docs posture audits against `root`."""
    resolved = _resolve_root(root)
    selected = ("runtime", "security", "docs") if check == "all" else (check,)
    out: dict[str, Any] = {"status": "ok", "check": check, "root": str(resolved)}
    triggers: list[str] = []
    runners = {
        "runtime": check_runtime_posture,
        "security": check_security_posture,
        "docs": check_docs_posture,
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
    result = run_posture(getattr(args, "root", None), check=args.check)
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
        help="deterministic runtime pinning/closure, security/supply-chain, and docs-drift audit",
    )
    pos_p.add_argument(
        "--check",
        choices=("all", "runtime", "security", "docs"),
        default="all",
        help="which posture checks to run (default: %(default)s)",
    )
    pos_p.add_argument(
        "--root",
        type=Path,
        default=None,
        help="repository root to audit (default: current git toplevel)",
    )
    pos_p.add_argument("--out", type=Path, help="optional path to write structured posture JSON")
    pos_p.set_defaults(function=run_posture_cmd)
