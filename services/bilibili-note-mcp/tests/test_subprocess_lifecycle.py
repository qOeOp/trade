from __future__ import annotations

import asyncio
import os
import signal
import sys
from collections.abc import Awaitable
from pathlib import Path

import pytest

from bilibili_note_mcp.adapters import asr_siliconflow, bilibili_media_ytdlp, media_ffmpeg
from bilibili_note_mcp.adapters import subprocesses as subprocess_owner


def _blocking_command(ready: Path, late_write: Path) -> tuple[str, ...]:
    grandchild = (
        "import pathlib,signal,sys,time;"
        "signal.signal(signal.SIGTERM,signal.SIG_IGN);"
        "time.sleep(0.5);pathlib.Path(sys.argv[1]).write_text('late')"
    )
    parent = (
        "import os,pathlib,signal,subprocess,sys,time;"
        "signal.signal(signal.SIGTERM,signal.SIG_IGN);"
        "child=subprocess.Popen([sys.executable,'-c',sys.argv[3],sys.argv[2]]);"
        "pathlib.Path(sys.argv[1]).write_text(f'{os.getpid()} {child.pid}');"
        "time.sleep(10)"
    )
    return (sys.executable, "-c", parent, str(ready), str(late_write), grandchild)


async def _wait_for_file(path: Path) -> None:
    for _ in range(100):
        if await asyncio.to_thread(path.is_file):
            return
        await asyncio.sleep(0.01)
    raise AssertionError("subprocess did not start")


def _pid_exists(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    return True


async def _assert_group_reaped(ready: Path, late_write: Path) -> None:
    raw_pids = await asyncio.to_thread(ready.read_text)
    parent_pid, child_pid = (int(value) for value in raw_pids.split())
    await asyncio.sleep(0.55)
    assert not await asyncio.to_thread(late_write.exists)
    assert not _pid_exists(parent_pid)
    assert not _pid_exists(child_pid)


async def test_shared_subprocess_timeout_kills_group_before_return(tmp_path: Path) -> None:
    ready = tmp_path / "ready"
    late_write = tmp_path / "late"

    with pytest.raises(TimeoutError):
        await subprocess_owner.run_captured(
            *_blocking_command(ready, late_write),
            timeout_seconds=0.2,
            grace_seconds=0.05,
            stdout_limit_bytes=1024,
            stderr_limit_bytes=1024,
        )

    await _assert_group_reaped(ready, late_write)


async def test_shared_subprocess_stdout_cap_plus_one_reaps_group(tmp_path: Path) -> None:
    ready = tmp_path / "ready"
    late_write = tmp_path / "late"
    grandchild = (
        "import pathlib,signal,sys,time;"
        "signal.signal(signal.SIGTERM,signal.SIG_IGN);"
        "time.sleep(0.5);pathlib.Path(sys.argv[1]).write_text('late')"
    )
    parent = (
        "import os,pathlib,signal,subprocess,sys,time;"
        "signal.signal(signal.SIGTERM,signal.SIG_IGN);"
        "child=subprocess.Popen([sys.executable,'-c',sys.argv[3],sys.argv[2]]);"
        "pathlib.Path(sys.argv[1]).write_text(f'{os.getpid()} {child.pid}');"
        "os.write(1,b'x'*1024);time.sleep(10)"
    )

    with pytest.raises(subprocess_owner.ProcessOutputLimitExceeded) as failure:
        await subprocess_owner.run_captured(
            sys.executable,
            "-c",
            parent,
            str(ready),
            str(late_write),
            grandchild,
            timeout_seconds=10,
            grace_seconds=0.05,
            stdout_limit_bytes=16,
            stderr_limit_bytes=16,
        )

    assert failure.value.stream_name == "stdout"
    await _assert_group_reaped(ready, late_write)


async def test_successful_exited_leader_reaps_redirected_descendant_before_return(
    tmp_path: Path,
) -> None:
    ready = tmp_path / "ready"
    late_write = tmp_path / "late"
    grandchild = (
        "import os,pathlib,signal,sys,time;"
        "signal.signal(signal.SIGTERM,signal.SIG_IGN);"
        "pathlib.Path(sys.argv[1]).write_text(f'{os.getpid()} {os.getpgrp()}');"
        "time.sleep(0.5);pathlib.Path(sys.argv[2]).write_text('late')"
    )
    parent = (
        "import pathlib,subprocess,sys,time;"
        "subprocess.Popen([sys.executable,'-c',sys.argv[3],sys.argv[1],sys.argv[2]],"
        "stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,"
        "close_fds=True);"
        "ready=pathlib.Path(sys.argv[1]);"
        "[time.sleep(0.01) for _ in range(100) if not ready.exists()]"
    )

    await subprocess_owner.run_captured(
        sys.executable,
        "-c",
        parent,
        str(ready),
        str(late_write),
        grandchild,
        timeout_seconds=3,
        grace_seconds=0.05,
        stdout_limit_bytes=1024,
        stderr_limit_bytes=1024,
    )

    await _wait_for_file(ready)
    child_pid, _ = (int(value) for value in ready.read_text().split())
    await asyncio.sleep(0.55)
    assert not late_write.exists()
    assert not _pid_exists(child_pid)


@pytest.mark.parametrize("adapter", ("frame", "audio", "download_probe"))
async def test_each_media_adapter_cancellation_reaps_group_before_return(
    adapter: str,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    ready = tmp_path / "ready"
    late_write = tmp_path / "late"
    real_create = asyncio.create_subprocess_exec

    async def blocking_create(*command: str, **kwargs: object) -> asyncio.subprocess.Process:
        return await real_create(*_blocking_command(ready, late_write), **kwargs)

    monkeypatch.setattr(subprocess_owner.asyncio, "create_subprocess_exec", blocking_create)
    operation: Awaitable[object]
    if adapter == "frame":
        operation = media_ffmpeg._run("ffprobe", "ignored")
    elif adapter == "audio":
        operation = asr_siliconflow._extract_audio(
            tmp_path / "media.mp4",
            tmp_path / "audio.mp3",
            start_ms=0,
            duration_ms=1000,
        )
    else:
        operation = bilibili_media_ytdlp._probe(tmp_path / "media.mp4")
    task = asyncio.create_task(operation)
    await _wait_for_file(ready)

    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    await _assert_group_reaped(ready, late_write)


async def test_repeated_cancellation_reaps_group_before_owner_returns(tmp_path: Path) -> None:
    ready = tmp_path / "ready"
    late_write = tmp_path / "late"
    task = asyncio.create_task(
        subprocess_owner.run_captured(
            *_blocking_command(ready, late_write),
            timeout_seconds=10,
            grace_seconds=0.1,
            stdout_limit_bytes=1024,
            stderr_limit_bytes=1024,
        )
    )
    await _wait_for_file(ready)

    task.cancel("first")
    await asyncio.sleep(0.02)
    task.cancel("second")
    with pytest.raises(asyncio.CancelledError):
        await task

    await _assert_group_reaped(ready, late_write)


def test_cleanup_uses_distinct_process_group_signals() -> None:
    assert signal.SIGTERM != signal.SIGKILL
