"""Family F of the R&D loop: "the trend line marks the turn" (combo-v2 trendline_break_strong). Usage: python loop/family_f.py F-1"""
import os, sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "combo", "candidates"))
import engine as E  # noqa: E402
import family_a as FA  # noqa: E402
import trendline_break_strong as TL  # noqa: E402

BASE = dict(tf="4h", hold=30)
LOOPS = {"F-1": dict(BASE), "F-2": dict(BASE, time_only=True)}


def make(cfg):
    def fn(d1, d4):
        d = d4
        saved = TL.RR
        if cfg.get("time_only"):
            TL.RR = 1000.0
        try:
            sigs = TL.signals({"4h": d4, "1d": d1, "1h": None})
        finally:
            TL.RR = saved
        o = d.open.values
        out = []
        for s in sigs:
            e = int(d.index.searchsorted(pd.Timestamp(s.time)))
            if e < len(d) and d.index[e] == pd.Timestamp(s.time):
                out.append((e, s.side, o[e], s.stop, s.target))
        return out
    return fn, {}


if __name__ == "__main__":
    FA.LOOPS.clear()
    FA.LOOPS.update(LOOPS)
    FA.make = make
    FA.main()
