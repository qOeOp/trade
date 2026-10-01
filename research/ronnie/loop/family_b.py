"""Family B of the R&D loop: "a broken level runs". Usage: python loop/family_b.py B-1 [validate|final]"""
import gzip, os, sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import engine as E  # noqa: E402
import family_a as FA  # noqa: E402

BASE = dict(tf="1d", stop_atr=1.0, rr=3.0, hold=20, spacing=5, level_tf="1w", sides=(1, -1))
LOOPS = {"B-1": dict(BASE), "B-2": dict(BASE, sides=(1,)), "B-3": dict(BASE, sides=(1,), closes=2)}


def make(cfg):
    feats = {}

    def fn(d1, d4):
        d = d1
        o, h, l, c = (d[x].values for x in ("open", "high", "low", "close"))
        a, a100 = E.MT.atr_of(h, l, c), E.MT.atr_of(h, l, c, 100)
        s50, s200 = (pd.Series(c).rolling(k).mean().values for k in (50, 200))
        w = d.resample("W-MON", label="left", closed="left").agg({"open": "first", "high": "max", "low": "min", "close": "last"}).dropna()
        wbook = FA.levels(w, 2)
        wi = w.index.searchsorted(d.index, side="right") - 1
        out, last = [], -99
        for i in range(210, len(c) - 1):
            if i - last < cfg["spacing"] or wi[i] < 0:
                continue
            Y, S = wbook[wi[i]][0], wbook[wi[i]][1]
            for side in cfg["sides"]:
                up = c[i] > s200[i] and s50[i] > s200[i]
                dn = c[i] < s200[i] and s50[i] < s200[i]
                if (side == 1 and not up) or (side == -1 and not dn):
                    continue
                m = S == side  # resistances for longs, supports for shorts
                if cfg.get("closes", 1) == 2:  # the 2nd consecutive close beyond a level the close before had not crossed
                    crossed = m & ((c[i] - Y) * side > 0) & ((c[i - 1] - Y) * side > 0) & ((c[i - 2] - Y) * side <= 0)
                else:
                    crossed = m & ((c[i] - Y) * side > 0) & ((c[i - 1] - Y) * side <= 0)
                if not crossed.any():
                    continue
                y = Y[crossed].max() if side == 1 else Y[crossed].min()
                entry = o[i + 1]
                stop = y - side * cfg["stop_atr"] * a[i - 1]
                risk = (entry - stop) * side
                if risk <= 0 or risk > 6 * a[i - 1]:
                    continue
                out.append((i + 1, side, entry, stop, entry + side * cfg["rr"] * risk))
                feats[(d.index[i + 1], side)] = dict(trend_atr=(c[i] - s200[i]) / a[i - 1] * side, vol_ratio=a[i - 1] / a100[i - 1],
                                                     touches=0, age=0, depth=(c[i] - y) * side / a[i - 1], n_levels=int(m.sum()))
                last = i
        return out
    return fn, feats


if __name__ == "__main__":
    FA.LOOPS.update(LOOPS)
    FA.make = make
    FA.main()
