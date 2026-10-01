"""Why did the box fades of range-v1/v2 fail? Exploratory diagnosis on development data only (17 majors, 2018-2022).

For every L and C box-fade entry of range-v2 on 1h and 4h: the path after entry in units of the original risk R.
- MFE/MAE before the stop; whether the box broke on the traded side (a close 1 ATR beyond the edge within 30 bars)
  or on the far side; how far toward the far edge price got.
- The same entries re-exited with wider stops and nearer targets (a grid, diagnosis only, never a selection).
Writes range3/diagnose.txt.
"""
import importlib.util, os, sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
for p in (ROOT, os.path.join(ROOT, "combo")):
    sys.path.insert(0, p)
_spec = importlib.util.spec_from_file_location("range2_run", os.path.join(ROOT, "range2", "run.py"))
R2 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(R2)
MT = R2.MT
END = pd.Timestamp("2023-01-01", tz="UTC")
HOLD = 30


def main():
    from evaluate import holdout_bars
    rows = []
    for coin in R2.COINS:
        bars = holdout_bars(coin)
        for tf in ("1h", "4h"):
            d = bars[tf][["open", "high", "low", "close"]]
            d = d[d.index < END + pd.Timedelta(days=10)]
            o, h, l, c = (d[x].values for x in ("open", "high", "low", "close"))
            top, bot, a = R2.boxes(d)
            sig = R2.signals(d, top, bot, a)
            for v in ("L", "C"):
                for e, side, entry, stop, tgt in sig[v]:
                    if d.index[e] >= END or e + HOLD >= len(c):
                        continue
                    risk = (entry - stop) * side
                    ai = a[e - 1]
                    w = slice(e, e + HOLD + 1)
                    fav = (h[w] - entry) * side / risk if side == 1 else (entry - l[w]) / risk
                    adv = (entry - l[w]) / risk if side == 1 else (h[w] - entry) / risk
                    hit = np.flatnonzero(adv >= 1.0)
                    k = hit[0] if len(hit) else HOLD + 1
                    mfe_before_stop = fav[:k].max() if k > 0 else 0.0
                    edge = stop + side * R2.PAD * ai
                    far = tgt + side * R2.TP_PAD * ai
                    cl = c[w]
                    broke_near = np.any((edge - cl) * side > ai)
                    broke_far = np.any((cl - far) * side > ai)
                    width = abs(far - edge)
                    reach = ((h[w].max() - entry) if side == 1 else (entry - l[w].min())) / width
                    row = dict(coin=coin, tf=tf, v=v, risk_atr=risk / ai, width_atr=width / ai, stopped=k <= HOLD,
                               stop_bar=k, mfe=mfe_before_stop, broke_near=broke_near, broke_far=broke_far, reach=reach)
                    # re-exit grid: stop m ATR beyond the edge, target at a fraction of the box toward the far edge
                    for m in (0.5, 1.0, 2.0):
                        for f in (0.25, 0.5, 1.0):
                            st = edge - side * m * ai
                            tp = edge + side * f * width
                            if (tp - entry) * side <= 0 or (entry - st) * side <= 0:
                                row[f"g{m}_{f}"] = np.nan
                                continue
                            row[f"g{m}_{f}"] = MT.walk(o, h, l, c, np.array([e]), np.array([side]), np.array([entry]),
                                                        np.array([st]), np.array([tp]), HOLD, R2.FEE)[0]
                    rows.append(row)
        print(coin, flush=True)
    z = pd.DataFrame(rows)
    out = ["range3 diagnosis (development 2018-2022 only, exploratory): what happens after a box-fade entry", ""]
    for (tf, v), g in z.groupby(["tf", "v"]):
        out.append(f"{tf} {v}: n {len(g)}, stop {g.risk_atr.median():.2f} ATR from entry, box {g.width_atr.median():.1f} ATR wide")
        out.append(f"   stopped within 30 bars {g.stopped.mean():.0%} (median at bar {g[g.stopped].stop_bar.median():.0f}); "
                   f"MFE before stop: median {g.mfe.median():.2f}R, >=1R {np.mean(g.mfe >= 1):.0%}, >=2R {np.mean(g.mfe >= 2):.0%}")
        out.append(f"   box broke on the traded side {g.broke_near.mean():.0%}, on the far side {g.broke_far.mean():.0%}; "
                   f"price reached half the box {np.mean(g.reach >= 0.5):.0%}, the far edge {np.mean(g.reach >= 1):.0%}")
        grid = "  ".join(f"stop {m}/tgt {f}: {g[f'g{m}_{f}'].mean():+.2f}" for m in (0.5, 1.0, 2.0) for f in (0.25, 0.5, 1.0))
        out.append(f"   re-exit avg R (stop ATR beyond edge / target fraction of box): {grid}")
        out.append("")
    text = "\n".join(out)
    print(text)
    open(os.path.join(HERE, "diagnose.txt"), "w").write(text + "\n")


if __name__ == "__main__":
    main()
