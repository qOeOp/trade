from __future__ import annotations

import ast
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FORBIDDEN_ROOTS = {"crates", "examples", "legacy", "trade", "vibe_trader"}
FORBIDDEN_INTERNAL_DEPENDENCIES = {
    "domain": {"adapters", "application", "mcp_server", "presentation"},
    "application": {"adapters", "mcp_server", "presentation"},
    "presentation": {"adapters", "application", "mcp_server"},
}


def test_service_imports_do_not_depend_on_trade_or_legacy() -> None:
    violations: list[str] = []
    for path in sorted((ROOT / "src").rglob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            names: list[str] = []
            if isinstance(node, ast.Import):
                names = [item.name for item in node.names]
            elif isinstance(node, ast.ImportFrom) and node.module is not None:
                names = [node.module]
            for name in names:
                if name.split(".", 1)[0] in FORBIDDEN_ROOTS:
                    violations.append(f"{path.relative_to(ROOT)}:{node.lineno}:{name}")
    assert violations == []


def test_standalone_protocol_and_docs_have_no_repository_namespace_or_secret_path() -> None:
    paths = [
        *ROOT.joinpath("src").rglob("*.py"),
        *ROOT.joinpath("scripts").rglob("*.py"),
        *ROOT.joinpath("schemas").glob("*.json"),
        ROOT / "README.md",
        ROOT / "bilibili-note.md",
    ]
    violations = [
        str(path.relative_to(ROOT))
        for path in paths
        if any(
            forbidden in path.read_text(encoding="utf-8")
            for forbidden in ("trade.", "trade/", "legacy/.secrets")
        )
    ]
    assert violations == []


def test_internal_dependency_direction_is_acyclic() -> None:
    violations: list[str] = []
    package = ROOT / "src" / "bilibili_note_mcp"
    for layer, forbidden in FORBIDDEN_INTERNAL_DEPENDENCIES.items():
        for path in sorted((package / layer).rglob("*.py")):
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
            for node in ast.walk(tree):
                if not isinstance(node, ast.ImportFrom) or node.module is None:
                    continue
                parts = node.module.split(".")
                if parts[0] != "bilibili_note_mcp" or len(parts) < 2:
                    continue
                if parts[1] in forbidden:
                    violations.append(f"{path.relative_to(ROOT)}:{node.lineno}:{node.module}")
    assert violations == []


def test_generated_public_schemas_have_no_drift() -> None:
    result = subprocess.run(
        [sys.executable, "scripts/export_schemas.py", "--check"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        timeout=10,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    expected_names = (
        "result-v3.schema.json",
        "search-result-v1.schema.json",
        "error-v1.schema.json",
        "tool-output-v3.schema.json",
        "search-tool-output-v1.schema.json",
        "create-input-v1.schema.json",
        "search-input-v1.schema.json",
    )
    assert {path.name for path in (ROOT / "schemas").glob("*.json")} == set(expected_names)
    for name in expected_names:
        schema = json.loads((ROOT / "schemas" / name).read_text(encoding="utf-8"))
        if "oneOf" in schema:
            expected_success = (
                "bilibili-note.search-result/v1"
                if name == "search-tool-output-v1.schema.json"
                else "bilibili-note.result/v3"
            )
            assert [branch["properties"]["schema"]["const"] for branch in schema["oneOf"]] == [
                expected_success,
                "bilibili-note.error/v1",
            ]
        elif name == "error-v1.schema.json":
            assert "maturity" in schema["required"]


def test_wire_authority_constants_are_required_not_default_injected() -> None:
    error = json.loads((ROOT / "schemas" / "error-v1.schema.json").read_text(encoding="utf-8"))

    assert {"schema", "maturity"} <= set(error["required"])
    public = json.loads((ROOT / "schemas" / "result-v3.schema.json").read_text(encoding="utf-8"))
    assert public["required"] == ["schema", "rendered_markdown"]
    assert set(public["properties"]) == {"schema", "rendered_markdown"}
