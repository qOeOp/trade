"""B1 with the exit-v1 X4 exit: the B1 entries and stops unchanged, no target, time limit 30 4h bars."""
import os, sys

from harness import Signal

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from portfolio import b1_signals  # noqa: E402

FAR = 1e12


def signals(bars):
    return [Signal(s.time, s.side, s.stop, s.side * FAR, 30) for s in b1_signals(bars)]
