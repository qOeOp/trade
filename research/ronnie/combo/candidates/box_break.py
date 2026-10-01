"""range-v3 X1, the 4h box breakout, frozen as tested in range-v3 and range-v4: a 4h close beyond the 60-bar box known
at the bar before, entry at the next 4h open, stop at the box middle, target one box width, time limit 30 4h bars;
signals with a target under 1R are dropped (as the range-v2 scorer does).
"""
import importlib.util, os

from harness import Signal

_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_spec = importlib.util.spec_from_file_location("range3_run", os.path.join(_ROOT, "range3", "run.py"))
R3 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(R3)
HOLD = 30


def signals(bars):
    d = bars["4h"][["open", "high", "low", "close"]]
    top, bot, a = R3.R2.boxes(d)
    out = []
    for e, side, entry, stop, tgt in R3.x1(d, top, bot, a):
        if (tgt - entry) * side >= (entry - stop) * side > 0:
            out.append(Signal(d.index[e], side, stop, tgt, HOLD))
    return out
