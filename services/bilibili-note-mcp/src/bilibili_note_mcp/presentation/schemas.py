from __future__ import annotations

from typing import Any

from bilibili_note_mcp.domain.models import (
    ErrorV1,
    PublicBilibiliNoteResultV3,
    PublicBilibiliSearchResultV1,
)


def tool_output_schema() -> dict[str, Any]:
    """Return the closed success/error union advertised by the MCP tool."""
    success = PublicBilibiliNoteResultV3.model_json_schema(by_alias=True)
    definitions = success.pop("$defs", {})
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "title": "BilibiliNoteToolOutputV2",
        "type": "object",
        "$defs": definitions,
        "oneOf": [
            success,
            ErrorV1.model_json_schema(by_alias=True),
        ],
    }


def search_tool_output_schema() -> dict[str, Any]:
    """Return the closed search-and-create success/error union."""
    success = PublicBilibiliSearchResultV1.model_json_schema(by_alias=True)
    definitions = success.pop("$defs", {})
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "title": "BilibiliNoteSearchToolOutputV1",
        "type": "object",
        "$defs": definitions,
        "oneOf": [
            success,
            ErrorV1.model_json_schema(by_alias=True),
        ],
    }
