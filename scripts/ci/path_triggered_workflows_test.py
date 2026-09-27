#!/usr/bin/env python3
"""
Both directions for scripts/ci/path_triggered_workflows.py.

Each pattern rule is checked on a path it must match and a path it must not. Every undecidable
filter counts as triggered. A workflow with no pull_request trigger never does. The three real
workflow files are read from this checkout and given real diffs:
- #1100's files, which include the root Cargo.toml, require docs-pages;
- a Dashboard file requires product-packages;
- a plain crate edit requires none of them;
- a service's uv.lock requires security-audit and that service's own workflow.

"""

from __future__ import annotations

import sys
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parent))
from path_triggered_workflows import NOT_ON_PULL_REQUESTS
from path_triggered_workflows import pull_request_filters
from path_triggered_workflows import triggers


ROOT = Path(__file__).resolve().parents[2]
WORKFLOWS = ROOT / ".github" / "workflows"


def check(label: str, filters: object, changed: list[str], expected: bool, why: str = "") -> None:
    decision, reason = triggers(filters, changed)
    if decision != expected:
        sys.exit(f"FAIL {label}: expected {expected}, got {decision} ({reason})")
    if why and why not in reason:
        sys.exit(f"FAIL {label}: the reason does not say {why!r}: {reason}")
    print(f"ok {label}: {reason}")


def main() -> None:
    docs = {"paths": ["docs/**", "Cargo.toml", "icon.svg"]}
    check("** crosses directories", docs, ["docs/guide/a/b.md"], True, "matches docs/**")
    check("dir/** needs the directory", docs, ["docs.md", "docs-site/x"], False)
    check("a root file is not the same name deeper", docs, ["crates/data/Cargo.toml"], False)
    check("a root file matches itself", docs, ["Cargo.toml"], True, "matches Cargo.toml")
    check("* stays within one directory", {"paths": ["a/*.md"]}, ["a/b/c.md"], False)
    check("* within one directory", {"paths": ["a/*.md"]}, ["a/c.md"], True)
    check("? is one character", {"paths": ["a/?.md"]}, ["a/bc.md"], False)
    check(
        "a negation is not evaluated",
        {"paths": ["docs/**", "!docs/x.md"]},
        ["src/a.rs"],
        True,
        "syntax",
    )
    check(
        "paths-ignore is not evaluated",
        {"paths-ignore": ["docs/**"]},
        ["src/a.rs"],
        True,
        "paths-ignore",
    )
    check(
        "no paths filter runs on everything",
        {"branches": ["main"]},
        ["src/a.rs"],
        True,
        "no paths",
    )
    check("paths not a list", {"paths": "docs/**"}, ["docs/a.md"], True, "not a list")
    many = [f"src/f{i}.rs" for i in range(301)]
    check("over 300 files", docs, many, True, "over GitHub")
    check("exactly 300 unmatched files", docs, many[:300], False)

    real = {
        name: pull_request_filters(WORKFLOWS / name)
        for name in (
            "docs-pages.yml",
            "product-packages.yml",
            "bilibili-note-mcp.yml",
            "security-audit.yml",
            "codeql-analysis.yml",
        )
    }
    if real["codeql-analysis.yml"] is not NOT_ON_PULL_REQUESTS:
        sys.exit("FAIL codeql-analysis.yml should read as having no pull_request trigger")
    print("ok a workflow with no pull_request trigger is never required")
    pr1100 = [
        "Cargo.toml",
        "Cargo.lock",
        "crates/postgres_connect/Cargo.toml",
        "crates/postgres_connect/src/lib.rs",
        "crates/data/Cargo.toml",
        "clippy.toml",
    ]
    dashboard = ["product/dashboard/lib/research-goal-operation.ts"]
    plain = ["crates/data/src/owner/postgres.rs"]
    expect = {
        "docs-pages.yml": (True, False, False),
        "product-packages.yml": (False, True, False),
        "bilibili-note-mcp.yml": (False, False, False),
        "security-audit.yml": (True, False, False),
    }
    for name, (on1100, on_dash, on_plain) in expect.items():
        check(f"{name} on #1100's diff", real[name], pr1100, on1100)
        check(f"{name} on a Dashboard edit", real[name], dashboard, on_dash)
        check(f"{name} on a plain crate edit", real[name], plain, on_plain)
    service_lock = ["services/bilibili-note-mcp/uv.lock"]
    check(
        "security-audit.yml on a service lockfile",
        real["security-audit.yml"],
        service_lock,
        True,
    )
    check(
        "bilibili-note-mcp.yml on its own lockfile",
        real["bilibili-note-mcp.yml"],
        service_lock,
        True,
    )
    print(
        "ok: path-filtered workflows are required exactly when their own paths say they run, and on any doubt",
    )


if __name__ == "__main__":
    main()
