"""combo-v2 candidate: any line break, ranked by a frozen ridge model over candle, volume, indicator and line features.

Lines (all from bars closed by the signal): intact 4h swing levels of order 3, 5 and 8 (first close beyond); trend lines
through the last two confirmed 4h swing pivots of order 5 and 8 (falling highs / rising lows, first close through); the
previous closed UTC day's and ISO week's high/low (first 4h close beyond); half-decade round numbers (for a price p, the
step is 10**floor(log10 p) / 2), crossed by a 4h close.
Event: a 4h bar with body >= 0.5 ATR(14, known before the bar) and close in the outer half of its range that closes
through at least one of those lines in its own direction.
Score: a linear model (ridge, alpha 100, standardised features) fitted once on BTCUSD + ETHUSDT 2017-2022 events to the
signal's R minus its random control (clipped to [-1.5, 2.5]). Its coefficients are frozen below and never refitted.
A signal fires when the score >= the median score of the fitting events.
Stop at the signal bar's opposite extreme, target 2R, time limit 30 4h bars.
"""
import numpy as np
import pandas as pd

from harness import Signal

FEATS = ['body', 'cp', 'lvr', 'dtr50', 'dtr200', 'e2050', 'rsi', 'bwp', 'atrp', 'obv', 'e20', 'hl3', 'hl8', 'pd', 'pw',
         'tl8', 'rnd', 'long']
MU = np.array([1.185839, 0.812799, 0.375471, 0.124636, 0.082562, 0.15692, 0.620666, 0.504637, 0.499697, 0.411485,
               1.43081, 0.558349, 0.285261, 0.495105, 0.100556, 0.109288, 0.363059, 0.527917])
SD = np.array([0.608441, 0.120437, 0.55989, 0.990732, 0.957023, 0.987742, 0.113739, 0.305193, 0.313398, 0.911537,
               1.222199, 0.496649, 0.451598, 0.500042, 0.300779, 0.312042, 0.480945, 0.499286])
COEF = np.array([0.011157, 0.027861, 0.092684, 0.074574, -0.062514, -0.026242, -0.073167, -0.067457, -0.020847,
                 -0.024037, 0.120327, -0.048363, 0.023887, -0.039795, 0.007617, 0.018055, -0.035013, 0.013436])
B0, THR = 0.071147, 0.070796
MIN_BODY, MIN_CP, START = 0.5, 0.5, 250
RR, HOLD = 2.0, 30
H4 = pd.Timedelta(hours=4)
AGG = {"open": "first", "high": "max", "low": "min", "close": "last", "volume": "sum"}


def _atr(h, l, c, n=14):
    pc = np.r_[np.nan, c[:-1]]
    tr = np.nanmax(np.c_[h - l, np.abs(h - pc), np.abs(l - pc)], axis=1)
    return pd.Series(tr).ewm(alpha=1 / n, adjust=False).mean().values


def _ema(x, n):
    return pd.Series(x).ewm(span=n, adjust=False).mean().values


def _rsi(c, n=14):
    d = np.diff(c, prepend=c[0])
    up = pd.Series(np.maximum(d, 0)).ewm(alpha=1 / n, adjust=False).mean().values
    dn = pd.Series(np.maximum(-d, 0)).ewm(alpha=1 / n, adjust=False).mean().values
    return 100 - 100 / (1 + up / np.maximum(dn, 1e-12))


def _pivots(h, l, k):
    ph, pl = [], []
    for j in range(k, len(h) - k):
        if h[j] == h[j - k:j + k + 1].max():
            ph.append(j)
        if l[j] == l[j - k:j + k + 1].min():
            pl.append(j)
    return ph, pl


def _level_breaks(h, l, c, k):
    ph, pl = _pivots(h, l, k)
    ev = set()
    for side, piv, px in ((1, ph, h), (-1, pl, l)):
        act, p = [], 0
        for i in range(1, len(c)):
            while p < len(piv) and piv[p] + k <= i:
                act.append(px[piv[p]])
                p += 1
            keep = []
            for lev in act:
                if (c[i] - lev) * side > 0 and (c[i - 1] - lev) * side <= 0:
                    ev.add((i, side))
                if (c[i] - lev) * side <= 0:
                    keep.append(lev)
            act = keep
    return ev


def _line_breaks(h, l, c, k, min_span=6, max_ext=60):
    ph, pl = _pivots(h, l, k)
    ev = set()
    for side, piv, px in ((1, ph, h), (-1, pl, l)):
        p, conf, dead = 0, [], set()
        for i in range(1, len(c)):
            while p < len(piv) and piv[p] + k <= i:
                conf.append(piv[p])
                p += 1
            if len(conf) < 2:
                continue
            j1, j2 = conf[-2], conf[-1]
            if (j1, j2) in dead or j2 - j1 < min_span or i - j2 > max_ext:
                continue
            if side == 1 and not px[j2] < px[j1] or side == -1 and not px[j2] > px[j1]:
                continue
            sl = (px[j2] - px[j1]) / (j2 - j1)
            v = px[j2] + sl * (i - j2)
            if (c[i] - v) * side > 0:
                dead.add((j1, j2))
                seg = np.arange(j2 + 1, i)
                if np.all((c[seg] - (px[j2] + sl * (seg - j2))) * side <= 0):
                    ev.add((i, side))
    return ev


def _htf_breaks(d4, dx, period, c):
    kx = np.searchsorted((dx.index + period).values, (d4.index + H4).values, side="right") - 1
    H, L = dx.high.values, dx.low.values
    ev, seen = set(), set()
    for i in range(1, len(c)):
        if kx[i] < 0:
            continue
        for side, lev in ((1, H[kx[i]]), (-1, L[kx[i]])):
            if (c[i] - lev) * side > 0 and (side, kx[i]) not in seen:
                seen.add((side, kx[i]))
                ev.add((i, side))
    return ev


def _round_breaks(c):
    ev = set()
    for i in range(1, len(c)):
        s = 10 ** np.floor(np.log10(c[i - 1])) / 2
        lo, hi = min(c[i - 1], c[i]), max(c[i - 1], c[i])
        r = np.ceil(lo / s) * s
        if lo < r < hi:
            ev.add((i, 1 if c[i] > c[i - 1] else -1))
    return ev


def signals(bars):
    d4, d1 = bars["4h"], bars["1d"]
    if len(d4) < START + 10 or len(d1) < 2:
        return []
    o, h, l, c, v = (d4[x].values.astype(float) for x in ("open", "high", "low", "close", "volume"))
    n = len(c)
    a = _atr(h, l, c)
    ap = np.r_[np.nan, a[:-1]]
    close_t = d4.index + H4
    vr = v / pd.Series(v).shift(1).rolling(20).mean().values
    lines = {"hl3": _level_breaks(h, l, c, 3), "hl5": _level_breaks(h, l, c, 5), "hl8": _level_breaks(h, l, c, 8),
             "tl5": _line_breaks(h, l, c, 5), "tl8": _line_breaks(h, l, c, 8),
             "pd": _htf_breaks(d4, d1, pd.Timedelta(days=1), c),
             "pw": _htf_breaks(d4, d1.resample("W-MON", label="left", closed="left").agg(AGG).dropna(),
                               pd.Timedelta(days=7), c),
             "rnd": _round_breaks(c)}
    kd = np.searchsorted((d1.index + pd.Timedelta(days=1)).values, close_t.values, side="right") - 1
    dc = d1.close.values.astype(float)
    dsma50 = pd.Series(dc).rolling(50).mean().values
    dsma200 = pd.Series(dc).rolling(200).mean().values
    r = _rsi(c)
    e20, e50 = _ema(c, 20), _ema(c, 50)
    cs = pd.Series(c)
    mid, sdv = cs.rolling(20).mean(), cs.rolling(20).std(ddof=0)
    bwp = ((4 * sdv) / mid).rolling(120).rank(pct=True).values
    atrp = pd.Series(a / c).rolling(500, min_periods=100).rank(pct=True).values
    obv = np.cumsum(np.sign(np.diff(c, prepend=c[0])) * v)
    out = []
    for i in range(START, n):
        rg = h[i] - l[i]
        if rg <= 0 or not ap[i] > 0:
            continue
        side = 1 if c[i] > o[i] else -1
        body = (c[i] - o[i]) * side / ap[i]
        cp = (c[i] - l[i]) / rg if side == 1 else (h[i] - c[i]) / rg
        if body < MIN_BODY or cp < MIN_CP:
            continue
        flag = {k: (i, side) in s for k, s in lines.items()}
        if not any(flag.values()):
            continue
        j = kd[i]
        x = np.array([
            min(max(body, 0.5), 3.0), cp, np.log(min(max(vr[i], 0.2), 5.0)) if not np.isnan(vr[i]) else np.nan,
            np.sign(dc[j] - dsma50[j]) * side if j >= 50 else 0.0,
            np.sign(dc[j] - dsma200[j]) * side if j >= 200 else 0.0,
            np.sign(e20[i] - e50[i]) * side, (r[i] if side == 1 else 100 - r[i]) / 100, bwp[i], atrp[i],
            np.sign(obv[i] - obv[i - 20]) * side, min(max((c[i] - e20[i]) * side / a[i], -3.0), 6.0),
            flag["hl3"], flag["hl8"], flag["pd"], flag["pw"], flag["tl8"], flag["rnd"], side == 1], float)
        z = np.nan_to_num((x - MU) / SD, nan=0.0)
        if z @ COEF + B0 < THR:
            continue
        stop = l[i] if side == 1 else h[i]
        out.append(Signal(close_t[i], side, stop, c[i] + side * RR * abs(c[i] - stop), HOLD))
    return out
