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
LOOPS = {"E-1": dict(BASE), "E-2": dict(BASE, rule="failed_break", iter_set="iterx")}


def make(cfg):
    def fn(d1, d4):
        d = d4[["open", "high", "low", "close"]]
        top, bot, a = R2.boxes(d)
        if cfg["rule"] == "C":
            return R2.signals(d, top, bot, a)["C"]
        o, h, l, c = (d[x].values for x in ("open", "high", "low", "close"))
        out, used, busy = [], set(), -1
        for i in range(R2.W + 21, len(c) - 1):
            t, b = top[i - 1], bot[i - 1]  # the box known at the bar before the break
            if np.isnan(t) or i <= busy:
                continue
            for brk, edge, far in ((-1, b, t), (1, t, b)):  # brk -1: a close below the bottom; +1: above the top
                key = (round(t, 10), round(b, 10), brk)
                if key in used or (c[i] - edge) * brk <= 0:
                    continue
                used.add(key)
                ext = l[i] if brk == -1 else h[i]
                for j in range(i + 1, min(i + 7, len(c) - 1)):
                    ext = min(ext, l[j]) if brk == -1 else max(ext, h[j])
                    if (c[j] - edge) * brk < 0:  # back inside the box: trade toward the far edge
                        side = -brk
                        ai = a[j - 1]
                        entry, stop, tgt = o[j + 1], ext - side * 0.25 * ai, far - side * R2.TP_PAD * ai
                        if (entry - stop) * side > 0 and (tgt - entry) * side > 0:
                            out.append((j + 1, side, entry, stop, tgt))
                            busy = j + 1
                        break
        return out
    return fn, {}


if __name__ == "__main__":
    FA.LOOPS.clear()
    FA.LOOPS.update(LOOPS)
    FA.make = make
    FA.main()
