"""R&D loop C-6, frozen as tested: an idiosyncratic capitulation. The coin's largest 1-5 day drop minus BTC's return over
the same window is at most -15%, with volume at least 2.5 times the prior 20-day mean and the close in the upper half
of the day. Long at the next daily open; stop at the signal low minus 0.5 ATR(20); target half way back to the prior
10-day high; time limit 10 days (60 4h bars). BTC's daily closes are read from the same Binance archive.
"""
import os, sys

import pandas as pd

from harness import Signal

_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(_ROOT, "loop"))
_BTC = {}


def _btc_close(index):
    if "c" not in _BTC:
        import tv_hourly
        t1 = int(pd.Timestamp.now(tz="UTC").timestamp())
        h = tv_hourly.binance("BTCUSDT", int(pd.Timestamp("2017-07-01").value // 10**9), t1).drop_duplicates("time")
        s = pd.Series(h.close.values.astype(float), index=pd.to_datetime(h.time, unit="s", utc=True))
        _BTC["c"] = s.resample("1D", label="left", closed="left").last()
    return _BTC["c"].reindex(index).ffill().values


def signals(bars):
    d = bars["1d"]
    o, h, l, c, v = (d[x].values.astype(float) for x in ("open", "high", "low", "close", "volume"))
    from engine import MT
    a = MT.atr_of(h, l, c, 20)
    vm = pd.Series(v).shift(1).rolling(20).mean().values
    hh = pd.Series(h).shift(1).rolling(10).max().values
    bc = _btc_close(d.index)
    out, last = [], -99
    for i in range(210, len(c) - 1):
        rg = h[i] - l[i]
        drop = min(c[i] / c[i - k] - 1 - (bc[i] / bc[i - k] - 1) for k in range(1, 6)) <= -0.15
        if not (drop and vm[i] > 0 and v[i] >= 2.5 * vm[i] and rg > 0 and (c[i] - l[i]) / rg >= 0.5):
            continue
        stop, entry, tgt = l[i] - 0.5 * a[i], o[i + 1], c[i] + 0.5 * (hh[i] - c[i])
        risk = entry - stop
        if risk <= 0 or risk > 6 * a[i] or tgt - entry < risk or i - last < 5:
            continue
        out.append(Signal(d.index[i + 1], 1, stop, tgt, 60))
        last = i
    return out
