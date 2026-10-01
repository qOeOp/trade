"""Family E of the R&D loop: "the box edge holds" (range-v2 C). Usage: python loop/family_e.py E-1"""
import os, sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import engine as E  # noqa: E402
import family_a as FA  # noqa: E402

R2 = E.R2
BASE = dict(tf="4h", hold=30, rule="C")
LOOPS = {"E-1": dict(BASE)}


def make(cfg):
    def fn(d1, d4):
        d = d4[["open", "high", "low", "close"]]
        top, bot, a = R2.boxes(d)
        return R2.signals(d, top, bot, a)["C"]
    return fn, {}


if __name__ == "__main__":
    FA.LOOPS.clear()
    FA.LOOPS.update(LOOPS)
    FA.make = make
    FA.main()
