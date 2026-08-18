from __future__ import annotations

import asyncio


async def finish_owned_task[T](task: asyncio.Task[T]) -> T:
    """Wait for caller-owned cleanup, even if its parent is cancelled again.

    The cleanup coordinator itself is shielded from parent cancellation.  A
    cancellation already pending on the parent, or received while it waits, is
    re-raised only after the coordinator reaches a terminal state.
    """
    current = asyncio.current_task()
    parent_cancellation: asyncio.CancelledError | None = (
        asyncio.CancelledError() if current is not None and current.cancelling() else None
    )
    while not task.done():
        try:
            await asyncio.shield(task)
        except asyncio.CancelledError as e:
            if task.done() and (current is None or current.cancelling() == 0):
                return task.result()
            parent_cancellation = parent_cancellation or e
        except BaseException:
            if task.done():
                break
            raise

    try:
        result = task.result()
    except BaseException as e:
        if parent_cancellation is not None:
            raise parent_cancellation from e
        raise
    if parent_cancellation is not None:
        raise parent_cancellation
    return result
