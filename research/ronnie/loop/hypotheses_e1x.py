"""Hypotheses from the visual review of E-1x (box fade), quantified on all iteration-tier trades with beta checks.
H1 approach shape: er20 = Kaufman efficiency ratio of the 20 bars into the edge (persistent grind = high); spike4 = the
   last 4 bars' move toward the edge in ATR; app20 = the 20-bar move toward the edge in ATR.
H2 side (longs vs shorts).
H3 BTC moving toward the edge: btc20 = BTC's 20-bar return in the approach direction, in BTC ATRs.
H4 entry depth in ATR: depth = distance from the faded edge to the entry, in ATR (R-unit free).
Writes loop/hypotheses_e1x.txt."""
import os, sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import attrib  # noqa: E402
import engine as E  # noqa: E402


def features(coin, z, tf="4h"):
    d = E.bars(coin)[tf]
    o, h, l, c = (d[k].values for k in ("open", "high", "low", "close"))
    a = E.MT.atr_of(h, l, c)
    b = E.bars("BTC")[tf]
    bc = b.close.reindex(d.index).ffill().values
    ba = E.MT.atr_of(b.high.reindex(d.index).ffill().values, b.low.reindex(d.index).ffill().values, bc)
    e = d.index.get_indexer(pd.to_datetime(z.time))
    rows = []
    for k, side, sa in zip(e, z.side.values, z.stop_atr.values):
        i = k - 1
        app = -side  # a long fade is approached from above (price falling toward the bottom edge)
        net = c[i] - c[i - 20]
        path = np.abs(np.diff(c[i - 20:i + 1])).sum()
        rows.append(dict(er20=abs(net) / path if path > 0 else np.nan, app20=app * net / a[i], spike4=app * (c[i] - c[i - 4]) / a[i],
                         btc20=app * (bc[i] - bc[i - 20]) / ba[i], depth=sa - E.R2.PAD))
    return z.assign(**pd.DataFrame(rows, index=z.index))


def main():
    z = pd.read_csv(os.path.join(HERE, "out", "E-1x_iteration.csv.gz"), parse_dates=["time"])
    z = pd.concat([features(c, g) for c, g in z.groupby("coin")])
    z["edge"] = z.R - z.control
    feats = ["er20", "app20", "spike4", "btc20", "depth"]
    text, ev = attrib.report(z, feats, "E-1x: hypotheses from the visual review, all extended-tier trades")
    out = [text]
    for sd in (1, -1):
        k = z[z.side == sd]
        lo, hi = attrib.week_boot(k)
        out.append(f"  H2 side {sd:+d}: n {len(k)}, avg R {k.R.mean():+.3f}, edge {k.edge.mean():+.3f} [{lo:+.3f}, {hi:+.3f}] (week-clustered)")
    out.append(f"  H4 in ATR units: edge x stop_atr by depth quintile: " + " ".join(
        f"Q{q + 1} {g.mean():+.3f}" for q, g in (z.edge * z.stop_atr).groupby(pd.qcut(z.depth.rank(method='first'), 5, labels=False))))
    for f in ("er20", "spike4", "btc20"):
        out.append(attrib.beta_check(z, f, E.ITER_COINS + E.ITER_EXT_COINS[:12], "4h", hold=30, stop_atr=1.0, target_r=2.0, step=8,
                                     feat_fn=features))
    t = "\n".join(out)
    print(t)
    open(os.path.join(HERE, "hypotheses_e1x.txt"), "w").write(t + "\n")


if __name__ == "__main__":
    main()
