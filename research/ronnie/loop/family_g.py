"""Family G of the R&D loop: "a box break regresses into the box". Usage: python loop/family_g.py G-1"""
import os, sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import engine as E  # noqa: E402
import family_a as FA  # noqa: E402
import family_d as FD  # noqa: E402

BASE = dict(tf="4h", hold=12, max_break=0.5, iter_set="iterx")
LOOPS = {"G-1": dict(BASE)}


def make(cfg):
    def fn(d1, d4):
        d = d4[["open", "high", "low", "close"]]
        o, h, l, c = (d[x].values for x in ("open", "high", "low", "close"))
        top, bot, a = FD.R3.R2.boxes(d)
        out = []
        for e, side, entry, stop, tgt in FD.R3.x1(d, top, bot, a):
            i = e - 1
            t, b = top[i - 1], bot[i - 1]
            edge = t if side == 1 else b
            if (c[i] - edge) * side >= cfg["max_break"] * a[i - 1]:
                continue
            fade = -side
            st = (h[i] if side == 1 else l[i]) - fade * 0.25 * a[i - 1]
            tg = (t + b) / 2
            if (o[e] - st) * fade > 0 and (tg - o[e]) * fade > 0:
                out.append((e, fade, o[e], st, tg))
        return out
    return fn, {}


if __name__ == "__main__":
    FA.LOOPS.clear()
    FA.LOOPS.update(LOOPS)
    FA.make = make
    FA.main()
