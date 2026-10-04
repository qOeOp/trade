from __future__ import annotations

import asyncio
import json
from dataclasses import asdict
from typing import Any

import rfc8785
from mcp import types
from mcp.server import Server, ServerRequestContext
from pydantic import ValidationError

from video_note_mcp.application.create_note import CreateBilibiliNote
from video_note_mcp.application.errors import BilibiliNoteFailure
from video_note_mcp.application.operator_events import operator_run
from video_note_mcp.application.owned_tasks import finish_owned_task
from video_note_mcp.application.progress import (
    ProgressUpdateV1,
)
from video_note_mcp.domain.artifacts import TranscriptResult, TranscriptSegment
from video_note_mcp.domain.models import (
    CreateNoteInputV1,
    ErrorV1,
    FailureCode,
    PublicBilibiliNoteResultV4,
    StrictModel,
)
from video_note_mcp.domain.primitive_inputs import (
    DownloadInput,
    FramesInput,
    ImportInput,
    RenderInput,
    TranscribeInput,
)
from video_note_mcp.domain.primitive_results import ArtifactResultV1
from video_note_mcp.presentation.schemas import tool_output_schema

TOOL_NAME = "video_note.create"
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


def _error(
    code: FailureCode, reason: str, recovery: dict[str, str] | None = None
) -> types.CallToolResult:
    failure = ErrorV1(
        schema="bilibili-note.error/v1",
        maturity="current_poc",
        code=code,
        reason=reason,
    )
    structured = failure.model_dump(mode="json", by_alias=True, exclude_defaults=True)
    if recovery:
        structured["recovery"] = recovery
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


_PRIMITIVES: dict[str, tuple[type[StrictModel], str]] = {
    "video_note.download": (
        DownloadInput,
        "Download verified media from url, or read existing media_id without downloading; returns "
        "media_id for reuse.",
    ),
    "video_note.import": (
        ImportInput,
        "Import a media filename from host-configured BILIBILI_NOTE_IMPORT_DIR, or "
        "complete timestamped transcript segments bound to a media_id. Imported "
        "provenance is explicit. No arbitrary paths.",
    ),
    "video_note.transcribe": (
        TranscribeInput,
        "Transcribe retained media_id at selected quality; returns transcript_id and "
        "complete timestamped speech.",
    ),
    "video_note.frames": (
        FramesInput,
        "Extract frames from transcript_id, or read evidence_id without extracting again; returns "
        "complete transcript and local frame paths for authoring.",
    ),
    "video_note.render": (
        RenderInput,
        "Validate structured note against evidence_id and publish illustrated "
        "HTML/Markdown. Reference E001 etc and frame IDs from frames. No model call; "
        "no arbitrary HTML.",
    ),
}


def build_server(use_case: CreateBilibiliNote) -> Server:
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
                        "notes "
                        "with content-derived chapters, source/timestamp links and relevant "
                        "real screenshots. "
                        "Returns persistent local Markdown and HTML paths. Images are on the "
                        "MCP server filesystem; "
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
            ]
            + [
                types.Tool(
                    name=name,
                    description=description,
                    input_schema=model.model_json_schema(by_alias=True),
                    output_schema=tool_output_schema(
                        PublicBilibiliNoteResultV4
                        if name == "video_note.render"
                        else ArtifactResultV1
                    ),
                    annotations=types.ToolAnnotations(
                        read_only_hint=False,
                        destructive_hint=False,
                        idempotent_hint=False,
                        open_world_hint=name
                        in {"video_note.download", "video_note.transcribe", "video_note.import"},
                    ),
                )
                for name, (model, description) in _PRIMITIVES.items()
            ]
        )

    def media_result(identity: str) -> dict[str, Any]:
        source = use_case.artifacts.load_media(identity)
        return {
            "media_id": identity,
            "media_path": str(source.media_path),
            "source": source.source.model_dump(mode="json"),
        }

    def transcript_result(identity: str) -> dict[str, Any]:
        source, quality = use_case.artifacts.load_transcript(identity)
        return {
            "transcript_id": identity,
            "source": source.source.model_dump(mode="json"),
            "quality": quality,
            "transcript": asdict(source.transcript),
            "reviews": [asdict(r) for r in source.reviews],
        }

    async def _call_tool_result(
        context: ServerRequestContext[None], request: Any
    ) -> types.CallToolResult:
        progress = _McpProgressReporter(context)
        try:
            retained: dict[str, Any] | None = None
            if isinstance(request, DownloadInput):
                if request.media_id is not None:
                    identity = request.media_id
                else:
                    assert request.url is not None
                    identity = await use_case.download(request.url, progress)
                retained = media_result(identity)
            elif isinstance(request, ImportInput):
                if request.kind == "media":
                    assert request.filename is not None and request.title is not None
                    retained = media_result(
                        await use_case.import_media(request.filename, request.title)
                    )
                else:
                    assert request.media_id is not None and request.segments is not None
                    imported = TranscriptResult(
                        "imported",
                        "caller",
                        request.language,
                        tuple(
                            TranscriptSegment(f"E{i:03d}", s.start_ms, s.end_ms, s.text)
                            for i, s in enumerate(request.segments, 1)
                        ),
                    )
                    identity = await use_case.transcribe(
                        request.media_id, progress, quality=request.quality, imported=imported
                    )
                    retained = transcript_result(identity)
            elif isinstance(request, TranscribeInput):
                retained = transcript_result(
                    await use_case.transcribe(request.media_id, progress, quality=request.quality)
                )
            elif isinstance(request, FramesInput):
                if request.evidence_id is not None:
                    identity = request.evidence_id
                else:
                    assert request.transcript_id is not None
                    identity = await use_case.frames(request.transcript_id, progress)
                source, quality, frames = use_case.artifacts.load_frames(identity)
                paths = use_case.artifacts.frame_paths(identity)
                retained = {
                    "source": source.source.model_dump(mode="json"),
                    "quality": quality,
                    "transcript": asdict(source.transcript),
                    "reviews": [asdict(r) for r in source.reviews],
                    "evidence_id": identity,
                    "frames": [
                        {**{k: v for k, v in asdict(f).items() if k != "png_bytes"}, "path": path}
                        for f, path in zip(frames, paths, strict=True)
                    ],
                }
            elif isinstance(request, RenderInput):
                payload = use_case.render(request.evidence_id, request.note)
            else:
                payload = await use_case.execute(request.url, progress, quality=request.quality)
            if retained is not None:
                retained["schema"] = "video-note.artifact-result/v1"
                retained = ArtifactResultV1.model_validate_json(json.dumps(retained)).model_dump(
                    mode="json", by_alias=True
                )
                return types.CallToolResult(
                    is_error=False,
                    content=[
                        types.TextContent(
                            type="text",
                            text=json.dumps(retained, ensure_ascii=False),
                            annotations=_USER_ANNOTATIONS,
                        )
                    ],
                    structured_content=retained,
                )
            result = PublicBilibiliNoteResultV4(
                schema="bilibili-note.result/v4",
                rendered_markdown=payload.rendered_markdown,
                note_path=payload.note_path,
                html_path=payload.html_path,
                images=payload.images,
            )
        except asyncio.CancelledError:
            return _error("CANCELLED", "request_cancelled")
        except BilibiliNoteFailure as e:
            recovery = {
                key: getattr(request, key)
                for key in ("media_id", "transcript_id", "evidence_id")
                if getattr(request, key, None)
            }
            return _error(e.code, e.reason, {**recovery, **e.recovery})
        except Exception:
            recovery = {
                key: getattr(request, key)
                for key in ("media_id", "transcript_id", "evidence_id")
                if getattr(request, key, None)
            }
            return _error("INTERNAL", "unexpected_internal_failure", recovery)
        # Publication committed: return its receipt without another cancellation point.
        return types.CallToolResult(
            is_error=False,
            content=[
                types.TextContent(
                    type="text", text=result.rendered_markdown, annotations=_USER_ANNOTATIONS
                )
            ],
            structured_content=result.model_dump(mode="json", by_alias=True),
        )

    async def call_tool(
        context: ServerRequestContext[None], params: types.CallToolRequestParams
    ) -> types.CallToolResult:
        name = {"bilibili_note.create": TOOL_NAME}.get(params.name, params.name)
        if name not in {TOOL_NAME, *_PRIMITIVES}:
            return _error("OUTPUT_INVALID", "tool_name_invalid")
        try:
            model = CreateNoteInputV1 if name == TOOL_NAME else _PRIMITIVES[name][0]
            admitted = model.model_validate_json(json.dumps(params.arguments or {}))
        except ValidationError:
            return _error("INVALID_URL", "tool_arguments_invalid")
        request_identity = {
            "tool": params.name,
            "arguments": admitted.model_dump(mode="json", by_alias=True),
        }
        with operator_run(request_identity) as run:
            run.emit("request_started", tool=params.name)
            request = asyncio.create_task(_call_tool_result(context, admitted))
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

    return Server("video-note-mcp", on_list_tools=list_tools, on_call_tool=call_tool)
