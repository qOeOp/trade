"""combo-v2 candidate: horizontal swing-level breakout, confirmed by a strong candle, in a calm regime, with the daily trend.

Line: every confirmed 4h swing high (low) of order 3 is a horizontal resistance (support) level. It stays active until a
4h bar closes beyond it. A signal fires on the first 4h close beyond an active level when all of these hold:
  - candle: body >= 1.0 ATR(14, known before the bar) in the break direction, close in the outer 30% of the bar's range;
  - regime: ATR(14)/close ranks below 0.5 of its trailing 500 4h bars (a break out of calm, not of a volatility spike);
  - trend: the last closed daily close is on the break side of its 50-day simple moving average.
Stop at the signal bar's opposite extreme, target 2R, time limit 30 4h bars. Reads only bars closed by each signal's time.
"""
import numpy as np
import pandas as pd

from harness import Signal

PIVOT_K = 3          # swing order on 4h bars; a pivot is confirmed k bars after it
BODY_ATR = 1.0       # minimum body in ATR (ATR known before the signal bar)
CLOSE_POS = 0.7      # close within the outer 30% of the bar range
ATR_RANK_MAX = 0.5   # ATR/close percentile over the trailing window must be below this
ATR_RANK_WIN = 500   # 4h bars
DAILY_SMA = 50       # days
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


def _level_breaks(h, l, c, k):
    """(i, side, level): first close beyond an intact confirmed pivot level (bar i uses bars <= i only)."""
    ph, pl = _pivots(h, l, k)
    ev = []
    for side, piv, px in ((1, ph, h), (-1, pl, l)):
        act, p = [], 0
        for i in range(1, len(c)):
            while p < len(piv) and piv[p] + k <= i:
                act.append(px[piv[p]])
                p += 1
            hit, keep = None, []
            for lev in act:
                if side == 1:
                    if c[i] > lev >= c[i - 1]:
                        hit = lev
                    if c[i] <= lev:
                        keep.append(lev)
                else:
                    if c[i] < lev <= c[i - 1]:
                        hit = lev
                    if c[i] >= lev:
                        keep.append(lev)
            act = keep
            if hit is not None:
                ev.append((i, side, hit))
    return sorted(ev)


def signals(bars):
    d4, d1 = bars["4h"], bars["1d"]
    if len(d4) < 300 or len(d1) < DAILY_SMA + 1:
        return []
    o, h, l, c = (d4[x].values.astype(float) for x in ("open", "high", "low", "close"))
    a = _atr(h, l, c)
    a_prev = np.r_[np.nan, a[:-1]]
    rank = pd.Series(a / c).rolling(ATR_RANK_WIN, min_periods=100).rank(pct=True).values
    close_t = d4.index + pd.Timedelta(hours=4)
    day_close = d1.index + pd.Timedelta(days=1)
    kd = np.searchsorted(day_close.values, close_t.values, side="right") - 1  # last day closed by each 4h close
    dc = d1.close.values.astype(float)
    dsma = pd.Series(dc).rolling(DAILY_SMA).mean().values
    out = []
    for i, side, _lev in _level_breaks(h, l, c, PIVOT_K):
        if i < 250 or kd[i] < DAILY_SMA:
            continue
        rg = h[i] - l[i]
        if rg <= 0 or not a_prev[i] > 0:
            continue
        if (c[i] - o[i]) * side < BODY_ATR * a_prev[i]:
            continue
        cp = (c[i] - l[i]) / rg if side == 1 else (h[i] - c[i]) / rg
        if cp < CLOSE_POS:
            continue
        if not rank[i] < ATR_RANK_MAX:
            continue
        if not (dc[kd[i]] - dsma[kd[i]]) * side > 0:
            continue
        stop = l[i] if side == 1 else h[i]
        out.append(Signal(close_t[i], side, stop, c[i] + side * RR * abs(c[i] - stop), HOLD))
    return out
