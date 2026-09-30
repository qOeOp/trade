"""combo-v2 candidate: trend-line breakout confirmed by a strong candle.

Line: the straight line through the last two confirmed 4h swing highs of order 8 when the second is lower (a falling
resistance line), or through the last two confirmed swing lows of order 8 when the second is higher (a rising support
line). The two pivots are at least 6 bars apart, and the line is used for at most 60 bars after its second pivot. A line
dies the first time a 4h bar closes beyond it. A signal fires when that first close beyond the line comes from a bar
that has not closed beyond it since the second pivot, and the bar is strong: body >= 1.0 ATR(14, known before the bar)
in the break direction and close in the outer 30% of its range.
Stop at the signal bar's opposite extreme, target 2R, time limit 30 4h bars. Reads only bars closed by each signal's time.
"""
import numpy as np
import pandas as pd

from harness import Signal

PIVOT_K = 8       # swing order on 4h bars; a pivot is confirmed k bars after it
MIN_SPAN = 6      # bars between the two anchor pivots
MAX_EXT = 60      # bars the line is extended past its second pivot
BODY_ATR = 1.0
CLOSE_POS = 0.7
RR, HOLD = 2.0, 30


def _atr(h, l, c, n=14):
    pc = np.r_[np.nan, c[:-1]]
    tr = np.nanmax(np.c_[h - l, np.abs(h - pc), np.abs(l - pc)], axis=1)
    return pd.Series(tr).ewm(alpha=1 / n, adjust=False).mean().values


def _pivots(h, l, k):
    ph, pl = [], []
    for j in range(k, len(h) - k):
        if h[j] == h[j - k:j + k + 1].max():
            ph.append(j)
        if l[j] == l[j - k:j + k + 1].min():
            pl.append(j)
    return ph, pl


def _line_breaks(h, l, c, k):
    """(i, side, line value): first close through the line of the last two confirmed pivots (bars <= i only)."""
    ph, pl = _pivots(h, l, k)
    ev = []
    for side, piv, px in ((1, ph, h), (-1, pl, l)):
        p, conf, dead = 0, [], set()
        for i in range(1, len(c)):
            while p < len(piv) and piv[p] + k <= i:
                conf.append(piv[p])
                p += 1
            if len(conf) < 2:
                continue
            j1, j2 = conf[-2], conf[-1]
            if (j1, j2) in dead or j2 - j1 < MIN_SPAN or i - j2 > MAX_EXT:
                continue
            if side == 1 and not px[j2] < px[j1] or side == -1 and not px[j2] > px[j1]:
                continue
            sl = (px[j2] - px[j1]) / (j2 - j1)
            v = px[j2] + sl * (i - j2)
            if (c[i] - v) * side > 0:
                dead.add((j1, j2))
                seg = np.arange(j2 + 1, i)
                lv = px[j2] + sl * (seg - j2)
                if np.all((c[seg] - lv) * side <= 0):
                    ev.append((i, side, v))
    return sorted(ev)


def signals(bars):
    d4 = bars["4h"]
    if len(d4) < 100:
        return []
    o, h, l, c = (d4[x].values.astype(float) for x in ("open", "high", "low", "close"))
    a = _atr(h, l, c)
    a_prev = np.r_[np.nan, a[:-1]]
    close_t = d4.index + pd.Timedelta(hours=4)
    out = []
    for i, side, _v in _line_breaks(h, l, c, PIVOT_K):
        if i < 30:
            continue
        rg = h[i] - l[i]
        if rg <= 0 or not a_prev[i] > 0:
            continue
        if (c[i] - o[i]) * side < BODY_ATR * a_prev[i]:
            continue
        cp = (c[i] - l[i]) / rg if side == 1 else (h[i] - c[i]) / rg
        if cp < CLOSE_POS:
            continue
        stop = l[i] if side == 1 else h[i]
        out.append(Signal(close_t[i], side, stop, c[i] + side * RR * abs(c[i] - stop), HOLD))
    return out
