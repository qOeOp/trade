from __future__ import annotations

import asyncio
import os
import signal
from dataclasses import dataclass

from bilibili_note_mcp.application.owned_tasks import finish_owned_task

_DEFAULT_TERMINATE_GRACE_SECONDS = 0.2


@dataclass(frozen=True, slots=True)
class CapturedProcess:
    returncode: int
    stdout: bytes
    stderr: bytes


class ProcessOutputLimitExceeded(Exception):
    def __init__(self, stream_name: str) -> None:
        super().__init__(f"{stream_name}_bytes_exceeded")
        self.stream_name = stream_name


async def terminate_process_group(
    process: asyncio.subprocess.Process,
    *,
    grace_seconds: float = _DEFAULT_TERMINATE_GRACE_SECONDS,
) -> None:
    def group_exists() -> bool:
        try:
            os.killpg(process.pid, 0)
        except ProcessLookupError:
            return False
        return True

    async def wait_for_group_exit() -> bool:
        deadline = asyncio.get_running_loop().time() + grace_seconds
        while group_exists():
            remaining = deadline - asyncio.get_running_loop().time()
            if remaining <= 0:
                return False
            await asyncio.sleep(min(0.01, remaining))
        return True

    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        await process.wait()
        return
    if await wait_for_group_exit():
        await process.wait()
        return
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    await process.wait()
    if not await wait_for_group_exit():
        raise RuntimeError("process_group_not_reaped")


async def cleanup_communicating_process(
    process: asyncio.subprocess.Process,
    communication: asyncio.Task[tuple[bytes, bytes]],
    *,
    grace_seconds: float = _DEFAULT_TERMINATE_GRACE_SECONDS,
) -> None:
    await terminate_process_group(process, grace_seconds=grace_seconds)
    if not communication.done() and communication.cancelling() == 0:
        communication.cancel()
    await asyncio.gather(communication, return_exceptions=True)


async def _read_bounded(
    stream: asyncio.StreamReader,
    *,
    limit_bytes: int,
    stream_name: str,
) -> bytes:
    if limit_bytes < 0:
        raise ValueError("process output limit is invalid")
    captured = bytearray()
    while True:
        remaining = limit_bytes + 1 - len(captured)
        chunk = await stream.read(min(64 * 1024, remaining))
        if not chunk:
            return bytes(captured)
        captured.extend(chunk)
        if len(captured) > limit_bytes:
            raise ProcessOutputLimitExceeded(stream_name)


async def _communicate_bounded(
    process: asyncio.subprocess.Process,
    input_bytes: bytes | None,
    *,
    stdout_limit_bytes: int,
    stderr_limit_bytes: int,
) -> tuple[bytes, bytes]:
    assert process.stdout is not None
    assert process.stderr is not None
    stdout_task = asyncio.create_task(
        _read_bounded(
            process.stdout,
            limit_bytes=stdout_limit_bytes,
            stream_name="stdout",
        )
    )
    stderr_task = asyncio.create_task(
        _read_bounded(
            process.stderr,
            limit_bytes=stderr_limit_bytes,
            stream_name="stderr",
        )
    )
    input_task: asyncio.Task[None] | None = None
    if input_bytes is not None:
        assert process.stdin is not None
        input_stream = process.stdin

        async def write_input() -> None:
            try:
                input_stream.write(input_bytes)
                await input_stream.drain()
            finally:
                input_stream.close()

        input_task = asyncio.create_task(write_input())
    wait_task = asyncio.create_task(process.wait())
    try:
        values = await asyncio.gather(
            stdout_task,
            stderr_task,
            wait_task,
            *((input_task,) if input_task is not None else ()),
        )
        stdout, stderr = values[:2]
        assert isinstance(stdout, bytes)
        assert isinstance(stderr, bytes)
        return stdout, stderr
    finally:
        tasks = tuple(
            task for task in (stdout_task, stderr_task, wait_task, input_task) if task is not None
        )
        for task in tasks:
            if not task.done() and task.cancelling() == 0:
                task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)


async def run_captured(
    *command: str,
    timeout_seconds: float,
    stdout_limit_bytes: int,
    stderr_limit_bytes: int,
    input_bytes: bytes | None = None,
    grace_seconds: float = _DEFAULT_TERMINATE_GRACE_SECONDS,
    env: dict[str, str] | None = None,
) -> CapturedProcess:
    process = await asyncio.create_subprocess_exec(
        *command,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        stdin=asyncio.subprocess.PIPE if input_bytes is not None else asyncio.subprocess.DEVNULL,
        start_new_session=True,
        env=env,
    )
    communication = asyncio.create_task(
        _communicate_bounded(
            process,
            input_bytes,
            stdout_limit_bytes=stdout_limit_bytes,
            stderr_limit_bytes=stderr_limit_bytes,
        )
    )
    try:
        stdout, stderr = await asyncio.wait_for(
            asyncio.shield(communication), timeout=timeout_seconds
        )
    finally:
        cleanup = asyncio.create_task(
            cleanup_communicating_process(
                process,
                communication,
                grace_seconds=grace_seconds,
            )
        )
        await finish_owned_task(cleanup)
    return CapturedProcess(process.returncode or 0, stdout, stderr)
