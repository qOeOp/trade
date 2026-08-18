from __future__ import annotations

import argparse
import json
from pathlib import Path

from bilibili_note_mcp.domain.models import (
    CreateNoteInputV1,
    ErrorV1,
    PublicBilibiliNoteResultV3,
    PublicBilibiliSearchResultV1,
    SearchAndCreateInputV1,
)
from bilibili_note_mcp.presentation.schemas import search_tool_output_schema, tool_output_schema

ROOT = Path(__file__).resolve().parents[1]
SCHEMAS = {
    "create-input-v1.schema.json": CreateNoteInputV1.model_json_schema(by_alias=True),
    "search-input-v1.schema.json": SearchAndCreateInputV1.model_json_schema(by_alias=True),
    "error-v1.schema.json": ErrorV1.model_json_schema(by_alias=True),
    "result-v3.schema.json": PublicBilibiliNoteResultV3.model_json_schema(by_alias=True),
    "search-result-v1.schema.json": PublicBilibiliSearchResultV1.model_json_schema(by_alias=True),
    "search-tool-output-v1.schema.json": search_tool_output_schema(),
    "tool-output-v3.schema.json": tool_output_schema(),
}


def _render(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    target = ROOT / "schemas"
    if args.check:
        stale = [
            name
            for name, value in SCHEMAS.items()
            if not (target / name).is_file()
            or (target / name).read_text(encoding="utf-8") != _render(value)
        ]
        if stale:
            parser.error("generated schema drift: " + ", ".join(stale))
        return 0
    target.mkdir(exist_ok=True)
    for name, value in SCHEMAS.items():
        (target / name).write_text(_render(value), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
