"""Family D of the R&D loop: "a 4h box break runs" (range-v3 X1). Usage: python loop/family_d.py D-1"""
import importlib.util, os, sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import engine as E  # noqa: E402
import family_a as FA  # noqa: E402

_spec = importlib.util.spec_from_file_location("range3_run", os.path.join(E.ROOT, "range3", "run.py"))
R3 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(R3)

BASE = dict(tf="4h", hold=30, sides=(1, -1))
LOOPS = {"D-1": dict(BASE), "D-1x": dict(BASE, iter_set="iterx")}
LOOPS.update({f"D-2w{w}": dict(BASE, iter_set="iterx", W=w) for w in (30, 120, 240)})


def make(cfg):
    feats = {}

    def fn(d1, d4):
        d = d4[["open", "high", "low", "close"]]
        R3.R2.W = cfg.get("W", 60)
        top, bot, a = R3.R2.boxes(d)
        out = []
        for e, side, entry, stop, tgt in R3.x1(d, top, bot, a):
            if side not in cfg["sides"]:
                continue
            i = e - 1
            out.append((e, side, entry, stop, tgt))
            feats[(E.CURRENT["coin"], d.index[e], side)] = dict(depth=(top[i - 1] - bot[i - 1]) / a[i - 1] if a[i - 1] > 0 else np.nan)
        return out
    return fn, feats


if __name__ == "__main__":
    FA.LOOPS.clear()
    FA.LOOPS.update(LOOPS)
    FA.make = make
    FA.main()
