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
    PublicBilibiliNoteResultV4,
    PublicBilibiliSearchResultV2,
    SearchAndCreateInputV1,
)
from bilibili_note_mcp.presentation.schemas import search_tool_output_schema, tool_output_schema

TOOL_NAME = "video_note.create"
SEARCH_TOOL_NAME = "video_note.search_and_create"
_USER_ANNOTATIONS = types.Annotations(audience=["user"])


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
    youtube_search_use_case: SearchAndCreateBilibiliNotes | None = None,
) -> Server:
    async def list_tools(
        _context: ServerRequestContext[None],
        _params: types.PaginatedRequestParams | None,
    ) -> types.ListToolsResult:
        return types.ListToolsResult(
            tools=[
                types.Tool(
                    name=TOOL_NAME,
                    title="Create illustrated video notes",
                    description=(
                        "Convert a public Bilibili/YouTube video, or a public HTTPS "
                        "page/direct video link "
                        "into detailed Chinese "
                        "notes"
                        "with content-derived chapters, source/timestamp links and relevant "
                        "real screenshots."
                        "Returns persistent local Markdown and HTML paths. Images are on the "
                        "MCP server filesystem;"
                        "open the HTML preview if the client cannot render local Markdown "
                        "images. No subject-specific framework is imposed."
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
                    title="Search and create illustrated video notes",
                    description=(
                        "Search the selected platform (Bilibili or YouTube) by a topic or "
                        "creator name and produce a collection of "
                        "1–3 verified illustrated notes with separate source attribution and "
                        "content-derived chapters."
                        "At most two videos process concurrently; exact requested success count "
                        "is required."
                        "Returns local Markdown, HTML and screenshot paths on the server "
                        "filesystem."
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
        name = {
            "bilibili_note.create": TOOL_NAME,
            "bilibili_note.search_and_create": SEARCH_TOOL_NAME,
        }.get(params.name, params.name)
        if name not in {TOOL_NAME, SEARCH_TOOL_NAME}:
            return _error("OUTPUT_INVALID", "tool_name_invalid")
        if name == SEARCH_TOOL_NAME:
            try:
                search_request = SearchAndCreateInputV1.model_validate(params.arguments or {})
            except ValidationError:
                return _error("OUTPUT_INVALID", "tool_arguments_invalid")
            selected_search = (
                youtube_search_use_case if search_request.platform == "youtube" else search_use_case
            )
            if selected_search is None:
                return _error("SOURCE_UNAVAILABLE", "search_platform_not_configured")
            progress = _progress_reporter(context)
            try:
                search_payload = await selected_search.execute(
                    search_request.query,
                    search_request.max_videos,
                    progress,
                    quality=search_request.quality,
                )
                # Return the committed publication receipt.
            except asyncio.CancelledError:
                return _error("CANCELLED", "request_cancelled")
            except BilibiliNoteFailure as e:
                return _error(e.code, e.reason)
            except Exception:
                return _error("INTERNAL", "unexpected_internal_failure")
            search_result = PublicBilibiliSearchResultV2(
                schema="bilibili-note.search-result/v2",
                rendered_markdown=search_payload.rendered_markdown,
                note_path=search_payload.note_path,
                html_path=search_payload.html_path,
                images=search_payload.images,
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
            create_payload = await use_case.execute(
                create_request.url, progress, quality=create_request.quality
            )
            # Publication already committed; deliver its receipt without a new cancellation point.
        except asyncio.CancelledError:
            return _error("CANCELLED", "request_cancelled")
        except BilibiliNoteFailure as e:
            return _error(e.code, e.reason)
        except Exception:
            return _error("INTERNAL", "unexpected_internal_failure")
        create_result = PublicBilibiliNoteResultV4(
            schema="bilibili-note.result/v4",
            rendered_markdown=create_payload.rendered_markdown,
            note_path=create_payload.note_path,
            html_path=create_payload.html_path,
            images=create_payload.images,
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
        name = {
            "bilibili_note.create": TOOL_NAME,
            "bilibili_note.search_and_create": SEARCH_TOOL_NAME,
        }.get(params.name, params.name)
        if name not in {TOOL_NAME, SEARCH_TOOL_NAME}:
            return _error("OUTPUT_INVALID", "tool_name_invalid")
        try:
            if name == SEARCH_TOOL_NAME:
                admitted_args = SearchAndCreateInputV1.model_validate(
                    params.arguments or {}
                ).model_dump(mode="json", by_alias=True)
            else:
                admitted_args = CreateNoteInputV1.model_validate(params.arguments or {}).model_dump(
                    mode="json", by_alias=True
                )
        except ValidationError:
            if name == SEARCH_TOOL_NAME:
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
