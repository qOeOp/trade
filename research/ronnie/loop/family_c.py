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
LOOPS = {"C-1": dict(BASE), "C-2": dict(BASE, rule="o3_atr", k_atr=1.8), "C-3": dict(BASE, rule="o3_window"), "C-4": dict(BASE, rule="o3_window", iter_set="iterx")}


def make(cfg):
    feats = {}

    def fn(d1, d4):
        d = d1
        o, h, l, c, v = (d[x].values for x in ("open", "high", "low", "close", "volume"))
        a, a100 = E.MT.atr_of(h, l, c, 20), E.MT.atr_of(h, l, c, 100)
        s200 = pd.Series(c).rolling(200).mean().values
        vm = pd.Series(v).shift(1).rolling(20).mean().values
        if cfg["rule"] == "o3":
            sig, _ = OS.signals(d)
            out = sig["O3"]
        else:  # O3 with the 3-day drop measured in ATR(20) units known before the drop
            hh = pd.Series(h).shift(1).rolling(OS.LOOK).max().values
            out, last = [], -99
            for i in range(210, len(c) - 1):
                rg = h[i] - l[i]
                if cfg["rule"] == "o3_window":  # the largest drop into today's close over 1 to 5 days
                    drop = min(c[i] / c[i - k] - 1 for k in range(1, 6)) <= OS.DROP3
                else:
                    drop = (c[i - 3] - c[i]) >= cfg["k_atr"] * a[i - 3]
                if not (drop and vm[i] > 0 and v[i] >= OS.VOLX * vm[i] and rg > 0 and (c[i] - l[i]) / rg >= 0.5):
                    continue
                stop, entry, tgt = l[i] - OS.PAD * a[i], o[i + 1], c[i] + 0.5 * (hh[i] - c[i])
                risk = entry - stop
                if risk <= 0 or risk > OS.MAX_STOP * a[i] or tgt - entry < risk or i - last < OS.SPACING:
                    continue
                out.append((i + 1, 1, entry, stop, tgt))
                last = i
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
