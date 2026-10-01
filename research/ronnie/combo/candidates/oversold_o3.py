"""oversold-v1 O3, capitulation, frozen as tested: a 3-day drop of 15% or more, volume at least 2.5 times the prior
20-day mean and a close in the upper half of the day; long at the next daily open, stop at the signal low minus
0.5 ATR(20), target half way back to the prior 10-day high, time limit 10 days (60 4h bars).
"""
import importlib.util, os

from harness import Signal

_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_spec = importlib.util.spec_from_file_location("oversold_run", os.path.join(_ROOT, "oversold", "run.py"))
OS = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(OS)


def signals(bars):
    d = bars["1d"][["open", "high", "low", "close", "volume"]]
    sig, _ = OS.signals(d)
    return [Signal(d.index[e], side, stop, tgt, 60) for e, side, entry, stop, tgt in sig["O3"]]
