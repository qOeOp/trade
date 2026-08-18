from __future__ import annotations

import asyncio

import pytest

from bilibili_note_mcp.application.owned_tasks import finish_owned_task


async def test_repeated_parent_cancellation_waits_for_owned_cleanup_terminal() -> None:
    cleanup_started = asyncio.Event()
    allow_cleanup = asyncio.Event()
    cleanup_terminal = asyncio.Event()

    async def cleanup() -> None:
        cleanup_started.set()
        try:
            await allow_cleanup.wait()
        finally:
            cleanup_terminal.set()

    async def owner() -> None:
        coordinator = asyncio.create_task(cleanup())
        await finish_owned_task(coordinator)

    task = asyncio.create_task(owner())
    await cleanup_started.wait()
    task.cancel("first")
    await asyncio.sleep(0)
    task.cancel("second")
    await asyncio.sleep(0)
    assert not task.done()
    assert not cleanup_terminal.is_set()

    allow_cleanup.set()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert cleanup_terminal.is_set()


async def test_owned_cleanup_cancellation_is_not_misclassified_as_parent_cancellation() -> None:
    coordinator = asyncio.create_task(asyncio.Event().wait())
    coordinator.cancel("cleanup")

    with pytest.raises(asyncio.CancelledError, match="cleanup"):
        await finish_owned_task(coordinator)


async def test_cleanup_failure_is_parent_cancellation_cause() -> None:
    cleanup_started = asyncio.Event()
    allow_failure = asyncio.Event()

    async def cleanup() -> None:
        cleanup_started.set()
        await allow_failure.wait()
        raise RuntimeError("cleanup failed")

    async def owner() -> None:
        await finish_owned_task(asyncio.create_task(cleanup()))

    task = asyncio.create_task(owner())
    await cleanup_started.wait()
    task.cancel("parent")
    allow_failure.set()
    with pytest.raises(asyncio.CancelledError) as failure:
        await task

    assert isinstance(failure.value.__cause__, RuntimeError)
    assert str(failure.value.__cause__) == "cleanup failed"
