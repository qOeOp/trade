"""Interface example for combo-v2 candidates (not a candidate): the prior UTC day's low and high as horizontal levels.

A 4h bar that trades through the level and closes back beyond it signals a reversal; stop 0.25 ATR beyond the bar,
target 2R, 30 4h bars at most. Reads only bars closed by each signal's time.
"""
import numpy as np
import pandas as pd

from harness import Signal


def signals(bars):
    d4, d1 = bars["4h"], bars["1d"]
    if len(d4) < 30 or len(d1) < 2:
        return []
    o, h, l, c = (d4[x].values for x in ("open", "high", "low", "close"))
    tr = np.maximum(h - l, np.maximum(abs(h - np.roll(c, 1)), abs(l - np.roll(c, 1))))
    tr[0] = h[0] - l[0]  # np.roll wraps the last close into bar 0: a look-ahead the harness check catches
    atr = pd.Series(tr).ewm(alpha=1 / 14, adjust=False).mean().values
    day_close = d1.index + pd.Timedelta(days=1)
    close_t = d4.index + pd.Timedelta(hours=4)
    k = np.searchsorted(day_close.values, close_t.values, side="right") - 1  # last day closed by each 4h close
    out = []
    for i in range(20, len(c)):
        if k[i] < 0:
            continue
        lo, hi = d1.low.values[k[i]], d1.high.values[k[i]]
        if l[i] < lo < c[i] and c[i] > o[i]:
            stop = l[i] - 0.25 * atr[i]
            out.append(Signal(close_t[i], 1, stop, c[i] + 2 * (c[i] - stop), 30))
        elif h[i] > hi > c[i] and c[i] < o[i]:
            stop = h[i] + 0.25 * atr[i]
            out.append(Signal(close_t[i], -1, stop, c[i] - 2 * (stop - c[i]), 30))
    return out
