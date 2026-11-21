"""Paper and Live own SIGINT/SIGTERM so native node shutdown cannot bypass their own stop (Paper's checkpoint drain,
Live's interruption that keeps positions and their stops).

The module entry point blocks before importing Nautilus or starting any worker. Workers inherit
that mask; one Python thread consumes the signals synchronously, without invoking Tokio's
process handlers, and hands each to the runner's `request_stop`.
"""

from __future__ import annotations

import signal
import threading


SIGNALS = {signal.SIGINT, signal.SIGTERM}
WAKE = signal.SIGUSR1
BLOCKED = SIGNALS | {WAKE}


def block():
    return signal.pthread_sigmask(signal.SIG_BLOCK, BLOCKED)


class Signals:
    def __init__(self, request_stop):
        self.request_stop = request_stop
        self.finished = threading.Event()
        self.previous = None
        self.thread = threading.Thread(target=self.receive, name="runner-signals", daemon=True)

    def __enter__(self):
        self.previous = block()
        self.thread.start()
        return self

    def receive(self) -> None:
        # A private blocked wake signal makes sigwait portable to macOS, which has
        # no sigtimedwait. The receiver exits only after consuming that wake, even
        # if another SIGTERM arrives while close() is running.
        while True:
            received = signal.sigwait(BLOCKED)
            if received == WAKE:
                if self.finished.is_set():
                    return
            elif not self.finished.is_set():
                self.request_stop(signal.Signals(received).name)

    def __exit__(self, *_):
        self.finished.set()
        signal.pthread_kill(self.thread.ident, WAKE)  # to the receiver alone: another thread may not block WAKE
        self.thread.join()
        signal.pthread_sigmask(signal.SIG_SETMASK, self.previous)
