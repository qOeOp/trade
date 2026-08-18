from __future__ import annotations

import asyncio
from typing import Any

import rfc8785
from mcp import types
from mcp.server import Server, ServerRequestContext
from pydantic import ValidationError

from bilibili_note_mcp.application.create_note import CreateBilibiliNote
from bilibili_note_mcp.application.errors import BilibiliNoteFailure
from bilibili_note_mcp.application.operator_events import operator_run
from bilibili_note_mcp.application.owned_tasks import finish_owned_task
from bilibili_note_mcp.application.progress import (
    ProgressReporter,
    ProgressUpdateV1,
)
from bilibili_note_mcp.application.search_notes import SearchAndCreateBilibiliNotes
from bilibili_note_mcp.domain.models import (
    CreateNoteInputV1,
    ErrorV1,
    FailureCode,
    PublicBilibiliNoteResultV3,
    PublicBilibiliSearchResultV1,
    SearchAndCreateInputV1,
)
from bilibili_note_mcp.presentation.schemas import search_tool_output_schema, tool_output_schema

TOOL_NAME = "bilibili_note.create"
SEARCH_TOOL_NAME = "bilibili_note.search_and_create"
_USER_ANNOTATIONS = types.Annotations(audience=["user"])


async def _terminal_cancellation_checkpoint() -> None:
    """Yield after final validation and before constructing a terminal success."""
    await asyncio.sleep(0)


class _McpProgressReporter:
    def __init__(self, context: ServerRequestContext[None]) -> None:
        self._context = context

    async def report(self, update: ProgressUpdateV1) -> None:
        try:
            await self._context.session.report_progress(
                update.progress, update.total, update.message
            )
        except Exception:
            return


def _progress_reporter(context: ServerRequestContext[None]) -> ProgressReporter:
    return _McpProgressReporter(context)


def _error(code: FailureCode, reason: str) -> types.CallToolResult:
    failure = ErrorV1(
        schema="bilibili-note.error/v1",
        maturity="current_poc",
        code=code,
        reason=reason,
    )
    structured = failure.model_dump(mode="json", by_alias=True)
    return types.CallToolResult(
        is_error=True,
        content=[
            types.TextContent(
                type="text",
                text=rfc8785.dumps(structured).decode("utf-8"),
                annotations=_USER_ANNOTATIONS,
            )
        ],
        structured_content=structured,
    )


def build_server(
    use_case: CreateBilibiliNote,
    search_use_case: SearchAndCreateBilibiliNotes,
) -> Server:
    async def list_tools(
        _context: ServerRequestContext[None],
        _params: types.PaginatedRequestParams | None,
    ) -> types.ListToolsResult:
        return types.ListToolsResult(
            tools=[
                types.Tool(
                    name=TOOL_NAME,
                    title="Create Bilibili research brief",
                    description=(
                        "CURRENT_POC: convert one direct Bilibili video URL into a concise Chinese "
                        "trading thought and strategy summary with exactly three sections: core "
                        "strategy, methods, and risk management. Speech is aligned with transient "
                        "internal visual analysis; no image is returned or persisted. Output is a "
                        "research source, never "
                        "trading evidence or authorization."
                    ),
                    input_schema=CreateNoteInputV1.model_json_schema(by_alias=True),
                    output_schema=tool_output_schema(),
                    annotations=types.ToolAnnotations(
                        read_only_hint=False,
                        destructive_hint=False,
                        idempotent_hint=False,
                        open_world_hint=True,
                    ),
                ),
                types.Tool(
                    name=SEARCH_TOOL_NAME,
                    title="Search and create Bilibili research briefs",
                    description=(
                        "CURRENT_POC: search Bilibili from one natural-language research topic, "
                        "then convert bounded candidates through a rolling window of at most two "
                        "into "
                        "Chinese multimodal strategy summaries. Default 2 videos; hard maximum 3. "
                        "Returns "
                        "one deterministic aggregation with only core strategy, methods, and risk "
                        "management; candidate links and per-video failures stay internal. Output "
                        "is a research source, never trading evidence or authorization."
                    ),
                    input_schema=SearchAndCreateInputV1.model_json_schema(by_alias=True),
                    output_schema=search_tool_output_schema(),
                    annotations=types.ToolAnnotations(
                        read_only_hint=False,
                        destructive_hint=False,
                        idempotent_hint=False,
                        open_world_hint=True,
                    ),
                ),
            ]
        )

    async def _call_tool_result(
        context: ServerRequestContext[None], params: types.CallToolRequestParams
    ) -> types.CallToolResult:
        if params.name not in {TOOL_NAME, SEARCH_TOOL_NAME}:
            return _error("OUTPUT_INVALID", "tool_name_invalid")
        if params.name == SEARCH_TOOL_NAME:
            try:
                search_request = SearchAndCreateInputV1.model_validate(params.arguments or {})
            except ValidationError:
                return _error("OUTPUT_INVALID", "tool_arguments_invalid")
            progress = _progress_reporter(context)
            try:
                search_payload = await search_use_case.execute(
                    search_request.query, search_request.max_videos, progress
                )
                await _terminal_cancellation_checkpoint()
            except asyncio.CancelledError:
                return _error("CANCELLED", "request_cancelled")
            except BilibiliNoteFailure as e:
                return _error(e.code, e.reason)
            except Exception:
                return _error("INTERNAL", "unexpected_internal_failure")
            search_result = PublicBilibiliSearchResultV1(
                schema="bilibili-note.search-result/v1",
                rendered_markdown=search_payload.rendered_markdown,
            )
            search_structured: dict[str, Any] = search_result.model_dump(mode="json", by_alias=True)
            return types.CallToolResult(
                is_error=False,
                content=[
                    types.TextContent(
                        type="text",
                        text=search_result.rendered_markdown,
                        annotations=_USER_ANNOTATIONS,
                    )
                ],
                structured_content=search_structured,
            )
        try:
            create_request = CreateNoteInputV1.model_validate(params.arguments or {})
        except ValidationError:
            return _error("INVALID_URL", "tool_arguments_invalid")
        progress = _progress_reporter(context)
        try:
            create_payload = await use_case.execute(create_request.url, progress)
            await _terminal_cancellation_checkpoint()
        except asyncio.CancelledError:
            return _error("CANCELLED", "request_cancelled")
        except BilibiliNoteFailure as e:
            return _error(e.code, e.reason)
        except Exception:
            return _error("INTERNAL", "unexpected_internal_failure")
        create_result = PublicBilibiliNoteResultV3(
            schema="bilibili-note.result/v3",
            rendered_markdown=create_payload.rendered_markdown,
        )
        create_structured: dict[str, Any] = create_result.model_dump(mode="json", by_alias=True)
        return types.CallToolResult(
            is_error=False,
            content=[
                types.TextContent(
                    type="text",
                    text=create_result.rendered_markdown,
                    annotations=_USER_ANNOTATIONS,
                )
            ],
            structured_content=create_structured,
        )

    async def call_tool(
        context: ServerRequestContext[None], params: types.CallToolRequestParams
    ) -> types.CallToolResult:
        if params.name not in {TOOL_NAME, SEARCH_TOOL_NAME}:
            return _error("OUTPUT_INVALID", "tool_name_invalid")
        try:
            if params.name == SEARCH_TOOL_NAME:
                admitted_args = SearchAndCreateInputV1.model_validate(
                    params.arguments or {}
                ).model_dump(mode="json", by_alias=True)
            else:
                admitted_args = CreateNoteInputV1.model_validate(params.arguments or {}).model_dump(
                    mode="json", by_alias=True
                )
        except ValidationError:
            if params.name == SEARCH_TOOL_NAME:
                return _error("OUTPUT_INVALID", "tool_arguments_invalid")
            return _error("INVALID_URL", "tool_arguments_invalid")
        request_identity = {
            "tool": params.name,
            "arguments": admitted_args,
        }
        with operator_run(request_identity) as run:
            run.emit("request_started", tool=params.name)
            request = asyncio.create_task(_call_tool_result(context, params))
            try:
                result = await asyncio.shield(request)
            except asyncio.CancelledError:

                async def cleanup() -> None:
                    if not request.done() and request.cancelling() == 0:
                        request.cancel()
                    await asyncio.gather(request, return_exceptions=True)

                coordinator = asyncio.create_task(cleanup())
                try:
                    await finish_owned_task(coordinator)
                except asyncio.CancelledError:
                    # This is the outer protocol boundary: cleanup is terminal
                    # before pending or repeated cancellation is translated to
                    # one MCP result and one operator terminal event.
                    pass
                result = _error("CANCELLED", "request_cancelled")
            structured = result.structured_content
            if result.is_error and isinstance(structured, dict):
                code = structured.get("code")
                reason = structured.get("reason")
                if code == "CANCELLED":
                    run.emit("request_cancelled")
                elif isinstance(code, str) and isinstance(reason, str):
                    run.emit("request_failed", code=code, reason=reason)
                else:
                    run.emit(
                        "request_failed",
                        code="INTERNAL",
                        reason="operator_terminal_invalid",
                    )
            elif result.is_error:
                run.emit("request_failed", code="INTERNAL", reason="operator_terminal_invalid")
            else:
                run.emit("request_completed")
            return result

    return Server("bilibili-note-mcp", on_list_tools=list_tools, on_call_tool=call_tool)
