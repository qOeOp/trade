from __future__ import annotations

import json
import math
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from importlib.metadata import version
from typing import BinaryIO, Protocol, TextIO, cast

import mcp.server.stdio as mcp_stdio
import mcp_types
from mcp_types import JSONRPCMessage
from pydantic import TypeAdapter

MAX_STDIO_FRAME_BYTES = 1_048_576
MAX_JSON_DEPTH = 32
_MIN_INTEGER = -(2**63)
_MAX_INTEGER = 2**63 - 1
_ADAPTER_LOCK = threading.Lock()
_EXPECTED_MCP_VERSION = "2.0.0"
_REJECTED_RAW_FRAME = '"invalid raw stdio frame"\n'


class StdioFrameRejected(ValueError):
    """The raw stdio frame is outside the service's admitted JSON subset."""


class _AdapterOwner(Protocol):
    jsonrpc_message_adapter: object


class _StdioModule(Protocol):
    _UnownedTextWrapper: object


class _TextWrapperFactory(Protocol):
    def __call__(
        self,
        buffer: BinaryIO,
        encoding: str | None = None,
        errors: str | None = None,
        newline: str | None = None,
        line_buffering: bool = False,
        write_through: bool = False,
    ) -> TextIO: ...


class _StrictUtf8LineReader:
    """Bounded line reader that rejects, rather than repairs, invalid UTF-8."""

    def __init__(self, buffer: BinaryIO) -> None:
        self._buffer = buffer

    def readable(self) -> bool:
        return True

    def fileno(self) -> int:
        return self._buffer.fileno()

    def readline(self, size: int = -1, /) -> str:
        # The MCP SDK calls readline() without a size. Keep the implementation
        # bounded anyway so a peer cannot make us accumulate an unterminated
        # frame before the JSON admission limit is applied.
        limit = MAX_STDIO_FRAME_BYTES + 1
        if size >= 0:
            limit = min(limit, size)
        raw = self._buffer.readline(limit)
        if not raw:
            return ""
        over_limit = len(raw) > MAX_STDIO_FRAME_BYTES
        if over_limit and not raw.endswith(b"\n"):
            self._discard_current_line()
        if over_limit:
            return _REJECTED_RAW_FRAME
        try:
            return raw.decode("utf-8", errors="strict")
        except UnicodeDecodeError:
            return _REJECTED_RAW_FRAME

    def _discard_current_line(self) -> None:
        while True:
            chunk = self._buffer.readline(MAX_STDIO_FRAME_BYTES + 1)
            if not chunk or chunk.endswith(b"\n"):
                return

    def close(self) -> None:
        # The SDK owns only the fd claim, not the duplicated binary stream.
        # Match its _UnownedTextWrapper close contract.
        pass


_stdio_module = cast(_StdioModule, mcp_stdio)
_ORIGINAL_UNOWNED_TEXT_WRAPPER = _stdio_module._UnownedTextWrapper


def _strict_transport_text_wrapper(
    buffer: BinaryIO,
    encoding: str | None = None,
    errors: str | None = None,
    newline: str | None = None,
    line_buffering: bool = False,
    write_through: bool = False,
) -> TextIO:
    """Replace only the SDK's lossy stdin wrapper; retain its stdout wrapper."""
    if encoding == "utf-8" and errors == "replace":
        return cast(TextIO, _StrictUtf8LineReader(buffer))
    original = cast(_TextWrapperFactory, _ORIGINAL_UNOWNED_TEXT_WRAPPER)
    return original(
        buffer,
        encoding=encoding,
        errors=errors,
        newline=newline,
        line_buffering=line_buffering,
        write_through=write_through,
    )


def _reject_constant(value: str) -> float:
    raise StdioFrameRejected(f"non-finite JSON number is not admitted: {value}")


def _parse_integer(value: str) -> int:
    digits = value.removeprefix("-")
    if len(digits) > 19:
        raise StdioFrameRejected("JSON integer is outside the signed 64-bit range")
    parsed = int(value)
    if parsed < _MIN_INTEGER or parsed > _MAX_INTEGER:
        raise StdioFrameRejected("JSON integer is outside the signed 64-bit range")
    return parsed


def _parse_float(value: str) -> float:
    parsed = float(value)
    if not math.isfinite(parsed):
        raise StdioFrameRejected("non-finite or overflowing JSON number is not admitted")
    return parsed


def _unique_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise StdioFrameRejected("duplicate decoded JSON object key")
        result[key] = value
    return result


def _assert_bounded_depth(root: dict[str, object]) -> None:
    stack: list[tuple[object, int]] = [(root, 1)]
    while stack:
        value, depth = stack.pop()
        if depth > MAX_JSON_DEPTH:
            raise StdioFrameRejected("JSON frame nesting is too deep")
        if isinstance(value, dict):
            stack.extend((child, depth + 1) for child in value.values())
        elif isinstance(value, list):
            stack.extend((child, depth + 1) for child in value)


def decode_strict_jsonrpc_frame(frame: str | bytes | bytearray) -> dict[str, object]:
    """Decode one bounded JSON object without lossy duplicate-key semantics."""
    if isinstance(frame, str):
        try:
            frame_size = len(frame.encode("utf-8"))
        except UnicodeEncodeError as e:
            raise StdioFrameRejected("JSON frame contains an invalid Unicode scalar") from e
    else:
        frame_size = len(frame)
    if frame_size > MAX_STDIO_FRAME_BYTES:
        raise StdioFrameRejected("JSON frame exceeds the stdio byte limit")
    try:
        decoded = json.loads(
            frame,
            object_pairs_hook=_unique_object,
            parse_constant=_reject_constant,
            parse_float=_parse_float,
            parse_int=_parse_integer,
        )
    except StdioFrameRejected:
        raise
    except (json.JSONDecodeError, RecursionError, UnicodeDecodeError) as e:
        raise StdioFrameRejected("invalid JSON frame") from e
    if not isinstance(decoded, dict):
        raise StdioFrameRejected("the JSON-RPC frame must be an object")
    _assert_bounded_depth(decoded)
    return decoded


class _StrictJsonRpcAdapter:
    def __init__(self, delegate: TypeAdapter[JSONRPCMessage]) -> None:
        self._delegate = delegate

    def validate_json(
        self,
        data: str | bytes | bytearray,
        *,
        by_name: bool | None = None,
    ) -> JSONRPCMessage:
        # Pydantic validates the already-decoded object. There is no second JSON
        # decoder whose duplicate-key or number semantics could disagree.
        decoded = decode_strict_jsonrpc_frame(data)
        return self._delegate.validate_python(decoded, by_name=by_name)


@contextmanager
def strict_mcp_stdio_admission() -> Iterator[None]:
    """Install strict raw-frame admission for the lifetime of one SDK stdio server."""
    if not _ADAPTER_LOCK.acquire(blocking=False):
        raise RuntimeError("strict MCP stdio admission is already active")
    adapter_owner = cast(_AdapterOwner, mcp_types)
    original = cast(
        TypeAdapter[JSONRPCMessage],
        adapter_owner.jsonrpc_message_adapter,
    )
    strict = _StrictJsonRpcAdapter(original)
    if version("mcp") != _EXPECTED_MCP_VERSION:
        _ADAPTER_LOCK.release()
        raise RuntimeError(f"strict stdio transport requires mcp=={_EXPECTED_MCP_VERSION}")
    if _stdio_module._UnownedTextWrapper is not _ORIGINAL_UNOWNED_TEXT_WRAPPER:
        _ADAPTER_LOCK.release()
        raise RuntimeError("the MCP stdio text wrapper has an unexpected identity")
    adapter_owner.jsonrpc_message_adapter = strict
    _stdio_module._UnownedTextWrapper = _strict_transport_text_wrapper
    try:
        yield
    finally:
        try:
            if adapter_owner.jsonrpc_message_adapter is not strict:
                raise RuntimeError("the strict JSON-RPC adapter identity changed while active")
            if _stdio_module._UnownedTextWrapper is not _strict_transport_text_wrapper:
                raise RuntimeError("the strict MCP stdio wrapper identity changed while active")
            adapter_owner.jsonrpc_message_adapter = original
            _stdio_module._UnownedTextWrapper = _ORIGINAL_UNOWNED_TEXT_WRAPPER
        finally:
            _ADAPTER_LOCK.release()
