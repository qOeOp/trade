from __future__ import annotations

import asyncio
import json
import os
import sys
from io import BytesIO
from pathlib import Path

import mcp.server.stdio as mcp_stdio
import mcp_types
import pytest

from bilibili_note_mcp.fixture import FIXTURE_URL, generate_fixture
from bilibili_note_mcp.mcp_server import TOOL_NAME
from bilibili_note_mcp.stdio_admission import (
    MAX_JSON_DEPTH,
    MAX_STDIO_FRAME_BYTES,
    StdioFrameRejected,
    decode_strict_jsonrpc_frame,
    strict_mcp_stdio_admission,
)


@pytest.mark.parametrize(
    "frame",
    [
        '{"method":"ping","method":"tools/call"}',
        '{"method":"ping","\\u006dethod":"tools/call"}',
        '{"params":{"arguments":{"url":"first","\\u0075rl":"second"}}}',
        '{"params":[{"name":"first","name":"second"}]}',
        '{"value":NaN}',
        '{"value":Infinity}',
        '{"value":-Infinity}',
        '{"value":1e400}',
        '{"value":9223372036854775808}',
        '{"value":-9223372036854775809}',
        "[]",
        "null",
        "1",
    ],
)
def test_strict_jsonrpc_decoder_rejects_ambiguous_or_unbounded_frames(frame: str) -> None:
    with pytest.raises(StdioFrameRejected):
        decode_strict_jsonrpc_frame(frame)


def test_strict_jsonrpc_decoder_enforces_depth_and_byte_limits() -> None:
    nested: object = "leaf"
    for _ in range(MAX_JSON_DEPTH):
        nested = {"child": nested}
    too_deep = json.dumps(nested)
    too_large = json.dumps({"padding": "x" * MAX_STDIO_FRAME_BYTES})

    with pytest.raises(StdioFrameRejected, match="nesting"):
        decode_strict_jsonrpc_frame(too_deep)
    with pytest.raises(StdioFrameRejected, match="byte limit"):
        decode_strict_jsonrpc_frame(too_large)


def test_strict_jsonrpc_decoder_preserves_valid_json_values() -> None:
    frame = '{"jsonrpc":"2.0","id":7,"method":"ping","params":{"ratio":0.5}}'

    assert decode_strict_jsonrpc_frame(frame) == {
        "jsonrpc": "2.0",
        "id": 7,
        "method": "ping",
        "params": {"ratio": 0.5},
    }


def test_strict_jsonrpc_decoder_distinguishes_encoded_replacement_character() -> None:
    assert decode_strict_jsonrpc_frame(b'{"text":"\xef\xbf\xbd"}') == {"text": "�"}


def test_transport_wrapper_rejects_invalid_utf8_per_line_and_continues() -> None:
    original_wrapper = mcp_stdio._UnownedTextWrapper
    with strict_mcp_stdio_admission():
        wrapper = mcp_stdio._UnownedTextWrapper
        reader = wrapper(
            BytesIO(b'{"bad":"\xff"}\n{"valid":"\xef\xbf\xbd"}\n'),
            encoding="utf-8",
            errors="replace",
        )
        with pytest.raises(StdioFrameRejected):
            decode_strict_jsonrpc_frame(reader.readline())
        assert decode_strict_jsonrpc_frame(reader.readline()) == {"valid": "�"}
        assert reader.readline() == ""
    assert mcp_stdio._UnownedTextWrapper is original_wrapper


def test_strict_stdio_adapter_is_restored_across_cancellation() -> None:
    original = mcp_types.jsonrpc_message_adapter
    original_wrapper = mcp_stdio._UnownedTextWrapper
    with pytest.raises(asyncio.CancelledError):
        with strict_mcp_stdio_admission():
            assert mcp_types.jsonrpc_message_adapter is not original
            assert mcp_stdio._UnownedTextWrapper is not original_wrapper
            raise asyncio.CancelledError
    assert mcp_types.jsonrpc_message_adapter is original
    assert mcp_stdio._UnownedTextWrapper is original_wrapper

    with strict_mcp_stdio_admission():
        assert mcp_types.jsonrpc_message_adapter is not original
        with pytest.raises(RuntimeError, match="already active"):
            with strict_mcp_stdio_admission():
                pass
    assert mcp_types.jsonrpc_message_adapter is original
    assert mcp_stdio._UnownedTextWrapper is original_wrapper


async def _write_frame(process: asyncio.subprocess.Process, frame: str) -> None:
    assert process.stdin is not None
    process.stdin.write(frame.encode("utf-8") + b"\n")
    await process.stdin.drain()


async def _write_raw_chunks(
    process: asyncio.subprocess.Process,
    *chunks: bytes,
) -> None:
    assert process.stdin is not None
    for chunk in chunks:
        process.stdin.write(chunk)
        await process.stdin.drain()


async def _read_through_id(
    process: asyncio.subprocess.Process, request_id: int
) -> list[dict[str, object]]:
    assert process.stdout is not None
    messages: list[dict[str, object]] = []
    while True:
        line = await asyncio.wait_for(process.stdout.readline(), timeout=10)
        assert line, "MCP stdio server closed before the expected response"
        message = json.loads(line)
        assert isinstance(message, dict)
        messages.append(message)
        if message.get("id") == request_id:
            return messages


async def test_raw_stdio_rejections_never_reach_operator_progress_or_use_case(
    tmp_path: Path,
) -> None:
    fixture = generate_fixture(tmp_path / "fixture")
    operator_sink = tmp_path / "operator.jsonl"
    environment = os.environ.copy()
    environment["BILIBILI_NOTE_OPERATOR_EVENTS_PATH"] = str(operator_sink)
    process = await asyncio.create_subprocess_exec(
        sys.executable,
        "-m",
        "bilibili_note_mcp",
        "--fixture-root",
        str(fixture),
        "--deterministic",
        cwd=Path(__file__).parents[1],
        env=environment,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        await _write_frame(
            process,
            json.dumps(
                {
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "initialize",
                    "params": {
                        "protocolVersion": "2025-11-25",
                        "capabilities": {},
                        "clientInfo": {"name": "strict-stdio-test", "version": "1"},
                    },
                },
                separators=(",", ":"),
            ),
        )
        initialized = await _read_through_id(process, 1)
        assert initialized[-1].get("result") is not None
        await _write_frame(
            process,
            '{"jsonrpc":"2.0","method":"notifications/initialized"}',
        )

        escaped_url_key = "\\u0075rl"
        escaped_name_key = "\\u006eame"
        valid_arguments = json.dumps({"url": FIXTURE_URL}, separators=(",", ":"))[1:-1]
        malicious_frames = [
            (
                '{"jsonrpc":"2.0","id":10,"method":"ping",'
                f'"method":"tools/call","params":{{"name":"{TOOL_NAME}",'
                f'"arguments":{{{valid_arguments}}}}}}}'
            ),
            (
                '{"jsonrpc":"2.0","id":11,"method":"tools/call","params":{'
                f'"name":"invalid","{escaped_name_key}":"{TOOL_NAME}",'
                f'"arguments":{{{valid_arguments}}}}}}}'
            ),
            (
                '{"jsonrpc":"2.0","id":12,"method":"tools/call","params":{'
                f'"name":"{TOOL_NAME}","arguments":{{"url":"https://example.invalid",'
                f'"{escaped_url_key}":{json.dumps(FIXTURE_URL)}}}}}}}'
            ),
            (
                '{"jsonrpc":"2.0","id":13,"method":"tools/call","params":{'
                f'"name":"{TOOL_NAME}","arguments":{{{valid_arguments}}},'
                '"_meta":{"progressToken":NaN}}}'
            ),
            (
                '{"jsonrpc":"2.0","id":14,"method":"tools/call","params":{'
                f'"name":"{TOOL_NAME}","arguments":{{{valid_arguments}}},'
                '"_meta":{"progressToken":1e400}}}'
            ),
            "[]",
        ]
        nested: object = "leaf"
        for _ in range(MAX_JSON_DEPTH):
            nested = {"child": nested}
        malicious_frames.append(
            json.dumps(
                {
                    "jsonrpc": "2.0",
                    "id": 15,
                    "method": "tools/call",
                    "params": {
                        "name": TOOL_NAME,
                        "arguments": {"url": FIXTURE_URL},
                        "_meta": nested,
                    },
                },
                separators=(",", ":"),
            )
        )
        malicious_frames.append(
            json.dumps(
                {
                    "jsonrpc": "2.0",
                    "id": 16,
                    "method": "tools/call",
                    "params": {
                        "name": TOOL_NAME,
                        "arguments": {"url": FIXTURE_URL},
                        "_meta": {"padding": "x" * MAX_STDIO_FRAME_BYTES},
                    },
                },
                separators=(",", ":"),
            )
        )

        rejected_messages: list[dict[str, object]] = []
        for index, frame in enumerate(malicious_frames, start=20):
            await _write_frame(process, frame)
            await _write_frame(
                process,
                f'{{"jsonrpc":"2.0","id":{index},"method":"ping"}}',
            )
            rejected_messages.extend(await _read_through_id(process, index))
            assert not operator_sink.exists()

        effectful = json.dumps(
            {
                "jsonrpc": "2.0",
                "id": 200,
                "method": "tools/call",
                "params": {"name": TOOL_NAME, "arguments": {"url": FIXTURE_URL}},
            },
            separators=(",", ":"),
        ).encode("utf-8")
        raw_invalid_frames = [
            effectful.replace(b'{"jsonrpc"', b'{"\xffignored":0,"jsonrpc"', 1),
            effectful.replace(b'"tools/call"', b'"tools/\xffcall"', 1),
            effectful.replace(TOOL_NAME.encode(), TOOL_NAME.encode() + b"\xff", 1),
            effectful.replace(FIXTURE_URL.encode(), FIXTURE_URL.encode() + b"\xff", 1),
            effectful[:-1] + b',"irrelevant":"\xff"}',
        ]
        for index, frame in enumerate(raw_invalid_frames, start=40):
            split = frame.index(b"\xff")
            await _write_raw_chunks(
                process,
                frame[:split],
                frame[split : split + 1],
                frame[split + 1 :] + b"\n",
            )
            await _write_frame(
                process,
                f'{{"jsonrpc":"2.0","id":{index},"method":"ping"}}',
            )
            rejected_messages.extend(await _read_through_id(process, index))
            assert not operator_sink.exists()

        assert all(
            message.get("method") != "notifications/progress" for message in rejected_messages
        )

        await _write_raw_chunks(
            process,
            (
                '{"jsonrpc":"2.0","id":90,"method":"ping",'
                '"params":{"_meta":{"progressToken":"�"}}}\n'
            ).encode(),
        )
        replacement_character_messages = await _read_through_id(process, 90)
        assert replacement_character_messages[-1].get("result") == {}
        assert not operator_sink.exists()

        await _write_frame(
            process,
            json.dumps(
                {
                    "jsonrpc": "2.0",
                    "id": 100,
                    "method": "tools/call",
                    "params": {"name": TOOL_NAME, "arguments": {"url": FIXTURE_URL}},
                },
                separators=(",", ":"),
            ),
        )
        valid_messages = await _read_through_id(process, 100)
        terminal = valid_messages[-1]
        assert isinstance(terminal.get("result"), dict)
        assert operator_sink.exists()
        events = [json.loads(line) for line in operator_sink.read_text().splitlines()]
        assert [event["event"] for event in events if event["event"].startswith("request_")] == [
            "request_started",
            "request_completed",
        ]
    finally:
        if process.stdin is not None:
            process.stdin.close()
            await process.stdin.wait_closed()
        try:
            await asyncio.wait_for(process.wait(), timeout=10)
        except TimeoutError:
            process.terminate()
            await process.wait()
        if process.returncode not in {0, None}:
            assert process.stderr is not None
            stderr = (await process.stderr.read()).decode("utf-8", errors="replace")
            pytest.fail(f"MCP stdio process exited with {process.returncode}: {stderr}")
