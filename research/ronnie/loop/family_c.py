"""Family C of the R&D loop: "a capitulation marks the low". Usage: python loop/family_c.py C-1 [final]"""
import importlib.util, os, sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import engine as E  # noqa: E402
import family_a as FA  # noqa: E402

_spec = importlib.util.spec_from_file_location("oversold_run", os.path.join(E.ROOT, "oversold", "run.py"))
OS = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(OS)

BASE = dict(tf="1d", hold=10, rule="o3")
LOOPS = {"C-1": dict(BASE)}


def make(cfg):
    feats = {}

    def fn(d1, d4):
        d = d1
        o, h, l, c, v = (d[x].values for x in ("open", "high", "low", "close", "volume"))
        a, a100 = E.MT.atr_of(h, l, c, 20), E.MT.atr_of(h, l, c, 100)
        s200 = pd.Series(c).rolling(200).mean().values
        vm = pd.Series(v).shift(1).rolling(20).mean().values
        sig, _ = OS.signals(d)
        out = sig["O3"]
        for e, side, entry, stop, tgt in out:
            i = e - 1
            feats[(d.index[e], side)] = dict(trend_atr=(c[i] - s200[i]) / a[i - 1], vol_ratio=a[i - 1] / a100[i - 1],
                                             touches=0, age=0, depth=(c[i] / c[i - 3] - 1) * 100, n_levels=v[i] / vm[i])
        return out
    return fn, feats


if __name__ == "__main__":
    FA.LOOPS.clear()
    FA.LOOPS.update(LOOPS)
    FA.make = make
    FA.main()
