"""Family B of the R&D loop: "a broken level runs". Usage: python loop/family_b.py B-1 [validate|final]"""
import gzip, os, sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import engine as E  # noqa: E402
import family_a as FA  # noqa: E402

BASE = dict(tf="1d", stop_atr=1.0, rr=3.0, hold=20, spacing=5, level_tf="1w", sides=(1, -1))
LOOPS = {"B-1": dict(BASE), "B-2": dict(BASE, sides=(1,)), "B-3": dict(BASE, sides=(1,), closes=2), "B-4": dict(BASE, sides=(1,), closes=2, max_vol=1.0),
         "B-5": dict(BASE, sides=(1,), closes=2, max_vol=1.0, level_tf="1d"),
         "B-6": dict(BASE, sides=(1,), max_vol=1.0, level_tf="1d"),
         "B-7": dict(BASE, sides=(1,), closes=2, max_vol=1.0, level_tf="donchian20"),
         "B-8": dict(BASE, sides=(1,), closes=2, max_vol=1.0, level_tf="1d", tf="4h"),
         "B-9": dict(BASE, sides=(1,), level_tf="round", iter_set="iterx"),
         "B-10": dict(BASE, sides=(1,), min_volx=1.5, iter_set="iterx")}


def make(cfg):
    feats = {}

    def fn(d1, d4):
        d = d1 if cfg["tf"] == "1d" else d4
        o, h, l, c, v = (d[x].values for x in ("open", "high", "low", "close", "volume"))
        vm = pd.Series(v).shift(1).rolling(20).mean().values
        a, a100 = E.MT.atr_of(h, l, c), E.MT.atr_of(h, l, c, 100)
        if cfg["tf"] == "1d":
            s50, s200, cc = \
                (pd.Series(c).rolling(50).mean().values, pd.Series(c).rolling(200).mean().values, c)
        else:  # the daily trend at the last closed day, mapped onto 4h bars
            di = np.maximum(d1.index.searchsorted(d.index, side="right") - 2, 0)
            dc = d1.close
            s50, s200, cc = dc.rolling(50).mean().values[di], dc.rolling(200).mean().values[di], dc.values[di]
        if cfg["level_tf"] == "1w":
            w = d.resample("W-MON", label="left", closed="left").agg({"open": "first", "high": "max", "low": "min", "close": "last"}).dropna()
            wbook = FA.levels(w, 2)
            wi = w.index.searchsorted(d.index, side="right") - 1
        elif cfg["level_tf"] == "round":  # half-decade round numbers around the prior close
            wbook = []
            for j in range(len(c)):
                p = c[j - 2] if j > 1 else c[0]
                step = 10 ** np.floor(np.log10(p)) / 2
                ys = step * np.arange(np.floor(p / step) - 3, np.floor(p / step) + 5)
                ys = ys[ys > 0]
                wbook.append((ys, np.where(ys > p, 1, -1)))
            wi = np.arange(len(d))
        elif cfg["level_tf"] == "donchian20":  # one level per bar: the highest close of the 20 bars before
            hc, lc = pd.Series(c).shift(1).rolling(20).max().values, pd.Series(c).shift(1).rolling(20).min().values
            wbook = [(np.array([hc[j], lc[j]]), np.array([1, -1])) for j in range(len(c))]
            wi = np.arange(len(d))
        else:
            wbook, wi = FA.levels(d, 3), np.arange(len(d))
        out, last = [], -99
        for i in range(210, len(c) - 1):
            if i - last < cfg["spacing"] or wi[i] < 0:
                continue
            k = wi[i - cfg.get("closes", 1) + 1]  # levels intact at the open of the first crossing bar
            Y, S = wbook[k][0], wbook[k][1]
            for side in cfg["sides"]:
                up = cc[i] > s200[i] and s50[i] > s200[i]
                dn = cc[i] < s200[i] and s50[i] < s200[i]
                if (side == 1 and not up) or (side == -1 and not dn):
                    continue
                m = S == side  # resistances for longs, supports for shorts
                if cfg.get("closes", 1) == 2:  # the 2nd consecutive close beyond a level the close before had not crossed
                    crossed = m & ((c[i] - Y) * side > 0) & ((c[i - 1] - Y) * side > 0) & ((c[i - 2] - Y) * side <= 0)
                else:
                    crossed = m & ((c[i] - Y) * side > 0) & ((c[i - 1] - Y) * side <= 0)
                if not crossed.any():
                    continue
                if not v[i] >= cfg.get("min_volx", 0) * vm[i]:
                    continue
                if a[i - 1] / a100[i - 1] >= cfg.get("max_vol", np.inf):
                    continue
                y = Y[crossed].max() if side == 1 else Y[crossed].min()
                entry = o[i + 1]
                stop = y - side * cfg["stop_atr"] * a[i - 1]
                risk = (entry - stop) * side
                if risk <= 0 or risk > 6 * a[i - 1]:
                    continue
                out.append((i + 1, side, entry, stop, entry + side * cfg["rr"] * risk))
                feats[(E.CURRENT["coin"], d.index[i + 1], side)] = dict(trend_atr=(c[i] - s200[i]) / a[i - 1] * side, vol_ratio=a[i - 1] / a100[i - 1],
                                                     touches=0, age=0, depth=(c[i] - y) * side / a[i - 1], n_levels=int(m.sum()))
                last = i
        return out
    return fn, feats


if __name__ == "__main__":
    FA.LOOPS.update(LOOPS)
    FA.make = make
    FA.main()
