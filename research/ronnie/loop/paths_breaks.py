"""Descriptive (iteration tier, extended): what price does after a 4h close beyond a 60-bar box (range-v3 X1 breaks).
For each break: whether a later close comes back inside the box within 6/12/30 bars, how deep it goes (to the box
middle, to the far edge), and whether price first makes a new extreme beyond the break by at least half a box width.
Writes loop/paths_breaks.txt. Recorded in the census as a diagnosis (no strategy outcome is scored)."""
import os, sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import engine as E  # noqa: E402
import family_d as FD  # noqa: E402


def main():
    rows = []
    for coin in E.ITER_COINS + E.ITER_EXT_COINS:
        d = E.bars(coin)["4h"]
        d = d[d.index < E.ITER[1]][["open", "high", "low", "close"]]
        if len(d) < 400:
            continue
        o, h, l, c = (d[x].values for x in ("open", "high", "low", "close"))
        top, bot, a = FD.R3.R2.boxes(d)
        for e, side, entry, stop, tgt in FD.R3.x1(d, top, bot, a):
            i = e - 1
            t, b = top[i - 1], bot[i - 1]
            edge, far, mid, w = (t, b, (t + b) / 2, t - b) if side == 1 else (b, t, (t + b) / 2, t - b)
            r = dict(coin=coin, side=side)
            back = [k for k in range(e, min(e + 30, len(c))) if (c[k] - edge) * side < 0]
            for n in (6, 12, 30):
                r[f"back{n}"] = bool(back) and back[0] - e < n
            seg = slice(e, min(e + 30, len(c)))
            deep = (l[seg].min() if side == 1 else h[seg].max())
            r["to_mid"] = (deep - mid) * side <= 0
            r["to_far"] = (deep - far) * side <= 0
            ext = h[seg].max() if side == 1 else l[seg].min()
            r["run_half"] = (ext - edge) * side >= 0.5 * w
            # order: did the half-width run come before the first close back inside?
            k_run = next((k for k in range(e, min(e + 30, len(c))) if ((h[k] if side == 1 else l[k]) - edge) * side >= 0.5 * w), None)
            r["run_first"] = k_run is not None and (not back or k_run <= back[0])
            r["break_size"] = (c[i] - edge) * side / a[i - 1]
            rows.append(r)
    z = pd.DataFrame(rows)
    out = [f"After a 4h box break (X1), extended iteration tier, {len(z)} breaks:"]
    out.append(f"  a close back inside the box within 6 / 12 / 30 bars: {z.back6.mean():.0%} / {z.back12.mean():.0%} / {z.back30.mean():.0%}")
    out.append(f"  price reaches the box middle within 30 bars: {z.to_mid.mean():.0%}; the far edge: {z.to_far.mean():.0%}")
    out.append(f"  price runs at least half a box width beyond the edge within 30 bars: {z.run_half.mean():.0%} "
               f"(before any close back inside: {z.run_first.mean():.0%})")
    for lab, m in (("break close within 0.5 ATR of the edge", z.break_size < 0.5), ("break close 0.5 ATR or more beyond", z.break_size >= 0.5)):
        k = z[m]
        out.append(f"  {lab:<40} n {len(k):5d}: back inside within 12 bars {k.back12.mean():.0%}, reaches middle {k.to_mid.mean():.0%}, "
                   f"runs half a width {k.run_half.mean():.0%}")
    text = "\n".join(out)
    print(text)
    open(os.path.join(HERE, "paths_breaks.txt"), "w").write(text + "\n")
    E.log("G-0", "path statistics after box breaks", "diagnosis", dict(n=len(z)), False, "descriptive; no strategy outcome scored")


if __name__ == "__main__":
    main()
